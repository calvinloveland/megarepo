"""Constants used by the demo video generator and its scenes.

Lives in its own module so the helpers in `animation.py`,
`scene_lib.py`, and the scenes themselves can import these names
without creating a cycle with `generate_demos.py`.
"""

from __future__ import annotations

from typing import Tuple

# ════════════════════════════════════════════════════════════════════════
# VIDEO DIMENSIONS & TIMING
# ════════════════════════════════════════════════════════════════════════

W, H = 1280, 720
FPS = 30
DURATION_S = 16.0
TOTAL_FRAMES = int(FPS * DURATION_S)

# ════════════════════════════════════════════════════════════════════════
# COLOR PALETTE (matches launcher UI)
# ════════════════════════════════════════════════════════════════════════

BG = (10, 14, 23)
BG_PANEL = (16, 22, 38)
GRID = (32, 40, 60)
GREEN = (74, 222, 128)
GREEN_DIM = (34, 197, 94)
AMBER = (251, 191, 36)
WHITE = (255, 255, 255)
GREY = (148, 163, 184)
DIM = (71, 85, 105)
DARK_TEXT = (180, 190, 205)

# Per-type accent colors (matches container colors in launcher UI)
TYPE_COLORS = {
    "flask":   (26, 74, 122),    # blue
    "nextjs":  (26, 90, 90),     # teal
    "vite":    (45, 80, 22),     # green
    "node":    (139, 69, 19),    # orange/brown
    "static":  (58, 58, 74),     # grey
    "python":  (26, 74, 122),
}


# ════════════════════════════════════════════════════════════════════════
# FONT LOADING
# ════════════════════════════════════════════════════════════════════════

_FONT_CACHE: dict[tuple[str, int], object] = {}


def load_font(size: int, bold: bool = False):
    """Load a monospace font, falling back to default if missing."""
    from PIL import ImageFont

    key = ("bold" if bold else "regular", size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]

    candidates = [
        "/nix/store/s0v7cizdm8c5d3v1z9467lw33q1ksq44-dejavu-fonts-minimal-2.37/share/fonts/truetype/DejaVuSansMono-Bold.ttf"
        if bold else
        "/nix/store/s0v7cizdm8c5d3v1z9467lw33q1ksq44-dejavu-fonts-minimal-2.37/share/fonts/truetype/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    ]

    for path in candidates:
        if Path(path).exists():
            try:
                font = ImageFont.truetype(path, size=size)
                _FONT_CACHE[key] = font
                return font
            except OSError:
                continue

    font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


from pathlib import Path
