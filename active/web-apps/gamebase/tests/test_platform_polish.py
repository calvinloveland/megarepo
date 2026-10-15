"""Regression tests for the platform polish prompted by port feedback.

Covers: viewer flags + my-best, meta achievement criteria, batch unlocks, the
429 retry contract, and keeping the manifest out of the asset server.
"""

from __future__ import annotations

from conftest import auth, create_player, make_settings

from gamebase.app import create_app

LEADERBOARD = "/api/games/test-game/leaderboard"
MY_BEST = "/api/games/test-game/my-best"
SCORES = "/api/games/test-game/scores"


def _submit(client, token, score, meta=None):
    body = {"score": score}
    if meta is not None:
        body["meta"] = meta
    return client.post(SCORES, json=body, headers=auth(token))


def test_leaderboard_flags_the_viewing_player(client, app):
    first, _ = create_player(client, handle="viewer-a")
    second, _ = create_player(client, handle="viewer-b")
    _submit(client, first, 10)
    _submit(client, second, 20)

    board = client.get(LEADERBOARD, headers=auth(first)).get_json()["leaderboard"]
    by_handle = {entry["handle"]: entry["is_me"] for entry in board}
    assert by_handle == {"viewer-a": True, "viewer-b": False}

    with app.test_client() as anonymous:
        board = anonymous.get(LEADERBOARD).get_json()["leaderboard"]
    assert all(entry["is_me"] is False for entry in board)


def test_my_best_returns_score_and_rank(client):
    token, _ = create_player(client, handle="solo-best")
    assert client.get(MY_BEST, headers=auth(token)).get_json() == {"best": None, "rank": None}

    _submit(client, token, 42)
    payload = client.get(MY_BEST, headers=auth(token)).get_json()
    assert payload["best"] == 42
    assert payload["rank"] == 1
    assert payload["is_me"] is True
    assert payload["achieved_at"]


def test_my_best_requires_authentication(client):
    assert client.get(MY_BEST).status_code == 401


def test_meta_criteria_unlocks_from_submitted_metadata(client):
    token, _ = create_player(client, handle="meta-hunter")
    result = _submit(client, token, 1, meta={"level": 5}).get_json()
    assert "level-five" in {achievement["id"] for achievement in result["unlocked"]}

    untouched, _ = create_player(client, handle="meta-miss")
    lower = _submit(client, untouched, 1, meta={"level": 4}).get_json()
    assert "level-five" not in {achievement["id"] for achievement in lower["unlocked"]}

    missing, _ = create_player(client, handle="meta-absent")
    blank = _submit(client, missing, 1, meta={}).get_json()
    assert "level-five" not in {achievement["id"] for achievement in blank["unlocked"]}


def test_batch_unlock_returns_new_and_already(client):
    token, _ = create_player(client, handle="batch")
    first = client.post(
        "/api/games/test-game/achievements",
        json={"ids": ["secret", "reach-10"]},
        headers=auth(token),
    )
    assert first.status_code == 201
    assert {achievement["id"] for achievement in first.get_json()["unlocked"]} == {"secret", "reach-10"}

    second = client.post(
        "/api/games/test-game/achievements", json={"ids": ["secret"]}, headers=auth(token)
    )
    assert second.status_code == 200
    assert second.get_json()["unlocked"] == []
    assert second.get_json()["already_unlocked"] == ["secret"]

    invalid = client.post("/api/games/test-game/achievements", json={"ids": []}, headers=auth(token))
    assert invalid.status_code == 400


def test_rate_limit_response_carries_retry_after(tmp_path, registry_dir):
    settings = make_settings(tmp_path, registry_dir, score_rate_limit_seconds=30)
    app = create_app(settings)
    app.config.update(TESTING=True)
    with app.test_client() as limited:
        token, _ = create_player(limited, handle="sprinter")
        assert _submit(limited, token, 1).status_code == 201
        response = _submit(limited, token, 2)
        assert response.status_code == 429
        assert "Retry-After" in response.headers
        assert response.get_json()["retry_after_seconds"] > 0


def test_manifest_and_dotfiles_are_not_served(client, registry_dir):
    assert client.get("/play/test-game/game.yaml").status_code == 404
    (registry_dir / "test-game" / ".secret.txt").write_text("hidden", encoding="utf-8")
    assert client.get("/play/test-game/.secret.txt").status_code == 404
    assert client.get("/play/test-game/logic.js").status_code == 200
