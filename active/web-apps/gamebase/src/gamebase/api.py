"""JSON API for Gamebase games and players.

Auth is a bearer token issued by ``POST /api/identity``. Game clients call
these endpoints through the JavaScript SDK (``/sdk/gamebase.js``) rather than
talking to them directly.
"""

from __future__ import annotations

import json
import os
import queue
import re
import time
from functools import wraps
from typing import Any, Callable

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from . import models, registry
from .app import get_db
from .config import Settings
from .live import LIVE

api_bp = Blueprint("api", __name__)

HANDLE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,24}$")
SESSION_COOKIE = "gamebase_token"


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
    cookie = request.cookies.get(SESSION_COOKIE)
    if cookie:
        return cookie
    return _json_body().get("token")


def _is_https() -> bool:
    forwarded = request.headers.get("X-Forwarded-Proto", "")
    return request.is_secure or forwarded.split(",")[0].strip() == "https"


def _set_session_cookie(response, token: str):
    """Store the session token in an httpOnly cookie so game JS can't read it."""
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=365 * 24 * 3600,
        httponly=True,
        samesite="Lax",
        secure=_is_https(),
    )
    return response


def _is_admin() -> bool:
    token = os.environ.get("GAMEBASE_ADMIN_TOKEN")
    return bool(token) and request.headers.get("X-Admin-Token") == token


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
    payload = {key: value for key, value in game.items() if key != "owner_id"}
    payload["top_scores"] = top
    payload["rating"] = models.game_rating(connection, game["slug"])
    payload["stats"] = models.game_play_stats(connection, game["slug"])
    return payload


def _sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _live_payload(slug: str, viewer_id: str | None) -> dict[str, Any]:
    """Everything the game page can change without a reload."""
    connection = get_db()
    game = models.get_game(connection, slug)
    if game is None:
        return {}
    order = (game["capabilities"].get("leaderboard") or {}).get("order", "desc")
    unlocked = models.unlocked_achievement_ids(connection, viewer_id, slug) if viewer_id else set()
    achievements = []
    for achievement in models.list_achievements(connection, slug):
        if achievement["hidden"] and achievement["id"] not in unlocked:
            continue
        achievements.append({**achievement, "unlocked": achievement["id"] in unlocked})
    return {
        "slug": slug,
        "leaderboard": models.leaderboard(connection, slug, limit=10, order=order, viewer_id=viewer_id),
        "achievements": achievements,
        "rating": models.game_rating(connection, slug, viewer_id),
        "stats": models.game_play_stats(connection, slug),
        "comments": models.list_comments(connection, slug, limit=50, viewer_id=viewer_id),
    }


def _publish_change(slug: str, player_id: str | None = None, *, catalog: bool = False, kind: str = "update") -> None:
    """Notify the game page, the player's profile, and/or the catalog."""
    LIVE.publish(f"game:{slug}", kind)
    if player_id:
        LIVE.publish(f"player:{player_id}", kind)
    if catalog:
        LIVE.publish("catalog", kind)


def _catalog_payload() -> dict[str, Any]:
    """Per-game rating and play aggregates in two queries (no N+1)."""
    connection = get_db()
    ratings = models.ratings_by_game(connection)
    plays = models.play_stats_by_game(connection)
    games: dict[str, Any] = {}
    for game in models.list_games(connection):
        slug = game["slug"]
        games[slug] = {
            "rating": ratings.get(slug, {"average": 0.0, "count": 0}),
            "stats": plays.get(slug, {"plays": 0, "players": 0}),
        }
    return {"games": games}


def _player_live_payload(player: dict[str, Any]) -> dict[str, Any]:
    connection = get_db()
    return {
        "handle": player["handle"],
        "points": models.achievement_points(connection, player["id"]),
        "achievements": models.player_achievements(connection, player["id"]),
        "ratings": models.player_ratings(connection, player["id"]),
        "comments": models.player_comments(connection, player["id"]),
    }


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
    response = jsonify(
        {
            "token": result["token"],
            "player": result["player"],
            "recovery_code": result["recovery_code"],
        }
    )
    _set_session_cookie(response, result["token"])
    return response, 201


@api_bp.get("/session")
def session_info():
    """Lightweight auth check for the front end (no 401 noise)."""
    player = current_player()
    if player is None:
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "player": player})


@api_bp.post("/logout")
def logout():
    token = _token_from_request()
    if token:
        models.delete_session(get_db(), token)
    response = jsonify({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


@api_bp.get("/me/recovery")
@require_player
def recovery_code(player: dict[str, Any]):
    """Return the player's recovery code so progress can move between devices."""
    return jsonify({"code": models.get_recovery_code(get_db(), player["id"])})


@api_bp.post("/identity/recover")
def recover_identity():
    """Re-issue a session for a player from their recovery code (new device)."""
    code = _json_body().get("code")
    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "code is required"}), 400
    connection = get_db()
    player = models.player_for_recovery(connection, code)
    if player is None:
        return jsonify({"error": "invalid recovery code"}), 404
    token = models.create_session(connection, player["id"])
    response = jsonify({"token": token, "player": player})
    _set_session_cookie(response, token)
    return response


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


@api_bp.get("/games/<slug>/live")
def game_live(slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    player = current_player()
    return jsonify(_live_payload(slug, player["id"] if player else None))


@api_bp.get("/games/<slug>/events")
def game_events(slug: str):
    """Server-sent events: push the game page a fresh snapshot on any change."""
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    player = current_player()
    viewer_id = player["id"] if player else None
    once = request.args.get("once") == "1"

    def generate():
        if once:
            yield _sse_event("state", _live_payload(slug, viewer_id))
            return
        channel = LIVE.subscribe(f"game:{slug}")
        try:
            yield _sse_event("state", _live_payload(slug, viewer_id))
            while True:
                try:
                    channel.get(timeout=20)
                    yield _sse_event("state", _live_payload(slug, viewer_id))
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            LIVE.unsubscribe(f"game:{slug}", channel)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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


@api_bp.get("/games/<slug>/me")
@require_player
def game_progress(player: dict[str, Any], slug: str):
    """Bundled per-game progress: best score, rank, and achievement state."""
    game = _require_game(slug)
    if game is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    connection = get_db()
    order = (game["capabilities"].get("leaderboard") or {}).get("order", "desc")
    entry = models.player_best_entry(connection, slug, player["id"], order=order)
    unlocked = models.unlocked_achievement_ids(connection, player["id"], slug)
    achievements = []
    points = 0
    for achievement in models.list_achievements(connection, slug):
        is_unlocked = achievement["id"] in unlocked
        if is_unlocked:
            points += achievement["points"]
        if achievement["hidden"] and not is_unlocked:
            continue
        achievements.append({**achievement, "unlocked": is_unlocked})
    return jsonify(
        {
            "best": entry["score"] if entry else None,
            "rank": entry["rank"] if entry else None,
            "points": points,
            "unlocked_count": len(unlocked),
            "achievements": achievements,
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
    meta = body.get("meta") or {}
    if not isinstance(meta, dict):
        return jsonify({"error": "meta must be a mapping"}), 400
    try:
        result = models.submit_score(
            get_db(),
            game,
            player["id"],
            body.get("score"),
            meta,
            rate_limit_seconds=_settings().score_rate_limit_seconds,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    extra_unlocks = body.get("unlock") or []
    if isinstance(extra_unlocks, list) and extra_unlocks:
        batch = models.unlock_achievements(
            get_db(), slug, player["id"], [item for item in extra_unlocks if isinstance(item, str)]
        )
        result["unlocked"].extend(batch["unlocked"])
    _publish_change(slug, player["id"], kind="score")
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
    _publish_change(slug, player["id"], kind="achievement")
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
    _publish_change(slug, player["id"], kind="achievement")
    return jsonify(result), 201 if result["unlocked"] else 200


# ── Community: ratings, comments, plays ─────────────────────────────────────


@api_bp.get("/games/<slug>/rating")
def get_rating(slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    player = current_player()
    return jsonify(models.game_rating(get_db(), slug, player["id"] if player else None))


@api_bp.post("/games/<slug>/rating")
@require_player
def rate_game(player: dict[str, Any], slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    try:
        result = models.set_rating(get_db(), slug, player["id"], _json_body().get("rating"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    _publish_change(slug, player["id"], catalog=True, kind="rating")
    return jsonify(result)


@api_bp.get("/games/<slug>/comments")
def get_comments(slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
    except ValueError:
        limit = 50
    player = current_player()
    comments = models.list_comments(
        get_db(), slug, limit, viewer_id=player["id"] if player else None
    )
    return jsonify({"comments": comments})


@api_bp.post("/games/<slug>/comments")
@require_player
def post_comment(player: dict[str, Any], slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    try:
        comment = models.add_comment(
            get_db(),
            slug,
            player["id"],
            _json_body().get("body"),
            rate_limit_seconds=_settings().comment_rate_limit_seconds,
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    _publish_change(slug, player["id"], kind="comment")
    return jsonify(comment), 201


@api_bp.delete("/comments/<int:comment_id>")
@require_player
def remove_comment(player: dict[str, Any], comment_id: int):
    connection = get_db()
    slug = models.comment_slug(connection, comment_id)
    removed = models.delete_comment(connection, comment_id, player["id"])
    if removed and slug:
        _publish_change(slug, player["id"], kind="comment")
    return jsonify({"deleted": removed}), (200 if removed else 404)


@api_bp.post("/games/<slug>/play")
@require_player
def record_play(player: dict[str, Any], slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    stats = models.record_play(get_db(), slug, player["id"])
    _publish_change(slug, player["id"], catalog=True, kind="play")
    return jsonify(stats)


@api_bp.post("/games/<slug>/progress")
@require_player
def report_progress(player: dict[str, Any], slug: str):
    """Announce a milestone without a score (continuous/idle games).

    Evaluates ``meta``/``distinct`` criteria from ``meta`` and optionally unlocks
    manual achievements listed in ``unlock``.
    """
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    body = _json_body()
    meta = body.get("meta") or {}
    if not isinstance(meta, dict):
        return jsonify({"error": "meta must be a mapping"}), 400
    connection = get_db()
    unlocked = models.evaluate_progress_achievements(connection, slug, player["id"], meta)
    extra = body.get("unlock") or []
    if isinstance(extra, list) and extra:
        batch = models.unlock_achievements(
            connection, slug, player["id"], [item for item in extra if isinstance(item, str)]
        )
        unlocked.extend(batch["unlocked"])
    _publish_change(slug, player["id"], kind="progress")
    return jsonify({"unlocked": unlocked})


# ── Player state (save games) ───────────────────────────────────────────────


def _state_budget() -> int:
    return _settings().state_max_bytes


@api_bp.get("/games/<slug>/state")
@require_player
def get_state(player: dict[str, Any], slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    max_bytes = _state_budget()
    record = models.get_state(get_db(), player["id"], slug)
    if record is None:
        return jsonify(
            {
                "state": None,
                "revision": 0,
                "schema_version": 1,
                "size": 0,
                "max_bytes": max_bytes,
                "remaining": max_bytes,
            }
        )
    return jsonify({**record, "max_bytes": max_bytes, "remaining": max(0, max_bytes - record["size"])})


@api_bp.put("/games/<slug>/state")
@require_player
def put_state(player: dict[str, Any], slug: str):
    """Persist a save blob. Send ``revision`` to guard against concurrent tabs."""
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    body = _json_body()
    if "state" not in body:
        return jsonify({"error": "state is required"}), 400
    revision = body.get("revision")
    if revision is not None and not isinstance(revision, int):
        return jsonify({"error": "revision must be an integer"}), 400
    schema_version = body.get("schema_version", 1)
    if not isinstance(schema_version, int):
        return jsonify({"error": "schema_version must be an integer"}), 400
    try:
        result = models.save_state(
            get_db(),
            player["id"],
            slug,
            body["state"],
            revision=revision,
            schema_version=schema_version,
            max_bytes=_state_budget(),
        )
    except models.Conflict as conflict:
        return jsonify({"error": str(conflict), "current_revision": conflict.current_revision}), 409
    except ValueError as error:
        return jsonify({"error": str(error)}), 413
    return jsonify(result)


@api_bp.delete("/games/<slug>/state")
@require_player
def remove_state(player: dict[str, Any], slug: str):
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    return jsonify({"deleted": models.delete_state(get_db(), player["id"], slug)})


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


@api_bp.get("/games/<slug>/matchmaking/stream")
@require_player
def matchmaking_stream(player: dict[str, Any], slug: str):
    """Server-sent events: push the ticket/match the moment it changes.

    The SDK prefers this over polling. ``?timeout`` (seconds) bounds how long
    the stream stays open; a 0-second timeout emits one snapshot and closes.
    """
    if _require_game(slug) is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    try:
        timeout = min(max(float(request.args.get("timeout", 30)), 0), 60)
    except ValueError:
        timeout = 30.0
    player_id = player["id"]

    def generate():
        deadline = time.time() + timeout
        previous = object()
        while True:
            ticket = models.open_ticket(get_db(), slug, player_id)
            state = (
                (ticket["status"], ticket.get("match_id")) if ticket else (None, None)
            )
            if state != previous:
                previous = state
                yield _sse_event("status", {"ticket": ticket})
            if ticket is None or ticket["status"] in ("matched", "cancelled", "completed"):
                yield _sse_event("done", {"ticket": ticket})
                return
            if time.time() >= deadline:
                yield _sse_event("timeout", {"ticket": ticket})
                return
            time.sleep(0.5)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


@api_bp.put("/matches/<match_id>/state")
@require_player
def relay_match_state(player: dict[str, Any], match_id: str):
    """Relay shared game state for an online turn-based match (members only)."""
    body = _json_body()
    if "state" not in body:
        return jsonify({"error": "state is required"}), 400
    revision = body.get("revision")
    if revision is not None and not isinstance(revision, int):
        return jsonify({"error": "revision must be an integer"}), 400
    try:
        result = models.set_match_game_state(get_db(), match_id, player["id"], body["state"], revision)
    except models.NotFound as error:
        return jsonify({"error": str(error)}), 404
    except PermissionError as error:
        return jsonify({"error": str(error)}), 403
    except models.Conflict as conflict:
        return jsonify({"error": str(conflict), "current_revision": conflict.current_revision}), 409
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(result)


@api_bp.post("/matches/<match_id>/rt-token")
@require_player
def realtime_token(player: dict[str, Any], match_id: str):
    """Issue a short-lived WebSocket token for a match (members only)."""
    match = models.get_match(get_db(), match_id)
    if match is None:
        return jsonify({"error": f"match not found: {match_id}"}), 404
    if player["id"] not in {member["player_id"] for member in match["players"]}:
        return jsonify({"error": "not a member of this match"}), 403
    from .realtime import ROOM_WS_PATH, issue_rt_token

    token = issue_rt_token(match_id, player["id"], current_app.config["GAMEBASE_RT_SECRET"])
    return jsonify({"token": token, "match_id": match_id, "path": f"{ROOM_WS_PATH}?token={token}"})


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
    models.set_game_owner(get_db(), manifest.slug, player["id"])
    models.record_remix(get_db(), slug, manifest.slug, player["id"])
    LIVE.publish("catalog", "games")
    return jsonify(manifest.to_dict()), 201


@api_bp.post("/games/<slug>/publish")
@require_player
def publish(player: dict[str, Any], slug: str):
    existing = models.get_game(get_db(), slug)
    if existing is None:
        return jsonify({"error": f"game not found: {slug}"}), 404
    owner = existing.get("owner_id")
    if not _is_admin() and (owner is None or owner != player["id"]):
        return jsonify({"error": "you do not own this game"}), 403
    registry_dir = _settings().registry_dir
    try:
        manifest = registry.read_manifest(registry_dir / slug)
    except registry.ManifestError as error:
        return jsonify({"error": str(error)}), 400
    body = _json_body()
    models.sync_registry(get_db(), registry_dir)
    models.record_version(get_db(), manifest, str(body.get("changelog") or "Update"))
    return jsonify(manifest.to_dict())


@api_bp.get("/catalog/stats")
def catalog_stats():
    return jsonify(_catalog_payload())


@api_bp.get("/catalog/events")
def catalog_events():
    """SSE stream of catalog rating/play aggregates for the home page."""
    once = request.args.get("once") == "1"

    def generate():
        if once:
            yield _sse_event("state", _catalog_payload())
            return
        channel = LIVE.subscribe("catalog")
        try:
            yield _sse_event("state", _catalog_payload())
            while True:
                try:
                    channel.get(timeout=20)
                    yield _sse_event("state", _catalog_payload())
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            LIVE.unsubscribe("catalog", channel)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_bp.get("/players/<handle>/live")
def player_live(handle: str):
    player = models.get_player_by_handle(get_db(), handle)
    if player is None:
        return jsonify({"error": f"player not found: {handle}"}), 404
    return jsonify(_player_live_payload(player))


@api_bp.get("/players/<handle>/events")
def player_events(handle: str):
    player = models.get_player_by_handle(get_db(), handle)
    if player is None:
        return jsonify({"error": f"player not found: {handle}"}), 404
    topic = f"player:{player['id']}"
    once = request.args.get("once") == "1"

    def generate():
        if once:
            yield _sse_event("state", _player_live_payload(player))
            return
        channel = LIVE.subscribe(topic)
        try:
            yield _sse_event("state", _player_live_payload(player))
            while True:
                try:
                    channel.get(timeout=20)
                    yield _sse_event("state", _player_live_payload(player))
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            LIVE.unsubscribe(topic, channel)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_bp.post("/rescan")
@require_player
def rescan(player: dict[str, Any]):
    registry_dir = _settings().registry_dir
    manifests = models.sync_registry(get_db(), registry_dir)
    LIVE.publish("catalog", "games")
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
    if existing is not None and not _is_admin():
        owner = existing.get("owner_id")
        if owner is None:
            return jsonify(
                {"error": "this game is managed on disk; push a new slug or use an admin token"}
            ), 403
        if owner != player["id"]:
            return jsonify({"error": "you do not own this game"}), 403

    data = dict(manifest_data)
    data.setdefault("author", player["handle"])
    if existing and not data.get("remix_of"):
        data["remix_of"] = existing.get("remix_of")
    manifest = registry.manifest_from_dict(data)

    saved = registry.save_game(registry_dir, manifest, files, binary=body.get("binary"))
    models.sync_registry(get_db(), registry_dir)
    if existing is None:
        models.set_game_owner(get_db(), saved.slug, player["id"])
    changelog = str(body.get("changelog") or ("Update" if existing else "Initial publish"))
    models.record_version(get_db(), saved, changelog)
    if existing is None:
        LIVE.publish("catalog", "games")
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
            "binary": registry.read_binary_files(registry_dir, slug),
        }
    )
