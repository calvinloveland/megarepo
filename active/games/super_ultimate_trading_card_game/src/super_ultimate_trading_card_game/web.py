from __future__ import annotations

import argparse
from pathlib import Path

from flask import Flask, redirect, render_template, request, url_for

from .card_ui import card_art_data_uri, normalize_card
from .models import CardKind
from .sim_api import (
    DEFAULT_BOT_IDS,
    DEFAULT_HUMAN_IDS,
    activate_deck_result,
    autoplay_live_match,
    create_live_match,
    deck_builder_result,
    generate_card_result,
    known_owner_ids,
    live_match_result,
    load_collection_result,
    recent_live_matches_result,
    recent_matches,
    run_playtest_batch,
    run_saved_match,
    save_deck_result,
    stored_match,
    submit_live_turn,
    advance_live_match,
)
from .storage import default_db_path, init_db


def create_app(config_overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY="dev",
        SUTCG_DB_PATH=str(default_db_path()),
    )
    if config_overrides:
        app.config.update(config_overrides)
    app.jinja_env.globals["normalize_card"] = normalize_card
    app.jinja_env.globals["card_art_uri"] = card_art_data_uri

    def _db_path() -> Path:
        db_path = Path(app.config["SUTCG_DB_PATH"])
        init_db(db_path)
        return db_path

    def _dashboard_context(owner_id: str, *, generated_card=None, playtest_summary=None):
        db_path = _db_path()
        collection = load_collection_result(owner_id=owner_id, db_path=db_path)
        return {
            "owner_id": owner_id,
            "collection": collection,
            "recent_matches": recent_matches(limit=12, db_path=db_path),
            "recent_live_matches": recent_live_matches_result(limit=12, db_path=db_path),
            "owner_ids": known_owner_ids(db_path=db_path),
            "bot_ids": DEFAULT_BOT_IDS,
            "human_ids": DEFAULT_HUMAN_IDS,
            "generated_card": generated_card,
            "playtest_summary": playtest_summary,
        }

    @app.get("/")
    def index():
        owner_id = request.args.get("owner_id", "player-one")
        return render_template("index.html", **_dashboard_context(owner_id))

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
        return render_template("index.html", **_dashboard_context("player-one", playtest_summary=summary))

    @app.post("/generate-card")
    def generate_card_route():
        prompt = (request.form.get("prompt") or "").strip()
        owner_id = (request.form.get("owner_id") or "player-one").strip()
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
        return render_template("index.html", **_dashboard_context(owner_id, generated_card=card))

    @app.post("/live/create")
    def create_live_match_route():
        mode = request.form.get("mode", "ai-vs-player")
        seed = int(request.form.get("seed", "1") or 1)
        generator = request.form.get("generator", "deterministic")
        left_owner_id = request.form.get("left_owner_id", "player-one")
        right_owner_id = request.form.get("right_owner_id", "alpha")
        if mode == "ai-vs-ai":
            left_controller = "ai"
            right_controller = "ai"
        elif mode == "player-vs-player":
            left_controller = "human"
            right_controller = "human"
        else:
            left_controller = "human"
            right_controller = "ai"
        match_id = create_live_match(
            mode=mode,
            left_owner_id=left_owner_id,
            right_owner_id=right_owner_id,
            left_controller=left_controller,
            right_controller=right_controller,
            generator_name=generator,
            seed=seed,
            db_path=_db_path(),
        )
        viewer_id = left_owner_id if left_controller == "human" else left_owner_id
        return redirect(url_for("live_match_detail", match_id=match_id, viewer_id=viewer_id))

    @app.get("/live")
    def live_matches_index():
        return render_template("live_matches.html", recent_live_matches=recent_live_matches_result(limit=50, db_path=_db_path()))

    @app.get("/live/<int:match_id>")
    def live_match_detail(match_id: int):
        viewer_id = request.args.get("viewer_id")
        return render_template("live_match.html", match=live_match_result(match_id=match_id, viewer_id=viewer_id, db_path=_db_path()))

    @app.post("/live/<int:match_id>/advance")
    def advance_live_match_route(match_id: int):
        state = advance_live_match(match_id=match_id, db_path=_db_path())
        viewer_id = request.form.get("viewer_id") or state["left"]["owner_id"]
        return redirect(url_for("live_match_detail", match_id=match_id, viewer_id=viewer_id))

    @app.post("/live/<int:match_id>/autoplay")
    def autoplay_live_match_route(match_id: int):
        state = autoplay_live_match(match_id=match_id, db_path=_db_path())
        viewer_id = request.form.get("viewer_id") or state["left"]["owner_id"]
        return redirect(url_for("live_match_detail", match_id=match_id, viewer_id=viewer_id))

    @app.post("/live/<int:match_id>/submit-turn")
    def submit_live_turn_route(match_id: int):
        viewer_id = (request.form.get("viewer_id") or "").strip()
        plays = []
        for index in range(1, 3):
            plays.append(
                {
                    "card_id": request.form.get(f"play_{index}_card_id", ""),
                    "track": request.form.get(f"play_{index}_track", "fast"),
                    "stationary": request.form.get(f"play_{index}_stationary") == "on",
                }
            )
        submit_live_turn(
            match_id=match_id,
            player_id=viewer_id,
            prompt=request.form.get("generate_prompt", ""),
            plays=plays,
            db_path=_db_path(),
        )
        return redirect(url_for("live_match_detail", match_id=match_id, viewer_id=viewer_id))

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

    @app.get("/decks/<owner_id>")
    def decks_detail(owner_id: str):
        return render_template("decks.html", deck_data=deck_builder_result(owner_id=owner_id, db_path=_db_path()))

    @app.post("/decks/<owner_id>/save")
    def save_deck_route(owner_id: str):
        card_ids = [request.form.get(f"slot_{index}", "") for index in range(1, 7)]
        raw_deck_id = (request.form.get("deck_id") or "").strip()
        save_deck_result(
            owner_id=owner_id,
            name=request.form.get("name", "Custom Deck"),
            base_card_id=request.form.get("base_card_id", ""),
            card_ids=card_ids,
            db_path=_db_path(),
            deck_id=int(raw_deck_id) if raw_deck_id else None,
            activate=request.form.get("activate", "on") == "on",
        )
        return redirect(url_for("decks_detail", owner_id=owner_id))

    @app.post("/decks/<owner_id>/activate")
    def activate_deck_route(owner_id: str):
        activate_deck_result(owner_id=owner_id, deck_id=int(request.form["deck_id"]), db_path=_db_path())
        return redirect(url_for("decks_detail", owner_id=owner_id))

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
