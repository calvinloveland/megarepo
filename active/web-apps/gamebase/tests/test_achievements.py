"""Achievement definition, unlocking, and server-side criteria tests."""

from __future__ import annotations

from conftest import auth, create_player


def test_achievements_hide_secret_until_unlocked(client):
    token, _ = create_player(client, handle="hunter")
    listed = client.get("/api/games/test-game/achievements", headers=auth(token)).get_json()
    ids = {achievement["id"] for achievement in listed["achievements"]}
    assert "reach-10" in ids
    assert "secret" not in ids


def test_score_submission_auto_unlocks_criteria_achievements(client):
    token, _ = create_player(client, handle="auto")
    result = client.post(
        "/api/games/test-game/scores", json={"score": 10}, headers=auth(token)
    ).get_json()
    unlocked_ids = {achievement["id"] for achievement in result["unlocked"]}
    assert "reach-10" in unlocked_ids


def test_count_criteria_unlocks_after_repeated_submissions(client):
    token, _ = create_player(client, handle="repeat")
    client.post("/api/games/test-game/scores", json={"score": 1}, headers=auth(token))
    result = client.post("/api/games/test-game/scores", json={"score": 2}, headers=auth(token)).get_json()
    assert "grinder" in {achievement["id"] for achievement in result["unlocked"]}


def test_manual_unlock_is_idempotent(client):
    token, _ = create_player(client, handle="manual")
    first = client.post("/api/games/test-game/achievements/secret", headers=auth(token))
    assert first.status_code == 201
    assert first.get_json()["unlocked"]["id"] == "secret"

    second = client.post("/api/games/test-game/achievements/secret", headers=auth(token))
    assert second.status_code == 200
    assert second.get_json()["already_unlocked"] is True

    listed = client.get("/api/games/test-game/achievements", headers=auth(token)).get_json()
    secret = next(a for a in listed["achievements"] if a["id"] == "secret")
    assert secret["unlocked"] is True


def test_unknown_achievement_returns_404(client):
    token, _ = create_player(client, handle="curious")
    response = client.post("/api/games/test-game/achievements/does-not-exist", headers=auth(token))
    assert response.status_code == 404


def test_achievement_points_roll_up_to_profile(client):
    token, _ = create_player(client, handle="points")
    client.post("/api/games/test-game/achievements/secret", headers=auth(token))
    client.post("/api/games/test-game/scores", json={"score": 10}, headers=auth(token))
    profile = client.get("/api/me", headers=auth(token)).get_json()
    # reach-10 (10) is unlocked by the score; secret has no points in the fixture.
    assert profile["points"] >= 10
    assert any(a["achievement_id"] == "reach-10" for a in profile["achievements"])

    page = client.get("/players/points")
    assert page.status_code == 200
    assert "Reach 10" in page.get_data(as_text=True)
