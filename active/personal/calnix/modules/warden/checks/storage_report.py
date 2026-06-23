#!/usr/bin/env python3
"""
Warden check: storage-report

Reports each mount point's storage class (SSD/HDD/ARCHIVE), capacity,
free space, and usage. Provides both per-mount and summary views.

This check is the foundation for HomeCluster storage integration.

Configuration (optional):
  {
    "overrides": { "/mnt/hdd": "hdd" },
    "thresholds": { "warn": 85, "fail": 95 },
    "exclude_mounts": ["/boot"]
  }
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

# Add parent for warden module imports
WARDEN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, WARDEN_DIR)

CHECK_NAME = "storage-report"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def check_storage_report(config: dict[str, Any]) -> dict[str, Any]:
    """Run the storage report check.

    Returns structured data about each mount, including storage class,
    capacity, free space, and overall health status.
    """
    from homecluster.storage_class import classify_storage, format_storage_summary

    overrides = config.get("overrides", {})
    thresholds = config.get("thresholds", {"warn": 85, "fail": 95})
    exclude_mounts = set(config.get("exclude_mounts", []))
    warn_pct = thresholds.get("warn", 85)
    fail_pct = thresholds.get("fail", 95)

    mounts = classify_storage(overrides)

    # Filter excluded mounts
    mounts = [m for m in mounts if m.mount not in exclude_mounts]

    summary = format_storage_summary(mounts)

    # Determine overall status
    worst_status = "pass"
    messages: list[str] = []

    for m in mounts:
        if m.capacity_bytes == 0:
            continue
        used_pct = round((m.used_bytes / m.capacity_bytes) * 100, 1)
        if used_pct >= fail_pct:
            worst_status = "fail"
            messages.append(
                f"{m.mount} ({m.storage_class.value}) is at {used_pct}% "
                f"(threshold: {fail_pct}%)"
            )
        elif used_pct >= warn_pct and worst_status != "fail":
            worst_status = "warn"
            messages.append(
                f"{m.mount} ({m.storage_class.value}) is at {used_pct}% "
                f"(threshold: {warn_pct}%)"
            )

    # Add storage class summary to messages
    if not messages:
        by_class = summary.get("by_class", {})
        class_lines = []
        for cls in ("ssd", "hdd", "archive"):
            if cls in by_class:
                info = by_class[cls]
                free_gb = round(info["free_bytes"] / 1e9, 1)
                total_gb = round(info["capacity_bytes"] / 1e9, 1)
                class_lines.append(
                    f"{cls.upper()}: {free_gb}/{total_gb} GB free "
                    f"({info['count']} mount(s))"
                )
        if class_lines:
            messages.append("; ".join(class_lines))
        else:
            messages.append("All storage healthy")

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages),
        "data": {
            "summary": {
                "total_capacity_bytes": summary["total_capacity_bytes"],
                "total_free_bytes": summary["total_free_bytes"],
                "total_used_bytes": summary["total_used_bytes"],
                "total_used_pct": summary["total_used_pct"],
                "by_class": summary["by_class"],
            },
            "mounts": summary["mounts"],
            "thresholds": {"warn": warn_pct, "fail": fail_pct},
        },
    }


def main():
    config = get_config()
    result = check_storage_report(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
