#!/usr/bin/env python3
"""Run all (or a subset of) local repo checks on demand.

Replaces the old GitHub Actions workflows with one-shot Python commands.

Usage:
    python scripts/check_all.py                  # run all checks
    python scripts/check_all.py --list           # show available checks
    python scripts/check_all.py --skip docker    # run everything except docker builds
    python scripts/check_all.py pi-package       # run one specific check
    python scripts/check_all.py supply-chain docs  # run a couple
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / "scripts"


def run_script(name: str, label: str, extra_args: list[str] | None = None) -> int:
    script = SCRIPTS / f"{name}.py"
    if not script.exists():
        print(f"  SKIP {label}: {script} not found")
        return 0
    cmd = [sys.executable, str(script)]
    if extra_args:
        cmd.extend(extra_args)
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"  FAILED: {label} (exit {result.returncode})")
    return result.returncode


ALL_CHECKS: list[dict] = [
    {"name": "supply-chain", "script": "check_supply_chain", "args": None},
    {"name": "pi-package", "script": "check_pi_package", "args": []},
    {"name": "thermofluid", "script": "check_web_app", "args": ["thermofluid"]},
    {"name": "vernissage", "script": "check_web_app", "args": ["vernissage"]},
    {"name": "docker", "script": "build_docker", "args": []},
    {"name": "docs", "script": "build_docs", "args": []},
]

CHECK_NAMES = [c["name"] for c in ALL_CHECKS]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run repo checks on demand — replaces the old GitHub Actions workflows",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python scripts/check_all.py                  # run all checks\n"
            "  python scripts/check_all.py --list           # show checks\n"
            "  python scripts/check_all.py --skip docker    # skip docker builds\n"
            "  python scripts/check_all.py supply-chain     # run one check\n"
        ),
    )
    parser.add_argument("--list", action="store_true", help="list available checks and exit")
    parser.add_argument("--skip", nargs="+", choices=CHECK_NAMES, default=[], help="checks to skip")
    parser.add_argument("checks", nargs="*", choices=CHECK_NAMES, help="which checks to run (default: all)")
    args = parser.parse_args()

    if args.list:
        print("Available checks:")
        for c in ALL_CHECKS:
            print(f"  {c['name']:20s}  ({c['script']}.py)")
        return 0

    to_run = args.checks if args.checks else CHECK_NAMES
    to_run = [c for c in to_run if c not in args.skip]

    exit_code = 0
    for check_def in ALL_CHECKS:
        if check_def["name"] not in to_run:
            continue
        exit_code |= run_script(check_def["script"], check_def["name"], check_def["args"])

    if exit_code == 0:
        print(f"\n{'='*60}")
        print("  All checks passed ✓")
        print(f"{'='*60}")
    else:
        print(f"\n{'='*60}")
        print(f"  Some checks failed (exit {exit_code}) ✗")
        print(f"{'='*60}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
