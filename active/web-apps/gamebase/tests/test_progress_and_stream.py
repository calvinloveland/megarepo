"""Tests for bundled progress, real-time matchmaking, and rescan hardening."""

from __future__ import annotations

import os

from conftest import auth, create_player, write_game

SCORES = "/api/games/test-game/scores"
MATCHMAKING = "/api/games/test-game/matchmaking"
STREAM = "/api/games/test-game/matchmaking/stream"
PROGRESS = "/api/games/test-game/me"


def test_game_progress_bundles_best_rank_and_achievements(client):
    token, _ = create_player(client, handle="progress")
    client.post(SCORES, json={"score": 25, "meta": {"level": 5}}, headers=auth(token))

    payload = client.get(PROGRESS, headers=auth(token)).get_json()
    assert payload["best"] == 25
    assert payload["rank"] == 1
    assert payload["unlocked_count"] >= 2  # reach-10 (score) + level-five (meta)
    assert payload["points"] >= 22
    by_id = {achievement["id"]: achievement["unlocked"] for achievement in payload["achievements"]}
    assert by_id["level-five"] is True
    assert "secret" not in by_id  # hidden and not yet unlocked


def test_game_progress_requires_authentication(client):
    assert client.get(PROGRESS).status_code == 401


def test_rescan_requires_authentication(client):
    assert client.post("/api/rescan").status_code == 401


def test_matchmaking_stream_pushes_the_match(client):
    first, _ = create_player(client, handle="stream-a")
    second, _ = create_player(client, handle="stream-b")
    client.post(MATCHMAKING, headers=auth(first))
    match = client.post(MATCHMAKING, headers=auth(second)).get_json()["match"]

    response = client.get(STREAM, headers=auth(first))
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    body = response.get_data(as_text=True)
    assert "event: done" in body
    assert match["id"] in body


def test_matchmaking_stream_snapshot_when_still_queued(client):
    token, _ = create_player(client, handle="stream-solo")
    client.post(MATCHMAKING, headers=auth(token))

    response = client.get(STREAM + "?timeout=0", headers=auth(token))
    body = response.get_data(as_text=True)
    assert "event: status" in body
    assert "queued" in body
    assert "event: timeout" in body


def test_matchmaking_stream_requires_authentication(client):
    assert client.get(STREAM).status_code == 401


def test_auto_rescan_picks_up_new_registry_folder(client, registry_dir):
    write_game(registry_dir, "auto-game", "slug: auto-game\ntitle: Auto Game\nversion: 1.0.0")
    os.utime(registry_dir)  # make the registry folder mtime change unambiguous

    # No explicit POST /api/rescan — the before_request hook syncs the catalog.
    assert client.get("/api/games/auto-game").status_code == 200
