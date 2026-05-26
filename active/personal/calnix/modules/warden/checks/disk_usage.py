#!/usr/bin/env python3
"""
Warden check: disk-usage

Reports filesystem disk usage with configurable thresholds.
Returns structured JSON.

Configuration (optional, from config.json):
  {
    "thresholds": { "warn": 80, "fail": 95 },
    "exclude": ["/boot", "/nix/store"],
    "include_fs_types": ["ext4", "btrfs", "xfs", "zfs"]
  }
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

CHECK_NAME = "disk-usage"


def get_config() -> dict[str, Any]:
    """Load check-specific config from env or return defaults."""
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def check_disk_usage(config: dict[str, Any]) -> dict[str, Any]:
    thresholds = config.get("thresholds", {"warn": 80, "fail": 95})
    exclude = set(config.get("exclude", ["/boot"]))
    include_fs_types = config.get("include_fs_types", ["ext4", "btrfs", "xfs", "zfs"])

    warn_pct = thresholds.get("warn", 80)
    fail_pct = thresholds.get("fail", 95)

    filesystems: list[dict[str, Any]] = []
    worst_status = "pass"
    messages: list[str] = []

    for part in shutil.disk_usage("/"):
        # shutil.disk_usage takes a path, iterate over mounted filesystems via os.statvfs
        pass

    # Use df to get per-filesystem data
    try:
        import subprocess

        result = subprocess.run(
            ["df", "-P"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")[1:]  # skip header
            for line in lines:
                parts = line.split()
                if len(parts) < 6:
                    continue
                fs = parts[0]
                size_kb = int(parts[1])
                used_kb = int(parts[2])
                avail_kb = int(parts[3])
                use_pct_str = parts[4].rstrip("%")
                mount = parts[5]

                # Skip excluded mounts
                if mount in exclude:
                    continue

                # Skip pseudo filesystems
                if mount.startswith("/sys") or mount.startswith("/proc") or mount.startswith("/dev"):
                    continue

                if size_kb == 0:
                    continue

                use_pct = float(use_pct_str)
                entry = {
                    "filesystem": fs,
                    "mount": mount,
                    "size_bytes": size_kb * 1024,
                    "used_bytes": used_kb * 1024,
                    "available_bytes": avail_kb * 1024,
                    "used_pct": use_pct,
                }
                filesystems.append(entry)

                if use_pct >= fail_pct:
                    worst_status = "fail"
                    messages.append(f"{mount} is at {use_pct:.0f}% (threshold: {fail_pct}%)")
                elif use_pct >= warn_pct and worst_status != "fail":
                    worst_status = "warn"
                    messages.append(f"{mount} is at {use_pct:.0f}% (threshold: {warn_pct}%)")
    except Exception as e:
        return {
            "check": CHECK_NAME,
            "status": "fail",
            "message": f"Failed to read disk usage: {e}",
            "data": {},
        }

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages) if messages else "All filesystems healthy",
        "data": {
            "filesystems": filesystems,
            "thresholds": {"warn": warn_pct, "fail": fail_pct},
        },
    }


def main():
    config = get_config()
    result = check_disk_usage(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
