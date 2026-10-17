#!/usr/bin/env python3
"""Print random scripture passages to the Epson TM-T88V.

Usage: print-scripture.py [count] [--wrap N]
"""

import html
import json
import re
import sys
import time
import urllib.request

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"
API = "https://labs.bible.org/api/?passage=random&type=json"

# Normal font on 58mm paper is ~32 columns; 42 is safe on 80mm.
WRAP = 32


def fetch_random_verse(retries: int = 3) -> dict:
    last_err = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(API, headers={"User-Agent": "pi-agent-receipt/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.load(r)
            if data:
                return data[0]
        except Exception as e:  # noqa: BLE001 - network flake tolerance
            last_err = e
            time.sleep(0.5)
    raise RuntimeError(f"could not fetch verse: {last_err}")


def clean(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)  # strip any inline tags
    text = html.unescape(text)
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u2014", "-").replace("\u2013", "-")
    return " ".join(text.split())


def wrap(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= width:
            cur += " " + w
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def center(s: str, width: int) -> bytes:
    s = s[:width]
    pad = max(0, (width - len(s)) // 2)
    return b" " * pad + s.encode("cp437", errors="replace") + b"\n"


def cut() -> bytes:
    """GS V 66 0: feed to the cutting position, then partial cut."""
    return GS + b"V" + b"\x42" + b"\x00"


def rule(ch: str, width: int) -> bytes:
    return (ch * width).encode() + b"\n"


def write_chunked(data: bytes, chunk: int = 1024) -> None:
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
    count = 5
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        count = int(args[0])
    wrap_width = WRAP

    out = bytearray()
    out += ESC + b"@"
    out += ESC + b"a" + b"\x00"  # left align

    for i in range(count):
        v = fetch_random_verse()
        ref = f"{v['bookname']} {v['chapter']}:{v['verse']}"
        text = clean(v.get("text", ""))

        if i:
            out += ESC + b"d\x02"  # small gap above the next verse

        out += ESC + b"E" + b"\x01"  # bold
        for line in wrap(ref, wrap_width):
            out += line.encode("cp437", errors="replace") + b"\n"
        out += ESC + b"E" + b"\x00"
        out += rule("-", wrap_width)

        for line in wrap(text, wrap_width):
            out += line.encode("cp437", errors="replace") + b"\n"

        out += ESC + b"d\x04"  # feed clear of the cutter
        out += cut()

    write_chunked(bytes(out))
    print(f"printed {count} random verse(s), cut after each")


if __name__ == "__main__":
    main()
