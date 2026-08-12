"""Headless verification of the LUC Link Explorer using system Chrome.

No browser-automation dependencies: drives `google-chrome-stable --headless`
directly, then decodes the screenshot PNG (stdlib zlib) and asserts that the
timeline band paints the expected family colors, the stats cards populated, and
the page reported no fetch/render errors.

Usage:
    python scripts/verify_web_ui.py [--port 8766] [--frames 300]
                                    [--out docs/images/link_explorer.png]
"""

from __future__ import annotations

import argparse
import struct
import subprocess
import sys
import threading
import zlib
from pathlib import Path

CHROME = "/run/current-system/sw/bin/google-chrome-stable"
ROOT = Path(__file__).resolve().parents[1]

# colors the timeline band must contain (family palette + traces)
EXPECTED_COLORS = {
    "repetition": "9ecae1", "hamming": "a6d854", "bch": "e78ac3",
    "reed-solomon": "ffd92f", "polar": "fc8d62", "ldpc": "66c2a5",
    "turbo": "8da0cb", "accent (est SNR)": "4fc3f7", "true SNR": "e15759",
}


def _decode_png(path: Path):
    """Minimal PNG decoder (RGBA/RGB, filters 0-4) using stdlib zlib."""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    idat = b""
    w = h = bitdepth = colortype = None
    while pos < len(data):
        length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        chunk = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            w, h, bitdepth, colortype = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
        pos += 12 + length
    raw = zlib.decompress(idat)
    channels = {2: 3, 6: 4}[colortype]
    bpp = channels
    stride = w * bpp
    out = bytearray(w * h * channels)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return w, h, channels, bytes(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--out", default=str(ROOT / "docs" / "images" / "link_explorer.png"))
    args = ap.parse_args()

    from luc_sim import serve as serve_mod

    httpd = serve_mod.ThreadingHTTPServer(("127.0.0.1", args.port), serve_mod.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{args.port}"

    shot = Path(args.out)
    shot.parent.mkdir(parents=True, exist_ok=True)
    common = [
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--virtual-time-budget=90000", "--window-size=1440,1000",
    ]
    print(f"loading {url} …")
    subprocess.run(
        common + [f"--screenshot={shot}", url],
        check=True, capture_output=True,
    )
    dom = subprocess.run(
        common + ["--dump-dom", url],
        check=True, capture_output=True,
    ).stdout.decode(errors="replace")

    # 1. the sim completed: stats cards populated, no error text in the status line
    if "link complete in" not in dom:
        print("FAIL: status line missing — the sim did not complete")
        return 1
    if ">error:" in dom:
        print("FAIL: page reported an error:")
        for line in dom.splitlines():
            if "error:" in line:
                print("  ", line.strip()[:200])
        return 1
    print(f"ok: sim completed, {dom.count('card')} card elements")

    # 2. the timeline band painted the family colors
    w, h, ch, px = _decode_png(shot)
    pxset = {tuple(px[i : i + 3]) for i in range(0, len(px), ch)}
    print(f"ok: screenshot {w}x{h}, {len(pxset)} distinct colors")
    missing = []
    for name, hexc in EXPECTED_COLORS.items():
        t = tuple(bytes.fromhex(hexc))
        if not any(all(abs(t[k] - p[k]) <= 14 for k in range(3)) for p in pxset):
            missing.append(name)
    if missing:
        print("FAIL: colors missing:", missing)
        return 1
    print("ok: all expected timeline/family colors present")

    httpd.shutdown()
    print(f"screenshot -> {shot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
