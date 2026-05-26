#!/usr/bin/env python3
"""
Warden check: temperature

Reports CPU and system temperatures using sensors/lm-sensors.
Returns structured JSON with per-sensor readings.

Configuration (optional, from config.json):
  {
    "thresholds": { "warn": 75, "fail": 85 },
    "sensor_chip": "coretemp-isa-0000"
  }
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

CHECK_NAME = "temperature"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def check_temperature(config: dict[str, Any]) -> dict[str, Any]:
    thresholds = config.get("thresholds", {"warn": 75, "fail": 85})
    warn_c = thresholds.get("warn", 75)
    fail_c = thresholds.get("fail", 85)

    sensors_data: dict[str, Any] = {}
    worst_temp = 0.0
    worst_sensor = ""
    worst_status = "pass"
    messages: list[str] = []

    # Try sensors -j first (JSON output)
    try:
        result = subprocess.run(
            ["sensors", "-j"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            parsed = json.loads(result.stdout)
            for chip, adapters in parsed.items():
                for adapter_key, adapter_value in adapters.items():
                    if isinstance(adapter_value, dict):
                        for key, value in adapter_value.items():
                            # Only collect *_input readings — skip *_max, *_crit, *_alarm, etc.
                            if isinstance(value, (int, float)) and key.endswith("_input"):
                                sensors_data[f"{chip}/{adapter_key}/{key}"] = value
                            elif isinstance(value, dict):
                                for sub_key, sub_value in value.items():
                                    if isinstance(sub_value, (int, float)) and sub_key.endswith("_input"):
                                        sensors_data[f"{chip}/{adapter_key}/{key}/{sub_key}"] = sub_value
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass

    # Fallback: try sensors plain text output
    if not sensors_data:
        try:
            result = subprocess.run(
                ["sensors"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            # Parse only temp inputs from text output
            for line in result.stdout.split("\n"):
                line = line.strip()
                if ":" in line and ("°C" in line or "C " in line):
                    parts = line.split(":")
                    if len(parts) == 2:
                        sensor_name = parts[0].strip()
                        temp_str = parts[1].strip().split("°")[0].split()[0]
                        try:
                            temp_val = float(temp_str)
                            sensors_data[sensor_name] = temp_val
                        except ValueError:
                            pass
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    if not sensors_data:
        return {
            "check": CHECK_NAME,
            "status": "warn",
            "message": "No temperature sensors found (install lm-sensors?)",
            "data": {},
        }

    # Filter out bogus readings (sensor initialization artifacts, etc.)
    # Valid temperature range: -40°C to 125°C (reasonable for consumer hardware)
    sane_sensors = {
        name: temp
        for name, temp in sensors_data.items()
        if -40 <= temp <= 125
    }

    if not sane_sensors:
        return {
            "check": CHECK_NAME,
            "status": "warn",
            "message": "All sensor readings are out of sane range (-40 to 125°C)",
            "data": {"raw_sensors": sensors_data},
        }

    # Find worst temperature among sane readings
    for sensor, temp in sane_sensors.items():
        if temp > worst_temp:
            worst_temp = temp
            worst_sensor = sensor

    if worst_temp >= fail_c:
        worst_status = "fail"
        messages.append(f"{worst_sensor}: {worst_temp:.1f}°C exceeds threshold ({fail_c}°C)")
    elif worst_temp >= warn_c:
        worst_status = "warn"
        messages.append(f"{worst_sensor}: {worst_temp:.1f}°C exceeds warning ({warn_c}°C)")
    else:
        messages.append(f"Temperatures healthy (max: {worst_temp:.1f}°C)")

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages),
        "data": {
            "sensors": sensors_data,
            "max_temp_c": worst_temp,
            "max_sensor": worst_sensor,
            "thresholds": {"warn_c": warn_c, "fail_c": fail_c},
        },
    }


def main():
    config = get_config()
    result = check_temperature(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
