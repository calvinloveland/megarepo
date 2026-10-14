"""State/save API, progress hook, distinct criteria, and recovery codes."""

from __future__ import annotations

from conftest import auth, create_player, make_settings

from gamebase.app import create_app

STATE = "/api/games/test-game/state"
PROGRESS = "/api/games/test-game/progress"
SCORES = "/api/games/test-game/scores"


def test_state_round_trip_and_revisions(client):
    token, _ = create_player(client, handle="saver")
    empty = client.get(STATE, headers=auth(token)).get_json()
    assert empty["state"] is None
    assert empty["revision"] == 0
    assert empty["remaining"] == empty["max_bytes"]

    saved = client.put(STATE, json={"state": {"year": 1946, "cash": 10}}, headers=auth(token))
    assert saved.status_code == 200
    assert saved.get_json()["revision"] == 1

    loaded = client.get(STATE, headers=auth(token)).get_json()
    assert loaded["state"] == {"year": 1946, "cash": 10}
    assert loaded["size"] > 0
    assert loaded["remaining"] < loaded["max_bytes"]


def test_state_revision_conflict_is_reported(client):
    token, _ = create_player(client, handle="two-tabs")
    client.put(STATE, json={"state": {"n": 1}}, headers=auth(token))
    second = client.put(STATE, json={"state": {"n": 2}, "revision": 1}, headers=auth(token))
    assert second.status_code == 200
    assert second.get_json()["revision"] == 2

    stale = client.put(STATE, json={"state": {"n": 3}, "revision": 1}, headers=auth(token))
    assert stale.status_code == 409
    assert stale.get_json()["current_revision"] == 2


def test_state_is_isolated_per_player_and_game(client):
    first, _ = create_player(client, handle="saver-a")
    second, _ = create_player(client, handle="saver-b")
    client.put(STATE, json={"state": {"owner": "a"}}, headers=auth(first))

    assert client.get(STATE, headers=auth(second)).get_json()["state"] is None
    assert client.get("/api/games/time-trial/state", headers=auth(first)).get_json()["state"] is None


def test_state_size_limit_returns_413(tmp_path, registry_dir):
    settings = make_settings(tmp_path, registry_dir, state_max_bytes=50)
    app = create_app(settings)
    app.config.update(TESTING=True)
    with app.test_client() as small:
        token, _ = create_player(small, handle="big-save")
        response = small.put(STATE, json={"state": {"blob": "x" * 200}}, headers=auth(token))
        assert response.status_code == 413


def test_state_delete_and_auth(client):
    token, _ = create_player(client, handle="deleter")
    client.put(STATE, json={"state": {"n": 1}}, headers=auth(token))
    assert client.delete(STATE, headers=auth(token)).get_json()["deleted"] is True
    assert client.get(STATE, headers=auth(token)).get_json()["state"] is None
    assert client.get(STATE).status_code == 401


def test_progress_unlocks_meta_achievement_without_a_score(client):
    token, _ = create_player(client, handle="checkpointer")
    payload = client.post(PROGRESS, json={"meta": {"level": 5}}, headers=auth(token)).get_json()
    assert "level-five" in {achievement["id"] for achievement in payload["unlocked"]}

    progress = client.get("/api/games/test-game/me", headers=auth(token)).get_json()
    assert progress["best"] is None
    assert progress["unlocked_count"] == 1


def test_progress_can_unlock_manual_achievements(client):
    token, _ = create_player(client, handle="milestone")
    payload = client.post(
        PROGRESS, json={"meta": {}, "unlock": ["secret"]}, headers=auth(token)
    ).get_json()
    assert "secret" in {achievement["id"] for achievement in payload["unlocked"]}


def test_progress_requires_authentication(client):
    assert client.post(PROGRESS, json={"meta": {}}).status_code == 401


def test_distinct_criteria_counts_unique_meta_values(client):
    token, _ = create_player(client, handle="traveler")
    for year in (1, 2):
        client.post(SCORES, json={"score": 1, "meta": {"year": year}}, headers=auth(token))
    after_two = client.get("/api/games/test-game/me", headers=auth(token)).get_json()
    assert "explorer" not in {a["id"] for a in after_two["achievements"] if a["unlocked"]}

    result = client.post(
        SCORES, json={"score": 1, "meta": {"year": 3}}, headers=auth(token)
    ).get_json()
    assert "explorer" in {achievement["id"] for achievement in result["unlocked"]}


def test_submit_score_accepts_manual_unlock_ids(client):
    token, _ = create_player(client, handle="combo")
    result = client.post(
        SCORES, json={"score": 5, "unlock": ["secret"]}, headers=auth(token)
    ).get_json()
    assert "secret" in {achievement["id"] for achievement in result["unlocked"]}


def test_recovery_code_moves_a_player_between_devices(client):
    created = client.post("/api/identity", json={"handle": "roamer"}).get_json()
    player_id = created["player"]["id"]
    code = created["recovery_code"]
    assert code

    assert client.get("/api/me/recovery", headers=auth(created["token"])).get_json()["code"] == code

    # Simulate a second device: no shared token, only the recovery code.
    recovered = client.post("/api/identity/recover", json={"code": code})
    assert recovered.status_code == 200
    payload = recovered.get_json()
    assert payload["player"]["id"] == player_id
    assert client.get("/api/me", headers=auth(payload["token"])).status_code == 200


def test_recovery_rejects_unknown_code(client):
    assert client.post("/api/identity/recover", json={"code": "ZZZZ-ZZZZ-ZZZZ"}).status_code == 404
