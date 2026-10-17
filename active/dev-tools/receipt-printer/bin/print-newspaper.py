#!/usr/bin/env python3
"""Print a tiny newspaper with the latest headlines.

Pulls a handful of stories from public RSS feeds (no API keys) and lays them out
for a 32-column thermal receipt: masthead, dateline, headline + lede per story.

Usage: print-newspaper.py [--stories N] [--wrap N] [--no-cut]
"""

import html
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"
WRAP = 32
UA = "pi-agent-thermal/1.0 (Epson TM-T88V receipt newspaper; calvin@example.com)"

FEEDS = [
    ("BBC", "https://feeds.bbci.co.uk/news/rss.xml", 3),
    ("NPR", "https://feeds.npr.org/1001/rss.xml", 2),
    ("ARS", "https://feeds.arstechnica.com/arstechnica/index", 2),
]

MAX_LEDE = 150  # characters of body copy per story


def http_get(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clean(text: str) -> str:
    """Strip markup/entities and flatten Unicode punctuation for cp437."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    for a, b in [
        ("\u201c", '"'), ("\u201d", '"'), ("\u2018", "'"), ("\u2019", "'"),
        ("\u2014", "-"), ("\u2013", "-"), ("\u2026", "..."), ("\xa0", " "),
        ("\u00b7", "-"), ("\u2022", "*"),
    ]:
        text = text.replace(a, b)
    return " ".join(text.split())


def wrap(text: str, width: int) -> list[str]:
    out, cur = [], ""
    for word in text.split():
        while len(word) > width:
            if cur:
                out.append(cur)
                cur = ""
            out.append(word[:width])
            word = word[width:]
        if not cur:
            cur = word
        elif len(cur) + 1 + len(word) <= width:
            cur += " " + word
        else:
            out.append(cur)
            cur = word
    if cur:
        out.append(cur)
    return out


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    # Prefer ending on a sentence, then a word boundary.
    for sep in (". ", "? ", "! "):
        idx = cut.rfind(sep)
        if idx > limit * 0.5:
            return cut[: idx + 1]
    idx = cut.rfind(" ")
    return (cut[:idx] if idx > 0 else cut) + "..."


def _tokens(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z']+", title.lower()) if len(w) > 2}


def is_similar(a: str, b: str, threshold: float = 0.6) -> bool:
    """Feeds republish the same story with tweaked headlines; catch that."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= threshold


def parse_feed(source: str, url: str, want: int) -> list[dict]:
    root = ET.fromstring(http_get(url))
    stories = []
    for item in root.iter("item"):
        title = clean(item.findtext("title", ""))
        if not title:
            continue
        desc = clean(item.findtext("description", ""))
        # NPR ships a <npr:storyDate>; fall back to pubDate.
        pub = item.findtext("pubDate", "") or ""
        stories.append(
            {
                "source": source,
                "title": title,
                "lede": truncate(desc, MAX_LEDE),
                "pub": pub.strip(),
            }
        )
        if len(stories) >= want:
            break
    return stories


def cut() -> bytes:
    return GS + b"V" + b"\x42" + b"\x00"


def write_printer(data: bytes, chunk: int = 1024) -> None:
    with open(PRINTER, "wb", buffering=0) as f:
        for i in range(0, len(data), chunk):
            piece = data[i : i + chunk]
            off = 0
            while off < len(piece):
                try:
                    off += f.write(piece[off:])
                except BlockingIOError:
                    time.sleep(0.01)


def center(s: str, width: int = WRAP) -> bytes:
    s = s[:width]
    pad = max(0, (width - len(s)) // 2)
    return b" " * pad + s.encode("cp437", errors="replace") + b"\n"


def justify_story(story: dict, width: int) -> bytes:
    """Headline in bold, source tag right-aligned, then the lede."""
    out = bytearray()
    head_lines = wrap(story["title"].upper(), width)
    for i, line in enumerate(head_lines):
        out += ESC + b"E" + b"\x01" + line.encode("cp437", errors="replace")
        out += ESC + b"E" + b"\x00" + b"\n"
        if i == 0 and len(head_lines) == 1:
            break
    # Source tag under the headline keeps the columns tidy on narrow paper.
    out += b"[" + story["source"].encode() + b"]" + b"\n"

    if story["lede"]:
        for line in wrap(story["lede"], width):
            out += line.encode("cp437", errors="replace") + b"\n"
    return bytes(out)


def main() -> None:
    wrap_width = WRAP
    if "--wrap" in sys.argv:
        wrap_width = int(sys.argv[sys.argv.index("--wrap") + 1])
    total_want = None
    if "--stories" in sys.argv:
        total_want = int(sys.argv[sys.argv.index("--stories") + 1])

    stories: list[dict] = []
    failed = []
    for source, url, want in FEEDS:
        try:
            fresh = parse_feed(source, url, want)
        except Exception as e:  # noqa: BLE001 - one dead feed shouldn't kill the paper
            failed.append(f"{source}: {e}")
            continue
        for story in fresh:
            if any(is_similar(story["title"], s["title"]) for s in stories):
                continue
            stories.append(story)

    if total_want:
        stories = stories[:total_want]
    if not stories:
        sys.exit("no stories fetched" + (f" ({'; '.join(failed)})" if failed else ""))

    now = datetime.now(timezone.utc)
    out = bytearray()
    out += ESC + b"@"  # init
    out += ESC + b"a" + b"\x01"
    out += GS + b"!" + b"\x11"  # double size masthead
    out += b"THE\n"
    out += b"THERMAL TIMES\n"
    out += GS + b"!" + b"\x00"
    out += now.strftime("%A, %B %d, %Y").encode()
    out += b"\n" + b"=" * wrap_width + b"\n"
    out += b"LATE EDITION  -  " + str(len(stories)).encode() + b" STORIES\n"
    out += b"=" * wrap_width + b"\n\n"
    out += ESC + b"a" + b"\x00"

    for i, story in enumerate(stories):
        if i:
            out += b"-" * wrap_width + b"\n"
        out += justify_story(story, wrap_width)
        out += b"\n"

    out += b"=" * wrap_width + b"\n"
    out += ESC + b"a" + b"\x01"
    out += center("printed by Pi Agent", wrap_width)
    out += center(now.strftime("%H:%M UTC"), wrap_width)
    out += ESC + b"a" + b"\x00"
    if "--no-cut" not in sys.argv:
        out += ESC + b"d\x04"
        out += cut()

    write_printer(bytes(out))
    print(f"printed {len(stories)} stories" + (f"; skipped {len(failed)} feed(s)" if failed else ""))


if __name__ == "__main__":
    main()
