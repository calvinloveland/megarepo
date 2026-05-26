"""
Warden state management — persistent per-host state for health checks,
backup metadata, peer status, and remediation history.

Inherits patterns from calnix_state.py but is self-contained so the Warden
doesn't depend on the calnix CLI package.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

STATE_VERSION = 1
DEFAULT_STATE_DIR = Path(os.environ.get("WARDEN_STATE_DIR", "/var/lib/warden"))
STATE_FILE = "state.json"
EVENT_LOG = "events.log"
CHECKS_DIR = "checks"
PEERS_DIR = "peers"
CONFIG_FILE = "config.json"
IDENTITY_FILE = "identity.key"


class WardenStateError(RuntimeError):
    """Raised when Warden state operations fail."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── State directory helpers ──────────────────────────────────────────


def resolve_state_dir(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return Path(state_dir) if state_dir else DEFAULT_STATE_DIR


def ensure_state_layout(state_dir: str | os.PathLike[str] | None = None) -> Path:
    root = resolve_state_dir(state_dir)
    root.mkdir(parents=True, exist_ok=True)
    (root / CHECKS_DIR).mkdir(exist_ok=True)
    (root / PEERS_DIR).mkdir(exist_ok=True)
    return root


def state_file_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / STATE_FILE


def event_log_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / EVENT_LOG


def checks_dir_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / CHECKS_DIR


def peers_dir_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / PEERS_DIR


def config_file_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / CONFIG_FILE


def identity_file_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / IDENTITY_FILE


# ── Identity ─────────────────────────────────────────────────────────


def get_or_create_host_id(state_dir: str | os.PathLike[str] | None = None) -> str:
    """Get the machine identity. Creates a UUID on first call.

    The identity persists across reboots and is used for peer authentication.
    """
    path = identity_file_path(state_dir)
    ensure_state_layout(state_dir)
    if path.exists():
        return path.read_text().strip()
    import uuid

    host_id = str(uuid.uuid4())
    path.write_text(host_id + "\n")
    return host_id


def get_hostname() -> str:
    """Get the NixOS hostname or fall back to kernel hostname."""
    try:
        result = subprocess.run(
            ["hostname"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return platform.node() or "unknown"


# ── State read/write ─────────────────────────────────────────────────


def default_state() -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "hostname": get_hostname(),
        "host_id": "",
        "last_boot": "",
        "warden_started": utc_now(),
        "warden_version": STATE_VERSION,
        "checks": {},
        "remediation_history": [],
        "generation": {},
        "backups": {},
        "peers": {},
    }


def load_state(state_dir: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    path = state_file_path(state_dir)
    if not path.exists():
        state = default_state()
        state["host_id"] = get_or_create_host_id(state_dir)
        return state
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        state = default_state()
        state["host_id"] = get_or_create_host_id(state_dir)
        return state
    data.setdefault("version", STATE_VERSION)
    data.setdefault("hostname", get_hostname())
    data.setdefault("host_id", get_or_create_host_id(state_dir))
    data.setdefault("warden_version", STATE_VERSION)
    data.setdefault("checks", {})
    data.setdefault("remediation_history", [])
    data.setdefault("generation", {})
    data.setdefault("backups", {})
    data.setdefault("peers", {})
    return data


def save_state(
    payload: dict[str, Any],
    state_dir: str | os.PathLike[str] | None = None,
) -> Path:
    ensure_state_layout(state_dir)
    payload["warden_started"] = payload.get("warden_started", utc_now())
    path = state_file_path(state_dir)
    atomic_write_json(path, payload)
    return path


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temp_name = handle.name
    os.replace(temp_name, path)


# ── Event log ────────────────────────────────────────────────────────


def append_event(
    event: dict[str, Any],
    state_dir: str | os.PathLike[str] | None = None,
) -> None:
    """Append a structured event to the append-only event log."""
    event.setdefault("timestamp", utc_now())
    log_path = event_log_path(state_dir)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, default=str) + "\n")


def read_events(
    tail: int = 0,
    state_dir: str | os.PathLike[str] | None = None,
    after_timestamp: str | None = None,
    event_type: str | None = None,
) -> list[dict[str, Any]]:
    """Read events from the event log.

    Args:
        tail: If > 0, return only the last N events.
        after_timestamp: Return only events after this ISO timestamp.
        event_type: Filter by event type (e.g., "check", "remediation").
    """
    log_path = event_log_path(state_dir)
    if not log_path.exists():
        return []

    events: list[dict[str, Any]] = []
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if after_timestamp and event.get("timestamp", "") <= after_timestamp:
                continue
            if event_type and event.get("type") != event_type:
                continue
            events.append(event)

    if tail > 0:
        events = events[-tail:]
    return events


def follow_events(
    state_dir: str | os.PathLike[str] | None = None,
):
    """Generator that yields new events as they are appended (like tail -f).

    Yields parsed event dicts. Blocks on read() waiting for new data.
    """
    log_path = event_log_path(state_dir)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    with open(log_path, "r", encoding="utf-8") as f:
        # Seek to end on first call
        f.seek(0, 2)

        while True:
            line = f.readline()
            if not line:
                try:
                    import time
                    time.sleep(0.5)
                except KeyboardInterrupt:
                    break
                continue
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


# ── Check results ────────────────────────────────────────────────────


def save_check_result(
    check_name: str,
    result: dict[str, Any],
    state_dir: str | os.PathLike[str] | None = None,
) -> None:
    """Save a check result to the state file and append to the per-check log."""
    state = load_state(state_dir)
    state.setdefault("checks", {})
    state["checks"][check_name] = {
        "status": result.get("status", "unknown"),
        "last_run": result.get("timestamp", utc_now()),
        "message": result.get("message", ""),
        "data": result.get("data", {}),
    }
    save_state(state, state_dir)

    # Append to per-check history
    check_log = checks_dir_path(state_dir) / f"{check_name}.jsonl"
    with open(check_log, "a", encoding="utf-8") as f:
        f.write(json.dumps(result, default=str) + "\n")

    # Append to unified event log
    append_event({
        "type": "check",
        "check": check_name,
        "status": result.get("status"),
        "message": result.get("message", ""),
        "data": result.get("data", {}),
    }, state_dir)


def load_check_history(
    check_name: str,
    tail: int = 10,
    state_dir: str | os.PathLike[str] | None = None,
) -> list[dict[str, Any]]:
    """Load recent check results from the per-check log."""
    check_log = checks_dir_path(state_dir) / f"{check_name}.jsonl"
    if not check_log.exists():
        return []
    results: list[dict[str, Any]] = []
    with open(check_log, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if tail > 0:
        results = results[-tail:]
    return results


# ── Peer cache ───────────────────────────────────────────────────────


def save_peer_status(
    peer_name: str,
    status: dict[str, Any],
    state_dir: str | os.PathLike[str] | None = None,
) -> None:
    """Cache the last-known status of a peer Warden."""
    peer_file = peers_dir_path(state_dir) / f"{peer_name}.json"
    atomic_write_json(peer_file, status)

    state = load_state(state_dir)
    state.setdefault("peers", {})
    state["peers"][peer_name] = {
        "last_seen": status.get("timestamp", utc_now()),
        "status": status.get("status", "unknown"),
        "summary": status.get("summary", ""),
    }
    save_state(state, state_dir)


def load_peer_status(
    peer_name: str,
    state_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any] | None:
    """Load cached peer status."""
    peer_file = peers_dir_path(state_dir) / f"{peer_name}.json"
    if not peer_file.exists():
        return None
    try:
        return json.loads(peer_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def list_peers(
    state_dir: str | os.PathLike[str] | None = None,
) -> list[str]:
    """List known peer names from the cache directory."""
    peer_dir = peers_dir_path(state_dir)
    if not peer_dir.exists():
        return []
    return sorted(p.stem for p in peer_dir.iterdir() if p.suffix == ".json")


# ── Config ───────────────────────────────────────────────────────────


def load_config(
    state_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Load local config overrides. Returns empty dict if none exist."""
    path = config_file_path(state_dir)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def save_config(
    config: dict[str, Any],
    state_dir: str | os.PathLike[str] | None = None,
) -> None:
    """Save local config overrides."""
    path = config_file_path(state_dir)
    atomic_write_json(path, config)
    append_event({
        "type": "config",
        "action": "update",
        "config": config,
    }, state_dir)


# ── Last boot detection ──────────────────────────────────────────────


def detect_last_boot() -> str:
    """Read last boot time from /proc/uptime or who -b."""
    try:
        result = subprocess.run(
            ["who", "-b"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            # Format: "         system boot  2026-05-25 08:00"
            parts = result.stdout.strip().split()
            if len(parts) >= 3:
                return f"{parts[2]}T{parts[3]}"
    except Exception:
        pass
    return utc_now()
