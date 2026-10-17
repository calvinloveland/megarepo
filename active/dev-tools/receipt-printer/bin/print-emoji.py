#!/usr/bin/env python3
"""Print emoji (or any text) as a printer bitmap.

The TM-T88V has no emoji glyphs in any of its codepages, so emoji are
rasterised from Noto Color Emoji and dithered to 1-bit, exactly like a photo.

Usage: print-emoji.py "<emoji or text>" [scale] [--pixel-size N]
"""

import glob
import sys
import time

from PIL import Image, ImageDraw, ImageFont

PRINTER = "/dev/usb/lp0"
ESC = b"\x1b"
GS = b"\x1d"

# CBDT bitmap font: only one strike size renders natively (109px).
STRIKE = 109


def find_emoji_font() -> str:
    hits = sorted(glob.glob("/nix/store/*noto-fonts-color-emoji*/share/fonts/noto/NotoColorEmoji.ttf"))
    if not hits:
        sys.exit("NotoColorEmoji.ttf not found (try: nix-shell -p noto-fonts-emoji)")
    return hits[-1]


def render(text: str, scale: float = 1.0) -> Image.Image:
    font = ImageFont.truetype(find_emoji_font(), STRIKE)

    # Measure with a transparent canvas so getbbox() finds real ink bounds.
    probe = Image.new("RGBA", (STRIKE * (len(text) + 3), STRIKE * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(probe)
    d.text((STRIKE, STRIKE // 2), text, font=font, embedded_color=True)

    bbox = probe.getbbox()
    if not bbox:
        sys.exit(f"{text!r} produced no visible glyphs")
    img = probe.crop(bbox)

    if scale != 1.0:
        w = max(1, int(img.width * scale))
        h = max(1, int(img.height * scale))
        img = img.resize((w, h), Image.LANCZOS)

    # Flatten onto white, then to grayscale
    flat = Image.new("RGB", img.size, (255, 255, 255))
    flat.paste(img, mask=img.split()[-1])
    return flat.convert("L")


def to_raster(img: Image.Image) -> tuple[bytes, int, int]:
    img = img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    w, h = img.size
    bytes_per_row = (w + 7) // 8
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
    return bytes(data), bytes_per_row, h


def main() -> None:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not positional:
        sys.exit(__doc__)
    text = positional[0]
    scale = float(positional[1]) if len(positional) > 1 else 1.0

    img = render(text, scale)
    if img.width > 576:
        img = img.resize((576, int(img.height * 576 / img.width)), Image.LANCZOS)

    data, bpr, height = to_raster(img)

    out = bytearray()
    out += ESC + b"@"
    out += ESC + b"a" + b"\x01"  # center
    out += GS + b"v" + b"0"
    out += bytes([0, bpr & 0xFF, (bpr >> 8) & 0xFF, height & 0xFF, (height >> 8) & 0xFF])
    out += data
    out += b"\n"
    out += ESC + b"d\x04"
    out += GS + b"V" + b"\x42" + b"\x00"

    with open(PRINTER, "wb", buffering=0) as f:
        f.write(bytes(out))

    print(f"printed {text!r} as {img.width}x{height} bitmap")


if __name__ == "__main__":
    main()
