"""Animation helpers — easings, lerps, and progress utilities.

Pure functions, no PIL or other heavy imports. Safe to import from
anywhere without circular-dep risk.
"""

from __future__ import annotations


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


def lerp_color(a, b, t):
    return (
        int(lerp(a[0], b[0], t)),
        int(lerp(a[1], b[1], t)),
        int(lerp(a[2], b[2], t)),
    )


def clamp01(t: float) -> float:
    return max(0.0, min(1.0, t))


def frame_progress(t_seconds: float, start: float, end: float) -> float:
    """Return 0..1 progress within a time window."""
    if t_seconds <= start:
        return 0.0
    if t_seconds >= end:
        return 1.0
    return clamp01((t_seconds - start) / (end - start))
