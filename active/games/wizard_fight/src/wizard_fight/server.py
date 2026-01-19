from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from flask import Flask, request
from flask_socketio import SocketIO

from wizard_fight.engine import GameState, apply_spell, build_initial_state, step

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BASELINE_SPELL_PATH = _REPO_ROOT / "docs" / "spells" / "summon_flying_monkey.json"


@dataclass
class Lobby:
    lobby_id: str
    state: GameState
    players: Dict[str, int] = field(default_factory=dict)

    def add_player(self, sid: str) -> Optional[int]:
        if sid in self.players:
            return self.players[sid]
        if len(self.players) >= 2:
            return None
        player_id = len(self.players)
        self.players[sid] = player_id
        return player_id

    def remove_player(self, sid: str) -> None:
        self.players.pop(sid, None)

    def get_player_id(self, sid: str) -> Optional[int]:
        return self.players.get(sid)


class LobbyStore:
    def __init__(self) -> None:
        self._lobbies: Dict[str, Lobby] = {}

    def create(self, seed: int) -> Lobby:
        lobby_id = uuid4().hex
        state = build_initial_state(seed=seed)
        lobby = Lobby(lobby_id=lobby_id, state=state)
        self._lobbies[lobby_id] = lobby
        return lobby

    def get(self, lobby_id: str) -> Optional[Lobby]:
        return self._lobbies.get(lobby_id)

    def remove(self, lobby_id: str) -> None:
        self._lobbies.pop(lobby_id, None)


class SpellLibrary:
    def __init__(self) -> None:
        self._baseline_spell = json.loads(_BASELINE_SPELL_PATH.read_text(encoding="utf-8"))

    def baseline(self) -> Dict[str, Any]:
        return dict(self._baseline_spell)


def serialize_state(state: GameState) -> Dict[str, Any]:
    return {
        "time_seconds": state.time_seconds,
        "wizards": {
            wizard_id: {"health": wizard.health, "mana": wizard.mana}
            for wizard_id, wizard in state.wizards.items()
        },
        "units": [
            {
                "unit_id": unit.unit_id,
                "owner_id": unit.owner_id,
                "position": unit.position,
                "hp": unit.hp,
                "speed": unit.speed,
                "damage": unit.damage,
                "target": unit.target,
            }
            for unit in state.units
        ],
    }


def create_app() -> Flask:
    return Flask(__name__)


def create_socketio(app: Flask) -> SocketIO:
    socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")
    store = LobbyStore()
    spells = SpellLibrary()

    @socketio.on("create_lobby")
    def create_lobby(data: Dict[str, Any] | None = None) -> Dict[str, Any]:
        seed = int((data or {}).get("seed", 0))
        lobby = store.create(seed=seed)
        return {"lobby_id": lobby.lobby_id}

    @socketio.on("join_lobby")
    def join_lobby(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby_id = data.get("lobby_id")
        lobby = store.get(lobby_id)
        if lobby is None:
            return {"error": "lobby_not_found"}
        player_id = lobby.add_player(request.sid)
        if player_id is None:
            return {"error": "lobby_full"}
        return {"lobby_id": lobby_id, "player_id": player_id}

    @socketio.on("leave_lobby")
    def leave_lobby(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby:
            lobby.remove_player(request.sid)
        return {"status": "ok"}

    @socketio.on("cast_baseline")
    def cast_baseline(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        player_id = lobby.get_player_id(request.sid)
        if player_id is None:
            return {"error": "not_in_lobby"}
        apply_spell(lobby.state, player_id, spells.baseline())
        return {"state": serialize_state(lobby.state)}

    @socketio.on("step")
    def step_lobby(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        steps = int(data.get("steps", 1))
        step(lobby.state, steps=steps)
        return {"state": serialize_state(lobby.state)}

    @socketio.on("get_state")
    def get_state(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        return {"state": serialize_state(lobby.state)}

    return socketio


def create_server() -> tuple[Flask, SocketIO]:
    app = create_app()
    socketio = create_socketio(app)
    return app, socketio


if __name__ == "__main__":
    app, socketio = create_server()
    socketio.run(app, host="0.0.0.0", port=5000)
