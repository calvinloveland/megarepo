"""JSON API for Gamebase games and players.

Auth is a bearer token issued by ``POST /api/identity``. Game clients call
these endpoints through the JavaScript SDK (``/sdk/gamebase.js``) rather than
talking to them directly.
"""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from flask import Blueprint, current_app, jsonify, request

from . import models, registry
from .app import get_db
from .config import Settings

api_bp = Blueprint("api", __name__)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _settings() -> Settings:
    return current_app.config["GAMEBASE"]


def _json_body() -> dict[str, Any]:
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _token_from_request() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    explicit = request.headers.get("X-Gamebase-Token")
    if explicit:
        return explicit.strip()
    return _json_body().get("token")


def current_player() -> dict[str, Any] | None:
    return models.player_for_token(get_db(), _token_from_request())


def require_player(view: Callable) -> Callable:
    """Decorator: resolve the bearer token or return 401."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        player = current_player()
        if player is None:
            return jsonify({"error": "authentication required"}), 401
        return view(player, *args, **kwargs)

    return wrapper


def _require_game(slug: str) -> dict[str, Any] | None:
    return models.get_game(get_db(), slug)


def _serialize_game(game: dict[str, Any]) -> dict[str, Any]:
    connection = get_db()
    top = models.leaderboard(
        connection,
        game["slug"],
        limit=3,
        order=(game["capabilities"].get("leaderboard") or {}).get("order", "desc"),
    )
    return {**game, "top_scores": top}


# ── Identity ────────────────────────────────────────────────────────────────


@api_bp.post("/identity")
def create_identity():
    body = _json_body()
    handle = body.get("handle")
    if handle is not None and (not isinstance(handle, str) or not handle.strip()):
        return jsonify({"error": "handle must be a non-empty string"}), 400
    try:
        result = models.create_player(get_db(), handle.strip() if handle else None)
    except ValueError as error:
        return jsonify({"error": str(error)}), 409
    return jsonify({"token": result["token"], "player": result["player"]}), 201


@api_bp.get("/me")
@require_player
def me(player: dict[str, Any]):
    connection = get_db()
    achievements = models.player_achievements(connection, player["id"])
    return jsonify(
        {
            "player": player,
            "points": models.achievement_points(connection, player["id"]),
            "achievements": achievements,
        }
    )


# ── Catalog ─────────────────────────────────────────────────────────────────


@api_bp.get("/games")
def list_games():
    games = models.list_games(get_db())
    return jsonify({"games": [_serialize_game(game) for game in games]})


@api_bp.get("/games/<slug>")
def get_game(slug: str):
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    payload = _serialize_game(game)
    payload["versions"] = models.list_versions(get_db(), slug)
    payload["lineage"] = models.remix_lineage(get_db(), slug)
    return jsonify(payload)


@api_bp.get("/games/<slug>/leaderboard")
def leaderboard(slug: str):
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    try:
        limit = max(1, min(int(request.args.get("limit", 10)), 100))
    except ValueError:
        limit = 10
    order = (game["capabilities"].get("leaderboard") or {}).get("order", "desc")
    player = current_player()
    return jsonify(
        {
            "leaderboard": models.leaderboard(
                get_db(), slug, limit=limit, order=order, viewer_id=player["id"] if player else None
            )
        }
    )


@api_bp.get("/games/<slug>/my-best")
def my_best(slug: str):
    """The current player's best score and rank, even outside the top 100."""
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    player = current_player()
    if player is None:
        return jsonify({"error": "authentication required"}), 401
    order = (game["capabilities"].get("leaderboard") or {}).get("order", "desc")
    entry = models.player_best_entry(get_db(), slug, player["id"], order=order)
    if entry is None:
        return jsonify({"best": None, "rank": None})
    return jsonify(
        {
            "best": entry["score"],
            "rank": entry["rank"],
            "is_me": True,
            "achieved_at": entry["created_at"],
        }
    )


# ── Scores ──────────────────────────────────────────────────────────────────


@api_bp.post("/games/<slug>/scores")
@require_player
def submit_score(player: dict[str, Any], slug: str):
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    if not game["capabilities"].get("leaderboard"):
        return jsonify({"error": "this game does not declare a leaderboard"}), 400
    body = _json_body()
    try:
        result = models.submit_score(
            get_db(),
            game,
            player["id"],
            body.get("score"),
            body.get("meta"),
            rate_limit_seconds=_settings().score_rate_limit_seconds,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(result), 201


# ── Achievements ────────────────────────────────────────────────────────────


@api_bp.get("/games/<slug>/achievements")
def achievements(slug: str):
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    connection = get_db()
    player = current_player()
    unlocked = models.unlocked_achievement_ids(connection, player["id"], slug) if player else set()
    items = []
    for achievement in models.list_achievements(connection, slug):
        if achievement["hidden"] and achievement["id"] not in unlocked:
            continue
        items.append({**achievement, "unlocked": achievement["id"] in unlocked})
    return jsonify({"achievements": items})


@api_bp.post("/games/<slug>/achievements/<achievement_id>")
@require_player
def unlock_achievement(player: dict[str, Any], slug: str, achievement_id: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    unlocked = models.unlock_achievement(get_db(), slug, player["id"], achievement_id)
    return jsonify({"unlocked": unlocked, "already_unlocked": unlocked is None}), (201 if unlocked else 200)


@api_bp.post("/games/<slug>/achievements")
@require_player
def unlock_achievements(player: dict[str, Any], slug: str):
    """Batch-unlock achievements in one request (game-over handoff)."""
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    ids = _json_body().get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(item, str) for item in ids):
        return jsonify({"error": "ids must be a non-empty list of strings"}), 400
    result = models.unlock_achievements(get_db(), slug, player["id"], ids)
    return jsonify(result), 201 if result["unlocked"] else 200


# ── Matchmaking ─────────────────────────────────────────────────────────────


@api_bp.post("/games/<slug>/matchmaking")
@require_player
def join_matchmaking(player: dict[str, Any], slug: str):
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    config = game["capabilities"].get("matchmaking")
    if not config:
        return jsonify({"error": "this game does not support matchmaking"}), 400
    ticket = models.queue_for_match(get_db(), slug, player["id"], int(config.get("players", 2)))
    return jsonify(ticket), 201 if ticket["status"] == "matched" else 200


@api_bp.get("/games/<slug>/matchmaking")
@require_player
def matchmaking_status(player: dict[str, Any], slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    ticket = models.open_ticket(get_db(), slug, player["id"])
    return jsonify({"ticket": ticket})


@api_bp.delete("/games/<slug>/matchmaking")
@require_player
def leave_matchmaking(player: dict[str, Any], slug: str):
    cancelled = models.cancel_ticket(get_db(), slug, player["id"])
    return jsonify({"cancelled": cancelled})


@api_bp.get("/matches/<match_id>")
def get_match(match_id: str):
    match = models.get_match(get_db(), match_id)
    if match is None:
        return jsonify({"error": f"match not found: {match_id}"}), 404
    return jsonify(match)


@api_bp.post("/matches/<match_id>/result")
@require_player
def report_result(player: dict[str, Any], match_id: str):
    body = _json_body()
    try:
        match = models.report_match_result(get_db(), match_id, player["id"], body.get("result") or {})
    except models.NotFound as error:
        return jsonify({"error": str(error)}), 404
    except PermissionError as error:
        return jsonify({"error": str(error)}), 403
    return jsonify(match)


# ── Remix, publish, and rescan ──────────────────────────────────────────────


@api_bp.post("/games/<slug>/remix")
@require_player
def remix(player: dict[str, Any], slug: str):
    body = _json_body()
    new_slug = str(body.get("new_slug") or "").strip()
    if not new_slug:
        return jsonify({"error": "new_slug is required"}), 400
    registry_dir = _settings().registry_dir
    try:
        manifest = registry.remix_game(
            registry_dir,
            slug,
            new_slug,
            title=body.get("title"),
            author=player["handle"],
        )
    except registry.ManifestError as error:
        return jsonify({"error": str(error)}), 400
    models.sync_registry(get_db(), registry_dir)
    models.record_remix(get_db(), slug, manifest.slug, player["id"])
    return jsonify(manifest.to_dict()), 201


@api_bp.post("/games/<slug>/publish")
@require_player
def publish(player: dict[str, Any], slug: str):
    registry_dir = _settings().registry_dir
    try:
        manifest = registry.read_manifest(registry_dir / slug)
    except registry.ManifestError as error:
        return jsonify({"error": str(error)}), 400
    body = _json_body()
    models.sync_registry(get_db(), registry_dir)
    models.record_version(get_db(), manifest, str(body.get("changelog") or "Update"))
    return jsonify(manifest.to_dict())


@api_bp.post("/rescan")
def rescan():
    registry_dir = _settings().registry_dir
    manifests = models.sync_registry(get_db(), registry_dir)
    return jsonify({"games": sorted(manifests.keys())})


@api_bp.post("/games")
@require_player
def publish_game(player: dict[str, Any]):
    """Create or update a game from a manifest + text files (push API)."""
    body = _json_body()
    manifest_data = body.get("manifest")
    if not isinstance(manifest_data, dict):
        return jsonify({"error": "manifest mapping is required"}), 400
    registry_dir = _settings().registry_dir
    files = body.get("files")

    slug = manifest_data.get("slug")
    existing = models.get_game(get_db(), slug) if isinstance(slug, str) else None
    data = dict(manifest_data)
    data.setdefault("author", player["handle"])
    if existing and not data.get("remix_of"):
        data["remix_of"] = existing.get("remix_of")
    manifest = registry.manifest_from_dict(data)

    saved = registry.save_game(registry_dir, manifest, files)
    models.sync_registry(get_db(), registry_dir)
    changelog = str(body.get("changelog") or ("Update" if existing else "Initial publish"))
    models.record_version(get_db(), saved, changelog)
    return jsonify(saved.to_dict()), (200 if existing else 201)


@api_bp.get("/games/<slug>/files")
def game_files(slug: str):
    """Return a game's manifest and text files so it can be pulled and remixed."""
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    registry_dir = _settings().registry_dir
    manifest = registry.read_manifest(registry_dir / slug)
    return jsonify(
        {
            "slug": slug,
            "manifest": manifest.to_dict(),
            "files": registry.read_game_files(registry_dir, slug),
        }
    )
