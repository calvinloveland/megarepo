#!/usr/bin/env python3
"""
Warden check: cross-host-disks

Queries all configured peer Wardens for their disk-usage status via HTTP.
Reports which peers are under disk pressure and identifies candidates
for cross-host data migration.

Designed to run on the coordinator host (haswell) which has spare storage.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from typing import Any

CHECK_NAME = "cross-host-disks"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def _load_peers_from_config() -> dict[str, dict[str, Any]]:
    for attempt in ["/etc/warden/config.json"]:
        try:
            with open(attempt) as f:
                cfg = json.load(f)
                return cfg.get("peers", {})
        except (OSError, json.JSONDecodeError):
            continue
    return {}


def _query_peer_disk(host: str, port: int = 9090) -> dict[str, Any] | None:
    """Query a peer's disk-usage check via wardend."""
    url = f"http://{host}:{port}/warden/check/disk-usage"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def check_cross_host_disks(config: dict[str, Any]) -> dict[str, Any]:
    thresholds = config.get("thresholds", {"warn": 80, "fail": 90})
    warn_pct = thresholds.get("warn", 80)
    fail_pct = thresholds.get("fail", 90)
    migration_root = config.get("migration_root", "/data/migrated")

    peers = _load_peers_from_config()
    if not peers:
        return {
            "check": CHECK_NAME,
            "status": "warn",
            "message": "No peers configured",
            "data": {"peers": {}, "at_risk": [], "migration_root": migration_root},
        }

    results: dict[str, Any] = {}
    at_risk: list[dict[str, Any]] = []
    worst_status = "pass"
    messages: list[str] = []

    for peer_name, peer_cfg in peers.items():
        host = peer_cfg.get("host", peer_name)
        port = peer_cfg.get("port", 9090)

        peer_result = _query_peer_disk(host, port)
        if peer_result is None:
            results[peer_name] = {"status": "unreachable", "error": "Cannot query peer"}
            worst_status = "warn"
            messages.append(f"{peer_name}: unreachable")
            continue

        # Extract disk-usage data from the peer response
        # Format: {"check": "disk-usage", "result": {"status": ..., "data": {"filesystems": [...]}}}
        disk_data = peer_result.get("result", peer_result)
        peer_status = disk_data.get("status", "unknown")
        fs_list = disk_data.get("data", {}).get("filesystems", [])

        peer_disks: list[dict[str, Any]] = []
        peer_worst_pct = 0.0
        peer_worst_mount = ""

        for fs in fs_list:
            mount = fs.get("mount", "?")
            used_pct = fs.get("used_pct", 0)
            peer_disks.append({"mount": mount, "used_pct": used_pct})
            if used_pct > peer_worst_pct:
                peer_worst_pct = used_pct
                peer_worst_mount = mount

        results[peer_name] = {
            "status": peer_status,
            "disks": peer_disks,
            "worst_pct": peer_worst_pct,
            "worst_mount": peer_worst_mount,
        }

        if peer_worst_pct >= fail_pct:
            worst_status = "fail"
            at_risk.append({
                "peer": peer_name,
                "host": host,
                "mount": peer_worst_mount,
                "used_pct": peer_worst_pct,
                "severity": "critical",
            })
            messages.append(
                f"{peer_name}: {peer_worst_mount} at {peer_worst_pct:.0f}% — CRITICAL"
            )
        elif peer_worst_pct >= warn_pct:
            if worst_status != "fail":
                worst_status = "warn"
            at_risk.append({
                "peer": peer_name,
                "host": host,
                "mount": peer_worst_mount,
                "used_pct": peer_worst_pct,
                "severity": "warning",
            })
            messages.append(
                f"{peer_name}: {peer_worst_mount} at {peer_worst_pct:.0f}% — WARNING"
            )

    if not messages:
        messages.append("All peer disks healthy")

    # Check if local migration root is available
    migration_available = os.path.isdir(migration_root) if migration_root else False
    if not migration_available and at_risk:
        messages.append(f"Migration root {migration_root} not available on this host")

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages),
        "data": {
            "peers": results,
            "at_risk": at_risk,
            "migration_root": migration_root,
            "migration_available": migration_available,
            "thresholds": {"warn": warn_pct, "fail": fail_pct},
        },
    }


def main():
    config = get_config()
    result = check_cross_host_disks(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
