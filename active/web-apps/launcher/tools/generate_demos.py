"""Generate demo MP4 videos for every project registered in apps.yaml.

Each demo is a short, branded title-card animation that introduces one
project: icon, name, description, tech stack, a mock terminal line, and
the public shsw.dev URL. The visual language mirrors the launcher UI
(dark slate background, green accent, monospaced type).

Run with:
    nix-shell -p python3Packages.pillow ffmpeg --run \
        "python3 tools/generate_demos.py"

Output: <launcher>/demos/<app-id>.mp4
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Sequence

import yaml
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ════════════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════════════

LAUNCHER_DIR = Path(__file__).resolve().parent.parent
APPS_FILE = LAUNCHER_DIR / "apps.yaml"
OUTPUT_DIR = LAUNCHER_DIR / "demos"

W, H = 1280, 720          # 720p is plenty for a title card and encodes fast
FPS = 30
DURATION_S = 16.0         # total seconds per video
TOTAL_FRAMES = int(FPS * DURATION_S)

# Color palette — matches launcher UI
BG = (10, 14, 23)         # #0a0e17
BG_PANEL = (16, 22, 38)   # slightly lighter slate
GRID = (32, 40, 60)       # subtle grid
GREEN = (74, 222, 128)    # #4ade80
GREEN_DIM = (34, 197, 94) # #22c55e
AMBER = (251, 191, 36)    # #fbbf24
WHITE = (255, 255, 255)
GREY = (148, 163, 184)    # #94a3b8
DIM = (71, 85, 105)       # #475569
DARK_TEXT = (180, 190, 205)

# Type scale (px)
SIZE_HERO = 88
SIZE_NAME = 64
SIZE_DESC = 24
SIZE_BADGE = 18
SIZE_MICRO = 14
SIZE_TERMINAL = 16

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

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Load a monospace font, falling back to default if missing."""
    key = ("bold" if bold else "regular", size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]

    candidates = [
        # Nix store paths for DejaVu Sans Mono
        "/nix/store/s0v7cizdm8c5d3v1z9467lw33q1ksq44-dejavu-fonts-minimal-2.37/share/fonts/truetype/DejaVuSansMono-Bold.ttf"
        if bold else
        "/nix/store/s0v7cizdm8c5d3v1z9467lw33q1ksq44-dejavu-fonts-minimal-2.37/share/fonts/truetype/DejaVuSansMono.ttf",
        # Common Linux paths
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


# ════════════════════════════════════════════════════════════════════════
# EASING
# ════════════════════════════════════════════════════════════════════════

def ease_out_cubic(t: float) -> float:
    return 1 - (1 - t) ** 3


def ease_in_out_quad(t: float) -> float:
    if t < 0.5:
        return 2 * t * t
    return 1 - (-2 * t + 2) ** 2 / 2


def ease_out_back(t: float, overshoot: float = 1.7) -> float:
    c1 = overshoot
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(lerp(a[0], b[0], t)),
        int(lerp(a[1], b[1], t)),
        int(lerp(a[2], b[2], t)),
    )


def clamp01(t: float) -> float:
    return max(0.0, min(1.0, t))


def frame_progress(t_seconds: float, start: float, end: float) -> float:
    """Return 0..1 progress within a time window, easing applied."""
    if t_seconds <= start:
        return 0.0
    if t_seconds >= end:
        return 1.0
    return clamp01((t_seconds - start) / (end - start))


# ════════════════════════════════════════════════════════════════════════
# BACKGROUND
# ════════════════════════════════════════════════════════════════════════

def render_background(t_seconds: float) -> Image.Image:
    """Dark slate background with subtle grid + animated scanline."""
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Subtle grid
    grid_step = 40
    for x in range(0, W, grid_step):
        draw.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, grid_step):
        draw.line([(0, y), (W, y)], fill=GRID, width=1)

    # Vignette: darken edges
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    for r in range(0, 200, 4):
        alpha = int(255 * (1 - r / 200) * 0.4)
        vd.ellipse(
            [-r, -r, W + r, H + r],
            outline=alpha, width=4,
        )
    img = Image.composite(
        Image.new("RGB", (W, H), (0, 0, 0)),
        img,
        vignette,
    )

    # Subtle horizontal scanline that drifts down
    scan_y = int((t_seconds * 60) % (H + 200)) - 100
    scan_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scan_overlay)
    for dy in range(-3, 4):
        if 0 <= scan_y + dy < H:
            band_alpha = 30 - abs(dy) * 8
            if band_alpha > 0:
                sd.line(
                    [(0, scan_y + dy), (W, scan_y + dy)],
                    fill=(74, 222, 128, band_alpha), width=1,
                )
    img = Image.alpha_composite(img.convert("RGBA"), scan_overlay).convert("RGB")

    return img


# ════════════════════════════════════════════════════════════════════════
# SCENE COMPOSITION
# ════════════════════════════════════════════════════════════════════════

@dataclass
class App:
    id: str
    name: str
    description: str
    icon: str
    subdomain: str
    port: int
    type: str
    path: str
    module: str | None = None
    start_cmd: str | None = None

    @property
    def accent(self) -> tuple[int, int, int]:
        return TYPE_COLORS.get(self.type, TYPE_COLORS["static"])

    @property
    def public_url(self) -> str:
        return f"https://{self.subdomain}.shsw.dev" if self.subdomain else "shsw.dev"

    @property
    def local_url(self) -> str:
        return f"http://localhost:{self.port}"

    @property
    def start_command_display(self) -> str:
        if self.module:
            return f"python3 -m {self.module}"
        return self.start_cmd or "—"


def load_apps() -> list[App]:
    with open(APPS_FILE) as f:
        data = yaml.safe_load(f)
    apps: list[App] = []
    for entry in data.get("apps", []):
        apps.append(App(
            id=entry["id"],
            name=entry["name"],
            description=entry.get("description", ""),
            icon=entry.get("icon", "📦"),
            subdomain=entry.get("subdomain", ""),
            port=entry.get("port", 0),
            type=entry.get("type", ""),
            path=entry.get("path", ""),
            module=entry.get("module"),
            start_cmd=entry.get("start_cmd"),
        ))
    return apps


# ── Animation phases (seconds) ────────────────────────────────────────
T_HEADER_IN = (0.0, 1.0)
T_ICON_IN = (0.4, 1.8)
T_NAME_IN = (1.6, 3.0)
T_DESC_IN = (2.8, 5.0)
T_TAGS_IN = (4.5, 6.5)
T_TERMINAL_IN = (6.5, 8.0)
T_TERMINAL_TYPE = (8.0, 11.5)
T_BROWSER_IN = (11.0, 12.5)
T_PULSE = (12.0, 15.0)
T_OUTRO = (15.0, 16.0)


def draw_header_bar(draw: ImageDraw.ImageDraw, t: float) -> None:
    """Top bar with brand mark and section label."""
    progress = ease_out_cubic(frame_progress(t, *T_HEADER_IN))
    if progress <= 0:
        return

    bar_h = 50
    bar_y = int(lerp(-bar_h, 0, progress))

    # Background
    draw.rectangle([(0, bar_y), (W, bar_y + bar_h)], fill=BG_PANEL)
    draw.line([(0, bar_y + bar_h), (W, bar_y + bar_h)], fill=(40, 50, 70), width=1)

    # Brand mark
    font = load_font(16, bold=True)
    label = "SHSW.DEV  //  DEMO"
    draw.text((24, bar_y + 16), label, fill=GREEN, font=font)

    # Right side: status
    right = "ONLINE"
    bbox = draw.textbbox((0, 0), right, font=font)
    rw = bbox[2] - bbox[0]
    draw.text((W - rw - 24, bar_y + 16), right, fill=DIM, font=font)

    # Tiny status dot
    cx, cy = W - rw - 24 - 14, bar_y + 24
    pulse = 0.6 + 0.4 * math.sin(t * 4)
    color = tuple(int(c * pulse) for c in GREEN)
    draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=color)


def draw_icon(img: Image.Image, app: App, t: float) -> int:
    """Render the project icon as a styled container card with a monogram letter.

    Returns the bottom Y of the card so callers can lay out content below.
    """
    progress = ease_out_back(frame_progress(t, *T_ICON_IN), overshoot=1.3)
    if progress < 0.02:
        return 200

    center_y = 180

    scale = max(0.02, progress)
    if t > T_ICON_IN[1]:
        scale = 1.0 + 0.02 * math.sin((t - T_ICON_IN[1]) * 1.5)

    base_w, base_h = 240, 240
    cx, cy = W // 2, center_y
    card_w = max(2, int(base_w * scale))
    card_h = max(2, int(base_h * scale))
    x0, y0 = cx - card_w // 2, cy - card_h // 2
    x1, y1 = cx + card_w // 2, cy + card_h // 2

    accent = app.accent
    draw = ImageDraw.Draw(img)

    # Card background with subtle vertical gradient
    for i in range(card_h):
        t_grad = i / max(1, card_h - 1)
        c = tuple(int(lerp(ch, ch * 0.65, t_grad)) for ch in accent)
        draw.line([(x0, y0 + i), (x1, y0 + i)], fill=c)

    # Corrugated metal texture (subtle)
    for i in range(0, card_h, 6):
        draw.line([(x0, y0 + i), (x1, y0 + i)], fill=(0, 0, 0, 30), width=1)
        draw.line([(x0, y0 + i + 1), (x1, y0 + i + 1)], fill=(255, 255, 255, 18), width=1)

    # Border
    draw.rectangle([(x0, y0), (x1, y1)], outline=(0, 0, 0), width=3)
    draw.rectangle(
        [(x0 + 1, y0 + 1), (x1 - 1, y1 - 1)],
        outline=(255, 255, 255, 20), width=1,
    )

    # Corner brackets
    bracket = 16
    for (bx, by) in [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]:
        dx = 1 if bx == x0 else -1
        dy = 1 if by == y0 else -1
        draw.line(
            [(bx + dx * bracket, by), (bx, by), (bx, by + dy * bracket)],
            fill=(255, 255, 255, 110), width=2,
        )

    # Big monogram letter — first letter of the app's subdomain or name
    initial = (app.subdomain or app.name or "?").strip().upper()[:1] or "X"
    mono_size = max(24, int(180 * scale))
    mono_font = load_font(mono_size, bold=True)
    bbox = draw.textbbox((0, 0), initial, font=mono_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = cx - tw // 2 - bbox[0]
    ty = cy - th // 2 - bbox[1] - 6

    # Subtle dark circle behind the letter so it pops against the texture
    circle_r = int(max(tw, th) * 0.9) + 14
    rgba = img.convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(overlay).ellipse(
        [(cx - circle_r, cy - circle_r), (cx + circle_r, cy + circle_r)],
        fill=(0, 0, 0, 170),
    )
    rgba.alpha_composite(overlay)
    img.paste(rgba.convert("RGB"))
    draw = ImageDraw.Draw(img)

    # Drop shadow + main letter
    draw.text((tx + 2, ty + 2), initial, fill=(0, 0, 0, 240), font=mono_font)
    draw.text((tx, ty), initial, fill=WHITE, font=mono_font)

    # Subtitle inside the card — short type label
    sub_label = app.type.upper() if app.type else "APP"
    sub_size = max(8, int(16 * scale))
    sub_font = load_font(sub_size, bold=True)
    sb = draw.textbbox((0, 0), sub_label, font=sub_font)
    sw = sb[2] - sb[0]
    sx = cx - sw // 2 - sb[0]
    sy = y1 - max(20, int(32 * scale))
    # Pill background
    pad_x, pad_y = 8, 4
    pill_w = sw + pad_x * 2
    pill_h = (sb[3] - sb[1]) + pad_y * 2
    pill_x0 = cx - pill_w // 2
    pill_y0 = sy - pad_y
    draw.rounded_rectangle(
        [(pill_x0, pill_y0), (pill_x0 + pill_w, pill_y0 + pill_h)],
        radius=3, fill=(0, 0, 0, 180),
    )
    draw.text((sx, sy), sub_label, fill=GREEN, font=sub_font)

    # Container ID at top — mimics launcher's container cards
    if scale > 0.6:
        cid_size = max(8, int(12 * scale))
        cid_font = load_font(cid_size, bold=True)
        cid = f"ID {app.id[:4].upper()}·{abs(hash(app.id)) % 10000:04d}"
        cb = draw.textbbox((0, 0), cid, font=cid_font)
        cwid = cb[2] - cb[0]
        cpad_x, cpad_y = 5, 2
        cbox_w = cwid + cpad_x * 2
        cbox_h = (cb[3] - cb[1]) + cpad_y * 2
        cbox_x0 = x0 + 10
        cbox_y0 = y0 + 10
        draw.rounded_rectangle(
            [(cbox_x0, cbox_y0), (cbox_x0 + cbox_w, cbox_y0 + cbox_h)],
            radius=2, fill=(0, 0, 0, 180),
        )
        draw.text(
            (cbox_x0 + cpad_x, cbox_y0 + cpad_y - 1),
            cid, fill=(255, 255, 255, 200), font=cid_font,
        )

    return y1 + 30


def draw_name(draw: ImageDraw.ImageDraw, app: App, t: float) -> None:
    """Project name with letter-by-letter reveal (typewriter feel)."""
    progress = frame_progress(t, *T_NAME_IN)
    if progress <= 0:
        return

    eased = ease_out_cubic(progress)
    name = app.name.upper()
    chars_to_show = int(len(name) * eased)
    if chars_to_show == 0 and progress > 0.01:
        chars_to_show = 1
    visible = name[:chars_to_show]

    font = load_font(SIZE_NAME, bold=True)
    bbox = draw.textbbox((0, 0), visible, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (W - tw) // 2 - bbox[0]
    y = 360

    # Subtle drop shadow
    draw.text((x + 2, y + 2), visible, fill=(0, 0, 0), font=font)
    # Main text
    draw.text((x, y), visible, fill=WHITE, font=font)

    # Caret blink at end of typing
    if progress < 1.0 and int(t * 3) % 2 == 0:
        cx = x + tw + 6
        draw.rectangle(
            [(cx, y - 4), (cx + 4, y + th + 4)],
            fill=GREEN,
        )


def draw_description(draw: ImageDraw.ImageDraw, app: App, t: float) -> None:
    """Description fades in line-by-line (typewriter feel)."""
    progress = frame_progress(t, *T_DESC_IN)
    if progress <= 0:
        return

    desc = app.description or ""
    if not desc:
        return

    # Wrap to max 2 lines that fit horizontally
    wrapped = textwrap.wrap(desc, width=58)
    if not wrapped:
        return
    if len(wrapped) > 2:
        # Combine into 2 balanced lines
        mid = len(wrapped) // 2
        wrapped = [
            " ".join(wrapped[:mid]),
            " ".join(wrapped[mid:]),
        ]

    font = load_font(SIZE_DESC)
    eased = ease_out_cubic(progress)
    total_chars = sum(len(line) for line in wrapped) + len(wrapped) - 1
    chars_to_show = int(total_chars * eased)
    cumulative = 0
    line_h = SIZE_DESC + 8

    y0 = 440
    for i, line in enumerate(wrapped):
        line_progress_chars = chars_to_show - cumulative
        cumulative += len(line) + 1  # +1 for newline
        if line_progress_chars <= 0:
            continue
        line_progress_chars = min(line_progress_chars, len(line))
        visible = line[:line_progress_chars]

        bbox = draw.textbbox((0, 0), visible, font=font)
        tw = bbox[2] - bbox[0]
        x = (W - tw) // 2 - bbox[0]
        draw.text((x, y0 + i * line_h), visible, fill=GREY, font=font)

    # Caret blink
    if progress < 1.0 and int(t * 3) % 2 == 0:
        # Find which line the caret is on
        cumulative = 0
        caret_line = 0
        caret_offset = 0
        chars_remaining = chars_to_show
        for i, line in enumerate(wrapped):
            if chars_remaining <= len(line):
                caret_line = i
                caret_offset = chars_remaining
                break
            chars_remaining -= len(line) + 1
            caret_line = i
            caret_offset = len(line)
        caret_text = wrapped[caret_line][:caret_offset]
        bbox = draw.textbbox((0, 0), caret_text, font=font)
        ctw = bbox[2] - bbox[0]
        line_full = wrapped[caret_line]
        fb = draw.textbbox((0, 0), line_full, font=font)
        full_tw = fb[2] - fb[0]
        cx = (W - full_tw) // 2 - fb[0] + ctw + 2
        cy = y0 + caret_line * line_h
        draw.rectangle(
            [(cx, cy - 2), (cx + 3, cy + SIZE_DESC)],
            fill=GREEN,
        )


def draw_tags(draw: ImageDraw.ImageDraw, app: App, t: float) -> None:
    """Tech badges: TYPE, PORT, SUBDOMAIN."""
    progress = frame_progress(t, *T_TAGS_IN)
    if progress <= 0:
        return

    tags = [
        ("TYPE", app.type.upper() if app.type else "—"),
        ("PORT", str(app.port) if app.port else "—"),
        ("DOMAIN", app.subdomain if app.subdomain else "—"),
    ]

    font_label = load_font(11, bold=True)
    font_value = load_font(13, bold=True)

    # Measure each chip first
    pad_x, pad_y = 8, 5
    gap = 8
    chips: list[tuple[str, str, int, int]] = []
    for label, value in tags:
        lb = draw.textbbox((0, 0), label, font=font_label)
        vb = draw.textbbox((0, 0), value, font=font_value)
        chip_w = (vb[2] - vb[0]) + (lb[2] - lb[0]) + pad_x * 3 + 6
        chip_h = max((vb[3] - vb[1]), (lb[3] - lb[1])) + pad_y * 2
        chips.append((label, value, chip_w, chip_h))

    total_w = sum(c[2] for c in chips) + gap * (len(chips) - 1)

    # Reveal from left with stagger
    reveal_x = int(total_w * (1 - ease_out_cubic(progress)))
    start_x = (W - total_w) // 2
    y0 = 540

    x_cursor = start_x + reveal_x
    for label, value, w, h in chips:
        if x_cursor > start_x + total_w:
            break

        x0 = x_cursor
        x1 = x0 + w
        # Background
        draw.rounded_rectangle(
            [(x0, y0), (x1, y0 + h)],
            radius=3, fill=(20, 26, 42),
        )
        draw.rounded_rectangle(
            [(x0, y0), (x1, y0 + h)],
            radius=3, outline=(60, 75, 95), width=1,
        )
        # Label
        draw.text((x0 + pad_x, y0 + pad_y - 1), label, fill=DIM, font=font_label)
        # Value (right-aligned)
        vb = draw.textbbox((0, 0), value, font=font_value)
        vw = vb[2] - vb[0]
        draw.text(
            (x1 - vw - pad_x, y0 + pad_y - 2),
            value, fill=GREEN, font=font_value,
        )

        x_cursor += w + gap


def draw_terminal_panel(img: Image.Image, app: App, t: float) -> None:
    """Mock terminal window that types out a startup command and logs."""
    progress = frame_progress(t, *T_TERMINAL_IN)
    if progress <= 0:
        return

    ease = ease_out_cubic(progress)

    # Position: bottom-right corner, slide up + fade in
    panel_w, panel_h = 460, 110
    margin = 24
    target_x = W - panel_w - margin
    target_y = H - panel_h - margin
    x = int(lerp(W, target_x, ease))
    y = int(lerp(target_y + 60, target_y, ease))

    # Backdrop with rounded corners
    panel = Image.new("RGBA", (panel_w, panel_h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle(
        [(0, 0), (panel_w, panel_h)],
        radius=6, fill=(20, 26, 42, 240),
    )
    pd.rounded_rectangle(
        [(0, 0), (panel_w, panel_h)],
        radius=6, outline=(60, 70, 90, 255), width=1,
    )

    # Title bar
    pd.rectangle([(0, 0), (panel_w, 26)], fill=(28, 36, 56, 255))
    pd.rounded_rectangle(
        [(0, 0), (panel_w, panel_h)],
        radius=6, outline=(60, 70, 90, 255), width=1,
    )
    # macOS-style traffic lights
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = 12 + i * 16
        pd.ellipse([(cx - 5, 8), (cx + 5, 18)], fill=(*c, 255))
    # Title
    title_font = load_font(SIZE_MICRO, bold=True)
    title = f"~/megarepo/{app.id}"
    pd.text((70, 6), title, fill=DARK_TEXT, font=title_font)

    # Body content
    body_font = load_font(SIZE_TERMINAL, bold=False)
    body_y = 36
    pd.text((14, body_y), "$", fill=GREEN, font=body_font)

    # Type out the command
    cmd_progress = frame_progress(t, *T_TERMINAL_TYPE)
    cmd = app.start_command_display
    cmd_chars = int(len(cmd) * ease_out_cubic(cmd_progress))
    if cmd_chars > 0:
        cmd_visible = cmd[:cmd_chars]
        pd.text((28, body_y), cmd_visible, fill=WHITE, font=body_font)

    # Output line — appears after command is fully typed
    if cmd_progress > 0.4:
        out_progress = clamp01((cmd_progress - 0.4) / 0.4)
        out_text = f"→ listening on {app.local_url}"
        out_chars = int(len(out_text) * out_progress)
        if out_chars > 0:
            pd.text((14, body_y + 22), out_text[:out_chars], fill=GREEN, font=body_font)

    if cmd_progress > 0.7:
        ok_text = "✓ READY"
        ok_progress = clamp01((cmd_progress - 0.7) / 0.3)
        ok_alpha = int(255 * ok_progress)
        pd.text((14, body_y + 46), ok_text, fill=(*GREEN, ok_alpha), font=body_font)

    # Blinking caret
    if cmd_progress < 1.0 and int(t * 4) % 2 == 0:
        cw_x = 28 + draw_text_width(body_font, cmd[:cmd_chars]) + 2
        pd.rectangle(
            [(cw_x, body_y - 2), (cw_x + 7, body_y + SIZE_TERMINAL)],
            fill=(*GREEN, 255),
        )

    img.paste(panel, (x, y), panel)


def draw_text_width(font, text: str) -> int:
    """Approximate width of text using the font's metrics."""
    img = Image.new("RGB", (1, 1))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def draw_browser_panel(img: Image.Image, app: App, t: float) -> None:
    """Mock browser window with the public URL."""
    progress = frame_progress(t, *T_BROWSER_IN)
    if progress <= 0:
        return

    ease = ease_out_cubic(progress)
    panel_w, panel_h = 460, 110
    margin = 24
    target_x = margin
    target_y = H - panel_h - margin
    x = int(lerp(-panel_w, target_x, ease))
    y = target_y

    panel = Image.new("RGBA", (panel_w, panel_h), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle(
        [(0, 0), (panel_w, panel_h)],
        radius=6, fill=(20, 26, 42, 240),
    )
    pd.rounded_rectangle(
        [(0, 0), (panel_w, panel_h)],
        radius=6, outline=(60, 70, 90, 255), width=1,
    )

    # Title bar
    pd.rectangle([(0, 0), (panel_w, 28)], fill=(28, 36, 56, 255))
    pd.rounded_rectangle(
        [(0, 0), (panel_w, panel_h)],
        radius=6, outline=(60, 70, 90, 255), width=1,
    )
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = 14 + i * 16
        pd.ellipse([(cx - 5, 9), (cx + 5, 19)], fill=(*c, 255))

    # URL bar
    url_bar_y = 38
    pd.rounded_rectangle(
        [(14, url_bar_y), (panel_w - 14, url_bar_y + 28)],
        radius=4, fill=(10, 14, 23, 255),
    )
    pd.rounded_rectangle(
        [(14, url_bar_y), (panel_w - 14, url_bar_y + 28)],
        radius=4, outline=(50, 60, 80, 255), width=1,
    )
    # Lock icon (fake)
    pd.rounded_rectangle(
        [(22, url_bar_y + 9), (28, url_bar_y + 16)],
        radius=1, fill=GREEN,
    )
    # URL text
    url_font = load_font(16, bold=False)
    url_text = app.public_url
    pd.text((38, url_bar_y + 6), url_text, fill=GREEN, font=url_font)

    # Status: online
    status_font = load_font(13, bold=True)
    pd.text((14, url_bar_y + 36), "STATUS", fill=DIM, font=status_font)
    pd.text((75, url_bar_y + 36), "● ONLINE", fill=GREEN, font=status_font)
    # Right side: copy / open hint
    pd.text((panel_w - 90, url_bar_y + 36), "[ENTER ↵]", fill=DIM, font=status_font)

    # Pulse on the URL bar after it appears
    if t > T_PULSE[0]:
        pulse_t = (t - T_PULSE[0]) / (T_PULSE[1] - T_PULSE[0])
        pulse_t = clamp01(pulse_t)
        pulse_alpha = int(60 * math.sin(pulse_t * math.pi * 2))
        if pulse_alpha > 0:
            pd.rounded_rectangle(
                [(14, url_bar_y), (panel_w - 14, url_bar_y + 28)],
                radius=4, outline=(*GREEN, pulse_alpha), width=2,
            )

    img.paste(panel, (x, y), panel)


def draw_footer(draw: ImageDraw.ImageDraw, app: App, t: float) -> None:
    """Bottom: SHSW.DEV / {subdomain}"""
    if t < T_TAGS_IN[0]:
        return
    progress = ease_out_cubic(frame_progress(t, T_TAGS_IN[0], T_TAGS_IN[1] + 0.5))
    if progress <= 0:
        return

    text = f"  ▶  shsw.dev / {app.subdomain or app.id}  "
    font = load_font(SIZE_BADGE, bold=True)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 12, 6
    x = (W - tw - pad_x * 2) // 2
    y = H - th - pad_y * 2 - 4

    draw.rounded_rectangle(
        [(x, y), (x + tw + pad_x * 2, y + th + pad_y * 2)],
        radius=4, fill=BG_PANEL,
    )
    draw.rounded_rectangle(
        [(x, y), (x + tw + pad_x * 2, y + th + pad_y * 2)],
        radius=4, outline=(*GREEN, 180), width=1,
    )
    # Pulsing dot
    pulse = 0.6 + 0.4 * math.sin(t * 3)
    dot_color = tuple(int(c * pulse) for c in GREEN)
    draw.ellipse(
        [(x + 8, y + th // 2 - 3), (x + 14, y + th // 2 + 3)],
        fill=dot_color,
    )
    draw.text((x + pad_x, y + pad_y - 2), text, fill=GREEN, font=font)


def draw_outro_overlay(img: Image.Image, t: float) -> None:
    """Black fade out at the very end."""
    if t < T_OUTRO[0]:
        return
    p = clamp01((t - T_OUTRO[0]) / (T_OUTRO[1] - T_OUTRO[0]))
    alpha = int(255 * p)
    if alpha <= 0:
        return
    # Convert to RGBA for compositing, then back to RGB
    rgba = img.convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, alpha))
    rgba.alpha_composite(overlay)
    img.paste(rgba.convert("RGB"))


def render_frame(app: App, t: float) -> Image.Image:
    """Compose a single frame at time t (seconds)."""
    img = render_background(t)
    draw = ImageDraw.Draw(img)

    draw_header_bar(draw, t)
    draw_icon(img, app, t)
    draw = ImageDraw.Draw(img)
    draw_name(draw, app, t)
    draw_description(draw, app, t)
    draw_tags(draw, app, t)
    draw_footer(draw, app, t)

    # Panels (paste on top)
    draw_terminal_panel(img, app, t)
    draw_browser_panel(img, app, t)

    draw_outro_overlay(img, t)
    return img


# ════════════════════════════════════════════════════════════════════════
# ENCODING
# ════════════════════════════════════════════════════════════════════════

def encode_video(frames_dir: Path, output: Path, fps: int = FPS) -> None:
    """Encode a directory of PNG frames into an MP4 using ffmpeg."""
    pattern = str(frames_dir / "frame_%06d.png")
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", pattern,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "22",
        "-movflags", "+faststart",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",  # ensure even dims
        str(output),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("ffmpeg stderr:", res.stderr[-2000:], file=sys.stderr)
        raise RuntimeError(f"ffmpeg failed for {output}")


def generate_demo(app: App, output_dir: Path, tmp_root: Path) -> Path:
    """Generate one demo MP4 for a single app."""
    frame_dir = tmp_root / app.id
    frame_dir.mkdir(parents=True, exist_ok=True)
    # Clear stale frames
    for f in frame_dir.glob("frame_*.png"):
        f.unlink()

    t0 = time.time()
    for i in range(TOTAL_FRAMES):
        t = i / FPS
        img = render_frame(app, t)
        img.save(frame_dir / f"frame_{i:06d}.png", optimize=False)
    render_t = time.time() - t0

    out = output_dir / f"{app.id}.mp4"
    encode_video(frame_dir, out)
    enc_t = time.time() - t0 - render_t
    print(f"  ✓ {app.id:30s} {out.stat().st_size // 1024:>5d}KB  "
          f"(render {render_t:.1f}s, encode {enc_t:.1f}s)")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate demo videos for every project")
    parser.add_argument("--only", help="Comma-separated list of app IDs to render (default: all)")
    parser.add_argument("--out", type=Path, default=OUTPUT_DIR, help="Output directory")
    parser.add_argument("--keep-frames", action="store_true", help="Keep intermediate PNG frames")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    apps = load_apps()
    if args.only:
        wanted = {a.strip() for a in args.only.split(",")}
        apps = [a for a in apps if a.id in wanted]
        if not apps:
            print(f"No apps match --only={args.only!r}", file=sys.stderr)
            return 1

    print(f"Rendering {len(apps)} demo videos to {args.out}/")
    print(f"  resolution: {W}x{H} @ {FPS}fps  duration: {DURATION_S}s ({TOTAL_FRAMES} frames)")
    print()

    with tempfile.TemporaryDirectory(prefix="demo-frames-") as tmp:
        tmp_root = Path(tmp)
        ok = 0
        for app in apps:
            try:
                generate_demo(app, args.out, tmp_root)
                ok += 1
            except Exception as e:
                print(f"  ✗ {app.id}: {e}", file=sys.stderr)

    print()
    print(f"Done: {ok}/{len(apps)} videos written to {args.out}/")
    return 0 if ok == len(apps) else 1


if __name__ == "__main__":
    sys.exit(main())
