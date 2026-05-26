#!/usr/bin/env python3
"""
Warden check: systemd-health

Reports failed or degraded systemd units.
Returns structured JSON with a list of failed units and overall system state.

Configuration (optional, from config.json):
  {
    "include_units": ["sshd.service", "tailscale.service"],
    "exclude_units": ["session-*.scope", "user@*.service"],
    "check_overall_state": true
  }
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

CHECK_NAME = "systemd-health"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def check_systemd_health(config: dict[str, Any]) -> dict[str, Any]:
    include_units = config.get("include_units", None)  # None = all
    check_overall = config.get("check_overall_state", True)

    failed_units: list[dict[str, Any]] = []
    overall_state = "unknown"
    worst_status = "pass"
    messages: list[str] = []

    # Check overall system state
    if check_overall:
        try:
            result = subprocess.run(
                ["systemctl", "is-system-running"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            overall_state = result.stdout.strip()
            if overall_state in ("degraded", "maintenance"):
                worst_status = "warn"
                messages.append(f"System state: {overall_state}")
            elif overall_state == "running":
                pass  # fine
            else:
                messages.append(f"System state: {overall_state}")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            messages.append("Cannot determine system state")

    # List failed units
    try:
        result = subprocess.run(
            ["systemctl", "list-units", "--state=failed", "--no-legend", "--no-pager"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) >= 4:
                unit_name = parts[0]
                load_state = parts[1]
                active_state = parts[2]
                sub_state = parts[3]

                failed_units.append({
                    "unit": unit_name,
                    "load": load_state,
                    "active": active_state,
                    "sub": sub_state,
                })

        if failed_units:
            worst_status = "fail"
            unit_names = [u["unit"] for u in failed_units]
            messages.append(f"Failed units: {', '.join(unit_names)}")

    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        messages.append(f"Cannot list units: {e}")

    if not messages:
        messages.append("All systemd units healthy")

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages),
        "data": {
            "overall_state": overall_state,
            "failed_units": failed_units,
            "total_failed": len(failed_units),
        },
    }


def main():
    config = get_config()
    result = check_systemd_health(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
