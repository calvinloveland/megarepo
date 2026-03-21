"""Local OCR pipeline and mode-evaluation helpers."""
# pylint: disable=too-many-lines

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from collections import Counter
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from functools import lru_cache
import html
from html.parser import HTMLParser
import importlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Any, Callable

from . import benchmark as benchmark_module
from .image_validation import validate_raster_image
from .ocr_cleanup import cleanup_ocr_text, is_known_word_correction
from .pillow_compat import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps
from .rust_accel import get_rust_inverse_render_accel

_VALID_PREPROCESS_MODES = (
    "none",
    "scan",
    "scan-local-threshold",
    "scan-background-normalized",
    "scan-sauvola",
    "scan-morphology",
    "basic",
    "deskew",
    "dewarp",
    "auto",
)
_AUTO_PREPROCESS_MODES = ("none", "scan", "scan-local-threshold", "basic", "deskew", "dewarp")
_MODE_EVAL_PREPROCESS_MODES = (
    "none",
    "scan",
    "scan-local-threshold",
    "scan-background-normalized",
    "scan-sauvola",
    "scan-morphology",
    "basic",
    "deskew",
    "dewarp",
)
_AUTO_TESSERACT_PSMS = ("3", "4", "6")
_MASKED_PREPROCESS_SUFFIX = "-masked"
_AUTO_MASKED_PREPROCESS_MODES = frozenset({"scan", "scan-local-threshold"})
_DEFAULT_RENDER_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
)
_INVERSE_RENDER_SIZE_ADJUSTMENTS = (-2, 0, 2)
_INVERSE_RENDER_ROTATIONS = (-0.5, 0.0, 0.5)
_INVERSE_RENDER_OFFSETS = (-4, 0, 4)
_INVERSE_RENDER_SCORE_PADDING = 24
_AUTO_INVERSE_RENDER_SCORE_WINDOW = 80.0
_AUTO_INVERSE_RENDER_PREPROCESS_MODES = frozenset({"none", "scan", "scan-local-threshold"})
_AUTO_SCAN_LOCAL_THRESHOLD_MIN_SCORE = 500.0
_FRONT_MATTER_RETRY_PREPROCESS_MODES = (
    "scan-background-normalized-masked",
    "scan-background-normalized",
    "scan-masked",
    "scan-local-threshold-masked",
    "scan",
    "scan-local-threshold",
    "scan-sauvola",
    "scan-morphology",
    "basic",
    "deskew",
)
_FRONT_MATTER_RETRY_TESSERACT_PSMS = ("6", "4")
_BACK_MATTER_RETRY_PREPROCESS_MODES = (
    "scan-background-normalized",
    "scan-background-normalized-masked",
    "scan-local-threshold",
    "scan-local-threshold-masked",
    "scan",
    "scan-masked",
    "scan-sauvola",
    "basic",
)
_BACK_MATTER_RETRY_TESSERACT_PSMS = ("6", "3")
_BODY_LOW_QUALITY_RETRY_PREPROCESS_MODES = (
    "scan-background-normalized",
    "scan-background-normalized-masked",
    "scan-sauvola",
    "scan-morphology",
    "scan",
    "scan-masked",
    "scan-local-threshold",
    "scan-local-threshold-masked",
    "deskew",
    "basic",
    "dewarp",
)
_BODY_LOW_QUALITY_RETRY_TESSERACT_PSMS = ("3", "6", "4")
_BODY_REVIEW_RETRY_PREPROCESS_MODES = (
    "scan-background-normalized",
    "scan-background-normalized-masked",
    "scan-local-threshold",
    "scan-local-threshold-masked",
    "scan",
    "scan-sauvola",
    "basic",
)
_BODY_REVIEW_RETRY_TESSERACT_PSMS = ("6", "4")
_SCAN_BACKGROUND_NORMALIZATION_BLUR_RADIUS = 12.0
_SCAN_BACKGROUND_NORMALIZATION_CONTRAST_SCALE = 5.0
_SCAN_BACKGROUND_NORMALIZATION_CLOSING_SIZE = 9
_PRE_OCR_MASK_ACTIVE_ROW_INK_RATIO = 0.015
_PRE_OCR_MASK_ROW_GAP = 8
_PRE_OCR_MASK_SIGNIFICANT_BAND_HEIGHT = 18
_PRE_OCR_MASK_SIGNIFICANT_BAND_WIDTH_RATIO = 0.4
_PRE_OCR_MASK_MAX_NOISE_BAND_HEIGHT_RATIO = 0.08
_PRE_OCR_MASK_MAX_NOISE_BAND_WIDTH_RATIO = 0.75
_PRE_OCR_MASK_MAX_TRIM_RATIO = 0.18
_TILED_THRESHOLD_MIN_PIXELS = 2_500_000
_TILED_THRESHOLD_TILE_SIZE = 1024
_TILED_THRESHOLD_OVERLAP = 192
_TIERED_FALLBACK_TILE_HEIGHT = 400
_TIERED_FALLBACK_TILE_OVERLAP = 50
_CLEANUP_SPAN_VERIFIER_MAX_TOKENS = 3
_CLEANUP_SPAN_VERIFIER_LOCAL_MARGIN = 0.03
_CLEANUP_SPAN_VERIFIER_GLOBAL_MARGIN = 0.005
_CLEANUP_SPAN_VERIFIER_MAX_AREA_RATIO = 0.2
_CLEANUP_SPAN_VERIFIER_DIFF_PADDING = 12
_LATIN_TOKEN = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_NON_SPACE_TOKEN = re.compile(r"\S+")
_NON_TEXT_CHAR = re.compile(r"[^A-Za-z0-9\s\.,;:!\?'\-\"()\[\]]")
_HOCR_WCONF_RE = re.compile(r"\bx_wconf\s+(\d{1,3})\b", re.IGNORECASE)
_HOCR_BBOX_RE = re.compile(r"\bbbox\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\b", re.IGNORECASE)
_HOCR_LOW_CONFIDENCE_WORD_THRESHOLD = 70
_PAGE_NUMBER_LINE_RE = re.compile(r"^\(?([0-9]{1,4}|[ivxlcdm]{1,8})\)?$", re.IGNORECASE)
_CHAPTER_MARKER_RE = re.compile(r"^(chapter|part|book|section)\b", re.IGNORECASE)
_TOC_LINE_RE = re.compile(
    r"^.+(?:(?:\.\s*){2,}|(?:\s{2,}))(?:[0-9]{1,4}|[ivxlcdm]{1,8})$",
    re.IGNORECASE,
)
_FRONT_MATTER_MAX_PAGES = 12
_BACK_MATTER_MAX_PAGES = 10
_MEDIUM_QUALITY_SELECTION_SCORE = 550.0
_LOW_QUALITY_SELECTION_SCORE = 250.0
_MEDIUM_QUALITY_LOW_CONFIDENCE_RATIO = 0.1
_LOW_QUALITY_LOW_CONFIDENCE_RATIO = 0.25
_MEDIUM_QUALITY_NOISE_RATIO = 0.08
_LOW_QUALITY_NOISE_RATIO = 0.18
_SUSPICIOUS_SECTION_MIN_WORDS = 24
_SUSPICIOUS_SECTION_WINDOW_WORDS = 120
_SUSPICIOUS_SECTION_WINDOW_OVERLAP_WORDS = 40
_MAX_SUSPICIOUS_SECTION_FOCUS_SPANS = 3
_SUSPICIOUS_SYMBOLIC_TOKEN_RE = re.compile(r"\b(?=\S*[A-Za-z])(?=\S*[%{}\[\]<>|\\/@#$^*_~`])\S+\b")
_SUSPICIOUS_DIGIT_ALPHA_TOKEN_RE = re.compile(r"\b(?=\w*[A-Za-z])(?=\w*\d)\w+\b")
_COMMON_ENGLISH_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "has",
        "he",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "that",
        "the",
        "their",
        "there",
        "this",
        "to",
        "was",
        "were",
        "which",
        "with",
    }
)


@dataclass(frozen=True)
class OCRCoreOptions:
    """Shared OCR option values."""

    language: str = "eng"
    dpi: int = 300
    apply_cleanup: bool = True
    binarize_threshold: int = 190
    deskew_max_angle: float = 7.0
    deskew_angle_step: float = 0.5
    tesseract_psm: str = "auto"
    tesseract_output_format: str = "text"
    cleanup_lexicon_texts: tuple[str, ...] = ()
    confidence_aware_cleanup: bool = False
    cleanup_high_confidence_threshold: float = 95.0
    orientation_fallback: bool = False
    tiered_ocr_fallback: bool = False
    tiered_ocr_min_score: float = 200.0
    layout_region_detection: bool = False
    llm_post_correction: bool = False
    llm_min_low_confidence_ratio: float = 0.08
    llm_max_word_delta_ratio: float = 0.2
    llm_suspicious_sections: bool = False
    llm_suspicious_max_candidates: int = 12
    llm_suspicious_max_sections: int = 6
    inverse_render_rerank: bool = False
    inverse_render_top_k: int = 3
    inverse_render_workers: int = 1
    verify_cleanup_spans: bool = False


@dataclass(frozen=True)
class OCRRunOptions:
    """Config for a single OCR execution."""

    core: OCRCoreOptions
    preprocess_mode: str = "basic"
    ocr_engine: str = "tesseract"
    emit_page_artifacts: bool = True
    page_artifacts_dir: Path | None = None
    progress_callback: Callable[[dict[str, object]], None] | None = None
    candidate_preprocess_modes_override: tuple[str, ...] | None = None
    candidate_tesseract_psms_override: tuple[str, ...] | None = None
    route_ocr_policy: str | None = None


@dataclass(frozen=True)
class OCRDependencies:
    """Injectable dependencies for OCR execution and testing."""

    run_command: Callable[[list[str], bool], str]
    preprocess_image: Callable[[Path, Path, str, int, float, float], None]
    paddle_reader_factory: Callable[[str], Callable[[Path], str]]
    which: Callable[[str], str | None]
    llm_corrector: Callable[[str], str] | None = None
    llm_suspicious_section_analyzer: Callable[[str], str] | None = None


@dataclass(frozen=True)
class OCRCandidate:
    """One OCR candidate and its selection metadata."""

    score: float
    ocr_input_path: Path
    text: str
    metadata: dict[str, object]


@dataclass(frozen=True)
class _CleanupSpanChange:
    raw_start: int
    raw_end: int
    cleaned_start: int
    cleaned_end: int
    raw_text: str
    cleaned_text: str
    raw_token_count: int
    cleaned_token_count: int
    raw_token_start_index: int
    raw_token_end_index: int


@dataclass(frozen=True)
class _InverseRenderScoreRequest:
    observed_binary: Any
    bbox: tuple[int, int, int, int]
    text: str


@dataclass(frozen=True)
class ModeEvalOptions:
    """Config for preprocessing-mode comparisons."""

    core: OCRCoreOptions
    ocr_engine: str = "tesseract"
    reference_text_path: Path | None = None
    modes: tuple[str, ...] = _MODE_EVAL_PREPROCESS_MODES


@dataclass(frozen=True)
class LocalArchiveBenchmarkOptions:
    """Config for local-vs-archive benchmark runs."""

    core: OCRCoreOptions
    archive_source_mode: str = "djvu"
    ocr_engine: str = "tesseract"


@dataclass(frozen=True)
class SourceCandidateRequest:
    """Input bundle for one local-vs-archive source candidate run."""

    pdf_path: Path
    archive_identifier: str
    source_name: str
    reference_text: str
    work_dir: Path
    options: LocalArchiveBenchmarkOptions


def _run_command(command: list[str], capture_output: bool = False) -> str:
    completed = subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture_output,
    )
    return completed.stdout if capture_output else ""


def _map_paddleocr_language(language: str) -> str:
    normalized = language.lower().strip()
    mapping = {
        "eng": "en",
        "en": "en",
        "fra": "fr",
        "fr": "fr",
        "deu": "german",
        "de": "german",
        "spa": "es",
        "es": "es",
        "ita": "it",
        "it": "it",
    }
    return mapping.get(normalized, "en")


def _build_paddleocr_reader(language: str) -> Callable[[Path], str]:
    paddle_ocr_type = _load_paddleocr_type()
    reader = _initialize_paddle_reader(paddle_ocr_type, language)
    return lambda image_path: _read_with_paddle(reader, image_path)


def _load_paddleocr_type() -> Any:
    try:
        module = importlib.import_module("paddleocr")
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency for paddleocr engine: paddleocr. "
            "Install with `pip install paddleocr` or use --ocr-engine tesseract."
        ) from exc
    paddle_ocr_type = getattr(module, "PaddleOCR", None)
    if paddle_ocr_type is None:
        raise RuntimeError("paddleocr module does not provide PaddleOCR")
    return paddle_ocr_type


def _initialize_paddle_reader(paddle_ocr_type: Any, language: str) -> Any:
    reader_kwargs = {
        "use_angle_cls": True,
        "lang": _map_paddleocr_language(language),
        "use_gpu": False,
        "show_log": False,
    }
    while True:
        try:
            return paddle_ocr_type(**reader_kwargs)
        except (TypeError, ValueError) as exc:
            unknown_argument = _extract_unknown_argument(str(exc))
            if unknown_argument is None or unknown_argument not in reader_kwargs:
                raise
            reader_kwargs.pop(unknown_argument)


def _extract_unknown_argument(message: str) -> str | None:
    direct_match = re.search(r"Unknown argument:\s*([A-Za-z_][A-Za-z0-9_]*)", message)
    if direct_match:
        return direct_match.group(1)
    kwarg_match = re.search(
        r"unexpected keyword argument '([A-Za-z_][A-Za-z0-9_]*)'",
        message,
    )
    return kwarg_match.group(1) if kwarg_match else None


def _read_with_paddle(reader: Any, image_path: Path) -> str:
    raw_result = _run_paddle_raw(reader, image_path)
    lines: list[str] = []
    for page_result in raw_result or []:
        lines.extend(_extract_lines_from_page_result(page_result))
    return "\n".join(lines)


def _run_paddle_raw(reader: Any, image_path: Path) -> Any:
    if hasattr(reader, "predict"):
        return list(reader.predict(str(image_path)))
    try:
        return reader.ocr(str(image_path), cls=True)
    except TypeError as exc:
        if "cls" not in str(exc):
            raise
        return reader.ocr(str(image_path))


def _extract_lines_from_page_result(page_result: Any) -> list[str]:
    if isinstance(page_result, dict):
        return _extract_lines_from_predict_result(page_result)
    if not isinstance(page_result, list):
        return []
    return _extract_lines_from_ocr_rows(page_result)


def _extract_lines_from_predict_result(page_result: dict[str, Any]) -> list[str]:
    rec_texts = page_result.get("rec_texts")
    if not isinstance(rec_texts, list):
        return []
    return [text.strip() for text in rec_texts if isinstance(text, str) and text.strip()]


def _extract_lines_from_ocr_rows(rows: list[Any]) -> list[str]:
    lines: list[str] = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        text_info = row[1]
        if not isinstance(text_info, (list, tuple)) or not text_info:
            continue
        text = text_info[0]
        if isinstance(text, str) and text.strip():
            lines.append(text.strip())
    return lines


def _projection_variance(binary_image: Any) -> float:
    width, height = binary_image.size
    pixels = binary_image.load()
    row_counts: list[int] = []
    for y in range(height):
        black_count = 0
        for x in range(width):
            if pixels[x, y] == 0:
                black_count += 1
        row_counts.append(black_count)
    if not row_counts:
        return 0.0
    mean = sum(row_counts) / len(row_counts)
    return sum((value - mean) ** 2 for value in row_counts) / len(row_counts)


def _estimate_skew_angle(denoised_image: Any, max_angle: float, angle_step: float) -> float:
    best_angle = 0.0
    best_score = -math.inf
    angle = -max_angle
    while angle <= max_angle + 1e-9:
        rotated = denoised_image.rotate(angle, expand=True, fillcolor=255)
        binary = rotated.point(lambda value: 255 if value >= 128 else 0, mode="L")
        score = _projection_variance(binary)
        if score > best_score:
            best_score = score
            best_angle = angle
        angle += angle_step
    return best_angle


def _row_center_offsets(binary_image: Any) -> list[float | None]:
    width, height = binary_image.size
    pixels = binary_image.load()
    centers: list[float | None] = []
    for y in range(height):
        left = _first_black_pixel(pixels, width, y)
        if left is None:
            centers.append(None)
            continue
        right = _last_black_pixel(pixels, width, y)
        if right is None:
            centers.append(None)
            continue
        centers.append((left + right) / 2.0)
    return centers


def _first_black_pixel(pixels: Any, width: int, y: int) -> int | None:
    for x in range(width):
        if pixels[x, y] == 0:
            return x
    return None


def _last_black_pixel(pixels: Any, width: int, y: int) -> int | None:
    for x in range(width - 1, -1, -1):
        if pixels[x, y] == 0:
            return x
    return None


def _linear_center_baseline(centers: list[float | None]) -> tuple[float, float]:
    points = [(float(y), center) for y, center in enumerate(centers) if center is not None]
    if len(points) < 2:
        return 0.0, 0.0
    n = float(len(points))
    sum_x = sum(x for x, _ in points)
    sum_y = sum(y for _, y in points)
    sum_xx = sum(x * x for x, _ in points)
    sum_xy = sum(x * y for x, y in points)
    denom = n * sum_xx - sum_x * sum_x
    if abs(denom) < 1e-9:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


def _dewarp_by_row_shift(denoised_image: Any, binarize_threshold: int) -> Any:
    if Image is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    binary = denoised_image.point(lambda value: 255 if value >= binarize_threshold else 0)
    centers = _row_center_offsets(binary)
    slope, intercept = _linear_center_baseline(centers)
    width, height = denoised_image.size
    warped = Image.new("L", (width, height), color=255)
    for y in range(height):
        shift = _row_shift_for_dewarp(centers, slope, intercept, y)
        row = denoised_image.crop((0, y, width, y + 1))
        warped.paste(row, (-shift, y))
    return warped


def _row_shift_for_dewarp(
    centers: list[float | None],
    slope: float,
    intercept: float,
    y: int,
) -> int:
    center = centers[y]
    if center is None:
        return 0
    baseline_center = slope * float(y) + intercept
    return int(round(center - baseline_center))


def _preprocess_image(
    input_path: Path,
    output_path: Path,
    *args: Any,
) -> None:
    preprocess_mode, binarize_threshold, deskew_max_angle, deskew_angle_step = (
        _parse_preprocess_args(args)
    )
    base_preprocess_mode, apply_region_masking = _split_preprocess_mode(preprocess_mode)
    if Image is None or ImageFilter is None or ImageOps is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    with Image.open(input_path) as image:
        gray = image.convert("L")
        if _uses_scan_preprocess_stack(base_preprocess_mode):
            contrasted = ImageOps.autocontrast(gray)
            denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
            # Sharpen after denoising so Tesseract sees crisp character edges.
            # UnsharpMask enhances fine strokes (e.g. the bar in 'e' vs 'c').
            sharpened = denoised.filter(ImageFilter.UnsharpMask(radius=1, percent=150, threshold=3))
            ocr_ready = _upsample_for_ocr(sharpened, scale_factor=3)
        else:
            contrasted = ImageOps.autocontrast(gray)
            denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
            ocr_ready = _upsample_for_ocr(denoised)
        candidate = _preprocess_candidate(
            ocr_ready,
            base_preprocess_mode,
            deskew_max_angle,
            deskew_angle_step,
            binarize_threshold,
        )
        binarized = _binarize_preprocessed_candidate(
            candidate,
            base_preprocess_mode,
            binarize_threshold,
        )
        if apply_region_masking:
            binarized = _mask_sparse_outer_text_bands(binarized)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        binarized.save(output_path)


def _parse_preprocess_args(args: tuple[Any, ...]) -> tuple[str, int, float, float]:
    if len(args) != 4:
        raise TypeError("_preprocess_image expects preprocess mode, threshold, max angle, step")
    preprocess_mode = str(args[0])
    binarize_threshold = int(args[1])
    deskew_max_angle = float(args[2])
    deskew_angle_step = float(args[3])
    return preprocess_mode, binarize_threshold, deskew_max_angle, deskew_angle_step


def _split_preprocess_mode(preprocess_mode: str) -> tuple[str, bool]:
    if preprocess_mode.endswith(_MASKED_PREPROCESS_SUFFIX):
        return preprocess_mode[: -len(_MASKED_PREPROCESS_SUFFIX)], True
    return preprocess_mode, False


def _masked_preprocess_mode(preprocess_mode: str) -> str:
    return f"{preprocess_mode}{_MASKED_PREPROCESS_SUFFIX}"


def _upsample_for_ocr(image: Any, scale_factor: int = 2) -> Any:
    if Image is None:
        return image
    if image.width >= 2400 or image.height >= 3200:
        return image
    resampling_namespace = getattr(Image, "Resampling", Image)
    resampling = getattr(resampling_namespace, "LANCZOS")
    return image.resize((image.width * scale_factor, image.height * scale_factor), resampling)


def _uses_scan_preprocess_stack(preprocess_mode: str) -> bool:
    preprocess_mode, _ = _split_preprocess_mode(preprocess_mode)
    return preprocess_mode in {
        "scan",
        "scan-local-threshold",
        "scan-background-normalized",
        "scan-sauvola",
        "scan-morphology",
    }


def _ink_row_counts(binary_image: Any) -> list[int]:
    grayscale = binary_image.convert("L")
    width, height = grayscale.size
    if width <= 0 or height <= 0:
        return []
    raw = grayscale.tobytes()
    return [raw[offset : offset + width].count(0) for offset in range(0, len(raw), width)]


def _collect_ink_bands(binary_image: Any) -> list[dict[str, int]]:
    row_counts = _ink_row_counts(binary_image)
    width, _height = binary_image.size
    if not row_counts or width <= 0:
        return []
    active_threshold = max(3, int(round(width * _PRE_OCR_MASK_ACTIVE_ROW_INK_RATIO)))
    active_rows = [index for index, count in enumerate(row_counts) if count >= active_threshold]
    if not active_rows:
        return []
    bands: list[dict[str, int]] = []
    start = active_rows[0]
    end = active_rows[0]
    for row_index in active_rows[1:]:
        if row_index - end <= _PRE_OCR_MASK_ROW_GAP + 1:
            end = row_index
            continue
        bands.append(_band_metadata(binary_image, row_counts, start, end))
        start = row_index
        end = row_index
    bands.append(_band_metadata(binary_image, row_counts, start, end))
    return bands


def _band_metadata(binary_image: Any, row_counts: list[int], start: int, end: int) -> dict[str, int]:
    width, _height = binary_image.size
    crop = binary_image.crop((0, start, width, end + 1))
    bbox = ImageOps.invert(crop).getbbox()
    ink_left = 0 if bbox is None else int(bbox[0])
    ink_right = 0 if bbox is None else int(bbox[2])
    return {
        "top": start,
        "bottom": end,
        "height": end - start + 1,
        "peak_row_ink": max(row_counts[start : end + 1], default=0),
        "ink_width": max(0, ink_right - ink_left),
        "ink_left": ink_left,
        "ink_right": ink_right,
    }


def _is_significant_ink_band(band: dict[str, int], page_width: int) -> bool:
    return (
        band["height"] >= _PRE_OCR_MASK_SIGNIFICANT_BAND_HEIGHT
        and band["ink_width"] >= int(page_width * _PRE_OCR_MASK_SIGNIFICANT_BAND_WIDTH_RATIO)
    )


def _should_mask_outer_band(
    band: dict[str, int],
    anchor_band: dict[str, int],
    page_width: int,
    page_height: int,
) -> bool:
    max_noise_height = max(12, int(page_height * _PRE_OCR_MASK_MAX_NOISE_BAND_HEIGHT_RATIO))
    return (
        band["height"] <= max_noise_height
        and band["ink_width"] > 0
        and anchor_band["ink_width"] > 0
        and band["ink_width"]
        <= int(max(anchor_band["ink_width"] * _PRE_OCR_MASK_MAX_NOISE_BAND_WIDTH_RATIO, page_width * 0.18))
    )


def _mask_sparse_outer_text_bands(binary_image: Any) -> Any:
    if ImageDraw is None:
        return binary_image
    width, height = binary_image.size
    if width <= 0 or height <= 0:
        return binary_image
    bands = _collect_ink_bands(binary_image)
    if not bands:
        return binary_image
    significant_indices = [
        index for index, band in enumerate(bands) if _is_significant_ink_band(band, width)
    ]
    if not significant_indices:
        return binary_image
    first_significant = bands[significant_indices[0]]
    last_significant = bands[significant_indices[-1]]
    trim_limit = max(1, int(height * _PRE_OCR_MASK_MAX_TRIM_RATIO))
    masked = binary_image.copy()
    draw = ImageDraw.Draw(masked)
    trimmed_top = 0
    for band in bands[: significant_indices[0]]:
        band_height = band["height"]
        if trimmed_top + band_height > trim_limit:
            break
        if not _should_mask_outer_band(band, first_significant, width, height):
            continue
        draw.rectangle((0, band["top"], width, band["bottom"]), fill=255)
        trimmed_top += band_height
    trimmed_bottom = 0
    for band in reversed(bands[significant_indices[-1] + 1 :]):
        band_height = band["height"]
        if trimmed_bottom + band_height > trim_limit:
            break
        if not _should_mask_outer_band(band, last_significant, width, height):
            continue
        draw.rectangle((0, band["top"], width, band["bottom"]), fill=255)
        trimmed_bottom += band_height
    return masked


def _binarize_preprocessed_candidate(
    candidate: Any,
    preprocess_mode: str,
    binarize_threshold: int,
) -> Any:
    if preprocess_mode == "scan":
        effective_threshold = _otsu_threshold(candidate)
        return candidate.point(lambda value: 255 if value >= effective_threshold else 0)
    if preprocess_mode == "scan-local-threshold":
        if _should_use_tiled_threshold(candidate):
            return _threshold_image_in_overlapping_tiles(
                candidate,
                tile_size=_TILED_THRESHOLD_TILE_SIZE,
                overlap=_TILED_THRESHOLD_OVERLAP,
                threshold_fn=lambda tile: _adaptive_gaussian_threshold(
                    tile,
                    block_size=51,
                    subtract_constant=15,
                ),
            )
        return _adaptive_gaussian_threshold(candidate, block_size=51, subtract_constant=15)
    if preprocess_mode == "scan-background-normalized":
        normalized = _normalize_scan_background(
            candidate,
            blur_radius=_SCAN_BACKGROUND_NORMALIZATION_BLUR_RADIUS,
            contrast_scale=_SCAN_BACKGROUND_NORMALIZATION_CONTRAST_SCALE,
            closing_size=_SCAN_BACKGROUND_NORMALIZATION_CLOSING_SIZE,
        )
        if _should_use_tiled_threshold(normalized):
            return _threshold_image_in_overlapping_tiles(
                normalized,
                tile_size=_TILED_THRESHOLD_TILE_SIZE,
                overlap=_TILED_THRESHOLD_OVERLAP,
                threshold_fn=lambda tile: _sauvola_threshold(
                    tile,
                    block_size=41,
                    k=0.25,
                ),
            )
        return _sauvola_threshold(normalized, block_size=41, k=0.25)
    if preprocess_mode == "scan-sauvola":
        if _should_use_tiled_threshold(candidate):
            return _threshold_image_in_overlapping_tiles(
                candidate,
                tile_size=_TILED_THRESHOLD_TILE_SIZE,
                overlap=_TILED_THRESHOLD_OVERLAP,
                threshold_fn=lambda tile: _sauvola_threshold(
                    tile,
                    block_size=41,
                    k=0.25,
                ),
            )
        return _sauvola_threshold(candidate, block_size=41, k=0.25)
    if preprocess_mode == "scan-morphology":
        effective_threshold = _otsu_threshold(candidate)
        binary = candidate.point(lambda value: 255 if value >= effective_threshold else 0)
        return _morphological_cleanup_binary(binary, min_component_pixels=6)
    return candidate.point(lambda value: 255 if value >= binarize_threshold else 0)


def _otsu_threshold(image: Any) -> int:
    grayscale = image.convert("L")
    histogram = grayscale.histogram()
    total = sum(histogram)
    if total <= 0:
        return 128
    weighted_sum = sum(value * count for value, count in enumerate(histogram))
    background_weight = 0
    background_sum = 0.0
    best_threshold = 128
    best_variance = -1.0
    for value, count in enumerate(histogram):
        background_weight += count
        if background_weight == 0:
            continue
        foreground_weight = total - background_weight
        if foreground_weight == 0:
            break
        background_sum += float(value * count)
        background_mean = background_sum / float(background_weight)
        foreground_mean = (weighted_sum - background_sum) / float(foreground_weight)
        between_class_variance = (
            float(background_weight)
            * float(foreground_weight)
            * (background_mean - foreground_mean) ** 2
        )
        if between_class_variance > best_variance:
            best_variance = between_class_variance
            best_threshold = value
    return best_threshold


def _normalize_scan_background(
    image: Any,
    *,
    blur_radius: float,
    contrast_scale: float,
    closing_size: int,
) -> Any:
    if Image is None or ImageFilter is None or ImageOps is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    grayscale = image.convert("L")
    background = grayscale.filter(ImageFilter.GaussianBlur(radius=max(1.0, blur_radius)))
    if closing_size >= 3 and closing_size % 2 == 1:
        background = background.filter(ImageFilter.MaxFilter(size=closing_size)).filter(
            ImageFilter.MinFilter(size=closing_size)
        )
    normalized = Image.new("L", grayscale.size, color=255)
    source_pixels = grayscale.load()
    background_pixels = background.load()
    normalized_pixels = normalized.load()
    for y in range(grayscale.height):
        for x in range(grayscale.width):
            background_value = int(background_pixels[x, y])
            source_value = int(source_pixels[x, y])
            adjusted = 255 + int(round((source_value - background_value) * contrast_scale))
            normalized_pixels[x, y] = max(0, min(255, adjusted))
    return ImageOps.autocontrast(normalized)


def _adaptive_gaussian_threshold(
    image: Any,
    *,
    block_size: int,
    subtract_constant: int,
) -> Any:
    if Image is None or ImageFilter is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    if block_size < 3 or block_size % 2 == 0:
        raise ValueError("block_size must be an odd integer >= 3")
    grayscale = image.convert("L")
    radius = max(1.0, float(block_size - 1) / 6.0)
    blurred = grayscale.filter(ImageFilter.GaussianBlur(radius=radius))
    binary = Image.new("L", grayscale.size, color=255)
    source_pixels = grayscale.load()
    blurred_pixels = blurred.load()
    binary_pixels = binary.load()
    for y in range(grayscale.height):
        for x in range(grayscale.width):
            local_threshold = max(0, min(255, int(blurred_pixels[x, y]) - subtract_constant))
            binary_pixels[x, y] = 255 if int(source_pixels[x, y]) > local_threshold else 0
    return binary


def _should_use_tiled_threshold(image: Any) -> bool:
    return (image.width * image.height) >= _TILED_THRESHOLD_MIN_PIXELS


def _tile_start_positions(length: int, tile_size: int, stride: int) -> list[int]:
    if length <= tile_size:
        return [0]
    starts = list(range(0, max(1, length - tile_size + 1), stride))
    last_start = length - tile_size
    if starts[-1] != last_start:
        starts.append(last_start)
    return starts


def _threshold_image_in_overlapping_tiles(
    image: Any,
    *,
    tile_size: int,
    overlap: int,
    threshold_fn: Callable[[Any], Any],
) -> Any:
    if Image is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    if overlap < 0 or overlap >= tile_size:
        raise ValueError("overlap must be >= 0 and less than tile_size")
    stride = tile_size - overlap
    x_starts = _tile_start_positions(image.width, tile_size, stride)
    y_starts = _tile_start_positions(image.height, tile_size, stride)
    stitched = Image.new("L", image.size, color=255)
    overlap_crop = overlap // 2
    for y_start in y_starts:
        for x_start in x_starts:
            x_end = min(image.width, x_start + tile_size)
            y_end = min(image.height, y_start + tile_size)
            tile = image.crop((x_start, y_start, x_end, y_end))
            thresholded_tile = threshold_fn(tile).convert("L")
            left_crop = 0 if x_start == 0 else overlap_crop
            top_crop = 0 if y_start == 0 else overlap_crop
            right_crop = thresholded_tile.width if x_end == image.width else thresholded_tile.width - overlap_crop
            bottom_crop = thresholded_tile.height if y_end == image.height else thresholded_tile.height - overlap_crop
            cropped_tile = thresholded_tile.crop((left_crop, top_crop, right_crop, bottom_crop))
            stitched.paste(cropped_tile, (x_start + left_crop, y_start + top_crop))
    return stitched


def _sauvola_threshold(
    image: Any,
    *,
    block_size: int,
    k: float,
    dynamic_range: float = 128.0,
) -> Any:
    if Image is None or ImageFilter is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    if block_size < 3 or block_size % 2 == 0:
        raise ValueError("block_size must be an odd integer >= 3")
    if dynamic_range <= 0:
        raise ValueError("dynamic_range must be greater than 0")
    grayscale = image.convert("L")
    radius = max(1, (block_size - 1) // 2)
    local_mean = grayscale.filter(ImageFilter.BoxBlur(radius=radius))
    squared = grayscale.point(lambda value: int(round((value * value) / 255.0)))
    local_squared_mean = squared.filter(ImageFilter.BoxBlur(radius=radius))
    binary = Image.new("L", grayscale.size, color=255)
    source_pixels = grayscale.load()
    mean_pixels = local_mean.load()
    squared_mean_pixels = local_squared_mean.load()
    binary_pixels = binary.load()
    for y in range(grayscale.height):
        for x in range(grayscale.width):
            mean = float(mean_pixels[x, y])
            squared_mean = float(squared_mean_pixels[x, y]) * 255.0
            variance = max(0.0, squared_mean - (mean * mean))
            stddev = math.sqrt(variance)
            threshold = mean * (1.0 + (k * ((stddev / dynamic_range) - 1.0)))
            binary_pixels[x, y] = 255 if float(source_pixels[x, y]) > threshold else 0
    return binary


def _morphological_cleanup_binary(binary_image: Any, *, min_component_pixels: int) -> Any:
    if Image is None or ImageFilter is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    opened = binary_image.filter(ImageFilter.MinFilter(size=3)).filter(ImageFilter.MaxFilter(size=3))
    closed = opened.filter(ImageFilter.MaxFilter(size=3)).filter(ImageFilter.MinFilter(size=3))
    return _remove_small_black_components(closed, min_component_pixels=min_component_pixels)


def _remove_small_black_components(image: Any, *, min_component_pixels: int) -> Any:
    if min_component_pixels <= 1:
        return image
    cleaned = image.copy()
    pixels = cleaned.load()
    width, height = cleaned.size
    visited = bytearray(width * height)

    def _index(x: int, y: int) -> int:
        return (y * width) + x

    for y in range(height):
        for x in range(width):
            idx = _index(x, y)
            if visited[idx] or int(pixels[x, y]) >= 128:
                continue
            stack = [(x, y)]
            component: list[tuple[int, int]] = []
            visited[idx] = 1
            while stack:
                cx, cy = stack.pop()
                component.append((cx, cy))
                for ny in range(max(0, cy - 1), min(height - 1, cy + 1) + 1):
                    for nx in range(max(0, cx - 1), min(width - 1, cx + 1) + 1):
                        neighbor_idx = _index(nx, ny)
                        if visited[neighbor_idx] or int(pixels[nx, ny]) >= 128:
                            continue
                        visited[neighbor_idx] = 1
                        stack.append((nx, ny))
            if len(component) >= min_component_pixels:
                continue
            for cx, cy in component:
                pixels[cx, cy] = 255
    return cleaned


def _preprocess_candidate(
    denoised: Any,
    preprocess_mode: str,
    deskew_max_angle: float,
    deskew_angle_step: float,
    binarize_threshold: int,
) -> Any:
    if preprocess_mode == "deskew":
        skew_angle = _estimate_skew_angle(
            denoised,
            max_angle=deskew_max_angle,
            angle_step=deskew_angle_step,
        )
        return denoised.rotate(skew_angle, expand=True, fillcolor=255)
    if preprocess_mode == "dewarp":
        skew_angle = _estimate_skew_angle(
            denoised,
            max_angle=deskew_max_angle,
            angle_step=deskew_angle_step,
        )
        deskewed = denoised.rotate(skew_angle, expand=True, fillcolor=255)
        return _dewarp_by_row_shift(deskewed, binarize_threshold)
    return denoised


def _parse_ocr_dependencies(kwargs: dict[str, Any]) -> OCRDependencies:
    return OCRDependencies(
        run_command=kwargs.pop("run_command", _run_command),
        preprocess_image=kwargs.pop("preprocess_image", _preprocess_image),
        paddle_reader_factory=kwargs.pop("paddle_reader_factory", _build_paddleocr_reader),
        which=kwargs.pop("which", shutil.which),
        llm_corrector=kwargs.pop("llm_corrector", None),
        llm_suspicious_section_analyzer=kwargs.pop("llm_suspicious_section_analyzer", None),
    )


def _parse_ocr_options(kwargs: dict[str, Any]) -> OCRRunOptions:
    page_artifacts_dir = kwargs.pop("page_artifacts_dir", None)
    if page_artifacts_dir is not None and not isinstance(page_artifacts_dir, Path):
        page_artifacts_dir = Path(str(page_artifacts_dir))
    raw_cleanup_lexicon_texts = kwargs.pop("cleanup_lexicon_texts", ())
    cleanup_lexicon_texts = tuple(str(value) for value in raw_cleanup_lexicon_texts)
    core_options = OCRCoreOptions(
        language=str(kwargs.pop("language", "eng")),
        dpi=int(kwargs.pop("dpi", 300)),
        apply_cleanup=bool(kwargs.pop("apply_cleanup", True)),
        binarize_threshold=int(kwargs.pop("binarize_threshold", 190)),
        deskew_max_angle=float(kwargs.pop("deskew_max_angle", 7.0)),
        deskew_angle_step=float(kwargs.pop("deskew_angle_step", 0.5)),
        tesseract_psm=_normalize_tesseract_psm(kwargs.pop("tesseract_psm", "auto")),
        tesseract_output_format=str(kwargs.pop("tesseract_output_format", "text")).strip().lower(),
        cleanup_lexicon_texts=cleanup_lexicon_texts,
        confidence_aware_cleanup=bool(kwargs.pop("confidence_aware_cleanup", False)),
        cleanup_high_confidence_threshold=float(kwargs.pop("cleanup_high_confidence_threshold", 95.0)),
        orientation_fallback=bool(kwargs.pop("orientation_fallback", False)),
        tiered_ocr_fallback=bool(kwargs.pop("tiered_ocr_fallback", False)),
        tiered_ocr_min_score=float(kwargs.pop("tiered_ocr_min_score", 200.0)),
        layout_region_detection=bool(kwargs.pop("layout_region_detection", False)),
        llm_post_correction=bool(kwargs.pop("llm_post_correction", False)),
        llm_min_low_confidence_ratio=float(kwargs.pop("llm_min_low_confidence_ratio", 0.08)),
        llm_max_word_delta_ratio=float(kwargs.pop("llm_max_word_delta_ratio", 0.2)),
        llm_suspicious_sections=bool(kwargs.pop("llm_suspicious_sections", False)),
        llm_suspicious_max_candidates=int(kwargs.pop("llm_suspicious_max_candidates", 12)),
        llm_suspicious_max_sections=int(kwargs.pop("llm_suspicious_max_sections", 6)),
        inverse_render_rerank=bool(kwargs.pop("inverse_render_rerank", False)),
        inverse_render_top_k=int(kwargs.pop("inverse_render_top_k", 3)),
        inverse_render_workers=int(kwargs.pop("inverse_render_workers", 1)),
        verify_cleanup_spans=bool(kwargs.pop("verify_cleanup_spans", False)),
    )
    return OCRRunOptions(
        core=core_options,
        preprocess_mode=str(kwargs.pop("preprocess_mode", "basic")),
        ocr_engine=str(kwargs.pop("ocr_engine", "tesseract")),
        emit_page_artifacts=bool(kwargs.pop("emit_page_artifacts", True)),
        page_artifacts_dir=page_artifacts_dir,
        progress_callback=kwargs.pop("progress_callback", None),
    )


def _ensure_no_unknown_kwargs(kwargs: dict[str, Any], function_name: str) -> None:
    if not kwargs:
        return
    unknown = ", ".join(sorted(kwargs))
    raise TypeError(f"{function_name} got unexpected keyword arguments: {unknown}")


def _normalize_tesseract_psm(value: Any) -> str:
    normalized = str(value).strip().lower()
    return "auto" if normalized == "auto" else str(int(value))


def _validate_common_ocr_options(
    options: OCRRunOptions,
    which: Callable[[str], str | None],
) -> None:
    # lizard forgive: validation stays explicit so CLI errors remain precise.
    if options.preprocess_mode not in _VALID_PREPROCESS_MODES:
        raise ValueError(
            "preprocess_mode must be 'none', 'scan', 'scan-local-threshold', "
            "'scan-background-normalized', "
            "'scan-sauvola', 'scan-morphology', "
            "'basic', 'deskew', 'dewarp', or 'auto'"
        )
    if options.ocr_engine not in {"tesseract", "paddleocr", "ensemble"}:
        raise ValueError("ocr_engine must be 'tesseract', 'paddleocr', or 'ensemble'")
    if options.core.tesseract_output_format not in {"text", "hocr"}:
        raise ValueError("tesseract_output_format must be 'text' or 'hocr'")
    if not 0.0 <= options.core.cleanup_high_confidence_threshold <= 100.0:
        raise ValueError("cleanup_high_confidence_threshold must be between 0 and 100")
    if options.core.tiered_ocr_min_score <= 0:
        raise ValueError("tiered_ocr_min_score must be greater than 0")
    if not 0.0 <= options.core.llm_min_low_confidence_ratio <= 1.0:
        raise ValueError("llm_min_low_confidence_ratio must be between 0 and 1")
    if not 0.0 < options.core.llm_max_word_delta_ratio <= 1.0:
        raise ValueError("llm_max_word_delta_ratio must be greater than 0 and at most 1")
    if options.core.llm_suspicious_max_candidates <= 0:
        raise ValueError("llm_suspicious_max_candidates must be greater than 0")
    if options.core.llm_suspicious_max_sections <= 0:
        raise ValueError("llm_suspicious_max_sections must be greater than 0")
    if not 0 <= options.core.binarize_threshold <= 255:
        raise ValueError("binarize_threshold must be between 0 and 255")
    if options.core.deskew_max_angle <= 0:
        raise ValueError("deskew_max_angle must be greater than 0")
    if options.core.deskew_angle_step <= 0:
        raise ValueError("deskew_angle_step must be greater than 0")
    if options.core.inverse_render_top_k <= 0:
        raise ValueError("inverse_render_top_k must be greater than 0")
    if options.core.inverse_render_workers <= 0:
        raise ValueError("inverse_render_workers must be greater than 0")
    if options.core.tesseract_psm != "auto":
        psm_value = int(options.core.tesseract_psm)
        if not 0 <= psm_value <= 13:
            raise ValueError("tesseract_psm must be 'auto' or an integer between 0 and 13")
    if options.ocr_engine in {"tesseract", "ensemble"} and which("tesseract") is None:
        raise RuntimeError("Missing dependency: tesseract")


def _validate_ocr_run_options(
    pdf_path: Path,
    options: OCRRunOptions,
    which: Callable[[str], str | None],
) -> None:
    _validate_common_ocr_options(options, which)
    if which("pdftoppm") is None:
        raise RuntimeError("Missing dependency: pdftoppm")
    if not pdf_path.exists():
        raise FileNotFoundError(f"Input PDF not found: {pdf_path}")


def _validate_page_image_run_options(
    page_images: list[Path],
    options: OCRRunOptions,
    which: Callable[[str], str | None],
) -> None:
    _validate_common_ocr_options(options, which)
    if not page_images:
        raise ValueError("page_images must include at least one image path")
    missing_images = [str(path) for path in page_images if not path.exists()]
    if missing_images:
        raise FileNotFoundError(f"Input page images not found: {', '.join(missing_images)}")
    for page_image in page_images:
        validate_raster_image(page_image, context="ocr-page-images rejected")


def _pdf_page_count(pdf_path: Path) -> int | None:
    try:
        completed = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    for line in completed.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", maxsplit=1)[1].strip())
    return None


def _rasterize_pdf_to_images(
    pdf_path: Path,
    work_dir: Path,
    dpi: int,
    run_command: Callable[[list[str], bool], str],
    progress_callback: Callable[[dict[str, object]], None] | None = None,
) -> list[Path]:
    pages_dir = work_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    page_prefix = pages_dir / "page"
    command = [
        "pdftoppm",
        "-r",
        str(dpi),
        "-gray",
        "-png",
        str(pdf_path),
        str(page_prefix),
    ]
    if progress_callback is not None and run_command is _run_command:
        total_pages = _pdf_page_count(pdf_path)
        if total_pages is not None:
            started_at = time.monotonic()
            process = subprocess.Popen(command)  # noqa: S603
            last_reported = -1
            while True:
                completed_pages = len(list(pages_dir.glob("page-*.png")))
                if completed_pages != last_reported:
                    _emit_progress(
                        progress_callback,
                        _timed_page_progress_payload(
                            stage="rasterize",
                            total_pages=total_pages,
                            completed_pages=min(completed_pages, total_pages),
                            status="complete" if completed_pages >= total_pages else "running",
                            current_page_index=completed_pages + 1 if completed_pages < total_pages else None,
                            started_at=started_at,
                        ),
                    )
                    last_reported = completed_pages
                if process.poll() is not None:
                    if process.returncode != 0:
                        raise subprocess.CalledProcessError(process.returncode, command)
                    break
                time.sleep(1.0)
        else:
            run_command(command, False)
    else:
        run_command(command, False)
    page_images = sorted(pages_dir.glob("page-*.png"))
    if not page_images:
        raise RuntimeError("pdftoppm produced no page images")
    return page_images


def _prepare_artifacts_dir(work_dir: Path, options: OCRRunOptions) -> Path:
    artifacts_dir = options.page_artifacts_dir or (work_dir / "page_ocr")
    if options.emit_page_artifacts:
        artifacts_dir.mkdir(parents=True, exist_ok=True)
    return artifacts_dir


def _cleanup_span_changes(raw_text: str, cleaned_text: str) -> list[_CleanupSpanChange]:
    # lizard forgive: cleanup-span filtering is intentionally explicit for verifier safety.
    raw_matches = list(_NON_SPACE_TOKEN.finditer(raw_text))
    cleaned_matches = list(_NON_SPACE_TOKEN.finditer(cleaned_text))
    matcher = SequenceMatcher(
        a=[match.group(0) for match in raw_matches],
        b=[match.group(0) for match in cleaned_matches],
        autojunk=False,
    )
    changes: list[_CleanupSpanChange] = []
    for tag, raw_start_index, raw_end_index, cleaned_start_index, cleaned_end_index in matcher.get_opcodes():
        if tag == "equal" or raw_start_index == raw_end_index or cleaned_start_index == cleaned_end_index:
            continue
        raw_token_count = raw_end_index - raw_start_index
        cleaned_token_count = cleaned_end_index - cleaned_start_index
        if max(raw_token_count, cleaned_token_count) > _CLEANUP_SPAN_VERIFIER_MAX_TOKENS:
            continue
        raw_start = raw_matches[raw_start_index].start()
        raw_end = raw_matches[raw_end_index - 1].end()
        cleaned_start = cleaned_matches[cleaned_start_index].start()
        cleaned_end = cleaned_matches[cleaned_end_index - 1].end()
        raw_span = raw_text[raw_start:raw_end]
        cleaned_span = cleaned_text[cleaned_start:cleaned_end]
        if "\n" in raw_span or "\n" in cleaned_span:
            continue
        if not _LATIN_TOKEN.search(raw_span) or not _LATIN_TOKEN.search(cleaned_span):
            continue
        changes.append(
            _CleanupSpanChange(
                raw_start=raw_start,
                raw_end=raw_end,
                cleaned_start=cleaned_start,
                cleaned_end=cleaned_end,
                raw_text=raw_span,
                cleaned_text=cleaned_span,
                raw_token_count=raw_token_count,
                cleaned_token_count=cleaned_token_count,
                raw_token_start_index=raw_start_index,
                raw_token_end_index=raw_end_index,
            )
        )
    return changes


def _candidate_preprocess_modes(preprocess_mode: str) -> tuple[str, ...]:
    if preprocess_mode == "auto":
        candidates: list[str] = []
        for candidate in _AUTO_PREPROCESS_MODES:
            candidates.append(candidate)
            if candidate in _AUTO_MASKED_PREPROCESS_MODES:
                candidates.append(_masked_preprocess_mode(candidate))
        return tuple(candidates)
    return (preprocess_mode,)


def _candidate_preprocess_modes_for_options(options: OCRRunOptions) -> tuple[str, ...]:
    if options.candidate_preprocess_modes_override:
        return options.candidate_preprocess_modes_override
    return _candidate_preprocess_modes(options.preprocess_mode)


def _candidate_tesseract_psms(options: OCRRunOptions) -> tuple[str, ...]:
    if options.ocr_engine not in {"tesseract", "ensemble"}:
        return ("",)
    if options.candidate_tesseract_psms_override:
        return options.candidate_tesseract_psms_override
    if options.core.tesseract_psm == "auto":
        return _AUTO_TESSERACT_PSMS
    return (options.core.tesseract_psm,)


def _prepare_ocr_input_path(
    image_path: Path,
    preprocess_mode: str,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    preprocessed_dir: Path,
    prepared_inputs: dict[str, Path],
) -> Path:
    if preprocess_mode == "none":
        return image_path
    cached_path = prepared_inputs.get(preprocess_mode)
    if cached_path is not None:
        return cached_path
    preprocessed_path = preprocessed_dir / preprocess_mode / image_path.name
    dependencies.preprocess_image(
        image_path,
        preprocessed_path,
        preprocess_mode,
        options.core.binarize_threshold,
        options.core.deskew_max_angle,
        options.core.deskew_angle_step,
    )
    prepared_inputs[preprocess_mode] = preprocessed_path
    return preprocessed_path


def _score_text_quality(stripped: str, language: str) -> float:
    # lizard forgive: OCR text scoring combines several small heuristics by design.
    if not stripped:
        return -1_000_000.0
    token_matches = _LATIN_TOKEN.findall(stripped)
    if not token_matches:
        return -500_000.0
    alpha_chars = sum(1 for char in stripped if char.isalpha())
    space_chars = sum(1 for char in stripped if char.isspace())
    digit_chars = sum(1 for char in stripped if char.isdigit())
    noisy_chars = len(_NON_TEXT_CHAR.findall(stripped))
    common_word_bonus = 0.0
    if language.lower().strip() in {"eng", "en"}:
        common_word_bonus = float(
            sum(1 for token in token_matches if token.lower() in _COMMON_ENGLISH_WORDS)
        )
    avg_token_length = sum(len(token) for token in token_matches) / len(token_matches)
    token_length_penalty = abs(avg_token_length - 5.0) * 3.0
    return (
        float(alpha_chars) * 1.4
        + float(space_chars) * 0.4
        + common_word_bonus * 10.0
        - float(digit_chars) * 0.3
        - float(noisy_chars) * 18.0
        - token_length_penalty
    )


def _score_ocr_text(text: str, language: str, cleanup_lexicon_texts: tuple[str, ...]) -> float:
    cleaned_text = cleanup_ocr_text(text, lexicon_texts=cleanup_lexicon_texts).strip()
    return _score_text_quality(cleaned_text, language)


def _hocr_candidate_score_adjustment(ocr_metadata: dict[str, object]) -> float:
    raw_confidence_mean = ocr_metadata.get("hocr_confidence_mean")
    confidence_mean = (
        float(raw_confidence_mean)
        if isinstance(raw_confidence_mean, (int, float))
        else None
    )
    raw_low_confidence_ratio = ocr_metadata.get("hocr_low_confidence_ratio")
    low_confidence_ratio = (
        float(raw_low_confidence_ratio)
        if isinstance(raw_low_confidence_ratio, (int, float))
        else None
    )
    adjustment = 0.0
    if confidence_mean is not None:
        adjustment += (confidence_mean - 50.0) * 0.5
    if low_confidence_ratio is not None:
        adjustment -= low_confidence_ratio * 60.0
    return adjustment


def _score_ocr_candidate(
    text: str,
    language: str,
    cleanup_lexicon_texts: tuple[str, ...],
    ocr_metadata: dict[str, object] | None = None,
) -> tuple[float, dict[str, object]]:
    raw_text = text.strip()
    cleaned_text = cleanup_ocr_text(text, lexicon_texts=cleanup_lexicon_texts).strip()
    raw_score = _score_text_quality(raw_text, language)
    cleaned_score = _score_text_quality(cleaned_text, language)
    cleanup_changed_text = cleaned_text != raw_text
    lexical_score = (
        cleaned_score if not cleanup_changed_text else (cleaned_score * 0.7) + (raw_score * 0.3)
    )
    confidence_adjustment = (
        _hocr_candidate_score_adjustment(ocr_metadata)
        if isinstance(ocr_metadata, dict)
        else 0.0
    )
    score = lexical_score + confidence_adjustment
    return score, {
        "raw_text_score": raw_score,
        "cleaned_text_score": cleaned_score,
        "lexical_candidate_score": lexical_score,
        "hocr_confidence_adjustment": confidence_adjustment,
        "cleanup_changed_text": cleanup_changed_text,
    }


def _fontconfig_match(family: str) -> str | None:
    try:
        completed = subprocess.run(
            ["fc-match", "-f", "%{file}", family],
            check=True,
            text=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    path = completed.stdout.strip()
    return path or None


def _inverse_render_font_paths() -> tuple[str, ...]:
    candidates = [
        _fontconfig_match("serif"),
        _fontconfig_match("sans"),
        _fontconfig_match("monospace"),
        *_DEFAULT_RENDER_FONT_CANDIDATES,
    ]
    unique_paths: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        path = str(candidate)
        if path in seen or not Path(path).exists():
            continue
        seen.add(path)
        unique_paths.append(path)
    return tuple(unique_paths)


@lru_cache(maxsize=64)
def _load_inverse_render_font(font_path: str | None, font_size: int) -> Any:
    if ImageFont is None:
        raise RuntimeError(
            "Missing dependency for inverse-render reranking: pillow. "
            "Install with `pip install pillow` or disable inverse-render reranking."
        )
    if font_path is not None:
        try:
            return ImageFont.truetype(font_path, font_size)
        except OSError:
            pass
    return ImageFont.load_default()


def _normalize_scan_for_inverse_render(image_path: Path) -> tuple[Any, tuple[int, int, int, int]]:
    if Image is None or ImageFilter is None or ImageOps is None:
        raise RuntimeError(
            "Missing dependency for inverse-render reranking: pillow. "
            "Install with `pip install pillow` or disable inverse-render reranking."
        )
    with Image.open(image_path) as image:
        gray = image.convert("L")
        contrasted = ImageOps.autocontrast(gray)
        denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
        threshold = _otsu_threshold(denoised)
        binary = denoised.point(lambda value: 255 if value >= threshold else 0, mode="L")
    inverted = ImageOps.invert(binary)
    bbox = inverted.getbbox()
    if bbox is None:
        width, height = binary.size
        margin_x = max(20, width // 12)
        margin_y = max(20, height // 12)
        bbox = (margin_x, margin_y, width - margin_x, height - margin_y)
    return binary, bbox


def _inverse_render_text_lines(text: str) -> list[str]:
    lines = [line.rstrip() for line in text.splitlines()]
    if not lines:
        stripped = text.strip()
        return [stripped] if stripped else []
    return lines


def _estimate_inverse_render_font_size(
    bbox: tuple[int, int, int, int],
    lines: list[str],
) -> int:
    line_count = max(1, sum(1 for line in lines if line.strip()))
    bbox_height = max(1, bbox[3] - bbox[1])
    estimated = int(round(bbox_height / max(1.0, (line_count * 1.45))))
    return max(12, min(estimated, 64))


def _wrap_render_line(
    draw: Any,
    font: Any,
    line: str,
    max_width: int,
) -> list[str]:
    stripped = line.strip()
    if not stripped:
        return [""]
    words = stripped.split()
    wrapped = [words[0]]
    for word in words[1:]:
        candidate = f"{wrapped[-1]} {word}"
        left, _top, right, _bottom = draw.textbbox((0, 0), candidate, font=font)
        if right - left <= max_width:
            wrapped[-1] = candidate
            continue
        wrapped.append(word)
    return wrapped


@lru_cache(maxsize=256)
def _wrapped_inverse_render_line_groups(
    text: str,
    font_path: str | None,
    font_size: int,
    max_width: int,
) -> tuple[tuple[str, ...], ...]:
    if Image is None or ImageDraw is None:
        raise RuntimeError(
            "Missing dependency for inverse-render reranking: pillow. "
            "Install with `pip install pillow` or disable inverse-render reranking."
        )
    font = _load_inverse_render_font(font_path, font_size)
    draw = ImageDraw.Draw(Image.new("L", (max(1, max_width), 1), color=255))
    wrapped_groups: list[tuple[str, ...]] = []
    for raw_line in _inverse_render_text_lines(text):
        wrapped_groups.append(tuple(_wrap_render_line(draw, font, raw_line, max_width)))
    return tuple(wrapped_groups)


def _render_inverse_text_image(
    text: str,
    canvas_size: tuple[int, int],
    bbox: tuple[int, int, int, int],
    *,
    font_path: str | None,
    font_size: int,
    offset_x: int,
    offset_y: int,
    rotation: float,
) -> Any:
    if Image is None or ImageDraw is None:
        raise RuntimeError(
            "Missing dependency for inverse-render reranking: pillow. "
            "Install with `pip install pillow` or disable inverse-render reranking."
        )
    canvas = Image.new("L", canvas_size, color=255)
    draw = ImageDraw.Draw(canvas)
    font = _load_inverse_render_font(font_path, font_size)
    max_width = max(1, bbox[2] - bbox[0])
    x = bbox[0] + offset_x
    y = bbox[1] + offset_y
    line_height = max(font_size + 6, int(round(font_size * 1.35)))
    for raw_line, wrapped_group in zip(
        _inverse_render_text_lines(text),
        _wrapped_inverse_render_line_groups(text, font_path, font_size, max_width),
        strict=True,
    ):
        for rendered_line in wrapped_group:
            if rendered_line:
                draw.text((x, y), rendered_line, font=font, fill=0)
            y += line_height
        if not raw_line.strip():
            y += line_height
    if abs(rotation) < 1e-9:
        return canvas
    return canvas.rotate(rotation, resample=_inverse_render_bicubic_resample(), fillcolor=255)


def _binary_ink_iou(observed_binary: Any, rendered_binary: Any) -> float:
    if ImageChops is None:
        observed_pixels = observed_binary.getdata()
        rendered_pixels = rendered_binary.getdata()
        overlap = 0
        union = 0
        for observed, rendered in zip(observed_pixels, rendered_pixels, strict=True):
            observed_ink = observed == 0
            rendered_ink = rendered == 0
            if observed_ink or rendered_ink:
                union += 1
                if observed_ink and rendered_ink:
                    overlap += 1
        if union == 0:
            return 0.0
        return float(overlap) / float(union)
    union = ImageChops.darker(observed_binary, rendered_binary).histogram()[0]
    if union == 0:
        return 0.0
    overlap = ImageChops.lighter(observed_binary, rendered_binary).histogram()[0]
    return float(overlap) / float(union)


def _inverse_render_bicubic_resample() -> Any:
    if Image is None:
        raise RuntimeError(
            "Missing dependency for inverse-render reranking: pillow. "
            "Install with `pip install pillow` or disable inverse-render reranking."
        )
    resampling_namespace = getattr(Image, "Resampling", Image)
    return getattr(resampling_namespace, "BICUBIC")


def _rotate_inverse_render_image(rendered_binary: Any, rotation: float) -> Any:
    if abs(rotation) < 1e-9:
        return rendered_binary
    return rendered_binary.rotate(rotation, resample=_inverse_render_bicubic_resample(), fillcolor=255)


def _best_inverse_render_rendered_batch(
    observed_binary: Any,
    rendered_candidates: list[Any],
    *,
    observed_bytes: bytes | None = None,
) -> tuple[int, float]:
    if not rendered_candidates:
        raise ValueError("rendered_candidates must not be empty")
    rust_accel = get_rust_inverse_render_accel()
    if rust_accel is not None:
        image_bytes = observed_bytes if observed_bytes is not None else observed_binary.tobytes()
        best_index, best_score = rust_accel.best_iou_score(
            image_bytes,
            [rendered_candidate.tobytes() for rendered_candidate in rendered_candidates],
        )
        return best_index, best_score
    best_index = 0
    best_score = -1.0
    for index, rendered_candidate in enumerate(rendered_candidates):
        score = _binary_ink_iou(observed_binary, rendered_candidate)
        if score > best_score:
            best_index = index
            best_score = score
    return best_index, best_score


def _inverse_render_score_candidate(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    text: str,
) -> tuple[float, dict[str, object]]:
    # pylint: disable=too-many-nested-blocks
    lines = _inverse_render_text_lines(text)
    if not lines:
        return -1.0, {"inverse_render_score": -1.0}
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
    best_score = -1.0
    best_metadata: dict[str, object] = {
        "inverse_render_score": -1.0,
        "inverse_render_bbox": list(bbox),
    }
    observed_region_bytes = observed_region.tobytes() if get_rust_inverse_render_accel() is not None else None
    rendered_candidates: list[Any] = []
    rendered_metadata: list[dict[str, object]] = []
    for font_path in render_fonts:
        for adjustment in _INVERSE_RENDER_SIZE_ADJUSTMENTS:
            font_size = max(10, base_font_size + adjustment)
            for offset_x in _INVERSE_RENDER_OFFSETS:
                for offset_y in _INVERSE_RENDER_OFFSETS:
                    base_rendered = _render_inverse_text_image(
                        text,
                        observed_region.size,
                        local_bbox,
                        font_path=font_path,
                        font_size=font_size,
                        offset_x=offset_x,
                        offset_y=offset_y,
                        rotation=0.0,
                    )
                    rendered_candidates.extend(
                        [
                            base_rendered if abs(rotation) < 1e-9 else _rotate_inverse_render_image(base_rendered, rotation)
                            for rotation in _INVERSE_RENDER_ROTATIONS
                        ]
                    )
                    rendered_metadata.extend(
                        [
                            {
                                "inverse_render_score": -1.0,
                                "inverse_render_bbox": list(bbox),
                                "inverse_render_font_path": font_path,
                                "inverse_render_font_size": font_size,
                                "inverse_render_offset_x": offset_x,
                                "inverse_render_offset_y": offset_y,
                                "inverse_render_rotation": rotation,
                            }
                            for rotation in _INVERSE_RENDER_ROTATIONS
                        ]
                    )
    best_index, best_score = _best_inverse_render_rendered_batch(
        observed_region,
        rendered_candidates,
        observed_bytes=observed_region_bytes,
    )
    best_metadata = dict(rendered_metadata[best_index])
    best_metadata["inverse_render_score"] = best_score
    return best_score, best_metadata


def _score_inverse_render_request(
    request: _InverseRenderScoreRequest,
) -> tuple[float, dict[str, object]]:
    return _inverse_render_score_candidate(
        request.observed_binary,
        request.bbox,
        request.text,
    )


def _inverse_render_score_many(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    texts: list[str],
    *,
    workers: int,
) -> list[tuple[float, dict[str, object]]]:
    if workers <= 1 or len(texts) <= 1:
        return [_inverse_render_score_candidate(observed_binary, bbox, text) for text in texts]
    requests = [
        _InverseRenderScoreRequest(
            observed_binary=observed_binary,
            bbox=bbox,
            text=text,
        )
        for text in texts
    ]
    worker_count = min(workers, len(requests))
    with ProcessPoolExecutor(max_workers=worker_count) as executor:
        return list(executor.map(_score_inverse_render_request, requests))


def _render_inverse_text_from_metadata(
    text: str,
    canvas_size: tuple[int, int],
    metadata: dict[str, object],
) -> Any:
    bbox_values = metadata.get("inverse_render_bbox")
    if not isinstance(bbox_values, (list, tuple)) or len(bbox_values) != 4:
        raise ValueError("inverse render metadata did not include a valid bbox")
    bbox = tuple(int(value) for value in bbox_values)
    return _render_inverse_text_image(
        text,
        canvas_size,
        bbox,
        font_path=str(metadata["inverse_render_font_path"])
        if metadata.get("inverse_render_font_path") is not None
        else None,
        font_size=int(metadata["inverse_render_font_size"]),
        offset_x=int(metadata["inverse_render_offset_x"]),
        offset_y=int(metadata["inverse_render_offset_y"]),
        rotation=float(metadata["inverse_render_rotation"]),
    )


def _bbox_area(bbox: tuple[int, int, int, int]) -> int:
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def _expand_bbox(
    bbox: tuple[int, int, int, int],
    canvas_size: tuple[int, int],
    padding: int,
) -> tuple[int, int, int, int]:
    width, height = canvas_size
    return (
        max(0, bbox[0] - padding),
        max(0, bbox[1] - padding),
        min(width, bbox[2] + padding),
        min(height, bbox[3] + padding),
    )


def _cleanup_span_diff_bbox(raw_render: Any, cleaned_render: Any) -> tuple[int, int, int, int] | None:
    if ImageChops is None:
        raise RuntimeError(
            "Missing dependency for cleanup span verification: pillow. "
            "Install with `pip install pillow` or disable cleanup span verification."
        )
    return ImageChops.difference(raw_render, cleaned_render).getbbox()


def _evaluate_cleanup_span_replacement(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    raw_text: str,
    cleaned_text: str,
    hint_bbox: tuple[int, int, int, int] | None = None,
    *,
    inverse_render_workers: int = 1,
) -> tuple[bool, dict[str, object]]:
    raw_score_payload, cleaned_score_payload = _inverse_render_score_many(
        observed_binary,
        bbox,
        [raw_text, cleaned_text],
        workers=inverse_render_workers,
    )
    raw_score, raw_metadata = raw_score_payload
    cleaned_score, _cleaned_metadata = cleaned_score_payload
    raw_render = _render_inverse_text_from_metadata(raw_text, observed_binary.size, raw_metadata)
    cleaned_render = _render_inverse_text_from_metadata(cleaned_text, observed_binary.size, raw_metadata)
    if hint_bbox is None:
        diff_bbox = _cleanup_span_diff_bbox(raw_render, cleaned_render)
        if diff_bbox is None:
            return False, {
                "accepted": False,
                "reason": "no-local-image-difference",
                "raw_inverse_render_score": raw_score,
                "cleaned_inverse_render_score": cleaned_score,
            }
        local_bbox = _expand_bbox(diff_bbox, observed_binary.size, _CLEANUP_SPAN_VERIFIER_DIFF_PADDING)
    else:
        local_bbox = _expand_bbox(hint_bbox, observed_binary.size, _CLEANUP_SPAN_VERIFIER_DIFF_PADDING)
    full_area = _bbox_area(bbox)
    local_area_ratio = (
        float(_bbox_area(local_bbox)) / float(full_area)
        if full_area > 0
        else 1.0
    )
    if local_area_ratio > _CLEANUP_SPAN_VERIFIER_MAX_AREA_RATIO:
        return False, {
            "accepted": False,
            "reason": "diff-region-too-large",
            "raw_inverse_render_score": raw_score,
            "cleaned_inverse_render_score": cleaned_score,
            "local_bbox": list(local_bbox),
            "local_area_ratio": local_area_ratio,
        }
    observed_crop = observed_binary.crop(local_bbox)
    raw_local_score = _binary_ink_iou(observed_crop, raw_render.crop(local_bbox))
    cleaned_local_score = _binary_ink_iou(observed_crop, cleaned_render.crop(local_bbox))
    accepted = (
        cleaned_local_score >= raw_local_score + _CLEANUP_SPAN_VERIFIER_LOCAL_MARGIN
        and cleaned_score >= raw_score + _CLEANUP_SPAN_VERIFIER_GLOBAL_MARGIN
    )
    return accepted, {
        "accepted": accepted,
        "reason": "accepted" if accepted else "insufficient-image-margin",
        "raw_inverse_render_score": raw_score,
        "cleaned_inverse_render_score": cleaned_score,
        "raw_local_inverse_render_score": raw_local_score,
        "cleaned_local_inverse_render_score": cleaned_local_score,
        "local_bbox": list(local_bbox),
        "local_area_ratio": local_area_ratio,
    }


def _maybe_verify_cleanup_spans(
    image_path: Path,
    text: str,
    options: OCRRunOptions,
    selection_metadata: dict[str, object],
) -> tuple[str, dict[str, object]]:
    if not options.core.apply_cleanup:
        return text, {}
    if options.core.confidence_aware_cleanup:
        mean_confidence = selection_metadata.get("hocr_confidence_mean")
        if isinstance(mean_confidence, (float, int)):
            mean_confidence_value = float(mean_confidence)
            if mean_confidence_value >= options.core.cleanup_high_confidence_threshold:
                return text, {
                    "cleanup_confidence_gate": {
                        "enabled": True,
                        "action": "skipped-cleanup",
                        "mean_confidence": mean_confidence_value,
                        "threshold": options.core.cleanup_high_confidence_threshold,
                    }
                }
    cleaned_text = cleanup_ocr_text(text, lexicon_texts=options.core.cleanup_lexicon_texts)
    # Auto-enable span verification for scan modes: they have a real binarised scan
    # image available, so inverse render can judge whether each cleanup change is correct.
    verify = options.core.verify_cleanup_spans or _uses_scan_preprocess_stack(options.preprocess_mode)
    if not verify or cleaned_text == text:
        return cleaned_text, {}
    changes = _cleanup_span_changes(text, cleaned_text)
    if not changes:
        return cleaned_text, {
            "cleanup_span_verifier": {
                "enabled": True,
                "changes_considered": 0,
                "changes_kept": 0,
                "changes_reverted": 0,
            }
        }
    observed_binary: Any | None = None
    bbox: tuple[int, int, int, int] | None = None
    verified_text = cleaned_text
    decisions: list[dict[str, object]] = []
    reverted_count = 0
    for change in reversed(changes):
        if observed_binary is None or bbox is None:
            observed_binary, bbox = _normalize_scan_for_inverse_render(image_path)
        raw_variant = (
            verified_text[:change.cleaned_start]
            + change.raw_text
            + verified_text[change.cleaned_end:]
        )
        hint_bbox = _hocr_bbox_hint_for_change(change, selection_metadata)
        if hint_bbox is None:
            keep_cleaned, decision = _evaluate_cleanup_span_replacement(
                observed_binary,
                bbox,
                raw_variant,
                verified_text,
                inverse_render_workers=options.core.inverse_render_workers,
            )
        else:
            keep_cleaned, decision = _evaluate_cleanup_span_replacement(
                observed_binary,
                bbox,
                raw_variant,
                verified_text,
                hint_bbox=hint_bbox,
                inverse_render_workers=options.core.inverse_render_workers,
            )
        decision.update(
            {
                "raw_text": change.raw_text,
                "cleaned_text": change.cleaned_text,
                "raw_token_count": change.raw_token_count,
                "cleaned_token_count": change.cleaned_token_count,
            }
        )
        if hint_bbox is not None:
            decision["hocr_hint_bbox"] = list(hint_bbox)
        decisions.append(decision)
        if keep_cleaned:
            continue
        if (
            decision.get("reason") == "insufficient-image-margin"
            and is_known_word_correction(change.raw_text, change.cleaned_text)
        ):
            decision["accepted"] = True
            decision["reason"] = "accepted-known-word-correction"
            decision["accepted_without_image_margin"] = True
            continue
        verified_text = raw_variant
        reverted_count += 1
    decisions.reverse()
    return verified_text, {
        "cleanup_span_verifier": {
            "enabled": True,
            "changes_considered": len(changes),
            "changes_kept": len(changes) - reverted_count,
            "changes_reverted": reverted_count,
            "decisions": decisions,
        }
    }


def _hocr_bbox_hint_for_change(
    change: _CleanupSpanChange,
    selection_metadata: dict[str, object],
) -> tuple[int, int, int, int] | None:
    payload = selection_metadata.get("hocr_word_boxes_runtime")
    if not isinstance(payload, list):
        return None
    if change.raw_token_end_index <= change.raw_token_start_index:
        return None
    if change.raw_token_end_index > len(payload):
        return None
    candidate_boxes: list[tuple[int, int, int, int]] = []
    for item in payload[change.raw_token_start_index : change.raw_token_end_index]:
        if (
            isinstance(item, (list, tuple))
            and len(item) == 4
            and all(isinstance(value, int) for value in item)
        ):
            left, top, right, bottom = (int(value) for value in item)
            if right > left and bottom > top:
                candidate_boxes.append((left, top, right, bottom))
    if not candidate_boxes:
        return None
    return (
        min(box[0] for box in candidate_boxes),
        min(box[1] for box in candidate_boxes),
        max(box[2] for box in candidate_boxes),
        max(box[3] for box in candidate_boxes),
    )


def _maybe_inverse_render_rerank(
    image_path: Path,
    candidates: list[OCRCandidate],
    options: OCRRunOptions,
) -> OCRCandidate | None:
    # lizard forgive: reranking compares OCR variants and keeps the choice logic centralized.
    if not options.core.inverse_render_rerank or len(candidates) < 2:
        return None
    ranked_candidates = sorted(candidates, key=lambda candidate: candidate.score, reverse=True)
    limit = min(len(ranked_candidates), options.core.inverse_render_top_k)
    rerank_subset = ranked_candidates[:limit]
    observed_binary, bbox = _normalize_scan_for_inverse_render(image_path)
    candidate_variant_entries: list[tuple[int, OCRCandidate, str, str]] = []
    variant_texts: list[str] = []
    for candidate_index, candidate in enumerate(rerank_subset):
        candidate_variants = [(candidate.text, "raw")]
        if options.core.apply_cleanup:
            cleaned_variant = cleanup_ocr_text(
                candidate.text,
                lexicon_texts=options.core.cleanup_lexicon_texts,
            )
            if cleaned_variant and cleaned_variant != candidate.text:
                candidate_variants.append((cleaned_variant, "cleaned"))
        for variant_text, variant_label in candidate_variants:
            candidate_variant_entries.append((candidate_index, candidate, variant_text, variant_label))
            variant_texts.append(variant_text)
    variant_scores = _inverse_render_score_many(
        observed_binary,
        bbox,
        variant_texts,
        workers=options.core.inverse_render_workers,
    )
    per_candidate_variants: list[list[tuple[OCRCandidate, float]]] = [[] for _ in rerank_subset]
    for (candidate_index, candidate, variant_text, variant_label), (
        inverse_render_score,
        inverse_metadata,
    ) in zip(candidate_variant_entries, variant_scores, strict=True):
        variant_metadata = dict(candidate.metadata)
        variant_metadata.update(inverse_metadata)
        variant_metadata["inverse_render_text_variant"] = variant_label
        per_candidate_variants[candidate_index].append(
            (
                OCRCandidate(
                    score=candidate.score,
                    ocr_input_path=candidate.ocr_input_path,
                    text=variant_text,
                    metadata=variant_metadata,
                ),
                inverse_render_score,
            )
        )
    best_candidate: OCRCandidate | None = None
    best_score = -1.0
    for candidate, candidate_variants in zip(rerank_subset, per_candidate_variants, strict=True):
        best_variant: OCRCandidate | None = None
        best_variant_score = -1.0
        for variant_candidate, inverse_render_score in candidate_variants:
            if (
                best_variant is None
                or inverse_render_score > best_variant_score
                or (
                    math.isclose(inverse_render_score, best_variant_score)
                    and variant_candidate.metadata.get("inverse_render_text_variant") == "cleaned"
                    and best_variant.text == candidate.text
                )
            ):
                best_variant = variant_candidate
                best_variant_score = inverse_render_score
        if best_variant is None:
            continue
        candidate.metadata.update(best_variant.metadata)
        if (
            best_candidate is None
            or best_variant_score > best_score
            or (
                math.isclose(best_variant_score, best_score)
                and best_variant.score > best_candidate.score
            )
        ):
            best_candidate = best_variant
            best_score = best_variant_score
    return best_candidate


def _maybe_auto_inverse_render_tiebreak(
    image_path: Path,
    candidates: list[OCRCandidate],
    options: OCRRunOptions,
) -> OCRCandidate | None:
    if options.core.inverse_render_rerank or options.preprocess_mode != "auto" or len(candidates) < 2:
        return None
    ranked_candidates = sorted(candidates, key=lambda candidate: candidate.score, reverse=True)
    best_score = ranked_candidates[0].score
    rerank_candidates = [
        candidate
        for candidate in ranked_candidates
        if best_score - candidate.score <= _AUTO_INVERSE_RENDER_SCORE_WINDOW
        and candidate.metadata.get("preprocess_mode") in _AUTO_INVERSE_RENDER_PREPROCESS_MODES
    ]
    if len(rerank_candidates) < 2:
        return None
    rerank_options = replace(
        options,
        core=replace(
            options.core,
            inverse_render_rerank=True,
            inverse_render_top_k=len(rerank_candidates),
        ),
    )
    return _maybe_inverse_render_rerank(image_path, rerank_candidates, rerank_options)


def _maybe_prefer_scan_local_threshold_candidate(
    candidates: list[OCRCandidate],
    options: OCRRunOptions,
) -> OCRCandidate | None:
    if options.core.inverse_render_rerank or options.preprocess_mode != "auto" or len(candidates) < 2:
        return None
    ranked_candidates = sorted(candidates, key=lambda candidate: candidate.score, reverse=True)
    best_candidate = ranked_candidates[0]
    if (
        best_candidate.metadata.get("preprocess_mode") != "scan"
        or best_candidate.score < _AUTO_SCAN_LOCAL_THRESHOLD_MIN_SCORE
    ):
        return None
    for candidate in ranked_candidates[1:]:
        if candidate.metadata.get("preprocess_mode") != "scan-local-threshold":
            continue
        if best_candidate.score - candidate.score > _AUTO_INVERSE_RENDER_SCORE_WINDOW:
            continue
        return candidate
    return None


def _run_candidate_ocr(
    ocr_input_path: Path,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    paddle_reader: Callable[[Path], str] | None,
    tesseract_psm: str,
) -> tuple[str, dict[str, object]]:
    if options.ocr_engine == "tesseract":
        return _run_tesseract(
            dependencies.run_command,
            ocr_input_path,
            options.core.language,
            tesseract_psm,
            options.core.tesseract_output_format,
        )
    if options.ocr_engine == "ensemble":
        tesseract_text, tesseract_metadata = _run_tesseract(
            dependencies.run_command,
            ocr_input_path,
            options.core.language,
            tesseract_psm,
            options.core.tesseract_output_format,
        )
        paddle_text = _run_paddle_reader(paddle_reader, ocr_input_path)
        tesseract_score, _tesseract_score_details = _score_ocr_candidate(
            tesseract_text,
            options.core.language,
            options.core.cleanup_lexicon_texts,
            tesseract_metadata,
        )
        paddle_score, _paddle_score_details = _score_ocr_candidate(
            paddle_text,
            options.core.language,
            options.core.cleanup_lexicon_texts,
        )
        selected_engine = "tesseract" if tesseract_score >= paddle_score else "paddleocr"
        metadata: dict[str, object] = {
            "ensemble_tesseract_score": tesseract_score,
            "ensemble_paddle_score": paddle_score,
            "ensemble_selected_engine": selected_engine,
        }
        if selected_engine == "tesseract":
            metadata.update(tesseract_metadata)
            return tesseract_text, metadata
        return paddle_text, metadata
    return _run_paddle_reader(paddle_reader, ocr_input_path), {}


def _run_ocr_on_page(
    image_path: Path,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    preprocessed_dir: Path,
    paddle_reader: Callable[[Path], str] | None,
    *,
    total_pages: int | None = None,
    completed_pages: int = 0,
    current_page_index: int | None = None,
    started_at: float | None = None,
    retry_reason: str | None = None,
) -> tuple[Path, str, dict[str, object]]:
    # lizard forgive: per-page OCR orchestration needs explicit candidate bookkeeping.
    prepared_inputs: dict[str, Path] = {}
    candidate_runs: list[dict[str, object]] = []
    candidates: list[OCRCandidate] = []
    preprocess_modes = _candidate_preprocess_modes_for_options(options)
    tesseract_psms = _candidate_tesseract_psms(options)
    candidate_total = len(preprocess_modes) * len(tesseract_psms)
    candidate_index = 0
    for preprocess_mode in preprocess_modes:
        ocr_input_path = _prepare_ocr_input_path(
            image_path,
            preprocess_mode,
            options,
            dependencies,
            preprocessed_dir,
            prepared_inputs,
        )
        for tesseract_psm in tesseract_psms:
            candidate_index += 1
            if (
                options.progress_callback is not None
                and total_pages is not None
                and current_page_index is not None
                and started_at is not None
            ):
                _emit_progress(
                    options.progress_callback,
                    _ocr_candidate_progress_payload(
                        total_pages=total_pages,
                        completed_pages=completed_pages,
                        current_page_index=current_page_index,
                        candidate_index=candidate_index,
                        candidate_total=candidate_total,
                        preprocess_mode=preprocess_mode,
                        tesseract_psm=tesseract_psm,
                        started_at=started_at,
                        retry_reason=retry_reason,
                    ),
                )
            text, ocr_metadata = _run_candidate_ocr(
                ocr_input_path,
                options,
                dependencies,
                paddle_reader,
                tesseract_psm,
            )
            score, score_details = _score_ocr_candidate(
                text,
                options.core.language,
                options.core.cleanup_lexicon_texts,
                ocr_metadata,
            )
            base_preprocess_mode, pre_ocr_region_masked = _split_preprocess_mode(preprocess_mode)
            candidate_metadata: dict[str, object] = {
                "preprocess_mode": base_preprocess_mode,
                "candidate_preprocess_mode": preprocess_mode,
                "score": score,
                "word_count": len([word for word in text.split() if word]),
                "character_count": len(text),
            }
            if options.route_ocr_policy:
                candidate_metadata["route_ocr_policy"] = options.route_ocr_policy
            if pre_ocr_region_masked:
                candidate_metadata["pre_ocr_region_masked"] = True
            if options.ocr_engine in {"tesseract", "ensemble"}:
                candidate_metadata["tesseract_psm"] = int(tesseract_psm)
                candidate_metadata["tesseract_output_format"] = options.core.tesseract_output_format
            candidate_metadata.update(score_details)
            candidate_metadata.update(ocr_metadata)
            candidate_runs.append(
                {
                    key: value
                    for key, value in candidate_metadata.items()
                    if key != "hocr_word_boxes_runtime"
                }
            )
            candidates.append(
                OCRCandidate(
                    score=score,
                    ocr_input_path=ocr_input_path,
                    text=text,
                    metadata=candidate_metadata,
                )
            )
    if not candidates:
        raise RuntimeError(f"OCR produced no candidates for page: {image_path}")
    best_candidate = max(candidates, key=lambda candidate: candidate.score)
    reranked_candidate = _maybe_inverse_render_rerank(image_path, candidates, options)
    preferred_scan_local_threshold_candidate = (
        None
        if reranked_candidate is not None
        else _maybe_prefer_scan_local_threshold_candidate(candidates, options)
    )
    auto_tiebreak_candidate = (
        None
        if reranked_candidate is not None or preferred_scan_local_threshold_candidate is not None
        else _maybe_auto_inverse_render_tiebreak(image_path, candidates, options)
    )
    base_selected_candidate = (
        reranked_candidate
        or preferred_scan_local_threshold_candidate
        or auto_tiebreak_candidate
        or best_candidate
    )
    tiered_fallback_candidate = _maybe_tiered_fallback_candidate(
        base_selected_candidate,
        options,
        dependencies,
        paddle_reader,
        preprocessed_dir,
    )
    candidate_after_tiered = tiered_fallback_candidate or base_selected_candidate
    orientation_fallback_candidate = _maybe_orientation_fallback_candidate(
        candidate_after_tiered,
        options,
        dependencies,
        paddle_reader,
        preprocessed_dir,
    )
    selected_candidate = orientation_fallback_candidate or candidate_after_tiered
    selected_metadata = dict(selected_candidate.metadata)
    selected_metadata["selected_preprocess_mode"] = selected_metadata["preprocess_mode"]
    selected_metadata["selection_score"] = selected_candidate.score
    selected_metadata["selection_strategy"] = (
        "orientation-fallback"
        if orientation_fallback_candidate is not None
        else "tiered-ocr-fallback"
        if tiered_fallback_candidate is not None
        else "inverse-render-rerank"
        if reranked_candidate is not None
        else "auto-scan-local-threshold-preference"
        if preferred_scan_local_threshold_candidate is not None
        else "auto-inverse-render-tiebreak"
        if auto_tiebreak_candidate is not None
        else "text-score"
    )
    if len(candidate_runs) > 1:
        selected_metadata["candidate_runs"] = candidate_runs
    return selected_candidate.ocr_input_path, selected_candidate.text, selected_metadata


def _maybe_tiered_fallback_candidate(
    candidate: OCRCandidate,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    paddle_reader: Callable[[Path], str] | None,
    preprocessed_dir: Path,
) -> OCRCandidate | None:
    if (
        not options.core.tiered_ocr_fallback
        or options.ocr_engine != "tesseract"
        or candidate.score >= options.core.tiered_ocr_min_score
        or Image is None
    ):
        return None
    selected_psm = candidate.metadata.get("tesseract_psm")
    if not isinstance(selected_psm, int):
        return None
    with Image.open(candidate.ocr_input_path) as image:
        grayscale = image.convert("L")
        tile_starts = _tile_start_positions(
            grayscale.height,
            _TIERED_FALLBACK_TILE_HEIGHT,
            _TIERED_FALLBACK_TILE_HEIGHT - _TIERED_FALLBACK_TILE_OVERLAP,
        )
        if len(tile_starts) <= 1:
            return None
        tiered_dir = preprocessed_dir / "tiered-fallback"
        tiered_dir.mkdir(parents=True, exist_ok=True)
        segment_texts: list[str] = []
        for tile_index, y_start in enumerate(tile_starts):
            y_end = min(grayscale.height, y_start + _TIERED_FALLBACK_TILE_HEIGHT)
            tile = grayscale.crop((0, y_start, grayscale.width, y_end))
            tile_path = tiered_dir / f"{candidate.ocr_input_path.stem}-tile-{tile_index:02d}.png"
            tile.save(tile_path)
            tile_text, _tile_metadata = _run_candidate_ocr(
                tile_path,
                options,
                dependencies,
                paddle_reader,
                str(selected_psm),
            )
            if tile_text.strip():
                segment_texts.append(tile_text.strip())
    if not segment_texts:
        return None
    merged_text = "\n".join(segment_texts)
    merged_score = _score_ocr_text(
        merged_text,
        options.core.language,
        options.core.cleanup_lexicon_texts,
    )
    if merged_score <= candidate.score:
        return None
    metadata = dict(candidate.metadata)
    metadata["tiered_fallback_applied"] = True
    metadata["tiered_fallback_tile_count"] = len(segment_texts)
    metadata["tiered_fallback_base_score"] = candidate.score
    metadata["tiered_fallback_score"] = merged_score
    return OCRCandidate(
        score=merged_score,
        ocr_input_path=candidate.ocr_input_path,
        text=merged_text,
        metadata=metadata,
    )


def _maybe_orientation_fallback_candidate(
    candidate: OCRCandidate,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    paddle_reader: Callable[[Path], str] | None,
    preprocessed_dir: Path,
) -> OCRCandidate | None:
    if (
        not options.core.orientation_fallback
        or options.ocr_engine != "tesseract"
        or Image is None
    ):
        return None
    selected_psm = candidate.metadata.get("tesseract_psm")
    if not isinstance(selected_psm, int):
        return None
    rotated_input_path = (
        preprocessed_dir
        / "orientation-fallback"
        / f"{candidate.ocr_input_path.stem}-rot180{candidate.ocr_input_path.suffix}"
    )
    rotated_input_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(candidate.ocr_input_path) as image:
        image.rotate(180, expand=True).save(rotated_input_path)
    rotated_text, rotated_metadata = _run_candidate_ocr(
        rotated_input_path,
        options,
        dependencies,
        paddle_reader,
        str(selected_psm),
    )
    rotated_score, _rotated_score_details = _score_ocr_candidate(
        rotated_text,
        options.core.language,
        options.core.cleanup_lexicon_texts,
        rotated_metadata,
    )
    if rotated_score <= candidate.score:
        return None
    metadata = dict(candidate.metadata)
    metadata.update(rotated_metadata)
    metadata["orientation_fallback_applied"] = True
    metadata["orientation_angle"] = 180
    metadata["orientation_fallback_base_score"] = candidate.score
    metadata["orientation_fallback_score"] = rotated_score
    return OCRCandidate(
        score=rotated_score,
        ocr_input_path=rotated_input_path,
        text=rotated_text,
        metadata=metadata,
    )


def _run_tesseract(
    run_command: Callable[[list[str], bool], str],
    image_path: Path,
    language: str,
    tesseract_psm: str,
    output_format: str,
) -> tuple[str, dict[str, object]]:
    command = [
        "tesseract",
        str(image_path),
        "stdout",
        "-l",
        language,
        "--psm",
        tesseract_psm,
    ]
    if output_format == "hocr":
        hocr_text = run_command([*command, "hocr"], True)
        parsed_text, metadata = _parse_hocr_text_and_metadata(hocr_text)
        return parsed_text, metadata
    return run_command(command, True), {}


def _extract_hocr_word_confidence(title: str) -> int | None:
    confidence_match = _HOCR_WCONF_RE.search(title)
    if confidence_match is None:
        return None
    confidence = int(confidence_match.group(1))
    return max(0, min(100, confidence))


def _extract_hocr_bbox(title: str) -> tuple[int, int, int, int] | None:
    bbox_match = _HOCR_BBOX_RE.search(title)
    if bbox_match is None:
        return None
    left, top, right, bottom = (int(value) for value in bbox_match.groups())
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


class _HocrTextExtractor(HTMLParser):
    """Extract plain text lines and x_wconf values from Tesseract hOCR."""

    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []
        self.confidences: list[int] = []
        self._line_depth = 0
        self._current_line_bbox: tuple[int, int, int, int] | None = None
        self._inside_word = False
        self._current_word_parts: list[str] = []
        self._current_word_confidence: int | None = None
        self._current_word_bbox: tuple[int, int, int, int] | None = None
        self._current_line_words: list[str] = []
        self._fallback_words: list[str] = []
        self.word_boxes: list[tuple[int, int, int, int] | None] = []
        self.line_entries: list[dict[str, object]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "span":
            return
        attrs_map = {key.lower(): (value or "") for key, value in attrs}
        classes = set(attrs_map.get("class", "").split())
        if "ocr_line" in classes:
            if self._line_depth == 0:
                self._current_line_words = []
                self._current_line_bbox = _extract_hocr_bbox(attrs_map.get("title", ""))
            self._line_depth += 1
        if "ocrx_word" in classes:
            self._inside_word = True
            self._current_word_parts = []
            title = attrs_map.get("title", "")
            self._current_word_confidence = _extract_hocr_word_confidence(title)
            self._current_word_bbox = _extract_hocr_bbox(title)

    def handle_data(self, data: str) -> None:
        if self._inside_word:
            self._current_word_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "span":
            return
        if self._inside_word:
            token = html.unescape("".join(self._current_word_parts)).strip()
            if token:
                self._current_line_words.append(token)
                self._fallback_words.append(token)
                self.word_boxes.append(self._current_word_bbox)
                if self._current_word_confidence is not None:
                    self.confidences.append(self._current_word_confidence)
            self._inside_word = False
            self._current_word_parts = []
            self._current_word_confidence = None
            self._current_word_bbox = None
            return
        if self._line_depth > 0:
            self._line_depth -= 1
            if self._line_depth == 0 and self._current_line_words:
                line_text = " ".join(self._current_line_words)
                self.lines.append(line_text)
                line_entry: dict[str, object] = {"text": line_text}
                if self._current_line_bbox is not None:
                    line_entry["bbox"] = list(self._current_line_bbox)
                self.line_entries.append(line_entry)
                self._current_line_words = []
                self._current_line_bbox = None

    @property
    def text(self) -> str:
        if self.lines:
            return "\n".join(self.lines).strip()
        return " ".join(self._fallback_words).strip()


def _parse_hocr_text_and_metadata(hocr_text: str) -> tuple[str, dict[str, object]]:
    parser = _HocrTextExtractor()
    parser.feed(hocr_text)
    parsed_text = parser.text
    confidences = parser.confidences
    metadata: dict[str, object] = {}
    if parser.word_boxes:
        metadata["hocr_word_boxes_runtime"] = parser.word_boxes
    if parser.line_entries:
        metadata["hocr_line_entries_runtime"] = parser.line_entries
    if not confidences:
        return parsed_text, metadata
    low_confidence_words = sum(
        1 for confidence in confidences if confidence < _HOCR_LOW_CONFIDENCE_WORD_THRESHOLD
    )
    metadata.update(
        {
            "hocr_word_count": len(confidences),
            "hocr_confidence_mean": sum(confidences) / len(confidences),
            "hocr_confidence_min": min(confidences),
            "hocr_low_confidence_word_count": low_confidence_words,
            "hocr_low_confidence_ratio": low_confidence_words / len(confidences),
        }
    )
    return parsed_text, metadata


def _run_paddle_reader(
    paddle_reader: Callable[[Path], str] | None,
    image_path: Path,
) -> str:
    if paddle_reader is None:
        raise RuntimeError("PaddleOCR reader was not initialized")
    return paddle_reader(image_path)


def _page_entry(
    page_index: int,
    image_path: Path,
    ocr_input_path: Path,
    text: str,
    selection_metadata: dict[str, object],
) -> dict[str, object]:
    entry: dict[str, object] = {
        "page_index": page_index,
        "image_path": str(image_path),
        "ocr_input_path": str(ocr_input_path),
        "word_count": len([word for word in text.split() if word]),
        "character_count": len(text),
    }
    entry.update(selection_metadata)
    return entry


def _page_analysis_summary(page_details: list[dict[str, object]]) -> dict[str, object]:
    page_type_counts: Counter[str] = Counter()
    page_quality_tier_counts: Counter[str] = Counter()
    page_route_counts: Counter[str] = Counter()
    targeted_page_retry_reason_counts: Counter[str] = Counter()
    low_quality_page_indices: list[int] = []
    front_matter_page_indices: list[int] = []
    targeted_page_retry_page_indices: list[int] = []
    for entry in page_details:
        page_index = entry.get("page_index")
        if not isinstance(page_index, int):
            continue
        page_type = entry.get("page_type")
        if isinstance(page_type, str):
            page_type_counts[page_type] += 1
            if page_type == "front-matter":
                front_matter_page_indices.append(page_index)
        quality_tier = entry.get("page_quality_tier")
        if isinstance(quality_tier, str):
            page_quality_tier_counts[quality_tier] += 1
            if quality_tier == "low":
                low_quality_page_indices.append(page_index)
        page_route = entry.get("page_route")
        if isinstance(page_route, str):
            page_route_counts[page_route] += 1
        if entry.get("targeted_page_retry") == "applied":
            targeted_page_retry_page_indices.append(page_index)
            retry_reason = entry.get("targeted_page_retry_reason")
            if isinstance(retry_reason, str):
                targeted_page_retry_reason_counts[retry_reason] += 1
    return {
        "page_type_counts": dict(page_type_counts),
        "page_quality_tier_counts": dict(page_quality_tier_counts),
        "page_route_counts": dict(page_route_counts),
        "front_matter_page_count": len(front_matter_page_indices),
        "front_matter_page_indices": front_matter_page_indices,
        "low_quality_page_count": len(low_quality_page_indices),
        "low_quality_page_indices": low_quality_page_indices,
        "targeted_page_retry_count": len(targeted_page_retry_page_indices),
        "targeted_page_retry_page_indices": targeted_page_retry_page_indices,
        "targeted_page_retry_reason_counts": dict(targeted_page_retry_reason_counts),
    }


def _windowed_section_excerpts(text: str) -> list[tuple[int, int, str]]:
    words = [word for word in text.split() if word]
    if len(words) < _SUSPICIOUS_SECTION_MIN_WORDS:
        return []
    if len(words) <= _SUSPICIOUS_SECTION_WINDOW_WORDS:
        return [(0, len(words), " ".join(words))]
    step = max(1, _SUSPICIOUS_SECTION_WINDOW_WORDS - _SUSPICIOUS_SECTION_WINDOW_OVERLAP_WORDS)
    windows: list[tuple[int, int, str]] = []
    for start in range(0, len(words), step):
        end = min(len(words), start + _SUSPICIOUS_SECTION_WINDOW_WORDS)
        if end - start < _SUSPICIOUS_SECTION_MIN_WORDS:
            continue
        windows.append((start, end, " ".join(words[start:end])))
        if end >= len(words):
            break
    return windows


def _suspicious_section_candidates(
    page_texts: list[str],
    page_details: list[dict[str, object]],
    *,
    max_candidates: int,
) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    for page_index, text in enumerate(page_texts, start=1):
        if page_index - 1 >= len(page_details):
            break
        detail = page_details[page_index - 1]
        page_quality_tier = str(detail.get("page_quality_tier", "unknown"))
        page_route = str(detail.get("page_route", "unknown"))
        raw_low_confidence_ratio = detail.get("hocr_low_confidence_ratio")
        low_confidence_ratio = (
            float(raw_low_confidence_ratio)
            if isinstance(raw_low_confidence_ratio, (int, float))
            else 0.0
        )
        for section_index, (start_word, end_word, excerpt) in enumerate(_windowed_section_excerpts(text), start=1):
            symbolic_token_count = len(_SUSPICIOUS_SYMBOLIC_TOKEN_RE.findall(excerpt))
            digit_alpha_token_count = len(_SUSPICIOUS_DIGIT_ALPHA_TOKEN_RE.findall(excerpt))
            noise_ratio = _page_text_noise_ratio(excerpt)
            quality_bonus = 2.0 if page_quality_tier == "low" else 1.0 if page_quality_tier == "medium" else 0.0
            route_bonus = 0.5 if page_route.endswith("review") or page_route.endswith("low-quality") else 0.0
            heuristic_score = (
                float(symbolic_token_count * 3)
                + float(digit_alpha_token_count * 2)
                + (noise_ratio * 10.0)
                + (low_confidence_ratio * 8.0)
                + quality_bonus
                + route_bonus
            )
            if (
                heuristic_score <= 0.0
                and page_quality_tier == "high"
                and low_confidence_ratio < 0.08
                and symbolic_token_count == 0
                and digit_alpha_token_count == 0
            ):
                continue
            candidates.append(
                {
                    "page_index": page_index,
                    "section_index": section_index,
                    "start_word_index": start_word,
                    "end_word_index": end_word,
                    "page_quality_tier": page_quality_tier,
                    "page_route": page_route,
                    "page_text_noise_ratio": round(noise_ratio, 4),
                    "hocr_low_confidence_ratio": round(low_confidence_ratio, 4),
                    "symbolic_token_count": symbolic_token_count,
                    "digit_alpha_token_count": digit_alpha_token_count,
                    "heuristic_score": round(heuristic_score, 4),
                    "excerpt": excerpt,
                }
            )
    candidates.sort(
        key=lambda item: (
            float(item["heuristic_score"]),
            int(item["symbolic_token_count"]),
            int(item["digit_alpha_token_count"]),
        ),
        reverse=True,
    )
    return candidates[:max_candidates]


def _build_suspicious_section_prompt(candidate: dict[str, object]) -> str:
    return (
        "Review this OCR excerpt for likely recognition errors.\n"
        "Return ONLY compact JSON with keys "
        '{"suspicious":true|false,"confidence":"low|medium|high","reason":"short reason","focus_spans":["exact short spans"]}.\n'
        "Mark suspicious=true only when the excerpt likely deserves deeper OCR review.\n"
        f"page_index={int(candidate['page_index'])}, "
        f"section_index={int(candidate['section_index'])}, "
        f"heuristic_score={float(candidate['heuristic_score']):.3f}, "
        f"page_quality_tier={candidate['page_quality_tier']}, "
        f"page_route={candidate['page_route']}, "
        f"page_text_noise_ratio={float(candidate['page_text_noise_ratio']):.4f}, "
        f"hocr_low_confidence_ratio={float(candidate['hocr_low_confidence_ratio']):.4f}, "
        f"symbolic_token_count={int(candidate['symbolic_token_count'])}, "
        f"digit_alpha_token_count={int(candidate['digit_alpha_token_count'])}\n"
        "Excerpt:\n<<<\n"
        f"{candidate['excerpt']}\n"
        ">>>"
    )


def _extract_first_json_object(text: str) -> dict[str, object] | None:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def _parse_suspicious_section_response(response_text: str) -> dict[str, object] | None:
    payload = _extract_first_json_object(response_text.strip())
    if payload is None:
        return None
    suspicious = payload.get("suspicious")
    if not isinstance(suspicious, bool):
        return None
    confidence = str(payload.get("confidence", "medium")).strip().lower()
    if confidence not in {"low", "medium", "high"}:
        confidence = "medium"
    reason = str(payload.get("reason", "")).strip()
    if not reason:
        return None
    focus_spans_value = payload.get("focus_spans", [])
    focus_spans: list[str] = []
    if isinstance(focus_spans_value, list):
        for item in focus_spans_value:
            if not isinstance(item, str):
                continue
            candidate = item.strip()
            if candidate:
                focus_spans.append(candidate[:120])
            if len(focus_spans) >= _MAX_SUSPICIOUS_SECTION_FOCUS_SPANS:
                break
    return {
        "suspicious": suspicious,
        "confidence": confidence,
        "reason": reason[:240],
        "focus_spans": focus_spans,
    }


def _maybe_analyze_suspicious_sections(
    page_texts: list[str],
    page_details: list[dict[str, object]],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
) -> dict[str, object]:
    if not options.core.llm_suspicious_sections:
        return {}
    if dependencies.llm_suspicious_section_analyzer is None:
        return {
            "enabled": True,
            "status": "unavailable",
            "candidate_count": 0,
            "reviewed_count": 0,
            "flagged_count": 0,
            "invalid_response_count": 0,
            "sections": [],
        }
    candidates = _suspicious_section_candidates(
        page_texts,
        page_details,
        max_candidates=options.core.llm_suspicious_max_candidates,
    )
    if not candidates:
        return {
            "enabled": True,
            "status": "skipped-no-candidates",
            "candidate_count": 0,
            "reviewed_count": 0,
            "flagged_count": 0,
            "invalid_response_count": 0,
            "sections": [],
        }
    sections: list[dict[str, object]] = []
    reviewed_count = 0
    invalid_response_count = 0
    for candidate in candidates:
        if len(sections) >= options.core.llm_suspicious_max_sections:
            break
        reviewed_count += 1
        response_text = dependencies.llm_suspicious_section_analyzer(
            _build_suspicious_section_prompt(candidate)
        )
        if not isinstance(response_text, str):
            invalid_response_count += 1
            continue
        parsed = _parse_suspicious_section_response(response_text)
        if parsed is None:
            invalid_response_count += 1
            continue
        if not bool(parsed["suspicious"]):
            continue
        section = dict(candidate)
        section["llm_confidence"] = parsed["confidence"]
        section["llm_reason"] = parsed["reason"]
        section["focus_spans"] = parsed["focus_spans"]
        sections.append(section)
    status = "applied"
    if reviewed_count > 0 and invalid_response_count == reviewed_count:
        status = "invalid-output"
    return {
        "enabled": True,
        "status": status,
        "candidate_count": len(candidates),
        "reviewed_count": reviewed_count,
        "flagged_count": len(sections),
        "invalid_response_count": invalid_response_count,
        "sections": sections,
    }


def _page_artifacts_manifest_payload(
    page_details: list[dict[str, object]],
    total_pages: int,
    *,
    status: str,
    current_page_index: int | None,
    elapsed_seconds: float,
) -> dict[str, object]:
    completed_pages = len(page_details)
    seconds_per_page = (
        elapsed_seconds / completed_pages
        if completed_pages > 0 and elapsed_seconds > 0
        else None
    )
    estimated_remaining_seconds = (
        seconds_per_page * (total_pages - completed_pages)
        if seconds_per_page is not None and status != "complete"
        else 0.0 if status == "complete"
        else None
    )
    estimated_total_seconds = (
        seconds_per_page * total_pages
        if seconds_per_page is not None
        else elapsed_seconds if status == "complete"
        else None
    )
    return {
        "pages": page_details,
        "progress": {
            "status": status,
            "total_pages": total_pages,
            "completed_pages": completed_pages,
            "current_page_index": current_page_index,
            "elapsed_seconds": round(elapsed_seconds, 3),
            "seconds_per_page": round(seconds_per_page, 3) if seconds_per_page is not None else None,
            "estimated_remaining_seconds": (
                round(estimated_remaining_seconds, 3)
                if estimated_remaining_seconds is not None
                else None
            ),
            "estimated_total_seconds": (
                round(estimated_total_seconds, 3)
                if estimated_total_seconds is not None
                else None
            ),
        },
    }


def _write_page_artifacts_manifest(
    artifacts_dir: Path,
    page_details: list[dict[str, object]],
    total_pages: int,
    *,
    status: str,
    current_page_index: int | None,
    started_at: float,
) -> Path:
    artifacts_manifest_path = artifacts_dir / "manifest.json"
    elapsed_seconds = max(0.0, time.monotonic() - started_at)
    artifacts_manifest_path.write_text(
        json.dumps(
            _page_artifacts_manifest_payload(
                page_details,
                total_pages,
                status=status,
                current_page_index=current_page_index,
                elapsed_seconds=elapsed_seconds,
            ),
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return artifacts_manifest_path


def _timed_page_progress_payload(
    *,
    stage: str,
    total_pages: int,
    completed_pages: int,
    status: str,
    current_page_index: int | None,
    started_at: float,
) -> dict[str, object]:
    elapsed_seconds = max(0.0, time.monotonic() - started_at)
    seconds_per_page = (
        elapsed_seconds / completed_pages
        if completed_pages > 0 and elapsed_seconds > 0
        else None
    )
    estimated_remaining_seconds = (
        seconds_per_page * (total_pages - completed_pages)
        if seconds_per_page is not None and status != "complete"
        else 0.0 if status == "complete"
        else None
    )
    return {
        "stage": stage,
        "status": status,
        "total_pages": total_pages,
        "completed_pages": completed_pages,
        "current_page_index": current_page_index,
        "elapsed_seconds": elapsed_seconds,
        "seconds_per_page": seconds_per_page,
        "estimated_remaining_seconds": estimated_remaining_seconds,
    }


def _ocr_candidate_progress_payload(
    *,
    total_pages: int,
    completed_pages: int,
    current_page_index: int,
    candidate_index: int,
    candidate_total: int,
    preprocess_mode: str,
    tesseract_psm: str,
    started_at: float,
    retry_reason: str | None = None,
) -> dict[str, object]:
    elapsed_seconds = max(0.0, time.monotonic() - started_at)
    payload = {
        "stage": "ocr-candidate",
        "status": "running",
        "total_pages": total_pages,
        "completed_pages": completed_pages,
        "current_page_index": current_page_index,
        "candidate_index": candidate_index,
        "candidate_total": candidate_total,
        "preprocess_mode": preprocess_mode,
        "tesseract_psm": tesseract_psm,
        "elapsed_seconds": elapsed_seconds,
    }
    if retry_reason is not None:
        payload["retry_reason"] = retry_reason
    return payload


def _emit_progress(
    callback: Callable[[dict[str, object]], None] | None,
    payload: dict[str, object],
) -> None:
    if callback is None:
        return
    callback(payload)


def _is_probable_page_number(text: str) -> bool:
    compact = " ".join(text.split())
    return bool(compact and _PAGE_NUMBER_LINE_RE.fullmatch(compact))


def _is_probable_chapter_marker(text: str) -> bool:
    compact = " ".join(text.split())
    return bool(compact and _CHAPTER_MARKER_RE.search(compact))


def _is_probable_toc_line(text: str) -> bool:
    compact = " ".join(text.split())
    return bool(compact and _TOC_LINE_RE.fullmatch(compact))


def _classify_layout_line(
    text: str,
    bbox: tuple[int, int, int, int] | None,
    line_index: int,
    line_count: int,
) -> str:
    compact = " ".join(text.split())
    if not compact:
        return "blank"
    word_count = len(compact.split())
    if _is_probable_page_number(compact):
        return "page-number"
    if _is_probable_toc_line(compact):
        return "toc"
    top_edge = line_index <= 1
    bottom_edge = line_index >= max(0, line_count - 2)
    if top_edge and word_count <= 8 and not _is_probable_chapter_marker(compact):
        return "header"
    if bottom_edge and word_count <= 8 and not _is_probable_chapter_marker(compact):
        return "footer"
    if bbox is not None:
        left, _top, right, _bottom = bbox
        if (right - left) >= 1 and left <= 16 and word_count <= 3:
            return "margin-note"
    return "body"


def _coerce_layout_entries(
    text: str,
    selection_metadata: dict[str, object],
) -> list[dict[str, object]]:
    runtime_entries = selection_metadata.get("hocr_line_entries_runtime")
    entries: list[dict[str, object]] = []
    if isinstance(runtime_entries, list):
        for entry in runtime_entries:
            if not isinstance(entry, dict):
                continue
            line_text = str(entry.get("text", "")).strip()
            if not line_text:
                continue
            normalized_entry: dict[str, object] = {"text": line_text}
            raw_bbox = entry.get("bbox")
            if (
                isinstance(raw_bbox, (list, tuple))
                and len(raw_bbox) == 4
                and all(isinstance(value, int) for value in raw_bbox)
            ):
                normalized_entry["bbox"] = tuple(int(value) for value in raw_bbox)
            entries.append(normalized_entry)
    if entries:
        return entries
    return [{"text": line.strip()} for line in text.splitlines() if line.strip()]


def _classify_layout_entries(
    text: str,
    selection_metadata: dict[str, object],
) -> list[dict[str, object]]:
    entries = _coerce_layout_entries(text, selection_metadata)
    classified_entries: list[dict[str, object]] = []
    for index, entry in enumerate(entries):
        line_text = str(entry["text"])
        raw_bbox = entry.get("bbox")
        bbox = raw_bbox if isinstance(raw_bbox, tuple) else None
        classified_entries.append(
            {
                "text": line_text,
                "bbox": bbox,
                "region": _classify_layout_line(line_text, bbox, index, len(entries)),
            }
        )
    return classified_entries


def _edge_page_window(total_pages: int, max_pages: int) -> int:
    if total_pages <= 0:
        return 0
    return max(1, min(max_pages, math.ceil(total_pages * 0.1)))


def _page_text_noise_ratio(text: str) -> float:
    compact = "".join(text.split())
    if not compact:
        return 1.0
    noisy_chars = len(_NON_TEXT_CHAR.findall(compact))
    return noisy_chars / len(compact)


def _classify_page_type(
    *,
    page_index: int,
    total_pages: int,
    word_count: int,
    dense_body_line_count: int,
    region_counts: Counter[str],
    chapter_marker_count: int,
) -> str:
    sparse_page = word_count <= 60 and dense_body_line_count <= 2
    toc_page = region_counts.get("toc", 0) >= 2
    body_lines = region_counts.get("body", 0)
    if total_pages >= 4 and page_index <= _edge_page_window(total_pages, _FRONT_MATTER_MAX_PAGES):
        if toc_page:
            return "front-matter"
        if sparse_page and (body_lines <= 4 or chapter_marker_count > 0):
            return "front-matter"
    if total_pages >= 4 and page_index > total_pages - _edge_page_window(total_pages, _BACK_MATTER_MAX_PAGES):
        if sparse_page and body_lines <= 4:
            return "back-matter"
    if sparse_page and body_lines <= 2:
        return "sparse"
    return "body"


def _classify_page_quality_tier(
    *,
    page_type: str,
    word_count: int,
    dense_body_line_count: int,
    selection_score: float,
    noise_ratio: float,
    hocr_confidence_mean: float | None,
    hocr_low_confidence_ratio: float | None,
) -> str:
    penalty = 0
    if word_count == 0:
        penalty += 3
    if selection_score < _LOW_QUALITY_SELECTION_SCORE:
        penalty += 2
    elif selection_score < _MEDIUM_QUALITY_SELECTION_SCORE:
        penalty += 1
    if hocr_low_confidence_ratio is not None:
        if hocr_low_confidence_ratio >= _LOW_QUALITY_LOW_CONFIDENCE_RATIO:
            penalty += 2
        elif hocr_low_confidence_ratio >= _MEDIUM_QUALITY_LOW_CONFIDENCE_RATIO:
            penalty += 1
    if hocr_confidence_mean is not None:
        if hocr_confidence_mean < 75.0:
            penalty += 2
        elif hocr_confidence_mean < 88.0:
            penalty += 1
    if noise_ratio >= _LOW_QUALITY_NOISE_RATIO:
        penalty += 2
    elif noise_ratio >= _MEDIUM_QUALITY_NOISE_RATIO:
        penalty += 1
    if page_type in {"front-matter", "back-matter", "sparse"} and dense_body_line_count <= 1:
        penalty = max(0, penalty - 1)
    if penalty >= 4:
        return "low"
    if penalty >= 2:
        return "medium"
    return "high"


def _page_route(page_type: str, quality_tier: str) -> str:
    if page_type in {"front-matter", "back-matter"}:
        return page_type
    if quality_tier == "low":
        return "body-low-quality"
    if quality_tier == "medium":
        return "body-review"
    return "body"


def _page_analysis_metadata(
    text: str,
    selection_metadata: dict[str, object],
    *,
    page_index: int,
    total_pages: int,
) -> dict[str, object]:
    classified_entries = _classify_layout_entries(text, selection_metadata)
    region_counts = Counter(str(entry["region"]) for entry in classified_entries)
    line_count = len(classified_entries)
    word_count = len([word for word in text.split() if word])
    dense_body_line_count = sum(
        1 for entry in classified_entries if len(str(entry["text"]).split()) >= 6
    )
    chapter_marker_count = sum(
        1 for entry in classified_entries if _is_probable_chapter_marker(str(entry["text"]))
    )
    noise_ratio = _page_text_noise_ratio(text)
    selection_score = float(selection_metadata.get("selection_score", 0.0))
    raw_confidence_mean = selection_metadata.get("hocr_confidence_mean")
    hocr_confidence_mean = (
        float(raw_confidence_mean)
        if isinstance(raw_confidence_mean, (int, float))
        else None
    )
    raw_low_confidence_ratio = selection_metadata.get("hocr_low_confidence_ratio")
    hocr_low_confidence_ratio = (
        float(raw_low_confidence_ratio)
        if isinstance(raw_low_confidence_ratio, (int, float))
        else None
    )
    page_type = _classify_page_type(
        page_index=page_index,
        total_pages=total_pages,
        word_count=word_count,
        dense_body_line_count=dense_body_line_count,
        region_counts=region_counts,
        chapter_marker_count=chapter_marker_count,
    )
    quality_tier = _classify_page_quality_tier(
        page_type=page_type,
        word_count=word_count,
        dense_body_line_count=dense_body_line_count,
        selection_score=selection_score,
        noise_ratio=noise_ratio,
        hocr_confidence_mean=hocr_confidence_mean,
        hocr_low_confidence_ratio=hocr_low_confidence_ratio,
    )
    metadata: dict[str, object] = {
        "page_type": page_type,
        "page_route": _page_route(page_type, quality_tier),
        "page_quality_tier": quality_tier,
        "page_line_count": line_count,
        "page_dense_body_line_count": dense_body_line_count,
        "page_avg_words_per_line": round(word_count / line_count, 3) if line_count else 0.0,
        "page_text_noise_ratio": round(noise_ratio, 4),
        "page_layout_region_counts": dict(region_counts),
    }
    if chapter_marker_count:
        metadata["page_chapter_marker_count"] = chapter_marker_count
    return metadata


def _maybe_apply_layout_region_detection(
    text: str,
    selection_metadata: dict[str, object],
    options: OCRRunOptions,
) -> tuple[str, dict[str, object]]:
    if not options.core.layout_region_detection:
        return text, {}
    classified_entries = _classify_layout_entries(text, selection_metadata)
    if not classified_entries:
        return text, {"layout_region_detection_enabled": True}
    zone_counts: Counter[str] = Counter()
    removed_lines = 0
    kept_lines: list[str] = []
    for entry in classified_entries:
        region = str(entry["region"])
        zone_counts[region] += 1
        if region == "page-number":
            removed_lines += 1
            continue
        kept_lines.append(str(entry["text"]))
    if removed_lines == 0:
        return text, {
            "layout_region_detection_enabled": True,
            "layout_region_counts": dict(zone_counts),
            "layout_removed_lines": 0,
        }
    return "\n".join(kept_lines).strip(), {
        "layout_region_detection_enabled": True,
        "layout_region_counts": dict(zone_counts),
        "layout_removed_lines": removed_lines,
    }


def _maybe_apply_llm_post_correction(
    text: str,
    selection_metadata: dict[str, object],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
) -> tuple[str, dict[str, object]]:
    if not options.core.llm_post_correction:
        return text, {}
    if dependencies.llm_corrector is None:
        return text, {"llm_post_correction": "unavailable"}
    low_confidence_ratio = selection_metadata.get("hocr_low_confidence_ratio")
    if (
        not isinstance(low_confidence_ratio, (int, float))
        or float(low_confidence_ratio) < options.core.llm_min_low_confidence_ratio
    ):
        return text, {"llm_post_correction": "skipped-low-risk"}
    corrected_text = dependencies.llm_corrector(text)
    if not isinstance(corrected_text, str):
        return text, {"llm_post_correction": "invalid-output"}
    corrected_text = corrected_text.strip()
    if not corrected_text or corrected_text == text:
        return text, {"llm_post_correction": "no-change"}
    original_word_count = len([word for word in text.split() if word])
    corrected_word_count = len([word for word in corrected_text.split() if word])
    word_delta_ratio = abs(corrected_word_count - original_word_count) / max(1, original_word_count)
    if word_delta_ratio > options.core.llm_max_word_delta_ratio:
        return text, {
            "llm_post_correction": "rejected-word-delta",
            "llm_word_delta_ratio": word_delta_ratio,
        }
    return corrected_text, {
        "llm_post_correction": "applied",
        "llm_word_delta_ratio": word_delta_ratio,
    }


def _postprocess_page_text(
    image_path: Path,
    text: str,
    selection_metadata: dict[str, object],
    *,
    page_index: int,
    total_pages: int,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
) -> tuple[str, dict[str, object]]:
    processed_metadata = dict(selection_metadata)
    text, cleanup_metadata = _maybe_verify_cleanup_spans(
        image_path,
        text,
        options,
        processed_metadata,
    )
    if cleanup_metadata:
        processed_metadata.update(cleanup_metadata)
    text, layout_metadata = _maybe_apply_layout_region_detection(text, processed_metadata, options)
    if layout_metadata:
        processed_metadata.update(layout_metadata)
    text, llm_metadata = _maybe_apply_llm_post_correction(
        text,
        processed_metadata,
        options,
        dependencies,
    )
    if llm_metadata:
        processed_metadata.update(llm_metadata)
    processed_metadata.update(
        _page_analysis_metadata(
            text,
            processed_metadata,
            page_index=page_index,
            total_pages=total_pages,
        )
    )
    return text, processed_metadata


def _targeted_page_retry_reason(
    selection_metadata: dict[str, object],
    options: OCRRunOptions,
) -> str | None:
    if options.ocr_engine not in {"tesseract", "ensemble"}:
        return None
    page_route = selection_metadata.get("page_route")
    if page_route == "front-matter":
        return "front-matter"
    if page_route == "back-matter":
        return "back-matter"
    if page_route == "body-review":
        return "body-review"
    if selection_metadata.get("page_quality_tier") == "low":
        return "low-quality"
    return None


def _targeted_page_retry_policy(
    selection_metadata: dict[str, object],
    retry_reason: str,
) -> dict[str, object]:
    layout_region_counts = selection_metadata.get("page_layout_region_counts")
    toc_count = 0
    if isinstance(layout_region_counts, dict):
        raw_toc_count = layout_region_counts.get("toc", 0)
        if isinstance(raw_toc_count, int):
            toc_count = raw_toc_count
    if retry_reason == "front-matter":
        if toc_count >= 1:
            return {
                "name": "front-matter-toc",
                "preprocess_modes": _FRONT_MATTER_RETRY_PREPROCESS_MODES,
                "tesseract_psms": _FRONT_MATTER_RETRY_TESSERACT_PSMS,
            }
        return {
            "name": "front-matter-sparse",
            "preprocess_modes": _FRONT_MATTER_RETRY_PREPROCESS_MODES,
            "tesseract_psms": ("4", "6"),
        }
    if retry_reason == "back-matter":
        return {
            "name": "back-matter",
            "preprocess_modes": _BACK_MATTER_RETRY_PREPROCESS_MODES,
            "tesseract_psms": _BACK_MATTER_RETRY_TESSERACT_PSMS,
        }
    if retry_reason == "body-review":
        return {
            "name": "body-review",
            "preprocess_modes": _BODY_REVIEW_RETRY_PREPROCESS_MODES,
            "tesseract_psms": _BODY_REVIEW_RETRY_TESSERACT_PSMS,
        }
    return {
        "name": "body-low-quality",
        "preprocess_modes": _BODY_LOW_QUALITY_RETRY_PREPROCESS_MODES,
        "tesseract_psms": _BODY_LOW_QUALITY_RETRY_TESSERACT_PSMS,
    }


def _targeted_page_retry_options(
    options: OCRRunOptions,
    retry_reason: str,
    selection_metadata: dict[str, object],
) -> OCRRunOptions:
    policy = _targeted_page_retry_policy(selection_metadata, retry_reason)
    retry_core = replace(
        options.core,
        tesseract_psm="auto",
        tesseract_output_format="hocr",
    )
    return replace(
        options,
        core=retry_core,
        preprocess_mode="auto",
        emit_page_artifacts=False,
        candidate_preprocess_modes_override=tuple(policy["preprocess_modes"]),
        candidate_tesseract_psms_override=tuple(policy["tesseract_psms"]),
        route_ocr_policy=str(policy["name"]),
    )


def _quality_tier_rank(value: object) -> int:
    if value == "high":
        return 2
    if value == "medium":
        return 1
    return 0


def _should_keep_targeted_retry(
    current_metadata: dict[str, object],
    retry_metadata: dict[str, object],
) -> bool:
    current_score = float(current_metadata.get("selection_score", 0.0))
    retry_score = float(retry_metadata.get("selection_score", 0.0))
    if retry_score > current_score:
        return True
    current_quality_rank = _quality_tier_rank(current_metadata.get("page_quality_tier"))
    retry_quality_rank = _quality_tier_rank(retry_metadata.get("page_quality_tier"))
    return retry_quality_rank > current_quality_rank and retry_score >= (current_score - 25.0)


def _maybe_retry_targeted_page(
    image_path: Path,
    ocr_input_path: Path,
    text: str,
    selection_metadata: dict[str, object],
    *,
    page_index: int,
    total_pages: int,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    preprocessed_dir: Path,
    paddle_reader: Callable[[Path], str] | None,
    started_at: float,
) -> tuple[Path, str, dict[str, object]]:
    retry_reason = _targeted_page_retry_reason(selection_metadata, options)
    if retry_reason is None:
        return ocr_input_path, text, selection_metadata
    retry_options = _targeted_page_retry_options(options, retry_reason, selection_metadata)
    retry_ocr_input_path, retry_text, retry_metadata = _run_ocr_on_page(
        image_path,
        retry_options,
        dependencies,
        preprocessed_dir,
        paddle_reader,
        total_pages=total_pages,
        completed_pages=page_index - 1,
        current_page_index=page_index,
        started_at=started_at,
        retry_reason=retry_reason,
    )
    retry_text, retry_metadata = _postprocess_page_text(
        image_path,
        retry_text,
        retry_metadata,
        page_index=page_index,
        total_pages=total_pages,
        options=retry_options,
        dependencies=dependencies,
    )
    current_score = float(selection_metadata.get("selection_score", 0.0))
    retry_score = float(retry_metadata.get("selection_score", 0.0))
    if _should_keep_targeted_retry(selection_metadata, retry_metadata):
        resolved_metadata = dict(retry_metadata)
        resolved_metadata["targeted_page_retry"] = "applied"
        resolved_metadata["targeted_page_retry_reason"] = retry_reason
        resolved_metadata["targeted_page_retry_base_selection_score"] = current_score
        resolved_metadata["targeted_page_retry_retry_selection_score"] = retry_score
        resolved_metadata["targeted_page_retry_base_route"] = selection_metadata.get("page_route")
        resolved_metadata["targeted_page_retry_policy"] = retry_options.route_ocr_policy
        resolved_metadata["targeted_page_retry_selected_strategy"] = retry_metadata.get("selection_strategy")
        resolved_metadata["selection_strategy"] = "targeted-page-retry"
        return retry_ocr_input_path, retry_text, resolved_metadata
    resolved_metadata = dict(selection_metadata)
    resolved_metadata["targeted_page_retry"] = "rejected-no-gain"
    resolved_metadata["targeted_page_retry_reason"] = retry_reason
    resolved_metadata["targeted_page_retry_policy"] = retry_options.route_ocr_policy
    resolved_metadata["targeted_page_retry_retry_selection_score"] = retry_score
    return ocr_input_path, text, resolved_metadata


def _collect_page_ocr_results(
    page_images: list[Path],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    work_dir: Path,
    artifacts_dir: Path,
    started_at: float,
) -> tuple[list[str], list[dict[str, object]], dict[str, object]]:
    page_texts: list[str] = []
    page_details: list[dict[str, object]] = []
    preprocessed_dir = work_dir / "preprocessed"
    paddle_reader = (
        dependencies.paddle_reader_factory(options.core.language)
        if options.ocr_engine in {"paddleocr", "ensemble"}
        else None
    )
    mode_usage: Counter[str] = Counter()
    tesseract_psm_usage: Counter[str] = Counter()
    total_pages = len(page_images)
    if options.emit_page_artifacts:
        _write_page_artifacts_manifest(
            artifacts_dir,
            page_details,
            total_pages,
            status="running",
            current_page_index=1 if total_pages else None,
            started_at=started_at,
        )
    _emit_progress(
        options.progress_callback,
        _timed_page_progress_payload(
            stage="ocr",
            total_pages=total_pages,
            completed_pages=0,
            status="running",
            current_page_index=1 if total_pages else None,
            started_at=started_at,
        ),
    )
    for image_path in page_images:
        ocr_input_path, text, selection_metadata = _run_ocr_on_page(
            image_path,
            options,
            dependencies,
            preprocessed_dir,
            paddle_reader,
            total_pages=total_pages,
            completed_pages=len(page_texts),
            current_page_index=len(page_texts) + 1,
            started_at=started_at,
        )
        page_index = len(page_texts) + 1
        text, selection_metadata = _postprocess_page_text(
            image_path,
            text,
            selection_metadata,
            page_index=page_index,
            total_pages=total_pages,
            options=options,
            dependencies=dependencies,
        )
        ocr_input_path, text, selection_metadata = _maybe_retry_targeted_page(
            image_path,
            ocr_input_path,
            text,
            selection_metadata,
            page_index=page_index,
            total_pages=total_pages,
            options=options,
            dependencies=dependencies,
            preprocessed_dir=preprocessed_dir,
            paddle_reader=paddle_reader,
            started_at=started_at,
        )
        selection_metadata.pop("hocr_word_boxes_runtime", None)
        selection_metadata.pop("hocr_line_entries_runtime", None)
        page_texts.append(text)
        entry = _page_entry(page_index, image_path, ocr_input_path, text, selection_metadata)
        selected_mode = entry.get("selected_preprocess_mode")
        if isinstance(selected_mode, str):
            mode_usage[selected_mode] += 1
        selected_psm = entry.get("tesseract_psm")
        if isinstance(selected_psm, int):
            tesseract_psm_usage[str(selected_psm)] += 1
        if options.emit_page_artifacts:
            text_path = artifacts_dir / f"page-{page_index:04d}.txt"
            text_path.write_text(text, encoding="utf-8")
            entry["text_path"] = str(text_path)
        page_details.append(entry)
        if options.emit_page_artifacts:
            _write_page_artifacts_manifest(
                artifacts_dir,
                page_details,
                total_pages,
                status="complete" if page_index >= total_pages else "running",
                current_page_index=page_index + 1 if page_index < total_pages else None,
                started_at=started_at,
            )
        _emit_progress(
            options.progress_callback,
            _timed_page_progress_payload(
                stage="ocr",
                total_pages=total_pages,
                completed_pages=page_index,
                status="complete" if page_index >= total_pages else "running",
                current_page_index=page_index + 1 if page_index < total_pages else None,
                started_at=started_at,
            ),
        )
    selection_summary: dict[str, object] = {
        "mode_usage": dict(mode_usage),
        "page_analysis": _page_analysis_summary(page_details),
    }
    suspicious_sections = _maybe_analyze_suspicious_sections(
        page_texts,
        page_details,
        options,
        dependencies,
    )
    if suspicious_sections:
        selection_summary["suspicious_sections"] = suspicious_sections
    if tesseract_psm_usage:
        selection_summary["tesseract_psm_usage"] = dict(tesseract_psm_usage)
    return page_texts, page_details, selection_summary


def _finalize_ocr_output(
    page_texts: list[str],
    output_text_path: Path,
    options: OCRRunOptions,
) -> tuple[str, dict[str, object]]:
    combined_text = "\n\n".join(page_texts)
    final_text = combined_text
    # Skip the combined pass when per-page image verification already ran — each
    # page's text has been individually verified against the scan, so applying a
    # second unverified combined-stats pass could reintroduce reverted corrections.
    per_page_verified = (
        options.core.verify_cleanup_spans
        or _uses_scan_preprocess_stack(options.preprocess_mode)
        or options.core.confidence_aware_cleanup
    )
    if options.core.apply_cleanup and not per_page_verified:
        final_text = cleanup_ocr_text(combined_text, lexicon_texts=options.core.cleanup_lexicon_texts)
    output_text_path.parent.mkdir(parents=True, exist_ok=True)
    output_text_path.write_text(final_text, encoding="utf-8")
    words = [word for word in final_text.split() if word]
    return final_text, {
        "page_count": len(page_texts),
        "word_count": len(words),
        "character_count": len(final_text),
    }


def _attach_page_artifacts(
    result: dict[str, object],
    artifacts_dir: Path,
    page_details: list[dict[str, object]],
    started_at: float,
) -> None:
    artifacts_manifest_path = _write_page_artifacts_manifest(
        artifacts_dir,
        page_details,
        len(page_details),
        status="complete",
        current_page_index=None,
        started_at=started_at,
    )
    result["page_artifacts_dir"] = str(artifacts_dir)
    result["page_artifacts_manifest"] = str(artifacts_manifest_path)


def ocr_pdf_with_tesseract(
    pdf_path: Path,
    output_text_path: Path,
    work_dir: Path,
    **kwargs: Any,
) -> dict[str, object]:
    """Run OCR on a PDF with optional preprocessing and artifact output."""

    parse_kwargs = dict(kwargs)
    dependencies = _parse_ocr_dependencies(parse_kwargs)
    options = _parse_ocr_options(parse_kwargs)
    _ensure_no_unknown_kwargs(parse_kwargs, "ocr_pdf_with_tesseract")
    _validate_ocr_run_options(pdf_path, options, dependencies.which)
    _emit_progress(
        options.progress_callback,
        {
            "stage": "rasterize",
            "status": "running",
            "message": f"Rasterizing {pdf_path.name} at {options.core.dpi} DPI",
        },
    )
    page_images = _rasterize_pdf_to_images(
        pdf_path,
        work_dir,
        options.core.dpi,
        dependencies.run_command,
        progress_callback=options.progress_callback,
    )
    started_at = time.monotonic()
    _emit_progress(
        options.progress_callback,
        {
            "stage": "rasterize",
            "status": "complete",
            "message": f"Rasterized {len(page_images)} pages",
            "total_pages": len(page_images),
        },
    )
    artifacts_dir = _prepare_artifacts_dir(work_dir, options)
    page_texts, page_details, selection_summary = _collect_page_ocr_results(
        page_images,
        options,
        dependencies,
        work_dir,
        artifacts_dir,
        started_at,
    )
    _final_text, result = _finalize_ocr_output(page_texts, output_text_path, options)
    result.update(selection_summary)
    if options.emit_page_artifacts:
        _attach_page_artifacts(result, artifacts_dir, page_details, started_at)
    return result


def ocr_page_images(
    page_images: list[Path],
    output_text_path: Path,
    work_dir: Path,
    **kwargs: Any,
) -> dict[str, object]:
    """Run OCR on an existing list of page images."""

    parse_kwargs = dict(kwargs)
    dependencies = _parse_ocr_dependencies(parse_kwargs)
    options = _parse_ocr_options(parse_kwargs)
    _ensure_no_unknown_kwargs(parse_kwargs, "ocr_page_images")
    _validate_page_image_run_options(page_images, options, dependencies.which)
    started_at = time.monotonic()
    artifacts_dir = _prepare_artifacts_dir(work_dir, options)
    page_texts, page_details, selection_summary = _collect_page_ocr_results(
        page_images,
        options,
        dependencies,
        work_dir,
        artifacts_dir,
        started_at,
    )
    _final_text, result = _finalize_ocr_output(page_texts, output_text_path, options)
    result.update(selection_summary)
    if options.emit_page_artifacts:
        _attach_page_artifacts(result, artifacts_dir, page_details, started_at)
    return result


def _parse_mode_eval_options(kwargs: dict[str, Any]) -> ModeEvalOptions:
    reference_text_path = kwargs.pop("reference_text_path", None)
    if reference_text_path is not None and not isinstance(reference_text_path, Path):
        reference_text_path = Path(str(reference_text_path))
    raw_modes = kwargs.pop("modes", _MODE_EVAL_PREPROCESS_MODES)
    modes = tuple(str(mode) for mode in raw_modes)
    core_options = OCRCoreOptions(
        language=str(kwargs.pop("language", "eng")),
        dpi=int(kwargs.pop("dpi", 300)),
        apply_cleanup=bool(kwargs.pop("apply_cleanup", True)),
        binarize_threshold=int(kwargs.pop("binarize_threshold", 190)),
        deskew_max_angle=float(kwargs.pop("deskew_max_angle", 7.0)),
        deskew_angle_step=float(kwargs.pop("deskew_angle_step", 0.5)),
        tesseract_psm=_normalize_tesseract_psm(kwargs.pop("tesseract_psm", "auto")),
        tesseract_output_format=str(kwargs.pop("tesseract_output_format", "text")).strip().lower(),
        cleanup_lexicon_texts=tuple(),
        confidence_aware_cleanup=bool(kwargs.pop("confidence_aware_cleanup", False)),
        cleanup_high_confidence_threshold=float(kwargs.pop("cleanup_high_confidence_threshold", 95.0)),
        orientation_fallback=bool(kwargs.pop("orientation_fallback", False)),
        tiered_ocr_fallback=bool(kwargs.pop("tiered_ocr_fallback", False)),
        tiered_ocr_min_score=float(kwargs.pop("tiered_ocr_min_score", 200.0)),
        layout_region_detection=bool(kwargs.pop("layout_region_detection", False)),
        llm_post_correction=bool(kwargs.pop("llm_post_correction", False)),
        llm_min_low_confidence_ratio=float(kwargs.pop("llm_min_low_confidence_ratio", 0.08)),
        llm_max_word_delta_ratio=float(kwargs.pop("llm_max_word_delta_ratio", 0.2)),
        llm_suspicious_sections=bool(kwargs.pop("llm_suspicious_sections", False)),
        llm_suspicious_max_candidates=int(kwargs.pop("llm_suspicious_max_candidates", 12)),
        llm_suspicious_max_sections=int(kwargs.pop("llm_suspicious_max_sections", 6)),
    )
    return ModeEvalOptions(
        core=core_options,
        ocr_engine=str(kwargs.pop("ocr_engine", "tesseract")),
        reference_text_path=reference_text_path,
        modes=modes,
    )


def _mode_ocr_kwargs(options: ModeEvalOptions, mode: str) -> dict[str, Any]:
    return {
        "language": options.core.language,
        "dpi": options.core.dpi,
        "apply_cleanup": options.core.apply_cleanup,
        "preprocess_mode": mode,
        "binarize_threshold": options.core.binarize_threshold,
        "deskew_max_angle": options.core.deskew_max_angle,
        "deskew_angle_step": options.core.deskew_angle_step,
        "tesseract_psm": options.core.tesseract_psm,
        "tesseract_output_format": options.core.tesseract_output_format,
        "confidence_aware_cleanup": options.core.confidence_aware_cleanup,
        "cleanup_high_confidence_threshold": options.core.cleanup_high_confidence_threshold,
        "orientation_fallback": options.core.orientation_fallback,
        "tiered_ocr_fallback": options.core.tiered_ocr_fallback,
        "tiered_ocr_min_score": options.core.tiered_ocr_min_score,
        "layout_region_detection": options.core.layout_region_detection,
        "llm_post_correction": options.core.llm_post_correction,
        "llm_min_low_confidence_ratio": options.core.llm_min_low_confidence_ratio,
        "llm_max_word_delta_ratio": options.core.llm_max_word_delta_ratio,
        "llm_suspicious_sections": options.core.llm_suspicious_sections,
        "llm_suspicious_max_candidates": options.core.llm_suspicious_max_candidates,
        "llm_suspicious_max_sections": options.core.llm_suspicious_max_sections,
        "ocr_engine": options.ocr_engine,
    }


def _rank_modes(report: dict[str, object]) -> list[tuple[str, float, float]]:
    modes_payload = report["modes"]
    if not isinstance(modes_payload, dict):
        return []
    ranked = []
    for mode_name, mode_payload in modes_payload.items():
        if not isinstance(mode_name, str) or not isinstance(mode_payload, dict):
            continue
        accuracy_payload = mode_payload.get("accuracy", {})
        if not isinstance(accuracy_payload, dict):
            continue
        ranked.append(
            (
                mode_name,
                float(accuracy_payload.get("wer", 1.0)),
                float(accuracy_payload.get("cer", 1.0)),
            )
        )
    return sorted(ranked, key=lambda item: (item[1], item[2]))


def evaluate_ocr_preprocess_modes(
    pdf_path: Path,
    work_dir: Path,
    output_report_path: Path,
    **kwargs: Any,
) -> dict[str, object]:
    """Run OCR across preprocess modes and optionally score against reference text."""

    parse_kwargs = dict(kwargs)
    options = _parse_mode_eval_options(parse_kwargs)
    _ensure_no_unknown_kwargs(parse_kwargs, "evaluate_ocr_preprocess_modes")
    report = _initialize_mode_eval_report(pdf_path, options)
    reference_text = _load_reference_text(options)
    for mode in options.modes:
        mode_payload = _run_single_mode(pdf_path, work_dir, options, mode, reference_text)
        _store_mode_payload(report, mode, mode_payload)
    if reference_text is not None:
        _attach_mode_ranking(report)

    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return report


def _initialize_mode_eval_report(pdf_path: Path, options: ModeEvalOptions) -> dict[str, object]:
    report: dict[str, object] = {"pdf_path": str(pdf_path), "modes": {}}
    if options.reference_text_path is not None:
        report["reference_text_path"] = str(options.reference_text_path)
        report["mode_ranking"] = []
        report["best_mode"] = None
    return report


def _load_reference_text(options: ModeEvalOptions) -> str | None:
    if options.reference_text_path is None:
        return None
    return options.reference_text_path.read_text(encoding="utf-8")


def _run_single_mode(
    pdf_path: Path,
    work_dir: Path,
    options: ModeEvalOptions,
    mode: str,
    reference_text: str | None,
) -> dict[str, object]:
    mode_output_path = work_dir / "mode_outputs" / f"{mode}.txt"
    mode_work_dir = work_dir / f"work_{mode}"
    mode_metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=mode_output_path,
        work_dir=mode_work_dir,
        cleanup_lexicon_texts=(reference_text,) if reference_text is not None else (),
        **_mode_ocr_kwargs(options, mode),
    )
    mode_payload: dict[str, object] = dict(mode_metrics)
    mode_payload["output_text_path"] = str(mode_output_path)
    if reference_text is not None:
        hypothesis_text = mode_output_path.read_text(encoding="utf-8")
        mode_payload["accuracy"] = benchmark_module.calculate_accuracy_metrics(
            reference_text,
            hypothesis_text,
        )
        mode_payload["token_confusions"] = benchmark_module.summarize_token_confusions(
            reference_text,
            hypothesis_text,
        )
    return mode_payload


def _store_mode_payload(
    report: dict[str, object],
    mode: str,
    mode_payload: dict[str, object],
) -> None:
    modes_payload = report.get("modes")
    if isinstance(modes_payload, dict):
        modes_payload[mode] = mode_payload


def _attach_mode_ranking(report: dict[str, object]) -> None:
    ranked = _rank_modes(report)
    report["mode_ranking"] = [
        {"mode": mode_name, "wer": wer, "cer": cer}
        for mode_name, wer, cer in ranked
    ]
    if ranked:
        report["best_mode"] = ranked[0][0]


def _parse_local_archive_options(kwargs: dict[str, Any]) -> LocalArchiveBenchmarkOptions:
    core_options = OCRCoreOptions(
        language=str(kwargs.pop("language", "eng")),
        dpi=int(kwargs.pop("dpi", 300)),
        apply_cleanup=bool(kwargs.pop("apply_cleanup", True)),
        binarize_threshold=int(kwargs.pop("binarize_threshold", 190)),
        deskew_max_angle=float(kwargs.pop("deskew_max_angle", 7.0)),
        deskew_angle_step=float(kwargs.pop("deskew_angle_step", 0.5)),
        tesseract_psm=_normalize_tesseract_psm(kwargs.pop("tesseract_psm", "auto")),
        tesseract_output_format=str(kwargs.pop("tesseract_output_format", "text")).strip().lower(),
        cleanup_lexicon_texts=tuple(),
        confidence_aware_cleanup=bool(kwargs.pop("confidence_aware_cleanup", False)),
        cleanup_high_confidence_threshold=float(kwargs.pop("cleanup_high_confidence_threshold", 95.0)),
        orientation_fallback=bool(kwargs.pop("orientation_fallback", False)),
        tiered_ocr_fallback=bool(kwargs.pop("tiered_ocr_fallback", False)),
        tiered_ocr_min_score=float(kwargs.pop("tiered_ocr_min_score", 200.0)),
        layout_region_detection=bool(kwargs.pop("layout_region_detection", False)),
        llm_post_correction=bool(kwargs.pop("llm_post_correction", False)),
        llm_min_low_confidence_ratio=float(kwargs.pop("llm_min_low_confidence_ratio", 0.08)),
        llm_max_word_delta_ratio=float(kwargs.pop("llm_max_word_delta_ratio", 0.2)),
        llm_suspicious_sections=bool(kwargs.pop("llm_suspicious_sections", False)),
        llm_suspicious_max_candidates=int(kwargs.pop("llm_suspicious_max_candidates", 12)),
        llm_suspicious_max_sections=int(kwargs.pop("llm_suspicious_max_sections", 6)),
    )
    return LocalArchiveBenchmarkOptions(
        core=core_options,
        archive_source_mode=str(kwargs.pop("archive_source_mode", "djvu")),
        ocr_engine=str(kwargs.pop("ocr_engine", "tesseract")),
    )


def _archive_reference_pairs(
    archive_identifier: str,
    archive_source_mode: str,
) -> list[tuple[str, str]]:
    if archive_source_mode not in {"djvu", "abbyy", "best"}:
        raise ValueError("archive_source_mode must be one of: djvu, abbyy, best")
    djvu_reference = benchmark_module.fetch_archive_ocr_text(archive_identifier)
    abbyy_reference = benchmark_module.fetch_archive_abbyy_text(archive_identifier)
    if archive_source_mode == "abbyy" and abbyy_reference is None:
        raise ValueError(
            "archive_source_mode='abbyy' requested but no ABBYY OCR is available for "
            f"{archive_identifier}"
        )
    references: list[tuple[str, str]] = [("djvu", djvu_reference)]
    if abbyy_reference is not None:
        references.append(("abbyy", abbyy_reference))
    if archive_source_mode in {"djvu", "abbyy"}:
        return [item for item in references if item[0] == archive_source_mode]
    return references


def _best_scores(mode_report: dict[str, object]) -> tuple[float, float]:
    ranking = mode_report.get("mode_ranking", [])
    if isinstance(ranking, list) and ranking:
        first = ranking[0]
        if isinstance(first, dict):
            return float(first.get("wer", 1.0)), float(first.get("cer", 1.0))
    return 1.0, 1.0


def benchmark_local_ocr_against_archive(
    pdf_path: Path,
    archive_identifier: str,
    output_report_path: Path,
    work_dir: Path,
    **kwargs: Any,
) -> dict[str, object]:
    """Benchmark local OCR outputs against archive OCR references."""

    parse_kwargs = dict(kwargs)
    options = _parse_local_archive_options(parse_kwargs)
    _ensure_no_unknown_kwargs(parse_kwargs, "benchmark_local_ocr_against_archive")
    references = _archive_reference_pairs(archive_identifier, options.archive_source_mode)
    candidate_reports = [
        _build_source_candidate(
            SourceCandidateRequest(
                pdf_path=pdf_path,
                archive_identifier=archive_identifier,
                source_name=source_name,
                reference_text=reference_text,
                work_dir=work_dir,
                options=options,
            )
        )
        for source_name, reference_text in references
    ]

    selected = min(
        candidate_reports,
        key=lambda item: (float(item["best_wer"]), float(item["best_cer"])),
    )
    selected_report = _build_selected_archive_report(
        selected,
        archive_identifier,
        options.archive_source_mode,
        candidate_reports,
    )
    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(
        json.dumps(selected_report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return selected_report


def _build_source_candidate(request: SourceCandidateRequest) -> dict[str, object]:
    reference_path = (
        request.work_dir
        / "references"
        / f"{request.archive_identifier}_{request.source_name}.txt"
    )
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    reference_path.write_text(request.reference_text, encoding="utf-8")
    candidate_output_path = request.work_dir / "candidate_reports" / f"{request.source_name}.json"
    mode_report = evaluate_ocr_preprocess_modes(
        pdf_path=request.pdf_path,
        work_dir=request.work_dir / f"mode_eval_{request.source_name}",
        output_report_path=candidate_output_path,
        reference_text_path=reference_path,
        language=request.options.core.language,
        dpi=request.options.core.dpi,
        apply_cleanup=request.options.core.apply_cleanup,
        binarize_threshold=request.options.core.binarize_threshold,
        deskew_max_angle=request.options.core.deskew_max_angle,
        deskew_angle_step=request.options.core.deskew_angle_step,
        ocr_engine=request.options.ocr_engine,
    )
    best_wer, best_cer = _best_scores(mode_report)
    return {
        "source": request.source_name,
        "report_path": str(candidate_output_path),
        "best_wer": best_wer,
        "best_cer": best_cer,
        "mode_report": mode_report,
    }


def _build_selected_archive_report(
    selected: dict[str, object],
    archive_identifier: str,
    archive_source_mode: str,
    candidate_reports: list[dict[str, object]],
) -> dict[str, object]:
    selected_report = dict(selected["mode_report"])
    selected_report["archive_identifier"] = archive_identifier
    selected_report["archive_source_mode"] = archive_source_mode
    selected_report["selected_archive_source"] = selected["source"]
    selected_report["candidate_sources"] = [
        {
            "source": item["source"],
            "best_wer": item["best_wer"],
            "best_cer": item["best_cer"],
            "report_path": item["report_path"],
        }
        for item in candidate_reports
    ]
    return selected_report
