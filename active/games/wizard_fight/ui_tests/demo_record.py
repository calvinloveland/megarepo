"""Playwright demo recorder for Wizard Fight.

Usage (dev machine):
- Install: pip install playwright
- Install browser: playwright install chromium
- Run: python ui_tests/demo_record.py --output demo.gif

The script starts the backend and frontend locally with the Copilot backend
selected (default model raptor-mini). It records a short video of generating a
spell via the Spell Lab and converts the video to a GIF for sharing.
"""
from __future__ import annotations

import argparse
import os
import signal
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT / "frontend"
VIDEO_DIR = ROOT / "tmp_playwright_videos"
GIF_TMP = ROOT / "tmp_playwright_gif"

BACKEND_PORT = int(os.getenv("WIZARD_FIGHT_PORT", "5055"))
FRONTEND_PORT = int(os.getenv("WIZARD_FIGHT_FRONTEND_PORT", "5175"))

COPILOT_MODEL = os.getenv("WIZARD_FIGHT_COPILOT_MODEL", "raptor-mini")

PYTHON = sys.executable


def start_process(cmd, cwd: Optional[Path] = None, env: Optional[dict] = None):
    return subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=lambda: os.setsid(),
    )


def wait_for_http(url: str, timeout: int = 10) -> bool:
    import urllib.request

    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status < 400:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def convert_webm_to_gif(webm_path: Path, out_path: Path, fps: int = 15, width: int = 640):
    # ffmpeg must be installed
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(webm_path),
        "-vf",
        f"fps={fps},scale={width}:-1:flags=lanczos",
        "-loop",
        "0",
        str(out_path),
    ]
    subprocess.check_call(cmd)


def main(output: str):
    # Prepare output dirs
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    GIF_TMP.mkdir(parents=True, exist_ok=True)

    # Start backend server with Copilot backend env
    backend_env = os.environ.copy()
    backend_env["WIZARD_FIGHT_SPELL_BACKEND"] = "copilot"
    backend_env["WIZARD_FIGHT_COPILOT_MODEL"] = COPILOT_MODEL
    backend_env["WIZARD_FIGHT_LLM_MODE"] = backend_env.get("WIZARD_FIGHT_LLM_MODE", "local")

    backend_cmd = [PYTHON, "-m", "wizard_fight.server"]
    backend_proc = start_process(backend_cmd, cwd=ROOT, env=backend_env)

    # Start frontend static server
    frontend_cmd = [PYTHON, "-m", "http.server", str(FRONTEND_PORT)]
    frontend_proc = start_process(frontend_cmd, cwd=FRONTEND_DIR, env=os.environ.copy())

    try:
        if not wait_for_http(f"http://localhost:{FRONTEND_PORT}", timeout=15):
            raise RuntimeError("Frontend did not start in time")
        if not wait_for_http(f"http://localhost:{BACKEND_PORT}/generate_spell", timeout=15):
            raise RuntimeError("Backend did not start in time")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(record_video_dir=str(VIDEO_DIR), viewport={"width": 1280, "height": 720})
            page = context.new_page()

            # Open page and add a visible Copilot banner
            page.goto(f"http://localhost:{FRONTEND_PORT}/")
            banner_text = f"Using Copilot backend ({COPILOT_MODEL})"
            page.evaluate("(text) => {"
                          "const el = document.createElement('div');"
                          "el.id = 'copilot-demo-banner';"
                          "el.style.position = 'fixed';"
                          "el.style.right = '12px';"
                          "el.style.top = '12px';"
                          "el.style.background = 'rgba(58,123,213,0.95)';"
                          "el.style.color = 'white';"
                          "el.style.padding = '8px 12px';"
                          "el.style.borderRadius = '6px';"
                          "el.style.zIndex = 99999;"
                          "el.style.fontWeight = '700';"
                          "el.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)';"
                          "el.innerText = text;"
                          "document.body.appendChild(el);"
                          "}", banner_text)

            # Interact: generate a spell
            page.fill("#spell-lab-input", "summon flying monkey")
            page.click("#spell-lab-button")
            # Wait for status to show saved or failure
            page.wait_for_selector("#spell-lab-status:text('Saved')", timeout=10000)
            # Give a moment for UI to update
            time.sleep(0.5)

            # Optionally, click a quick cast: add to game flow by creating a lobby and casting
            # Start a lobby via window functions
            page.evaluate("() => { window.wizardFight.ensureWizardName && window.wizardFight.ensureWizardName(); }")
            page.click("#research-button")
            # Wait briefly
            time.sleep(1)

            # Stop recording and close
            context.close()
            browser.close()

        # Find the produced webm file (Playwright stores with chunked names)
        webm_files = sorted(VIDEO_DIR.glob("**/*.webm"), key=lambda p: p.stat().st_mtime)
        if not webm_files:
            raise RuntimeError("No Playwright video file found")
        webm = webm_files[-1]
        outgif = Path(output)
        convert_webm_to_gif(webm, outgif)
        print(f"Wrote GIF: {outgif}")

    finally:
        # Cleanup: terminate processes
        try:
            os.killpg(os.getpgid(backend_proc.pid), signal.SIGTERM)
        except Exception:
            pass
        try:
            os.killpg(os.getpgid(frontend_proc.pid), signal.SIGTERM)
        except Exception:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="demo.gif")
    args = parser.parse_args()
    main(args.output)
