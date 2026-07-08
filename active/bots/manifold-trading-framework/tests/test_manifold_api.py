from __future__ import annotations

from manifold_trading_framework.manifold_api import ManifoldClient


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


def test_authed_endpoint_refuses_without_api_key():
    """get_me requires auth: without a key it must raise BEFORE issuing a
    request, so we never make a silently-unauthenticated call to an endpoint
    that acts on the caller's account."""
    from manifold_trading_framework.manifold_api import ManifoldClient

    transport = FakeTransport()
    client = ManifoldClient(transport=transport)  # no api_key
    try:
        client.get_me()
    except ValueError as exc:
        assert "MANIFOLD_API_KEY" in str(exc)
    else:
        raise AssertionError("get_me() must raise ValueError without an api_key")
    # And crucially, no request was issued.
    assert transport.calls == []


def test_public_endpoints_omit_authorization_header():
    """Public (require_auth=False) endpoints must not attach the Authorization
    header when no key is configured, and must still succeed."""
    transport = FakeTransport()
    client = ManifoldClient(transport=transport)  # no api_key
    client.get_market("abc")
    _, _, headers, _ = transport.calls[0]
    assert "Authorization" not in headers


def test_market_id_path_segment_is_quoted():
    """Untrusted market IDs must be URL-encoded into the path segment so a
    value like 'a/b' or '../x' cannot escape the intended route."""
    transport = FakeTransport()
    client = ManifoldClient(transport=transport)
    client.get_market("a/b c")
    _, url, _, _ = transport.calls[0]
    # slash and space must be percent-encoded (safe="" quotes everything)
    assert "/v0/market/a%2Fb%20c" in url
    assert "/v0/market/../" not in url
