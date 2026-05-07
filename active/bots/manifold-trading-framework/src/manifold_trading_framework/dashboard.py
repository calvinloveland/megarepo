from __future__ import annotations

from pathlib import Path

from flask import Flask, abort, jsonify, render_template

from .dashboard_data import load_artifact_detail, load_dashboard_snapshot, list_artifact_paths


def create_app(*, run_dir: Path, project_root: Path) -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["RUN_DIR"] = Path(run_dir)
    app.config["PROJECT_ROOT"] = Path(project_root)

    def worker_dir() -> Path:
        return Path(app.config["PROJECT_ROOT"]) / ".pi" / "workers"

    def plan_path() -> Path:
        return Path(app.config["PROJECT_ROOT"]) / "docs" / "multi-agent-hiring-plan.md"

    def artifact_paths_by_id() -> dict[str, Path]:
        return {path.stem: path for path in list_artifact_paths(Path(app.config["RUN_DIR"]))}

    @app.get("/")
    def index():
        snapshot = load_dashboard_snapshot(Path(app.config["RUN_DIR"]), worker_dir(), plan_path())
        return render_template("dashboard.html", initial_state=snapshot)

    @app.get("/api/dashboard")
    def dashboard_api():
        return jsonify(load_dashboard_snapshot(Path(app.config["RUN_DIR"]), worker_dir(), plan_path()))

    @app.get("/api/artifacts/<artifact_id>")
    def artifact_detail(artifact_id: str):
        path = artifact_paths_by_id().get(artifact_id)
        if path is None:
            abort(404, description=f"Unknown artifact: {artifact_id}")
        return jsonify(load_artifact_detail(path))

    return app


def run_dashboard(*, run_dir: Path, project_root: Path, host: str = "127.0.0.1", port: int = 5000, debug: bool = False) -> None:
    app = create_app(run_dir=run_dir, project_root=project_root)
    app.run(host=host, port=port, debug=debug)
