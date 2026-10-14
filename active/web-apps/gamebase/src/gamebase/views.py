"""Server-rendered pages for the Gamebase catalog and game pages."""

from __future__ import annotations

from flask import Blueprint, abort, flash, redirect, render_template, request, send_file, url_for

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


@views_bp.route("/create", methods=["GET", "POST"])
def create_page():
    if request.method == "POST":
        form = request.form
        try:
            manifest = registry.scaffold_game(
                _settings().registry_dir,
                str(form.get("slug") or "").strip(),
                title=str(form.get("title") or "").strip(),
                author=str(form.get("author") or "").strip(),
                description=str(form.get("description") or "").strip(),
                template_dir=_settings().project_root / "templates_scaffold",
            )
        except registry.ManifestError as error:
            flash(str(error), "error")
            return render_template("create.html", form=form), 400
        models.sync_registry(get_db(), _settings().registry_dir)
        flash(f"Created {manifest.title}. Edit registry/{manifest.slug}/ and publish.", "success")
        return redirect(url_for("views.game_page", slug=manifest.slug))
    return render_template("create.html", form={})


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
    resolved = registry.game_asset_path(_settings().registry_dir, slug, requested)
    if resolved is None or not resolved.is_file():
        abort(404)
    return send_file(resolved)
