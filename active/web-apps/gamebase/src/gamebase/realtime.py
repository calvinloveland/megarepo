"""Real-time multiplayer rooms over WebSockets.

Turn-based games relay moves through ``/api/matches/<id>/state`` because a
half-second poll is fine for a chess move. Action games need something faster,
so this module adds a small WebSocket hub: players in a match join a room and
messages are relayed to the other members in real time.

Auth does not use the session cookie — a sandboxed game cannot read it, and the
WebSocket handshake may not carry it. Instead the host page (which does hold the
cookie) asks ``POST /api/matches/<id>/rt-token`` for a short-lived HMAC token and
hands it to the game, which connects with ``wss://<host>/api/rt?token=…``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
import time
from typing import Any

from flask import Flask, request

from . import models
from .app import get_db

try:  # pragma: no cover - depends on the optional dependency
    from flask_sock import Sock

    WEBSOCKETS_AVAILABLE = True
except ImportError:  # pragma: no cover
    Sock = None  # type: ignore[assignment]
    WEBSOCKETS_AVAILABLE = False

TOKEN_TTL_SECONDS = 120
MAX_MESSAGE_BYTES = 8 * 1024
ROOM_WS_PATH = "/api/rt"


# ── Tokens ──────────────────────────────────────────────────────────────────


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_rt_token(match_id: str, player_id: str, secret: str, ttl: int = TOKEN_TTL_SECONDS) -> str:
    payload = {"m": match_id, "p": player_id, "exp": int(time.time()) + ttl}
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()[:32]
    return f"{body}.{signature}"


def verify_rt_token(token: str | None, secret: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    body, signature = token.split(".", 1)
    expected = hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("exp", 0) < time.time():
        return None
    return payload


# ── Hub ─────────────────────────────────────────────────────────────────────


class RealtimeHub:
    """Thread-safe map of match rooms to connected sockets."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def join(self, match_id: str, player_id: str, socket: Any) -> None:
        with self._lock:
            self._rooms.setdefault(match_id, {})[player_id] = socket

    def leave(self, match_id: str, player_id: str) -> None:
        with self._lock:
            room = self._rooms.get(match_id)
            if room:
                room.pop(player_id, None)
                if not room:
                    self._rooms.pop(match_id, None)

    def roster(self, match_id: str) -> list[str]:
        with self._lock:
            return list(self._rooms.get(match_id, {}).keys())

    def send(self, socket: Any, message: dict[str, Any]) -> None:
        try:
            socket.send(json.dumps(message))
        except Exception:  # noqa: BLE001 - a dead socket must not break the room
            pass

    def broadcast(self, match_id: str, message: dict[str, Any], exclude: str | None = None) -> None:
        with self._lock:
            targets = [
                socket
                for player_id, socket in self._rooms.get(match_id, {}).items()
                if player_id != exclude
            ]
        payload = json.dumps(message)
        for socket in targets:
            try:
                socket.send(payload)
            except Exception:  # noqa: BLE001
                pass


HUB = RealtimeHub()


def init_realtime(app: Flask) -> None:
    """Register the WebSocket room endpoint on the app."""
    if not WEBSOCKETS_AVAILABLE:
        app.logger.warning("flask-sock is not installed; real-time multiplayer is disabled")
        return

    sock = Sock(app)

    @sock.route(ROOM_WS_PATH)
    def realtime_room(ws):
        secret = app.config["GAMEBASE_RT_SECRET"]
        payload = verify_rt_token(request.args.get("token"), secret)
        if payload is None:
            HUB.send(ws, {"t": "error", "error": "invalid or expired token"})
            ws.close()
            return

        match_id = str(payload.get("m"))
        player_id = str(payload.get("p"))
        match = models.get_match(get_db(), match_id)
        if match is None or player_id not in {member["player_id"] for member in match["players"]}:
            HUB.send(ws, {"t": "error", "error": "not a member of this match"})
            ws.close()
            return

        HUB.join(match_id, player_id, ws)
        HUB.broadcast(match_id, {"t": "roster", "players": HUB.roster(match_id)})
        try:
            while True:
                raw = ws.receive()
                if raw is None:
                    break
                if len(raw) > MAX_MESSAGE_BYTES:
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(message, dict):
                    continue
                message["from"] = player_id
                HUB.broadcast(match_id, message, exclude=player_id)
        finally:
            HUB.leave(match_id, player_id)
            HUB.broadcast(match_id, {"t": "roster", "players": HUB.roster(match_id)})
