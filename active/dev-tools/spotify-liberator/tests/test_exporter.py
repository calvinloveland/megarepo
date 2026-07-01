"""Tests for the JSON / CSV / M3U exporters."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from spotify_liberator.exporter import (
    LikedSongsExport,
    PlaylistExport,
    _slugify,
)


# ---------------------------------------------------------------------------
# Slugify
# ---------------------------------------------------------------------------


class TestSlugify:
    @pytest.mark.parametrize("text,expected", [
        ("Top 50 Global", "top_50_global"),
        ("My Mix #3!!", "my_mix_3"),
        ("  spaces  ", "spaces"),
        ("with/slashes", "with_slashes"),
        ("", "untitled"),
        ("###", "untitled"),
    ])
    def test_slugify(self, text, expected):
        assert _slugify(text) == expected


# ---------------------------------------------------------------------------
# Liked Songs export
# ---------------------------------------------------------------------------


class TestLikedSongsExport:
    def _make_export(self, sample_user, sample_liked_entry):
        return LikedSongsExport(
            user=sample_user,
            tracks=[
                sample_liked_entry,
                {
                    "added_at": "2021-05-01T00:00:00Z",
                    "track": {
                        "uri": "spotify:track:abc",
                        "id": "abc",
                        "name": "Another Song",
                        "duration_ms": 200000,
                        "explicit": True,
                        "popularity": 50,
                        "preview_url": None,
                        "isrc": "USRC17607839",
                        "artists": [{"name": "Artist A"}, {"name": "Artist B"}],
                        "album": {
                            "name": "Album X",
                            "uri": "spotify:album:xxx",
                            "release_date": "2019-12-25",
                        },
                        "external_urls": {"spotify": "https://open.spotify.com/track/abc"},
                    },
                },
            ],
        )

    def test_writes_all_three_formats(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        written = export.write(tmp_path, base_name="liked")
        names = {p.name for p in written}
        assert names == {"liked.json", "liked.csv", "liked.m3u"}

    def test_writes_subset_of_formats(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        written = export.write(tmp_path, base_name="liked", formats=["json"])
        assert [p.name for p in written] == ["liked.json"]

    def test_json_structure_is_lossless(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        path = export.write(tmp_path, base_name="liked", formats=["json"])[0]
        data = json.loads(path.read_text())
        assert data["schema"] == "spotify-liberator/liked-songs@1"
        assert "exported_at" in data
        assert data["count"] == 2
        assert data["user"]["id"] == sample_user["id"]
        # Full ISRC + album preserved
        assert data["tracks"][0]["track"]["isrc"] == "USEE10000246"
        assert data["tracks"][0]["track"]["album"]["name"] == "Out of the Blue"

    def test_csv_is_flat_and_readable(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        path = export.write(tmp_path, base_name="liked", formats=["csv"])[0]
        with path.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 2
        first = rows[0]
        assert first["track_name"] == "Mr. Blue Sky"
        assert first["artists"] == "Electric Light Orchestra"
        assert first["album_name"] == "Out of the Blue"
        assert first["isrc"] == "USEE10000246"
        assert first["release_date"] == "1977-10-03"
        second = rows[1]
        # Multi-artist joined with comma
        assert second["artists"] == "Artist A, Artist B"

    def test_m3u_contains_uris_and_metadata(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        path = export.write(tmp_path, base_name="liked", formats=["m3u"])[0]
        text = path.read_text()
        assert text.startswith("#EXTM3U\n")
        assert "#EXTINF:297,Electric Light Orchestra - Mr. Blue Sky" in text
        assert "spotify:track:4iV5W9uYEdYUVa79Axb7Rh" in text
        assert "spotify:track:abc" in text

    def test_m3u_without_metadata_omits_extinf(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        path = export.write(
            tmp_path, base_name="liked", formats=["m3u"], m3u_with_metadata=False,
        )[0]
        text = path.read_text()
        assert "#EXTINF" not in text
        assert "spotify:track:4iV5W9uYEdYUVa79Axb7Rh" in text

    def test_rejects_unknown_format(self, tmp_path: Path, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        with pytest.raises(ValueError, match="Unknown export format"):
            export.write(tmp_path, formats=["xml"])

    def test_count_property(self, sample_user, sample_liked_entry):
        export = self._make_export(sample_user, sample_liked_entry)
        assert export.count == 2


# ---------------------------------------------------------------------------
# Playlist export
# ---------------------------------------------------------------------------


class TestPlaylistExport:
    def test_slug_from_name(self, sample_playlist):
        export = PlaylistExport(playlist=sample_playlist, tracks=[])
        assert export.slug == "top_50_global"

    def test_slug_falls_back_to_id(self):
        export = PlaylistExport(
            playlist={"id": "abc123", "name": ""}, tracks=[],
        )
        assert export.slug == "playlist_abc123"

    def test_writes_files_with_playlist_prefix(
        self, tmp_path: Path, sample_playlist, sample_liked_entry,
    ):
        export = PlaylistExport(
            playlist=sample_playlist,
            tracks=[sample_liked_entry],
        )
        written = export.write(tmp_path)
        names = {p.name for p in written}
        assert "playlist_top_50_global.json" in names
        assert "playlist_top_50_global.csv" in names
        assert "playlist_top_50_global.m3u" in names

    def test_json_contains_playlist_meta_and_tracks(
        self, tmp_path: Path, sample_playlist, sample_liked_entry,
    ):
        export = PlaylistExport(
            playlist=sample_playlist,
            tracks=[sample_liked_entry],
        )
        path = export.write(tmp_path, formats=["json"])[0]
        data = json.loads(path.read_text())
        assert data["schema"] == "spotify-liberator/playlist@1"
        assert data["playlist"]["id"] == sample_playlist["id"]
        assert data["count"] == 1
        assert data["tracks"][0]["track"]["isrc"] == "USEE10000246"

    def test_m3u_includes_playlist_header(
        self, tmp_path: Path, sample_playlist, sample_liked_entry,
    ):
        export = PlaylistExport(
            playlist=sample_playlist, tracks=[sample_liked_entry],
        )
        path = export.write(tmp_path, formats=["m3u"])[0]
        text = path.read_text()
        assert text.startswith("#EXTM3U\n")
        assert "#PLAYLIST:Top 50 Global" in text
