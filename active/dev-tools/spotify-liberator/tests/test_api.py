"""Tests for the API client and normalizers."""

from __future__ import annotations

import time

import pytest
import responses

from spotify_liberator import SPOTIFY_API_BASE
from spotify_liberator.api import (
    SpotifyAPIError,
    SpotifyClient,
    normalize_liked_track,
    normalize_playlist,
    normalize_playlist_track,
)
from spotify_liberator.auth import TokenSet


def _make_client() -> SpotifyClient:
    return SpotifyClient(
        token=TokenSet(
            access_token="AT",
            refresh_token="RT",
            expires_at=time.time() + 3600,
        ),
        on_unauthorized=None,
    )


# ---------------------------------------------------------------------------
# Normalizers
# ---------------------------------------------------------------------------


class TestNormalizeLikedTrack:
    def test_basic_shape(self, sample_liked_entry):
        out = normalize_liked_track(sample_liked_entry)
        assert out["added_at"] == "2020-08-15T18:23:11Z"
        assert out["track"]["name"] == "Mr. Blue Sky"
        assert out["track"]["isrc"] == "USEE10000246"
        assert out["track"]["artists"][0]["name"] == "Electric Light Orchestra"
        assert out["track"]["album"]["name"] == "Out of the Blue"

    def test_handles_null_track(self):
        out = normalize_liked_track({"added_at": "2020-01-01T00:00:00Z", "track": None})
        assert out["track"]["uri"] is None
        assert out["track"]["artists"] == []

    def test_handles_missing_fields(self):
        out = normalize_liked_track({"track": {"name": "Barebones", "uri": "spotify:track:x"}})
        t = out["track"]
        assert t["name"] == "Barebones"
        assert t["isrc"] is None
        assert t["artists"] == []
        assert t["album"] is None


class TestNormalizePlaylistTrack:
    def test_preserves_is_local(self, sample_track):
        entry = {
            "added_at": "2024-01-01T00:00:00Z",
            "added_by": {"id": "user1"},
            "is_local": True,
            "track": sample_track,
        }
        out = normalize_playlist_track(entry)
        assert out["is_local"] is True
        assert out["added_by"]["id"] == "user1"


class TestNormalizePlaylist:
    def test_basic_shape(self, sample_playlist):
        out = normalize_playlist(sample_playlist)
        assert out["id"] == sample_playlist["id"]
        assert out["name"] == "Top 50 Global"
        assert out["owner"]["id"] == "spotify"
        assert out["tracks_total"] == 2


# ---------------------------------------------------------------------------
# Client behavior
# ---------------------------------------------------------------------------


class TestSpotifyClient:
    @responses.activate
    def test_get_current_user(self):
        responses.add(
            responses.GET,
            f"{SPOTIFY_API_BASE}/me",
            json={"id": "u1", "display_name": "U1"},
            status=200,
        )
        client = _make_client()
        user = client.get_current_user()
        assert user["id"] == "u1"

    @responses.activate
    def test_iter_liked_songs_paginates(self):
        # Two pages: 50 items, then 10 items, then no `next`.
        page1 = {
            "items": [{"added_at": f"2020-01-01T00:00:{i:02d}Z", "track": {"uri": f"spotify:track:{i}"}} for i in range(50)],
            "next": f"{SPOTIFY_API_BASE}/me/tracks?offset=50",
            "total": 60,
        }
        page2 = {
            "items": [{"added_at": f"2020-01-02T00:00:{i:02d}Z", "track": {"uri": f"spotify:track:{i+50}"}} for i in range(10)],
            "next": None,
            "total": 60,
        }
        responses.add(
            responses.GET,
            f"{SPOTIFY_API_BASE}/me/tracks",
            json=page1, status=200,
        )
        responses.add(
            responses.GET,
            f"{SPOTIFY_API_BASE}/me/tracks",
            json=page2, status=200,
        )

        client = _make_client()
        items = list(client.iter_liked_songs(page_size=50))
        assert len(items) == 60
        # Pagination should have called the endpoint twice.
        assert len(responses.calls) == 2

    @responses.activate
    def test_iter_user_playlists(self):
        page1 = {
            "items": [{"id": f"p{i}", "name": f"Playlist {i}", "owner": {}, "tracks": {"total": 1}} for i in range(3)],
            "next": None,
        }
        responses.add(
            responses.GET,
            f"{SPOTIFY_API_BASE}/me/playlists",
            json=page1, status=200,
        )
        client = _make_client()
        playlists = list(client.iter_user_playlists())
        assert len(playlists) == 3

    @responses.activate
    def test_error_response_raises(self):
        responses.add(
            responses.GET, f"{SPOTIFY_API_BASE}/me",
            json={"error": {"message": "rate limited"}},
            status=429,
        )
        client = _make_client()
        with pytest.raises(SpotifyAPIError) as exc_info:
            client.get_current_user()
        assert exc_info.value.status == 429
        assert "rate limited" in str(exc_info.value)

    @responses.activate
    def test_on_unauthorized_refreshes_token(self):
        """When the API returns 401, the client should refresh via the callback."""
        # First call: 401.
        responses.add(
            responses.GET, f"{SPOTIFY_API_BASE}/me",
            json={"error": {"message": "expired"}}, status=401,
        )
        # Second call (after refresh): 200.
        responses.add(
            responses.GET, f"{SPOTIFY_API_BASE}/me",
            json={"id": "u"}, status=200,
        )

        refresh_called = []

        def refresher() -> TokenSet:
            refresh_called.append(True)
            return TokenSet(
                access_token="AT-NEW",
                refresh_token="RT",
                expires_at=time.time() + 3600,
            )

        client = SpotifyClient(
            token=TokenSet(access_token="AT-OLD", refresh_token="RT", expires_at=time.time() - 1),
            on_unauthorized=refresher,
        )
        user = client.get_current_user()
        assert user["id"] == "u"
        assert refresh_called == [True]
        # The refreshed token should now be in the client.
        assert client.token.access_token == "AT-NEW"
