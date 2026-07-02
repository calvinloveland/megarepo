#!/usr/bin/env python3
"""Run the pi-autopilot-complete package checks on demand.

Usage:
    python scripts/check_pi_package.py             # run all checks
    python scripts/check_pi_package.py --test-only  # skip smoke test
    python scripts/check_pi_package.py --smoke-only # skip unit tests
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PKG_DIR = REPO_ROOT / "active" / "personal" / "calnix" / "pi-packages" / "pi-autopilot-complete"


def run(cmd: list[str], cwd: Path, label: str) -> int:
    print(f"\n=== {label} ===")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(f"FAILED: {label}")
    return result.returncode


def check() -> int:
    parser = argparse.ArgumentParser(description="Check pi-autopilot-complete package")
    parser.add_argument("--test-only", action="store_true", help="skip the smoke test")
    parser.add_argument("--smoke-only", action="store_true", help="skip unit tests")
    args = parser.parse_args()

    if not PKG_DIR.exists():
        print(f"Package directory not found: {PKG_DIR}")
        return 1

    exit_code = 0

    if not args.smoke_only:
        exit_code |= run(["npm", "ci"], PKG_DIR, "npm install")
        exit_code |= run(["npm", "test"], PKG_DIR, "unit tests")

    if not args.test_only:
        smoke = PKG_DIR / "tests" / "super-autopilot-smoke.sh"
        if smoke.exists():
            exit_code |= run(
                ["bash", str(smoke), "opencode-go/deepseek-v4-flash", "--min-cycles", "3"],
                PKG_DIR,
                "super-autopilot smoke test",
            )
        else:
            print(f"  (smoke test not found at {smoke}, skipping)")

    if exit_code == 0:
        print("\n✓ pi-autopilot-complete checks passed")
    else:
        print(f"\n✗ pi-autopilot-complete checks failed (exit {exit_code})")

    return exit_code


if __name__ == "__main__":
    sys.exit(check())
