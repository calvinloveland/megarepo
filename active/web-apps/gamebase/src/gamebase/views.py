"""Server-rendered pages for the Gamebase catalog and game pages."""

from __future__ import annotations

from flask import Blueprint, Response, abort, redirect, render_template, request, send_file, url_for

from . import models, registry
from .app import get_db
from .config import Settings

views_bp = Blueprint("views", __name__)


def _settings() -> Settings:
    from flask import current_app

    return current_app.config["GAMEBASE"]


@views_bp.get("/")
def index():
    connection = get_db()
    games = models.list_games(connection)
    cards = []
    for game in games:
        order = (game["capabilities"].get("leaderboard") or {}).get("order", "desc")
        cards.append(
            {
                **game,
                "top_score": (models.leaderboard(connection, game["slug"], limit=1, order=order) or [None])[0],
                "achievement_count": len(game["capabilities"].get("achievements") or []),
            }
        )
    return render_template("index.html", cards=cards, game_count=len(cards))


@views_bp.get("/g/<slug>")
def game_page(slug: str):
    connection = get_db()
    game = models.get_game(connection, slug)
    if game is None:
        abort(404)
    order = (game["capabilities"].get("leaderboard") or {}).get("order", "desc")
    return render_template(
        "game.html",
        game=game,
        leaderboard=models.leaderboard(connection, slug, limit=10, order=order),
        achievements=models.list_achievements(connection, slug),
        versions=models.list_versions(connection, slug),
        lineage=models.remix_lineage(connection, slug),
    )


@views_bp.get("/players/<handle>")
def player_page(handle: str):
    connection = get_db()
    player = models.get_player_by_handle(connection, handle)
    if player is None:
        abort(404)
    return render_template(
        "player.html",
        player=player,
        achievements=models.player_achievements(connection, player["id"]),
        points=models.achievement_points(connection, player["id"]),
    )


@views_bp.route("/create", methods=["GET"])
def create_page():
    """Agent-facing instructions: one link an agent can read and follow."""
    base = request.url_root.rstrip("/")
    return render_template("create.html", guide=_guide_text(), agent_url=f"{base}/agent.md")


@views_bp.get("/agent.md")
def agent_guide():
    return Response(_guide_text(), mimetype="text/markdown")


@views_bp.get("/llms.txt")
def llms_txt():
    base = request.url_root.rstrip("/")
    body = (
        "# Gamebase\n\n"
        f"Build and publish a game: {base}/agent.md\n"
        f"Catalog API: {base}/api/games\n"
        f"SDK: {base}/sdk/gamebase.js\n"
    )
    return Response(body, mimetype="text/plain")


def _guide_text() -> str:
    path = _settings().project_root / "AGENT_GUIDE.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return "# Gamebase\n\nSee /agent.md for how to build a game."


@views_bp.get("/play/<slug>")
def play_redirect(slug: str):
    return redirect(url_for("views.play_asset", slug=slug, asset=""), code=302)


@views_bp.get("/play/<slug>/")
@views_bp.get("/play/<slug>/<path:asset>")
def play_asset(slug: str, asset: str | None = None):
    connection = get_db()
    game = models.get_game(connection, slug)
    if game is None:
        abort(404)
    requested = asset or game["entry"]
    if registry.is_private_asset(requested):
        abort(404)
    resolved = registry.game_asset_path(_settings().registry_dir, slug, requested)
    if resolved is None or not resolved.is_file():
        abort(404)
    return send_file(resolved)
