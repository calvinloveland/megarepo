from __future__ import annotations

import struct
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from full_auto_de_pdf.ocr_pipeline import (
    _INVERSE_RENDER_OFFSETS,
    _INVERSE_RENDER_ROTATIONS,
    _INVERSE_RENDER_SCORE_PADDING,
    _INVERSE_RENDER_SIZE_ADJUSTMENTS,
    _binary_ink_iou,
    _estimate_inverse_render_font_size,
    _expand_bbox,
    _inverse_render_font_paths,
    _inverse_render_score_candidate,
    _inverse_render_text_lines,
    _render_inverse_text_image,
)


_DEFAULT_TEXT = (
    "It is a truth universally acknowledged, that a single man in possession\n"
    "of a good fortune, must be in want of a wife."
)
_DEFAULT_CANVAS_SIZE = (520, 220)
_DEFAULT_BBOX = (32, 32, 488, 188)
_DEFAULT_TRUTH_RENDER = {
    "font_path": "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "offset_x": 0,
    "offset_y": 0,
    "rotation": 0.0,
}


@dataclass(frozen=True)
class InverseRenderCandidate:
    font_path: str | None
    font_size: int
    offset_x: int
    offset_y: int
    rotation: float
    rendered: Any


def _pillow_bicubic_resample() -> Any:
    image_module = _render_inverse_text_image.__globals__["Image"]
    resampling_namespace = getattr(image_module, "Resampling", image_module)
    return getattr(resampling_namespace, "BICUBIC")


def render_default_observed_binary() -> tuple[Any, tuple[int, int, int, int], str]:
    text = _DEFAULT_TEXT
    bbox = _DEFAULT_BBOX
    font_size = _estimate_inverse_render_font_size(bbox, _inverse_render_text_lines(text))
    observed_binary = _render_inverse_text_image(
        text,
        _DEFAULT_CANVAS_SIZE,
        bbox,
        font_path=_DEFAULT_TRUTH_RENDER["font_path"],
        font_size=font_size,
        offset_x=_DEFAULT_TRUTH_RENDER["offset_x"],
        offset_y=_DEFAULT_TRUTH_RENDER["offset_y"],
        rotation=_DEFAULT_TRUTH_RENDER["rotation"],
    )
    return observed_binary, bbox, text


def generate_inverse_render_candidates(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    text: str,
) -> tuple[Any, list[InverseRenderCandidate]]:
    lines = _inverse_render_text_lines(text)
    if not lines:
        raise ValueError("text must include at least one renderable line")
    base_font_size = _estimate_inverse_render_font_size(bbox, lines)
    font_paths = _inverse_render_font_paths()
    render_fonts = font_paths if font_paths else (None,)
    score_bbox = _expand_bbox(bbox, observed_binary.size, _INVERSE_RENDER_SCORE_PADDING)
    observed_region = observed_binary.crop(score_bbox)
    local_bbox = (
        bbox[0] - score_bbox[0],
        bbox[1] - score_bbox[1],
        bbox[2] - score_bbox[0],
        bbox[3] - score_bbox[1],
    )
    candidates: list[InverseRenderCandidate] = []
    for font_path in render_fonts:
        for adjustment in _INVERSE_RENDER_SIZE_ADJUSTMENTS:
            font_size = max(10, base_font_size + adjustment)
            for offset_x in _INVERSE_RENDER_OFFSETS:
                for offset_y in _INVERSE_RENDER_OFFSETS:
                    for rotation in _INVERSE_RENDER_ROTATIONS:
                        candidates.append(
                            InverseRenderCandidate(
                                font_path=font_path,
                                font_size=font_size,
                                offset_x=offset_x,
                                offset_y=offset_y,
                                rotation=rotation,
                                rendered=_render_inverse_text_image(
                                    text,
                                    observed_region.size,
                                    local_bbox,
                                    font_path=font_path,
                                    font_size=font_size,
                                    offset_x=offset_x,
                                    offset_y=offset_y,
                                    rotation=rotation,
                                ),
                            )
                        )
    return observed_region, candidates


def generate_rotation_mvp_candidates(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    text: str,
) -> tuple[Any, list[InverseRenderCandidate]]:
    lines = _inverse_render_text_lines(text)
    if not lines:
        raise ValueError("text must include at least one renderable line")
    base_font_size = _estimate_inverse_render_font_size(bbox, lines)
    font_paths = _inverse_render_font_paths()
    render_fonts = font_paths if font_paths else (None,)
    score_bbox = _expand_bbox(bbox, observed_binary.size, _INVERSE_RENDER_SCORE_PADDING)
    observed_region = observed_binary.crop(score_bbox)
    local_bbox = (
        bbox[0] - score_bbox[0],
        bbox[1] - score_bbox[1],
        bbox[2] - score_bbox[0],
        bbox[3] - score_bbox[1],
    )
    candidates: list[InverseRenderCandidate] = []
    for font_path in render_fonts:
        for adjustment in _INVERSE_RENDER_SIZE_ADJUSTMENTS:
            font_size = max(10, base_font_size + adjustment)
            for offset_x in _INVERSE_RENDER_OFFSETS:
                for offset_y in _INVERSE_RENDER_OFFSETS:
                    for rotation in _INVERSE_RENDER_ROTATIONS:
                        candidates.append(
                            InverseRenderCandidate(
                                font_path=font_path,
                                font_size=font_size,
                                offset_x=offset_x,
                                offset_y=offset_y,
                                rotation=rotation,
                                rendered=_render_inverse_text_image(
                                    text,
                                    observed_region.size,
                                    local_bbox,
                                    font_path=font_path,
                                    font_size=font_size,
                                    offset_x=offset_x,
                                    offset_y=offset_y,
                                    rotation=0.0,
                                ),
                            )
                        )
    return observed_region, candidates


def pack_rust_iou_payload(observed_binary: Any, candidates: list[InverseRenderCandidate]) -> bytes:
    width, height = observed_binary.size
    observed_bytes = observed_binary.tobytes()
    image_len = len(observed_bytes)
    payload = bytearray(struct.pack("<IIII", width, height, image_len, len(candidates)))
    payload.extend(observed_bytes)
    for candidate in candidates:
        rendered_bytes = candidate.rendered.tobytes()
        if len(rendered_bytes) != image_len:
            raise ValueError("candidate bitmap size did not match observed bitmap size")
        payload.extend(rendered_bytes)
    return bytes(payload)


def pack_rust_rotate_iou_payload(observed_binary: Any, candidates: list[InverseRenderCandidate]) -> bytes:
    width, height = observed_binary.size
    observed_bytes = observed_binary.tobytes()
    image_len = len(observed_bytes)
    payload = bytearray(struct.pack("<IIII", width, height, image_len, len(candidates)))
    payload.extend(observed_bytes)
    for candidate in candidates:
        rendered_bytes = candidate.rendered.tobytes()
        if len(rendered_bytes) != image_len:
            raise ValueError("candidate bitmap size did not match observed bitmap size")
        payload.extend(struct.pack("<d", candidate.rotation))
        payload.extend(rendered_bytes)
    return bytes(payload)


def compare_pre_rendered_candidates_python(
    observed_binary: Any,
    candidates: list[InverseRenderCandidate],
    *,
    repeats: int = 1,
) -> tuple[int, float]:
    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    best_index = -1
    best_score = -1.0
    for _ in range(repeats):
        best_index = -1
        best_score = -1.0
        for index, candidate in enumerate(candidates):
            score = _binary_ink_iou(observed_binary, candidate.rendered)
            if score > best_score:
                best_index = index
                best_score = score
    return best_index, best_score


def rotate_and_compare_candidates_python(
    observed_binary: Any,
    candidates: list[InverseRenderCandidate],
    *,
    repeats: int = 1,
) -> tuple[int, float]:
    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    bicubic = _pillow_bicubic_resample()
    best_index = -1
    best_score = -1.0
    for _ in range(repeats):
        best_index = -1
        best_score = -1.0
        for index, candidate in enumerate(candidates):
            rendered = candidate.rendered
            if abs(candidate.rotation) >= 1e-9:
                rendered = rendered.rotate(candidate.rotation, resample=bicubic, fillcolor=255)
            score = _binary_ink_iou(observed_binary, rendered)
            if score > best_score:
                best_index = index
                best_score = score
    return best_index, best_score


def run_rust_iou_benchmark(
    rust_binary: Path,
    observed_binary: Any,
    candidates: list[InverseRenderCandidate],
    *,
    repeats: int = 1,
) -> dict[str, object]:
    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    payload = pack_rust_iou_payload(observed_binary, candidates)
    completed = subprocess.run(
        [str(rust_binary), "--repeat", str(repeats)],
        input=payload,
        check=True,
        capture_output=True,
    )
    stdout = completed.stdout.decode("utf-8").strip()
    best_index_text, best_score_text, elapsed_ns_text = stdout.split("\t")
    return {
        "best_index": int(best_index_text),
        "best_score": float(best_score_text),
        "elapsed_seconds": int(elapsed_ns_text) / 1_000_000_000.0,
    }


def run_rust_rotate_iou_benchmark(
    rust_binary: Path,
    observed_binary: Any,
    candidates: list[InverseRenderCandidate],
    *,
    repeats: int = 1,
) -> dict[str, object]:
    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    payload = pack_rust_rotate_iou_payload(observed_binary, candidates)
    completed = subprocess.run(
        [str(rust_binary), "rotate-compare", "--repeat", str(repeats)],
        input=payload,
        check=True,
        capture_output=True,
    )
    stdout = completed.stdout.decode("utf-8").strip()
    best_index_text, best_score_text, elapsed_ns_text = stdout.split("\t")
    return {
        "best_index": int(best_index_text),
        "best_score": float(best_score_text),
        "elapsed_seconds": int(elapsed_ns_text) / 1_000_000_000.0,
    }


def benchmark_rust_iou_mvp(
    rust_binary: Path,
    *,
    render_repeats: int = 8,
    compare_repeats: int = 50,
    current_repeats: int = 8,
) -> dict[str, object]:
    observed_binary, bbox, text = render_default_observed_binary()

    current_started = time.perf_counter()
    current_score = -1.0
    for _ in range(current_repeats):
        current_score, _ = _inverse_render_score_candidate(observed_binary, bbox, text)
    current_elapsed = time.perf_counter() - current_started

    render_started = time.perf_counter()
    observed_region = None
    candidates: list[InverseRenderCandidate] = []
    for _ in range(render_repeats):
        observed_region, candidates = generate_inverse_render_candidates(observed_binary, bbox, text)
    render_elapsed = time.perf_counter() - render_started
    if observed_region is None:
        raise RuntimeError("failed to generate inverse-render candidates")

    python_started = time.perf_counter()
    python_best_index, python_best_score = compare_pre_rendered_candidates_python(
        observed_region,
        candidates,
        repeats=compare_repeats,
    )
    python_elapsed = time.perf_counter() - python_started

    rust_result = run_rust_iou_benchmark(
        rust_binary,
        observed_region,
        candidates,
        repeats=compare_repeats,
    )

    per_current = current_elapsed / current_repeats
    per_render = render_elapsed / render_repeats
    per_python_compare = python_elapsed / compare_repeats
    per_rust_compare = float(rust_result["elapsed_seconds"]) / compare_repeats
    estimated_python_total = per_render + per_python_compare
    estimated_rust_total = per_render + per_rust_compare

    return {
        "candidate_count": len(candidates),
        "font_count": len(_inverse_render_font_paths()) or 1,
        "current_per_call_seconds": per_current,
        "render_per_call_seconds": per_render,
        "python_compare_per_call_seconds": per_python_compare,
        "rust_compare_per_call_seconds": per_rust_compare,
        "python_comparison_speedup": per_python_compare / per_rust_compare if per_rust_compare else None,
        "estimated_total_speedup": estimated_python_total / estimated_rust_total if estimated_rust_total else None,
        "current_vs_estimated_rust_speedup": per_current / estimated_rust_total if estimated_rust_total else None,
        "current_best_score": current_score,
        "python_best_index": python_best_index,
        "python_best_score": python_best_score,
        "rust_best_index": rust_result["best_index"],
        "rust_best_score": rust_result["best_score"],
    }


def benchmark_rust_rotate_iou_mvp(
    rust_binary: Path,
    *,
    draw_repeats: int = 8,
    compare_repeats: int = 20,
    current_repeats: int = 8,
) -> dict[str, object]:
    observed_binary, bbox, text = render_default_observed_binary()

    current_started = time.perf_counter()
    current_score = -1.0
    for _ in range(current_repeats):
        current_score, _ = _inverse_render_score_candidate(observed_binary, bbox, text)
    current_elapsed = time.perf_counter() - current_started

    draw_started = time.perf_counter()
    observed_region = None
    candidates: list[InverseRenderCandidate] = []
    for _ in range(draw_repeats):
        observed_region, candidates = generate_rotation_mvp_candidates(observed_binary, bbox, text)
    draw_elapsed = time.perf_counter() - draw_started
    if observed_region is None:
        raise RuntimeError("failed to generate inverse-render rotation candidates")

    python_started = time.perf_counter()
    python_best_index, python_best_score = rotate_and_compare_candidates_python(
        observed_region,
        candidates,
        repeats=compare_repeats,
    )
    python_elapsed = time.perf_counter() - python_started

    rust_result = run_rust_rotate_iou_benchmark(
        rust_binary,
        observed_region,
        candidates,
        repeats=compare_repeats,
    )

    per_current = current_elapsed / current_repeats
    per_draw = draw_elapsed / draw_repeats
    per_python_rotate_compare = python_elapsed / compare_repeats
    per_rust_rotate_compare = float(rust_result["elapsed_seconds"]) / compare_repeats
    estimated_python_total = per_draw + per_python_rotate_compare
    estimated_rust_total = per_draw + per_rust_rotate_compare

    return {
        "candidate_count": len(candidates),
        "font_count": len(_inverse_render_font_paths()) or 1,
        "current_per_call_seconds": per_current,
        "draw_only_per_call_seconds": per_draw,
        "python_rotate_compare_per_call_seconds": per_python_rotate_compare,
        "rust_rotate_compare_per_call_seconds": per_rust_rotate_compare,
        "python_rotate_compare_speedup": (
            per_python_rotate_compare / per_rust_rotate_compare if per_rust_rotate_compare else None
        ),
        "estimated_python_split_total_seconds": estimated_python_total,
        "estimated_rust_split_total_seconds": estimated_rust_total,
        "split_estimated_speedup": estimated_python_total / estimated_rust_total if estimated_rust_total else None,
        "current_vs_estimated_rust_speedup": per_current / estimated_rust_total if estimated_rust_total else None,
        "split_vs_current_ratio": estimated_python_total / per_current if per_current else None,
        "current_best_score": current_score,
        "python_best_index": python_best_index,
        "python_best_score": python_best_score,
        "rust_best_index": rust_result["best_index"],
        "rust_best_score": rust_result["best_score"],
    }
