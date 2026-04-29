#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable


OPENCLAW_PORT = 18789
SERVE_PORT = 8443
HEALTHCHECK_URL = f"http://127.0.0.1:{OPENCLAW_PORT}/healthz"


class CommandError(RuntimeError):
    pass


class OpenClawProxyManager:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir.expanduser()
        self.run_dir = self.base_dir / "run"
        self.log_dir = self.base_dir / "log"
        self.tailscale_dir = self.base_dir / "tailscale"
        self.statedir = self.tailscale_dir / "var"
        self.state_file = self.tailscale_dir / "tailscaled.state"
        self.socket_path = self.run_dir / "tailscaled.sock"
        self.tailscaled_pid_file = self.run_dir / "tailscaled.pid"
        self.port_forward_pid_file = self.run_dir / "kubectl-port-forward.pid"
        self.tailscaled_log = self.log_dir / "tailscaled.log"
        self.port_forward_log = self.log_dir / "kubectl-port-forward.log"

    def ensure_directories(self) -> None:
        for path in (self.run_dir, self.log_dir, self.statedir):
            path.mkdir(parents=True, exist_ok=True)

    def start(self) -> None:
        self.ensure_directories()
        self.start_tailscaled()
        self.ensure_tailscale_up()
        self.start_port_forward()
        self.ensure_local_gateway()
        self.configure_serve()
        self.print_status()

    def stop(self) -> None:
        self.stop_process(self.port_forward_pid_file, "kubectl port-forward")
        self.stop_process(self.tailscaled_pid_file, "tailscaled")
        if self.socket_path.exists():
            self.socket_path.unlink()

    def status(self) -> int:
        self.print_status()
        return 0

    def print_status(self) -> None:
        local_health = "healthy" if self.gateway_healthy() else "unreachable"
        print(
            json.dumps(
                {
                    "paths": {
                        "base_dir": str(self.base_dir),
                        "tailscaled_log": str(self.tailscaled_log),
                        "port_forward_log": str(self.port_forward_log),
                    },
                    "tailscaled": self.process_status(self.tailscaled_pid_file),
                    "port_forward": self.process_status(self.port_forward_pid_file),
                    "local_gateway": local_health,
                    "tailscale": self.tailscale_status(),
                    "serve": self.serve_status(),
                },
                indent=2,
            )
        )

    def start_tailscaled(self) -> None:
        if self.process_status(self.tailscaled_pid_file)["running"]:
            return
        if self.socket_path.exists():
            self.socket_path.unlink()
        command = [
            "tailscaled",
            "--tun=userspace-networking",
            f"--socket={self.socket_path}",
            f"--state={self.state_file}",
            f"--statedir={self.statedir}",
        ]
        self.launch(command, self.tailscaled_log, self.tailscaled_pid_file)
        self.wait_for_socket(self.socket_path, timeout=20)

    def ensure_tailscale_up(self) -> None:
        status = self.tailscale_status()
        backend_state = status.get("BackendState")
        if backend_state == "Running":
            return
        result = self.run_command(
            ["tailscale", f"--socket={self.socket_path}", "up"],
            check=False,
            timeout=60,
        )
        if result.returncode != 0:
            raise CommandError(
                "tailscale up failed. Check the userspace daemon log and, if login is required, "
                f"run `tailscale --socket={self.socket_path} up` interactively on thinker."
            )
        status = self.tailscale_status()
        if status.get("BackendState") != "Running":
            raise CommandError(
                f"tailscale backend is {status.get('BackendState', 'unknown')} after `tailscale up`."
            )

    def start_port_forward(self) -> None:
        if self.process_status(self.port_forward_pid_file)["running"]:
            return
        command = [
            "kubectl",
            "-n",
            "openclaw",
            "port-forward",
            "--address",
            "127.0.0.1",
            "svc/openclaw",
            f"{OPENCLAW_PORT}:{OPENCLAW_PORT}",
        ]
        self.launch(command, self.port_forward_log, self.port_forward_pid_file)
        self.wait_for_port("127.0.0.1", OPENCLAW_PORT, timeout=20)

    def configure_serve(self) -> None:
        self.run_command(
            ["tailscale", f"--socket={self.socket_path}", "serve", "reset"],
            check=False,
            timeout=30,
        )
        self.run_command(
            [
                "tailscale",
                f"--socket={self.socket_path}",
                "serve",
                "--bg",
                f"--https={SERVE_PORT}",
                f"http://127.0.0.1:{OPENCLAW_PORT}",
            ],
            timeout=30,
        )

    def ensure_local_gateway(self) -> None:
        deadline = time.time() + 20
        while time.time() < deadline:
            if self.gateway_healthy():
                return
            time.sleep(1)
        raise CommandError(
            f"OpenClaw did not become healthy on {HEALTHCHECK_URL}. "
            f"Check {self.port_forward_log} and the cluster deployment."
        )

    def launch(self, command: list[str], log_path: Path, pid_path: Path) -> None:
        self.ensure_directories()
        with log_path.open("ab") as log_file:
            process = subprocess.Popen(
                command,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                text=False,
            )
        pid_path.write_text(f"{process.pid}\n")

    def stop_process(self, pid_path: Path, label: str) -> None:
        status = self.process_status(pid_path)
        pid = status.get("pid")
        if not pid or not status["running"]:
            if pid_path.exists():
                pid_path.unlink()
            return
        os.kill(pid, signal.SIGTERM)
        deadline = time.time() + 10
        while time.time() < deadline:
            if not self._pid_exists(pid):
                pid_path.unlink(missing_ok=True)
                return
            time.sleep(0.5)
        raise CommandError(f"Timed out waiting for {label} (pid {pid}) to stop.")

    def process_status(self, pid_path: Path) -> dict[str, object]:
        if not pid_path.exists():
            return {"running": False, "pid": None}
        try:
            pid = int(pid_path.read_text().strip())
        except ValueError:
            return {"running": False, "pid": None}
        running = self._pid_exists(pid)
        if not running:
            pid_path.unlink(missing_ok=True)
        return {"running": running, "pid": pid if running else None}

    def tailscale_status(self) -> dict[str, object]:
        if not self.socket_path.exists():
            return {"BackendState": "NoDaemon"}
        result = self.run_command(
            ["tailscale", f"--socket={self.socket_path}", "status", "--json"],
            check=False,
            timeout=20,
        )
        if result.returncode != 0:
            return {
                "BackendState": "Unavailable",
                "stderr": result.stderr.strip(),
            }
        return json.loads(result.stdout)

    def serve_status(self) -> dict[str, object]:
        if not self.socket_path.exists():
            return {"configured": False}
        result = self.run_command(
            ["tailscale", f"--socket={self.socket_path}", "serve", "status", "--json"],
            check=False,
            timeout=20,
        )
        if result.returncode != 0:
            return {
                "configured": False,
                "stderr": result.stderr.strip(),
            }
        return json.loads(result.stdout)

    def gateway_healthy(self) -> bool:
        try:
            with urllib.request.urlopen(HEALTHCHECK_URL, timeout=5) as response:
                return response.status == 200
        except (ConnectionError, TimeoutError, urllib.error.URLError):
            return False

    def wait_for_socket(self, socket_path: Path, timeout: int) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if socket_path.exists():
                return
            time.sleep(0.5)
        raise CommandError(f"Timed out waiting for Tailscale socket {socket_path}.")

    def wait_for_port(self, host: str, port: int, timeout: int) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with socket.create_connection((host, port), timeout=1):
                    return
            except OSError:
                time.sleep(0.5)
        raise CommandError(f"Timed out waiting for {host}:{port} to accept connections.")

    def run_command(
        self,
        command: list[str],
        *,
        check: bool = True,
        timeout: int | None = None,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if check and result.returncode != 0:
            raise CommandError(
                "Command failed: "
                + " ".join(command)
                + "\n"
                + "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
            )
        return result

    @staticmethod
    def _pid_exists(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Manage the thinker-side OpenClaw access proxy: "
            "a local kubectl port-forward plus a userspace Tailscale Serve daemon."
        )
    )
    parser.add_argument(
        "command",
        choices=("start", "status", "stop"),
        nargs="?",
        default="start",
    )
    parser.add_argument(
        "--state-dir",
        default="~/.local/state/openclaw-proxy",
        help="Base directory for pid files, logs, Tailscale socket, and state.",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    manager = OpenClawProxyManager(Path(args.state_dir))
    try:
        if args.command == "start":
            manager.start()
        elif args.command == "status":
            return manager.status()
        elif args.command == "stop":
            manager.stop()
        else:
            raise AssertionError(f"Unhandled command: {args.command}")
    except CommandError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
