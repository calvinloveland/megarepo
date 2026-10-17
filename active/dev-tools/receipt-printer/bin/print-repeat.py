#!/usr/bin/env python3
"""Print a phrase N times to the Epson TM-T88V.

Usage: print-repeat.py "<phrase>" <count> [--condensed]
"""

import sys
import time

ESC = b"\x1b"
PRINTER = "/dev/usb/lp0"


def build(phrase: str, count: int, condensed: bool) -> bytes:
    out = bytearray()
    out += ESC + b"@"  # init
    out += ESC + b"a" + b"\x00"  # left align

    if condensed:
        out += ESC + b"!" + b"\x01"  # font B (smaller)
        out += ESC + b"M" + b"\x01"  # condensed on

    body = phrase.encode("cp437", errors="replace") + b"\n"
    out += body * count

    if condensed:
        out += ESC + b"M" + b"\x00"
        out += ESC + b"!" + b"\x00"

    out += ESC + b"d" + b"\x04"
    out += ESC + b"m"  # cut
    return bytes(out)


def write_chunked(data: bytes, chunk: int = 1024) -> None:
    """usblp has a small internal buffer; feed it in pieces and let it drain."""
    with open(PRINTER, "wb", buffering=0) as f:
        for i in range(0, len(data), chunk):
            piece = data[i : i + chunk]
            offset = 0
            while offset < len(piece):
                try:
                    offset += f.write(piece[offset:])
                except BlockingIOError:
                    time.sleep(0.01)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    phrase = sys.argv[1]
    count = int(sys.argv[2])
    condensed = "--condensed" in sys.argv

    payload = build(phrase, count, condensed)
    write_chunked(payload)
    lines = count
    print(f"printed {lines} lines ({len(payload)} bytes, ~{lines * (3 if condensed else 4)}mm of paper)")
