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

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
# ROOT now points to the wizard_fight package directory (contains `frontend` and `src`)
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


def main(output: str, mode: str = "mock"):
    # Prepare output dirs
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    GIF_TMP.mkdir(parents=True, exist_ok=True)

    if mode == "mock":
        # Start a lightweight mock backend (to avoid heavy runtime deps) that responds to
        # /generate_spell. This simplifies demo execution in dev environments and keeps
        # the UI behavior realistic (includes llm_backend value).
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import json
        import threading

        class _MockHandler(BaseHTTPRequestHandler):
            def _set_cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

            def do_OPTIONS(self):
                self.send_response(200)
                self._set_cors()
                self.end_headers()

            def do_GET(self):
                # respond OK for health checks on /generate_spell
                if self.path == "/generate_spell":
                    self.send_response(200)
                    self._set_cors()
                    self.send_header("Content-Type", "application/json")
                    body = b"{}"
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(404)
                self.end_headers()

            def do_POST(self):
                if self.path != "/generate_spell":
                    self.send_response(404)
                    self.end_headers()
                    return
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8") if length else ""
                try:
                    payload = json.loads(body) if body else {}
                    prompt = payload.get("prompt", "demo")
                except Exception:
                    prompt = "demo"

                # Minimal fake response
                resp = {
                    "spell_id": "demo-1",
                    "prompt": prompt,
                    "design": {"name": "Monkey Surge", "description": "Summons a flying monkey."},
                    "spec": {"name": "Monkey Surge", "emoji": "🐒"},
                    "llm_backend": f"copilot:{COPILOT_MODEL}",
                }
                body = json.dumps(resp).encode("utf-8")
                self.send_response(200)
                self._set_cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        mock_server = ThreadingHTTPServer(("", BACKEND_PORT), _MockHandler)
        mock_thread = threading.Thread(target=mock_server.serve_forever, daemon=True)
        mock_thread.start()
    else:
        # Real mode: rely on the actual backend already running on BACKEND_PORT
        print("Using real backend at port", BACKEND_PORT)

    # Start frontend static server
    frontend_cmd = [PYTHON, "-m", "http.server", str(FRONTEND_PORT)]
    frontend_proc = start_process(frontend_cmd, cwd=FRONTEND_DIR, env=os.environ.copy())

    try:
        if not wait_for_http(f"http://localhost:{FRONTEND_PORT}", timeout=15):
            raise RuntimeError("Frontend did not start in time")
        # For mock mode we already check /generate_spell; for real mode check /spellbook
        health_path = "/generate_spell" if mode == "mock" else "/spellbook"
        if not wait_for_http(f"http://localhost:{BACKEND_PORT}{health_path}", timeout=15):
            raise RuntimeError("Backend did not start in time")

        # Ensure Playwright knows where browsers are installed (use project-local cache)
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".playwright_browsers"))

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 720})
            page = context.new_page()

            # Open page and add a visible Copilot banner with a pulsing animation
            url = f"http://localhost:{FRONTEND_PORT}/game.html"
            if mode == "real":
                url += "?mode=cvc"
            page.goto(url)

            # Wait for UI to be ready
            page.wait_for_selector("#spell-lab-input", timeout=15000)
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
            # Inject CSS for a subtle pulsing animation so the GIF will show motion
            page.add_style_tag(content='@keyframes wfPulse {0%{transform:scale(1);}50%{transform:scale(1.03);}100%{transform:scale(1);}} #copilot-demo-banner{animation:wfPulse 1s ease-in-out infinite;}')

            if mode == "mock":
                # Interact: generate a spell (mock backend)
                page.fill("#spell-lab-input", "summon flying monkey")
                page.click("#spell-lab-button")
                # Wait for status to show saved or failure
                page.wait_for_selector("#spell-lab-status:text('Saved')", timeout=10000)
                # Give a moment for UI to update
                time.sleep(0.5)

                # Optionally, click a quick cast: add to game flow by creating a lobby and casting
                page.evaluate("() => { window.wizardFight.ensureWizardName && window.wizardFight.ensureWizardName(); }")
                page.click("#research-button")
                # Wait briefly
                time.sleep(0.5)

                # Capture a short sequence of frames for GIF
                frame_count = 18
                interval = 0.12
            else:
                # Real mode: wait for the CPU match to produce units, then capture
                # Wait until debug unit count > 0
                page.wait_for_selector("#dbg-units", timeout=15000)
                try:
                    page.wait_for_function("() => parseInt(document.getElementById('dbg-units').textContent || '0') > 0", timeout=15000)
                except Exception:
                    # If no units appear, proceed anyway but capture longer
                    pass
                frame_count = 60
                interval = 0.1

            # Capture frames
            frame_paths = []
            for i in range(frame_count):
                pth = GIF_TMP / f"frame_{i:03d}.png"
                page.screenshot(path=str(pth))
                frame_paths.append(pth)
                time.sleep(interval)

            # Save frames as GIF using Pillow
            from PIL import Image

            imgs = [Image.open(str(p)).convert("RGBA") for p in frame_paths]
            outgif = Path(output)
            imgs[0].save(
                outgif,
                save_all=True,
                append_images=imgs[1:],
                duration=120,
                loop=0,
            )
            print(f"Wrote GIF: {outgif}")

            # Close browser
            context.close()
            browser.close()

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
    parser.add_argument("--mode", choices=("mock","real"), default="mock")
    args = parser.parse_args()
    main(args.output, mode=args.mode)
