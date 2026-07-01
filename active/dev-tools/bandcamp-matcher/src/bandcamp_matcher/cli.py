"""CLI entry point: run the Bandcamp matcher on a Spotify CSV export."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

from . import __version__
from .matcher import (
    CSVTrack,
    find_artist_url,
    group_by_artist,
    read_csv,
    scrape_artist_grid,
    scrape_album_tracks,
    scrape_artist_tracks,
)


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

CACHE_DIR = Path(os.environ.get(
    "BC_MATCHER_CACHE",
    Path.home() / ".cache" / "bandcamp-matcher",
))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_ARTIST_CACHE_FILE = CACHE_DIR / "artist_urls.json"
_GRID_CACHE_DIR = CACHE_DIR / "grids"
_ALBUM_CACHE_DIR = CACHE_DIR / "albums"
_GRID_CACHE_DIR.mkdir(exist_ok=True)
_ALBUM_CACHE_DIR.mkdir(exist_ok=True)


def _load_artist_cache() -> dict[str, Optional[str]]:
    if _ARTIST_CACHE_FILE.exists():
        return json.loads(_ARTIST_CACHE_FILE.read_text())
    return {}


def _save_artist_cache(cache: dict[str, Optional[str]]) -> None:
    _ARTIST_CACHE_FILE.write_text(json.dumps(cache, indent=2))


def _load_grid_cache(artist_url: str) -> Optional[list]:
    safe = artist_url.replace("https://", "").replace("/", "_").replace(".", "_")
    path = _GRID_CACHE_DIR / f"{safe}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def _save_grid_cache(artist_url: str, data: list) -> None:
    safe = artist_url.replace("https://", "").replace("/", "_").replace(".", "_")
    path = _GRID_CACHE_DIR / f"{safe}.json"
    path.write_text(json.dumps(data, indent=2))


def _load_album_cache(rel_url: str, base_url: str) -> Optional[list]:
    safe = (
        base_url.replace("https://", "").replace("/", "_").replace(".", "_")
        + rel_url.replace("/", "_")
    )
    path = _ALBUM_CACHE_DIR / f"{safe}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def _save_album_cache(rel_url: str, base_url: str, data: list) -> None:
    safe = (
        base_url.replace("https://", "").replace("/", "_").replace(".", "_")
        + rel_url.replace("/", "_")
    )
    path = _ALBUM_CACHE_DIR / f"{safe}.json"
    path.write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def _norm(name: str) -> str:
    """Normalize a track name for fuzzy matching."""
    import re
    s = name.lower().strip()
    # Strip parentheticals
    s = re.sub(r"\(.*?\)", "", s)
    # Strip [Remastered], [feat. ...], [Explicit], etc.
    s = re.sub(r"\s*-\s*(remastered|remaster|mono|stereo)(\s+\d{4})?\s*$", "", s)
    s = re.sub(r"\s*\[.*?\]", "", s)
    # Strip non-alphanumeric
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _match_track(track: CSVTrack, bctracks: dict[str, dict], artist: str) -> Optional[dict]:
    """Try to find a CSV track in the Bandcamp track dict.

    Tries: exact normalized match, stripped-feature match, Jaccard similarity.
    Returns the BC track dict or None.
    """
    names = track.track_name
    norm = _norm(names)

    # 1. Direct normalized match
    if norm in bctracks:
        return bctracks[norm]

    # 2. Try stripping anything after " - " (featured artist separator)
    for sep in [" - ", " – ", " — ", " — ", "/"]:
        if sep in norm:
            before = norm.split(sep)[0].strip()
            if before in bctracks:
                return bctracks[before]

    # 3. Try matching the BC side: sometimes BC has extra info after the title
    for bckey, bcdata in bctracks.items():
        bcnorm = _norm(bcdata.get("title", ""))
        if bcnorm == norm:
            return bcdata
        # One contains the other
        if len(norm) >= 5 and (norm in bcnorm or bcnorm in norm):
            return bcdata

    return None


# ---------------------------------------------------------------------------
# Processing
# ---------------------------------------------------------------------------


def process_csv(
    csv_path: str,
    quiet: bool = False,
    skip_cache: bool = False,
) -> dict:
    """Full pipeline: read CSV, find BC artists, scrape, match, report.

    Returns the report dict ready to serialize.
    """
    if skip_cache:
        _ARTIST_CACHE_FILE.unlink(missing_ok=True)
        for d in [_GRID_CACHE_DIR, _ALBUM_CACHE_DIR]:
            for f in d.iterdir():
                f.unlink()

    log = lambda msg: None if quiet else print(f"  {msg}", file=sys.stderr)

    # 1. Read CSV
    tracks = read_csv(csv_path)
    total = len(tracks)
    log(f"Read {total} tracks from {csv_path}")

    # 2. Group by artist
    by_artist = group_by_artist(tracks)
    log(f"Unique artists: {len(by_artist)}")

    # 3. Load cache
    artist_cache = _load_artist_cache()

    # 4. Find Bandcamp URLs for each artist
    def _find_bc_url(artist_name: str) -> Optional[str]:
        """Try to find a BC page for an artist name."""
        if artist_name in artist_cache:
            return artist_cache[artist_name]
        # Try the full name first, then each component after split.
        candidates = [artist_name]
        for sep in [",", " feat.", " ft.", " & ", " and "]:
            parts = [p.strip() for p in artist_name.split(sep) if p.strip()]
            candidates.extend(parts)
        for candidate in candidates:
            url = find_artist_url(candidate)
            if url:
                return url
        return None

    artist_urls: dict[str, Optional[str]] = {}
    for i, artist in enumerate(by_artist):
        if artist in artist_cache:
            cached_url = artist_cache[artist]
            artist_urls[artist] = cached_url
            if cached_url:
                log(f"[{i+1}/{len(by_artist)}] {artist:30s} ✅ cached → {cached_url}")
            else:
                log(f"[{i+1}/{len(by_artist)}] {artist:30s} ❌ cached as not found")
            continue

        url = _find_bc_url(artist)
        artist_urls[artist] = url
        artist_cache[artist] = url

        if url:
            log(f"[{i+1}/{len(by_artist)}] {artist:30s} ✅ → {url}")
        else:
            log(f"[{i+1}/{len(by_artist)}] {artist:30s} ❌ not found")

    _save_artist_cache(artist_cache)

    # 5. Scrape artist pages for track listings
    bc_tracks_by_artist: dict[str, dict[str, dict]] = {}
    for artist, url in artist_urls.items():
        if not url:
            bc_tracks_by_artist[artist] = {}
            continue

        # Check grid cache
        grid = _load_grid_cache(url)
        if grid is None:
            grid_data = scrape_artist_grid(url)
            # Convert to serializable
            grid = [
                {"url": r.url, "title": r.title, "release_type": r.release_type,
                 "item_id": r.item_id, "band_id": r.band_id}
                for r in grid_data
            ]
            _save_grid_cache(url, grid)

        # Build per-track lookup
        track_map: dict[str, dict] = {}
        for rel in grid:
            if rel["release_type"] == "track":
                # Scrape track page for details
                album_tracks = _load_album_cache(rel["url"], url)
                if album_tracks is None:
                    track_data_list = scrape_album_tracks(rel["url"], url)
                    album_tracks = [
                        {"title": t.title, "track_num": t.track_num, "url": t.url,
                         "duration_sec": t.duration_sec, "is_downloadable": t.is_downloadable,
                         "has_free_download": t.has_free_download}
                        for t in track_data_list
                    ]
                    _save_album_cache(rel["url"], url, album_tracks)
                for t in album_tracks:
                    key = _norm(t.get("title", ""))
                    t["bandcamp_url"] = f"{url.rstrip('/')}{t['url']}"
                    t["download_url"] = f"{url.rstrip('/')}{t['url']}"
                    track_map[key] = t
            else:
                # Album — scrape its tracks
                album_tracks = _load_album_cache(rel["url"], url)
                if album_tracks is None:
                    track_data_list = scrape_album_tracks(rel["url"], url)
                    album_tracks = [
                        {"title": t.title, "track_num": t.track_num, "url": t.url,
                         "duration_sec": t.duration_sec, "is_downloadable": t.is_downloadable,
                         "has_free_download": t.has_free_download}
                        for t in track_data_list
                    ]
                    _save_album_cache(rel["url"], url, album_tracks)

                album_base = url.rstrip("/")
                for t in album_tracks:
                    key = _norm(t.get("title", ""))
                    t["bandcamp_url"] = f"{album_base}{rel['url']}"
                    t["download_url"] = f"{album_base}{t['url']}"
                    track_map[key] = t

        bc_tracks_by_artist[artist] = track_map

    # 6. Match tracks
    matched: list[dict] = []
    unmatched: list[dict] = []
    total_cost: float = 0

    for track in tracks:
        artist = track.artist_name.strip()
        bc_map = bc_tracks_by_artist.get(artist, {})
        result = _match_track(track, bc_map, artist)

        if result:
            matched.append({
                "track_uri": track.track_uri,
                "track_name": track.track_name,
                "artist": artist,
                "album": track.album_name,
                "bandcamp_url": result.get("bandcamp_url", ""),
                "download_url": result.get("download_url", result.get("bandcamp_url", "")),
                "price_gbp": result.get("price_gbp", None),
                "is_downloadable": result.get("is_downloadable", True),
            })
        else:
            unmatched.append({
                "track_uri": track.track_uri,
                "track_name": track.track_name,
                "artist": artist,
                "album": track.album_name,
            })

    # 7. Build report
    report = {
        "schema": "bandcamp-matcher/report@1",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_tracks": total,
        "matched": len(matched),
        "unmatched": len(unmatched),
        "match_rate": f"{len(matched) * 100 / max(total, 1):.1f}%",
        "artists_found": sum(1 for u in artist_urls.values() if u),
        "artists_not_found": sum(1 for u in artist_urls.values() if not u),
        "total_artists": len(by_artist),
        "matched_tracks": matched,
        "unmatched_tracks": unmatched,
        "unmatched_artists": sorted(set(
            u["artist"] for u in unmatched
        )),
    }

    return report


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def print_report(report: dict) -> None:
    """Print a human-readable summary."""
    m = report["matched"]
    u = report["unmatched"]
    total = report["total_tracks"]

    print(f"\n{'='*60}")
    print(f"  Bandcamp Matcher — Report")
    print(f"{'='*60}")
    print(f"  Total tracks:     {total}")
    print(f"  Matched on BC:    {m} ({report['match_rate']})")
    print(f"  Not found:        {u}")
    print(f"  Artists checked:  {report['total_artists']}")
    print(f"  BC pages found:   {report['artists_found']}")
    print(f"  No BC page found: {report['artists_not_found']}")
    print(f"{'='*60}")

    if u > 0:
        print(f"\n  ── Artists without Bandcamp matches ({len(report['unmatched_artists'])}):")
        for a in report["unmatched_artists"][:25]:
            count = sum(1 for x in report["unmatched_tracks"] if x["artist"] == a)
            print(f"    {count:3d}x  {a}")
        if len(report["unmatched_artists"]) > 25:
            print(f"    ... and {len(report['unmatched_artists']) - 25} more")

    print()
    print(f"  For the matched tracks, visit each URL to buy/download.")
    print(f"  For unmatched tracks, consider:\n"
          f"    • Searching Bandcamp manually (URL guessing may have missed)\n"
          f"    • Buying on 7digital / Qobuz\n"
          f"    • A 1-month Tidal HiFi sub + download tool\n"
          f"    • This report's JSON has full details for each track")
    print()


def write_unmatched_csv(unmatched: list[dict], path: str) -> None:
    """Write unmatched tracks to a CSV for sourcing elsewhere."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["track_name", "artist", "album", "track_uri"])
        w.writeheader()
        for t in unmatched:
            w.writerow(t)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="bandcamp-matcher",
        description="Cross-reference a Spotify export CSV against Bandcamp to find your tracks for legal DRM-free download.",
        epilog="Your music, your data.",
    )
    p.add_argument("csv", help="Path to the exportify CSV (liked songs or playlist export)")
    p.add_argument("--output-dir", "-o", default=".", help="Output directory for reports (default: .)")
    p.add_argument("--quiet", "-q", action="store_true", help="Suppress progress output")
    p.add_argument("--skip-cache", action="store_true", help="Ignore cached results and re-fetch everything")
    p.add_argument("--version", action="version", version=f"bandcamp-matcher {__version__}")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not os.path.isfile(args.csv):
        print(f"Error: '{args.csv}' not found", file=sys.stderr)
        return 1

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        report = process_csv(args.csv, quiet=args.quiet, skip_cache=args.skip_cache)
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        if os.environ.get("BC_MATCHER_DEBUG"):
            raise
        return 1

    # Write report JSON
    report_path = output_dir / "bandcamp_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\n📝 Full report:    {report_path}", file=sys.stderr)

    # Write unmatched CSV
    unmatched_csv = output_dir / "unmatched_tracks.csv"
    write_unmatched_csv(report["unmatched_tracks"], str(unmatched_csv))
    print(f"📝 Unmatched CSV:  {unmatched_csv}", file=sys.stderr)

    # Print human-readable summary
    print_report(report)

    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
