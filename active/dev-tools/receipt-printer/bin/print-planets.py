#!/usr/bin/env python3
"""Print one image of every planet in the solar system.

Lead images come from each planet's Wikipedia article, resolved through the
MediaWiki API (upload.wikimedia.org rate-limits us; thumb.wikimedia.org does not).

Usage: print-planets.py [--width N] [--dwarf] [--invert] [--no-cache]
"""

import hashlib
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

PRINTER = "/dev/usb/lp0"
ESC = b"\x1b"
GS = b"\x1d"

API = "https://en.wikipedia.org/w/api.php"
UA = "pi-agent-thermal/1.0 (Epson TM-T88V receipt printer; calvin@example.com)"
CACHE = os.path.expanduser("~/.cache/print-planets")

PLANETS = [
    ("Mercury", "Mercury (planet)"),
    ("Venus", "Venus"),
    ("Earth", "Earth"),
    ("Mars", "Mars"),
    ("Jupiter", "Jupiter"),
    ("Saturn", "Saturn"),
    ("Uranus", "Uranus"),
    ("Neptune", "Neptune"),
]

DWARFS = [("Pluto", "Pluto (dwarf planet)")]


def http_get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# thumb.wikimedia.org only renders a whitelist of widths (see https://w.wiki/GHai).
# 320/640/800/1024 return 400; 250/500/960/1280 work.
STD_WIDTHS = [250, 500, 960, 1280, 1920, 2048, 2880]


def width_ladder(target: int) -> list[int]:
    """Preferred thumbnail widths: smallest >= target first, then fall back downward."""
    bigger = sorted(w for w in STD_WIDTHS if w >= target)
    smaller = sorted((w for w in STD_WIDTHS if w < target), reverse=True)
    return bigger + smaller


def to_thumb_url(url: str, width: int) -> str:
    """Rewrite an upload.wikimedia.org original into a thumb.wikimedia.org thumb.

    MediaWiki returns the ORIGINAL url when the source is smaller than the
    requested pithumbsize. upload.wikimedia.org rate-limits us with 403s, while
    thumb.wikimedia.org serves the same files happily.
    """
    url = url.split("?", 1)[0]
    marker = "upload.wikimedia.org/wikipedia/"
    if marker not in url:
        return url

    _, rest = url.split(marker, 1)
    parts = rest.split("/")
    if len(parts) < 4 or "thumb" in parts:
        return url

    wiki, hash_a, hash_b, filename = parts[0], parts[1], parts[2], "/".join(parts[3:])
    thumb_name = filename
    if filename.lower().endswith(".svg"):
        thumb_name = filename + ".png"
    return (
        f"https://thumb.wikimedia.org/wikipedia/{wiki}/thumb/"
        f"{hash_a}/{hash_b}/{filename}/{width}px-{thumb_name}"
    )


def lead_image(title: str, width: int = 800) -> str:
    """Resolve the article's lead image URL via the MediaWiki pageimages API."""
    qs = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": title,
            "prop": "pageimages",
            "pithumbsize": width,
            "format": "json",
            "formatversion": "2",
        }
    )
    data = json.loads(http_get(f"{API}?{qs}"))
    pages = data.get("query", {}).get("pages", [])
    if not pages or "thumbnail" not in pages[0]:
        raise RuntimeError(f"no lead image for {title!r}")
    return pages[0]["thumbnail"]["source"]


def fetch_image(name: str, title: str, width: int) -> Image.Image:
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(f"{title}:{width}".encode()).hexdigest()[:16]
    path = os.path.join(CACHE, f"{key}.img")

    if "--no-cache" not in sys.argv and os.path.exists(path):
        return Image.open(path)

    url = lead_image(title, width)
    try:
        blob = http_get(url, timeout=40)
    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise
        # Original on upload.wikimedia.org: retry via the thumbnail host,
        # walking the whitelist until a width renders.
        blob = None
        for w in width_ladder(max(width, 960)):
            try:
                blob = http_get(to_thumb_url(url, w), timeout=40)
                break
            except urllib.error.HTTPError:
                continue
        if blob is None:
            raise RuntimeError(f"no usable thumbnail width for {title!r}") from e
    with open(path, "wb") as f:
        f.write(blob)
    time.sleep(0.3)  # be polite to the thumbnail service
    return Image.open(path)


def to_raster(img: Image.Image) -> tuple[bytes, int, int]:
    img = img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    w, h = img.size
    bpr = (w + 7) // 8
    px = img.load()
    data = bytearray()
    for y in range(h):
        row = 0
        for x in range(w):
            if px[x, y] == 0:
                row |= 1 << (7 - (x % 8))
            if x % 8 == 7:
                data.append(row)
                row = 0
        if w % 8:
            data.append(row)
    return bytes(data), bpr, h


def build_blob(img: Image.Image, name: str, note: str = "") -> bytes:
    data, bpr, h = to_raster(img)
    out = bytearray()
    out += ESC + b"@"
    out += ESC + b"a" + b"\x01"
    out += GS + b"!" + b"\x11"
    out += name.upper().encode() + b"\n"
    out += GS + b"!" + b"\x00"
    if note:
        out += note.encode() + b"\n"
    out += ESC + b"a" + b"\x00"
    out += GS + b"v" + b"0"
    out += bytes([0, bpr & 0xFF, (bpr >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF])
    out += data
    out += b"\n"
    out += ESC + b"d\x04"
    out += GS + b"V" + b"\x42" + b"\x00"  # feed + partial cut
    return bytes(out)


def write_printer(data: bytes, chunk: int = 1024) -> None:
    """usblp buffers are small; feed large rasters in pieces."""
    with open(PRINTER, "wb", buffering=0) as f:
        for i in range(0, len(data), chunk):
            piece = data[i : i + chunk]
            off = 0
            while off < len(piece):
                try:
                    off += f.write(piece[off:])
                except BlockingIOError:
                    time.sleep(0.01)


def main() -> None:
    width = 384
    if "--width" in sys.argv:
        width = int(sys.argv[sys.argv.index("--width") + 1])

    targets = list(PLANETS)
    if "--dwarf" in sys.argv:
        targets += DWARFS

    failures = []
    for i, (name, title) in enumerate(targets, 1):
        try:
            img = fetch_image(name, title, 800).convert("L")
            # Fit to the paper width, preserving aspect ratio.
            scale = width / img.width
            img = img.resize((width, max(1, int(img.height * scale))), Image.LANCZOS)
            if "--invert" in sys.argv:
                img = img.point(lambda v: 255 - v)
            note = "dwarf planet" if name == "Pluto" else ""
            write_printer(build_blob(img, name, note))
            print(f"[{i}/{len(targets)}] {name:8s} {img.width}x{img.height}")
        except Exception as e:  # noqa: BLE001 - keep going if one planet fails
            failures.append(name)
            print(f"[{i}/{len(targets)}] {name:8s} FAILED: {e}", file=sys.stderr)

    if failures:
        sys.exit(f"failed: {', '.join(failures)}")


if __name__ == "__main__":
    main()
