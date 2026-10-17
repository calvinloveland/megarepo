#!/usr/bin/env python3
"""Print random fortunes to the Epson TM-T88V.

No title, one fortune per slip, cut after each.

Usage: print-fortune.py [count] [--max-chars N]
"""

import re
import shutil
import subprocess
import sys
import time

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"

# Normal font on 58mm paper is ~32 columns.
WRAP = 32
MAX_CHARS = 220


def find_fortune() -> str | None:
    """Prefer classic fortune-mod, which has a clean `-s` (short) flag.

    The fortune-kind binary on the system PATH prints a stray index line,
    so store paths win when present.
    """
    import glob

    hits = sorted(glob.glob("/nix/store/*fortune-mod*/bin/fortune"))
    if hits:
        return hits[0]
    return shutil.which("fortune")


def get_fortune(binary: str, max_chars: int, tries: int = 12) -> str:
    """Grab a short fortune; retry if the first ones are essays."""
    last = ""
    for _ in range(tries):
        proc = subprocess.run(
            [binary, "-s"], capture_output=True, text=True, timeout=15, check=False
        )
        text = proc.stdout.strip()
        if not text:
            continue
        last = text
        if len(text) <= max_chars:
            return text
    return last  # give up and use whatever we got


def normalize(text: str) -> list[str]:
    """Turn tabs into spaces, collapse runs, and wrap to the paper width."""
    lines = []
    for raw in text.splitlines():
        if re.fullmatch(r"\s*\d+\s*", raw):  # fortune-kind emits stray indices
            continue
        expanded = raw.expandtabs(2).rstrip()
        if not expanded.strip():
            continue
        # Some fortunes carry long decorative runs; just wrap normally.
        lines.extend(wrap(expanded.strip(), WRAP))
    return lines


def wrap(text: str, width: int) -> list[str]:
    words, out, cur = text.split(), [], ""
    for w in words:
        if not cur:
            cur = w
        elif len(cur) + 1 + len(w) <= width:
            cur += " " + w
        else:
            out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    return out


def rule(ch: str, width: int) -> bytes:
    return (ch * width).encode() + b"\n"


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


def clean(s: str) -> bytes:
    return s.encode("cp437", errors="replace")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    count = int(args[0]) if args else 3
    max_chars = MAX_CHARS
    if "--max-chars" in sys.argv:
        max_chars = int(sys.argv[sys.argv.index("--max-chars") + 1])

    binary = find_fortune()
    if not binary:
        sys.exit("no fortune binary found (try: nix-shell -p fortune)")

    out = bytearray()
    out += ESC + b"@"
    out += ESC + b"a" + b"\x00"

    for i in range(count):
        if i:
            out += ESC + b"d\x02"
        for line in normalize(get_fortune(binary, max_chars)):
            out += clean(line) + b"\n"
        out += ESC + b"d\x04"
        out += cut()

    write_chunked(bytes(out))
    print(f"printed {count} fortune(s), cut after each")


if __name__ == "__main__":
    main()
