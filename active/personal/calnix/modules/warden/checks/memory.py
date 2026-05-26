#!/usr/bin/env python3
"""
Warden check: memory

Reports system memory usage with configurable thresholds.
Returns structured JSON.

Configuration (optional, from config.json):
  {
    "thresholds": { "warn": 80, "fail": 95 },
    "include_swap": true,
    "swap_thresholds": { "warn": 50, "fail": 80 }
  }
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

CHECK_NAME = "memory"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def parse_meminfo() -> dict[str, int]:
    """Parse /proc/meminfo into a dict of key → kB."""
    result: dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    key = parts[0].strip()
                    value_str = parts[1].strip().split()[0] if parts[1].strip() else "0"
                    try:
                        result[key] = int(value_str)
                    except ValueError:
                        result[key] = 0
    except OSError as e:
        return {}
    return result


def check_memory(config: dict[str, Any]) -> dict[str, Any]:
    thresholds = config.get("thresholds", {"warn": 80, "fail": 95})
    include_swap = config.get("include_swap", True)
    swap_thresholds = config.get("swap_thresholds", {"warn": 50, "fail": 80})

    warn_pct = thresholds.get("warn", 80)
    fail_pct = thresholds.get("fail", 95)
    swap_warn = swap_thresholds.get("warn", 50)
    swap_fail = swap_thresholds.get("fail", 80)

    meminfo = parse_meminfo()
    if not meminfo:
        return {
            "check": CHECK_NAME,
            "status": "fail",
            "message": "Cannot read /proc/meminfo",
            "data": {},
        }

    total = meminfo.get("MemTotal", 0)
    available = meminfo.get("MemAvailable", 0)
    free = meminfo.get("MemFree", 0)
    buffers = meminfo.get("Buffers", 0)
    cached = meminfo.get("Cached", 0)

    # Calculate actual used percentage
    if total > 0:
        used_pct = round((1 - available / total) * 100, 1)
    else:
        used_pct = 0

    swap_total = meminfo.get("SwapTotal", 0)
    swap_free = meminfo.get("SwapFree", 0)
    swap_used_pct = 0
    if swap_total > 0:
        swap_used_pct = round((1 - swap_free / swap_total) * 100, 1)

    # Determine status
    messages: list[str] = []
    worst_status = "pass"

    if used_pct >= fail_pct:
        worst_status = "fail"
        messages.append(f"RAM at {used_pct}% (threshold: {fail_pct}%)")
    elif used_pct >= warn_pct:
        worst_status = "warn"
        messages.append(f"RAM at {used_pct}% (threshold: {warn_pct}%)")

    if include_swap and swap_total > 0:
        if swap_used_pct >= swap_fail:
            if worst_status != "fail":
                worst_status = "fail"
            messages.append(f"Swap at {swap_used_pct}% (threshold: {swap_fail}%)")
        elif swap_used_pct >= swap_warn and worst_status != "fail":
            if worst_status != "fail":
                worst_status = "warn"
            messages.append(f"Swap at {swap_used_pct}% (threshold: {swap_warn}%)")

    if not messages:
        messages.append("Memory healthy")

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages),
        "data": {
            "ram": {
                "total_kb": total,
                "available_kb": available,
                "free_kb": free,
                "buffers_kb": buffers,
                "cached_kb": cached,
                "used_pct": used_pct,
            },
            "swap": {
                "total_kb": swap_total,
                "free_kb": swap_free,
                "used_pct": swap_used_pct,
            } if include_swap else None,
            "thresholds": {
                "ram_warn": warn_pct,
                "ram_fail": fail_pct,
            },
        },
    }


def main():
    config = get_config()
    result = check_memory(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
