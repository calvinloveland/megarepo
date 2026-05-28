#!/usr/bin/env python3
"""
Warden check: system-config

Detects whether the NixOS system configuration has been modified since the
last rebuild. Compares file mtimes of /etc/nixos/*.nix against the running
system's build time.

Returns:
  - pass: system is up-to-date (no config changes since rebuild)
  - warn: config changed but within a reasonable window (< 7 days)
  - fail: config changed > 7 days ago without rebuild

Configuration (optional, from config.json):
  {
    "thresholds": { "warn_days": 1, "fail_days": 7 },
    "config_paths": ["/etc/nixos"],
    "check_nix_channel": true
  }
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CHECK_NAME = "system-config"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def _get_running_system_build_time() -> float | None:
    """Get the build time of the running NixOS system derivation.

    Nix store paths have mtime=1 for reproducibility, so we parse the
    version string (e.g. '26.05.20260515.d233902') for the date."""
    try:
        result = subprocess.run(
            ["nixos-version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            version_str = result.stdout.strip()
            # Format: "26.05.20260515.d233902 (Vicuna)"
            # Extract the date portion: YYYYMMDD
            parts = version_str.split()
            for part in parts:
                # Look for something like 26.05.20260515.d233902
                dot_parts = part.split(".")
                for dp in dot_parts:
                    if len(dp) == 8 and dp.isdigit() and dp.startswith("20"):
                        # Looks like a date: YYYYMMDD
                        from datetime import datetime, timezone
                        dt = datetime.strptime(dp, "%Y%m%d").replace(tzinfo=timezone.utc)
                        return dt.timestamp()
    except Exception:
        pass

    # Fallback: stat /run/booted-system (a GC root)
    try:
        booted = os.readlink("/run/booted-system")
        if booted:
            # This is a GC root created at boot time, not the actual build time
            pass
    except Exception:
        pass

    return None


def _get_latest_config_mtime(config_paths: list[str]) -> tuple[float | None, list[dict[str, Any]]]:
    """Find the most recent mtime among all .nix files in config_paths."""
    latest_mtime: float | None = None
    changed_files: list[dict[str, Any]] = []

    for config_path_str in config_paths:
        config_dir = Path(config_path_str)
        if not config_dir.exists():
            continue
        for nix_file in config_dir.rglob("*.nix"):
            try:
                mtime = nix_file.stat().st_mtime
                if latest_mtime is None or mtime > latest_mtime:
                    latest_mtime = mtime
                changed_files.append({
                    "path": str(nix_file),
                    "mtime": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
                })
            except OSError:
                continue

    # Sort by mtime descending
    changed_files.sort(key=lambda f: f["mtime"], reverse=True)
    return latest_mtime, changed_files


def _check_nix_channel() -> dict[str, Any]:
    """Check if nix channel is configured."""
    channel_info: dict[str, Any] = {"configured": False, "channels": []}
    try:
        # Use absolute paths — the warden service has a minimal PATH
        import shutil
        nix_channel = shutil.which("nix-channel") or "/run/current-system/sw/bin/nix-channel"
        nix = shutil.which("nix") or "/run/current-system/sw/bin/nix"

        # Try nix-channel first (legacy channels)
        result = subprocess.run(
            [nix_channel, "--list"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if line:
                    parts = line.split()
                    if len(parts) >= 2:
                        channel_info["channels"].append({"name": parts[0], "url": parts[1]})
            channel_info["configured"] = len(channel_info["channels"]) > 0

        # If no channels found, check if this is a flake-based setup
        if not channel_info["configured"]:
            try:
                # Just check if the nix command exists and works
                result = subprocess.run(
                    [nix, "--version"],
                    capture_output=True, text=True, timeout=10,
                )
                if result.returncode == 0 and "nix" in result.stdout.lower():
                    channel_info["configured"] = True
                    channel_info["using_flakes"] = True
                    channel_info["message"] = "Using flakes (nix command available)"
            except Exception:
                pass
    except Exception:
        pass

    # Check NIX_PATH
    nix_path = os.environ.get("NIX_PATH", "")
    channel_info["nix_path"] = nix_path
    # Verify the nix_path actually resolves to something usable
    has_valid_nix_path = False
    if nix_path and "nixpkgs=" in nix_path:
        # Extract the path part from nixpkgs=...
        for segment in nix_path.split(":"):
            if segment.startswith("nixpkgs="):
                path_part = segment.split("=", 1)[1]
                # Remove flake: prefix if present
                if path_part.startswith("flake:"):
                    path_part = path_part[len("flake:"):]
                if Path(path_part).exists():
                    has_valid_nix_path = True
                    break
    channel_info["has_nix_path"] = has_valid_nix_path

    return channel_info


def check_system_config(config: dict[str, Any]) -> dict[str, Any]:
    thresholds = config.get("thresholds", {"warn_days": 1, "fail_days": 7})
    config_paths = config.get("config_paths", [
        "/etc/nixos",
        # Flake-based setups — common source tree paths
        "/home/calvin/calnix",
        "/home/calvin/megarepo/active/personal/calnix",
    ])
    check_channel = config.get("check_nix_channel", True)

    warn_secs = thresholds.get("warn_days", 1) * 86400
    fail_secs = thresholds.get("fail_days", 7) * 86400

    messages: list[str] = []
    data: dict[str, Any] = {}

    # Get running system build time
    system_build_time = _get_running_system_build_time()
    if system_build_time is not None:
        build_dt = datetime.fromtimestamp(system_build_time, tz=timezone.utc)
        data["system_build_time"] = build_dt.isoformat()
    else:
        data["system_build_time"] = None
        messages.append("Could not determine running system build time")

    # Get latest config mtime
    latest_config_mtime, changed_files = _get_latest_config_mtime(config_paths)
    data["config_files"] = changed_files[:20]  # Top 20 most recently changed
    if latest_config_mtime is not None:
        data["latest_config_mtime"] = datetime.fromtimestamp(
            latest_config_mtime, tz=timezone.utc
        ).isoformat()
    else:
        data["latest_config_mtime"] = None

    # Check Nix channel
    if check_channel:
        channel_info = _check_nix_channel()
        data["nix_channel"] = channel_info

    # Determine if rebuild is needed
    worst_status = "pass"

    if system_build_time is not None and latest_config_mtime is not None:
        age_diff_secs = latest_config_mtime - system_build_time

        if age_diff_secs > 0:
            # Config is newer than the running system
            age_days = age_diff_secs / 86400
            data["config_newer_by_secs"] = age_diff_secs
            data["config_newer_by_days"] = round(age_days, 2)

            # Show which files changed
            newer_files = [f for f in changed_files[:5] if f["path"] not in ("/etc/nixos/hardware-configuration.nix",)]
            data["newer_files"] = newer_files

            if age_diff_secs > fail_secs:
                worst_status = "fail"
                messages.append(
                    f"System config is {age_days:.1f} days newer than running system "
                    f"(threshold: {fail_secs / 86400:.0f} days) — rebuild required"
                )
            elif age_diff_secs > warn_secs:
                worst_status = "warn"
                messages.append(
                    f"System config is {age_days:.1f} days newer than running system "
                    f"(threshold: {warn_secs / 86400:.0f} days) — rebuild recommended"
                )
            else:
                # Very recent change — just note it
                messages.append(
                    f"System config modified {age_days:.2f} days ago — "
                    f"may need rebuild soon"
                )
                worst_status = "warn"

            if newer_files:
                file_list = ", ".join(
                    os.path.basename(f["path"]) for f in newer_files
                )
                messages.append(f"Changed files: {file_list}")
        else:
            messages.append("System configuration is up-to-date")

    # Also flag if Nix channel is missing (can't rebuild without it)
    if check_channel:
        channel_info = data.get("nix_channel", {})
        if not channel_info.get("configured") and not channel_info.get("has_nix_path"):
            worst_status = "fail" if worst_status != "pass" else "warn"
            messages.append(
                "No Nix channel configured — nixos-rebuild will fail. "
                "Run: sudo nix-channel --add https://nixos.org/channels/nixos-unstable nixos"
            )

    if not messages:
        messages.append("System is up-to-date")

    # Get current generation info for reporting
    try:
        result = subprocess.run(
            ["nixos-version", "--json"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            version_info = json.loads(result.stdout)
            data["nixos_version"] = version_info.get("nixosVersion", "unknown")
            data["configuration_revision"] = version_info.get("configurationRevision", "unknown")
    except Exception:
        data["nixos_version"] = "unknown"

    return {
        "check": CHECK_NAME,
        "status": worst_status,
        "message": "; ".join(messages),
        "data": data,
    }


def main():
    config = get_config()
    result = check_system_config(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
