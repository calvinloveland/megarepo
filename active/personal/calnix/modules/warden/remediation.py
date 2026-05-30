#!/usr/bin/env python3
"""
Warden remediation engine — resolves common system issues automatically.

Each remediation is a composable action that runs when a health check
reports a failing status. Actions are idempotent where possible and
always log what they did.

Usage:
  python3 remediation.py list
  python3 remediation.py run <check_name>
  python3 remediation.py run-all
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

WARDEN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WARDEN_DIR))

from warden_state import (
    append_event,
    get_hostname,
    get_or_create_host_id,
    load_config,
    load_state,
    save_state,
    utc_now,
)


# ── Remediation action registry ─────────────────────────────────────

RemediationFunc = Callable[[dict[str, Any]], dict[str, Any]]

_remediation_actions: dict[str, RemediationFunc] = {}


def remediates(check_name: str):
    """Decorator to register a remediation action for a check."""
    def decorator(func: RemediationFunc):
        _remediation_actions[check_name] = func
        return func
    return decorator


def get_remediation_action(check_name: str) -> RemediationFunc | None:
    """Get the remediation action for a check."""
    return _remediation_actions.get(check_name)


def list_remediation_actions() -> dict[str, str]:
    """List all registered remediation actions with descriptions."""
    return {
        name: (func.__doc__ or "No description").strip().split("\n")[0]
        for name, func in _remediation_actions.items()
    }


# ── Remediation: disk-usage ─────────────────────────────────────────


@remediates("disk-usage")
def remediate_disk_usage(check_data: dict[str, Any]) -> dict[str, Any]:
    """Run nix store GC and report large files when disk is critically full."""
    actions_taken: list[str] = []
    data = check_data.get("data", {})
    filesystems = data.get("filesystems", [])
    thresholds = data.get("thresholds", {})

    if not filesystems:
        return {"status": "skipped", "message": "No filesystem data", "actions": []}

    for fs in filesystems:
        mount = fs.get("mount", "")
        used_pct = fs.get("used_pct", 0)
        fail_pct = thresholds.get("fail", 95)
        warn_pct = thresholds.get("warn", 80)

        if used_pct >= fail_pct:
            # Critical — run nix GC
            if mount == "/":
                msg = _run_nix_gc()
                actions_taken.append(f"/: {msg}")

            # Report top offenders
            try:
                result = subprocess.run(
                    ["du", "-sh", f"{mount}/*", "--exclude=/proc", "--exclude=/sys", "--exclude=/dev"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode == 0:
                    lines = result.stdout.strip().split("\n")
                    # Sort by size, show top 5
                    sized = []
                    for line in lines:
                        parts = line.split("\t")
                        if len(parts) == 2:
                            sized.append((parts[0], parts[1]))
                    sized.sort(key=lambda x: _parse_size(x[0]), reverse=True)
                    top = sized[:5]
                    actions_taken.append(f"Top directories on {mount}:")
                    for size, name in top:
                        actions_taken.append(f"  {size:>8}  {name}")
            except Exception:
                pass

        elif used_pct >= warn_pct:
            actions_taken.append(f"{mount} at {used_pct}% — below critical threshold, monitoring")

    status = "success" if any("GC" in a or "success" in a for a in actions_taken) else "monitoring"

    return {
        "status": status,
        "message": "; ".join(actions_taken) if actions_taken else "No action needed",
        "actions": actions_taken,
    }


def _parse_size(size_str: str) -> int:
    """Parse human-readable size string to bytes for sorting."""
    size_str = size_str.strip()
    if size_str.endswith("T"):
        return int(float(size_str[:-1]) * 1024**4)
    elif size_str.endswith("G"):
        return int(float(size_str[:-1]) * 1024**3)
    elif size_str.endswith("M"):
        return int(float(size_str[:-1]) * 1024**2)
    elif size_str.endswith("K"):
        return int(float(size_str[:-1]) * 1024)
    elif size_str.endswith("B"):
        return int(float(size_str[:-1]))
    try:
        return int(float(size_str))
    except ValueError:
        return 0


def _run_nix_gc() -> str:
    """Run nix store GC and return result summary."""
    try:
        result = subprocess.run(
            ["nix", "store", "gc", "--print-dead"],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            dead_lines = [l for l in result.stdout.split("\n") if l.strip() and not l.startswith("removing")]
            store_paths = [l for l in dead_lines if l.startswith("/nix/store/")]
            return f"nix GC: {len(store_paths)} paths collectible"
        else:
            return f"nix GC failed: {result.stderr.strip()[:200]}"
    except subprocess.TimeoutExpired:
        return "nix GC timed out"
    except FileNotFoundError:
        return "nix not found"


# ── Remediation: systemd-health ─────────────────────────────────────


@remediates("systemd-health")
def remediate_systemd_health(check_data: dict[str, Any]) -> dict[str, Any]:
    """Restart failed systemd units and report results."""
    actions_taken: list[str] = []
    failed_units = check_data.get("data", {}).get("failed_units", [])

    if not failed_units:
        return {"status": "skipped", "message": "No failed units", "actions": []}

    for unit in failed_units:
        unit_name = unit.get("unit", "")
        if not unit_name:
            continue

        try:
            result = subprocess.run(
                ["sudo", "systemctl", "restart", unit_name],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                actions_taken.append(f"Restarted {unit_name}: success")
            else:
                actions_taken.append(f"Restarted {unit_name}: failed ({result.stderr.strip()[:100]})")
        except Exception as e:
            actions_taken.append(f"Restarted {unit_name}: error ({e})")

    status = "success" if all("success" in a for a in actions_taken) else "partial"
    return {
        "status": status,
        "message": "; ".join(actions_taken),
        "actions": actions_taken,
    }


# ── Remediation: tailscale ──────────────────────────────────────────


@remediates("tailscale")
def remediate_tailscale(check_data: dict[str, Any]) -> dict[str, Any]:
    """Restart Tailscale if connectivity is lost."""
    actions_taken: list[str] = []

    # Check current status
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            self_data = data.get("Self", {})
            ips = self_data.get("TailscaleIPs", [])
            if ips:
                return {"status": "skipped", "message": "Tailscale is already connected", "actions": []}
    except Exception:
        pass

    # Attempt restart
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "restart", "tailscaled"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            actions_taken.append("Tailscale daemon restarted")
            # Wait for connection
            import time
            time.sleep(3)
            try:
                status = subprocess.run(
                    ["tailscale", "status", "--json"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if status.returncode == 0:
                    data = json.loads(status.stdout)
                    self_data = data.get("Self", {})
                    ips = self_data.get("TailscaleIPs", [])
                    if ips:
                        actions_taken.append(f"Reconnected ({ips[0]})")
                    else:
                        actions_taken.append("Restarted but no Tailscale IP yet")
                else:
                    actions_taken.append("Restarted but status check failed")
            except Exception:
                actions_taken.append("Restarted but status check errored")
        else:
            actions_taken.append(f"Restart failed: {result.stderr.strip()[:100]}")
    except Exception as e:
        actions_taken.append(f"Restart error: {e}")

    status = "success" if any("restarted" in a.lower() for a in actions_taken) else "failed"
    return {
        "status": status,
        "message": "; ".join(actions_taken),
        "actions": actions_taken,
    }


# ── Remediation: memory ─────────────────────────────────────────────


@remediates("memory")
def remediate_memory(check_data: dict[str, Any]) -> dict[str, Any]:
    """Log memory pressure details and suggest actions (non-destructive)."""
    data = check_data.get("data", {})
    ram = data.get("ram", {})
    used_pct = ram.get("used_pct", 0)
    thresholds = data.get("thresholds", {})
    fail_pct = thresholds.get("fail", 95)

    actions_taken: list[str] = []

    if used_pct >= fail_pct:
        # Check for top memory consumers
        try:
            result = subprocess.run(
                ["ps", "aux", "--sort=-%mem", "--no-headers"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split("\n")[:5]
                actions_taken.append("Top memory consumers:")
                for line in lines:
                    parts = line.split()
                    if len(parts) >= 11:
                        pid, user, cpu, mem, *rest, cmd = parts[0], parts[1], parts[2], parts[3], parts[10]
                        actions_taken.append(f"  PID {pid} ({user}): {mem}% — {' '.join(parts[10:])[:60]}")
        except Exception:
            pass

        return {
            "status": "warning",
            "message": "; ".join(actions_taken) if actions_taken else f"RAM at {used_pct}% — monitor manually",
            "actions": actions_taken,
        }

    return {"status": "skipped", "message": "Memory within normal range", "actions": []}


# ── Remediation: backup-freshness ───────────────────────────────────


@remediates("backup-freshness")
def remediate_backup_freshness(check_data: dict[str, Any]) -> dict[str, Any]:
    """Trigger a backup if one hasn't run recently."""
    try:
        backup_runner = WARDEN_DIR / "backup_runner.py"
        result = subprocess.run(
            [sys.executable, str(backup_runner), "--json", "run"],
            capture_output=True,
            text=True,
            timeout=7200,
        )
        if result.returncode == 0:
            return {
                "status": "success",
                "message": "Backup triggered and completed",
                "actions": ["Triggered backup via backup_runner.py"],
            }
        else:
            return {
                "status": "failed",
                "message": f"Backup failed: {result.stderr.strip()[:200]}",
                "actions": [f"Backup attempt failed: {result.stderr.strip()[:200]}"],
            }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Could not trigger backup: {e}",
            "actions": [],
        }


# ── Remediation: system-config (nixos-rebuild) ──────────────────────


@remediates("system-config")
def remediate_system_config(check_data: dict[str, Any]) -> dict[str, Any]:
    """Trigger a nixos-rebuild switch when the system config is stale."""
    actions_taken: list[str] = []
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "start", "warden-rebuild"],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode == 0:
            actions_taken.append("nixos-rebuild switch completed")
            status = "success"
        else:
            actions_taken.append(f"rebuild failed: {result.stderr.strip()[:200]}")
            status = "failed"
    except subprocess.TimeoutExpired:
        actions_taken.append("rebuild timed out after 10 min")
        status = "failed"
    except Exception as e:
        actions_taken.append(f"rebuild error: {e}")
        status = "failed"
    return {"status": status, "message": "; ".join(actions_taken), "actions": actions_taken}


# ── Orchestrator ────────────────────────────────────────────────────


def run_remediation(
    check_name: str,
    check_data: dict[str, Any] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run remediation for a specific check.

    Args:
        check_name: Name of the check to remediate.
        check_data: Current check result data (fetched from state if not provided).
        dry_run: If True, log what would be done but don't execute.

    Returns: Remediation result dict.
    """
    if check_data is None:
        state = load_state()
        check_data = state.get("checks", {}).get(check_name, {})

    action = get_remediation_action(check_name)
    if action is None:
        return {
            "status": "unavailable",
            "message": f"No remediation action registered for check: {check_name}",
            "check": check_name,
        }

    if dry_run:
        return {
            "status": "dry_run",
            "message": f"Would remediate {check_name}",
            "check": check_name,
            "would_run": action.__doc__ or "Unknown action",
        }

    try:
        result = action(check_data)
        result["check"] = check_name
        result["timestamp"] = utc_now()

        # Record in state
        state = load_state()
        remediation_history = state.get("remediation_history", [])
        remediation_history.append({
            "check": check_name,
            "action": action.__name__,
            "status": result.get("status", "unknown"),
            "message": result.get("message", ""),
            "timestamp": result["timestamp"],
            "triggered_by": "auto",
        })
        state["remediation_history"] = remediation_history
        save_state(state)

        # Log event
        append_event({
            "type": "remediation",
            "check": check_name,
            "action": action.__name__,
            "status": result.get("status"),
            "message": result.get("message", ""),
        })

        return result
    except Exception as e:
        error_result = {
            "check": check_name,
            "status": "error",
            "message": f"Remediation failed with exception: {e}",
            "timestamp": utc_now(),
        }
        append_event({"type": "remediation", "check": check_name, "status": "error", "message": str(e)})
        return error_result


def run_all_remediations(dry_run: bool = False) -> dict[str, dict[str, Any]]:
    """Run remediation for all checks that have failing status."""
    state = load_state()
    checks = state.get("checks", {})
    results: dict[str, dict[str, Any]] = {}

    for check_name, check_data in checks.items():
        status = check_data.get("status")
        if status in ("fail", "warn", "critical"):
            results[check_name] = run_remediation(check_name, check_data, dry_run)

    return results


# ── CLI ─────────────────────────────────────────────────────────────


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Warden remediation engine")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("list", help="List registered remediation actions")

    run_parser = subparsers.add_parser("run", help="Run remediation for a check")
    run_parser.add_argument("check_name", help="Check name to remediate")
    run_parser.add_argument("--dry-run", action="store_true", help="Preview without executing")

    run_all_parser = subparsers.add_parser("run-all", help="Run remediation for all failing checks")
    run_all_parser.add_argument("--dry-run", action="store_true", help="Preview without executing")

    parser.add_argument("--json", action="store_true", help="JSON output")

    args = parser.parse_args()

    if args.command == "list":
        actions = list_remediation_actions()
        if args.json:
            print(json.dumps(actions, indent=2))
        else:
            print("Registered remediation actions:")
            for name, desc in sorted(actions.items()):
                print(f"  {name}: {desc}")

    elif args.command == "run":
        if not args.check_name:
            print("Usage: remediation.py run <check_name>")
            return
        result = run_remediation(args.check_name, dry_run=args.dry_run)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            sym = {"success": "✓", "partial": "⚠", "failed": "✗", "warning": "⚠", "skipped": "→", "unavailable": "?"}
            s = sym.get(result.get("status", ""), "?")
            print(f"{s} {result.get('check', args.check_name)}: {result.get('status', '?')}")
            print(f"   {result.get('message', '')}")
            for action in result.get("actions", []):
                print(f"   → {action}")

    elif args.command == "run-all":
        results = run_all_remediations(dry_run=args.dry_run)
        if args.json:
            print(json.dumps(results, indent=2, default=str))
        else:
            if not results:
                print("No failing checks to remediate.")
            for check, result in sorted(results.items()):
                sym = {"success": "✓", "partial": "⚠", "failed": "✗", "warning": "⚠", "skipped": "→"}
                s = sym.get(result.get("status", ""), "?")
                print(f"{s} {check}: {result.get('status', '?')}")
                if result.get("message"):
                    print(f"   {result['message']}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
