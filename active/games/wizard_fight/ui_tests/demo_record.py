"""Playwright demo recorder for Wizard Fight.

Usage (dev machine):
- Install: pip install playwright
- Install browser: playwright install chromium
- Run: python ui_tests/demo_record.py --output demo.gif

The script starts the backend and frontend locally with the Copilot backend
selected (default model gpt5-mini). It records a short video of generating a
spell via the Spell Lab and converts the video to a GIF for sharing.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
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

COPILOT_MODEL = os.getenv("WIZARD_FIGHT_COPILOT_MODEL", "gpt5-mini")

PYTHON = sys.executable


def start_process(cmd, cwd: Optional[Path] = None, env: Optional[dict] = None):
    """Start a child process in its own session for easy cleanup."""
    return subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )


def wait_for_http(url: str, timeout: int = 10) -> bool:
    """Poll URL until it serves a successful HTTP response."""
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
    """Convert a WebM recording to GIF via ffmpeg."""
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


def _start_mock_server():
    """Start a lightweight local backend for mock-mode recordings."""
    class _MockHandler(BaseHTTPRequestHandler):
        def _set_cors(self):
            """Attach permissive CORS headers."""
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def do_OPTIONS(self):
            """Handle preflight requests."""
            self.send_response(200)
            self._set_cors()
            self.end_headers()

        def do_GET(self):
            """Serve a health endpoint for readiness checks."""
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
            """Return deterministic spell generation responses."""
            if self.path != "/generate_spell":
                self.send_response(404)
                self.end_headers()
                return
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8") if length else ""
            prompt = "demo"
            if body:
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    payload = {}
                prompt = payload.get("prompt", "demo")
            response_body = json.dumps(
                {
                    "spell_id": "demo-1",
                    "prompt": prompt,
                    "design": {"name": "Monkey Surge", "description": "Summons a flying monkey."},
                    "spec": {"name": "Monkey Surge", "emoji": "🐒"},
                    "llm_backend": f"copilot:{COPILOT_MODEL}",
                }
            ).encode("utf-8")
            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)

    mock_server = ThreadingHTTPServer(("", BACKEND_PORT), _MockHandler)
    thread = threading.Thread(target=mock_server.serve_forever, daemon=True)
    thread.start()
    return mock_server


def _wait_for_services(mode: str):
    """Wait for frontend and backend endpoints to become reachable."""
    if not wait_for_http(f"http://localhost:{FRONTEND_PORT}", timeout=15):
        raise RuntimeError("Frontend did not start in time")
    health_path = "/generate_spell" if mode == "mock" else "/spellbook"
    if not wait_for_http(f"http://localhost:{BACKEND_PORT}{health_path}", timeout=15):
        raise RuntimeError("Backend did not start in time")


def _capture_settings(mode: str):
    """Return frame capture count and interval for the selected mode."""
    if mode == "mock":
        return 18, 0.12
    return 60, 0.1


def _add_banner(page):
    """Inject a visible banner in the browser recording."""
    banner_text = f"Using Copilot backend ({COPILOT_MODEL})"
    page.evaluate(
        """
        (text) => {
            const el = document.createElement('div');
            el.id = 'copilot-demo-banner';
            el.style.position = 'fixed';
            el.style.right = '12px';
            el.style.top = '12px';
            el.style.background = 'rgba(58,123,213,0.95)';
            el.style.color = 'white';
            el.style.padding = '8px 12px';
            el.style.borderRadius = '6px';
            el.style.zIndex = 99999;
            el.style.fontWeight = '700';
            el.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)';
            el.innerText = text;
            document.body.appendChild(el);
        }
        """,
        banner_text,
    )
    page.add_style_tag(
        content=(
            "@keyframes wfPulse {0%{transform:scale(1);}50%{transform:scale(1.03);}"
            "100%{transform:scale(1);}} "
            "#copilot-demo-banner{animation:wfPulse 1s ease-in-out infinite;}"
        )
    )


def _run_mode_interactions(page, mode: str):
    """Drive deterministic UI interactions for the selected mode."""
    if mode == "mock":
        page.fill("#spell-lab-input", "summon flying monkey")
        page.click("#spell-lab-button")
        page.wait_for_selector("#spell-lab-status:text('Saved')", timeout=10000)
        time.sleep(0.5)
        page.evaluate(
            "() => {"
            " window.wizardFight.ensureWizardName && window.wizardFight.ensureWizardName();"
            " }"
        )
        page.click("#research-button")
        time.sleep(0.5)
        return
    page.wait_for_selector("#dbg-units", timeout=15000)
    page.wait_for_function(
        "() => parseInt(document.getElementById('dbg-units').textContent || '0') > 0",
        timeout=15000,
    )


def _capture_frames(page, frame_count: int, interval: float):
    """Capture a sequence of screenshots and return their paths."""
    frame_paths = []
    for index in range(frame_count):
        frame_path = GIF_TMP / f"frame_{index:03d}.png"
        page.screenshot(path=str(frame_path))
        frame_paths.append(frame_path)
        time.sleep(interval)
    return frame_paths


def _write_gif(output: str, frame_paths):
    """Encode captured PNG frames into an animated GIF."""
    image_module = importlib.import_module("PIL.Image")
    images = [image_module.open(str(path)).convert("RGBA") for path in frame_paths]
    output_path = Path(output)
    images[0].save(
        output_path,
        save_all=True,
        append_images=images[1:],
        duration=120,
        loop=0,
    )
    print(f"Wrote GIF: {output_path}")


def _record_demo(output: str, mode: str):
    """Record the browser interaction and write an animated GIF."""
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".playwright_browsers"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()
        url = f"http://localhost:{FRONTEND_PORT}/game.html"
        if mode == "real":
            url += "?mode=cvc"
        page.goto(url)
        page.wait_for_selector("#spell-lab-input", timeout=15000)
        _add_banner(page)
        _run_mode_interactions(page, mode)
        frame_count, interval = _capture_settings(mode)
        frame_paths = _capture_frames(page, frame_count, interval)
        _write_gif(output, frame_paths)
        context.close()
        browser.close()


def _terminate_process(proc):
    """Terminate child process group when present."""
    if proc is None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        return


def main(output: str, mode: str = "mock"):
    """Entry point for generating a Wizard Fight demo GIF."""
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    GIF_TMP.mkdir(parents=True, exist_ok=True)
    mock_server = _start_mock_server() if mode == "mock" else None
    if mode != "mock":
        print("Using real backend at port", BACKEND_PORT)
    frontend_cmd = [PYTHON, "-m", "http.server", str(FRONTEND_PORT)]
    frontend_proc = start_process(frontend_cmd, cwd=FRONTEND_DIR, env=os.environ.copy())
    try:
        _wait_for_services(mode)
        _record_demo(output, mode)
    finally:
        if mock_server is not None:
            mock_server.shutdown()
            mock_server.server_close()
        _terminate_process(frontend_proc)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="demo.gif")
    parser.add_argument("--mode", choices=("mock","real"), default="mock")
    args = parser.parse_args()
    main(args.output, mode=args.mode)
