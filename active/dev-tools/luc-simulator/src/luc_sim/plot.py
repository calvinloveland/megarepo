"""Minimal dependency-free SVG charting for BLER curves (log-y, linear-x)."""

from __future__ import annotations

import math
from typing import Sequence

W, H, ML, MR, MT, MB = 760, 460, 64, 24, 40, 48


def _fmt_svg(v: float) -> str:
    return f"{v:.4f}"


def bler_curves_svg(
    curves: dict[str, list[tuple[float, float]]],
    out_path: str,
    title: str = "BLER vs Eb/N0",
    target_bler: float | None = None,
    x_label: str = "Eb/N0 (dB)",
    y_label: str = "BLER",
) -> None:
    """Render {label: [(snr_db, bler), ...]} as an SVG file (log-y axis)."""
    xs = [p[0] for pts in curves.values() for p in pts]
    ys = [max(p[1], 1e-6) for pts in curves.values() for p in pts]
    if not xs:
        raise ValueError("no data to plot")
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = 1e-6, max(1.0, max(ys))
    plot_w, plot_h = W - ML - MR, H - MT - MB

    def sx(x: float) -> float:
        return ML + (x - xmin) / (xmax - xmin) * plot_w

    def sy(y: float) -> float:
        ly = math.log10(max(y, 1e-9))
        return MT + (math.log10(ymax) - ly) / (math.log10(ymax) - math.log10(ymin)) * plot_h

    parts: list[str] = []
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="monospace">')
    parts.append(f'<text x="{W/2}" y="22" text-anchor="middle" font-size="15" font-weight="bold">{title}</text>')

    # grid + axes
    for x in range(int(xmin), int(xmax) + 1):
        if x % 2 == 0:
            parts.append(f'<line x1="{sx(x):.1f}" y1="{MT}" x2="{sx(x):.1f}" y2="{MT+plot_h}" '
                         f'stroke="#ddd" stroke-width="1"/>')
    for decade in range(-6, 1):
        y = 10 ** decade
        if y < ymin or y > ymax * 1.0:
            continue
        parts.append(f'<line x1="{ML}" y1="{sy(y):.1f}" x2="{ML+plot_w}" y2="{sy(y):.1f}" '
                     f'stroke="#ddd" stroke-width="1"/>')
        parts.append(f'<text x="{ML-6}" y="{sy(y)+4:.1f}" text-anchor="end" font-size="10">{10**decade:g}</text>')
    if target_bler is not None:
        y = max(target_bler, 1e-6)
        parts.append(f'<line x1="{ML}" y1="{sy(y):.1f}" x2="{ML+plot_w}" y2="{sy(y):.1f}" '
                     f'stroke="#c00" stroke-width="1.2" stroke-dasharray="6,4"/>')
        parts.append(f'<text x="{ML+4}" y="{sy(y)-4:.1f}" font-size="10" fill="#c00">target {target_bler:g}</text>')

    palette = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b",
               "#e377c2", "#7f7f7f", "#bcbd22", "#17becf", "#393b79", "#9c9ede"]
    legend_y = H - 16
    for idx, (label, pts) in enumerate(curves.items()):
        color = palette[idx % len(palette)]
        if len(pts) < 2:
            continue
        d = " ".join(f"L{sx(x):.1f},{sy(y):.1f}" for x, y in pts)
        parts.append(f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="2"/>')
        lx = ML + (idx % 6) * (plot_w / 6 + 10) + 10
        ly = legend_y - (idx // 6) * 14
        parts.append(f'<circle cx="{lx}" cy="{ly-3}" r="3" fill="{color}"/>')
        parts.append(f'<text x="{lx+8}" y="{ly}" font-size="10">{label}</text>')

    # axis labels
    parts.append(f'<text x="{ML+plot_w/2}" y="{H-14}" text-anchor="middle" font-size="12">{x_label}</text>')
    parts.append(f'<text x="14" y="{MT+plot_h/2}" text-anchor="middle" font-size="12" '
                 f'transform="rotate(-90 14 {MT+plot_h/2})">{y_label}</text>')
    parts.append("</svg>")

    import os

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w") as f:
        f.write("\n".join(parts))


# family -> color, shared with the web UI so charts look consistent
FAMILY_COLORS = {
    "repetition": "#9ecae1", "hamming": "#a6d854", "bch": "#e78ac3",
    "reed-solomon": "#ffd92f", "polar": "#fc8d62", "ldpc": "#66c2a5",
    "turbo": "#8da0cb", "(outage)": "#4a5560",
}


def timeline_svg(
    records: Sequence,
    switches: Sequence,
    out_path: str,
    title: str = "LUC adaptive link timeline",
    width: int = 1200,
    height: int = 420,
) -> None:
    """Render the adaptive-link timeline as an SVG: SNR traces over frames on
    top, color-coded code-family band below, switch markers and error/sync-loss
    ticks. `records` items need .t/.true_snr_db/.est_snr_db/.family/.ok/.outage;
    `switches` items need .t/.old/.new.
    """
    import os

    n = len(records)
    if n == 0:
        raise ValueError("no records to plot")
    pad_l, pad_r, pad_t, pad_b = 56, 16, 16, 24
    plot_w = width - pad_l - pad_r
    snr_h = (height - pad_t - pad_b) * 0.58
    band_top = pad_t + snr_h + 10
    band_h = height - pad_t - snr_h - 10 - pad_b

    all_snr = [r.true_snr_db for r in records] + [r.est_snr_db for r in records]
    lo = int(min(all_snr)) - 1
    hi = int(max(all_snr)) + 1

    def sx(i: float) -> float:
        return pad_l + (i / max(n - 1, 1)) * plot_w

    def sy(v: float) -> float:
        return pad_t + (1 - (v - lo) / (hi - lo)) * snr_h

    parts: list[str] = []
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
                 f'font-family="monospace">')
    parts.append(f'<rect width="{width}" height="{height}" fill="#141a21"/>')
    parts.append(f'<text x="{width/2}" y="13" text-anchor="middle" font-size="14" '
                 f'font-weight="bold" fill="#4fc3f7">{title}</text>')

    # SNR grid + labels
    for v in range(lo, hi + 1):
        if v % 2 == 0:
            y = sy(v)
            parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" y2="{y:.1f}" '
                         f'stroke="#22303c" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{sy(v) + 4:.1f}" text-anchor="end" '
                     f'font-size="10" fill="#7d8b99">{v}</text>')

    # true SNR
    pts = " ".join(f"{sx(r.t):.1f},{sy(r.true_snr_db):.1f}" for r in records)
    parts.append(f'<polyline points="{pts}" fill="none" stroke="#e15759" stroke-width="1.2"/>')
    parts.append(f'<text x="{pad_l + 6}" y="{pad_t + 10}" font-size="10" fill="#e15759">true SNR</text>')
    # estimated SNR
    pts = " ".join(f"{sx(r.t):.1f},{sy(r.est_snr_db):.1f}" for r in records)
    parts.append(f'<polyline points="{pts}" fill="none" stroke="#4fc3f7" stroke-width="2"/>')
    parts.append(f'<text x="{pad_l + 6}" y="{pad_t + 22}" font-size="10" fill="#4fc3f7">est. SNR</text>')

    # code-family band
    usage: dict[str, int] = {}
    for r in records:
        usage[r.family] = usage.get(r.family, 0) + 1
    cell = plot_w / n
    for r in records:
        color = FAMILY_COLORS.get(r.family, "#888")
        parts.append(f'<rect x="{sx(r.t):.2f}" y="{band_top}" width="{max(cell - 0.5, 0.6):.2f}" '
                     f'height="{band_h}" fill="{color}"/>')
    # family legend inside the band
    lx = pad_l + 6
    for fam, cnt in sorted(usage.items()):
        color = FAMILY_COLORS.get(fam, "#888")
        parts.append(f'<rect x="{lx}" y="{band_top + 5}" width="9" height="9" fill="{color}"/>')
        parts.append(f'<text x="{lx + 12}" y="{band_top + 14}" font-size="10" fill="#9aa8b6">'
                     f'{fam} {cnt}</text>')
        lx += 14 + 14 * (len(fam) + len(str(cnt)) + 2)

    # switch markers
    for sw in switches:
        x = sx(sw.t)
        parts.append(f'<line x1="{x:.1f}" y1="{band_top - 4}" x2="{x:.1f}" y2="{band_top + band_h}" '
                     f'stroke="#ffffff" stroke-width="1" stroke-dasharray="3,3"/>')

    # error / outage ticks
    for r in records:
        x = sx(r.t) + cell / 2
        if r.outage:
            parts.append(f'<rect x="{x:.1f}" y="{band_top + band_h - 3}" width="2" height="3" fill="#c0392b"/>')
        elif not r.ok:
            parts.append(f'<rect x="{x:.1f}" y="{band_top + band_h - 5}" width="2" height="5" fill="#ff6b6b"/>')

    # frame axis
    step = max(1, n // 10)
    for t in range(0, n, step):
        parts.append(f'<text x="{sx(t) - 10:.1f}" y="{height - 8}" font-size="10" fill="#7d8b99">{t}</text>')
    parts.append(f'<text x="{pad_l + plot_w - 52}" y="{height - 8}" font-size="10" fill="#9aa8b6">frame →</text>')
    parts.append("</svg>")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w") as f:
        f.write("\n".join(parts))
