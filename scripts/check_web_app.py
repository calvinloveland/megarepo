#!/usr/bin/env python3
"""Run web-app checks on demand for a single project.

Usage:
    python scripts/check_web_app.py thermofluid       # checks + smoke + e2e
    python scripts/check_web_app.py thermofluid --e2e  # include Playwright E2E
    python scripts/check_web_app.py vernissage          # lint + build + test
    python scripts/check_web_app.py vernissage --e2e    # include Playwright E2E
    python scripts/check_web_app.py esp-array-sim       # node --check + node --test
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
KNOWN_APPS = {
    "thermofluid": {
        "dir": REPO_ROOT / "active" / "web-apps" / "recursive-thermofluid-sandbox",
        "server_script": "server.mjs",
    },
    "vernissage": {
        "dir": REPO_ROOT / "active" / "web-apps" / "vernissage",
        "server_script": None,
    },
    "esp-array-sim": {
        "dir": REPO_ROOT / "active" / "web-apps" / "esp-array-sim",
        "server_script": "server.mjs",
    },
}


def run(cmd: list[str], cwd: Path, label: str) -> int:
    print(f"\n=== {label} ===")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(f"FAILED: {label}")
    return result.returncode


def check_thermofluid(app: dict, args: argparse.Namespace) -> int:
    app_dir: Path = app["dir"]
    exit_code = 0

    exit_code |= run(["npm", "ci"], app_dir, "npm install")

    # Node syntax check
    for f in ("app.js", "server.mjs", "sim-core.mjs"):
        if (app_dir / f).exists():
            exit_code |= run(["node", "--check", f], app_dir, f"node --check {f}")

    exit_code |= run(["npm", "test"], app_dir, "unit tests")

    if args.smoke or args.e2e:
        exit_code |= run(["bash", "tests/smoke-test.sh"], app_dir, "smoke tests")

    if args.e2e:
        exit_code |= run(["npx", "playwright", "install", "--with-deps", "chromium"], app_dir, "install playwright")
        exit_code |= run(["npm", "run", "test:e2e"], app_dir, "playwright e2e tests")

    return exit_code


def check_node_sim(app: dict, args: argparse.Namespace) -> int:
    """Generic checker for a no-build Node static-server sandbox (e.g. esp-array-sim):
    install deps, node --check every entrypoint + src module, run the unit suite."""
    app_dir: Path = app["dir"]
    exit_code = 0

    install_cmd = ["npm", "ci"] if (app_dir / "package-lock.json").exists() else ["npm", "install"]
    exit_code |= run(install_cmd, app_dir, "npm install")

    # Node syntax check: page entrypoints and every src/*.mjs module
    targets = ["app.js", app["server_script"]]
    targets = [t for t in targets if t and (app_dir / t).exists()]
    src_dir = app_dir / "src"
    if src_dir.is_dir():
        targets += sorted(p.name for p in src_dir.glob("*.mjs"))
    for f in targets:
        path = f"src/{f}" if (src_dir / f).exists() else f
        exit_code |= run(["node", "--check", path], app_dir, f"node --check {path}")

    exit_code |= run(["npm", "test"], app_dir, "unit tests")
    return exit_code


def check_vernissage(app: dict, args: argparse.Namespace) -> int:
    app_dir: Path = app["dir"]
    exit_code = 0

    exit_code |= run(["npm", "ci"], app_dir, "npm install")
    exit_code |= run(["npm", "run", "lint"], app_dir, "lint")
    exit_code |= run(["npm", "run", "build"], app_dir, "build")
    exit_code |= run(["npm", "test"], app_dir, "unit tests")

    if args.e2e:
        exit_code |= run(["npx", "playwright", "install", "--with-deps", "chromium"], app_dir, "install playwright")
        exit_code |= run(["npm", "run", "test:e2e"], app_dir, "playwright e2e tests")

    return exit_code


def check() -> int:
    parser = argparse.ArgumentParser(description="Check a web app project")
    parser.add_argument("app_name", choices=list(KNOWN_APPS.keys()), help="which web app to check")
    parser.add_argument("--e2e", action="store_true", help="also run Playwright E2E tests")
    parser.add_argument("--smoke", action="store_true", help="also run smoke tests (thermofluid only)")
    args = parser.parse_args()

    app = KNOWN_APPS[args.app_name]
    app_dir: Path = app["dir"]

    if not app_dir.exists():
        print(f"App directory not found: {app_dir}")
        return 1

    checkers = {
        "thermofluid": check_thermofluid,
        "vernissage": check_vernissage,
        "esp-array-sim": check_node_sim,
    }
    exit_code = checkers[args.app_name](app, args)

    if exit_code == 0:
        print(f"\n✓ {args.app_name} checks passed")
    else:
        print(f"\n✗ {args.app_name} checks failed (exit {exit_code})")

    return exit_code


if __name__ == "__main__":
    sys.exit(check())
