"""Tests for the PKCE + token caching layer."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest
import responses

from spotify_liberator import auth, SPOTIFY_TOKEN_URL


# ---------------------------------------------------------------------------
# PKCE primitives
# ---------------------------------------------------------------------------


class TestPKCE:
    def test_verifier_is_unreserved_and_long(self):
        v = auth.make_code_verifier()
        # RFC 7636: 43-128 chars from [A-Z][a-z][0-9]-._~
        assert 43 <= len(v) <= 128
        allowed = set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        assert set(v).issubset(allowed)

    def test_verifiers_are_unique(self):
        a, b = auth.make_code_verifier(), auth.make_code_verifier()
        assert a != b

    def test_challenge_matches_sha256(self):
        import base64
        import hashlib
        v = auth.make_code_verifier()
        c = auth.make_code_challenge(v)
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(v.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        assert c == expected

    def test_challenge_does_not_include_padding(self):
        c = auth.make_code_challenge("test-verifier-12345")
        assert "=" not in c


# ---------------------------------------------------------------------------
# Authorize URL construction
# ---------------------------------------------------------------------------


class TestAuthorizeURL:
    def test_url_contains_required_params(self):
        url = auth.build_authorize_url(
            client_id="abc123",
            redirect_uri="http://127.0.0.1:8765/callback",
            scopes=["user-library-read", "playlist-read-private"],
            code_challenge="challengexyz",
            state="statetoken",
        )
        assert url.startswith("https://accounts.spotify.com/authorize?")
        assert "client_id=abc123" in url
        assert "response_type=code" in url
        assert "code_challenge_method=S256" in url
        assert "code_challenge=challengexyz" in url
        assert "state=statetoken" in url
        # Scopes are space-joined and url-encoded
        assert "user-library-read" in url
        assert "playlist-read-private" in url

    def test_redirect_uri_is_url_encoded(self):
        url = auth.build_authorize_url(
            client_id="x",
            redirect_uri="http://127.0.0.1:8765/callback",
            scopes=[],
            code_challenge="c",
            state="s",
        )
        # ":" and "/" should be percent-encoded inside the value
        assert "redirect_uri=" in url


# ---------------------------------------------------------------------------
# Token exchange
# ---------------------------------------------------------------------------


class TestTokenExchange:
    @responses.activate
    def test_exchange_code_for_token(self):
        responses.add(
            responses.POST,
            SPOTIFY_TOKEN_URL,
            json={
                "access_token": "AT-123",
                "refresh_token": "RT-456",
                "expires_in": 3600,
                "scope": "user-library-read",
                "token_type": "Bearer",
            },
            status=200,
        )
        token = auth.exchange_code_for_token(
            code="auth-code",
            code_verifier="verifier-xyz",
            client_id="cid",
            redirect_uri="http://127.0.0.1:8765/callback",
        )
        assert token.access_token == "AT-123"
        assert token.refresh_token == "RT-456"
        assert not token.is_expired
        # Verify we used the PKCE form (no client_secret in auth=...)
        body = responses.calls[0].request.body
        assert "grant_type=authorization_code" in body
        assert "code=auth-code" in body
        assert "code_verifier=verifier-xyz" in body

    @responses.activate
    def test_refresh_access_token(self):
        responses.add(
            responses.POST,
            SPOTIFY_TOKEN_URL,
            json={
                "access_token": "AT-NEW",
                "expires_in": 3600,
                "token_type": "Bearer",
            },
            status=200,
        )
        token = auth.refresh_access_token(
            refresh_token="RT-OLD",
            client_id="cid",
        )
        assert token.access_token == "AT-NEW"
        # Old refresh token preserved when Spotify doesn't return a new one.
        assert token.refresh_token == "RT-OLD"

    @responses.activate
    def test_refresh_preserves_new_refresh_token(self):
        responses.add(
            responses.POST,
            SPOTIFY_TOKEN_URL,
            json={
                "access_token": "AT-NEW",
                "refresh_token": "RT-NEW",
                "expires_in": 3600,
                "token_type": "Bearer",
            },
            status=200,
        )
        token = auth.refresh_access_token(
            refresh_token="RT-OLD",
            client_id="cid",
        )
        assert token.refresh_token == "RT-NEW"


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


class TestPersistence:
    def test_token_round_trip(self, tmp_path: Path):
        path = tmp_path / "token.json"
        token = auth.TokenSet(
            access_token="A", refresh_token="R", expires_at=time.time() + 3600,
        )
        auth.save_token(token, path)
        loaded = auth.load_token(path)
        assert loaded is not None
        assert loaded.access_token == "A"
        assert loaded.refresh_token == "R"

    def test_token_file_is_owner_only(self, tmp_path: Path):
        path = tmp_path / "token.json"
        auth.save_token(
            auth.TokenSet(access_token="A", refresh_token="R", expires_at=time.time() + 3600),
            path,
        )
        # On non-Windows, perms should be 0600.
        if os.name == "posix":
            mode = path.stat().st_mode & 0o777
            assert mode == 0o600

    def test_token_write_is_atomic_and_no_tmp_leftover(self, tmp_path: Path):
        path = tmp_path / "token.json"
        auth.save_token(
            auth.TokenSet(access_token="A", refresh_token="R", expires_at=time.time() + 3600),
            path,
        )
        # Save again over an existing file and confirm no .tmp-* siblings remain.
        auth.save_token(
            auth.TokenSet(access_token="B", refresh_token="R2", expires_at=time.time() + 3600),
            path,
        )
        leftovers = [p for p in tmp_path.iterdir() if p.name.startswith(".tmp-")]
        assert leftovers == []
        loaded = auth.load_token(path)
        assert loaded is not None and loaded.access_token == "B"

    def test_token_file_never_world_readable(self, tmp_path: Path):
        # Guards against the chmod-after-write TOCTOO: the file must be 0600
        # from the moment it appears, never 0644.
        if os.name != "posix":
            pytest.skip("perm semantics only meaningful on POSIX")
        path = tmp_path / "token.json"
        auth.save_token(
            auth.TokenSet(access_token="A", refresh_token="R", expires_at=time.time() + 3600),
            path,
        )
        mode = path.stat().st_mode & 0o777
        assert mode == 0o600
        assert not (mode & 0o044), "token file must not be group/other readable"

    def test_load_token_missing_returns_none(self, tmp_path: Path):
        assert auth.load_token(tmp_path / "nope.json") is None

    def test_load_token_corrupt_returns_none(self, tmp_path: Path):
        path = tmp_path / "token.json"
        path.write_text("not json at all")
        assert auth.load_token(path) is None

    def test_config_round_trip(self, tmp_path: Path):
        path = tmp_path / "config.json"
        cfg = auth.ClientConfig(
            client_id="abc",
            redirect_uri="http://127.0.0.1:9000/callback",
            scopes=["user-library-read"],
        )
        auth.save_config(cfg, path)
        loaded = auth.load_config(path)
        assert loaded is not None
        assert loaded.client_id == "abc"
        assert loaded.redirect_uri == "http://127.0.0.1:9000/callback"
        assert loaded.scopes == ["user-library-read"]


# ---------------------------------------------------------------------------
# get_valid_token — the cached → refresh → reauth decision tree
# ---------------------------------------------------------------------------


class TestGetValidToken:
    def test_returns_cached_token_when_fresh(self, tmp_path: Path):
        token_path = tmp_path / "token.json"
        fresh = auth.TokenSet(
            access_token="FRESH", refresh_token="R", expires_at=time.time() + 3600,
        )
        auth.save_token(fresh, token_path)

        cfg = auth.ClientConfig(client_id="c")
        tok = auth.get_valid_token(cfg, token_path=token_path)
        assert tok.access_token == "FRESH"

    @responses.activate
    def test_refreshes_when_expired(self, tmp_path: Path):
        token_path = tmp_path / "token.json"
        expired = auth.TokenSet(
            access_token="OLD", refresh_token="R-OLD", expires_at=time.time() - 10,
        )
        auth.save_token(expired, token_path)
        responses.add(
            responses.POST, SPOTIFY_TOKEN_URL,
            json={"access_token": "RENEWED", "expires_in": 3600},
            status=200,
        )
        cfg = auth.ClientConfig(client_id="c")
        tok = auth.get_valid_token(cfg, token_path=token_path)
        assert tok.access_token == "RENEWED"
        # Refresh token preserved.
        assert tok.refresh_token == "R-OLD"

    def test_falls_through_to_full_flow_on_network_error(self, tmp_path: Path):
        # A transient connection error during refresh must not crash — it
        # should fall through to the interactive flow.
        import requests as _requests
        token_path = tmp_path / "token.json"
        expired = auth.TokenSet(
            access_token="OLD", refresh_token="R-OLD", expires_at=time.time() - 10,
        )
        auth.save_token(expired, token_path)
        cfg = auth.ClientConfig(client_id="c")
        with patch.object(auth, "refresh_access_token",
                          side_effect=_requests.ConnectionError("boom")), \
             patch.object(auth, "do_authorization_flow") as mock_flow:
            mock_flow.return_value = auth.TokenSet(
                access_token="NEW", refresh_token="R-NEW",
                expires_at=time.time() + 3600,
            )
            tok = auth.get_valid_token(cfg, token_path=token_path)
            assert tok.access_token == "NEW"
            mock_flow.assert_called_once()

    def test_falls_through_to_full_flow_when_no_cache(self, tmp_path: Path):
        # No token on disk → do_authorization_flow is called.
        token_path = tmp_path / "token.json"
        cfg = auth.ClientConfig(client_id="c")
        with patch.object(auth, "do_authorization_flow") as mock_flow:
            mock_flow.return_value = auth.TokenSet(
                access_token="NEW", refresh_token="R-NEW", expires_at=time.time() + 3600,
            )
            tok = auth.get_valid_token(cfg, token_path=token_path)
            assert tok.access_token == "NEW"
            mock_flow.assert_called_once()
            # And it got persisted.
            assert token_path.exists()


# ---------------------------------------------------------------------------
# Callback server smoke test (without a real browser)
# ---------------------------------------------------------------------------


class TestCallbackServer:
    def test_wait_for_callback_returns_params(self):
        # Simulate the browser callback by hitting the server in a thread.
        import urllib.request

        def hit() -> None:
            # Give the server a moment to start.
            time.sleep(0.1)
            req = urllib.request.Request(
                "http://127.0.0.1:8765/callback?code=abc&state=xyz"
            )
            try:
                urllib.request.urlopen(req, timeout=2).read()
            except Exception:  # noqa: BLE001
                pass

        # Disable browser opening for this test.
        threading.Thread(target=hit, daemon=True).start()
        params = auth.wait_for_callback(timeout=3.0, open_browser=None)
        assert params.get("code") == ["abc"]
        assert params.get("state") == ["xyz"]
