"""Thin client around the Spotify Web API for the endpoints we need.

We intentionally avoid `spotipy` to keep dependencies minimal and to make the
auth/pagination logic transparent.

Endpoints used:
  GET /v1/me                          — current user profile
  GET /v1/me/tracks                   — Liked Songs (paginated, 50/page)
  GET /v1/me/playlists                — current user's playlists (paginated, 50/page)
  GET /v1/playlists/{id}/tracks       — tracks in a playlist (paginated, 100/page)

All read-only — spotify-liberator never modifies your account.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterator, Optional

import requests

from . import SPOTIFY_API_BASE
from .auth import TokenSet


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SpotifyAPIError(Exception):
    """Raised when the Spotify Web API returns an error response."""

    def __init__(self, status: int, message: str, url: str):
        super().__init__(f"Spotify API error {status} for {url}: {message}")
        self.status = status
        self.message = message
        self.url = url


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


@dataclass
class SpotifyClient:
    """Minimal Spotify Web API client.

    The token is refreshed transparently on 401 by `on_unauthorized`.
    """

    token: TokenSet
    on_unauthorized: Optional[Callable[[], TokenSet]] = None
    timeout: float = 30.0

    # --- core request machinery ---------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"{self.token.token_type} {self.token.access_token}"}

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict] = None,
    ) -> dict:
        url = f"{SPOTIFY_API_BASE}{path}"
        for attempt in (0, 1):  # at most one transparent refresh on 401
            resp = requests.request(
                method,
                url,
                headers=self._auth_headers(),
                params=params,
                timeout=self.timeout,
            )
            if resp.status_code == 401 and attempt == 0 and self.on_unauthorized:
                self.token = self.on_unauthorized()
                continue
            break

        if not resp.ok:
            try:
                err = resp.json().get("error", {})
                msg = err.get("message", resp.text) if isinstance(err, dict) else str(err)
            except ValueError:
                msg = resp.text
            raise SpotifyAPIError(resp.status_code, msg, url)

        # Some endpoints return 204; we only call endpoints that return JSON.
        if resp.status_code == 204:
            return {}
        return resp.json()

    # --- paginated generators -----------------------------------------------

    @staticmethod
    def _paginate(
        fetcher: Callable[[Optional[int]], dict],
        items_key: str,
        page_size: int = 50,
    ) -> Iterator[dict]:
        """Yield items from a paginated Spotify endpoint.

        `fetcher(offset)` returns the raw response dict. The function handles
        the `next` cursor loop and yields individual items.
        """
        offset = 0
        while True:
            page = fetcher(offset)
            items = page.get(items_key, [])
            for item in items:
                yield item
            if not page.get("next") or not items:
                return
            offset += page_size

    # --- current user -------------------------------------------------------

    def get_current_user(self) -> dict:
        return self._request("GET", "/me")

    # --- Liked Songs --------------------------------------------------------

    def iter_liked_songs(self, page_size: int = 50) -> Iterator[dict]:
        """Yield raw entries from /me/tracks.

        Each entry has shape: {"added_at": "...", "track": {...}}.
        """
        def fetcher(offset: Optional[int]) -> dict:
            return self._request(
                "GET",
                "/me/tracks",
                params={"limit": page_size, "offset": offset or 0},
            )
        return self._paginate(fetcher, "items", page_size=page_size)

    # --- Playlists ----------------------------------------------------------

    def iter_user_playlists(self, page_size: int = 50) -> Iterator[dict]:
        """Yield the current user's playlists (owned + followed)."""
        def fetcher(offset: Optional[int]) -> dict:
            return self._request(
                "GET",
                "/me/playlists",
                params={"limit": page_size, "offset": offset or 0},
            )
        return self._paginate(fetcher, "items", page_size=page_size)

    def iter_playlist_tracks(
        self,
        playlist_id: str,
        page_size: int = 100,
    ) -> Iterator[dict]:
        """Yield raw entries from /playlists/{id}/tracks.

        Each entry has shape: {"added_at": "...", "added_by": {...}, "track": {...}, ...}.
        """
        def fetcher(offset: Optional[int]) -> dict:
            return self._request(
                "GET",
                f"/playlists/{playlist_id}/tracks",
                params={"limit": page_size, "offset": offset or 0},
            )
        return self._paginate(fetcher, "items", page_size=page_size)

    def get_playlist(self, playlist_id: str) -> dict:
        return self._request("GET", f"/playlists/{playlist_id}")


# ---------------------------------------------------------------------------
# High-level data shape — the "SavedTrack" record we serialize
# ---------------------------------------------------------------------------


def normalize_liked_track(entry: dict) -> dict:
    """Convert a raw Liked Songs entry to a stable, lossless dict."""
    track = entry.get("track") or {}
    return {
        "added_at": entry.get("added_at"),
        "track": _normalize_track(track),
    }


def normalize_playlist_track(entry: dict) -> dict:
    """Convert a raw playlist-track entry to a stable dict.

    The `is_local` field marks tracks that live only in the user's library
    (uploaded files) and have no Spotify URI.
    """
    track = entry.get("track") or {}
    return {
        "added_at": entry.get("added_at"),
        "added_by": entry.get("added_by"),
        "is_local": entry.get("is_local", False),
        "track": _normalize_track(track),
    }


def _normalize_track(track: dict) -> dict:
    """Flatten a Spotify track object to a stable, JSON-friendly shape.

    We keep the data we care about and discard the verbose wrappers Spotify
    returns (e.g., the `external_ids` ISRC, the `available_markets` list,
    the `linked_from` redirect info). We capture enough to re-import the
    track into another service (via ISRC or URI) or to open it in Spotify.
    """
    if not track:
        return {
            "uri": None,
            "id": None,
            "name": None,
            "duration_ms": None,
            "explicit": None,
            "popularity": None,
            "preview_url": None,
            "is_local": None,
            "isrc": None,
            "artists": [],
            "album": None,
            "external_urls": {},
        }

    external_ids = track.get("external_ids") or {}
    return {
        "uri": track.get("uri"),
        "id": track.get("id"),
        "name": track.get("name"),
        "duration_ms": track.get("duration_ms"),
        "explicit": track.get("explicit"),
        "popularity": track.get("popularity"),
        "preview_url": track.get("preview_url"),
        "is_local": track.get("is_local", False),
        "isrc": external_ids.get("isrc"),
        "artists": [
            {"name": a.get("name"), "id": a.get("id"), "uri": a.get("uri")}
            for a in (track.get("artists") or [])
        ],
        "album": _normalize_album(track.get("album") or {}),
        "external_urls": track.get("external_urls") or {},
    }


def _normalize_album(album: dict) -> Optional[dict]:
    if not album:
        return None
    return {
        "name": album.get("name"),
        "id": album.get("id"),
        "uri": album.get("uri"),
        "album_type": album.get("album_type"),
        "release_date": album.get("release_date"),
        "release_date_precision": album.get("release_date_precision"),
        "total_tracks": album.get("total_tracks"),
        "artists": [
            {"name": a.get("name"), "id": a.get("id"), "uri": a.get("uri")}
            for a in (album.get("artists") or [])
        ],
        "external_urls": album.get("external_urls") or {},
    }


def normalize_playlist(playlist: dict) -> dict:
    """Reduce a Spotify playlist object to a portable summary."""
    owner = playlist.get("owner") or {}
    return {
        "id": playlist.get("id"),
        "name": playlist.get("name"),
        "description": playlist.get("description"),
        "public": playlist.get("public"),
        "collaborative": playlist.get("collaborative"),
        "snapshot_id": playlist.get("snapshot_id"),
        "uri": playlist.get("uri"),
        "external_urls": playlist.get("external_urls") or {},
        "owner": {"id": owner.get("id"), "display_name": owner.get("display_name")},
        "tracks_total": (playlist.get("tracks") or {}).get("total"),
    }
