#!/usr/bin/env python3
"""
Warden check runner — discovers and runs health checks, saves results to state.

Usage:
  python3 runner.py [--check CHECK_NAME] [--config JSON]
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

# Add the warden module directory to path so checks can find warden_state
WARDEN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WARDEN_DIR))

from warden_state import (
    load_config,
    load_state,
    save_check_result,
    save_state,
    utc_now,
)

CHECKS_DIR = WARDEN_DIR / "checks"

# Built-in check registry: name → module filename
BUILTIN_CHECKS: dict[str, str] = {
    "disk-usage": "disk_usage.py",
    "memory": "memory.py",
    "temperature": "temperature.py",
    "systemd-health": "systemd_health.py",
}


def discover_checks() -> dict[str, str]:
    """Discover available checks. Returns dict of check_name → script_path."""
    checks = dict(BUILTIN_CHECKS)
    # Check for additional scripts in the checks directory
    if CHECKS_DIR.exists():
        for f in sorted(CHECKS_DIR.iterdir()):
            if f.suffix == ".py" and f.stem not in ("__init__",):
                checks[f.stem.replace("_", "-")] = f.name
    return checks


def run_check_import(check_name: str, script_name: str) -> dict[str, Any]:
    """Run a check by importing it as a module and calling its main check function."""
    script_path = CHECKS_DIR / script_name
    if not script_path.exists():
        return {
            "check": check_name,
            "status": "fail",
            "message": f"Check script not found: {script_path}",
            "data": {},
        }

    # Try importing the check module
    module_name = f"warden_check_{script_name.replace('.py', '')}"
    try:
        spec = importlib.util.spec_from_file_location(module_name, script_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load spec from {script_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # Look for a check function named check_<name>
        func_name = f"check_{script_name.replace('.py', '').replace('-', '_')}"
        check_func = getattr(module, func_name, None)

        if check_func is None:
            # Fall back to any function named check_*
            for attr in dir(module):
                if attr.startswith("check_") and callable(getattr(module, attr)):
                    check_func = getattr(module, attr)
                    break

        if check_func is None:
            return {
                "check": check_name,
                "status": "fail",
                "message": f"No check function found in {script_path}",
                "data": {},
            }

        # Merge config: Nix defaults + local overrides
        local_config = load_config()
        check_config = local_config.get("checks", {}).get(check_name, {})
        os.environ["WARDEN_CHECK_CONFIG"] = json.dumps(check_config)

        return check_func(check_config)
    except Exception as e:
        return {
            "check": check_name,
            "status": "fail",
            "message": f"Check {check_name} failed: {e}",
            "data": {},
        }


def run_check_subprocess(check_name: str, script_name: str) -> dict[str, Any]:
    """Run a check as a subprocess and parse its JSON output."""
    import subprocess

    script_path = CHECKS_DIR / script_name
    local_config = load_config()
    check_config = local_config.get("checks", {}).get(check_name, {})

    env = os.environ.copy()
    env["WARDEN_CHECK_CONFIG"] = json.dumps(check_config)

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        if result.stdout.strip():
            data = json.loads(result.stdout)
            data.setdefault("check", check_name)
            data.setdefault("timestamp", utc_now())
            return data
        else:
            return {
                "check": check_name,
                "status": "fail",
                "message": f"No output from {script_name} (stderr: {result.stderr.strip()})",
                "data": {},
            }
    except json.JSONDecodeError as e:
        return {
            "check": check_name,
            "status": "fail",
            "message": f"Invalid JSON from {script_name}: {e}",
            "data": {},
        }
    except subprocess.TimeoutExpired:
        return {
            "check": check_name,
            "status": "fail",
            "message": f"Check {script_name} timed out",
            "data": {},
        }
    except FileNotFoundError as e:
        return {
            "check": check_name,
            "status": "fail",
            "message": f"Check {script_name} not found: {e}",
            "data": {},
        }


def run_all_checks(
    check_names: list[str] | None = None,
    use_subprocess: bool = True,
    state_dir: str | os.PathLike[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Run all discovered checks (or a subset) and save results to state.

    Args:
        check_names: If provided, run only these checks.
        use_subprocess: If True, run each check as a subprocess for isolation.
        state_dir: Override the state directory (for testing).

    Returns: dict of check_name → result
    """
    checks = discover_checks()
    results: dict[str, dict[str, Any]] = {}

    if check_names:
        # Validate requested checks
        for name in check_names:
            if name not in checks:
                results[name] = {
                    "check": name,
                    "status": "fail",
                    "message": f"Unknown check: {name}. Available: {', '.join(sorted(checks.keys()))}",
                    "data": {},
                }
        # Only run valid checks
        to_run = {n: s for n, s in checks.items() if n in check_names}
    else:
        to_run = checks

    for check_name, script_name in sorted(to_run.items()):
        if use_subprocess:
            result = run_check_subprocess(check_name, script_name)
        else:
            result = run_check_import(check_name, script_name)
        result.setdefault("timestamp", utc_now())
        result.setdefault("data", {})

        save_check_result(check_name, result, state_dir)
        results[check_name] = result

    # Auto-remediate failing checks
    auto_remediate = os.environ.get("WARDEN_AUTO_REMEDIATE", "1") == "1"
    if auto_remediate:
        try:
            _run_auto_remediation(results)
        except Exception as e:
            import sys
            print(f"[warden] Auto-remediation error: {e}", file=sys.stderr)

    return results


def _run_auto_remediation(results: dict[str, dict[str, Any]]) -> None:
    """Run remediation for any checks that reported warn or fail status."""
    try:
        sys.path.insert(0, str(WARDEN_DIR))
        from remediation import run_remediation  # type: ignore

        for check_name, result in sorted(results.items()):
            status = result.get("status", "")
            if status in ("fail", "critical"):
                print(f"[warden] Auto-remediating {check_name} ({status})...")
                rem_result = run_remediation(check_name, result)
                sym = {"success": "\u2713", "partial": "\u26a0", "failed": "\u2717", "error": "\u2717"}
                s = sym.get(rem_result.get("status", ""), "?")
                print(f"[warden]   {s} {rem_result.get('status', '?')}: {rem_result.get('message', '')[:120]}")
    except ImportError as e:
        print(f"[warden] Remediation engine not available: {e}", file=sys.stderr)


def print_summary(results: dict[str, dict[str, Any]]) -> None:
    """Print a human-readable summary of check results."""
    pass_count = sum(1 for r in results.values() if r["status"] == "pass")
    warn_count = sum(1 for r in results.values() if r["status"] == "warn")
    fail_count = sum(1 for r in results.values() if r["status"] == "fail")

    print(f"Warden check summary: {pass_count} passed, {warn_count} warnings, {fail_count} failed")
    print()

    for check_name, result in sorted(results.items()):
        status_symbol = {
            "pass": "✓",
            "warn": "⚠",
            "fail": "✗",
        }.get(result["status"], "?")
        print(f"  {status_symbol} {check_name}: {result.get('message', '')}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Warden check runner")
    parser.add_argument("--check", action="append", help="Run specific check(s) only")
    parser.add_argument("--subprocess", action="store_true", default=True, help="Run checks as subprocesses (default)")
    parser.add_argument("--import", dest="use_import", action="store_true", help="Run checks via direct import (faster)")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of human-readable")
    parser.add_argument("--list", action="store_true", help="List available checks")

    args = parser.parse_args()

    if args.list:
        checks = discover_checks()
        print("Available checks:")
        for name, script in sorted(checks.items()):
            print(f"  {name} ({script})")
        return

    use_subprocess = not args.use_import
    results = run_all_checks(
        check_names=args.check,
        use_subprocess=use_subprocess,
    )

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_summary(results)

    # Exit with failure if any check failed
    if any(r["status"] == "fail" for r in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
