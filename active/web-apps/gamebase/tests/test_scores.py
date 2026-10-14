"""High-score submission and leaderboard tests."""

from __future__ import annotations

from conftest import auth, create_player, make_settings

from gamebase.app import create_app


def test_submit_and_read_leaderboard(client):
    token, player = create_player(client, handle="scorer")
    response = client.post(
        "/api/games/test-game/scores",
        json={"score": 42, "meta": {"level": 2}},
        headers=auth(token),
    )
    assert response.status_code == 201
    payload = response.get_json()
    assert payload["score"] == 42
    assert payload["is_personal_best"] is True
    assert payload["rank"] == 1

    board = client.get("/api/games/test-game/leaderboard").get_json()["leaderboard"]
    assert board[0]["handle"] == "scorer"
    assert board[0]["meta"] == {"level": 2}


def test_leaderboard_keeps_best_per_player(client):
    token, _ = create_player(client, handle="grinder")
    for score in (5, 20, 12):
        client.post("/api/games/test-game/scores", json={"score": score}, headers=auth(token))

    board = client.get("/api/games/test-game/leaderboard").get_json()["leaderboard"]
    assert len(board) == 1
    assert board[0]["score"] == 20


def test_leaderboard_ranks_multiple_players(client):
    first, _ = create_player(client, handle="first")
    second, _ = create_player(client, handle="second")
    client.post("/api/games/test-game/scores", json={"score": 30}, headers=auth(first))
    client.post("/api/games/test-game/scores", json={"score": 55}, headers=auth(second))

    board = client.get("/api/games/test-game/leaderboard").get_json()["leaderboard"]
    assert [entry["handle"] for entry in board] == ["second", "first"]
    assert [entry["rank"] for entry in board] == [1, 2]


def test_ascending_leaderboard_orders_lowest_first(client):
    token, _ = create_player(client, handle="speedy")
    client.post("/api/games/time-trial/scores", json={"score": 500}, headers=auth(token))
    client.post("/api/games/time-trial/scores", json={"score": 120}, headers=auth(token))

    board = client.get("/api/games/time-trial/leaderboard").get_json()["leaderboard"]
    assert board[0]["score"] == 120


def test_score_validation_rejects_out_of_range_and_non_numeric(client):
    token, _ = create_player(client, handle="validator")
    too_big = client.post("/api/games/test-game/scores", json={"score": 5000}, headers=auth(token))
    assert too_big.status_code == 400
    negative = client.post("/api/games/test-game/scores", json={"score": -1}, headers=auth(token))
    assert negative.status_code == 400
    text = client.post("/api/games/test-game/scores", json={"score": "lots"}, headers=auth(token))
    assert text.status_code == 400


def test_scores_require_authentication(client):
    assert client.post("/api/games/test-game/scores", json={"score": 1}).status_code == 401


def test_score_submission_uses_rate_limit(tmp_path, registry_dir):
    settings = make_settings(tmp_path, registry_dir, score_rate_limit_seconds=30)
    app = create_app(settings)
    app.config.update(TESTING=True)
    with app.test_client() as limited_client:
        token, _ = create_player(limited_client, handle="fast")
        first = limited_client.post("/api/games/test-game/scores", json={"score": 1}, headers=auth(token))
        assert first.status_code == 201
        second = limited_client.post("/api/games/test-game/scores", json={"score": 2}, headers=auth(token))
        assert second.status_code == 429
