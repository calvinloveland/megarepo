from __future__ import annotations

from prediction_market_agent.manifold_api import ManifoldClient


class FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str] | None, dict | None]] = []

    def request_json(self, method, url, headers=None, payload=None, timeout=10.0):
        self.calls.append((method, url, headers, payload))
        if url.endswith("/v0/market/abc"):
            return {"id": "abc"}
        if "/v0/comments" in url:
            return []
        if url.endswith("/v0/user/by-id/u1"):
            return {"id": "u1", "username": "alice"}
        return {"ok": True}


def test_get_market_uses_api_domain_and_path():
    transport = FakeTransport()
    client = ManifoldClient(transport=transport)

    result = client.get_market("abc")

    assert result == {"id": "abc"}
    method, url, headers, payload = transport.calls[0]
    assert method == "GET"
    assert url == "https://api.manifold.markets/v0/market/abc"
    assert headers["Accept"] == "application/json"
    assert payload is None


def test_place_bet_sends_auth_and_payload():
    transport = FakeTransport()
    client = ManifoldClient(api_key="secret", transport=transport)

    client.place_bet("abc", amount=5.0, outcome="YES", limit_prob=0.61)

    method, url, headers, payload = transport.calls[0]
    assert method == "POST"
    assert url == "https://api.manifold.markets/v0/bet"
    assert headers["Authorization"] == "Key secret"
    assert payload == {"amount": 5.0, "contractId": "abc", "outcome": "YES", "limitProb": 0.61}
