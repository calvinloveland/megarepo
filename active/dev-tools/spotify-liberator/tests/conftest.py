"""Pytest fixtures and shared mock helpers."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

# Ensure the src/ layout is importable.
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture
def sample_track() -> dict:
    return {
        "uri": "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
        "id": "4iV5W9uYEdYUVa79Axb7Rh",
        "name": "Mr. Blue Sky",
        "duration_ms": 297733,
        "explicit": False,
        "popularity": 79,
        "preview_url": "https://p.scdn.co/mp3-preview/abcdef",
        "is_local": False,
        "external_ids": {"isrc": "USEE10000246"},
        "external_urls": {"spotify": "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"},
        "artists": [
            {
                "id": "3vLaGsDXtBSk9z8FCd21Cw",
                "name": "Electric Light Orchestra",
                "uri": "spotify:artist:3vLaGsDXtBSk9z8FCd21Cw",
                "type": "artist",
            }
        ],
        "album": {
            "id": "6bJfM5hyMZaG6OeEG1yMbe",
            "name": "Out of the Blue",
            "uri": "spotify:album:6bJfM5hyMZaG6OeEG1yMbe",
            "album_type": "album",
            "release_date": "1977-10-03",
            "release_date_precision": "day",
            "total_tracks": 17,
            "artists": [
                {"id": "3vLaGsDXtBSk9z8FCd21Cw", "name": "Electric Light Orchestra",
                 "uri": "spotify:artist:3vLaGsDXtBSk9z8FCd21Cw"}
            ],
            "external_urls": {"spotify": "https://open.spotify.com/album/6bJfM5hyMZaG6OeEG1yMbe"},
        },
    }


@pytest.fixture
def sample_liked_entry(sample_track) -> dict:
    return {
        "added_at": "2020-08-15T18:23:11Z",
        "track": sample_track,
    }


@pytest.fixture
def sample_user() -> dict:
    return {
        "id": "calvinloveland",
        "display_name": "Calvin Loveland",
        "email": "calvin@loveland.dev",
        "country": "US",
        "product": "premium",
        "external_urls": {"spotify": "https://open.spotify.com/user/calvinloveland"},
    }


@pytest.fixture
def sample_playlist() -> dict:
    return {
        "id": "37i9dQZF1DXcBWIGoYBM5M",
        "name": "Top 50 Global",
        "description": "The most played tracks on Spotify, updated daily.",
        "public": True,
        "collaborative": False,
        "snapshot_id": "abc123",
        "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
        "external_urls": {"spotify": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"},
        "owner": {
            "id": "spotify",
            "display_name": "Spotify",
        },
        "tracks": {"total": 2, "href": "..."},
    }
