"""Reusable feedback routes and template loader helpers."""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime
from hmac import compare_digest
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from flask import Blueprint, Flask, Response, current_app, jsonify, request
from jinja2 import ChoiceLoader, FileSystemLoader

SHARED_TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "templates"


def feedback_storage_paths(project_root: Path) -> Tuple[Path, Path]:
    feedback_dir = project_root / "data" / "feedback"
    return feedback_dir, feedback_dir / "addressed"


def enable_shared_feedback(
    app: Flask,
    *,
    project_root: Path,
    app_name: str,
    feedback_dir: Optional[Path] = None,
    addressed_dir: Optional[Path] = None,
) -> Tuple[Path, Path]:
    if app.jinja_loader is not None and SHARED_TEMPLATES_DIR.exists():
        app.jinja_loader = ChoiceLoader(
            [app.jinja_loader, FileSystemLoader(str(SHARED_TEMPLATES_DIR))]
        )

    default_feedback_dir, default_addressed_dir = feedback_storage_paths(project_root)
    resolved_feedback_dir = feedback_dir or default_feedback_dir
    resolved_addressed_dir = addressed_dir or default_addressed_dir
    _register_feedback_blueprint(
        app,
        app_name=app_name,
        project_root=project_root,
        feedback_dir=resolved_feedback_dir,
        addressed_dir=resolved_addressed_dir,
    )
    return resolved_feedback_dir, resolved_addressed_dir


def _register_feedback_blueprint(
    app: Flask,
    *,
    app_name: str,
    project_root: Path,
    feedback_dir: Path,
    addressed_dir: Path,
) -> None:
    slug = re.sub(r"[^a-z0-9]+", "-", app_name.strip().lower()).strip("-") or "app"
    feedback_bp = Blueprint(f"{slug}_feedback", __name__)

    @feedback_bp.get("/feedback")
    def list_feedback() -> Response:
        auth_error = _require_feedback_auth(app_name)
        if auth_error:
            return auth_error

        return jsonify(
            {
                "open": _feedback_entries(feedback_dir),
                "addressed": _feedback_entries(addressed_dir),
            }
        )

    @feedback_bp.post("/feedback")
    def submit_feedback() -> Response:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return Response("Invalid feedback payload", status=400)

        feedback_text = str(data.get("feedback_text", "")).strip()
        selected_element = str(data.get("selected_element", "")).strip()
        raw_page_path = str(data.get("page_path", "")).strip()
        page_title = str(data.get("page_title", "")).strip()
        if not feedback_text:
            return Response("Feedback text is required", status=400)
        if len(feedback_text) > 5000:
            return Response("Feedback text must be < 5000 characters", status=400)
        if len(selected_element) > 500:
            return Response("Selected element must be < 500 characters", status=400)
        if len(raw_page_path) > 1000:
            return Response("Page path must be < 1000 characters", status=400)
        if len(page_title) > 500:
            return Response("Page title must be < 500 characters", status=400)

        feedback_dir.mkdir(parents=True, exist_ok=True)
        addressed_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filepath = feedback_dir / f"feedback_{timestamp}.json"

        app_version = os.getenv("APP_VERSION", "dev")
        git_commit = _resolve_git_commit(project_root)
        page_path = _normalize_page_path(raw_page_path) or _normalize_page_path(
            request.headers.get("Referer", "")
        )

        payload = {
            "feedback_text": feedback_text,
            "selected_element": selected_element or None,
            "app": app_name,
            "page_path": page_path or None,
            "page_title": page_title or None,
            "design": str(data.get("design", "unknown")),
            "timestamp": data.get("timestamp"),
            "server_timestamp": datetime.now().isoformat(),
            "version": app_version,
            "git_commit": git_commit,
            "addressed_by_commit": None,
            "addressed": False,
        }

        with open(filepath, "w", encoding="utf-8") as file_handle:
            json.dump(payload, file_handle, indent=2)

        return jsonify({"status": "success", "message": "Feedback saved", "id": timestamp})

    @feedback_bp.post("/feedback/mark-addressed")
    def mark_feedback_addressed() -> Response:
        auth_error = _require_feedback_auth(app_name)
        if auth_error:
            return auth_error

        payload = request.get_json(silent=True) or {}
        feedback_id = str(payload.get("id", "")).strip()
        filename = str(payload.get("filename", "")).strip()
        raw_addressed_commit = payload.get("addressed_by_commit")
        addressed_by_commit = (
            str(raw_addressed_commit).strip() if raw_addressed_commit is not None else ""
        )

        if len(addressed_by_commit) > 200:
            return Response("Addressing commit must be < 200 characters", status=400)

        if feedback_id:
            file_pattern = f"feedback_{feedback_id}.json"
        elif filename:
            file_pattern = filename
        else:
            return Response("Missing feedback id or filename", status=400)

        source_path = feedback_dir / file_pattern
        if not source_path.exists():
            return Response("Feedback file not found", status=404)

        with open(source_path, encoding="utf-8") as file_handle:
            data = json.load(file_handle)

        data["addressed"] = True
        data["addressed_timestamp"] = datetime.now().isoformat()
        data["addressed_by_commit"] = addressed_by_commit or None

        addressed_dir.mkdir(parents=True, exist_ok=True)
        target_path = addressed_dir / source_path.name
        with open(target_path, "w", encoding="utf-8") as file_handle:
            json.dump(data, file_handle, indent=2)

        source_path.unlink(missing_ok=True)
        return jsonify({"status": "success", "message": "Feedback marked as addressed"})

    app.register_blueprint(feedback_bp)


def _require_feedback_auth(app_name: str) -> Optional[Response]:
    username = os.getenv("FEEDBACK_ADMIN_USERNAME", "").strip()
    password = os.getenv("FEEDBACK_ADMIN_PASSWORD", "")
    if not username or not password:
        current_app.logger.error("Feedback auth credentials are not configured")
        return Response("Feedback auth is not configured", status=503)

    unauthorized = Response("Authentication required", status=401)
    unauthorized.headers["WWW-Authenticate"] = f'Basic realm="{app_name} Feedback"'

    auth = request.authorization
    if not auth or auth.type.lower() != "basic":
        return unauthorized

    provided_username = auth.username or ""
    provided_password = auth.password or ""
    if not compare_digest(provided_username, username) or not compare_digest(
        provided_password, password
    ):
        return unauthorized

    return None


def _feedback_entries(directory: Path) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []
    if not directory.exists():
        return entries

    feedback_files = sorted(
        directory.glob("feedback_*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for feedback_file in feedback_files:
        with open(feedback_file, encoding="utf-8") as file_handle:
            payload = json.load(file_handle)
        if not isinstance(payload, dict):
            continue
        payload["id"] = feedback_file.stem.replace("feedback_", "", 1)
        payload["filename"] = feedback_file.name
        entries.append(payload)

    return entries


def _resolve_git_commit(project_root: Path) -> str:
    git_commit = os.getenv("GIT_COMMIT", "unknown")
    if git_commit != "unknown":
        return git_commit
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%h"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        current_app.logger.debug("Unable to resolve git commit hash", exc_info=True)
        return "unknown"
    if result.returncode != 0:
        return "unknown"
    return result.stdout.strip() or "unknown"


def _normalize_page_path(raw_value: str) -> str:
    value = raw_value.strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        if not parsed.path:
            return "/"
        return f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
    return value
