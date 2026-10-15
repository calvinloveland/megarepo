"""Gamebase application factory.

The factory wires configuration, the SQLite connection lifecycle, the page
views, the JSON API, and game asset hosting together. Both ``python -m
gamebase`` and the CLI use it, and tests build isolated instances.
"""

from __future__ import annotations

import os
import sqlite3

from flask import Flask, current_app, g, jsonify, render_template, request, send_file

from . import db, models
from .config import Settings
from .registry import ManifestError

__all__ = ["create_app", "get_db"]


def create_app(settings: Settings | None = None, *, sync_catalog: bool = True) -> Flask:
    settings = settings or Settings.from_env()

    app = Flask(
        __name__,
        template_folder=str(settings.template_dir),
        static_folder=str(settings.static_dir),
    )
    app.config["GAMEBASE"] = settings
    app.config["SECRET_KEY"] = "gamebase-dev-secret"
    app.config["GAMEBASE_RT_SECRET"] = os.environ.get("GAMEBASE_RT_SECRET") or app.config["SECRET_KEY"]
    app.config["MAX_CONTENT_LENGTH"] = settings.max_content_bytes

    @app.after_request
    def _security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        return response

    @app.teardown_appcontext
    def _close_db(exception: BaseException | None = None) -> None:
        connection = g.pop("db", None)
        if connection is not None:
            connection.close()

    from .api import api_bp
    from .views import views_bp

    app.register_blueprint(views_bp)
    app.register_blueprint(api_bp, url_prefix="/api")

    from . import realtime

    realtime.init_realtime(app)

    @app.get("/sdk/gamebase.js")
    def gamebase_sdk():
        return send_file(settings.static_dir / "sdk" / "gamebase.js", mimetype="application/javascript")

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    @app.context_processor
    def inject_theme():
        return {"theme": settings.theme}

    _register_error_handlers(app)
    rescan_state = _install_auto_rescan(app, settings)

    if sync_catalog:
        with app.app_context():
            models.sync_registry(get_db(), settings.registry_dir)
    try:
        rescan_state["mtime"] = settings.registry_dir.stat().st_mtime_ns
    except OSError:
        pass

    return app


def _install_auto_rescan(app: Flask, settings: Settings) -> dict:
    """Resync the catalog when the registry folder changes (dev convenience).

    Catches new/renamed game folders without a restart. Editing a manifest in
    place does not change the registry folder's mtime, so the catalog's Rescan
    button remains available for that case.
    """
    state: dict = {"mtime": None}

    @app.before_request
    def _rescan_if_registry_changed():
        if not settings.auto_rescan:
            return
        try:
            mtime = settings.registry_dir.stat().st_mtime_ns
        except OSError:
            return
        if state["mtime"] == mtime:
            return
        state["mtime"] = mtime
        models.sync_registry(get_db(), settings.registry_dir)

    return state


def get_db() -> sqlite3.Connection:
    """Return the request-scoped SQLite connection, creating it on first use."""
    if "db" not in g:
        settings: Settings = current_app.config["GAMEBASE"]
        connection = db.connect(settings.database_path)
        db.init_db(connection)
        g.db = connection
    return g.db


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ManifestError)
    def _manifest_error(error: ManifestError):
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(models.NotFound)
    def _not_found(error: models.NotFound):
        return jsonify({"error": str(error)}), 404

    @app.errorhandler(models.Conflict)
    def _conflict(error: models.Conflict):
        return jsonify({"error": str(error), "current_revision": error.current_revision}), 409

    @app.errorhandler(models.RateLimited)
    def _rate_limited(error: models.RateLimited):
        retry_after = int(error.retry_after + 0.999)
        response = jsonify({"error": str(error), "retry_after_seconds": round(error.retry_after, 3)})
        response.headers["Retry-After"] = str(retry_after)
        return response, 429

    @app.errorhandler(404)
    def _missing(error):
        if request.path.startswith("/api") or "application/json" in request.headers.get("Accept", ""):
            return jsonify({"error": "not found"}), 404
        return render_template("error.html", code=404, message="That page does not exist."), 404

    @app.errorhandler(413)
    def _too_large(error):
        if request.path.startswith("/api"):
            return jsonify({"error": "request body too large"}), 413
        return render_template("error.html", code=413, message="That request was too large."), 413

    @app.errorhandler(500)
    def _server_error(error):
        if request.path.startswith("/api"):
            return jsonify({"error": "internal server error"}), 500
        return render_template("error.html", code=500, message="Something went wrong."), 500


def main() -> None:  # pragma: no cover - thin entrypoint
    import os

    app = create_app()
    port = int(os.environ.get("PORT", "5120"))
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":  # pragma: no cover
    main()
