"""Megarepo Web App Launcher — dashboard to start/link web apps."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, List, Optional

import yaml
from flask import Flask, jsonify, render_template, request

LAUNCHER_DIR = Path(__file__).resolve().parent
APPS_FILE = LAUNCHER_DIR / "apps.yaml"
DEFAULT_LAUNCHER_PORT = 3001

# Track started subprocesses
_processes: Dict[str, subprocess.Popen] = {}
_process_lock = threading.Lock()


def load_apps() -> List[Dict]:
    """Load app definitions from apps.yaml."""
    with open(APPS_FILE) as f:
        data = yaml.safe_load(f)
    return data.get("apps", [])


def app_working_dir(app: Dict) -> Path:
    """Resolve an app's working directory relative to the launcher dir."""
    raw = app["path"]
    resolved = (LAUNCHER_DIR / raw).resolve()
    return resolved


def check_running(port: int, timeout: float = 1.5) -> bool:
    """Check if something is listening on the given port."""
    try:
        url = f"http://127.0.0.1:{port}"
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return False


def get_app_status(app: Dict) -> Dict:
    """Get the running status and URL for an app."""
    port = app["port"]
    running = check_running(port)
    url = f"http://localhost:{port}" if running else None
    return {
        "id": app["id"],
        "name": app["name"],
        "description": app.get("description", ""),
        "icon": app.get("icon", ""),
        "subdomain": app.get("subdomain", ""),
        "port": port,
        "running": running,
        "url": url,
        "type": app.get("type", ""),
    }


def build_env(app: Dict) -> Dict[str, str]:
    """Build environment dict for an app subprocess."""
    env = os.environ.copy()
    env["FLASK_DEBUG"] = "false"
    env["FLASK_ENV"] = "development"
    env["PYTHONUNBUFFERED"] = "1"
    env["SECRET_KEY"] = "launcher-dev-key-not-for-production"

    # For Python apps, add src dirs to PYTHONPATH so -m and package imports work
    app_type = app.get("type", "")
    if app_type in ("flask", "python"):
        working_dir = app_working_dir(app)
        src_dirs = []
        for d in ["src", "backend"]:
            p = working_dir / d
            if p.exists() and p.is_dir():
                src_dirs.append(str(p.resolve()))
        if src_dirs:
            existing = env.get("PYTHONPATH", "")
            joined = ":".join(src_dirs)
            env["PYTHONPATH"] = f"{joined}:{existing}" if existing else joined

    # Apply app-specific env overrides
    for key, val in app.get("env", {}).items():
        env[key] = str(val)
    return env


def start_app_process(app: Dict) -> Optional[str]:
    """Start an app as a subprocess. Returns error message or None."""
    app_id = app["id"]
    with _process_lock:
        if app_id in _processes:
            proc = _processes[app_id]
            if proc.poll() is None:
                return None  # Already running
            del _processes[app_id]

    working_dir = app_working_dir(app)
    if not working_dir.exists():
        return f"Working directory not found: {working_dir}"

    # Build start command: use module if specified, otherwise use start_cmd
    module = app.get("module")
    if module:
        cmd = f"python3 -m {module}"
    else:
        cmd = app["start_cmd"]
    env = build_env(app)

    log_dir = LAUNCHER_DIR / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = open(log_dir / f"{app_id}.log", "w")

    try:
        proc = subprocess.Popen(
            cmd,
            shell=True,
            cwd=str(working_dir),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            preexec_fn=lambda: os.setsid() if sys.platform != "win32" else None,
        )
    except Exception as e:
        return f"Failed to start: {e}"

    with _process_lock:
        _processes[app_id] = proc

    # Wait briefly, then check status
    time.sleep(2.0)
    if proc.poll() is not None:
        return f"Process exited prematurely (code {proc.returncode}). Check logs."

    return None


def stop_app_process(app_id: str) -> Optional[str]:
    """Stop a running app process. Returns error message or None."""
    with _process_lock:
        proc = _processes.get(app_id)
        if proc is None:
            return "Not running or not managed by launcher."
        if proc.poll() is not None:
            del _processes[app_id]
            return None

        # Send SIGTERM to the process group
        try:
            if sys.platform != "win32":
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            else:
                proc.terminate()
        except ProcessLookupError:
            pass

        # Wait up to 5s for graceful shutdown
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                if sys.platform != "win32":
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                else:
                    proc.kill()
            except ProcessLookupError:
                pass
            proc.wait()

        del _processes[app_id]
    return None


def create_app() -> Flask:
    app = Flask(__name__)

    @app.route("/")
    def index():
        apps = load_apps()
        statuses = [get_app_status(a) for a in apps]
        return render_template("index.html", apps=statuses)

    @app.route("/api/apps")
    def api_apps():
        apps = load_apps()
        statuses = [get_app_status(a) for a in apps]
        return jsonify(statuses)

    @app.route("/api/start/<app_id>", methods=["POST"])
    def api_start(app_id: str):
        apps = load_apps()
        app = next((a for a in apps if a["id"] == app_id), None)
        if not app:
            return jsonify({"ok": False, "error": f"Unknown app: {app_id}"}), 404

        # Check if already running
        status = get_app_status(app)
        if status["running"]:
            return jsonify({"ok": True, "url": status["url"], "message": "Already running."})

        error = start_app_process(app)
        if error:
            return jsonify({"ok": False, "error": error}), 500

        # Re-check status
        time.sleep(1)
        new_status = get_app_status(app)
        return jsonify({
            "ok": new_status["running"],
            "url": new_status["url"],
            "message": "Started successfully." if new_status["running"] else "App starting...",
        })

    @app.route("/api/stop/<app_id>", methods=["POST"])
    def api_stop(app_id: str):
        error = stop_app_process(app_id)
        if error:
            return jsonify({"ok": False, "error": error}), 400
        return jsonify({"ok": True, "message": "Stopped."})

    @app.route("/api/status/<app_id>")
    def api_status(app_id: str):
        apps = load_apps()
        app = next((a for a in apps if a["id"] == app_id), None)
        if not app:
            return jsonify({"ok": False, "error": f"Unknown app: {app_id}"}), 404
        return jsonify(get_app_status(app))

    @app.route("/api/projects")
    def api_projects():
        """List all projects in the megarepo with metadata for the All Projects tab."""
        launcher_dir = Path(__file__).resolve().parent
        repo_root = launcher_dir.parent.parent.parent  # ../../ -> megarepo root
        projects = []

        # Scan active/ subdirectories for projects
        active_dir = repo_root / "active"
        if active_dir.exists():
            for area_dir in sorted(active_dir.iterdir()):
                if not area_dir.is_dir() or area_dir.name.startswith("."):
                    continue
                for proj_dir in sorted(area_dir.iterdir()):
                    if not proj_dir.is_dir() or proj_dir.name.startswith("."):
                        continue
                    # Determine type from path
                    parent_name = area_dir.name  # e.g., "games", "web-apps", "dev-tools"
                    type_map = {
                        "games": "game",
                        "web-apps": "webapp",
                        "dev-tools": "devtool",
                        "bots": "bot",
                        "personal": "config",
                    }
                    ptype = type_map.get(parent_name, "project")

                    # Check for README
                    readme_path = proj_dir / "README.md"
                    has_readme = readme_path.exists()

                    # Check for tests directory
                    tests_dir = proj_dir / "tests"
                    has_tests = tests_dir.exists()

                    # Try to find a description from README first line
                    description = ""
                    if has_readme:
                        try:
                            first_line = readme_path.read_text(encoding="utf-8").strip().split("\n")[0]
                            description = first_line.lstrip("# ").strip()
                        except Exception:
                            pass

                    # Map area icons
                    icon_map = {
                        "games": "🎮",
                        "web-apps": "🌐",
                        "dev-tools": "🔧",
                        "bots": "🤖",
                        "personal": "❄️",
                    }
                    icon = icon_map.get(parent_name, "📦")

                    proj_id = f"{parent_name}/{proj_dir.name}"
                    projects.append({
                        "id": proj_id,
                        "name": proj_dir.name,
                        "description": description,
                        "type": ptype,
                        "icon": icon,
                        "has_tests": has_tests,
                        "has_readme": has_readme,
                    })

        return jsonify(projects)

    @app.route("/api/projects/<path:project_id>/readme")
    def api_project_readme(project_id: str):
        """Return the README content for a project."""
        launcher_dir = Path(__file__).resolve().parent
        repo_root = launcher_dir.parent.parent.parent
        proj_path = repo_root / "active" / project_id
        readme_path = proj_path / "README.md"

        if not readme_path.exists():
            return jsonify({"ok": False, "error": "README not found"}), 404

        try:
            content = readme_path.read_text(encoding="utf-8")
            # Only first 2000 chars to avoid huge responses
            content = content[:2000]
            return jsonify({"ok": True, "name": proj_path.name, "content": content})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    return app


def main():
    port = int(os.getenv("LAUNCHER_PORT", str(DEFAULT_LAUNCHER_PORT)))
    app = create_app()
    print(f"🚀 Launcher dashboard at http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
