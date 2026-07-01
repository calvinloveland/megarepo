"""Cross-reference a Spotify CSV export against Bandcamp discographies.

Flow
----
1. Read the exportify CSV (track name, artist name, album name, ISRC).
2. For each *unique artist* in the CSV, find their Bandcamp page:
   a. Try direct URL guessing (`{artist}.bandcamp.com`, with variants).
   b. (future) Fall back to MusicBrainz API lookup.
3. Scrape the artist page for album / single track links.
4. For each album, fetch its page and extract `trackinfo` (embedded JSON).
5. Match CSV tracks against Bandcamp tracks by name (case-insensitive
   substring, with parenthetical-content stripped).
6. Produce a JSON report with matched / unmatched tracks, URLs, prices.

The scraper is the heavy part — it makes one GET per artist + one per
album. We cache aggressively so a re-run of the same CSV is nearly
instant.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)
_MIN_DELAY = 2.0  # seconds between requests to avoid rate-limiting


def _fetch(url: str, retries: int = 2) -> str:
    """GET *url* and return its UTF-8 decoded body.

    Retries with exponential backoff on 429 (rate-limited).
    """
    import time
    time.sleep(_MIN_DELAY)
    for attempt in range(1 + retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries:
                wait = (attempt + 1) * 5
                print(f"  Rate limited, retrying in {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue
            raise


# ---------------------------------------------------------------------------
# Slug generation
# ---------------------------------------------------------------------------


def _slugify(name: str) -> str:
    """Turn an artist name into a plausible Bandcamp URL slug."""
    s = name.lower().strip()
    s = re.sub(r"\(.*?\)", "", s).strip()  # drop parentheticals
    s = s.replace(" & ", "-").replace(" and ", "-")
    # Remove special chars
    s = re.sub(r"[^a-z0-9 ._-]", "", s)
    s = s.replace("_", "-").replace(" ", "-").replace(".", "-")
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _url_variants(name: str) -> list[str]:
    """Generate candidate Bandcamp subdomains for an artist."""
    slug = _slugify(name)
    if not slug:
        return []
    seen: set[str] = set()
    out: list[str] = []

    def add(s: str) -> None:
        if s and s not in seen:
            seen.add(s)
            out.append(s)

    add(slug)
    # the- prefix
    if not slug.startswith("the-"):
        add(f"the-{slug}")
    # music suffix
    add(f"{slug}music")
    # no hyphens
    if "-" in slug:
        add(slug.replace("-", ""))
    # plural → singular
    if slug.endswith("s"):
        add(slug[:-1])
    # singular → plural  (edge case)
    add(f"{slug}s")
    # strip trailing -music if it ended up there twice
    if slug.endswith("music") and len(slug) > 5:
        add(slug[:-5])

    return out


# ---------------------------------------------------------------------------
# Bandcamp page scraping
# ---------------------------------------------------------------------------


@dataclass
class BCRelease:
    """A release (album or individual track) on an artist's Bandcamp page."""

    url: str                           # /album/... or /track/...
    title: str
    release_type: str                  # "album" | "track"
    item_id: int | None = None
    band_id: int | None = None
    tracks: list["BCTrack"] = field(default_factory=list)
    price: float | None = None         # album-level min price (GBP)
    currency: str = "GBP"


@dataclass
class BCTrack:
    """A single track on Bandcamp (from an album track listing)."""

    title: str
    track_num: int
    url: str                   # /track/...
    duration_sec: float = 0
    is_downloadable: bool = True
    has_free_download: bool = False


def find_artist_url(artist: str) -> Optional[str]:
    """Try to find a working Bandcamp artist page by URL guessing.

    Returns the full URL (e.g. https://foxstevenson.bandcamp.com) or None.
    """
    for variant in _url_variants(artist):
        url = f"https://{variant}.bandcamp.com"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            resp = urllib.request.urlopen(req, timeout=5)
            if resp.status == 200:
                # Read enough to include the <head> section with meta tags.
                html = resp.read(8192).decode("utf-8", errors="replace")
                # Skip Bandcamp's signup page (which returns 200 for unknown subdomains).
                if "<title>Signup" in html or "<title>Bandcamp" in html:
                    continue
                # A real Bandcamp artist page has an og:type=band meta tag.
                if 'og:type' in html and 'content="band"' in html:
                    return url
        except Exception:
            pass
    return None


def scrape_artist_grid(url: str) -> list[BCRelease]:
    """Fetch an artist's Bandcamp page and parse the music grid.

    Returns a list of releases (albums + individual tracks) found on the page.
    """
    html = _fetch(url)
    releases: list[BCRelease] = []

    items = re.findall(
        r'<li[^>]*data-item-id="([^"]+)"[^>]*data-band-id="([^"]*)"[^>]*'
        r'class="music-grid-item[^"]*"[^>]*>(.*?)</li>',
        html, re.DOTALL,
    )

    for item_id_str, band_id_str, inner_html in items:
        # Title
        title_m = re.search(r'<p class="title">(.*?)</p>', inner_html, re.DOTALL)
        title = re.sub(r"<.*?>", "", title_m.group(1)).strip() if title_m else "?"

        # URL
        url_m = re.search(r'href="(/[^"]+)"', inner_html)
        if not url_m:
            continue
        rel_url = url_m.group(1)

        # Type: "album-" prefix → album, "track-" prefix → track
        rtype = "track" if "track-" in item_id_str else "album"

        release = BCRelease(
            url=rel_url,
            title=title,
            release_type=rtype,
            item_id=int(item_id_str.split("-")[1]) if "-" in item_id_str else None,
            band_id=int(band_id_str) if band_id_str else None,
        )
        releases.append(release)

    return releases


def scrape_album_tracks(album_url: str, base_url: str) -> list[BCTrack]:
    """Fetch an album page and extract its track listing from embedded JSON.

    *album_url* is e.g. /album/sunk-cost-fallacy.
    *base_url* is e.g. https://foxstevenson.bandcamp.com.
    """
    full_url = base_url.rstrip("/") + album_url
    html = _fetch(full_url)
    tracks: list[BCTrack] = []

    # The track data lives in the HTML-escaped JavaScript variable `trackinfo`.
    # Look for the JSON array (HTML-escaped &quot; → ").
    m = re.search(r'trackinfo[^:]*:\s*(\[.*?\])\s*[,;]', html, re.DOTALL)
    if not m:
        # Try unescaped version
        m = re.search(r'trackinfo[^:]*:\s*(\[.*?\])\s*[,;]', html, re.DOTALL)

    if not m:
        return tracks

    raw = m.group(1)
    # Unescape HTML entities
    raw = raw.replace("&quot;", '"').replace("&#x2F;", "/").replace("&#39;", "'")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return tracks

    for entry in data:
        title = entry.get("title", "?")
        track_num = entry.get("track_num", 0)
        title_link = entry.get("title_link", "")
        duration = entry.get("duration", 0)
        download = entry.get("is_downloadable", True)
        free = entry.get("has_free_download", False)
        tracks.append(BCTrack(
            title=title,
            track_num=track_num,
            url=title_link,
            duration_sec=float(duration),
            is_downloadable=bool(download),
            has_free_download=bool(free),
        ))

    return tracks


def scrape_artist_tracks(base_url: str) -> dict[str, BCRelease]:
    """Full scrape: artist grid + album pages → dict of (title → BCRelease).

    Returns a dict keyed by *track title* (lower-cased, parentheticals
    stripped) pointing to the BCRelease (which includes pricing).
    """
    releases = scrape_artist_grid(base_url)
    by_title: dict[str, BCRelease] = {}

    for rel in releases:
        if rel.release_type == "track":
            # Individual tracks — scrape the track page for details
            tracks = scrape_album_tracks(rel.url, base_url)
            if tracks:
                track = tracks[0]
                rel.tracks = [track]
                key = _norm(rel.title)
                by_title[key] = rel
            else:
                key = _norm(rel.title)
                by_title[key] = rel
        else:
            # Album — scrape each track
            tracks = scrape_album_tracks(rel.url, base_url)
            rel.tracks = tracks
            for t in tracks:
                # Create a BCRelease per track with a reference back to the album
                track_rel = BCRelease(
                    url=t.url,
                    title=t.title,
                    release_type="track",
                    tracks=[t],
                    price=rel.price,
                    currency=rel.currency,
                )
                key = _norm(t.title)
                by_title[key] = track_rel

    return by_title


def _norm(name: str) -> str:
    """Normalize a track name for matching.

    Lowercases, strips parentheticals, strips punctuation, condenses spaces.
    """
    s = name.lower().strip()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# CSV reading
# ---------------------------------------------------------------------------


@dataclass
class CSVTrack:
    """One row from the exportify CSV."""

    track_uri: str
    track_name: str
    artist_name: str
    album_name: str
    artist_artists: str       # "Album Artist Name(s)" column
    isrc: str
    added_at: str
    explicit: bool = False
    popularity: int = 0


def read_csv(path: str) -> list[CSVTrack]:
    """Parse an exportify CSV and return a list of tracks."""
    tracks: list[CSVTrack] = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tracks.append(CSVTrack(
                track_uri=row.get("Track URI", ""),
                track_name=row.get("Track Name", ""),
                artist_name=row.get("Artist Name(s)", ""),
                album_name=row.get("Album Name", ""),
                artist_artists=row.get("Album Artist Name(s)", ""),
                isrc=row.get("ISRC", ""),
                added_at=row.get("Added At", ""),
                explicit=row.get("Explicit", "").lower() in ("true", "1", "yes"),
                popularity=int(row.get("Popularity", 0) or 0),
            ))
    return tracks


def group_by_artist(tracks: list[CSVTrack]) -> dict[str, list[CSVTrack]]:
    """Group tracks by the normalized artist name."""
    from collections import defaultdict
    groups: dict[str, list[CSVTrack]] = defaultdict(list)
    for t in tracks:
        key = t.artist_name.strip()
        groups[key].append(t)
    return dict(groups)
