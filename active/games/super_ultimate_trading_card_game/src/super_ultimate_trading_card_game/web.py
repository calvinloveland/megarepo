from __future__ import annotations

import argparse
from pathlib import Path

from flask import Flask, redirect, render_template, request, url_for

from .models import CardKind
from .sim_api import DEFAULT_BOT_IDS, load_collection_result, recent_matches, run_playtest_batch, run_saved_match, stored_match
from .sim_api import generate_card_result
from .storage import default_db_path, init_db


def create_app(config_overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY="dev",
        SUTCG_DB_PATH=str(default_db_path()),
    )
    if config_overrides:
        app.config.update(config_overrides)

    def _db_path() -> Path:
        db_path = Path(app.config["SUTCG_DB_PATH"])
        init_db(db_path)
        return db_path

    @app.get("/")
    def index():
        owner_id = request.args.get("owner_id", "alpha")
        collection = load_collection_result(owner_id=owner_id, db_path=_db_path())
        matches = recent_matches(limit=12, db_path=_db_path())
        return render_template(
            "index.html",
            owner_id=owner_id,
            collection=collection,
            recent_matches=matches,
            bot_ids=DEFAULT_BOT_IDS,
            generated_card=None,
            playtest_summary=None,
        )

    @app.post("/run-match")
    def run_match_route():
        seed = int(request.form.get("seed", "1") or 1)
        generator = request.form.get("generator", "auto")
        left_id = request.form.get("left_id", "alpha")
        right_id = request.form.get("right_id", "beta")
        match_id, _result = run_saved_match(
            seed=seed,
            generator_name=generator,
            left_id=left_id,
            right_id=right_id,
            db_path=_db_path(),
        )
        return redirect(url_for("match_detail", match_id=match_id))

    @app.post("/run-playtest")
    def run_playtest_route():
        matches_count = int(request.form.get("matches", "20") or 20)
        seed = int(request.form.get("seed", "1") or 1)
        generator = request.form.get("generator", "auto")
        summary = run_playtest_batch(
            matches=matches_count,
            seed=seed,
            generator_name=generator,
            db_path=_db_path(),
        )
        collection = load_collection_result(owner_id="alpha", db_path=_db_path())
        matches = recent_matches(limit=12, db_path=_db_path())
        return render_template(
            "index.html",
            owner_id="alpha",
            collection=collection,
            recent_matches=matches,
            bot_ids=DEFAULT_BOT_IDS,
            generated_card=None,
            playtest_summary=summary,
        )

    @app.post("/generate-card")
    def generate_card_route():
        prompt = (request.form.get("prompt") or "").strip()
        owner_id = (request.form.get("owner_id") or "preview").strip()
        kind = CardKind(request.form.get("kind", "unit"))
        generator = request.form.get("generator", "auto")
        save = request.form.get("save") == "on"
        card = generate_card_result(
            prompt=prompt,
            kind=kind,
            generator_name=generator,
            owner_id=owner_id,
            db_path=_db_path(),
            save=save,
        )
        collection = load_collection_result(owner_id=owner_id, db_path=_db_path(), ensure_seed=False)
        matches = recent_matches(limit=12, db_path=_db_path())
        return render_template(
            "index.html",
            owner_id=owner_id,
            collection=collection,
            recent_matches=matches,
            bot_ids=DEFAULT_BOT_IDS,
            generated_card=card,
            playtest_summary=None,
        )

    @app.get("/matches")
    def matches_index():
        return render_template("matches.html", recent_matches=recent_matches(limit=50, db_path=_db_path()))

    @app.get("/matches/<int:match_id>")
    def match_detail(match_id: int):
        match = stored_match(match_id, db_path=_db_path())
        if match is None:
            return redirect(url_for("matches_index"))
        return render_template("match_detail.html", match=match)

    @app.get("/collections/<owner_id>")
    def collection_detail(owner_id: str):
        collection = load_collection_result(owner_id=owner_id, db_path=_db_path())
        return render_template("collection.html", collection=collection, owner_id=owner_id)

    return app


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the SUTCG web UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--db", default=str(default_db_path()))
    args = parser.parse_args()

    app = create_app({"SUTCG_DB_PATH": args.db})
    app.run(host=args.host, port=args.port, debug=args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
