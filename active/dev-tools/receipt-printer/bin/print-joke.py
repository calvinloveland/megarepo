#!/usr/bin/env python3
"""Print a joke as two slips: setup, cut, punchline.

The cut between them is the point — hand someone the setup, let them read it,
then the punchline arrives on its own slip.

Usage: print-joke.py [--local] [--no-cut] [--setup TEXT --punchline TEXT]
"""

import json
import sys
import time
import urllib.request

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"
WRAP = 32
API = "https://official-joke-api.appspot.com/random_joke"

# Offline fallback so the printer still earns its keep without a network.
LOCAL_JOKES = [
    (
        "Why do programmers prefer dark mode?",
        "Because light attracts bugs.",
    ),
    (
        "There are 10 kinds of people in this world.",
        "Those who understand binary, and those who don't.",
    ),
    (
        "Why did the developer go broke?",
        "Because he used up all his cache.",
    ),
    (
        "A SQL query walks into a bar, sees two tables and asks...",
        "May I join you?",
    ),
    (
        "Why do astronauts use Linux?",
        "Because you can't open Windows in space.",
    ),
]


def tidy(text: str) -> str:
    """Fix the API's occasional missing space after punctuation ("Pop,goes")."""
    import re

    text = " ".join(text.split())
    return re.sub(r"([,.;:!?])(?=[A-Za-z])", r"\1 ", text)


def fetch_joke() -> tuple[str, str]:
    try:
        req = urllib.request.Request(API, headers={"User-Agent": "pi-agent/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
        setup, punch = tidy(d.get("setup", "")), tidy(d.get("punchline", ""))
        if setup and punch:
            return setup, punch
    except Exception:  # noqa: BLE001 - offline? use the local list
        pass
    import random

    return random.choice(LOCAL_JOKES)


def wrap(text: str, width: int) -> list[str]:
    out, cur = [], ""
    for word in text.split():
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


def enc(s: str) -> bytes:
    return s.encode("cp437", errors="replace")


def center_lines(text: str, width: int, bold: bool = False, double_height: bool = False) -> bytes:
    out = bytearray()
    for line in wrap(text, width):
        pad = max(0, (width - len(line)) // 2)
        out += b" " * pad
        if bold:
            out += ESC + b"E" + b"\x01"
        if double_height:
            out += GS + b"!" + b"\x01"  # double height, single width
        out += enc(line)
        if double_height:
            out += GS + b"!" + b"\x00"
        if bold:
            out += ESC + b"E" + b"\x00"
        out += b"\n"
    return bytes(out)


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


def main() -> None:
    setup = punch = None
    if "--setup" in sys.argv:
        setup = sys.argv[sys.argv.index("--setup") + 1]
    if "--punchline" in sys.argv:
        punch = sys.argv[sys.argv.index("--punchline") + 1]

    if not (setup and punch):
        setup, punch = fetch_joke()
    else:
        setup, punch = tidy(setup), tidy(punch)

    out = bytearray()

    # --- Slip 1: the setup ---
    out += ESC + b"@"  # init
    out += ESC + b"a" + b"\x01"  # center
    out += b"\n"
    out += center_lines(setup, WRAP)
    out += b"\n"
    out += center_lines("...", WRAP)
    if "--no-cut" not in sys.argv:
        out += ESC + b"d\x04"
        out += cut()

    # --- Slip 2: the punchline, given some presence ---
    out += ESC + b"@"
    out += ESC + b"a" + b"\x01"
    out += b"\n"
    out += center_lines(punch, WRAP, bold=True, double_height=True)
    out += b"\n"
    if "--no-cut" not in sys.argv:
        out += ESC + b"d\x04"
        out += cut()

    write_printer(bytes(out))
    print(f"setup:     {setup}")
    print(f"punchline: {punch}")


if __name__ == "__main__":
    main()
