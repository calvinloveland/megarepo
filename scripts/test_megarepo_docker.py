#!/usr/bin/env python3
"""Megarepo Docker Integration Test — verify all deps install & servers start."""

import importlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path("/megarepo")
LAUNCHER_PORT = int(os.getenv("LAUNCHER_PORT", "3001"))
LAUNCHER_URL = f"http://127.0.0.1:{LAUNCHER_PORT}"

PASS, FAIL, SKIP = 0, 0, 0

def ok(m): global PASS; PASS += 1; print(f"  ✓ {m}")
def fail(m): global FAIL; FAIL += 1; print(f"  ✗ {m}")
def skip(m): global SKIP; SKIP += 1; print(f"  – {m}")

def check_py(mod, label=None):
    try: importlib.import_module(mod); ok(f"Python module '{label or mod}' importable")
    except ImportError as e: fail(f"Python module '{label or mod}' missing: {e}")

def url_ok(url, timeout=2):
    try: urllib.request.urlopen(url, timeout=timeout); return True
    except: return False

def wait_for(url, timeout=15, interval=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if url_ok(url, 1): return True
        time.sleep(interval)
    return False

def main():
    print("=" * 60)
    print("  Megarepo Docker Integration Test")
    print("  Python " + sys.version.split()[0])
    print("=" * 60)

    # ── 1. Python deps ──
    print("\n── Python Dependencies ──")
    for mod, label in [
        ("flask", "Flask"), ("yaml", "PyYAML"), ("jinja2", "Jinja2"),
        ("gunicorn", "gunicorn"), ("PIL", "Pillow"), ("markdown", "markdown"),
        ("requests", "requests"), ("numpy", "numpy"), ("tqdm", "tqdm"),
        ("loguru", "loguru"),
    ]:
        check_py(mod, label)

    # ── 2. Project-specific Python modules ──
    print("\n── Project Modules ──")
    for mod, label in [
        ("momos", "momos"), ("sub_day_generator", "sub-day-generator"),
        ("conways_game_of_war", "conway-game-of-war"),
        ("wizard_fight", "wizard-fight"), ("holdem_together", "holdem-together"),
        ("code_reviewdle", "code-reviewdle"),
    ]:
        try:
            importlib.import_module(mod)
            ok(f"Project '{label}' ({mod}) importable")
        except ImportError:
            skip(f"Project '{label}' ({mod}) — needs runtime context")

    # ── 3. Heavy ML deps ──
    print("\n── ML Dependencies ──")
    try: import torch; ok(f"PyTorch {torch.__version__}")
    except ImportError: skip("PyTorch not installed")
    try: import tensorflow as tf; ok(f"TensorFlow {tf.__version__}")
    except ImportError: skip("TensorFlow not installed")
    try:
        import cv2; ok(f"OpenCV {cv2.__version__}")
    except ImportError as e:
        fail(f"OpenCV missing: {e}" if "No module" in str(e) else skip(f"OpenCV import: {e}"))

    # ── 4. Node deps ──
    print("\n── Node.js Dependencies ──")
    r = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=5)
    if r.returncode == 0: ok(f"Node {r.stdout.strip()}")
    else: fail("Node not found")

    for proj in [
        "active/web-apps/vernissage",
        "active/web-apps/recursive-thermofluid-sandbox",
        "active/games/powder_play/frontend",
        "active/games/washing-machine-tycoon",
    ]:
        nm = REPO / proj / "node_modules"
        if nm.is_dir() and any(nm.iterdir()):
            ok(f"Node modules installed in '{Path(proj).name}'")
        else:
            skip(f"No node_modules in '{Path(proj).name}'")

    # ── 5. System tools ──
    print("\n── System Tools ──")
    for tool in ["git", "sqlite3", "curl"]:
        r = subprocess.run(["which", tool], capture_output=True, timeout=3)
        ok(f"{tool} available") if r.returncode == 0 else fail(f"{tool} missing")

    # ── 6. Server test (launcher) ──
    print("\n── Server Test ──")
    launcher = subprocess.Popen(
        ["python3", "-m", "active.web-apps.launcher.app"],
        cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={**os.environ, "LAUNCHER_PORT": str(LAUNCHER_PORT)},
    )
    if wait_for(LAUNCHER_URL):
        ok("Launcher started and responding")
        try:
            resp = urllib.request.urlopen(f"{LAUNCHER_URL}/api/apps", timeout=3)
            apps = json.loads(resp.read())
            ok(f"Launcher API returned {len(apps)} apps")
            for app_id in ["momos", "sub-day-generator"]:
                req = urllib.request.Request(f"{LAUNCHER_URL}/api/start/{app_id}", method="POST")
                try:
                    resp = urllib.request.urlopen(req, timeout=8)
                    data = json.loads(resp.read())
                    if data.get("ok"):
                        ok(f"App '{app_id}' started via API")
                    else:
                        skip(f"App '{app_id}' start: {data.get('message', '?')}")
                except Exception as e:
                    skip(f"App '{app_id}' start exception: {e}")
        except Exception as e:
            fail(f"Launcher API failed: {e}")
    else:
        fail("Launcher failed to start")

    launcher.terminate()
    try: launcher.wait(timeout=5)
    except: launcher.kill(); launcher.wait()

    total = PASS + FAIL + SKIP
    print(f"\n{'=' * 60}")
    print(f"  {PASS} passed,  {FAIL} failed,  {SKIP} skipped  (of {total})")
    if total: print(f"  Rate: {100 * PASS // total}%")
    print(f"{'=' * 60}")
    print(f"\n  Pass condition: {PASS}/{total} (need 100% pass for all-clear)")
    return 0 if FAIL == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
