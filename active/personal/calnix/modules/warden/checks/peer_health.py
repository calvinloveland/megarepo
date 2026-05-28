#!/usr/bin/env python3
"""
Warden check: peer-health

Queries all configured peer Wardens via their HTTP API and reports
their health status. Detects when peers become unreachable.

Configuration (optional, from config.json / Nix peers config):
  Peers are configured in the Warden Nix module or config.json.
  This check reads the peers list and queries each one via HTTP.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from typing import Any

CHECK_NAME = "peer-health"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def _load_peers_from_config() -> dict[str, dict[str, Any]]:
    """Load peer configuration from the Warden config file."""
    state_dir = os.environ.get("WARDEN_STATE_DIR", "/var/lib/warden")
    config_path = os.path.join(state_dir, "..", "..", "etc", "warden", "config.json")
    # Try multiple paths
    for attempt in [
        os.path.join("/etc/warden/config.json"),
        os.path.join(state_dir, "config.json"),
    ]:
        try:
            with open(attempt) as f:
                cfg = json.load(f)
                return cfg.get("peers", {})
        except (OSError, json.JSONDecodeError):
            continue
    return {}


def _query_peer(host: str, port: int = 9090) -> dict[str, Any] | None:
    """Query a peer Warden's health endpoint."""
    url = f"http://{host}:{port}/warden/health"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data
    except Exception as e:
        return None


def check_peer_health(config: dict[str, Any]) -> dict[str, Any]:
    peers = _load_peers_from_config()

    if not peers:
        return {
            "check": CHECK_NAME,
            "status": "warn",
            "message": "No peers configured",
            "data": {"peers": {}, "total": 0, "healthy": 0, "unreachable": 0},
        }

    results: dict[str, dict[str, Any]] = {}
    healthy_count = 0
    unreachable_count = 0
    worst_status = "pass"

    for peer_name, peer_cfg in peers.items():
        host = peer_cfg.get("host", peer_name)
        port = peer_cfg.get("port", 9090)

        peer_data = {
            "host": host,
            "port": port,
            "status": "unknown",
            "query_result": None,
        }

        result = _query_peer(host, port)
        if result is not None:
            peer_data["status"] = "healthy"
            peer_data["query_result"] = result
            healthy_count += 1
        else:
            peer_data["status"] = "unreachable"
            unreachable_count += 1
            worst_status = "fail"

        results[peer_name] = peer_data

    if unreachable_count > 0:
        unreachable_names = [n for n, r in results.items() if r["status"] == "unreachable"]
        message = f"{unreachable_count} peer(s) unreachable: {', '.join(unreachable_names)}"
    else:
        message = f"All {healthy_count} peer(s) healthy"

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": message,
        "data": {
            "peers": results,
            "total": len(peers),
            "healthy": healthy_count,
            "unreachable": unreachable_count,
        },
    }


def main():
    config = get_config()
    result = check_peer_health(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
