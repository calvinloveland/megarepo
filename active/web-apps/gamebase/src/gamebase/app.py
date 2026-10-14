"""Gamebase application factory.

The factory wires configuration, the SQLite connection lifecycle, the page
views, the JSON API, and game asset hosting together. Both ``python -m
gamebase`` and the CLI use it, and tests build isolated instances.
"""

from __future__ import annotations

import sqlite3

from flask import Flask, current_app, g, jsonify, send_file

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

    @app.teardown_appcontext
    def _close_db(exception: BaseException | None = None) -> None:
        connection = g.pop("db", None)
        if connection is not None:
            connection.close()

    from .api import api_bp
    from .views import views_bp

    app.register_blueprint(views_bp)
    app.register_blueprint(api_bp, url_prefix="/api")

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

    if sync_catalog:
        with app.app_context():
            models.sync_registry(get_db(), settings.registry_dir)

    return app


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

    @app.errorhandler(models.RateLimited)
    def _rate_limited(error: models.RateLimited):
        return jsonify({"error": str(error)}), 429

    @app.errorhandler(404)
    def _missing(error):
        return jsonify({"error": "not found"}), 404


def main() -> None:  # pragma: no cover - thin entrypoint
    import os

    app = create_app()
    port = int(os.environ.get("PORT", "5120"))
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":  # pragma: no cover
    main()
