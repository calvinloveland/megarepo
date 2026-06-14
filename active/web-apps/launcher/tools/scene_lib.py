"""Shared drawing primitives for the demo video generator.

Every custom scene in demo_scenes.py is built on top of these helpers.
The goal is to keep per-scene code focused on the *story* (what the
demo is showing) rather than re-implementing common chrome like the
header bar, footer pill, and dark panel cards.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont

# Constants & helpers from dependency-free modules (no cycle risk)
from constants import (
    W, H, FPS, BG, BG_PANEL, GRID, GREEN, GREEN_DIM, AMBER, WHITE, GREY, DIM, DARK_TEXT,
    TYPE_COLORS, load_font,
)
from animation import (
    ease_out_cubic, ease_in_out_quad, ease_out_back,
    lerp, lerp_color, clamp01, frame_progress,
)

# ════════════════════════════════════════════════════════════════════════
# HEADER & FOOTER (the chrome that wraps every demo)
# ════════════════════════════════════════════════════════════════════════

def draw_chrome_header(img: Image.Image, app_name: str, t: float) -> None:
    """Top bar: brand mark on the left, project name + online status on the right."""
    draw = ImageDraw.Draw(img)
    bar_h = 50
    # Bar background
    draw.rectangle([(0, 0), (W, bar_h)], fill=BG_PANEL)
    draw.line([(0, bar_h), (W, bar_h)], fill=(40, 50, 70), width=1)

    font = load_font(14, bold=True)
    label = "SHSW.DEV  //  DEMO"
    draw.text((24, 17), label, fill=GREEN, font=font)

    # Right side: name + status
    name_font = load_font(13, bold=False)
    label_right = app_name.upper()[:26]
    nb = draw.textbbox((0, 0), label_right, font=name_font)
    name_w = nb[2] - nb[0]
    status_x = W - 24 - 110 - 10 - name_w
    draw.text((status_x, 18), label_right, fill=DARK_TEXT, font=name_font)
    # Status text + dot
    status_label = "ONLINE"
    sb = draw.textbbox((0, 0), status_label, font=font)
    sw = sb[2] - sb[0]
    sx = W - 24 - sw
    draw.text((sx, 17), status_label, fill=DIM, font=font)
    # Pulse dot
    pulse = 0.6 + 0.4 * math.sin(t * 4)
    color = tuple(int(c * pulse) for c in GREEN)
    cx = sx - 14
    cy = 25
    draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=color)


def draw_chrome_footer(img: Image.Image, app: "App", t: float) -> None:
    """Bottom pill with the public URL. Hidden until t > 1s."""
    if t < 1.0:
        return
    progress = clamp01((t - 1.0) / 1.5)
    eased = ease_out_cubic(progress)
    if eased <= 0:
        return

    text = f"  ▶  shsw.dev / {app.subdomain or app.id}  "
    font = load_font(16, bold=True)
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 12, 6
    box_w = tw + pad_x * 2
    box_h = th + pad_y * 2
    x = (W - box_w) // 2
    y = H - box_h - 20

    # Slide-up + fade-in
    y = int(lerp(y + 20, y, eased))

    draw.rounded_rectangle(
        [(x, y), (x + box_w, y + box_h)],
        radius=4, fill=BG_PANEL,
    )
    draw.rounded_rectangle(
        [(x, y), (x + box_w, y + box_h)],
        radius=4, outline=(*GREEN, 180), width=1,
    )
    pulse = 0.6 + 0.4 * math.sin(t * 3)
    dot_color = tuple(int(c * pulse) for c in GREEN)
    draw.ellipse(
        [(x + 8, y + box_h // 2 - 3), (x + 14, y + box_h // 2 + 3)],
        fill=dot_color,
    )
    draw.text((x + pad_x, y + pad_y - 2), text, fill=GREEN, font=font)


# ════════════════════════════════════════════════════════════════════════
# PANELS
# ════════════════════════════════════════════════════════════════════════

def draw_panel(
    img: Image.Image,
    x: int, y: int, w: int, h: int,
    title: str | None = None,
    accent: tuple[int, int, int] | None = None,
    fill: tuple[int, int, int] = (20, 26, 42),
    border: tuple[int, int, int] = (60, 75, 95),
) -> None:
    """A rounded dark card with optional title bar.

    Common shape across scenes — a slate panel with a slightly
    lighter header strip and a thin border.
    """
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [(x, y), (x + w, y + h)],
        radius=6, fill=fill,
    )
    draw.rounded_rectangle(
        [(x, y), (x + w, y + h)],
        radius=6, outline=border, width=1,
    )
    if title is not None:
        title_h = 26
        # Title bar
        draw.rectangle(
            [(x, y), (x + w, y + title_h)],
            fill=(28, 36, 56),
        )
        draw.rounded_rectangle(
            [(x, y), (x + w, y + h)],
            radius=6, outline=border, width=1,
        )
        # Accent dot
        if accent is not None:
            dot_x = x + 10
            dot_y = y + title_h // 2
            draw.ellipse(
                [dot_x - 4, dot_y - 4, dot_x + 4, dot_y + 4],
                fill=accent,
            )
        font = load_font(11, bold=True)
        draw.text((x + 22, y + 7), title.upper(), fill=GREY, font=font)


def draw_text(
    img: Image.Image,
    x: int, y: int, text: str,
    size: int = 13, bold: bool = False,
    fill: tuple[int, int, int] = WHITE,
    center_x: int | None = None,
    center_y: int | None = None,
) -> None:
    """Convenience: draw text optionally centered on the given point."""
    draw = ImageDraw.Draw(img)
    font = load_font(size, bold=bold)
    if center_x is not None or center_y is not None:
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        cx = (W - tw) // 2 if center_x is None else center_x
        cy = (center_y if center_y is not None else y) - th // 2 - bbox[1]
        draw.text((cx, cy), text, fill=fill, font=font)
    else:
        draw.text((x, y), text, fill=fill, font=font)


# ════════════════════════════════════════════════════════════════════════
# PROGRESS BARS
# ════════════════════════════════════════════════════════════════════════

def draw_progress_bar(
    img: Image.Image,
    x: int, y: int, w: int, h: int,
    progress: float,  # 0..1
    fg: tuple[int, int, int] = GREEN,
    bg: tuple[int, int, int] = (24, 32, 48),
) -> None:
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [(x, y), (x + w, y + h)],
        radius=h // 2, fill=bg,
    )
    fill_w = max(1, int(w * clamp01(progress)))
    if fill_w > 1:
        draw.rounded_rectangle(
            [(x, y), (x + fill_w, y + h)],
            radius=h // 2, fill=fg,
        )
    # Border
    draw.rounded_rectangle(
        [(x, y), (x + w, y + h)],
        radius=h // 2, outline=(50, 60, 80), width=1,
    )


# ════════════════════════════════════════════════════════════════════════
# EASING & ANIMATION PHASES
# ════════════════════════════════════════════════════════════════════════

def slide_in_x(t: float, start: float, end: float, full: float, from_left: bool = True) -> float:
    """Eased x position that slides in from off-screen and settles at `full`."""
    p = frame_progress(t, start, end)
    e = ease_out_cubic(p)
    offscreen = -full - 100 if from_left else W + 100
    return lerp(offscreen, full, e)


def slide_in_y(t: float, start: float, end: float, full: float, from_top: bool = True) -> float:
    p = frame_progress(t, start, end)
    e = ease_out_cubic(p)
    offscreen = -full - 100 if from_top else H + 100
    return lerp(offscreen, full, e)


def fade_in(t: float, start: float, end: float) -> float:
    """0..1 alpha based on time window."""
    return clamp01((t - start) / (end - start)) if t >= start else 0.0


def text_reveal(text: str, t: float, start: float, end: float) -> str:
    """Return the prefix of `text` to show at time `t`."""
    if t < start:
        return ""
    if t >= end:
        return text
    progress = (t - start) / (end - start)
    eased = ease_out_cubic(progress)
    return text[: int(len(text) * eased)]


def pop_scale(t: float, start: float, end: float, overshoot: float = 1.4) -> float:
    """A scale animation that starts at 0, overshoots past 1, then settles at 1.

    Returns 0..1, but can briefly exceed 1 during the overshoot.
    """
    if t < start:
        return 0.0
    if t >= end:
        return 1.0
    p = (t - start) / (end - start)
    c1 = overshoot
    c3 = c1 + 1
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2
