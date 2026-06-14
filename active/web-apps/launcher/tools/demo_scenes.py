"""Hand-crafted demo scenes for every project on the launcher.

Each scene is a 16-second composition that showcases what makes one
project distinctive. The default `scene_default` is the title-card
fallback (icon card, name, description, mock terminal + browser) that
we used before this rewrite.

A scene function takes `(app, img, t)` and draws directly onto the
pre-rendered background image. Standard chrome (top bar, bottom URL
pill) is added by `render_frame` in `generate_demos.py` after the
scene returns, so individual scenes only need to render their unique
content.
"""

from __future__ import annotations

import math
import textwrap
import time
from typing import List, Tuple

from PIL import Image, ImageDraw, ImageFont

from constants import (
    W, H, BG, BG_PANEL, GRID, GREEN, GREEN_DIM, AMBER, WHITE, GREY, DIM, DARK_TEXT,
    TYPE_COLORS, load_font,
)
from animation import (
    ease_out_cubic, ease_in_out_quad, ease_out_back,
    lerp, lerp_color, clamp01, frame_progress,
)
from scene_lib import (
    draw_panel, draw_text, draw_progress_bar,
    slide_in_x, slide_in_y, fade_in, text_reveal, pop_scale,
)


# ════════════════════════════════════════════════════════════════════════
# DEFAULT SCENE — title-card fallback for projects without a custom scene
# ════════════════════════════════════════════════════════════════════════

# These were moved to generate_demos originally; import them lazily so
# we don't have a circular dep.
def scene_default(app: App, img: Image.Image, t: float) -> None:
    """The original 'container card + name + description + tags + terminal + browser' layout."""
    import generate_demos as gd

    draw = ImageDraw.Draw(img)
    gd.draw_icon(img, app, t)
    draw = ImageDraw.Draw(img)
    gd.draw_name(draw, app, t)
    gd.draw_description(draw, app, t)
    gd.draw_tags(draw, app, t)
    gd.draw_terminal_panel(img, app, t)
    gd.draw_browser_panel(img, app, t)


# ════════════════════════════════════════════════════════════════════════
# 1. MOMOS — Family command center
# ════════════════════════════════════════════════════════════════════════

def scene_momos(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)

    # Title (top)
    title_progress = frame_progress(t, 0.0, 1.0)
    title_y = 80
    if title_progress > 0.05:
        # Centered title
        title = "MOMOS"
        font = load_font(56, bold=True)
        bbox = draw.textbbox((0, 0), title, font=font)
        tw = bbox[2] - bbox[0]
        x = (W - tw) // 2 - bbox[0]
        draw.text((x, title_y), title, fill=WHITE, font=font)
        # Subtitle
        sub = "TODAY  •  SUNDAY  JUNE 14"
        sf = load_font(14, bold=True)
        sb = draw.textbbox((0, 0), sub, font=sf)
        sw = sb[2] - sb[0]
        sx = (W - sw) // 2 - sb[0]
        draw.text((sx, title_y + 70), sub, fill=DIM, font=sf)

    # Four dashboard widget cards (2x2)
    cards = [
        # (col, row, title, icon_letter, content_lines, accent)
        (0, 0, "TODAY",     "C", ["Pizza night", "6:00 PM", "Family dinner"],         (251, 191, 36)),
        (1, 0, "INBOX",     "M", ["Permission slip", "due Friday", "— Mrs. Allen"],     (74, 222, 128)),
        (0, 1, "PANTRY",    "P", ["Low: Milk", "Low: Eggs", "Low: Bread"],             (244, 114, 182)),
        (1, 1, "REMINDERS", "R", ["Pick up Emma", "3:15 PM", "Library"],               (96, 165, 250)),
    ]
    grid_left, grid_top = 160, 200
    card_w, card_h = 480, 200
    gap = 20

    for col, row, title, icon, lines, accent in cards:
        # Each card slides in from its corner with stagger
        start = 1.0 + (col + row * 2) * 0.25
        end = start + 0.8
        p = frame_progress(t, start, end)
        if p <= 0:
            continue
        e = ease_out_back(p, overshoot=1.1)
        cx = grid_left + col * (card_w + gap)
        cy = grid_top + row * (card_h + gap)
        # Start offset
        ox = (-card_w - 100) if col == 0 else (W - cx + 100)
        oy = (-card_h - 100) if row == 0 else (H - cy + 100)
        x = int(lerp(cx + ox, cx, e))
        y = int(lerp(cy + oy, cy, e))

        draw_panel(img, x, y, card_w, card_h, title=title, accent=accent)
        # Icon monogram — letter in a colored circle on the left
        icon_cx = x + 50
        icon_cy = y + 110
        icon_r = 26
        # Circle bg
        circle_bg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        cd = ImageDraw.Draw(circle_bg)
        cd.ellipse(
            [(icon_cx - icon_r, icon_cy - icon_r), (icon_cx + icon_r, icon_cy + icon_r)],
            fill=(*accent, 50),
        )
        cd.ellipse(
            [(icon_cx - icon_r, icon_cy - icon_r), (icon_cx + icon_r, icon_cy + icon_r)],
            outline=accent, width=2,
        )
        img_rgba = img.convert("RGBA")
        img_rgba.alpha_composite(circle_bg)
        img.paste(img_rgba.convert("RGB"))
        draw = ImageDraw.Draw(img)
        # Letter
        icon_font = load_font(28, bold=True)
        bbox = draw.textbbox((0, 0), icon, font=icon_font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((icon_cx - tw // 2 - bbox[0], icon_cy - th // 2 - bbox[1] - 1), icon, fill=accent, font=icon_font)
        # Content lines
        line_font = load_font(18, bold=True)
        for i, line in enumerate(lines):
            line_p = frame_progress(t, end + 0.15 * i, end + 0.15 * i + 0.5)
            if line_p <= 0:
                continue
            alpha = line_p
            color = WHITE if i == 0 else GREY
            # Fade in by blending toward BG
            blended = lerp_color(BG_PANEL, color, alpha)
            draw.text((x + 90, y + 50 + i * 28), line, fill=blended, font=line_font)
        # Live pulse indicator in top-right
        if t > end + 0.5:
            pulse_t = (t - (end + 0.5)) * 2
            pulse = 0.4 + 0.6 * (0.5 + 0.5 * math.sin(pulse_t))
            dot_color = tuple(int(c * pulse) for c in accent)
            draw.ellipse([(x + card_w - 18, y + 13), (x + card_w - 12, y + 19)], fill=dot_color)

    # "Live" notification: a new reminder slides in at the bottom around t=8
    if 8.0 < t < 14.0:
        nt = (t - 8.0) / 6.0
        slide_x = int(lerp(W + 200, 200, ease_out_cubic(min(nt, 1.0))))
        ny = 620
        nw, nh = 880, 44
        if slide_x < W:
            draw_panel(img, slide_x, ny, nw, nh)
            # Bell-like icon (R for reminder in a circle)
            icon_font = load_font(18, bold=True)
            draw.text((slide_x + 14, ny + 12), "[!] NEW REMINDER", fill=AMBER, font=icon_font)
            txt_font = load_font(16, bold=False)
            draw.text((slide_x + 170, ny + 14), "Emma's science fair — tomorrow 9:00 AM", fill=WHITE, font=txt_font)


def _lerp_c(a, b, t):
    """Lerp a single color channel (int) toward a color (tuple).

    `a` is an int (a channel value), `b` is a 3-tuple, and the
    function returns the lerped value of the matching channel.
    """
    if isinstance(a, (tuple, list)):
        return tuple(lerp(av, bv, t) for av, bv in zip(a, b))
    # `a` is a scalar; we need to know which channel of `b` it belongs to.
    # We can't know that, so this function is meant to be called via
    # `tuple(_lerp_c(c, b, t) for c in a)` where `a` is a color tuple.
    raise TypeError("Use lerp_color for full-color blends, or call via tuple(...)")


# ════════════════════════════════════════════════════════════════════════
# 2. PARAMBULATOR — Seating chart planner
# ════════════════════════════════════════════════════════════════════════

def scene_parambulator(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    title = "PARAMBULATOR"
    _draw_centered_title(draw, title, 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "5×6 LAYOUT  •  MRS. CHEN  •  3RD PERIOD", 145, t, 0.4, 1.2)

    # 5 columns × 6 rows of student seats
    students = [
        "Ava M.", "Ben K.", "Cal R.", "Dee S.", "Eli T.",
        "Fay W.", "Gus P.", "Hana O.", "Ivy L.", "Jon F.",
        "Kim N.", "Lou B.", "Mia D.", "Ned G.", "Oma H.",
        "Pip C.", "Quin J.", "Rey V.", "Sam X.", "Tia Z.",
        "Una K.", "Val M.", "Wes P.", "Xan Q.", "Yuki R.",
        "Zoe E.", "Ari B.", "Bex C.", "Cory D.", "Drew F.",
    ]
    # Mark a few with hard constraints (e.g. IEP, allergy)
    constraints = {3: "IEP", 8: "504", 14: "ALLERGY", 19: "IEP", 22: "VISION", 28: "ALLERGY"}

    grid_left = 195
    grid_top = 200
    cell_w, cell_h = 145, 64
    gap = 8
    cols, rows = 5, 6

    # Header: column labels
    if t > 0.6:
        lab = load_font(11, bold=True)
        for c in range(cols):
            x = grid_left + c * (cell_w + gap) + cell_w // 2
            text = f"COL {c + 1}"
            bbox = draw.textbbox((0, 0), text, font=lab)
            tw = bbox[2] - bbox[0]
            draw.text((x - tw // 2 - bbox[0], 188), text, fill=DIM, font=lab)

    # Cells (appear with stagger)
    for idx in range(cols * rows):
        r = idx // cols
        c = idx % cols
        cell_start = 1.0 + idx * 0.04
        cell_end = cell_start + 0.5
        p = frame_progress(t, cell_start, cell_end)
        if p <= 0:
            continue
        e = ease_out_cubic(p)
        x = grid_left + c * (cell_w + gap)
        y = grid_top + r * (cell_h + gap)
        # Pop in
        scale = pop_scale(t, cell_start, cell_end)
        # Slide from above
        sy = int(lerp(y - 80, y, e))
        x0, y0, x1, y1 = x, sy, x + cell_w, sy + cell_h
        # Seat card
        seat_color = (16, 22, 38) if idx not in constraints else (32, 22, 38)
        draw.rounded_rectangle([(x0, y0), (x1, y1)], radius=4, fill=seat_color)
        # Border
        border = (60, 75, 95) if idx not in constraints else (100, 60, 80)
        draw.rounded_rectangle([(x0, y0), (x1, y1)], radius=4, outline=border, width=1)
        # Seat number
        sn_font = load_font(9, bold=True)
        draw.text((x0 + 8, y0 + 6), f"R{idx + 1:02d}", fill=DIM, font=sn_font)
        # Student name
        name_font = load_font(15, bold=True)
        draw.text((x0 + 8, y0 + 22), students[idx], fill=WHITE, font=name_font)
        # Constraint badge
        if idx in constraints:
            b_font = load_font(9, bold=True)
            tag = constraints[idx]
            tb = draw.textbbox((0, 0), tag, font=b_font)
            tw = tb[2] - tb[0]
            bx0 = x1 - tw - 16
            by0 = y0 + 6
            draw.rounded_rectangle(
                [(bx0, by0), (bx0 + tw + 8, by0 + 13)],
                radius=2, fill=(180, 60, 90),
            )
            draw.text((bx0 + 4, by0 + 1), tag, fill=WHITE, font=b_font)

    # Fitness score: counts up after the grid
    if t > 6.0:
        score_t = clamp01((t - 6.0) / 2.0)
        score = 0.62 + (0.87 - 0.62) * ease_out_cubic(score_t)
        panel_x, panel_y = 1020, 200
        panel_w, panel_h = 220, 110
        draw_panel(img, panel_x, panel_y, panel_w, panel_h, title="FITNESS")
        big_font = load_font(40, bold=True)
        score_text = f"{score:.2f}"
        bbox = draw.textbbox((0, 0), score_text, font=big_font)
        tw = bbox[2] - bbox[0]
        draw.text((panel_x + (panel_w - tw) // 2 - bbox[0], panel_y + 45), score_text, fill=GREEN, font=big_font)
        # Mini label
        lf = load_font(10, bold=True)
        label = "CONSTRAINT FIT"
        lb = draw.textbbox((0, 0), label, font=lf)
        lw = lb[2] - lb[0]
        draw.text((panel_x + (panel_w - lw) // 2 - lb[0], panel_y + 95), label, fill=DIM, font=lf)

    # Swap animation between two seats (8-11s)
    if 8.0 < t < 11.0:
        s_t = (t - 8.0) / 3.0
        a_idx, b_idx = 7, 12  # Hana O. and Mia D.
        a_r, a_c = a_idx // cols, a_idx % cols
        b_r, b_c = b_idx // cols, b_idx % cols
        a_x = grid_left + a_c * (cell_w + gap)
        a_y = grid_top + a_r * (cell_h + gap)
        b_x = grid_left + b_c * (cell_w + gap)
        b_y = grid_top + b_r * (cell_h + gap)
        if s_t < 0.5:
            e = ease_out_cubic(s_t * 2)
            a_now = (a_x + (b_x - a_x) * e, a_y)
            b_now = (b_x + (a_x - b_x) * e, b_y)
        else:
            e = ease_out_cubic((s_t - 0.5) * 2)
            a_now = (b_x + (a_x - b_x) * e, a_y)
            b_now = (a_x + (b_x - a_x) * e, b_y)
        # Draw ghost cards at the moving positions
        for (px, py), name, mark in [(a_now, students[a_idx], a_idx in constraints),
                                       (b_now, students[b_idx], b_idx in constraints)]:
            color = (16, 22, 38) if not mark else (32, 22, 38)
            border = (60, 75, 95) if not mark else (100, 60, 80)
            draw.rounded_rectangle([(px, py), (px + cell_w, py + cell_h)], radius=4, fill=color, outline=border, width=1)
            nf = load_font(15, bold=True)
            draw.text((px + 8, py + 22), name, fill=WHITE, font=nf)


def _draw_centered_title(draw, text, y, t, start, end):
    p = frame_progress(t, start, end)
    if p <= 0.05:
        return
    e = ease_out_cubic(p)
    font = load_font(56, bold=True)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    x = (W - tw) // 2 - bbox[0]
    color = lerp_color(BG, WHITE, e)
    draw.text((x + 2, y + 2), text, fill=(0, 0, 0), font=font)
    draw.text((x, y), text, fill=color, font=font)


def _draw_centered_subtitle(draw, text, y, t, start, end):
    p = frame_progress(t, start, end)
    if p <= 0:
        return
    e = ease_out_cubic(p)
    font = load_font(13, bold=True)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    x = (W - tw) // 2 - bbox[0]
    color = lerp_color(BG, DIM, e)
    draw.text((x, y), text, fill=color, font=font)


# ════════════════════════════════════════════════════════════════════════
# 3. SUB DAY GENERATOR — Printed lesson plan
# ════════════════════════════════════════════════════════════════════════

def scene_sub_day_generator(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "SUB DAY GENERATOR", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "MRS. CHEN  •  ROOM 204  •  GRADE 4", 145, t, 0.4, 1.2)

    # The "paper" — a tall light card on a dark surface
    paper_x, paper_y = 240, 180
    paper_w, paper_h = 800, 460
    if t < 1.0:
        return
    # Paper slides up from below
    pp = frame_progress(t, 1.0, 2.5)
    py_offset = int(lerp(paper_h + 100, 0, ease_out_cubic(pp)))
    px0 = paper_x
    py0 = paper_y + py_offset

    # Paper surface
    paper_fill = (235, 232, 220)  # warm off-white
    draw.rounded_rectangle(
        [(px0, py0), (px0 + paper_w, py0 + paper_h)],
        radius=4, fill=paper_fill,
    )
    # Subtle paper grain
    for gy in range(py0 + 4, py0 + paper_h - 4, 6):
        draw.line([(px0 + 8, gy), (px0 + paper_w - 8, gy)], fill=(220, 215, 200), width=1)
    # Left margin line
    draw.line(
        [(px0 + 50, py0 + 8), (px0 + 50, py0 + paper_h - 8)],
        fill=(220, 90, 90), width=1,
    )

    if py_offset > 0:
        return  # Still sliding in

    # Header block
    h_f = load_font(22, bold=True)
    date_f = load_font(13, bold=False)
    dark = (40, 50, 70)
    mid = (80, 90, 110)
    light = (140, 145, 160)

    h_text = "Sub Day Plan"
    draw.text((px0 + 70, py0 + 20), h_text, fill=dark, font=h_f)
    d_text = "Sunday, June 14, 2026"
    draw.text((px0 + 70, py0 + 50), d_text, fill=mid, font=date_f)
    # Divider
    draw.line([(px0 + 70, py0 + 80), (px0 + paper_w - 30, py0 + 80)], fill=(180, 175, 165), width=1)

    # Three sections: MORNING, MIDDAY, AFTERNOON
    sections = [
        ("MORNING",   "8:30 – 11:00", ["Math worksheet (20 min)", "Silent reading (15 min)", "Recess (10 min)", "Group science activity (25 min)"]),
        ("MIDDAY",    "11:00 – 12:30", ["Lunch in cafeteria", "Outside recess (weather permitting)", "Math quiz (15 min)"]),
        ("AFTERNOON", "12:30 – 2:45",  ["Art project: self-portraits (30 min)", "Library visit (30 min)", "Pack up + dismissal (15 min)"]),
    ]
    section_y = py0 + 100
    for i, (label, time, items) in enumerate(sections):
        # Each section reveals in turn
        sec_start = 2.5 + i * 2.0
        sec_end = sec_start + 1.5
        p = frame_progress(t, sec_start, sec_end)
        if p <= 0:
            break
        # Section label
        if p > 0.4:
            lf = load_font(14, bold=True)
            draw.text((px0 + 70, section_y), label, fill=(180, 90, 60), font=lf)
            tf = load_font(11, bold=False)
            draw.text((px0 + 70, section_y + 18), time, fill=mid, font=tf)
        # Items
        for j, item in enumerate(items):
            item_p = frame_progress(t, sec_start + 0.3 + j * 0.25, sec_start + 0.3 + j * 0.25 + 0.4)
            if item_p <= 0:
                continue
            e = ease_out_cubic(item_p)
            color = lerp_color(mid, dark, e)
            it_f = load_font(13, bold=False)
            draw.text((px0 + 110, section_y + j * 20 + 40), f"- {item}", fill=color, font=it_f)
        section_y += 130

    # Notes
    if t > 9.0:
        nf = load_font(10, bold=True)
        draw.text((px0 + 70, py0 + paper_h - 60), "NOTES  •  Emergency contact: Front office (ext. 200)", fill=light, font=nf)
        draw.text((px0 + 70, py0 + paper_h - 45), "FIRE DRILL  •  10:15 — escort class to field B", fill=light, font=nf)


# ════════════════════════════════════════════════════════════════════════
# 4. VERNISSAGE — Art gallery browser
# ════════════════════════════════════════════════════════════════════════

def scene_vernissage(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "VERNISSAGE", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "THE MET  •  AIC  •  RIJKSMUSEUM", 145, t, 0.4, 1.2)

    # Picture frame
    frame_x, frame_y = 340, 195
    frame_w, frame_h = 600, 360
    if t < 1.0:
        return
    fp = frame_progress(t, 1.0, 2.5)
    if fp <= 0:
        return
    e = ease_out_cubic(fp)
    # Frame scales in
    f_scale = pop_scale(t, 1.0, 2.5)
    cx, cy = W // 2, 375
    fw = int(640 * f_scale)
    fh = int(400 * f_scale)
    fx0 = cx - fw // 2
    fy0 = cy - fh // 2
    fx1 = cx + fw // 2
    fy1 = cy + fh // 2

    # Frame outer (gold-ish)
    draw.rounded_rectangle([(fx0, fy0), (fx1, fy1)], radius=4, fill=(110, 85, 50))
    # Frame inner (matte)
    inset = 14
    draw.rounded_rectangle(
        [(fx0 + inset, fy0 + inset), (fx1 - inset, fy1 - inset)],
        radius=2, fill=(40, 35, 25),
    )
    # Canvas
    canvas_inset = inset + 12
    cx0, cy0 = fx0 + canvas_inset, fy0 + canvas_inset
    cx1, cy1 = fx1 - canvas_inset, fy1 - canvas_inset
    cw, ch = cx1 - cx0, cy1 - cy0

    # A stylized abstract composition (Mondrian-inspired)
    if t > 2.0:
        # Draw 3-4 colored rectangles
        rects = [
            (0.05, 0.05, 0.45, 0.55, (220, 60, 60)),    # red
            (0.55, 0.05, 0.95, 0.30, (240, 220, 90)),  # yellow
            (0.05, 0.65, 0.40, 0.95, (60, 90, 200)),   # blue
            (0.50, 0.65, 0.95, 0.95, (235, 230, 215)), # white
            (0.50, 0.40, 0.95, 0.55, (235, 230, 215)), # white
        ]
        for rx, ry, rrx, rry, color in rects:
            rx0 = cx0 + int(cw * rx)
            ry0 = cy0 + int(ch * ry)
            rx1 = cx0 + int(cw * rrx)
            ry1 = cy0 + int(ch * rry)
            draw.rectangle([(rx0, ry0), (rx1, ry1)], fill=color)
        # Black grid lines
        line_w = 6
        # Horizontal lines
        for fy in [0.05, 0.40, 0.55, 0.65, 0.95]:
            ly = cy0 + int(ch * fy)
            draw.line([(cx0, ly), (cx1, ly)], fill=(20, 20, 20), width=line_w)
        # Vertical lines
        for fx in [0.05, 0.45, 0.50, 0.55, 0.95]:
            lx = cx0 + int(cw * fx)
            draw.line([(lx, cy0), (lx, cy1)], fill=(20, 20, 20), width=line_w)

    # Plaque / metadata below
    if t > 4.0:
        meta = [
            ("TITLE",   "Composition II, in Red, Blue, and Yellow"),
            ("ARTIST",  "Piet Mondrian"),
            ("YEAR",    "1930"),
            ("MEDIUM",  "Oil on canvas"),
        ]
        my = 590
        for i, (k, v) in enumerate(meta):
            ip = frame_progress(t, 4.0 + i * 0.4, 4.0 + i * 0.4 + 0.6)
            if ip <= 0:
                continue
            kf = load_font(11, bold=True)
            vf = load_font(13, bold=False)
            label = f"{k}:"
            x_left = 280 + (i % 2) * 360
            y_pos = my + (i // 2) * 28
            draw.text((x_left, y_pos), label, fill=DIM, font=kf)
            draw.text((x_left + 70, y_pos - 1), v, fill=WHITE, font=vf)

    # Navigation arrows on the sides (pulse)
    if t > 6.0:
        pulse = 0.5 + 0.5 * math.sin((t - 6.0) * 2)
        arr_color = (int(GREEN[0] * pulse), int(GREEN[1] * pulse), int(GREEN[2] * pulse))
        af = load_font(40, bold=True)
        # Left arrow
        lx = frame_x - 30
        ly = 360
        if t > 6.5 and t < 6.9:
            lx -= 5
        draw.text((lx, ly), "‹", fill=arr_color, font=af)
        # Right arrow
        rx = frame_x + frame_w - 10
        if t > 7.0 and t < 7.4:
            rx += 5
        draw.text((rx, ly), "›", fill=arr_color, font=af)
        # "next" hint
        if t > 7.5:
            nf = load_font(11, bold=True)
            draw.text((frame_x + frame_w - 100, frame_y + frame_h + 10), "NEXT  →", fill=DIM, font=nf)


# ════════════════════════════════════════════════════════════════════════
# 5. HOLD'EM TOGETHER — Poker hand
# ════════════════════════════════════════════════════════════════════════

def _draw_playing_card(img, x, y, w, h, rank, suit, face_up=True, accent=WHITE):
    """Draw a playing card. If face_up=False, show a blue card back."""
    draw = ImageDraw.Draw(img)
    # Shadow
    shadow = Image.new("RGBA", (w + 6, h + 6), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([(3, 3), (w + 3, h + 3)], radius=8, fill=(0, 0, 0, 100))
    img.paste(shadow, (x - 3, y - 3), shadow)
    if face_up:
        # Card background
        draw.rounded_rectangle([(x, y), (x + w, y + h)], radius=8, fill=(245, 240, 230))
        # Normalize suit to a single ASCII letter so it renders in
        # every monospace font. Map unicode suit glyphs to letters.
        _SUIT_MAP = {"♥": "H", "♦": "D", "♠": "S", "♣": "C"}
        suit_letter = _SUIT_MAP.get(suit, suit if suit in ("H", "D", "S", "C") else "?")
        is_red = suit_letter in ("H", "D")
        col = (200, 30, 30) if is_red else (30, 30, 30)
        # Top-left rank
        rf = load_font(int(h * 0.28), bold=True)
        draw.text((x + 8, y + 4), rank, fill=col, font=rf)
        # Top-left suit
        sf = load_font(int(h * 0.20), bold=True)
        draw.text((x + 8, y + int(h * 0.30)), suit_letter, fill=col, font=sf)
        # Bottom-right rank
        draw.text((x + w - int(h * 0.32), y + h - int(h * 0.32)), rank, fill=col, font=rf)
        # Center suit (large letter)
        cf = load_font(int(h * 0.45), bold=True)
        cb = draw.textbbox((0, 0), suit_letter, font=cf)
        sw, sh = cb[2] - cb[0], cb[3] - cb[1]
        draw.text((x + (w - sw) // 2 - cb[0], y + (h - sh) // 2 - cb[1]), suit_letter, fill=col, font=cf)
    else:
        # Card back — diagonal pattern
        draw.rounded_rectangle([(x, y), (x + w, y + h)], radius=8, fill=(20, 50, 110))
        draw.rounded_rectangle([(x, y), (x + w, y + h)], radius=8, outline=(220, 220, 240), width=2)
        # Inner frame
        inset = 6
        draw.rounded_rectangle(
            [(x + inset, y + inset), (x + w - inset, y + h - inset)],
            radius=4, outline=(220, 220, 240), width=1,
        )
        # Diamond pattern
        for dy in range(y + inset + 4, y + h - inset - 4, 10):
            for dx in range(x + inset + 4, x + w - inset - 4, 10):
                draw.polygon(
                    [(dx, dy - 3), (dx + 3, dy), (dx, dy + 3), (dx - 3, dy)],
                    fill=(40, 70, 130),
                )


def scene_holdem_together(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "LET'S HOLD 'EM TOGETHER", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "BLINDS 25/50  •  4 PLAYERS  •  ROUND 3", 145, t, 0.4, 1.2)

    # Poker table (oval felt)
    table_x, table_y = 180, 200
    table_w, table_h = 920, 380
    if t < 1.0:
        return
    # Table appears
    tp = frame_progress(t, 1.0, 2.5)
    e = ease_out_cubic(tp)
    # Scale up
    scale = pop_scale(t, 1.0, 2.5)
    cx, cy = W // 2, table_y + table_h // 2
    tw = int(table_w * scale)
    th = int(table_h * scale)
    tx0, ty0 = cx - tw // 2, cy - th // 2
    tx1, ty1 = cx + tw // 2, cy + th // 2
    # Felt (dark green)
    draw.ellipse([(tx0, ty0), (tx1, ty1)], fill=(28, 80, 50))
    # Rail
    rail = 8
    draw.ellipse(
        [(tx0 - rail, ty0 - rail), (tx1 + rail, ty1 + rail)],
        fill=(40, 25, 15),
    )
    draw.ellipse([(tx0, ty0), (tx1, ty1)], outline=(80, 50, 30), width=2)
    if scale < 0.7:
        return

    # Center: pot + community cards
    pot_y = ty0 + int(th * 0.45)
    # Pot label
    if t > 3.0:
        pf = load_font(11, bold=True)
        pot_label = "POT"
        bbox = draw.textbbox((0, 0), pot_label, font=pf)
        tw_label = bbox[2] - bbox[0]
        draw.text((cx - tw_label // 2 - bbox[0], pot_y - 30), pot_label, fill=DIM, font=pf)
        # Pot amount (counts up)
        amt_t = frame_progress(t, 3.5, 5.5)
        amt = int(lerp(0, 240, ease_out_cubic(amt_t)))
        af = load_font(28, bold=True)
        amt_text = f"${amt}"
        bbox = draw.textbbox((0, 0), amt_text, font=af)
        tw_amt = bbox[2] - bbox[0]
        draw.text((cx - tw_amt // 2 - bbox[0], pot_y - 22), amt_text, fill=GREEN, font=af)

    # Community cards (deal at 3.5-5.5s)
    community = [("A", "♠"), ("K", "♥"), ("Q", "♦"), ("J", "♣"), ("10", "♠")]
    if t > 3.5:
        # 3 cards visible as the flop
        for i in range(3):
            deal_t = (t - 3.5 - i * 0.3)
            if deal_t < 0:
                continue
            dealt = clamp01(deal_t / 0.4)
            cw, ch = 70, 100
            base_x = cx - int(cw * 1.5) - 10 + i * (cw + 8)
            base_y = pot_y + 30
            # Slide in from above-right (dealer's perspective)
            dx = base_x - int(200 * (1 - dealt))
            dy = base_y - int(120 * (1 - dealt))
            _draw_playing_card(img, dx, dy, cw, ch, community[i][0], community[i][1])

    # Player's 2 hole cards (deal at 2.5-3.0s)
    if t > 2.5:
        for i in range(2):
            dealt = clamp01((t - 2.5 - i * 0.2) / 0.4)
            cw, ch = 70, 100
            base_x = cx - cw - 5 + i * (cw + 10)
            base_y = ty1 - ch - 40
            dx = base_x - int(180 * (1 - dealt))
            _draw_playing_card(img, dx, base_y, cw, ch, ("7", "♠")[i], ("♠", "♠")[i])

    # Opponent's 2 cards (face down, deal at 3.0-3.4s)
    if t > 3.0:
        for i in range(2):
            dealt = clamp01((t - 3.0 - i * 0.2) / 0.4)
            cw, ch = 70, 100
            base_x = cx - cw - 5 + i * (cw + 10)
            base_y = ty0 + 30
            dx = base_x - int(180 * (1 - dealt))
            _draw_playing_card(img, dx, base_y, cw, ch, "?", "?", face_up=False)

    # "YOUR TURN" pulsing indicator
    if t > 6.0:
        pulse = 0.5 + 0.5 * math.sin((t - 6.0) * 3)
        txt = "▶ YOUR TURN"
        tf = load_font(18, bold=True)
        bbox = draw.textbbox((0, 0), txt, font=tf)
        tw_txt = bbox[2] - bbox[0]
        y_txt = ty1 + 20
        # Backing pill
        pad_x, pad_y = 16, 8
        bw = tw_txt + pad_x * 2
        bh = 30
        bx = cx - bw // 2
        col = tuple(int(c * (0.3 + 0.7 * pulse)) for c in GREEN)
        draw.rounded_rectangle(
            [(bx, y_txt), (bx + bw, y_txt + bh)],
            radius=4, outline=col, width=2,
        )
        draw.text((bx + pad_x, y_txt + pad_y - 3), txt, fill=GREEN, font=tf)


# ════════════════════════════════════════════════════════════════════════
# 6. CODE REVIEWDLE — Code review puzzle
# ════════════════════════════════════════════════════════════════════════

def scene_code_reviewdle(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "CODE REVIEWDLE", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "DAILY PUZZLE  •  REVIEW #142  •  TS / 6 LINES", 145, t, 0.4, 1.2)

    # Code editor panel
    ed_x, ed_y = 140, 195
    ed_w, ed_h = 1000, 320
    if t < 1.0:
        return
    draw_panel(img, ed_x, ed_y, ed_w, ed_h, title="REVIEW  •  PR #4827", accent=(96, 165, 250))

    # Code lines: each entry is (line_number, [(text, color), ...])
    # The subtle bug: `t` is checked after assignment on the same expression
    # — the `&&` short-circuits but the first `t` references the OLD value.
    code_lines = [
        ("01", [("function ", (200, 200, 200)), ("debounce", (130, 180, 255)), ("(fn, ms) {", (200, 200, 200))]),
        ("02", [("  let ",    (200, 200, 200)), ("t", (255, 200, 100)), (";", (200, 200, 200))]),
        ("03", [("  return ", (200, 200, 200)), ("(...args)", (130, 255, 180)), (" => {", (200, 200, 200))]),
        ("04", [("    ",      (200, 200, 200)), ("t", (255, 200, 100)), (" && clearTimeout(t);", (200, 200, 200))]),
        ("05", [("    ",      (200, 200, 200)), ("t", (255, 200, 100)), (" = setTimeout(fn, ms);", (200, 200, 200))]),
        ("06", [("  };",      (200, 200, 200))]),
        ("07", [("}",         (200, 200, 200))]),
    ]
    code_font = load_font(14, bold=False)
    line_h = 28
    line_x0 = ed_x + 16
    line_y0 = ed_y + 50
    for i, (line_num, segments) in enumerate(code_lines):
        line_p = frame_progress(t, 1.0 + i * 0.18, 1.0 + i * 0.18 + 0.4)
        if line_p <= 0:
            continue
        # Line number
        nf = load_font(11, bold=True)
        ln_color = (100, 110, 130)
        draw.text((line_x0, line_y0 + i * line_h), line_num, fill=ln_color, font=nf)
        # Code text
        x = line_x0 + 38
        for seg, color in segments:
            if not seg:
                continue
            draw.text((x, line_y0 + i * line_h), seg, fill=color, font=code_font)
            sb = draw.textbbox((0, 0), seg, font=code_font)
            x += sb[2] - sb[0]

    # Bug indicator: a glowing line under line 4 (the bug is `t` should be checked before use)
    if t > 4.5:
        bp = frame_progress(t, 4.5, 5.5)
        e = ease_out_cubic(bp)
        bug_y = line_y0 + 3 * line_h + 22
        bug_w = int(640 * e)
        bug_color = (255, 90, 90)
        for ox in range(-1, 2):
            for oy in range(-1, 2):
                draw.line(
                    [(line_x0 + 38 + ox, bug_y + oy), (line_x0 + 38 + bug_w + ox, bug_y + oy)],
                    fill=(*bug_color, 60), width=1,
                )
        draw.line(
            [(line_x0 + 38, bug_y), (line_x0 + 38 + bug_w, bug_y)],
            fill=bug_color, width=2,
        )
        # Label
        if bp > 0.7:
            lf = load_font(10, bold=True)
            lbl = "BUG"
            lb = draw.textbbox((0, 0), lbl, font=lf)
            lw = lb[2] - lb[0]
            draw.text((line_x0 + 38 + bug_w + 6, bug_y - 12), lbl, fill=bug_color, font=lf)

    # Guess slots below
    if t > 5.5:
        slot_y = 555
        slot_size = 50
        slot_gap = 6
        total_w = 6 * slot_size + 5 * slot_gap
        slot_x0 = (W - total_w) // 2
        guess = "STALE T"
        reveal_n = 0
        if t > 6.0:
            reveal_n = int(clamp01((t - 6.0) / 3.0) * len(guess))
        for i in range(6):
            x = slot_x0 + i * (slot_size + slot_gap)
            filled = i < reveal_n
            char = guess[i] if i < len(guess) else ""
            border = GREEN if filled else (80, 90, 110)
            fill = (28, 40, 32) if filled else (16, 22, 38)
            draw.rounded_rectangle(
                [(x, slot_y), (x + slot_size, slot_y + slot_size)],
                radius=4, fill=fill, outline=border, width=2,
            )
            if filled:
                cf = load_font(28, bold=True)
                cb = draw.textbbox((0, 0), char, font=cf)
                tw = cb[2] - cb[0]
                th = cb[3] - cb[1]
                draw.text((x + (slot_size - tw) // 2 - cb[0], slot_y + (slot_size - th) // 2 - cb[1]),
                          char, fill=GREEN, font=cf)
        # Label
        lf = load_font(11, bold=True)
        lbl = "GUESS THE BUG"
        lb = draw.textbbox((0, 0), lbl, font=lf)
        lw = lb[2] - lb[0]
        draw.text((W // 2 - lw // 2 - lb[0], slot_y - 22), lbl, fill=DIM, font=lf)

    # Reveal: a checkmark on success
    if t > 12.0:
        pulse = 0.6 + 0.4 * math.sin((t - 12.0) * 3)
        col = tuple(int(c * pulse) for c in GREEN)
        cf = load_font(20, bold=True)
        txt = "✓ CORRECT"
        bbox = draw.textbbox((0, 0), txt, font=cf)
        tw = bbox[2] - bbox[0]
        draw.text((W // 2 - tw // 2 - bbox[0], 620), txt, fill=col, font=cf)


# ════════════════════════════════════════════════════════════════════════
# 7. CONWAY'S GAME OF WAR — Cellular automaton
# ════════════════════════════════════════════════════════════════════════

def scene_conway_war(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "CONWAY'S GAME OF WAR", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "BATTLE OF THE CELLULAR AUTOMATA", 145, t, 0.4, 1.2)

    # Grid
    grid_x, grid_y = 180, 195
    cell_size = 32
    grid_w, grid_h = 30, 14
    if t < 1.0:
        return

    # Initial seed pattern: two teams (red + blue) + some neutrals
    red_team = {
        (3, 2), (3, 3), (3, 4), (3, 5), (4, 3), (4, 4), (4, 5), (5, 4),
        (3, 8), (3, 9), (3, 10), (3, 11), (4, 8), (4, 9), (4, 10), (5, 9),
    }
    blue_team = {
        (24, 5), (24, 6), (24, 7), (24, 8), (25, 6), (25, 7), (25, 8), (26, 7),
        (24, 11), (24, 12), (24, 13), (25, 11), (25, 12), (25, 13), (26, 12),
    }
    # Simulate a few generations deterministically
    def step(cells):
        new_cells = set()
        for y in range(grid_h):
            for x in range(grid_w):
                neighbors = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dy == 0 and dx == 0:
                            continue
                        if (x + dx, y + dy) in cells:
                            neighbors += 1
                alive = (x, y) in cells
                if alive and neighbors in (2, 3):
                    new_cells.add((x, y))
                elif not alive and neighbors == 3:
                    new_cells.add((x, y))
        return new_cells

    # Choose which generation to show based on time
    if t < 2.5:
        gen = 0
        cells = red_team | blue_team
    else:
        gen_idx = int((t - 2.5) / 0.7)
        gen_idx = min(gen_idx, 6)
        cells = red_team | blue_team
        for _ in range(gen_idx):
            cells = step(cells)
        gen = gen_idx

    # Draw cells
    for x, y in cells:
        is_red = any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in red_team)
        is_blue = any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in blue_team)
        if is_red and not is_blue:
            color = (220, 60, 60)
        elif is_blue and not is_red:
            color = (60, 100, 220)
        else:
            color = (160, 100, 200)
        x0 = grid_x + x * cell_size
        y0 = grid_y + y * cell_size
        # Cell with subtle glow
        draw.rectangle(
            [(x0, y0), (x0 + cell_size - 2, y0 + cell_size - 2)],
            fill=color,
        )
        # Slight inner shading
        draw.rectangle(
            [(x0, y0), (x0 + cell_size - 2, y0 + 3)],
            fill=tuple(min(255, c + 40) for c in color),
        )

    # Draw grid overlay
    for gx in range(grid_w + 1):
        x = grid_x + gx * cell_size
        draw.line([(x, grid_y), (x, grid_y + grid_h * cell_size)], fill=(30, 40, 55), width=1)
    for gy in range(grid_h + 1):
        y = grid_y + gy * cell_size
        draw.line([(grid_x, y), (grid_x + grid_w * cell_size, y)], fill=(30, 40, 55), width=1)
    # Outer border
    draw.rectangle(
        [(grid_x - 1, grid_y - 1), (grid_x + grid_w * cell_size + 1, grid_y + grid_h * cell_size + 1)],
        outline=(60, 75, 95), width=2,
    )

    # Stats panel
    if t > 2.0:
        red_count = sum(1 for x, y in cells if any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in red_team) and not any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in blue_team))
        blue_count = sum(1 for x, y in cells if any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in blue_team) and not any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in red_team))
        neutral = len(cells) - red_count - blue_count
        sp_x, sp_y = 1020, 200
        sp_w, sp_h = 220, 130
        draw_panel(img, sp_x, sp_y, sp_w, sp_h, title="STATS")
        sf = load_font(11, bold=True)
        vf = load_font(20, bold=True)
        draw.text((sp_x + 14, sp_y + 40), "GEN", fill=DIM, font=sf)
        gen_text = f"{gen:03d}"
        draw.text((sp_x + 80, sp_y + 38), gen_text, fill=WHITE, font=vf)
        draw.text((sp_x + 14, sp_y + 70), "RED", fill=DIM, font=sf)
        draw.text((sp_x + 80, sp_y + 68), str(red_count), fill=(220, 60, 60), font=vf)
        draw.text((sp_x + 14, sp_y + 100), "BLUE", fill=DIM, font=sf)
        draw.text((sp_x + 80, sp_y + 98), str(blue_count), fill=(60, 100, 220), font=vf)

    # Bottom: territory bar
    if t > 2.5:
        total = len(cells) or 1
        red_pct = sum(1 for x, y in cells if any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in red_team)) / total
        blue_pct = sum(1 for x, y in cells if any(abs(x - rx) + abs(y - ry) < 5 for rx, ry in blue_team)) / total
        bar_x, bar_y = 200, 620
        bar_w, bar_h = 880, 18
        # Background
        draw.rounded_rectangle(
            [(bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h)],
            radius=4, fill=(24, 32, 48), outline=(60, 75, 95), width=1,
        )
        # Red portion
        red_w = int(bar_w * red_pct)
        draw.rectangle([(bar_x, bar_y), (bar_x + red_w, bar_y + bar_h)], fill=(180, 50, 50))
        # Blue portion
        blue_w = int(bar_w * blue_pct)
        draw.rectangle([(bar_x + bar_w - blue_w, bar_y), (bar_x + bar_w, bar_y + bar_h)], fill=(50, 80, 200))
        # Labels
        lf = load_font(10, bold=True)
        draw.text((bar_x, bar_y - 18), f"RED  {red_pct * 100:.0f}%", fill=(220, 100, 100), font=lf)
        draw.text((bar_x + bar_w - 80, bar_y - 18), f"{blue_pct * 100:.0f}%  BLUE", fill=(100, 140, 240), font=lf)


# ════════════════════════════════════════════════════════════════════════
# 8 & 9. WIZARD FIGHT — Spell duel
# ════════════════════════════════════════════════════════════════════════

def scene_wizard_fight(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "WIZARD FIGHT", 80, t, 0.0, 1.0)
    if app.id == "wizard-fight-ui":
        _draw_centered_subtitle(draw, "REACT FRONTEND  •  v2.1.0", 145, t, 0.4, 1.2)
    else:
        _draw_centered_subtitle(draw, "REAL-TIME DUELING  •  FLASK + SOCKETIO", 145, t, 0.4, 1.2)

    # Two wizard portraits
    if t < 1.0:
        return
    wiz_w, wiz_h = 240, 320

    # Wizard 1 (left) — Alatar
    a_scale = pop_scale(t, 1.0, 2.0)
    ax = 200
    ay = 200
    if a_scale > 0.05:
        _draw_wizard_card(img, ax, ay, wiz_w, wiz_h, "ALATAR", "Pyromancer",
                          hp_progress=0.75 if t < 9.0 else max(0.45, 0.75 - 0.3 * ((t - 9.0) / 1.5)),
                          accent=(240, 80, 50), scale=a_scale, side="left")
    # Wizard 2 (right) — Lyra
    b_scale = pop_scale(t, 1.2, 2.2)
    bx = W - 200 - wiz_w
    by = 200
    if b_scale > 0.05:
        _draw_wizard_card(img, bx, by, wiz_w, wiz_h, "LYRA", "Cryomancer",
                          hp_progress=0.85 if t < 9.0 else max(0.40, 0.85 - 0.45 * ((t - 9.0) / 1.5)),
                          accent=(80, 180, 240), scale=b_scale, side="right")

    # Spell cast animation in the middle
    if 4.5 < t < 9.0:
        spell_t = (t - 4.5) / 4.5
        # Energy lines from each wizard toward center
        cx, cy = W // 2, 360
        # Charging phase
        if spell_t < 0.5:
            cp = spell_t * 2
            for i in range(6):
                phase = cp * math.pi * 2 + i
                ax_p = lerp(ax + 100, cx, ease_out_cubic(cp))
                ay_p = lerp(ay + 200, cy, ease_out_cubic(cp))
                bx_p = lerp(bx + 140, cx, ease_out_cubic(cp))
                by_p = lerp(by + 200, cy, ease_out_cubic(cp))
                # Draw small energy dots
                pulse = 0.5 + 0.5 * math.sin(phase * 3)
                size = int(4 + 4 * pulse)
                draw.ellipse(
                    [(int(ax_p) - size, int(ay_p) - size), (int(ax_p) + size, int(ay_p) + size)],
                    fill=(int(240 * pulse), int(80 * pulse), int(50 * pulse)),
                )
                draw.ellipse(
                    [(int(bx_p) - size, int(by_p) - size), (int(bx_p) + size, int(by_p) + size)],
                    fill=(int(80 * pulse), int(180 * pulse), int(240 * pulse)),
                )
        # Impact phase
        else:
            ip = (spell_t - 0.5) * 2
            # Explosion at center
            radius = int(60 + 30 * math.sin(ip * math.pi))
            for ring in range(3):
                r = radius - ring * 8
                if r > 0:
                    alpha = max(0, 1 - ip) * (1 - ring * 0.2)
                    col = (int(255 * alpha), int(180 * alpha), int(60 * alpha))
                    draw.ellipse(
                        [(cx - r, cy - r), (cx + r, cy + r)],
                        outline=col, width=2,
                    )
            # Spell name
            if ip > 0.3:
                nf = load_font(28, bold=True)
                spell_text = "FROST BOLT"
                bbox = draw.textbbox((0, 0), spell_text, font=nf)
                tw = bbox[2] - bbox[0]
                fade = clamp01((ip - 0.3) / 0.3) * clamp01((1 - ip) * 2)
                col = tuple(int(c * fade) for c in (160, 220, 255))
                draw.text((cx - tw // 2 - bbox[0], cy + 80), spell_text, fill=col, font=nf)
            # Damage number
            if ip > 0.5:
                df = load_font(42, bold=True)
                dmg_text = "-18"
                bbox = draw.textbbox((0, 0), dmg_text, font=df)
                tw = bbox[2] - bbox[0]
                y_offset = int(-30 * (ip - 0.5) * 2)
                fade = clamp01(1 - (ip - 0.5) * 2)
                col = tuple(int(c * fade) for c in (255, 200, 80))
                draw.text((bx + 120 - tw // 2 - bbox[0], 280 + y_offset), dmg_text, fill=col, font=df)

    # "Cast a spell" prompt
    if t > 10.0:
        pulse = 0.5 + 0.5 * math.sin((t - 10.0) * 2)
        prompt = "PRESS  1  ·  2  ·  3  TO CAST"
        pf = load_font(14, bold=True)
        bbox = draw.textbbox((0, 0), prompt, font=pf)
        tw = bbox[2] - bbox[0]
        col = tuple(int(c * (0.5 + 0.5 * pulse)) for c in GREEN)
        draw.text((W // 2 - tw // 2 - bbox[0], 600), prompt, fill=col, font=pf)


def _draw_wizard_card(img, x, y, w, h, name, role, hp_progress, accent, scale, side):
    draw = ImageDraw.Draw(img)
    cx, cy = x + w / 2, y + h / 2
    sw = int(w * scale)
    sh = int(h * scale)
    x0 = int(cx - sw / 2)
    y0 = int(cy - sh / 2)
    x1 = x0 + sw
    y1 = y0 + sh
    # Card
    draw.rounded_rectangle([(x0, y0), (x1, y1)], radius=8, fill=(20, 24, 38), outline=accent, width=2)
    # Header bar with name
    hb = max(0, int(36 * scale))
    if hb > 0:
        draw.rectangle([(x0, y0), (x1, y0 + hb)], fill=(*accent, 200))
        nf = load_font(max(8, int(15 * scale)), bold=True)
        bbox = draw.textbbox((0, 0), name, font=nf)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2 - bbox[0], y0 + max(2, int(8 * scale))), name, fill=WHITE, font=nf)
    # Portrait area (simple geometric: robe + face circle)
    if scale > 0.3:
        portrait_h = int(h * 0.55)
        portrait_w = int(w * 0.7)
        px = cx - portrait_w // 2
        py = y0 + hb + int(10 * scale)
        # Background
        draw.rounded_rectangle(
            [(px, py), (px + portrait_w, py + portrait_h)],
            radius=4, fill=(40, 30, 50),
        )
        # Wizard silhouette: robe (triangle) + face (circle) + hat (triangle)
        robe_h = int(portrait_h * 0.55)
        robe_w = int(portrait_w * 0.7)
        robe_x = cx - robe_w // 2
        robe_y = py + portrait_h - robe_h
        # Robe
        draw.polygon(
            [
                (robe_x, robe_y + robe_h),
                (robe_x + robe_w // 4, robe_y),
                (robe_x + robe_w * 3 // 4, robe_y),
                (robe_x + robe_w, robe_y + robe_h),
            ],
            fill=accent,
        )
        # Face
        face_r = int(portrait_w * 0.18)
        face_cx = cx
        face_cy = py + portrait_h * 0.30
        draw.ellipse(
            [(face_cx - face_r, face_cy - face_r), (face_cx + face_r, face_cy + face_r)],
            fill=(220, 195, 165),
        )
        # Hat
        hat_h = int(portrait_h * 0.45)
        hat_w = int(portrait_w * 0.5)
        hat_x = cx - hat_w // 2
        hat_y = face_cy - face_r - hat_h
        draw.polygon(
            [
                (hat_x, hat_y + hat_h),
                (cx, hat_y),
                (hat_x + hat_w, hat_y + hat_h),
            ],
            fill=accent,
        )
        # Hat brim
        brim_w = int(hat_w * 1.2)
        brim_x = cx - brim_w // 2
        brim_y = hat_y + hat_h - 2
        draw.rectangle([(brim_x, brim_y), (brim_x + brim_w, brim_y + 4)], fill=accent)
        # Star on hat
        if scale > 0.7:
            sf = load_font(max(8, int(14 * scale)), bold=True)
            draw.text((cx - 4, hat_y + int(hat_h * 0.4)), "★", fill=WHITE, font=sf)

    # Role text
    if scale > 0.5:
        rf = load_font(max(8, int(10 * scale)), bold=True)
        bbox = draw.textbbox((0, 0), role, font=rf)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2 - bbox[0], y1 - int(50 * scale)), role, fill=DIM, font=rf)

    # HP bar
    if scale > 0.3:
        hp_y = y1 - int(20 * scale)
        hp_x = x0 + int(12 * scale)
        hp_w = int((w - 24) * scale)
        hp_h = max(2, int(8 * scale))
        # Bar bg
        draw.rounded_rectangle(
            [(hp_x, hp_y), (hp_x + hp_w, hp_y + hp_h)],
            radius=hp_h // 2, fill=(40, 50, 70),
        )
        # Bar fill
        fill_w = int(hp_w * clamp01(hp_progress))
        if fill_w > 0:
            hp_color = GREEN if hp_progress > 0.5 else (AMBER if hp_progress > 0.25 else (220, 60, 60))
            draw.rounded_rectangle(
                [(hp_x, hp_y), (hp_x + fill_w, hp_y + hp_h)],
                radius=hp_h // 2, fill=hp_color,
            )
        # HP label
        if scale > 0.6:
            lf = load_font(max(6, int(8 * scale)), bold=True)
            hp_text = f"HP  {int(hp_progress * 100)}/100"
            draw.text((hp_x, hp_y - int(14 * scale)), hp_text, fill=GREY, font=lf)


# Frontend variant shares wizard-fight scene with role text tweak
scene_wizard_fight_ui = scene_wizard_fight


# ════════════════════════════════════════════════════════════════════════
# 10. TRADING CARDS — TCG deck/hand
# ════════════════════════════════════════════════════════════════════════

def scene_trading_cards(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "SUPER ULTIMATE TCG", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "DECK BUILDER  •  DRAFT MODE  •  ROUND 3", 145, t, 0.4, 1.2)

    if t < 1.0:
        return

    # Deck (left)
    deck_x, deck_y = 160, 280
    deck_w, deck_h = 110, 160
    if t < 2.5:
        # Stack of card backs, slightly offset
        for i in range(5):
            dx = deck_x + i * 2
            dy = deck_y + i * 2
            _draw_tcg_card(img, dx, dy, deck_w, deck_h, "", "", 0, 0, face_up=False, scale=1.0)
        # Deck count
        df = load_font(14, bold=True)
        draw.text((deck_x, deck_y + deck_h + 16), "DECK  •  32", fill=DIM, font=df)
    else:
        # Deck shrinks as cards are drawn
        shrink = frame_progress(t, 2.5, 6.0)
        for i in range(5):
            dx = deck_x + i * 2
            dy = deck_y + i * 2
            _draw_tcg_card(img, dx, dy, deck_w, deck_h, "", "", 0, 0, face_up=False, scale=1.0 - 0.4 * shrink)
        # Updated count
        count = max(27, int(32 - 5 * shrink))
        df = load_font(14, bold=True)
        draw.text((deck_x, deck_y + deck_h + 16), f"DECK  •  {count}", fill=DIM, font=df)

    # Hand of 5 cards (fanned out)
    cards = [
        ("Dragon",     "E", 7, 5, (220, 60, 60)),
        ("Sage",       "L", 4, 6, (80, 180, 240)),
        ("Berserker",  "N", 8, 3, (200, 120, 60)),
        ("Sentinel",   "N", 3, 8, (90, 200, 120)),
        ("Mystic",     "R", 5, 5, (180, 100, 200)),
    ]
    hand_cy = 360
    card_w_t, card_h_t = 130, 180
    fan_x0 = 380
    fan_x1 = W - 80
    for i, (name, rarity, atk, hp, color) in enumerate(cards):
        # Cards draw from deck to hand with stagger
        draw_t = 2.5 + i * 0.5
        dp = frame_progress(t, draw_t, draw_t + 0.6)
        if dp <= 0:
            continue
        e = ease_out_cubic(dp)
        # Final position in fan
        fx = fan_x0 + (fan_x1 - fan_x0 - card_w_t) * (i / (len(cards) - 1))
        fy = hand_cy + math.sin((i - 2) * 0.5) * 12 - 30
        # Start at deck
        sx = deck_x + 30
        sy = deck_y + 30
        x = int(lerp(sx, fx, e))
        y = int(lerp(sy, fy, e))
        # Highlight the middle card after 8s
        highlight = (t > 8.0 and i == 2)
        _draw_tcg_card(img, x, y, card_w_t, card_h_t, name, rarity, atk, hp,
                       face_up=True, scale=e, accent=color, highlight=highlight, t=t)


def _draw_tcg_card(img, x, y, w, h, name, rarity, atk, hp, face_up=True, scale=1.0, accent=GREEN, highlight=False, t=0.0):
    draw = ImageDraw.Draw(img)
    if scale < 0.05:
        return
    # Card rect (centered scale)
    cx = x + w / 2
    cy = y + h / 2
    sw = max(2, int(w * scale))
    sh = max(2, int(h * scale))
    x0 = int(cx - sw / 2)
    y0 = int(cy - sh / 2)
    x1 = x0 + sw
    y1 = y0 + sh

    if face_up:
        # Card body
        draw.rounded_rectangle([(x0, y0), (x1, y1)], radius=6, fill=(245, 240, 225), outline=(40, 30, 20), width=2)
        # Inner frame
        inset = max(1, int(4 * scale))
        draw.rounded_rectangle(
            [(x0 + inset, y0 + inset), (x1 - inset, y1 - inset)],
            radius=4, outline=accent, width=2,
        )
        # Top bar (rarity color)
        tb = max(2, int(28 * scale))
        if tb > 0:
            draw.rectangle([(x0 + inset, y0 + inset), (x1 - inset, y0 + inset + tb)], fill=accent)
        # Name
        if scale > 0.4:
            nf = load_font(max(7, int(12 * scale)), bold=True)
            name_short = name[:8]
            bbox = draw.textbbox((0, 0), name_short, font=nf)
            tw = bbox[2] - bbox[0]
            draw.text((cx - tw // 2 - bbox[0], y0 + inset + 6), name_short, fill=WHITE, font=nf)
        # Rarity circle
        if scale > 0.6:
            rcx = x1 - inset - max(6, int(10 * scale))
            rcy = y0 + inset + max(6, int(10 * scale))
            rr = max(3, int(7 * scale))
            draw.ellipse([(rcx - rr, rcy - rr), (rcx + rr, rcy + rr)], fill=(240, 220, 60), outline=(180, 160, 40))
            rf = load_font(max(6, int(8 * scale)), bold=True)
            draw.text((rcx - 3, rcy - 6), rarity, fill=(60, 40, 0), font=rf)
        # Center art placeholder (gradient)
        if scale > 0.5:
            art_x0 = x0 + inset + max(2, int(6 * scale))
            art_y0 = y0 + inset + tb + max(2, int(6 * scale))
            art_x1 = x1 - inset - max(2, int(6 * scale))
            art_y1 = y1 - inset - max(20, int(30 * scale))
            # Diagonal gradient
            for i in range(max(1, art_y1 - art_y0)):
                ratio = i / max(1, art_y1 - art_y0)
                col = lerp_color(accent, tuple(int(c * 0.6) for c in accent), ratio)
                draw.line([(art_x0, art_y0 + i), (art_x1, art_y0 + i)], fill=col)
        # Stats at bottom
        if scale > 0.5:
            sf = load_font(max(8, int(14 * scale)), bold=True)
            # ATK (left)
            atk_x = x0 + inset + max(2, int(6 * scale))
            atk_y = y1 - inset - max(8, int(20 * scale))
            draw.text((atk_x, atk_y), f"ATK {atk}", fill=(220, 60, 60), font=sf)
            # HP (right)
            hp_text = f"HP {hp}"
            bbox = draw.textbbox((0, 0), hp_text, font=sf)
            tw = bbox[2] - bbox[0]
            draw.text((x1 - inset - tw - max(2, int(6 * scale)), atk_y), hp_text, fill=(220, 60, 100), font=sf)
        # Highlight glow
        if highlight:
            pulse = 0.5 + 0.5 * math.sin(t * 6)
            glow_color = tuple(int(c * (0.5 + 0.5 * pulse)) for c in GREEN)
            for ox in (-2, 0, 2):
                for oy in (-2, 0, 2):
                    draw.rounded_rectangle(
                        [(x0 - 4 + ox, y0 - 4 + oy), (x1 + 4 + ox, y1 + 4 + oy)],
                        radius=8, outline=glow_color, width=1,
                    )
    else:
        # Card back
        draw.rounded_rectangle([(x0, y0), (x1, y1)], radius=6, fill=(40, 30, 60), outline=(220, 200, 100), width=2)
        # Inner pattern
        inset = max(1, int(4 * scale))
        draw.rounded_rectangle(
            [(x0 + inset, y0 + inset), (x1 - inset, y1 - inset)],
            radius=4, outline=(120, 80, 160), width=1,
        )
        # Center diamond
        cs = min(sw, sh) * 0.3
        draw.polygon(
            [(cx, cy - cs), (cx + cs, cy), (cx, cy + cs), (cx - cs, cy)],
            fill=(120, 80, 160),
        )


# ════════════════════════════════════════════════════════════════════════
# 11. POWDER PLAY — Alchemist powder mixing
# ════════════════════════════════════════════════════════════════════════

def scene_powder_play(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "ALCHEMIST'S POWDER", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "MIX ELEMENTS WITH HEAT AND PRESSURE", 145, t, 0.4, 1.2)

    if t < 1.0:
        return

    # Three vials on a shelf (use single letters since the alchemical
    # Unicode glyphs are not in the default font).
    vials = [
        ("Fire",  "F", (240, 100, 60)),
        ("Water", "W", (80, 140, 240)),
        ("Earth", "E", (160, 110, 70)),
    ]
    vial_w, vial_h = 110, 240
    vial_y0 = 240
    gap = 50
    total_w = 3 * vial_w + 2 * gap
    vial_x0 = (W - total_w) // 2

    for i, (name, sym, color) in enumerate(vials):
        # Vials appear with stagger
        vs = 1.0 + i * 0.3
        vp = frame_progress(t, vs, vs + 0.6)
        if vp <= 0:
            continue
        e = ease_out_back(vp, overshoot=1.1)
        x = vial_x0 + i * (vial_w + gap)
        y = vial_y0
        # Pop scale
        scale = e
        cx, cy = x + vial_w // 2, y + vial_h // 2
        sw = int(vial_w * scale)
        sh = int(vial_h * scale)
        x0 = cx - sw // 2
        y0 = cy - sh // 2

        # Glass vial body
        # Neck
        neck_w = int(sw * 0.3)
        neck_h = int(sh * 0.12)
        neck_x = cx - neck_w // 2
        neck_y = y0
        draw.rectangle(
            [(neck_x, neck_y), (neck_x + neck_w, neck_y + neck_h)],
            fill=(180, 200, 220), outline=(100, 120, 140), width=1,
        )
        # Cork
        cork_w = int(neck_w * 1.1)
        cork_x = cx - cork_w // 2
        cork_y = neck_y - max(1, int(sh * 0.03))
        draw.rectangle(
            [(cork_x, cork_y), (cork_x + cork_w, cork_y + max(2, int(sh * 0.05)))],
            fill=(160, 100, 60), outline=(100, 60, 30), width=1,
        )
        # Body (rounded bottle)
        body_x0 = x0 + 2
        body_y0 = neck_y + neck_h
        body_x1 = x0 + sw - 2
        body_y1 = y0 + sh
        draw.rounded_rectangle(
            [(body_x0, body_y0), (body_x1, body_y1)],
            radius=10, fill=(220, 230, 240, 100), outline=(100, 120, 140), width=2,
        )
        # Powder inside (animated)
        if t > vs + 0.6:
            # Swirl pattern
            fill_pct = 0.7
            powder_y0 = body_y1 - int((body_y1 - body_y0) * fill_pct)
            # Glass interior
            glass = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
            gd = ImageDraw.Draw(glass)
            gd.rounded_rectangle(
                [(body_x0 - x0, powder_y0 - y0), (body_x1 - x0, body_y1 - y0)],
                radius=10, fill=color,
            )
            # Swirl texture
            for _ in range(20):
                sx = int(body_x0 - x0 + (body_x1 - body_x0) * 0.1 + (body_x1 - body_x0) * 0.8 * ((i * 7 + _) % 11) / 11)
                sy = int(powder_y0 - y0 + ((body_y1 - powder_y0)) * 0.2 + (body_y1 - powder_y0) * 0.6 * (_ % 5) / 5)
                rr = 3 + (_ % 4)
                gd.ellipse([(sx - rr, sy - rr), (sx + rr, sy + rr)], fill=tuple(min(255, c + 40) for c in color))
            img_rgba = img.convert("RGBA")
            overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            overlay.paste(glass, (x0, y0), glass)
            img_rgba.alpha_composite(overlay)
            img.paste(img_rgba.convert("RGB"))
            draw = ImageDraw.Draw(img)
        # Element symbol on the vial
        if scale > 0.6:
            sf = load_font(max(10, int(28 * scale)), bold=True)
            bbox = draw.textbbox((0, 0), sym, font=sf)
            tw = bbox[2] - bbox[0]
            draw.text((cx - tw // 2 - bbox[0], body_y0 + (body_y1 - body_y0) // 2 - 18), sym, fill=WHITE, font=sf)
        # Label below
        lf = load_font(max(8, int(11 * scale)), bold=True)
        bbox = draw.textbbox((0, 0), name.upper(), font=lf)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2 - bbox[0], body_y1 + 12), name.upper(), fill=WHITE, font=lf)

    # "Combine" arrows between vials (2 → 3)
    if 4.0 < t < 7.0:
        # Pouring animation: the second vial tips
        pour_t = (t - 4.0) / 3.0
        pour_e = clamp01(pour_t)
        from_x = vial_x0 + 1 * (vial_w + gap) + vial_w // 2
        to_x = (W // 2) + 200
        # Particle dots flowing
        for i in range(8):
            part_t = clamp01((pour_t - i * 0.05) * 2)
            if part_t <= 0 or part_t > 1:
                continue
            px = int(lerp(from_x, to_x, ease_out_cubic(part_t)))
            py = int(lerp(360, 440, part_t) + 30 * math.sin(part_t * math.pi * 2))
            color = (80, 140, 240)
            size = 4 + int(4 * (1 - part_t))
            draw.ellipse([(px - size, py - size), (px + size, py + size)], fill=color)

    # Result beaker
    if t > 5.5:
        bt = frame_progress(t, 5.5, 7.0)
        e = ease_out_cubic(bt)
        bk_x, bk_y = W // 2 - 60, 350
        bk_w, bk_h = 120, 160
        # Beaker appears
        if e > 0.05:
            scale = e
            cx_b = bk_x + bk_w // 2
            cy_b = bk_y + bk_h // 2
            sw = int(bk_w * scale)
            sh = int(bk_h * scale)
            bx0 = cx_b - sw // 2
            by0 = cy_b - sh // 2
            bx1 = bx0 + sw
            by1 = by0 + sh
            # Beaker
            draw.rounded_rectangle(
                [(bx0, by0), (bx1, by1)],
                radius=8, fill=(220, 230, 240), outline=(100, 120, 140), width=2,
            )
            # Pour spout
            sp_w = int(sw * 0.2)
            sp_h = int(sh * 0.1)
            draw.polygon(
                [(bx1 - 2, by0 + sp_h), (bx1 + sp_w, by0 + 2), (bx1 + sp_w, by0 + sp_h + 4), (bx1, by0 + sp_h * 2)],
                fill=(220, 230, 240), outline=(100, 120, 140), width=1,
            )
            # Swirling mixture
            if t > 7.0:
                # Mix color (orange + blue → purple)
                mix_t = clamp01((t - 7.0) / 1.5)
                mix_color = lerp_color((160, 120, 200), (200, 100, 220), mix_t)
                mix_h = int((by1 - by0) * 0.6 * ease_out_cubic(mix_t))
                draw.rounded_rectangle(
                    [(bx0 + 4, by1 - mix_h), (bx1 - 4, by1 - 4)],
                    radius=6, fill=mix_color,
                )
                # Bubbles
                for i in range(5):
                    bx_p = bx0 + 20 + i * 16 + int(4 * math.sin(t * 4 + i))
                    by_p = by1 - 8 - int(((t * 30 + i * 12) % 80))
                    if by0 + 20 < by_p < by1 - 8:
                        draw.ellipse(
                            [(bx_p - 2, by_p - 2), (bx_p + 2, by_p + 2)],
                            fill=(240, 220, 255),
                        )
            # Label
            if scale > 0.7:
                lf = load_font(max(8, int(11 * scale)), bold=True)
                txt = "STORM SALT"
                bbox = draw.textbbox((0, 0), txt, font=lf)
                tw = bbox[2] - bbox[0]
                draw.text((cx_b - tw // 2 - bbox[0], by1 + 12), txt, fill=GREEN, font=lf)

    # Discovery notification
    if t > 8.5:
        dp = frame_progress(t, 8.5, 9.5)
        e = ease_out_back(dp, overshoot=1.2)
        nt = "✨ NEW MATERIAL DISCOVERED"
        nf = load_font(16, bold=True)
        bbox = draw.textbbox((0, 0), nt, font=nt and load_font(16, bold=True) or nf)
        # Use the original font
        font = load_font(16, bold=True)
        bbox = draw.textbbox((0, 0), nt, font=font)
        tw = bbox[2] - bbox[0]
        y_pos = int(lerp(640, 615, e))
        # Pill bg
        pad = 12
        bw = tw + pad * 2
        bh = 32
        bx = (W - bw) // 2
        # Slide up
        slide = int(lerp(bx - 200, bx, e))
        draw.rounded_rectangle(
            [(slide, y_pos), (slide + bw, y_pos + bh)],
            radius=4, fill=(20, 30, 48), outline=AMBER, width=2,
        )
        draw.text((slide + pad, y_pos + 7), nt, fill=AMBER, font=font)


# ════════════════════════════════════════════════════════════════════════
# 12. HIVEMIND — Distributed LLM coordinator
# ════════════════════════════════════════════════════════════════════════

def scene_hivemind(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "HIVEMIND LLM", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "DISTRIBUTED INFERENCE  •  COORDINATOR v3.2", 145, t, 0.4, 1.2)

    if t < 1.0:
        return

    # Network of 5 LLM nodes
    nodes = [
        ("coordinator", W // 2, 320, (74, 222, 128), 90),
        ("llama-3.1-70b", 280, 240, (96, 165, 250), 70),
        ("qwen-2.5-32b", 280, 420, (251, 191, 36), 70),
        ("mistral-large", 1000, 240, (244, 114, 182), 70),
        ("claude-3.5-sonnet", 1000, 420, (200, 120, 240), 70),
    ]

    # Draw connection lines (edges)
    if t > 1.5:
        edges = [
            (0, 1), (0, 2), (0, 3), (0, 4),
        ]
        for from_i, to_i in edges:
            fx, fy = nodes[from_i][1], nodes[from_i][2]
            tx, ty = nodes[to_i][1], nodes[to_i][2]
            edge_t = frame_progress(t, 1.5, 2.5)
            if edge_t > 0:
                e = ease_out_cubic(edge_t)
                # Draw partially
                ex = int(lerp(fx, tx, e))
                ey = int(lerp(fy, ty, e))
                draw.line([(fx, fy), (ex, ey)], fill=(60, 75, 95), width=2)

    # Draw nodes
    for i, (label, nx, ny, color, radius) in enumerate(nodes):
        ns = 1.0 + i * 0.15
        np = frame_progress(t, ns, ns + 0.6)
        if np <= 0:
            continue
        e = ease_out_back(np, overshoot=1.2)
        scale = e
        r = int(radius * scale)
        # Outer ring
        draw.ellipse(
            [(nx - r, ny - r), (nx + r, ny + r)],
            outline=color, width=2,
        )
        # Inner glow
        inner_r = int(r * 0.7)
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse(
            [(nx - inner_r, ny - inner_r), (nx + inner_r, ny + inner_r)],
            fill=(*color, 80),
        )
        img_rgba = img.convert("RGBA")
        img_rgba.alpha_composite(glow)
        img.paste(img_rgba.convert("RGB"))
        draw = ImageDraw.Draw(img)
        # Center dot
        cr = max(4, int(r * 0.3))
        # Pulse
        if i == 0:
            pulse = 0.6 + 0.4 * math.sin(t * 3)
        else:
            pulse = 0.5 + 0.5 * math.sin(t * 2 + i)
        cr_p = int(cr * (0.7 + 0.5 * pulse))
        draw.ellipse(
            [(nx - cr_p, ny - cr_p), (nx + cr_p, ny + cr_p)],
            fill=tuple(int(c * (0.5 + 0.5 * pulse)) for c in color),
        )
        # Label
        if scale > 0.6:
            lf = load_font(max(8, int(10 * scale)), bold=True)
            bbox = draw.textbbox((0, 0), label, font=lf)
            tw = bbox[2] - bbox[0]
            ly = ny + r + 8
            draw.text((nx - tw // 2 - bbox[0], ly), label, fill=GREY, font=lf)

    # Request packet flowing
    if 3.0 < t < 7.0:
        rt = (t - 3.0) / 4.0
        # Path: 1 → 0 → 4 → 0 → back
        # Simulate a request going out and response coming back
        path = [
            (280, 240),    # llama
            (W // 2, 320), # coordinator
            (1000, 420),   # claude
            (W // 2, 320), # coordinator
            (280, 240),    # llama (response)
        ]
        if rt < 0.6:
            # Outgoing
            seg_t = rt / 0.6
            seg_idx = int(seg_t * (len(path) - 1))
            seg_idx = min(seg_idx, len(path) - 2)
            seg_local = seg_t * (len(path) - 1) - seg_idx
            x = int(lerp(path[seg_idx][0], path[seg_idx + 1][0], seg_local))
            y = int(lerp(path[seg_idx][1], path[seg_idx + 1][1], seg_local))
            # Color shift from green to blue
            color = GREEN
            size = 10
        else:
            # Incoming (response)
            seg_t = (rt - 0.6) / 0.4
            x = int(lerp(path[-1][0], path[0][0], ease_out_cubic(seg_t)))
            y = int(lerp(path[-1][1], path[0][1], ease_out_cubic(seg_t)))
            color = AMBER
            size = 10
        # Trail
        for i in range(5):
            trail_t = clamp01(rt - i * 0.02)
            if trail_t <= 0:
                continue
            tx = int(lerp(path[0][0], x, trail_t))
            ty = int(lerp(path[0][1], y, trail_t))
            alpha = max(0, 1 - i * 0.2)
            cs = int(size * (1 - i * 0.15))
            col = tuple(int(c * alpha) for c in color)
            draw.ellipse(
                [(tx - cs, ty - cs), (tx + cs, ty + cs)],
                fill=col,
            )

    # Stats panel
    if t > 8.0:
        sp_x, sp_y = 200, 540
        sp_w, sp_h = 880, 60
        draw_panel(img, sp_x, sp_y, sp_w, sp_h, title="COORDINATOR METRICS")
        sf = load_font(11, bold=True)
        vf = load_font(16, bold=True)
        metrics = [
            ("LATENCY",    "247ms",    (96, 165, 250)),
            ("THROUGHPUT", "142 tok/s", GREEN),
            ("ACTIVE NODES", "4 / 5",  AMBER),
            ("QUEUE",      "2",        GREY),
        ]
        col_w = sp_w // len(metrics)
        for i, (k, v, color) in enumerate(metrics):
            x = sp_x + i * col_w + 12
            y = sp_y + 34
            draw.text((x, y), k, fill=DIM, font=sf)
            draw.text((x, y + 12), v, fill=color, font=vf)


# Frontend variant shows a chat UI instead of network
def scene_hivemind_frontend(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "HIVEMIND LLM", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "CHAT UI  •  MULTI-MODEL  •  STREAMING", 145, t, 0.4, 1.2)

    if t < 1.0:
        return

    # Chat window
    cw_x, cw_y = 200, 200
    cw_w, cw_h = 880, 420
    draw_panel(img, cw_x, cw_y, cw_w, cw_h, title="HIVEMIND  •  claude-3.5-sonnet", accent=(200, 120, 240))

    # User message
    if t > 1.5:
        up = frame_progress(t, 1.5, 2.5)
        e = ease_out_cubic(up)
        msg_x = cw_x + cw_w - 380
        msg_y = cw_y + 50
        msg_w = 340
        msg_h = 60
        # Slide in from right
        slide_x = int(lerp(cw_x + cw_w, msg_x, e))
        draw.rounded_rectangle(
            [(slide_x, msg_y), (slide_x + msg_w, msg_y + msg_h)],
            radius=8, fill=(30, 60, 100), outline=(96, 165, 250), width=1,
        )
        uf = load_font(13, bold=False)
        txt = "Write a haiku about neural networks."
        if up > 0.3:
            draw.text((slide_x + 14, msg_y + 12), txt, fill=WHITE, font=uf)
        # User avatar
        draw.ellipse(
            [(slide_x + msg_w + 8, msg_y + 8), (slide_x + msg_w + 36, msg_y + 36)],
            fill=(96, 165, 250),
        )
        af = load_font(11, bold=True)
        draw.text((slide_x + msg_w + 17, msg_y + 13), "Y", fill=WHITE, font=af)

    # LLM response (types in)
    if t > 3.0:
        rp = frame_progress(t, 3.0, 9.0)
        full_response = "Layers stack like thoughts —\npatterns surface from the noise,\nmind, machine, or both."
        response = text_reveal(full_response, t, 3.0, 9.0)
        msg_x = cw_x + 20
        msg_y = cw_y + 130
        msg_w = 600
        msg_h = 130
        draw.rounded_rectangle(
            [(msg_x, msg_y), (msg_x + msg_w, msg_y + msg_h)],
            radius=8, fill=(28, 36, 56), outline=(60, 75, 95), width=1,
        )
        # AI avatar
        draw.ellipse(
            [(msg_x - 30, msg_y + 8), (msg_x - 6, msg_y + 32)],
            fill=(200, 120, 240),
        )
        af = load_font(11, bold=True)
        draw.text((msg_x - 22, msg_y + 13), "AI", fill=WHITE, font=af)
        # Response text
        rf = load_font(15, bold=False)
        for i, line in enumerate(response.split("\n")):
            if line:
                draw.text((msg_x + 14, msg_y + 14 + i * 28), line, fill=WHITE, font=rf)
        # Blinking cursor
        if t < 9.0 and int(t * 3) % 2 == 0:
            lines = response.split("\n")
            cur_line = len(lines) - 1 if lines[-1] else max(0, len(lines) - 2)
            cur_text = lines[cur_line] if cur_line < len(lines) else ""
            cb = draw.textbbox((0, 0), cur_text, font=rf)
            tw = cb[2] - cb[0]
            cur_x = msg_x + 14 + tw + 2
            cur_y = msg_y + 14 + cur_line * 28
            draw.rectangle([(cur_x, cur_y - 2), (cur_x + 2, cur_y + 18)], fill=GREEN)

    # Stats below chat
    if t > 10.0:
        sp_x, sp_y = 200, 540
        sp_w, sp_h = 880, 60
        draw_panel(img, sp_x, sp_y, sp_w, sp_h, title="RESPONSE METRICS")
        sf = load_font(11, bold=True)
        vf = load_font(16, bold=True)
        metrics = [
            ("MODEL",   "claude-3.5-sonnet", (200, 120, 240)),
            ("TOKENS",  "47",                GREEN),
            ("TIME",    "1.24s",             (96, 165, 250)),
            ("COST",    "$0.0007",           AMBER),
        ]
        col_w = sp_w // len(metrics)
        for i, (k, v, color) in enumerate(metrics):
            x = sp_x + i * col_w + 12
            y = sp_y + 34
            draw.text((x, y), k, fill=DIM, font=sf)
            draw.text((x, y + 12), v, fill=color, font=vf)


# ════════════════════════════════════════════════════════════════════════
# 13. OPERATIONALIZE — Kanban project board
# ════════════════════════════════════════════════════════════════════════

def scene_operationalize(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "OPERATIONALIZE", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "PROJECT WORKFLOWS  •  Q2 SPRINT 14", 145, t, 0.4, 1.2)

    if t < 1.0:
        return

    # 3 columns: TO DO, IN PROGRESS, DONE
    columns = [
        ("TO DO",       (200, 100, 100), 3),
        ("IN PROGRESS", (251, 191, 36),  2),
        ("DONE",        (74, 222, 128),  3),
    ]
    cards = [
        # (col, title, tag, tag_color, priority)
        (0, "Add login screen",       "FEATURE",  (96, 165, 250), "P2"),
        (0, "Fix pagination bug",     "BUG",      (220, 60, 60),   "P1"),
        (0, "Update API docs",        "DOCS",     (160, 160, 160), "P3"),
        (1, "Refactor auth service",  "REFACTOR", (251, 191, 36),  "P1"),
        (1, "Add dark mode",          "FEATURE",  (96, 165, 250),  "P2"),
        (2, "Ship v2.1",              "RELEASE",  (74, 222, 128),  "P0"),
        (2, "Audit dependencies",     "CHORE",    (160, 160, 160), "P2"),
        (2, "Onboard new team",       "OPS",      (160, 160, 160), "P3"),
    ]

    col_w = 280
    col_gap = 24
    cols_total = 3 * col_w + 2 * col_gap
    col_x0 = (W - cols_total) // 2
    col_y0 = 200
    col_h = 420

    for col_idx, (col_name, col_color, card_count) in enumerate(columns):
        cx = col_x0 + col_idx * (col_w + col_gap)
        # Column header
        if t > 0.6:
            hf = load_font(13, bold=True)
            draw.text((cx, col_y0 - 22), col_name, fill=col_color, font=hf)
            cf = load_font(10, bold=True)
            draw.text((cx + 90, col_y0 - 20), f"{card_count}", fill=DIM, font=cf)
        # Column body
        col_p = frame_progress(t, 1.0 + col_idx * 0.2, 1.5 + col_idx * 0.2)
        if col_p <= 0:
            continue
        e = ease_out_cubic(col_p)
        cy_top = int(lerp(col_y0 + 50, col_y0, e))
        # Column background
        draw.rounded_rectangle(
            [(cx, col_y0), (cx + col_w, col_y0 + col_h)],
            radius=6, fill=(18, 24, 38), outline=(40, 50, 70), width=1,
        )
        # Column accent line at top
        draw.rectangle(
            [(cx, col_y0), (cx + col_w, col_y0 + 3)],
            fill=col_color,
        )

    # Cards
    for ci, (col_idx, title, tag, tag_color, priority) in enumerate(cards):
        card_start = 1.5 + ci * 0.2
        card_end = card_start + 0.6
        p = frame_progress(t, card_start, card_end)
        if p <= 0:
            continue
        e = ease_out_cubic(p)
        # Card position within column
        cards_in_col = [c for c in cards if c[0] == col_idx]
        idx_in_col = cards_in_col.index((col_idx, title, tag, tag_color, priority))
        cx = col_x0 + col_idx * (col_w + col_gap) + 8
        cy = col_y0 + 14 + idx_in_col * 100
        # Card size
        card_w, card_h = col_w - 16, 88
        # Slide in from above
        sy = int(lerp(cy - 60, cy, e))
        # Card body
        draw.rounded_rectangle(
            [(cx, sy), (cx + card_w, sy + card_h)],
            radius=4, fill=(28, 36, 56), outline=(50, 60, 80), width=1,
        )
        # Left accent bar
        draw.rectangle(
            [(cx, sy), (cx + 3, sy + card_h)],
            fill=tag_color,
        )
        # Title
        tf = load_font(13, bold=True)
        draw.text((cx + 12, sy + 12), title, fill=WHITE, font=tf)
        # Tag pill
        tagf = load_font(9, bold=True)
        tb = draw.textbbox((0, 0), tag, font=tagf)
        tw = tb[2] - tb[0]
        draw.rounded_rectangle(
            [(cx + 12, sy + 36), (cx + 20 + tw, sy + 50)],
            radius=2, fill=tag_color,
        )
        draw.text((cx + 16, sy + 37), tag, fill=WHITE, font=tagf)
        # Priority
        pf = load_font(10, bold=True)
        pri_color = (220, 60, 60) if priority == "P0" else (251, 191, 36) if priority == "P1" else GREY
        draw.text((cx + card_w - 28, sy + 12), priority, fill=pri_color, font=pf)

    # Moving card animation (5.0-9.0s): the "Add dark mode" card moves from col 1 to col 2
    if 5.0 < t < 9.0:
        mt = (t - 5.0) / 4.0
        e = ease_in_out_quad(mt)
        from_x = col_x0 + 1 * (col_w + col_gap) + 8
        to_x = col_x0 + 2 * (col_w + col_gap) + 8
        move_x = int(lerp(from_x, to_x, e))
        move_y = col_y0 + 14 + 1 * 100  # second card in col 1
        # Find this card's data
        # (it's the "Add dark mode" card)
        card_w, card_h = col_w - 16, 88
        # Draw a moving "ghost" card
        if 0 < mt < 1:
            draw.rounded_rectangle(
                [(move_x, move_y), (move_x + card_w, move_y + card_h)],
                radius=4, fill=(40, 50, 70), outline=(96, 165, 250), width=2,
            )
            tf = load_font(13, bold=True)
            draw.text((move_x + 12, move_y + 12), "Add dark mode", fill=WHITE, font=tf)
            tagf = load_font(9, bold=True)
            draw.rounded_rectangle(
                [(move_x + 12, move_y + 36), (move_x + 78, move_y + 50)],
                radius=2, fill=(96, 165, 250),
            )
            draw.text((move_x + 16, move_y + 37), "FEATURE", fill=WHITE, font=tagf)
            # Trail
            for i in range(3):
                trail = mt - i * 0.05
                if trail <= 0:
                    continue
                tx = int(lerp(from_x, to_x, ease_in_out_quad(trail)))
                alpha = 1 - i * 0.3
                draw.rounded_rectangle(
                    [(tx, move_y), (tx + card_w, move_y + card_h)],
                    radius=4, outline=(*GREEN, int(255 * alpha)),
                )


# ════════════════════════════════════════════════════════════════════════
# 15. RECURSIVE THERMOFLUID SANDBOX — Top-down physics simulation
# ════════════════════════════════════════════════════════════════════════

def scene_recursive_thermofluid_sandbox(app: App, img: Image.Image, t: float) -> None:
    draw = ImageDraw.Draw(img)
    _draw_centered_title(draw, "RECURSIVE THERMOFLUID", 80, t, 0.0, 1.0)
    _draw_centered_subtitle(draw, "EMERGENT LAB  •  WHEELS ARE THE ONLY ACTIVE COMPONENT", 145, t, 0.4, 1.2)

    if t < 1.0:
        return

    # Simulation canvas
    sim_x, sim_y = 140, 200
    sim_w, sim_h = 1000, 400
    draw.rounded_rectangle(
        [(sim_x, sim_y), (sim_x + sim_w, sim_y + sim_h)],
        radius=4, fill=(8, 12, 22), outline=(60, 75, 95), width=2,
    )

    # Grid
    for gx in range(0, sim_w, 40):
        x = sim_x + gx
        draw.line([(x, sim_y), (x, sim_y + sim_h)], fill=(20, 30, 45), width=1)
    for gy in range(0, sim_h, 40):
        y = sim_y + gy
        draw.line([(sim_x, y), (sim_x + sim_w, y)], fill=(20, 30, 45), width=1)

    # Temperature gradient (blue cold → red hot)
    # Wheel at center
    wheel_cx = sim_x + sim_w // 2
    wheel_cy = sim_y + sim_h // 2
    wheel_r = 60
    # Temperature field (radial gradient from wheel)
    temp_layer = Image.new("RGBA", (sim_w, sim_h), (0, 0, 0, 0))
    td = ImageDraw.Draw(temp_layer)
    for r in range(wheel_r * 4, 0, -8):
        t_pct = 1 - r / (wheel_r * 4)
        # Cold blue → warm red as t increases
        col = lerp_color((20, 40, 80), (200, 80, 40), t_pct)
        alpha = int(40 * t_pct)
        td.ellipse(
            [(wheel_cx - r - sim_x, wheel_cy - r - sim_y),
             (wheel_cx + r - sim_x, wheel_cy + r - sim_y)],
            fill=(*col, alpha),
        )
    img_rgba = img.convert("RGBA")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    overlay.paste(temp_layer, (sim_x, sim_y), temp_layer)
    img_rgba.alpha_composite(overlay)
    img.paste(img_rgba.convert("RGB"))
    draw = ImageDraw.Draw(img)

    # Wheel (rotates over time)
    if t > 1.5:
        wp = frame_progress(t, 1.5, 2.5)
        if wp > 0:
            wheel_scale = ease_out_cubic(wp)
            wheel_angle = (t - 1.5) * 4  # 4 rad/s
            # Spokes
            for spoke in range(8):
                ang = wheel_angle + spoke * math.pi / 4
                ex = int(wheel_cx + math.cos(ang) * wheel_r)
                ey = int(wheel_cy + math.sin(ang) * wheel_r)
                draw.line(
                    [(wheel_cx, wheel_cy), (ex, ey)],
                    fill=(180, 180, 200), width=3,
                )
            # Outer ring
            draw.ellipse(
                [(wheel_cx - wheel_r, wheel_cy - wheel_r),
                 (wheel_cx + wheel_r, wheel_cy + wheel_r)],
                outline=(200, 200, 220), width=4,
            )
            # Hub
            draw.ellipse(
                [(wheel_cx - 12, wheel_cy - 12), (wheel_cx + 12, wheel_cy + 12)],
                fill=(220, 220, 240), outline=(120, 120, 140), width=2,
            )

    # Particles (flowing in a circular pattern)
    if t > 2.0:
        for i in range(40):
            # Each particle has a fixed orbit radius and angular velocity
            base_r = 80 + (i % 5) * 50
            omega = 0.6 + (i % 7) * 0.15
            phase = (i * 0.7) % (2 * math.pi)
            ang = (t - 2.0) * omega + phase
            # Particle position with a slight radial wobble
            r = base_r + 10 * math.sin((t - 2.0) * 2 + i)
            px = int(wheel_cx + math.cos(ang) * r)
            py = int(wheel_cy + math.sin(ang) * r)
            # Temperature at this point
            dist = math.sqrt((px - wheel_cx) ** 2 + (py - wheel_cy) ** 2)
            t_pct = max(0, 1 - dist / (wheel_r * 4))
            col = lerp_color((100, 180, 255), (255, 130, 60), t_pct)
            # Size and alpha based on speed
            speed = abs(math.sin(ang))
            size = 2 + int(3 * speed)
            # Trail
            for j in range(3):
                trail_ang = ang - j * 0.08
                tx = int(wheel_cx + math.cos(trail_ang) * r)
                ty = int(wheel_cy + math.sin(trail_ang) * r)
                alpha = max(0, 1 - j * 0.4)
                trail_col = tuple(int(c * alpha) for c in col)
                draw.ellipse(
                    [(tx - size, ty - size), (tx + size, ty + size)],
                    fill=trail_col,
                )

    # Telemetry panel
    if t > 1.0:
        tp_x, tp_y = 140, 620
        tp_w, tp_h = 1000, 60
        draw_panel(img, tp_x, tp_y, tp_w, tp_h, title="LIVE TELEMETRY")
        sf = load_font(11, bold=True)
        vf = load_font(16, bold=True)
        # T value oscillates slightly
        temp_t = 325 + 12 * math.sin(t * 0.5)
        vel_t = 2.4 + 0.3 * math.sin(t * 0.7)
        metrics = [
            ("TEMPERATURE", f"{temp_t:.1f}K", (255, 130, 60)),
            ("VELOCITY",    f"{vel_t:.2f}m/s", (96, 165, 250)),
            ("WHEEL ω",     f"{4.0:.2f}rad/s", GREEN),
            ("PARTICLES",   "40",  GREY),
        ]
        col_w = tp_w // len(metrics)
        for i, (k, v, color) in enumerate(metrics):
            x = tp_x + i * col_w + 12
            y = tp_y + 32
            draw.text((x, y), k, fill=DIM, font=sf)
            draw.text((x, y + 12), v, fill=color, font=vf)


# ════════════════════════════════════════════════════════════════════════
# SCENE REGISTRY
# ════════════════════════════════════════════════════════════════════════

SCENE_REGISTRY = {
    "momos":                          scene_momos,
    "parambulator":                   scene_parambulator,
    "sub-day-generator":              scene_sub_day_generator,
    "vernissage":                     scene_vernissage,
    "holdem-together":                scene_holdem_together,
    "code-reviewdle":                 scene_code_reviewdle,
    "conway-war":                     scene_conway_war,
    "wizard-fight":                   scene_wizard_fight,
    "wizard-fight-ui":                scene_wizard_fight_ui,
    "trading-cards":                  scene_trading_cards,
    "powder-play":                    scene_powder_play,
    "hivemind":                       scene_hivemind,
    "hivemind-frontend":              scene_hivemind_frontend,
    "operationalize":                 scene_operationalize,
    "recursive-thermofluid-sandbox":  scene_recursive_thermofluid_sandbox,
}
