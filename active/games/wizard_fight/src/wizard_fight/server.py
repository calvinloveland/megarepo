from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from flask import Flask, jsonify, request
from flask_socketio import SocketIO

from wizard_fight.engine import GameState, apply_spell, build_initial_state, step
from wizard_fight.research import SpellDesign, build_spell_spec, design_spell, upgrade_spell
from wizard_fight.storage import save_spell

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BASELINE_SPELL_PATH = _REPO_ROOT / "docs" / "spells" / "summon_flying_monkey.json"


@dataclass
class Lobby:
    lobby_id: str
    state: GameState
    players: Dict[str, int] = field(default_factory=dict)
    spellbook: Dict[int, list[Dict[str, Any]]] = field(
        default_factory=lambda: {0: [], 1: []}
    )
    researching_until: Dict[int, float] = field(default_factory=dict)
    pending_prompts: Dict[int, str] = field(default_factory=dict)

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

    def add_spell(self, player_id: int, entry: Dict[str, Any]) -> None:
        self.spellbook.setdefault(player_id, []).append(entry)

    def get_spell(self, player_id: int, spell_index: int) -> Optional[Dict[str, Any]]:
        spells = self.spellbook.get(player_id, [])
        if 0 <= spell_index < len(spells):
            return spells[spell_index]
        return None

    def start_research(self, player_id: int, prompt: str) -> float:
        complete_at = self.state.time_seconds + self.state.config.research_delay_seconds
        self.researching_until[player_id] = complete_at
        self.pending_prompts[player_id] = prompt
        return complete_at

    def is_researching(self, player_id: int) -> bool:
        complete_at = self.researching_until.get(player_id)
        if complete_at is None:
            return False
        return self.state.time_seconds < complete_at


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


@dataclass
class Telemetry:
    lobbies_created: int = 0
    spells_researched: int = 0
    spells_cast: int = 0


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
        "environment": [
            {
                "type": effect.effect_type,
                "magnitude": effect.magnitude,
                "remaining_duration": effect.remaining_duration,
            }
            for effect in state.environment
        ],
    }


def create_app() -> Flask:
    return Flask(__name__)


def create_socketio(app: Flask) -> SocketIO:
    socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")
    store = LobbyStore()
    spells = SpellLibrary()
    telemetry = Telemetry()

    @app.get("/metrics")
    def metrics() -> Any:
        return jsonify(
            {
                "lobbies_created": telemetry.lobbies_created,
                "spells_researched": telemetry.spells_researched,
                "spells_cast": telemetry.spells_cast,
            }
        )

    @socketio.on("create_lobby")
    def create_lobby(data: Dict[str, Any] | None = None) -> Dict[str, Any]:
        seed = int((data or {}).get("seed", 0))
        lobby = store.create(seed=seed)
        telemetry.lobbies_created += 1
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
        if lobby.is_researching(player_id):
            return {"error": "research_in_progress"}
        apply_spell(lobby.state, player_id, spells.baseline())
        telemetry.spells_cast += 1
        return {"state": serialize_state(lobby.state)}

    @socketio.on("research_spell")
    def research_spell(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        player_id = lobby.get_player_id(request.sid)
        if player_id is None:
            return {"error": "not_in_lobby"}
        prompt = str(data.get("prompt", ""))
        if lobby.is_researching(player_id):
            return {"error": "research_in_progress"}
        complete_at = lobby.start_research(player_id, prompt)
        return {"status": "research_started", "complete_at": complete_at}

    @socketio.on("upgrade_spell")
    def upgrade_spell_event(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        player_id = lobby.get_player_id(request.sid)
        if player_id is None:
            return {"error": "not_in_lobby"}
        spell_index = int(data.get("spell_index", -1))
        entry = lobby.get_spell(player_id, spell_index)
        if entry is None:
            return {"error": "spell_not_found"}
        spec = upgrade_spell(entry["spec"], str(data.get("prompt", "upgrade")))
        spell_id = save_spell(spec["name"], str(data.get("prompt", "upgrade")), entry["design"], spec)
        lobby.add_spell(player_id, {"spell_id": spell_id, "spec": spec, "design": entry["design"]})
        return {"spell_id": spell_id, "spec": spec}

    @socketio.on("list_spells")
    def list_spells(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        player_id = lobby.get_player_id(request.sid)
        if player_id is None:
            return {"error": "not_in_lobby"}
        return {"spells": lobby.spellbook.get(player_id, [])}

    @socketio.on("cast_spell")
    def cast_spell(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        player_id = lobby.get_player_id(request.sid)
        if player_id is None:
            return {"error": "not_in_lobby"}
        if lobby.is_researching(player_id):
            return {"error": "research_in_progress"}
        spell_index = int(data.get("spell_index", -1))
        entry = lobby.get_spell(player_id, spell_index)
        if entry is None:
            return {"error": "spell_not_found"}
        apply_spell(lobby.state, player_id, entry["spec"])
        telemetry.spells_cast += 1
        return {"state": serialize_state(lobby.state)}

    @socketio.on("step")
    def step_lobby(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        steps = int(data.get("steps", 1))
        new_spells = _resolve_research(lobby, telemetry)
        step(lobby.state, steps=steps)
        new_spells.extend(_resolve_research(lobby, telemetry))
        return {
            "state": serialize_state(lobby.state),
            "new_spells": new_spells,
            "researching": _research_status(lobby),
        }

    @socketio.on("get_state")
    def get_state(data: Dict[str, Any]) -> Dict[str, Any]:
        lobby = store.get(data.get("lobby_id"))
        if lobby is None:
            return {"error": "lobby_not_found"}
        return {
            "state": serialize_state(lobby.state),
            "researching": _research_status(lobby),
        }

    return socketio


def _resolve_research(lobby: Lobby, telemetry: Telemetry) -> list[Dict[str, Any]]:
    completed: list[Dict[str, Any]] = []
    ready_players = [
        player_id
        for player_id, complete_at in lobby.researching_until.items()
        if lobby.state.time_seconds >= complete_at
    ]
    for player_id in ready_players:
        prompt = lobby.pending_prompts.pop(player_id, "")
        lobby.researching_until.pop(player_id, None)
        design = design_spell(prompt)
        spec = build_spell_spec(design)
        spell_id = save_spell(spec["name"], prompt, design.to_dict(), spec)
        entry = {"spell_id": spell_id, "spec": spec, "design": design.to_dict()}
        lobby.add_spell(player_id, entry)
        completed.append(entry)
        telemetry.spells_researched += 1
    return completed


def _research_status(lobby: Lobby) -> Dict[int, float]:
    status: Dict[int, float] = {}
    for player_id, complete_at in lobby.researching_until.items():
        remaining = max(0.0, complete_at - lobby.state.time_seconds)
        status[player_id] = remaining
    return status


def create_server() -> tuple[Flask, SocketIO]:
    app = create_app()
    socketio = create_socketio(app)
    return app, socketio


if __name__ == "__main__":
    app, socketio = create_server()
    socketio.run(app, host="0.0.0.0", port=5000)
