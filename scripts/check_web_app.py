#!/usr/bin/env python3
"""Run web-app checks on demand for a single project.

Usage:
    python scripts/check_web_app.py thermofluid       # checks + smoke + e2e
    python scripts/check_web_app.py thermofluid --e2e  # include Playwright E2E
    python scripts/check_web_app.py vernissage          # lint + build + test
    python scripts/check_web_app.py vernissage --e2e    # include Playwright E2E
    python scripts/check_web_app.py esp-array-sim       # node --check + node --test
    python scripts/check_web_app.py vroomon             # build + unit (+ e2e with --e2e)
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
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
    "watch-forge": {
        "dir": REPO_ROOT / "active" / "games" / "watch-forge",
        "server_script": "server.mjs",
    },
    "vroomon": {
        "dir": REPO_ROOT / "active" / "games" / "vroomon" / "electron",
        "server_script": None,
        "browser": "google-chrome-stable",
    },
    "gamebase": {
        "dir": REPO_ROOT / "active" / "web-apps" / "gamebase",
        "server_script": None,
    },
    "steampunk-tetris": {
        "dir": REPO_ROOT / "active" / "games" / "steampunk-tetris",
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


def check_steampunk_tetris(app: dict, args: argparse.Namespace) -> int:
    """Static Protocol v2 game + single-file bots: install, syntax, unit suite,
    and on request the Playwright suites (conformance, game, bots) plus the
    packaged-archive conformance re-run."""
    app_dir: Path = app["dir"]
    exit_code = 0

    install_cmd = ["npm", "ci"] if (app_dir / "package-lock.json").exists() else ["npm", "install"]
    exit_code |= run(install_cmd, app_dir, "npm install")

    targets = ["server.mjs"]
    targets += sorted(f"src/{p.name}" for p in (app_dir / "src").glob("*.js"))
    targets += sorted(f"bots/dist/{p.name}" for p in (app_dir / "bots" / "dist").glob("*.js"))
    for target in targets:
        exit_code |= run(["node", "--check", target], app_dir, f"node --check {target}")

    exit_code |= run(["npm", "run", "test:unit"], app_dir, "engine + bot unit tests")
    exit_code |= run(["npm", "run", "bots:check"], app_dir, "bot bundles are current")
    exit_code |= run(["node", "scripts/package.mjs"], app_dir, "package submission zip")

    if args.e2e:
        exit_code |= run(["npx", "playwright", "test"], app_dir, "playwright suites")
        exit_code |= run(["node", "scripts/verify-archive.mjs"], app_dir, "conformance on the packaged zip")

    return exit_code


def _is_nixos() -> bool:
    try:
        release = Path("/etc/os-release").read_text(encoding="utf-8")
    except OSError:
        return False
    return "ID=nixos" in release


def check_vroomon(app: dict, args: argparse.Namespace) -> int:
    """Electron/TS rewrite: ci -> build (tsc + esbuild static) -> vitest, plus e2e."""
    app_dir: Path = app["dir"]
    exit_code = 0

    exit_code |= run(["npm", "ci"], app_dir, "npm install")
    exit_code |= run(["npm", "run", "build"], app_dir, "build (tsc + static)")
    exit_code |= run(["npm", "test"], app_dir, "unit tests (vitest)")

    if args.smoke or args.e2e:
        # --with-deps runs apt, which doesn't exist on NixOS; the runner
        # overrides the executable with the system chrome there anyway.
        install_cmd = ["npx", "playwright", "install", "chromium"]
        if not _is_nixos():
            install_cmd = ["npx", "playwright", "install", "--with-deps", "chromium"]
        exit_code |= run(install_cmd, app_dir, "install playwright")

    if args.e2e:
        # The e2e harness (run-playwright.mjs) serves the built app and drives
        # it headlessly. On NixOS prefer the system chrome via
        # VROOMON_BROWSER_EXECUTABLE (Playwright's downloaded chromium there is
        # a generic Linux binary that the stub loader rejects).
        env = dict(os.environ)
        browser = app.get("browser")
        if browser and shutil.which(browser):
            env["VROOMON_BROWSER_EXECUTABLE"] = shutil.which(browser)
        result = subprocess.run(
            ["npm", "run", "test:e2e"],
            cwd=app_dir,
            env=env,
        )
        if result.returncode != 0:
            print("FAILED: playwright e2e tests")
        exit_code |= result.returncode

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


def check_python_flask(app: dict, args: argparse.Namespace) -> int:
    """Run a src-layout Flask/package project's pytest suite with src on PYTHONPATH."""
    app_dir: Path = app["dir"]
    env = dict(os.environ)
    src = app_dir / "src"
    env["PYTHONPATH"] = str(src) + os.pathsep + env.get("PYTHONPATH", "")
    print("\n=== pytest ===")
    result = subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=app_dir, env=env)
    if result.returncode != 0:
        print("FAILED: pytest")
    return result.returncode


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
        "watch-forge": check_node_sim,
        "vroomon": check_vroomon,
        "gamebase": check_python_flask,
        "steampunk-tetris": check_steampunk_tetris,
    }
    exit_code = checkers[args.app_name](app, args)

    if exit_code == 0:
        print(f"\n✓ {args.app_name} checks passed")
    else:
        print(f"\n✗ {args.app_name} checks failed (exit {exit_code})")

    return exit_code


if __name__ == "__main__":
    sys.exit(check())
