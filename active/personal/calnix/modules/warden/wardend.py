#!/usr/bin/env python3
"""
wardend — Warden HTTP API daemon for inter-warden communication.

Listens on the Tailscale interface (or configurable address) and serves
health status, check results, and peer management endpoints.

Usage:
  wardend [--port 9090] [--bind 0.0.0.0]
  wardend --help

Designed to run as a systemd service managed by the Warden Nix module.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

WARDEN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WARDEN_DIR))

from warden_state import (
    append_event,
    get_hostname,
    get_or_create_host_id,
    load_config,
    load_peer_status,
    load_state,
    list_peers,
    read_events,
    save_peer_status,
    utc_now,
)


# ── API handlers ────────────────────────────────────────────────────


class WardenHTTPHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for the Warden API."""

    # Shared state set by the server
    warden_config: dict[str, Any] = {}
    server_start_time: str = ""

    def log_message(self, format: str, *args: Any) -> None:
        """Log to stderr with timestamp."""
        sys.stderr.write(f"[wardend] {time.strftime('%Y-%m-%dT%H:%M:%S')} {args[0]} {args[1]} {args[2]}\n")

    def _send_json(self, data: dict[str, Any], status: int = 200) -> None:
        """Send a JSON response."""
        body = json.dumps(data, indent=2, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Warden-Host", get_hostname())
        self.send_header("X-Warden-Version", "1")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict[str, Any]:
        """Read and parse JSON request body."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        try:
            body = self.rfile.read(content_length)
            return json.loads(body)
        except (json.JSONDecodeError, OSError):
            return {}

    # ── Routes ──────────────────────────────────────────────────

    def do_GET(self) -> None:
        path = self.path.rstrip("/")

        if path == "/warden/status" or path == "/":
            return self._handle_status()
        elif path == "/warden/checks":
            return self._handle_checks()
        elif path.startswith("/warden/check/"):
            check_name = path[len("/warden/check/"):]
            return self._handle_check(check_name)
        elif path == "/warden/peers":
            return self._handle_peers()
        elif path == "/warden/events":
            return self._handle_events()
        elif path == "/warden/health":
            return self._send_json({"status": "ok", "uptime_seconds": self._uptime()})
        else:
            self._send_json({"error": "Not found", "path": path}, 404)

    def do_POST(self) -> None:
        path = self.path.rstrip("/")

        if path.startswith("/warden/remediate/"):
            check_name = path[len("/warden/remediate/"):]
            return self._handle_remediate(check_name)
        elif path == "/warden/alert":
            return self._handle_alert()
        elif path.startswith("/warden/backup/"):
            action = path[len("/warden/backup/"):]
            return self._handle_backup(action)
        else:
            self._send_json({"error": "Not found", "path": path}, 404)

    # ── Handlers ────────────────────────────────────────────────

    def _uptime(self) -> float:
        return time.time() - self.server_start_time_epoch

    def _handle_status(self) -> None:
        state = load_state()
        state["_peer"] = {
            "api_version": 1,
            "hostname": get_hostname(),
            "host_id": get_or_create_host_id(),
            "uptime_seconds": self._uptime(),
        }
        # Add a concise summary for peer consumption
        checks = state.get("checks", {})
        state["summary"] = {
            "check_count": len(checks),
            "pass_count": sum(1 for c in checks.values() if c.get("status") == "pass"),
            "warn_count": sum(1 for c in checks.values() if c.get("status") == "warn"),
            "fail_count": sum(1 for c in checks.values() if c.get("status") == "fail"),
            "overall": "healthy" if all(c.get("status") in ("pass", "warn") for c in checks.values()) else "degraded",
        }
        self._send_json(state)

    def _handle_checks(self) -> None:
        state = load_state()
        checks = state.get("checks", {})
        self._send_json({"checks": checks, "count": len(checks)})

    def _handle_check(self, check_name: str) -> None:
        state = load_state()
        checks = state.get("checks", {})
        if check_name in checks:
            self._send_json({"check": check_name, "result": checks[check_name]})
        else:
            self._send_json({"error": f"Check not found: {check_name}", "available": list(checks.keys())}, 404)

    def _handle_peers(self) -> None:
        peer_list = list_peers()
        peers_detail: dict[str, Any] = {}
        for name in peer_list:
            status = load_peer_status(name)
            peers_detail[name] = status or {"status": "unknown", "last_seen": None}
        self._send_json({"peers": peers_detail, "count": len(peer_list)})

    def _handle_events(self) -> None:
        try:
            n = int(self.path.split("?n=")[1]) if "?n=" in self.path else 50
        except (IndexError, ValueError):
            n = 50
        events = read_events(tail=min(n, 500))
        self._send_json({"events": events, "count": len(events)})

    def _handle_remediate(self, check_name: str) -> None:
        body = self._read_body()
        state = load_state()
        # Record remediation request
        entry = {
            "check": check_name,
            "action": body.get("action", "requested"),
            "status": "pending",
            "timestamp": utc_now(),
            "triggered_by": f"peer:{self.headers.get('X-Warden-Host', 'unknown')}",
            "peer_payload": body,
        }
        remediation_history = state.get("remediation_history", [])
        remediation_history.append(entry)
        state["remediation_history"] = remediation_history
        from warden_state import save_state as ss
        ss(state)
        append_event({"type": "remediation", **entry})
        self._send_json({"status": "accepted", "entry": entry})

    def _handle_alert(self) -> None:
        body = self._read_body()
        # Cache the peer's status
        peer_host = self.headers.get("X-Warden-Host", body.get("hostname", "unknown"))
        save_peer_status(peer_host, {
            "status": body.get("status", "unknown"),
            "summary": body.get("summary", ""),
            "timestamp": utc_now(),
            "source": "alert",
            "data": body,
        })
        append_event({
            "type": "peer",
            "peer": peer_host,
            "event": "alert_received",
            "payload": body,
        })
        self._send_json({"status": "acknowledged", "peer": peer_host})

    def _handle_backup(self, action: str) -> None:
        self._send_json({
            "status": "not_implemented",
            "action": action,
            "message": "Backup pull API coming in Phase 4",
        })

    # Silence noisy HTTP server logs
    def log_request(self, code: Any = "-", size: Any = "-") -> None:
        if code != 200:
            super().log_request(code, size)


def find_tailscale_ip() -> str | None:
    """Get the first Tailscale IP address for binding."""
    try:
        # Try with sudo first (warden user needs sudo to access tailscale socket)
        # Use absolute path — the service PATH doesn't include /run/wrappers/bin
        import shutil
        sudo_path = shutil.which("sudo") or "/run/wrappers/bin/sudo"
        for cmd in [
            [sudo_path, "tailscale", "status", "--json"],
            ["tailscale", "status", "--json"],
        ]:
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    self_info = data.get("Self", {})
                    ips = self_info.get("TailscaleIPs", [])
                    if ips:
                        return ips[0]
            except Exception:
                continue
    except Exception:
        pass
    return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Warden HTTP API daemon")
    parser.add_argument("--port", type=int, default=9090, help="Port to listen on")
    parser.add_argument("--bind", default=None, help="Address to bind (default: Tailscale IP, fallback: 127.0.0.1)")
    parser.add_argument("--state-dir", default=None, help="Warden state directory")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Set state dir
    if args.state_dir:
        os.environ["WARDEN_STATE_DIR"] = args.state_dir

    # Determine bind address
    bind = args.bind
    if not bind:
        ts_ip = find_tailscale_ip()
        if ts_ip:
            bind = ts_ip
            print(f"[wardend] Using Tailscale IP: {bind}", file=sys.stderr)
        else:
            bind = "127.0.0.1"
            print("[wardend] No Tailscale IP found, binding to 127.0.0.1", file=sys.stderr)

    # Start server
    server_addr = (bind, args.port)
    WardenHTTPHandler.warden_config = load_config()
    WardenHTTPHandler.server_start_time = utc_now()
    WardenHTTPHandler.server_start_time_epoch = time.time()

    server = http.server.HTTPServer(server_addr, WardenHTTPHandler)
    server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    print(f"[wardend] Listening on {bind}:{args.port}", file=sys.stderr)
    print(f"[wardend] Hostname: {get_hostname()}", file=sys.stderr)
    print(f"[wardend] Host ID:  {get_or_create_host_id()}", file=sys.stderr)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[wardend] Shutting down", file=sys.stderr)
        server.shutdown()


if __name__ == "__main__":
    main()
