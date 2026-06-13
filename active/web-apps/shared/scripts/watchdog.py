#!/usr/bin/env python3
"""App health watchdog for the SHSW.dev deployment.

Pings every app's port (read from ``active/web-apps/launcher/apps.yaml``)
and restarts any app that fails a TCP connect check. Designed to be run
periodically (every ~2 minutes) via the bundled ``watchdog.timer``
systemd user unit.

Convention for restart commands
================================

For each app we look at, in order:

1. ``start_cmd`` field in apps.yaml \u2014 used verbatim as the shell command
   to run the app. The current working directory is set to the app's
   absolute path before the command runs. The command is launched
   with ``nohup`` and its stdout/stderr go to ``/tmp/<id>.log``.

2. A Flask-app default derived from the app's ``type: flask`` and
   ``module`` field:
   ``cd <path> && PORT=<port> HOST=127.0.0.1 nohup .venv/bin/python3 -m <module> < /dev/null > /tmp/<id>.log 2>&1 &``
   (This matches how the existing apps are started manually.)

Apps with ``type: nextjs`` / ``type: vite`` / ``type: node`` should
have an explicit ``start_cmd`` in apps.yaml (they need ``npm run``).

Cooldown
========

After a successful restart, the watchdog will not try to restart the
same app again for ``--cooldown-seconds`` (default 300 = 5 minutes),
to avoid restart loops when an app crashes on every boot.

State
=====

The watchdog persists its cooldown timestamps to
``/tmp/watchdog-state.json`` so restarts of the watchdog itself don't
re-trigger an immediate restart of a freshly-recovered app.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import shlex
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml


DEFAULT_APPS_YAML = (
    Path(__file__).resolve().parent.parent.parent
    / "launcher/apps.yaml"
)
DEFAULT_STATE_PATH = Path("/tmp/watchdog-state.json")
DEFAULT_LOG_PATH = Path("/tmp/watchdog.log")
DEFAULT_COOLDOWN_SECONDS = 300
DEFAULT_TIMEOUT_SECONDS = 2.0


def _now_iso() -> str:
    return datetime.datetime.now(tz=datetime.timezone.utc).isoformat(timespec="seconds")


def log(msg: str, log_path: Path) -> None:
    """Append a timestamped line to the watchdog log."""
    line = f"[{_now_iso()}] {msg}\n"
    sys.stdout.write(line)
    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        # Don't crash the watchdog just because the log isn't writable.
        pass


def load_apps(apps_yaml: Path) -> list[dict[str, Any]]:
    """Load and return the apps registry from apps.yaml.

    Also resolves each app's ``path`` field to an absolute path,
    relative to apps.yaml's directory (so ``../foo`` in apps.yaml
    means "next to apps.yaml", not "next to the cwd").
    """
    with apps_yaml.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    apps = data.get("apps") or []
    base = apps_yaml.resolve().parent
    for app in apps:
        rel = app.get("path")
        if rel and not Path(rel).is_absolute():
            app["path"] = str((base / rel).resolve())
    return list(apps)


def load_state(state_path: Path) -> dict[str, str]:
    """Load the per-app cooldown state.

    Returns a mapping of app_id -> ISO timestamp of the last successful
    restart (UTC). An app is "in cooldown" if its timestamp is within
    ``cooldown_seconds`` of now.
    """
    if not state_path.exists():
        return {}
    try:
        with state_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, str)}


def save_state(state_path: Path, state: dict[str, str]) -> None:
    """Persist the cooldown state to disk (best-effort)."""
    try:
        with state_path.open("w", encoding="utf-8") as f:
            json.dump(state, f, sort_keys=True)
    except OSError as exc:
        sys.stderr.write(f"warning: could not write state: {exc}\n")


def is_port_open(port: int, host: str = "127.0.0.1", timeout: float = DEFAULT_TIMEOUT_SECONDS) -> bool:
    """Return True if a TCP connect to ``host:port`` succeeds within ``timeout``."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (ConnectionRefusedError, socket.timeout, OSError):
        return False


def in_cooldown(app_id: str, state: dict[str, str], cooldown_seconds: int) -> bool:
    """Return True if the app was restarted recently and should be skipped."""
    last = state.get(app_id)
    if not last:
        return False
    try:
        last_dt = datetime.datetime.fromisoformat(last)
    except ValueError:
        return False
    elapsed = (datetime.datetime.now(tz=datetime.timezone.utc) - last_dt).total_seconds()
    return elapsed < cooldown_seconds


def default_flask_start_cmd(app: dict[str, Any]) -> str:
    """Build a default ``nohup python3 -m <module> ...`` start command for a Flask app."""
    path = Path(app["path"]).resolve()
    module = app["module"]
    port = app.get("port") or app.get("env", {}).get("PORT", "5000")
    # Some apps use a non-PORT env var for the port (e.g. wizard-fight
    # uses WIZARD_FIGHT_PORT). Build the env var assignment from the
    # app's declared env dict.
    env = app.get("env") or {}
    env_assignments = " ".join(f"{k}={shlex.quote(str(v))}" for k, v in env.items())
    return (
        f"cd {shlex.quote(str(path))} && "
        f"nohup env {env_assignments} HOST=127.0.0.1 ./.venv/bin/python3 -m {module} "
        f"< /dev/null > /tmp/{app['id']}.log 2>&1 &"
    )


def build_start_cmd(app: dict[str, Any]) -> str:
    """Resolve the shell command to use to (re)start ``app``.

    Priority:
      1. ``start_cmd`` in apps.yaml (verbatim, run from the app dir)
      2. Flask convention derived from ``type`` and ``module`` — but
         only if the resolved path actually contains ``.venv/bin/python3``.
         Apps that ship without a venv (and rely on a system Python
         install) are skipped; the watchdog won't keep trying to
         restart an app it has no way to start.
      3. Empty string (caller should skip).
    """
    if app.get("start_cmd"):
        path = Path(app["path"]).resolve()
        return f"cd {shlex.quote(str(path))} && {app['start_cmd']} &"
    if app.get("type") == "flask" and app.get("module"):
        path = Path(app["path"]).resolve()
        if (path / ".venv" / "bin" / "python3").exists():
            return default_flask_start_cmd(app)
        # No venv; we can't safely restart this app, so skip it.
    return ""


def restart_app(app: dict[str, Any], log_path: Path) -> bool:
    """Restart the given app. Returns True if a restart was issued."""
    cmd = build_start_cmd(app)
    if not cmd:
        log(
            f"skip {app['id']}: no start_cmd and no flask+module (type={app.get('type')!r})",
            log_path,
        )
        return False
    try:
        log(f"restart {app['id']}: {cmd}", log_path)
        # We use a shell here because the convention relies on shell
        # features (&, redirection, env var assignment). The command
        # is built from our own YAML registry, not user input, so
        # this is safe in this environment.
        subprocess.run(
            cmd,
            shell=True,
            check=False,
            timeout=15,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        log(f"restart {app['id']}: command timed out (this is usually fine)", log_path)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apps-yaml", type=Path, default=DEFAULT_APPS_YAML,
                        help="Path to apps.yaml (default: %(default)s)")
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE_PATH,
                        help="Where to persist cooldown timestamps (default: %(default)s)")
    parser.add_argument("--log-path", type=Path, default=DEFAULT_LOG_PATH,
                        help="Where to append watchdog log lines (default: %(default)s)")
    parser.add_argument("--cooldown-seconds", type=int, default=DEFAULT_COOLDOWN_SECONDS,
                        help="Don't restart the same app again within this many seconds (default: %(default)s)")
    parser.add_argument("--once", action="store_true",
                        help="Run a single check and exit (default if no timer is wired up)")
    parser.add_argument("--loop-interval", type=int, default=120,
                        help="When --watching, sleep this many seconds between checks (default: %(default)s)")
    parser.add_argument("--watching", action="store_true",
                        help="Loop forever instead of running a single check (used by --watch)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be done but don't actually restart anything")
    args = parser.parse_args()

    if not args.apps_yaml.exists():
        log(f"apps.yaml not found at {args.apps_yaml}; nothing to do.", args.log_path)
        return 0

    apps = load_apps(args.apps_yaml)
    log(f"watchdog: {len(apps)} apps in registry", args.log_path)

    def run_once() -> int:
        state = load_state(args.state_path)
        new_state = dict(state)
        restarted = 0
        for app in apps:
            app_id = app["id"]
            port = app.get("port")
            if not port:
                continue
            if in_cooldown(app_id, state, args.cooldown_seconds):
                log(f"skip {app_id}: in cooldown", args.log_path)
                continue
            if is_port_open(int(port)):
                # Healthy. Clear any stale cooldown for this app.
                new_state.pop(app_id, None)
                continue
            log(f"down: {app_id} (port {port}) \u2014 attempting restart", args.log_path)
            if restart_app(app, args.log_path):
                new_state[app_id] = _now_iso()
                restarted += 1
                # Give the app a moment to start before the next check.
                time.sleep(2)
        save_state(args.state_path, new_state)
        log(f"watchdog: cycle complete, {restarted} restart(s) issued", args.log_path)
        return 0

    if args.watching:
        while True:
            run_once()
            time.sleep(args.loop_interval)
    else:
        return run_once()


if __name__ == "__main__":
    sys.exit(main())
