"""Flask app for the drop file receiver."""

from __future__ import annotations

import os

from flask import (
    Flask,
    abort,
    jsonify,
    render_template,
    request,
    send_file,
)

from . import (
    DATA_DIR,
    MAX_PREVIEW_BYTES,
    MAX_TOTAL_STORAGE_MB,
    MAX_UPLOAD_MB,
    UPLOADS_DIR,
    __version__,
)
from .preview import preview_for
from .storage import (
    StorageFullError,
    StoredFile,
    add_file,
    delete_file,
    get_file,
    list_files,
    read_file_bytes,
    storage_remaining_bytes,
    total_bytes,
    total_bytes_human,
)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app() -> Flask:
    """Build and return a configured Flask app instance.

    Kept as a factory so tests can spin up isolated app instances with
    custom config (e.g. lower MAX_CONTENT_LENGTH for upload-cap tests).
    """
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Pages ─────────────────────────────────────────────────────────

    @app.route("/")
    def index():
        return render_template(
            "index.html",
            version=__version__,
            max_upload_mb=MAX_UPLOAD_MB,
            max_total_mb=MAX_TOTAL_STORAGE_MB,
        )

    # ── JSON API ──────────────────────────────────────────────────────

    @app.route("/api/status")
    def api_status():
        files = list_files()
        return jsonify({
            "ok": True,
            "version": __version__,
            "storage": {
                "used_bytes": total_bytes(),
                "used_human": total_bytes_human(),
                "remaining_bytes": storage_remaining_bytes(),
                "max_per_file_mb": MAX_UPLOAD_MB,
                "max_total_mb": MAX_TOTAL_STORAGE_MB,
            },
            "files_count": len(files),
        })

    @app.route("/api/files", methods=["GET"])
    def api_files():
        """List all stored files, newest first."""
        return jsonify({
            "ok": True,
            "files": [_file_to_dict(f) for f in list_files()],
        })

    @app.route("/api/files", methods=["POST"])
    def api_files_upload():
        """Accept one or more file uploads.

        Multipart form field name: `file` (repeatable).
        Returns a JSON list of new file metadata.
        """
        uploads = request.files.getlist("file")
        if not uploads:
            return jsonify({
                "ok": False,
                "error": "No files in request. Use multipart field 'file'.",
            }), 400

        results: list[dict] = []
        errors: list[dict] = []

        for upload in uploads:
            filename = upload.filename or "unnamed"
            content_type = upload.mimetype or "application/octet-stream"
            data = upload.read()
            if not data:
                errors.append({"name": filename, "error": "Empty file."})
                continue
            try:
                stored = add_file(name=filename, content_type=content_type, data=data)
            except StorageFullError as exc:
                return jsonify({"ok": False, "error": str(exc)}), 413
            except (OSError, ValueError, TypeError) as exc:
                # Catch only the expected per-file failure modes; let
                # unexpected exceptions propagate so they show up in logs.
                errors.append({"name": filename, "error": str(exc)})
                continue
            results.append(_file_to_dict(stored))

        return jsonify({"ok": True, "uploaded": results, "errors": errors})

    @app.route("/api/files/<file_id>", methods=["GET"])
    def api_file_metadata(file_id: str):
        f = get_file(file_id)
        if not f:
            abort(404)
        return jsonify({"ok": True, "file": _file_to_dict(f)})

    @app.route("/api/files/<file_id>/preview", methods=["GET"])
    def api_file_preview(file_id: str):
        f = get_file(file_id)
        if not f:
            abort(404)
        data = read_file_bytes(file_id)
        if data is None:
            abort(404)
        # Truncate the bytes we feed to the previewer.
        preview_data = data[:MAX_PREVIEW_BYTES]
        result = preview_for(f.content_type, f.name, preview_data)
        result["file_id"] = f.id
        result["name"] = f.name
        result["size_bytes"] = f.size
        return jsonify(result)

    @app.route("/api/files/<file_id>", methods=["DELETE"])
    def api_file_delete(file_id: str):
        deleted = delete_file(file_id)
        if not deleted:
            abort(404)
        return jsonify({"ok": True, "deleted": file_id})

    # ── Raw file access (download + image preview) ────────────────────

    @app.route("/files/<file_id>")
    def files_download(file_id: str):
        """Stream the raw file bytes. Used for download and image preview."""
        f = get_file(file_id)
        if not f:
            abort(404)
        if not read_file_bytes(file_id):
            abort(404)
        return send_file(
            UPLOADS_DIR / file_id,
            mimetype=f.content_type,
            as_attachment=False,
            download_name=f.safe_name,
            max_age=3600,
        )

    @app.route("/files/<file_id>/download")
    def files_download_forced(file_id: str):
        """Force a Content-Disposition: attachment download."""
        f = get_file(file_id)
        if not f:
            abort(404)
        if not read_file_bytes(file_id):
            abort(404)
        return send_file(
            UPLOADS_DIR / file_id,
            mimetype=f.content_type,
            as_attachment=True,
            download_name=f.safe_name,
        )

    # ── Error handlers ────────────────────────────────────────────────

    @app.errorhandler(413)
    def too_large(_e):
        return jsonify({
            "ok": False,
            "error": f"File exceeds the {MAX_UPLOAD_MB} MB per-upload limit.",
        }), 413

    @app.errorhandler(404)
    def not_found(_e):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "Not found"}), 404
        return ("Not found", 404)

    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _file_to_dict(f: StoredFile) -> dict:
    """Convert a StoredFile into the JSON shape returned by the API."""
    d = f.to_dict()
    d["size_human"] = f.size_human
    d["download_url"] = f"/files/{f.id}/download"
    d["raw_url"] = f"/files/{f.id}"
    d["preview_url"] = f"/api/files/{f.id}/preview"
    return d


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """CLI entry point: parse env vars and run the Flask development server."""
    port = int(os.environ.get("PORT", "5111"))
    # Bind 0.0.0.0 so phones on the LAN can reach the app. The Cloudflare
    # tunnel and the launcher's port check loopback, so this doesn't widen
    # the public attack surface beyond the tunnel.
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app = create_app()
    print(f"📥 drop — drag-and-drop file receiver on http://{host}:{port}")
    app.run(host=host, port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    main()
