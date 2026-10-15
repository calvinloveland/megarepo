"""Real-time multiplayer: signed room tokens, the hub, and the token endpoint."""

from __future__ import annotations

from conftest import auth, create_player

from gamebase import realtime

ART = "/api/games/test-game/matchmaking"


def test_rt_token_round_trip():
    token = realtime.issue_rt_token("match-1", "player-1", "secret")
    payload = realtime.verify_rt_token(token, "secret")
    assert payload["m"] == "match-1"
    assert payload["p"] == "player-1"


def test_rt_token_rejects_tampering_and_expiry():
    token = realtime.issue_rt_token("match-1", "player-1", "secret")
    assert realtime.verify_rt_token(token, "different-secret") is None
    assert realtime.verify_rt_token(token + "x", "secret") is None
    assert realtime.verify_rt_token("not-a-token", "secret") is None
    assert realtime.verify_rt_token(realtime.issue_rt_token("m", "p", "secret", ttl=-5), "secret") is None


class FakeSocket:
    def __init__(self):
        self.sent: list[str] = []

    def send(self, message: str) -> None:
        self.sent.append(message)


def test_hub_relays_messages_to_other_members():
    hub = realtime.RealtimeHub()
    first, second = FakeSocket(), FakeSocket()
    hub.join("m", "first", first)
    hub.join("m", "second", second)

    hub.broadcast("m", {"hello": 1}, exclude="first")
    assert second.sent and not first.sent
    assert sorted(hub.roster("m")) == ["first", "second"]

    hub.leave("m", "first")
    assert hub.roster("m") == ["second"]


def _matched(client):
    first, _ = create_player(client, handle="rt-a")
    second, _ = create_player(client, handle="rt-b")
    client.post(ART, headers=auth(first))
    match = client.post(ART, headers=auth(second)).get_json()["match"]
    return first, second, match


def test_rt_token_endpoint_issues_for_members_only(client, app):
    first, second, match = _matched(client)
    outsider, _ = create_player(client, handle="rt-c")

    response = client.post(f"/api/matches/{match['id']}/rt-token", headers=auth(first))
    assert response.status_code == 200
    body = response.get_json()
    assert body["match_id"] == match["id"]
    assert realtime.verify_rt_token(body["token"], app.config["GAMEBASE_RT_SECRET"])["p"]

    forbidden = client.post(f"/api/matches/{match['id']}/rt-token", headers=auth(outsider))
    assert forbidden.status_code == 403

    with app.test_client() as anonymous:
        assert anonymous.post(f"/api/matches/{match['id']}/rt-token").status_code == 401
