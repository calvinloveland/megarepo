"""Export fetched Spotify data to JSON, CSV, and M3U.

Each export format is best for a different use case:

  - JSON: lossless, includes every field, ideal for archival and re-import.
  - CSV:  flat, spreadsheet-friendly, what humans usually want to eyeball.
  - M3U:  portable playlist format. We emit `#EXTINF` lines so any tool
          that reads M3U8 (including Spotify's own desktop import) can
          re-import the playlist. Local-file entries use `spotify:track:...`
          URIs as `file://` is not appropriate.

We write to the output directory with a stable, well-named file layout so a
re-run is idempotent — files of the same name get overwritten, new playlists
get new files.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from .api import normalize_liked_track, normalize_playlist, normalize_playlist_track


# ---------------------------------------------------------------------------
# Liked Songs export
# ---------------------------------------------------------------------------


@dataclass
class LikedSongsExport:
    """A complete export bundle for Liked Songs."""

    user: dict                     # from /me
    tracks: list[dict]             # normalized Liked Songs entries (with `added_at`)

    @property
    def count(self) -> int:
        return len(self.tracks)

    def write(
        self,
        output_dir: Path,
        base_name: str = "liked_songs",
        formats: Iterable[str] = ("json", "csv", "m3u"),
        m3u_with_metadata: bool = True,
    ) -> list[Path]:
        """Write the export in the requested formats. Returns the list of paths written."""
        output_dir.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        for fmt in formats:
            fmt = fmt.lower()
            if fmt == "json":
                written.append(self._write_json(output_dir, base_name))
            elif fmt == "csv":
                written.append(self._write_csv(output_dir, base_name))
            elif fmt == "m3u":
                written.append(self._write_m3u(output_dir, base_name, m3u_with_metadata))
            else:
                raise ValueError(f"Unknown export format: {fmt!r}")
        return written

    # --- writers -----------------------------------------------------------

    def _write_json(self, output_dir: Path, base_name: str) -> Path:
        path = output_dir / f"{base_name}.json"
        payload = {
            "schema": "spotify-liberator/liked-songs@1",
            "exported_at": _utcnow_iso(),
            "user": {
                "id": self.user.get("id"),
                "display_name": self.user.get("display_name"),
                "email": self.user.get("email"),
                "country": self.user.get("country"),
                "product": self.user.get("product"),
                "external_urls": self.user.get("external_urls") or {},
            },
            "count": self.count,
            "tracks": self.tracks,
        }
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        return path

    def _write_csv(self, output_dir: Path, base_name: str) -> Path:
        path = output_dir / f"{base_name}.csv"
        fieldnames = [
            "added_at",
            "track_uri",
            "track_id",
            "track_name",
            "duration_ms",
            "explicit",
            "popularity",
            "isrc",
            "artists",
            "album_name",
            "album_uri",
            "release_date",
            "preview_url",
            "spotify_url",
        ]
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for entry in self.tracks:
                t = entry["track"]
                writer.writerow({
                    "added_at": entry.get("added_at"),
                    "track_uri": t.get("uri"),
                    "track_id": t.get("id"),
                    "track_name": t.get("name"),
                    "duration_ms": t.get("duration_ms"),
                    "explicit": t.get("explicit"),
                    "popularity": t.get("popularity"),
                    "isrc": t.get("isrc"),
                    "artists": ", ".join(a["name"] for a in t.get("artists") or [] if a.get("name")),
                    "album_name": (t.get("album") or {}).get("name"),
                    "album_uri": (t.get("album") or {}).get("uri"),
                    "release_date": (t.get("album") or {}).get("release_date"),
                    "preview_url": t.get("preview_url"),
                    "spotify_url": (t.get("external_urls") or {}).get("spotify"),
                })
        return path

    def _write_m3u(
        self,
        output_dir: Path,
        base_name: str,
        with_metadata: bool,
    ) -> Path:
        path = output_dir / f"{base_name}.m3u"
        lines: list[str] = ["#EXTM3U"]
        for entry in self.tracks:
            t = entry["track"]
            uri = t.get("uri") or ""
            if with_metadata and t.get("name"):
                artist_str = ", ".join(
                    a["name"] for a in t.get("artists") or [] if a.get("name")
                )
                duration_s = (t.get("duration_ms") or 0) // 1000
                lines.append(f"#EXTINF:{duration_s},{artist_str} - {t['name']}")
            if uri:
                lines.append(uri)
            else:
                # No URI (e.g. local file) — write a comment so the line is preserved.
                lines.append(f"# {t.get('name') or 'unknown track'} (no Spotify URI)")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path


# ---------------------------------------------------------------------------
# Playlists export
# ---------------------------------------------------------------------------


@dataclass
class PlaylistExport:
    """A single playlist's export, including all normalized tracks."""

    playlist: dict          # normalized playlist summary
    tracks: list[dict]      # normalized playlist-track entries (with `added_at`)

    @property
    def slug(self) -> str:
        """Filesystem-safe slug from the playlist name."""
        name = self.playlist.get("name") or f"playlist_{self.playlist.get('id')}"
        return _slugify(name)

    @property
    def count(self) -> int:
        return len(self.tracks)

    def write(
        self,
        output_dir: Path,
        formats: Iterable[str] = ("json", "csv", "m3u"),
        m3u_with_metadata: bool = True,
    ) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        base = f"playlist_{self.slug}"
        for fmt in formats:
            fmt = fmt.lower()
            if fmt == "json":
                written.append(self._write_json(output_dir, base))
            elif fmt == "csv":
                written.append(self._write_csv(output_dir, base))
            elif fmt == "m3u":
                written.append(self._write_m3u(output_dir, base, m3u_with_metadata))
            else:
                raise ValueError(f"Unknown export format: {fmt!r}")
        return written

    def _write_json(self, output_dir: Path, base_name: str) -> Path:
        path = output_dir / f"{base_name}.json"
        payload = {
            "schema": "spotify-liberator/playlist@1",
            "exported_at": _utcnow_iso(),
            "playlist": self.playlist,
            "count": self.count,
            "tracks": self.tracks,
        }
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        return path

    def _write_csv(self, output_dir: Path, base_name: str) -> Path:
        path = output_dir / f"{base_name}.csv"
        fieldnames = [
            "added_at",
            "track_uri",
            "track_id",
            "track_name",
            "duration_ms",
            "explicit",
            "popularity",
            "isrc",
            "artists",
            "album_name",
            "album_uri",
            "release_date",
            "preview_url",
            "spotify_url",
        ]
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for entry in self.tracks:
                t = entry["track"]
                writer.writerow({
                    "added_at": entry.get("added_at"),
                    "track_uri": t.get("uri"),
                    "track_id": t.get("id"),
                    "track_name": t.get("name"),
                    "duration_ms": t.get("duration_ms"),
                    "explicit": t.get("explicit"),
                    "popularity": t.get("popularity"),
                    "isrc": t.get("isrc"),
                    "artists": ", ".join(a["name"] for a in t.get("artists") or [] if a.get("name")),
                    "album_name": (t.get("album") or {}).get("name"),
                    "album_uri": (t.get("album") or {}).get("uri"),
                    "release_date": (t.get("album") or {}).get("release_date"),
                    "preview_url": t.get("preview_url"),
                    "spotify_url": (t.get("external_urls") or {}).get("spotify"),
                })
        return path

    def _write_m3u(
        self,
        output_dir: Path,
        base_name: str,
        with_metadata: bool,
    ) -> Path:
        path = output_dir / f"{base_name}.m3u"
        header = f"#PLAYLIST:{self.playlist.get('name') or 'Untitled'}"
        lines: list[str] = ["#EXTM3U", header]
        for entry in self.tracks:
            t = entry["track"]
            uri = t.get("uri") or ""
            if with_metadata and t.get("name"):
                artist_str = ", ".join(
                    a["name"] for a in t.get("artists") or [] if a.get("name")
                )
                duration_s = (t.get("duration_ms") or 0) // 1000
                lines.append(f"#EXTINF:{duration_s},{artist_str} - {t['name']}")
            if uri:
                lines.append(uri)
            else:
                lines.append(f"# {t.get('name') or 'unknown track'} (no Spotify URI)")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slugify(text: str) -> str:
    """Make a filesystem-friendly slug from arbitrary text."""
    import re
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9._-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("._-")
    return s or "untitled"


# Re-export the normalizers for convenience to CLI layer.
__all__ = [
    "LikedSongsExport",
    "PlaylistExport",
    "normalize_liked_track",
    "normalize_playlist",
    "normalize_playlist_track",
]
