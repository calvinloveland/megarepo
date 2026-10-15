"""Live game-page updates: payload, SSE snapshot, and the pub/sub hub."""

from __future__ import annotations

from conftest import auth, create_player

from gamebase.live import LIVE


def test_live_payload_has_everything_the_page_shows(client):
    token, _ = create_player(client, handle="LIV")
    payload = client.get("/api/games/test-game/live", headers=auth(token)).get_json()
    for key in ("leaderboard", "achievements", "rating", "stats", "comments"):
        assert key in payload


def test_events_once_mode_returns_a_snapshot(client):
    response = client.get("/api/games/test-game/events?once=1")
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    body = response.get_data(as_text=True)
    assert "event: state" in body
    assert "leaderboard" in body


def test_writes_notify_live_subscribers(client):
    channel = LIVE.subscribe("test-game")
    try:
        token, _ = create_player(client, handle="SUB")
        client.post("/api/games/test-game/scores", json={"score": 1}, headers=auth(token))
        assert not channel.empty()
    finally:
        LIVE.unsubscribe("test-game", channel)


def test_hub_publish_and_unsubscribe():
    channel = LIVE.subscribe("topic")
    LIVE.publish("topic", "score")
    assert channel.get_nowait() == "score"
    LIVE.unsubscribe("topic", channel)
    LIVE.publish("topic")
    assert channel.empty()
