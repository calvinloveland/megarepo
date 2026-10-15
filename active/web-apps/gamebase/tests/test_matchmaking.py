"""Matchmaking queue, match lifecycle, and permissions tests."""

from __future__ import annotations

from conftest import auth, create_player


def _queue(client, token, slug: str = "test-game"):
    return client.post(f"/api/games/{slug}/matchmaking", headers=auth(token))


def test_single_player_waits_in_queue(client):
    token, _ = create_player(client, handle="solo")
    response = _queue(client, token)
    assert response.status_code == 200
    ticket = response.get_json()
    assert ticket["status"] == "queued"
    assert ticket["match_id"] is None


def test_two_players_are_matched(client):
    first, _ = create_player(client, handle="alpha")
    second, _ = create_player(client, handle="beta")
    _queue(client, first)
    second_ticket = _queue(client, second)
    assert second_ticket.status_code == 201
    assert second_ticket.get_json()["status"] == "matched"

    status = client.get("/api/games/test-game/matchmaking", headers=auth(first)).get_json()["ticket"]
    assert status["status"] == "matched"
    assert len(status["match"]["players"]) == 2
    assert {player["handle"] for player in status["match"]["players"]} == {"alpha", "beta"}


def test_cancel_removes_player_from_queue(client):
    token, _ = create_player(client, handle="quitter")
    _queue(client, token)
    cancelled = client.delete("/api/games/test-game/matchmaking", headers=auth(token))
    assert cancelled.get_json()["cancelled"] is True
    assert client.get("/api/games/test-game/matchmaking", headers=auth(token)).get_json()["ticket"] is None


def test_reporting_results_completes_match(client):
    first, first_player = create_player(client, handle="reporter-a")
    second, second_player = create_player(client, handle="reporter-b")
    _queue(client, first)
    match = _queue(client, second).get_json()["match"]

    partial = client.post(
        f"/api/matches/{match['id']}/result",
        json={"result": {"reaction_ms": 250}},
        headers=auth(first),
    )
    assert partial.status_code == 200
    assert partial.get_json()["state"] == "active"

    final = client.post(
        f"/api/matches/{match['id']}/result",
        json={"result": {"reaction_ms": 260}},
        headers=auth(second),
    )
    final_payload = final.get_json()
    assert final_payload["state"] == "completed"
    assert set(final_payload["result"].keys()) == {first_player["id"], second_player["id"]}


def test_non_member_cannot_report_result(client):
    first, _ = create_player(client, handle="member")
    second, _ = create_player(client, handle="opponent")
    outsider, _ = create_player(client, handle="outsider")
    _queue(client, first)
    match = _queue(client, second).get_json()["match"]

    response = client.post(
        f"/api/matches/{match['id']}/result",
        json={"result": {"reaction_ms": 100}},
        headers=auth(outsider),
    )
    assert response.status_code == 403


def test_matchmaking_requires_capability(client):
    token, _ = create_player(client, handle="no-match")
    response = _queue(client, token, slug="time-trial")
    assert response.status_code == 400


def _matched_pair(client):
    first, first_player = create_player(client, handle="relay-a")
    second, second_player = create_player(client, handle="relay-b")
    _queue(client, first)
    match = _queue(client, second).get_json()["match"]
    return first, first_player, second, second_player, match


def test_match_state_relay_round_trip(client):
    first, _, second, _, match = _matched_pair(client)

    published = client.put(
        f"/api/matches/{match['id']}/state",
        json={"state": {"board": ["x", None, "o"], "turn": "second"}, "revision": 0},
        headers=auth(first),
    )
    assert published.status_code == 200
    assert published.get_json()["revision"] == 1

    seen = client.get(f"/api/matches/{match['id']}", headers=auth(second)).get_json()
    assert seen["game_state"] == {"board": ["x", None, "o"], "turn": "second"}
    assert seen["revision"] == 1



def test_match_state_relay_rejects_stale_revision_and_non_members(client):
    first, _, second, _, match = _matched_pair(client)
    outsider, _ = create_player(client, handle="relay-c")

    client.put(
        f"/api/matches/{match['id']}/state",
        json={"state": {"n": 1}, "revision": 0},
        headers=auth(first),
    )
    stale = client.put(
        f"/api/matches/{match['id']}/state",
        json={"state": {"n": 2}, "revision": 0},
        headers=auth(second),
    )
    assert stale.status_code == 409
    assert stale.get_json()["current_revision"] == 1

    forbidden = client.put(
        f"/api/matches/{match['id']}/state",
        json={"state": {"n": 3}},
        headers=auth(outsider),
    )
    assert forbidden.status_code == 403
