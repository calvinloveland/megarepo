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
    channel = LIVE.subscribe("game:test-game")
    try:
        token, _ = create_player(client, handle="SUB")
        client.post("/api/games/test-game/scores", json={"score": 1}, headers=auth(token))
        assert not channel.empty()
    finally:
        LIVE.unsubscribe("game:test-game", channel)


def test_hub_publish_and_unsubscribe():
    channel = LIVE.subscribe("topic")
    LIVE.publish("topic", "score")
    assert channel.get_nowait() == "score"
    LIVE.unsubscribe("topic", channel)
    LIVE.publish("topic")
    assert channel.empty()


def test_catalog_stats_and_stream(client):
    payload = client.get("/api/catalog/stats").get_json()
    assert "test-game" in payload["games"]
    assert "rating" in payload["games"]["test-game"]

    events = client.get("/api/catalog/events?once=1")
    assert events.mimetype == "text/event-stream"
    assert "games" in events.get_data(as_text=True)


def test_rating_notifies_the_catalog_topic(client):
    channel = LIVE.subscribe("catalog")
    try:
        token, _ = create_player(client, handle="CAT")
        client.post("/api/games/test-game/rating", json={"rating": 5}, headers=auth(token))
        assert not channel.empty()
    finally:
        LIVE.unsubscribe("catalog", channel)


def test_player_live_payload_and_stream(client):
    token, player = create_player(client, handle="PLV")
    client.post("/api/games/test-game/scores", json={"score": 10}, headers=auth(token))

    payload = client.get(f"/api/players/{player['handle']}/live").get_json()
    assert payload["handle"] == "PLV"
    assert any(a["achievement_id"] == "reach-10" for a in payload["achievements"])

    events = client.get(f"/api/players/{player['handle']}/events?once=1")
    assert events.mimetype == "text/event-stream"
    assert "achievements" in events.get_data(as_text=True)
