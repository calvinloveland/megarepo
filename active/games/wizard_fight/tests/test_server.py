from __future__ import annotations

from wizard_fight.server import create_server


def test_lobby_flow_and_state_updates() -> None:
    app, socketio = create_server()
    client_one = socketio.test_client(app)
    client_two = socketio.test_client(app)

    lobby_response = client_one.emit("create_lobby", {"seed": 7}, callback=True)
    lobby_id = lobby_response["lobby_id"]

    join_one = client_one.emit("join_lobby", {"lobby_id": lobby_id}, callback=True)
    join_two = client_two.emit("join_lobby", {"lobby_id": lobby_id}, callback=True)

    assert join_one["player_id"] == 0
    assert join_two["player_id"] == 1

    cast_response = client_one.emit("cast_baseline", {"lobby_id": lobby_id}, callback=True)
    assert cast_response["state"]["units"], "expected baseline unit spawn"

    research_response = client_one.emit(
        "research_spell",
        {"lobby_id": lobby_id, "prompt": "wind shield"},
        callback=True,
    )
    assert research_response["status"] == "research_started"

    completion = client_one.emit(
        "step",
        {"lobby_id": lobby_id, "steps": 300},
        callback=True,
    )
    assert completion["new_spells"], "expected research completion"

    cast_spell_response = client_one.emit(
        "cast_spell",
        {"lobby_id": lobby_id, "spell_index": 0},
        callback=True,
    )
    assert "state" in cast_spell_response

    step_response = client_one.emit("step", {"lobby_id": lobby_id, "steps": 10}, callback=True)
    assert step_response["state"]["time_seconds"] > 0

    client_one.disconnect()
    client_two.disconnect()
