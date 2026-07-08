"""Spotify Web API client and response normalizers.

`SpotifyClient` wraps the REST endpoints we need (current user, Liked Songs,
user playlists, playlist tracks) with automatic pagination and transparent
401 → refresh-token-retry via an `on_unauthorized` callback.

The `normalize_*` functions flatten Spotify's verbose, nullable-laden JSON
into the stable shapes the exporter and tests rely on. Keeping the
normalizers here (rather than in the exporter) means both the CLI and tests
share one definition of "what a normalized track looks like".
"""

from __future__ import annotations

from typing import Callable, Iterator, Optional

import requests

from . import SPOTIFY_API_BASE
from .auth import TokenSet


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class SpotifyAPIError(Exception):
    """Raised when the Spotify Web API returns a non-success status."""

    def __init__(self, status: int, message: str = "") -> None:
        self.status = status
        self.message = message
        super().__init__(f"{status} {message}" if message else str(status))


# ---------------------------------------------------------------------------
# Normalizers
# ---------------------------------------------------------------------------


def _normalize_artist(a: Optional[dict]) -> dict:
    a = a or {}
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "uri": a.get("uri"),
        "type": a.get("type", "artist"),
    }


def _normalize_album(a: Optional[dict]) -> Optional[dict]:
    if a is None:
        return None
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "uri": a.get("uri"),
        "album_type": a.get("album_type"),
        "release_date": a.get("release_date"),
        "release_date_precision": a.get("release_date_precision"),
        "total_tracks": a.get("total_tracks"),
        "artists": [_normalize_artist(x) for x in (a.get("artists") or [])],
        "external_urls": a.get("external_urls") or {},
    }


def _normalize_track(t: Optional[dict]) -> dict:
    """Flatten a Spotify track object, tolerating null/missing fields.

    Spotify returns `"track": null` for unavailable entries (e.g. when a
    Liked Song is removed from the catalog). We produce a stable shape so
    downstream code never has to special-case None.
    """
    if t is None:
        return {
            "uri": None,
            "id": None,
            "name": None,
            "duration_ms": None,
            "explicit": None,
            "popularity": None,
            "isrc": None,
            "is_local": False,
            "preview_url": None,
            "external_urls": {},
            "external_ids": {},
            "artists": [],
            "album": None,
        }
    external_ids = t.get("external_ids") or {}
    return {
        "uri": t.get("uri"),
        "id": t.get("id"),
        "name": t.get("name"),
        "duration_ms": t.get("duration_ms"),
        "explicit": t.get("explicit"),
        "popularity": t.get("popularity"),
        "isrc": external_ids.get("isrc"),
        "is_local": t.get("is_local", False),
        "preview_url": t.get("preview_url"),
        "external_urls": t.get("external_urls") or {},
        "external_ids": external_ids,
        "artists": [_normalize_artist(a) for a in (t.get("artists") or [])],
        "album": _normalize_album(t.get("album")),
    }


def normalize_liked_track(entry: dict) -> dict:
    """Normalize a `/me/tracks` entry."""
    return {
        "added_at": entry.get("added_at"),
        "track": _normalize_track(entry.get("track")),
    }


def normalize_playlist_track(entry: dict) -> dict:
    """Normalize a `/playlists/{id}/tracks` entry."""
    return {
        "added_at": entry.get("added_at"),
        "added_by": entry.get("added_by"),
        "is_local": entry.get("is_local", False),
        "track": _normalize_track(entry.get("track")),
    }


def normalize_playlist(pl: dict) -> dict:
    """Normalize a playlist summary (from `/me/playlists`)."""
    owner = pl.get("owner") or {}
    tracks = pl.get("tracks") or {}
    return {
        "id": pl.get("id"),
        "name": pl.get("name"),
        "description": pl.get("description"),
        "public": pl.get("public"),
        "collaborative": pl.get("collaborative"),
        "snapshot_id": pl.get("snapshot_id"),
        "uri": pl.get("uri"),
        "external_urls": pl.get("external_urls") or {},
        "owner": {
            "id": owner.get("id"),
            "display_name": owner.get("display_name"),
            "uri": owner.get("uri"),
        },
        "tracks_total": tracks.get("total"),
    }


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class SpotifyClient:
    """A thin Spotify Web API client with pagination + transparent refresh.

    Parameters
    ----------
    token:
        Current ``TokenSet``. On a 401, if ``on_unauthorized`` is provided it
        is invoked to produce a fresh ``TokenSet`` which replaces ``self.token``
        and the request is retried exactly once.
    on_unauthorized:
        Optional zero-arg callable returning a fresh ``TokenSet``. Typically
        wired to :func:`spotify_liberator.auth.get_valid_token`.
    """

    def __init__(
        self,
        token: TokenSet,
        on_unauthorized: Optional[Callable[[], TokenSet]] = None,
    ) -> None:
        self.token = token
        self.on_unauthorized = on_unauthorized
        self._session = requests.Session()

    # -- internals --------------------------------------------------------

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token.access_token}"}

    def _raise_for_status(self, resp: requests.Response) -> None:
        message = ""
        try:
            body = resp.json()
        except ValueError:
            message = resp.text or ""
        else:
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict):
                    message = err.get("message", "")
                elif isinstance(err, str):
                    message = err
        raise SpotifyAPIError(resp.status_code, message)

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict] = None,
        _retried: bool = False,
    ) -> requests.Response:
        resp = self._session.request(
            method, url, headers=self._auth_headers(), params=params, timeout=30,
        )
        if resp.status_code == 401 and not _retried and self.on_unauthorized is not None:
            # Refresh and retry exactly once.
            self.token = self.on_unauthorized()
            return self._request(method, url, params=params, _retried=True)
        if not resp.ok:
            self._raise_for_status(resp)
        return resp

    def _get(self, url: str, params: Optional[dict] = None) -> dict:
        return self._request("GET", url, params=params).json()

    # -- endpoints --------------------------------------------------------

    def get_current_user(self) -> dict:
        return self._get(f"{SPOTIFY_API_BASE}/me")

    def iter_liked_songs(self, page_size: int = 50) -> Iterator[dict]:
        """Yield raw `/me/tracks` entries, following `next` cursors."""
        url: Optional[str] = f"{SPOTIFY_API_BASE}/me/tracks"
        first = True
        while url is not None:
            params = {"limit": page_size, "offset": 0} if first else None
            page = self._get(url, params=params)
            first = False
            for item in page.get("items", []):
                yield item
            url = page.get("next")

    def iter_user_playlists(self, page_size: int = 50) -> Iterator[dict]:
        """Yield raw playlist summaries from `/me/playlists`."""
        url: Optional[str] = f"{SPOTIFY_API_BASE}/me/playlists"
        first = True
        while url is not None:
            params = {"limit": page_size, "offset": 0} if first else None
            page = self._get(url, params=params)
            first = False
            for item in page.get("items", []):
                yield item
            url = page.get("next")

    def iter_playlist_tracks(self, playlist_id: str, page_size: int = 100) -> Iterator[dict]:
        """Yield raw track entries from `/playlists/{id}/tracks`."""
        url: Optional[str] = f"{SPOTIFY_API_BASE}/playlists/{playlist_id}/tracks"
        first = True
        while url is not None:
            params = {"limit": page_size, "offset": 0} if first else None
            page = self._get(url, params=params)
            first = False
            for item in page.get("items", []):
                yield item
            url = page.get("next")


__all__ = [
    "SpotifyAPIError",
    "SpotifyClient",
    "normalize_liked_track",
    "normalize_playlist",
    "normalize_playlist_track",
]