#!/usr/bin/env python3
"""Print a QR code to the Epson TM-T88V.

Important: QR codes are printed with a hard threshold, never dithering —
Floyd-Steinberg noise destroys the module edges that scanners depend on.
Each QR module is mapped to an integer number of printer dots so the grid
stays crisp at 203 dpi.

Captions are opt-in: the payload is never printed unless you ask for it.

Usage: print-qr.py "<text or url>" [--box N] [--caption TEXT]
"""

import sys
import time

import qrcode
from PIL import Image

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"
MAX_DOTS = 384  # 58mm paper; scanners like >= 3 dots per module


def build_qr(text: str, box: int = 4, border: int = 4) -> Image.Image:
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box,
        border=border,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("L")
    return img


def fit_to_paper(img: Image.Image, max_dots: int = MAX_DOTS) -> Image.Image:
    """Downscale only in whole-module steps so edges stay on dot boundaries."""
    if img.width <= max_dots:
        return img
    ratio = max_dots / img.width
    new_w = int(img.width * ratio)
    # Nearest-neighbour keeps the hard module edges intact.
    return img.resize((new_w, new_w), Image.NEAREST)


def to_raster(img: Image.Image) -> tuple[bytes, int, int]:
    # dither=NONE is essential here.
    img = img.convert("1", dither=Image.Dither.NONE)
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


def wrap(text: str, width: int = 32) -> list[str]:
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


def main() -> None:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not positional:
        sys.exit(__doc__)
    text = positional[0]

    box = 4
    if "--box" in sys.argv:
        box = int(sys.argv[sys.argv.index("--box") + 1])

    caption = None
    if "--caption" in sys.argv:
        caption = sys.argv[sys.argv.index("--caption") + 1]

    img = fit_to_paper(build_qr(text, box))
    data, bpr, h = to_raster(img)

    out = bytearray()
    out += ESC + b"@"  # init
    out += ESC + b"a" + b"\x01"  # center
    out += GS + b"v" + b"0"
    out += bytes([0, bpr & 0xFF, (bpr >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF])
    out += data
    out += b"\n"
    out += ESC + b"a" + b"\x00"

    # Captions are opt-in. Defaulting to the payload spoils surprise links.
    if caption and "--no-caption" not in sys.argv:
        for line in wrap(caption):
            out += line.encode("cp437", errors="replace") + b"\n"

    out += ESC + b"d\x04"
    out += GS + b"V" + b"\x42" + b"\x00"

    write_printer(bytes(out))
    print(f"printed QR ({img.width}x{img.height} dots): {text}")


if __name__ == "__main__":
    main()
