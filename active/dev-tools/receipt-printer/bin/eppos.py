"""Shared ESC/POS primitives for the Epson TM-T88V thermal receipt printer.

Every ``print-*`` tool in this directory builds its receipt from these pieces, so
paper-width assumptions, the cut sequence, and the raster encoding live in exactly
one place.

The printer speaks ESC/POS over plain USB: it exposes a character device
(``/dev/usb/lp0``) and we simply write bytes to it. There is no driver, no CUPS
queue, and no spooler in the path.
"""

from __future__ import annotations

import time
from pathlib import Path

from PIL import Image

# --- Control codes -------------------------------------------------------

ESC = b"\x1b"
GS = b"\x1d"

# --- Paper geometry ------------------------------------------------------
#
# The TM-T88V prints at 203 dpi (8 dots/mm). An 80mm roll gives 576 printable
# dots; a 58mm roll gives 384. Text columns are roughly half those numbers
# because the default font is 12x24 dots.

DOTS_80MM = 576
DOTS_58MM = 384
DEFAULT_WIDTH_DOTS = DOTS_58MM

# 32 columns fits either roll. 42 only fits 58mm in condensed font.
WRAP_NORMAL = 32
WRAP_CONDENSED = 42

DEFAULT_PRINTER = Path("/dev/usb/lp0")

# usblp's kernel buffer is small; large rasters must be fed in pieces.
CHUNK_BYTES = 1024


# --- Commands ------------------------------------------------------------


def init() -> bytes:
    """ESC @ — reset the printer to its power-on defaults."""
    return ESC + b"@"


def align(where: str = "left") -> bytes:
    """ESC a n — 0 left, 1 centre, 2 right."""
    return ESC + b"a" + {"left": b"\x00", "center": b"\x01", "right": b"\x02"}[where]


def bold(on: bool = True) -> bytes:
    """ESC E n — emphasised print."""
    return ESC + b"E" + (b"\x01" if on else b"\x00")


def double_height(on: bool = True) -> bytes:
    """GS ! n — double height only, so column count is unchanged."""
    return GS + b"!" + (b"\x01" if on else b"\x00")


def double_size(on: bool = True) -> bytes:
    """GS ! n — double width *and* height, halving the column count."""
    return GS + b"!" + (b"\x11" if on else b"\x00")


def condensed(on: bool = True) -> bytes:
    """ESC M n — condensed font, for fitting more columns on narrow paper."""
    return ESC + b"M" + (b"\x01" if on else b"\x00")


def font_b(on: bool = True) -> bytes:
    """ESC ! n — select the smaller built-in font."""
    return ESC + b"!" + (b"\x01" if on else b"\x00")


def feed(lines: int = 1) -> bytes:
    """ESC d n — advance n lines."""
    return ESC + b"d" + bytes([max(0, min(255, lines))])


def cut(feed_lines: int = 4) -> bytes:
    """GS V 66 n — feed past the blade, then partial cut.

    ESC m is *not* a cut command; earlier drafts used it and silently produced
    no cut at all. GS V with m=66 is the one that actually moves the cutter.
    """
    return feed(feed_lines) + GS + b"V" + b"\x42" + b"\x00"


def text(s: str) -> bytes:
    """Encode for the printer's codepage, substituting anything unmappable."""
    return s.encode("cp437", errors="replace")


def line(s: str = "") -> bytes:
    return text(s) + b"\n"


def rule(char: str = "-", width: int = WRAP_NORMAL) -> bytes:
    return text(char * width) + b"\n"


def centred(s: str, width: int = WRAP_NORMAL) -> bytes:
    """Centre one already-short line by padding with spaces."""
    s = s[:width]
    return b" " * max(0, (width - len(s)) // 2) + text(s) + b"\n"


# --- Text layout ---------------------------------------------------------


def wrap(s: str, width: int = WRAP_NORMAL) -> list[str]:
    """Greedy word wrap that hard-breaks tokens longer than the line."""
    out: list[str] = []
    for paragraph in s.expandtabs(2).rstrip().splitlines():
        cur = ""
        for word in paragraph.split():
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


def wrap_pairs(rows: list[tuple[str, str]], width: int = WRAP_NORMAL) -> list[str]:
    """Left/right justify label:value rows into aligned receipt columns."""
    out = []
    for label, value in rows:
        gap = width - len(label) - len(value)
        if gap < 1:
            out.append(label)
            out.append(value.rjust(width))
        else:
            out.append(label + " " * gap + value)
    return out


# --- Images --------------------------------------------------------------


def to_raster(img: Image.Image, dither: bool = True, threshold: int = 140) -> tuple[bytes, int, int]:
    """Convert an image to a GS v 0 raster payload.

    Returns ``(data, bytes_per_row, height)``. Photos want Floyd-Steinberg
    dithering; anything with hard edges (QR codes, text) must pass
    ``dither=False`` or the module boundaries dissolve into noise.
    """
    if dither:
        img = img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    else:
        img = img.convert("L").point(lambda v: 0 if v < threshold else 255)
        # Explicit NONE: convert("1") dithers by default, which would fuzz edges.
        img = img.convert("1", dither=Image.Dither.NONE)

    w, h = img.size
    bytes_per_row = (w + 7) // 8
    px = img.load()
    data = bytearray()
    for y in range(h):
        row = 0
        for x in range(w):
            if px[x, y] == 0:  # 0 == black in mode "1"
                row |= 1 << (7 - (x % 8))
            if x % 8 == 7:
                data.append(row)
                row = 0
        if w % 8:
            data.append(row)
    return bytes(data), bytes_per_row, h


def raster_command(img: Image.Image, dither: bool = True, threshold: int = 140) -> bytes:
    """GS v 0 — print a bitmap at the current alignment."""
    data, bytes_per_row, h = to_raster(img, dither=dither, threshold=threshold)
    return (
        GS
        + b"v"
        + b"0"
        + bytes([0, bytes_per_row & 0xFF, (bytes_per_row >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF])
        + data
        + b"\n"
    )


def fit(img: Image.Image, max_dots: int = DEFAULT_WIDTH_DOTS, resample: int | None = None) -> Image.Image:
    """Scale an image down to the printable width, preserving aspect ratio."""
    if img.width <= max_dots:
        return img
    height = max(1, int(img.height * max_dots / img.width))
    # Image.NEAREST is 0, so test for None rather than truthiness.
    method = Image.LANCZOS if resample is None else resample
    return img.resize((max_dots, height), method)


# --- Transport -----------------------------------------------------------


def write(data: bytes, printer: Path | None = None, chunk: int = CHUNK_BYTES) -> None:
    """Write bytes to the printer, tolerating short writes and EAGAIN.

    A plain single ``write()`` of a full-page raster routinely fails because the
    kernel's usblp buffer is much smaller than the payload.
    """
    path = Path(printer or DEFAULT_PRINTER)
    with open(path, "wb", buffering=0) as f:
        for i in range(0, len(data), chunk):
            piece = data[i : i + chunk]
            offset = 0
            while offset < len(piece):
                try:
                    offset += f.write(piece[offset:])
                except BlockingIOError:
                    time.sleep(0.01)


def printer_available(printer: Path | None = None) -> bool:
    return Path(printer or DEFAULT_PRINTER).exists()
