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
