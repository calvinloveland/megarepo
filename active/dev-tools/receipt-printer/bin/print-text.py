#!/usr/bin/env python3
"""Print a text file (or stdin) to the Epson TM-T88V.

Word-wraps to the paper width, optionally in condensed font, and cuts.

Usage: print-text.py <file|-> [--wrap N] [--condensed] [--cut-each] [--no-cut]
"""

import sys
import time

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"

WRAP_NORMAL = 32  # safe on 58mm paper, narrow on 80mm
WRAP_CONDENSED = 42  # safe on 58mm paper in condensed font


def wrap(text: str, width: int) -> list[str]:
    """Wrap a line, breaking over-long tokens (paths, hashes) instead of overflowing."""
    out = []
    for raw in text.expandtabs(2).rstrip().splitlines():
        cur = ""
        for word in raw.split():
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
        out.append(cur)
    return out


def cut() -> bytes:
    """GS V 66 0: feed to the cutting position, then partial cut."""
    return GS + b"V" + b"\x42" + b"\x00"


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
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]

    if not positional:
        sys.exit(__doc__)

    path = positional[0]
    condensed = "--condensed" in flags
    cut_each = "--cut-each" in flags

    width = WRAP_CONDENSED if condensed else WRAP_NORMAL
    if "--wrap" in sys.argv:
        width = int(sys.argv[sys.argv.index("--wrap") + 1])

    if path == "-":
        data = sys.stdin.read()
    else:
        with open(path, "r", errors="replace") as f:
            data = f.read()

    lines = wrap(data, width)

    out = bytearray()
    out += ESC + b"@"  # init
    out += ESC + b"a" + b"\x00"  # left
    if condensed:
        out += ESC + b"!" + b"\x01"  # font B
        out += ESC + b"M" + b"\x01"  # condensed

    for i, line in enumerate(lines):
        out += line.encode("cp437", errors="replace") + b"\n"
        if cut_each and (i + 1) % (60 if not condensed else 75) == 0:
            out += cut()

    if condensed:
        out += ESC + b"M" + b"\x00"
        out += ESC + b"!" + b"\x00"

    if "--no-cut" not in flags:
        out += ESC + b"d\x04"
        out += cut()

    write_chunked(bytes(out))
    print(f"printed {len(lines)} line(s) from {path}")


if __name__ == "__main__":
    main()
