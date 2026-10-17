#!/usr/bin/env python3
"""Print a monochrome image to the Epson TM-T88V thermal receipt printer.

Usage: print-image.py <path> [width height] [threshold]
"""

import sys
from PIL import Image

ESC = b"\x1b"
GS = b"\x1d"
PRINTER = "/dev/usb/lp0"

# Printable dots per line: 80mm paper at 203dpi = 576 dots.
MAX_WIDTH_DOTS = 576


def image_to_raster(img, threshold=140, dither=True):
    """Return (raster bytes, bytes_per_row, width, height) for GS v 0."""
    img = img.convert("L")
    if dither:
        # Floyd-Steinberg dithering keeps photographic detail on 1-bit thermal paper
        img = img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    else:
        img = img.point(lambda x: 0 if x < threshold else 255)
    width, height = img.size
    if width > MAX_WIDTH_DOTS:
        raise ValueError(f"image width {width} exceeds printable {MAX_WIDTH_DOTS} dots")
    bytes_per_row = (width + 7) // 8

    data = bytearray()
    pixels = img.load()
    for y in range(height):
        row = 0
        for x in range(width):
            if pixels[x, y] == 0:
                row |= 1 << (7 - (x % 8))
            if x % 8 == 7:
                data.append(row)
                row = 0
        if width % 8:
            data.append(row)
    return bytes(data), bytes_per_row, width, height


def print_image(path, size=None, threshold=140, label=True, dither=True):
    img = Image.open(path).convert("RGB")
    if size:
        img = img.resize(size, Image.LANCZOS)

    data, bytes_per_row, width, height = image_to_raster(img, threshold, dither)

    out = bytearray()
    out += ESC + b"@"
    if label:
        out += f"{path.rsplit('/', 1)[-1]}  {width}x{height}\n\n".encode()

    out += GS + b"v" + b"0"
    out += bytes([
        0,
        bytes_per_row & 0xFF,
        (bytes_per_row >> 8) & 0xFF,
        height & 0xFF,
        (height >> 8) & 0xFF,
    ])
    out += data
    out += b"\n"
    out += ESC + b"d\x04"
    out += ESC + b"m"

    with open(PRINTER, "wb") as f:
        f.write(bytes(out))
    print(f"printed {path} as {width}x{height}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    size = None
    if len(sys.argv) >= 4:
        size = (int(sys.argv[2]), int(sys.argv[3]))
    threshold = int(sys.argv[4]) if len(sys.argv) >= 5 else 140
    dither = "--no-dither" not in sys.argv
    print_image(path, size, threshold, dither=dither)
