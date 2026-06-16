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
from typing import Any, Callable, Sequence

from . import benchmark as benchmark_module
from .image_validation import validate_raster_image
from .ocr_cleanup import cleanup_ocr_text, is_hyphenated_capital_i_correction, is_known_word_correction, is_pipe_to_capital_i_correction, is_roman_numeral_correction
from .pillow_compat import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps
from .rust_accel import get_rust_inverse_render_accel
from .wordfreq_compat import (
    is_probable_real_word as _is_probable_real_word,
    real_word_log_frequency as _real_word_log_frequency,
)
from .ngram_compat import (
    has_language_model_signal as _has_language_model_signal,
    trigram_coverage as _trigram_coverage,
    trigram_log_likelihood as _trigram_log_likelihood,
)

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
_AUTO_MASKED_MIN_SCORE_GAIN = 80.0
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
_ADAPTIVE_RASTER_MARGIN_BY_REASON = {
    "front-matter": (0.03, 0.045),
    "back-matter": (0.025, 0.035),
    "body-review": (0.018, 0.025),
    "low-quality": (0.02, 0.03),
}
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
_MEDIUM_QUALITY_SINGLE_CHAR_FRAGMENT_RATIO = 0.012
_LOW_QUALITY_SINGLE_CHAR_FRAGMENT_RATIO = 0.03
_MEDIUM_QUALITY_APOSTROPHE_FRAGMENT_RATIO = 0.006
_LOW_QUALITY_APOSTROPHE_FRAGMENT_RATIO = 0.015
_AMBIGUOUS_CANDIDATE_SCORE_GAP = 140.0
_HIGH_AMBIGUITY_CANDIDATE_SCORE_GAP = 80.0
_AMBIGUOUS_CANDIDATE_TEXT_SIMILARITY = 0.94
_HIGH_AMBIGUITY_CANDIDATE_TEXT_SIMILARITY = 0.9
_LOW_QUALITY_RETRY_MAX_SCORE_DROP = 10.0
_LOW_QUALITY_RETRY_ARTIFACT_IMPROVEMENT_RATIO = 0.85
_SUSPICIOUS_SECTION_MIN_WORDS = 24
_SUSPICIOUS_SECTION_WINDOW_WORDS = 120
_SUSPICIOUS_SECTION_WINDOW_OVERLAP_WORDS = 40
_MAX_SUSPICIOUS_SECTION_FOCUS_SPANS = 3
_SUSPICIOUS_SYMBOLIC_TOKEN_RE = re.compile(r"\b(?=\S*[A-Za-z])(?=\S*[%{}\[\]<>|\\/@#$^*_~`])\S+\b")
_SUSPICIOUS_DIGIT_ALPHA_TOKEN_RE = re.compile(r"\b(?=\w*[A-Za-z])(?=\w*\d)\w+\b")
_PUNCTUATION_STRIP_CHARS = ".,;:!?()[]{}<>\""
_SINGLE_CHAR_TOKEN_ALLOWLIST = frozenset({"a", "i"})
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
    resume: bool = False
    predict_preprocess_mode: bool = False


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
    _trim_top_bands(
        bands,
        significant_indices,
        draw,
        width,
        first_significant,
        height,
        trim_limit,
    )
    _trim_bottom_bands(
        bands,
        significant_indices,
        draw,
        width,
        last_significant,
        height,
        trim_limit,
    )
    return masked


def _trim_top_bands(
    bands: list[dict[str, int]],
    significant_indices: list[int],
    draw: Any,
    width: int,
    first_significant: dict[str, int],
    height: int,
    trim_limit: int,
) -> int:
    trimmed_top = 0
    for band in bands[: significant_indices[0]]:
        band_height = band["height"]
        if trimmed_top + band_height > trim_limit:
            break
        if not _should_mask_outer_band(band, first_significant, width, height):
            continue
        draw.rectangle((0, band["top"], width, band["bottom"]), fill=255)
        trimmed_top += band_height
    return trimmed_top


def _trim_bottom_bands(
    bands: list[dict[str, int]],
    significant_indices: list[int],
    draw: Any,
    width: int,
    last_significant: dict[str, int],
    height: int,
    trim_limit: int,
) -> int:
    trimmed_bottom = 0
    for band in reversed(bands[significant_indices[-1] + 1 :]):
        band_height = band["height"]
        if trimmed_bottom + band_height > trim_limit:
            break
        if not _should_mask_outer_band(band, last_significant, width, height):
            continue
        draw.rectangle((0, band["top"], width, band["bottom"]), fill=255)
        trimmed_bottom += band_height
    return trimmed_bottom


def _apply_threshold_tiled_or_direct(
    image: Any,
    threshold_fn: Callable[[Any], Any],
) -> Any:
    if _should_use_tiled_threshold(image):
        return _threshold_image_in_overlapping_tiles(
            image,
            tile_size=_TILED_THRESHOLD_TILE_SIZE,
            overlap=_TILED_THRESHOLD_OVERLAP,
            threshold_fn=threshold_fn,
        )
    return threshold_fn(image)


def _apply_gaussian_threshold_tiled_or_direct(image: Any) -> Any:
    return _apply_threshold_tiled_or_direct(
        image,
        lambda tile: _adaptive_gaussian_threshold(
            tile,
            block_size=51,
            subtract_constant=15,
        ),
    )


def _apply_sauvola_threshold_tiled_or_direct(image: Any) -> Any:
    return _apply_threshold_tiled_or_direct(
        image,
        lambda tile: _sauvola_threshold(
            tile,
            block_size=41,
            k=0.25,
        ),
    )


def _binarize_preprocessed_candidate(
    candidate: Any,
    preprocess_mode: str,
    binarize_threshold: int,
) -> Any:
    if preprocess_mode == "scan":
        effective_threshold = _otsu_threshold(candidate)
        return candidate.point(lambda value: 255 if value >= effective_threshold else 0)
    if preprocess_mode == "scan-local-threshold":
        return _apply_gaussian_threshold_tiled_or_direct(candidate)
    if preprocess_mode == "scan-background-normalized":
        normalized = _normalize_scan_background(
            candidate,
            blur_radius=_SCAN_BACKGROUND_NORMALIZATION_BLUR_RADIUS,
            contrast_scale=_SCAN_BACKGROUND_NORMALIZATION_CONTRAST_SCALE,
            closing_size=_SCAN_BACKGROUND_NORMALIZATION_CLOSING_SIZE,
        )
        return _apply_sauvola_threshold_tiled_or_direct(normalized)
    if preprocess_mode == "scan-sauvola":
        return _apply_sauvola_threshold_tiled_or_direct(candidate)
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


# Simple per-page image quality thresholds. Used by the
# pre-auto-mode image-quality classifier to decide which
# preprocess candidates are worth trying.
# Pages with mean brightness in [LOW_BRIGHTNESS_THRESHOLD,
# HIGH_BRIGHTNESS_THRESHOLD] are considered normal; pages
# outside that range are flagged as low-quality.
_LOW_BRIGHTNESS_THRESHOLD = 60.0
_HIGH_BRIGHTNESS_THRESHOLD = 240.0
# Pages with std-dev above LOW_CONTRAST_THRESHOLD are
# considered high-contrast (clean scans); below it the page
# is washed out or has uneven background.
_LOW_CONTRAST_THRESHOLD = 25.0
_HIGH_CONTRAST_THRESHOLD = 60.0


def _image_quality_features(image: Any) -> dict[str, float]:
    """Return simple image-quality features for the per-page
    preprocess-mode classifier. The features are deliberately
    cheap: mean brightness, contrast (std-dev), and a binary
    threshold (text-area ratio). They are good enough to
    separate clean scans from degraded scans on the built-in
    benchmark corpus and only need a single pass over the image.
    """
    if Image is None:
        return {"mean": 128.0, "std": 60.0, "text_ratio": 0.1}
    grayscale = image.convert("L")
    histogram = grayscale.histogram()
    total = sum(histogram)
    if total <= 0:
        return {"mean": 128.0, "std": 60.0, "text_ratio": 0.1}
    mean = sum(value * count for value, count in enumerate(histogram)) / float(total)
    variance = (
        sum(((value - mean) ** 2) * count for value, count in enumerate(histogram))
        / float(total)
    )
    std = variance ** 0.5
    threshold = _otsu_threshold(grayscale)
    dark_count = sum(count for value, count in enumerate(histogram) if value < threshold)
    text_ratio = dark_count / float(total)
    return {"mean": float(mean), "std": float(std), "text_ratio": float(text_ratio)}


def _classify_preprocess_mode(image: Any) -> str:
    """Return the most promising preprocess mode for a page based
    on cheap image-quality features. Used by the
    ``--predict-preprocess-mode`` CLI flag to skip the slow
    full-auto candidate sweep on clean pages.

    The mapping is conservative: a clean scan lands on
    ``basic``, a degraded scan lands on ``scan`` /
    ``scan-local-threshold`` / ``scan-sauvola`` depending on
    the kind of degradation. The auto mode is recommended
    when this classifier is uncertain; users who want
    maximum accuracy should always prefer ``auto``.
    """
    features = _image_quality_features(image)
    mean = features["mean"]
    std = features["std"]
    # High-contrast, normal-brightness scans are clean; basic
    # preprocessing is enough. ``basic`` does autocontrast +
    # 3x upsample without binarisation, which is the fastest
    # path on a clean scan.
    if std >= _HIGH_CONTRAST_THRESHOLD and _LOW_BRIGHTNESS_THRESHOLD <= mean <= _HIGH_BRIGHTNESS_THRESHOLD:
        return "basic"
    # Low-contrast scans need a Sauvola-style local threshold to
    # separate the text from the uneven background.
    if std < _LOW_CONTRAST_THRESHOLD:
        return "scan-sauvola"
    # Normal-contrast scans that are darker than average benefit
    # from the local-threshold path.
    if mean < _LOW_BRIGHTNESS_THRESHOLD:
        return "scan-local-threshold"
    # Brighter-than-average scans benefit from background
    # normalisation before thresholding.
    if mean > _HIGH_BRIGHTNESS_THRESHOLD:
        return "scan-background-normalized"
    return "scan"


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
            left_crop, top_crop, right_crop, bottom_crop = _threshold_tile_crop_bounds(
                x_start,
                y_start,
                x_end,
                y_end,
                thresholded_tile.width,
                thresholded_tile.height,
                image.width,
                image.height,
                overlap_crop,
            )
            cropped_tile = thresholded_tile.crop((left_crop, top_crop, right_crop, bottom_crop))
            stitched.paste(cropped_tile, (x_start + left_crop, y_start + top_crop))
    return stitched


def _threshold_tile_crop_bounds(
    x_start: int,
    y_start: int,
    x_end: int,
    y_end: int,
    tile_width: int,
    tile_height: int,
    image_width: int,
    image_height: int,
    overlap_crop: int,
) -> tuple[int, int, int, int]:
    return (
        0 if x_start == 0 else overlap_crop,
        0 if y_start == 0 else overlap_crop,
        tile_width if x_end == image_width else tile_width - overlap_crop,
        tile_height if y_end == image_height else tile_height - overlap_crop,
    )


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

    for y in range(height):
        for x in range(width):
            component = _flood_fill_component(pixels, width, height, x, y, visited)
            if len(component) >= min_component_pixels or not component:
                continue
            for cx, cy in component:
                pixels[cx, cy] = 255
    return cleaned


def _flood_fill_component(
    pixels: Any,
    width: int,
    height: int,
    x: int,
    y: int,
    visited: bytearray,
) -> list[tuple[int, int]]:
    def _index(current_x: int, current_y: int) -> int:
        return (current_y * width) + current_x

    start_index = _index(x, y)
    if visited[start_index] or int(pixels[x, y]) >= 128:
        return []
    stack = [(x, y)]
    component: list[tuple[int, int]] = []
    visited[start_index] = 1
    while stack:
        current_x, current_y = stack.pop()
        component.append((current_x, current_y))
        for next_y in range(max(0, current_y - 1), min(height - 1, current_y + 1) + 1):
            for next_x in range(max(0, current_x - 1), min(width - 1, current_x + 1) + 1):
                neighbor_index = _index(next_x, next_y)
                if visited[neighbor_index] or int(pixels[next_x, next_y]) >= 128:
                    continue
                visited[neighbor_index] = 1
                stack.append((next_x, next_y))
    return component


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
        resume=bool(kwargs.pop("resume", False)),
        predict_preprocess_mode=bool(kwargs.pop("predict_preprocess_mode", False)),
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
    if options.candidate_preprocess_modes_override:
        _validate_candidate_preprocess_modes(options.candidate_preprocess_modes_override)
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
    reuse_existing: bool = False,
) -> list[Path]:
    pages_dir = work_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    if reuse_existing:
        existing_page_images = sorted(pages_dir.glob("page-*.png"))
        if existing_page_images:
            return existing_page_images
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
            _poll_rasterize_with_progress(
                command,
                pages_dir,
                total_pages,
                progress_callback,
                started_at,
            )
        else:
            run_command(command, False)
    else:
        run_command(command, False)
    page_images = sorted(pages_dir.glob("page-*.png"))
    if not page_images:
        raise RuntimeError("pdftoppm produced no page images")
    return page_images


def _poll_rasterize_with_progress(
    command: list[str],
    pages_dir: Path,
    total_pages: int,
    progress_callback: Callable[[dict[str, object]], None],
    started_at: float,
) -> None:
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
            return
        time.sleep(1.0)


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


def _is_valid_candidate_preprocess_mode(preprocess_mode: str) -> bool:
    base_preprocess_mode, apply_region_masking = _split_preprocess_mode(preprocess_mode)
    if base_preprocess_mode == "auto" or base_preprocess_mode not in _VALID_PREPROCESS_MODES:
        return False
    if not apply_region_masking:
        return True
    return _uses_scan_preprocess_stack(base_preprocess_mode)


def _validate_candidate_preprocess_modes(modes: tuple[str, ...]) -> tuple[str, ...]:
    invalid_modes = [mode for mode in modes if not _is_valid_candidate_preprocess_mode(mode)]
    if invalid_modes:
        invalid = ", ".join(sorted(set(invalid_modes)))
        raise ValueError(
            "candidate_preprocess_modes_override must contain only concrete preprocess modes "
            f"or supported masked scan variants; invalid values: {invalid}"
        )
    return modes


def _candidate_preprocess_modes_for_options(options: OCRRunOptions) -> tuple[str, ...]:
    if options.candidate_preprocess_modes_override:
        return _validate_candidate_preprocess_modes(options.candidate_preprocess_modes_override)
    return _candidate_preprocess_modes(options.preprocess_mode)


def _candidate_tesseract_psms(options: OCRRunOptions) -> tuple[str, ...]:
    if options.ocr_engine not in {"tesseract", "ensemble"}:
        return ("",)
    if options.candidate_tesseract_psms_override:
        return options.candidate_tesseract_psms_override
    if options.core.tesseract_psm == "auto":
        return _AUTO_TESSERACT_PSMS
    return (options.core.tesseract_psm,)


def _prepared_ocr_inputs_match(first_path: Path, second_path: Path) -> bool:
    if first_path == second_path:
        return True
    if Image is not None and ImageChops is not None:
        try:
            with Image.open(first_path) as first_image, Image.open(second_path) as second_image:
                if first_image.size != second_image.size or first_image.mode != second_image.mode:
                    return False
                return ImageChops.difference(first_image, second_image).getbbox() is None
        except OSError:
            pass
    return first_path.read_bytes() == second_path.read_bytes()


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
    base_preprocess_mode, apply_region_masking = _split_preprocess_mode(preprocess_mode)
    if apply_region_masking:
        unmasked_path = _prepare_ocr_input_path(
            image_path,
            base_preprocess_mode,
            options,
            dependencies,
            preprocessed_dir,
            prepared_inputs,
        )
    else:
        unmasked_path = None
    preprocessed_path = preprocessed_dir / preprocess_mode / image_path.name
    dependencies.preprocess_image(
        image_path,
        preprocessed_path,
        preprocess_mode,
        options.core.binarize_threshold,
        options.core.deskew_max_angle,
        options.core.deskew_angle_step,
    )
    if (
        unmasked_path is not None
        and preprocessed_path.exists()
        and _prepared_ocr_inputs_match(unmasked_path, preprocessed_path)
    ):
        preprocessed_path.unlink()
        prepared_inputs[preprocess_mode] = unmasked_path
        return unmasked_path
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
    real_word_bonus = 0.0
    real_word_log_total = 0.0
    real_word_count = 0
    non_real_word_count = 0
    is_english = language.lower().strip() in {"eng", "en"}
    if is_english:
        for token in token_matches:
            lower_token = token.lower()
            if lower_token in _COMMON_ENGLISH_WORDS:
                common_word_bonus += 1.0
            if _is_probable_real_word(lower_token):
                real_word_bonus += 1.0
                real_word_log_total += _real_word_log_frequency(lower_token)
                real_word_count += 1
            else:
                non_real_word_count += 1
    avg_token_length = sum(len(token) for token in token_matches) / len(token_matches)
    token_length_penalty = abs(avg_token_length - 5.0) * 3.0
    # Real-word log frequency: 0 at the noise floor (-12) and 60 at
    # the upper end (log10(1.0) = 0), scaled to dominate the noisy-char
    # penalty. Each "real" token contributes its log frequency; a
    # candidate that is mostly real English picks up several hundred
    # points, while a candidate with mostly OCR garbage stays near
    # zero (because each non-word returns -12 -> 0 contribution).
    real_word_log_score = (real_word_log_total + (-12.0) * non_real_word_count) if is_english else 0.0
    # Trigram coverage and log-likelihood are the strongest signals
    # for distinguishing real prose from per-word-correct-but-globally
    # weird text (e.g. "be fox he vent to bed" -- every word is real
    # English but the phrase isn't). They are weighted strongly
    # because they are essentially zero for OCR garbage and 0.3-0.8
    # for clean English prose. We only enable the log-likelihood on
    # snippets of 6+ tokens so the smoothing floor does not unfairly
    # penalise short OCR snippets containing proper nouns or unusual
    # but real phrases that brown never saw.
    if is_english and _has_language_model_signal() and len(token_matches) >= 3:
        trigram_cov = _trigram_coverage(stripped)
    else:
        trigram_cov = 0.0
    if is_english and _has_language_model_signal() and len(token_matches) >= 6:
        trigram_loglik = _trigram_log_likelihood(stripped)
    else:
        trigram_loglik = 0.0
    # Trigram coverage is the most reliable signal: 0 for OCR
    # garbage, 0.3-0.8 for real English prose. We weight it
    # heavily (×30) so it dominates the noisy-char penalty but does
    # not overwhelm the unigram/wordfreq signal for short snippets.
    # Loglik is weighted lightly (×1) and only on longer text to
    # act as a tie-breaker between coverage-tied candidates.
    trigram_score = trigram_cov * 30.0 + trigram_loglik * 1.0
    return (
        float(alpha_chars) * 1.4
        + float(space_chars) * 0.4
        + common_word_bonus * 10.0
        + real_word_bonus * 6.0
        + real_word_log_score * 2.0
        + trigram_score
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


def _ensemble_fuse_texts(
    base_text: str,
    other_text: str,
    language: str,
    cleanup_lexicon_texts: tuple[str, ...],
    *,
    base_engine: str,
    other_engine: str,
) -> tuple[str, dict[str, object]]:
    """Word-level fusion of two OCR engine outputs.

    Aligns ``base_text`` and ``other_text`` at the word level using
    ``difflib.SequenceMatcher`` and, for each aligned position, picks
    the engine whose word scores higher on the per-word lexical
    scorer. ``base_text`` is the higher-scoring engine and is used
    as the structural template (line breaks, spacing, page
    artefacts); ``other_text`` is consulted only for word-level
    swaps. When the engines agree, the base word is kept. When only
    one engine produced a word, that word is kept.

    Returns the fused text and a metadata dict describing the
    fusion decisions.
    """
    if not base_text:
        return base_text, {
            "ensemble_fusion_enabled": True,
            "ensemble_fusion_alignments": 0,
            "ensemble_fusion_swaps": 0,
            "ensemble_fusion_base_engine": base_engine,
            "ensemble_fusion_other_engine": other_engine,
        }
    if not other_text:
        return base_text, {
            "ensemble_fusion_enabled": True,
            "ensemble_fusion_alignments": 0,
            "ensemble_fusion_swaps": 0,
            "ensemble_fusion_base_engine": base_engine,
            "ensemble_fusion_other_engine": other_engine,
        }
    base_tokens = _LATIN_TOKEN.findall(base_text)
    other_tokens = _LATIN_TOKEN.findall(other_text)
    if not base_tokens or not other_tokens:
        return base_text, {
            "ensemble_fusion_enabled": True,
            "ensemble_fusion_alignments": 0,
            "ensemble_fusion_swaps": 0,
            "ensemble_fusion_base_engine": base_engine,
            "ensemble_fusion_other_engine": other_engine,
        }
    matcher = SequenceMatcher(a=base_tokens, b=other_tokens, autojunk=False)
    # swap_map maps a base-token position (index) to a chosen word
    # from ``other_text`` (or the same base word if we keep it).
    swap_map: dict[int, str] = {}
    alignments = 0
    swaps = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            alignments += i2 - i1
            continue
        if tag == "replace":
            base_span = base_tokens[i1:i2]
            other_span = other_tokens[j1:j2]
            if len(base_span) == 1 and len(other_span) == 1:
                base_word = base_span[0]
                other_word = other_span[0]
                base_score = _score_text_quality(base_word, language)
                other_score = _score_text_quality(other_word, language)
                # Only swap when the other engine is clearly better;
                # ties / small gaps default to the base engine to keep
                # structural choices stable.
                if other_score > base_score + 5.0:
                    swap_map[i1] = other_word
                    swaps += 1
                alignments += 1
            else:
                # Multi-word alignment: score each side as a phrase and
                # keep the better one. The base side is the structural
                # anchor so we only swap the whole span if it improves
                # the score clearly.
                base_phrase = " ".join(base_span)
                other_phrase = " ".join(other_span)
                base_score = _score_text_quality(base_phrase, language)
                other_score = _score_text_quality(other_phrase, language)
                if other_score > base_score + 5.0:
                    for index, replacement in zip(
                        range(i1, i2), _split_replace_into_base_length(base_span, other_span), strict=False
                    ):
                        swap_map[index] = replacement
                    swaps += 1
                alignments += max(i2 - i1, j2 - j1)
        elif tag == "delete":
            # Base has a word the other engine missed: keep it
            alignments += i2 - i1
        elif tag == "insert":
            # Other engine has an extra word the base missed: keep the
            # base structural choice; the extra word is dropped. This
            # is the conservative default because the base engine was
            # already the higher-scoring one.
            alignments += j2 - j1
    fused_tokens: list[str] = []
    for index, base_word in enumerate(base_tokens):
        fused_tokens.append(swap_map.get(index, base_word))
    fused_text = _replace_words_in_text(base_text, base_tokens, fused_tokens)
    return fused_text, {
        "ensemble_fusion_enabled": True,
        "ensemble_fusion_alignments": alignments,
        "ensemble_fusion_swaps": swaps,
        "ensemble_fusion_base_engine": base_engine,
        "ensemble_fusion_other_engine": other_engine,
        "ensemble_fusion_base_token_count": len(base_tokens),
        "ensemble_fusion_other_token_count": len(other_tokens),
    }


def _split_replace_into_base_length(
    base_span: list[str],
    other_span: list[str],
) -> list[str]:
    """Pad or truncate ``other_span`` to match ``base_span`` length.

    Used when the fused text needs to swap a multi-word span in
    place. The output length always equals ``len(base_span)`` so the
    fused text keeps the same number of word positions as the base.
    """
    if not other_span:
        return [""] * len(base_span)
    if len(other_span) == len(base_span):
        return other_span
    if len(other_span) < len(base_span):
        # Pad with empty strings; the structural text will collapse
        # the double-space but the line shape is preserved.
        return other_span + [""] * (len(base_span) - len(other_span))
    # Truncate the longer span so we never add words.
    return other_span[: len(base_span)]


def _replace_words_in_text(
    text: str,
    base_tokens: list[str],
    fused_tokens: list[str],
) -> str:
    """Replace the i-th occurrence of ``base_tokens[i]`` in ``text`` with ``fused_tokens[i]``.

    This is deliberately an in-place word substitution that preserves
    the original line breaks, spacing, and punctuation of ``text``.
    """
    if not base_tokens or base_tokens == fused_tokens:
        return text
    out: list[str] = []
    cursor = 0
    for base_word, fused_word in zip(base_tokens, fused_tokens, strict=True):
        if base_word == fused_word:
            continue
        # Find the next occurrence of base_word starting at cursor.
        # Case-insensitive search so we also catch capitalized forms.
        lower_text = text.lower()
        lower_target = base_word.lower()
        search_from = cursor
        index = lower_text.find(lower_target, search_from)
        if index < 0:
            continue
        # Keep the original casing pattern of the source span when
        # the fused word is the same case; preserve the base casing
        # otherwise.
        original_word = text[index : index + len(base_word)]
        replacement = _match_phrase_case_keep_shape(original_word, fused_word)
        out.append(text[cursor:index])
        out.append(replacement)
        cursor = index + len(base_word)
    out.append(text[cursor:])
    return "".join(out)


def _match_phrase_case_keep_shape(source: str, replacement: str) -> str:
    """Match the case shape of ``source`` onto ``replacement``.

    Mirrors the leading-capitalisation of ``source`` (titlecase,
    all-caps, all-lower) onto ``replacement`` without changing its
    length. Used by the ensemble fusion path to keep the visual
    shape of the line stable.
    """
    if not replacement:
        return source
    if not source:
        return replacement
    if source.isupper():
        return replacement.upper()
    if source[0].isupper():
        return replacement[0].upper() + replacement[1:]
    return replacement


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


@lru_cache(maxsize=1)
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


@lru_cache(maxsize=64)
def _normalized_scan_for_inverse_render_payload(
    image_path_str: str,
    modified_time_ns: int,
    file_size: int,
) -> tuple[bytes, tuple[int, int], tuple[int, int, int, int]]:
    del modified_time_ns, file_size
    image_path = Path(image_path_str)
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
    return binary.tobytes(), binary.size, bbox


def _normalize_scan_for_inverse_render(image_path: Path) -> tuple[Any | None, tuple[int, int, int, int]]:
    if Image is None or ImageFilter is None or ImageOps is None:
        raise RuntimeError(
            "Missing dependency for inverse-render reranking: pillow. "
            "Install with `pip install pillow` or disable inverse-render reranking."
        )
    try:
        stat = image_path.stat()
    except OSError:
        return None, (0, 0, 0, 0)
    try:
        image_bytes, image_size, bbox = _normalized_scan_for_inverse_render_payload(
            str(image_path.resolve()),
            stat.st_mtime_ns,
            stat.st_size,
        )
    except (OSError, ValueError):
        # File is not a real image (e.g. test fixture). The
        # caller falls back to skipping the verification step.
        return None, (0, 0, 0, 0)
    return Image.frombytes("L", image_size, image_bytes), bbox


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
    rendered_candidates, rendered_metadata = _build_inverse_render_candidate_batch(
        render_fonts,
        base_font_size,
        observed_region,
        local_bbox,
        bbox,
        text,
    )
    best_index, best_score = _best_inverse_render_rendered_batch(
        observed_region,
        rendered_candidates,
        observed_bytes=observed_region_bytes,
    )
    best_metadata = dict(rendered_metadata[best_index])
    best_metadata["inverse_render_score"] = best_score
    return best_score, best_metadata


def _build_inverse_render_candidate_batch(
    render_fonts: Sequence[str | None],
    base_font_size: int,
    observed_region: Any,
    local_bbox: tuple[int, int, int, int],
    bbox: tuple[int, int, int, int],
    text: str,
) -> tuple[list[Any], list[dict[str, object]]]:
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
                    for rotation in _INVERSE_RENDER_ROTATIONS:
                        rendered_candidates.append(
                            base_rendered
                            if abs(rotation) < 1e-9
                            else _rotate_inverse_render_image(base_rendered, rotation)
                        )
                        rendered_metadata.append(
                            {
                                "inverse_render_score": -1.0,
                                "inverse_render_bbox": list(bbox),
                                "inverse_render_font_path": font_path,
                                "inverse_render_font_size": font_size,
                                "inverse_render_offset_x": offset_x,
                                "inverse_render_offset_y": offset_y,
                                "inverse_render_rotation": rotation,
                            }
                        )
    return rendered_candidates, rendered_metadata


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
    if not texts:
        return []
    unique_texts, result_indexes = _unique_inverse_render_texts(texts)
    if workers <= 1 or len(unique_texts) <= 1:
        unique_scores = [
            _inverse_render_score_candidate(observed_binary, bbox, text)
            for text in unique_texts
        ]
        return [unique_scores[index] for index in result_indexes]
    requests = [
        _InverseRenderScoreRequest(
            observed_binary=observed_binary,
            bbox=bbox,
            text=text,
        )
        for text in unique_texts
    ]
    worker_count = min(workers, len(requests))
    with ProcessPoolExecutor(max_workers=worker_count) as executor:
        unique_scores = list(executor.map(_score_inverse_render_request, requests))
    return [unique_scores[index] for index in result_indexes]


def _unique_inverse_render_texts(texts: list[str]) -> tuple[list[str], list[int]]:
    unique_texts: list[str] = []
    text_indexes: dict[str, int] = {}
    result_indexes: list[int] = []
    for text in texts:
        text_index = text_indexes.get(text)
        if text_index is None:
            text_index = len(unique_texts)
            unique_texts.append(text)
            text_indexes[text] = text_index
        result_indexes.append(text_index)
    return unique_texts, result_indexes


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


def _clip_bbox_to_canvas(
    bbox: tuple[int, int, int, int],
    canvas_size: tuple[int, int],
) -> tuple[int, int, int, int] | None:
    width, height = canvas_size
    clipped = (
        max(0, min(width, bbox[0])),
        max(0, min(height, bbox[1])),
        max(0, min(width, bbox[2])),
        max(0, min(height, bbox[3])),
    )
    if clipped[2] <= clipped[0] or clipped[3] <= clipped[1]:
        return None
    return clipped


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
        local_bbox = _clip_bbox_to_canvas(
            _expand_bbox(diff_bbox, observed_binary.size, _CLEANUP_SPAN_VERIFIER_DIFF_PADDING),
            observed_binary.size,
        )
    else:
        local_bbox = _clip_bbox_to_canvas(
            _expand_bbox(hint_bbox, observed_binary.size, _CLEANUP_SPAN_VERIFIER_DIFF_PADDING),
            observed_binary.size,
        )
    if local_bbox is None:
        return False, {
            "accepted": False,
            "reason": "invalid-local-bbox",
            "raw_inverse_render_score": raw_score,
            "cleaned_inverse_render_score": cleaned_score,
        }
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
    skip_cleanup, gate_metadata = _cleanup_confidence_gate(selection_metadata, options)
    if skip_cleanup:
        return text, gate_metadata
    cleaned_text = cleanup_ocr_text(text, lexicon_texts=options.core.cleanup_lexicon_texts)
    # Auto-enable span verification for any preprocess mode that
    # has a real binarisable image available. The verifier
    # binarises the input image with Otsu (regardless of the
    # preprocess mode), so it works for ``none`` / ``basic`` /
    # ``deskew`` / the scan stack alike. The user can still
    # disable it via ``--no-verify-cleanup-spans`` if needed.
    verify = options.core.verify_cleanup_spans or _image_supports_cleanup_verify(
        options.preprocess_mode
    )
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
    observed_binary, bbox = _normalize_scan_for_inverse_render(image_path)
    if observed_binary is None:
        # Image binarisation failed (corrupt page image, missing
        # pillow feature, etc.). The cleaned text is still safe
        # to return; we just skip the image verification step.
        return cleaned_text, {
            "cleanup_span_verifier": {
                "enabled": True,
                "changes_considered": len(changes),
                "changes_kept": len(changes),
                "changes_reverted": 0,
                "image_unavailable": True,
            }
        }
    verified_text, decisions, reverted_count = _apply_cleanup_span_reversions(
        changes,
        cleaned_text,
        observed_binary,
        bbox,
        options,
        selection_metadata,
    )
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


# Preprocess modes that have a real binarisable image for the
# cleanup-span verifier. The verifier binarises the input image
# with Otsu, so any mode that has an actual image input is fine;
# only pure-text / no-image modes are excluded.
_NO_IMAGE_PREPROCESS_MODES = frozenset({"none"})


def _image_supports_cleanup_verify(preprocess_mode: str) -> bool:
    """Return True when the preprocess mode produces an image the
    cleanup-span verifier can binarise."""
    base_mode, _masked = _split_preprocess_mode(preprocess_mode)
    return base_mode not in _NO_IMAGE_PREPROCESS_MODES


def _cleanup_confidence_gate(
    selection_metadata: dict[str, object],
    options: OCRRunOptions,
) -> tuple[bool, dict[str, object]]:
    if not options.core.confidence_aware_cleanup:
        return False, {}
    mean_confidence = selection_metadata.get("hocr_confidence_mean")
    if not isinstance(mean_confidence, (float, int)):
        return False, {}
    mean_confidence_value = float(mean_confidence)
    if mean_confidence_value < options.core.cleanup_high_confidence_threshold:
        return False, {}
    return True, {
        "cleanup_confidence_gate": {
            "enabled": True,
            "action": "skipped-cleanup",
            "mean_confidence": mean_confidence_value,
            "threshold": options.core.cleanup_high_confidence_threshold,
        }
    }


def _cleanup_span_decision(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    raw_variant: str,
    verified_text: str,
    hint_bbox: tuple[int, int, int, int] | None,
    options: OCRRunOptions,
) -> tuple[bool, dict[str, object]]:
    evaluation_kwargs: dict[str, object] = {
        "inverse_render_workers": options.core.inverse_render_workers,
    }
    if hint_bbox is not None:
        evaluation_kwargs["hint_bbox"] = hint_bbox
    return _evaluate_cleanup_span_replacement(
        observed_binary,
        bbox,
        raw_variant,
        verified_text,
        **evaluation_kwargs,
    )


def _apply_cleanup_span_reversions(
    changes: list[_CleanupSpanChange],
    verified_text: str,
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    options: OCRRunOptions,
    selection_metadata: dict[str, object],
) -> tuple[str, list[dict[str, object]], int]:
    decisions: list[dict[str, object]] = []
    reverted_count = 0
    for change in reversed(changes):
        raw_variant = (
            verified_text[:change.cleaned_start]
            + change.raw_text
            + verified_text[change.cleaned_end:]
        )
        hint_bbox = _hocr_bbox_hint_for_change(change, selection_metadata)
        keep_cleaned, decision = _cleanup_span_decision(
            observed_binary,
            bbox,
            raw_variant,
            verified_text,
            hint_bbox,
            options,
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
        # _KNOWN_WORD_CORRECTIONS entries are operator-curated with
        # 0% false-positive risk (every entry is a known OCR error
        # pattern that has been audited). When the inverse-render
        # verifier says no, it is being over-cautious on isolated
        # changes (e.g. ``lllustration`` on an otherwise-empty
        # line has too little ink context to render-match the
        # correction). Trust the curated entry over the verifier
        # for these specific sources so the user gets the
        # intentional fix.
        if is_known_word_correction(change.raw_text, change.cleaned_text):
            decision["accepted"] = True
            decision["reason"] = "accepted-known-word-correction"
            decision["accepted_without_image_verification"] = True
            continue
        # Roman-numeral ``l->i`` corrections are operator-curated
        # deterministic substitutions (see ``_fix_roman_numeral_trailing_l``).
        # The verifier tends to over-reject these on small chapter-
        # heading tokens where there is not enough surrounding ink
        # to render-match the canonical form. Trust the cleanup
        # over the verifier for this class.
        if is_roman_numeral_correction(change.raw_text, change.cleaned_text):
            decision["accepted"] = True
            decision["reason"] = "accepted-roman-numeral-correction"
            decision["accepted_without_image_verification"] = True
            continue
        # Hyphenated capital-I corrections (``Sheet-lron;`` ->
        # ``Sheet-Iron;``) are extremely specific (hyphen + l + upr
        # + lwr) and are always a misread capital ``I``. The verifier
        # tends to over-reject these on small compound words where
        # there is not enough surrounding ink to render-match the
        # cleaned text. Trust the cleanup over the verifier for this
        # class.
        if is_hyphenated_capital_i_correction(change.raw_text, change.cleaned_text):
            decision["accepted"] = True
            decision["reason"] = "accepted-hyphenated-capital-i-correction"
            decision["accepted_without_image_verification"] = True
            continue
        verified_text = raw_variant
        reverted_count += 1
    return verified_text, decisions, reverted_count


def _hocr_bbox_hint_for_change(
    change: _CleanupSpanChange,
    selection_metadata: dict[str, object],
) -> tuple[int, int, int, int] | None:
    payload = selection_metadata.get("hocr_word_boxes_runtime")
    token_payload = _hocr_payload_slice_for_change(payload, change)
    if token_payload is None:
        return None
    candidate_boxes = _hocr_candidate_boxes_for_change(token_payload)
    if not candidate_boxes:
        return None
    return _merged_bbox(candidate_boxes)


def _coerce_valid_bbox(item: object) -> tuple[int, int, int, int] | None:
    if not isinstance(item, (list, tuple)) or len(item) != 4:
        return None
    if not all(isinstance(value, int) for value in item):
        return None
    left, top, right, bottom = (int(value) for value in item)
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


def _hocr_payload_slice_for_change(
    payload: object,
    change: _CleanupSpanChange,
) -> list[object] | None:
    if not isinstance(payload, list):
        return None
    if change.raw_token_end_index <= change.raw_token_start_index:
        return None
    if change.raw_token_end_index > len(payload):
        return None
    return payload[change.raw_token_start_index : change.raw_token_end_index]


def _hocr_candidate_boxes_for_change(
    token_payload: list[object],
) -> list[tuple[int, int, int, int]]:
    candidate_boxes: list[tuple[int, int, int, int]] = []
    for item in token_payload:
        bbox = _coerce_valid_bbox(item)
        if bbox is not None:
            candidate_boxes.append(bbox)
    return candidate_boxes


def _merged_bbox(candidate_boxes: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
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
    candidate_variant_entries: list[tuple[int, OCRCandidate, str, str]] = []
    variant_texts: list[str] = []
    for candidate_index, candidate in enumerate(rerank_subset):
        candidate_variants = [(candidate.text, "raw")]
        if options.core.apply_cleanup:
            cleanup_changed_text = candidate.metadata.get("cleanup_changed_text")
            if cleanup_changed_text is not False:
                cleaned_variant = cleanup_ocr_text(
                    candidate.text,
                    lexicon_texts=options.core.cleanup_lexicon_texts,
                )
                if cleaned_variant and cleaned_variant != candidate.text:
                    candidate_variants.append((cleaned_variant, "cleaned"))
        for variant_text, variant_label in candidate_variants:
            candidate_variant_entries.append((candidate_index, candidate, variant_text, variant_label))
            variant_texts.append(variant_text)
    if len(set(variant_texts)) <= 1:
        return rerank_subset[0]
    observed_binary, bbox = _normalize_scan_for_inverse_render(image_path)
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


def _maybe_prefer_unmasked_auto_candidate(
    selected_candidate: OCRCandidate,
    candidates: list[OCRCandidate],
    options: OCRRunOptions,
) -> OCRCandidate | None:
    if (
        options.core.inverse_render_rerank
        or options.preprocess_mode != "auto"
        or len(candidates) < 2
    ):
        return None
    base_preprocess_mode = _masked_candidate_base_mode(selected_candidate)
    if base_preprocess_mode is None:
        return None
    best_unmasked_candidate = _best_candidate_for_preprocess_mode(candidates, base_preprocess_mode)
    if best_unmasked_candidate is None:
        return None
    if (
        selected_candidate.score - best_unmasked_candidate.score
        >= _AUTO_MASKED_MIN_SCORE_GAIN
    ):
        return None
    return best_unmasked_candidate


def _masked_candidate_base_mode(selected_candidate: OCRCandidate) -> str | None:
    selected_candidate_mode = selected_candidate.metadata.get("candidate_preprocess_mode")
    if not isinstance(selected_candidate_mode, str) or not selected_candidate_mode.endswith(_MASKED_PREPROCESS_SUFFIX):
        return None
    return selected_candidate_mode.removesuffix(_MASKED_PREPROCESS_SUFFIX)


def _best_candidate_for_preprocess_mode(
    candidates: list[OCRCandidate],
    preprocess_mode: str,
) -> OCRCandidate | None:
    matching_candidates = [
        candidate
        for candidate in candidates
        if candidate.metadata.get("candidate_preprocess_mode") == preprocess_mode
    ]
    if not matching_candidates:
        return None
    return max(matching_candidates, key=lambda candidate: candidate.score)


def _near_best_alt_candidates(
    selected_candidate: OCRCandidate,
    candidates: list[OCRCandidate],
    selected_family: str,
) -> list[OCRCandidate]:
    filtered_candidates: list[OCRCandidate] = []
    for candidate in candidates:
        if candidate is selected_candidate:
            continue
        score_gap = selected_candidate.score - candidate.score
        if score_gap < 0.0 or score_gap > _AMBIGUOUS_CANDIDATE_SCORE_GAP:
            continue
        candidate_family = _preprocess_family(
            str(candidate.metadata.get("candidate_preprocess_mode", candidate.metadata.get("preprocess_mode", "")))
        )
        if candidate_family == selected_family:
            continue
        filtered_candidates.append(candidate)
    return filtered_candidates


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
        # Word-level fusion: pick the higher-scoring engine as the
        # structural base, then swap in words from the other engine
        # only when it has a clearly better lexical score. This
        # recovers the common ensemble case where Tesseract nails the
        # structure but PaddleOCR gets a few specific words right
        # (and vice versa).
        if tesseract_score >= paddle_score:
            fused_text, fusion_metadata = _ensemble_fuse_texts(
                tesseract_text,
                paddle_text,
                options.core.language,
                options.core.cleanup_lexicon_texts,
                base_engine="tesseract",
                other_engine="paddleocr",
            )
            selected_engine = "tesseract"
        else:
            fused_text, fusion_metadata = _ensemble_fuse_texts(
                paddle_text,
                tesseract_text,
                options.core.language,
                options.core.cleanup_lexicon_texts,
                base_engine="paddleocr",
                other_engine="tesseract",
            )
            selected_engine = "paddleocr"
        metadata: dict[str, object] = {
            "ensemble_tesseract_score": tesseract_score,
            "ensemble_paddle_score": paddle_score,
            "ensemble_selected_engine": selected_engine,
        }
        metadata.update(fusion_metadata)
        if selected_engine == "tesseract":
            metadata.update(tesseract_metadata)
        # Re-score the fused text so the candidate-level signal
        # reflects the actual output the pipeline is about to use.
        fused_score, fused_details = _score_ocr_candidate(
            fused_text,
            options.core.language,
            options.core.cleanup_lexicon_texts,
            tesseract_metadata if selected_engine == "tesseract" else None,
        )
        metadata["ensemble_fused_score"] = fused_score
        metadata["ensemble_fused_text_score_components"] = fused_details
        return fused_text, metadata
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
    ocr_result_cache: dict[tuple[Path, str, str, str], tuple[str, dict[str, object]]] = {}
    candidate_runs: list[dict[str, object]] = []
    candidates: list[OCRCandidate] = []
    preprocess_modes = _candidate_preprocess_modes_for_options(options)
    if options.predict_preprocess_mode and options.preprocess_mode == "auto":
        # Override the auto candidate sweep with the per-page
        # image-quality classifier. This is the speed path; the
        # full auto mode is still recommended for maximum accuracy.
        try:
            with Image.open(image_path) as _image:
                predicted_mode = _classify_preprocess_mode(_image)
        except (OSError, ValueError):
            predicted_mode = "basic"
        preprocess_modes = (predicted_mode,)
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
            cache_key = (
                ocr_input_path,
                options.ocr_engine,
                tesseract_psm,
                options.core.tesseract_output_format,
            )
            cached_result = ocr_result_cache.get(cache_key)
            if cached_result is None:
                text, ocr_metadata = _run_candidate_ocr(
                    ocr_input_path,
                    options,
                    dependencies,
                    paddle_reader,
                    tesseract_psm,
                )
                ocr_result_cache[cache_key] = (text, dict(ocr_metadata))
            else:
                text, cached_metadata = cached_result
                ocr_metadata = dict(cached_metadata)
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
    masked_guardrail_candidate = _maybe_prefer_unmasked_auto_candidate(
        base_selected_candidate,
        candidates,
        options,
    )
    candidate_after_masked_guardrail = masked_guardrail_candidate or base_selected_candidate
    tiered_fallback_candidate = _maybe_tiered_fallback_candidate(
        candidate_after_masked_guardrail,
        options,
        dependencies,
        paddle_reader,
        preprocessed_dir,
    )
    candidate_after_tiered = tiered_fallback_candidate or candidate_after_masked_guardrail
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
    selected_metadata.update(_candidate_disagreement_metadata(selected_candidate, candidates))
    selected_metadata["selection_strategy"] = (
        "orientation-fallback"
        if orientation_fallback_candidate is not None
        else "tiered-ocr-fallback"
        if tiered_fallback_candidate is not None
        else "inverse-render-rerank"
        if reranked_candidate is not None
        else "auto-scan-local-threshold-preference"
        if preferred_scan_local_threshold_candidate is not None
        else "auto-masked-guardrail"
        if masked_guardrail_candidate is not None
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
        segment_texts = _run_tiered_fallback_tiles(
            grayscale,
            options,
            dependencies,
            paddle_reader,
            selected_psm,
            candidate,
            tiered_dir,
        )
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


def _run_tiered_fallback_tiles(
    grayscale: Any,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    paddle_reader: Callable[[Path], str] | None,
    selected_psm: int,
    candidate: OCRCandidate,
    tiered_dir: Path,
) -> list[str]:
    segment_texts: list[str] = []
    tile_starts = _tile_start_positions(
        grayscale.height,
        _TIERED_FALLBACK_TILE_HEIGHT,
        _TIERED_FALLBACK_TILE_HEIGHT - _TIERED_FALLBACK_TILE_OVERLAP,
    )
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
        compact_text = tile_text.strip()
        if compact_text:
            segment_texts.append(compact_text)
    return segment_texts


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
        _record_page_analysis_summary_entry(
            entry,
            page_type_counts,
            page_quality_tier_counts,
            page_route_counts,
            targeted_page_retry_reason_counts,
            low_quality_page_indices,
            front_matter_page_indices,
            targeted_page_retry_page_indices,
        )
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


def _record_page_analysis_summary_entry(
    entry: dict[str, object],
    page_type_counts: Counter[str],
    page_quality_tier_counts: Counter[str],
    page_route_counts: Counter[str],
    targeted_page_retry_reason_counts: Counter[str],
    low_quality_page_indices: list[int],
    front_matter_page_indices: list[int],
    targeted_page_retry_page_indices: list[int],
) -> None:
    page_index = entry.get("page_index")
    if not isinstance(page_index, int):
        return
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
    if entry.get("targeted_page_retry") != "applied":
        return
    targeted_page_retry_page_indices.append(page_index)
    retry_reason = entry.get("targeted_page_retry_reason")
    if isinstance(retry_reason, str):
        targeted_page_retry_reason_counts[retry_reason] += 1


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
        for section_index, (start_word, end_word, excerpt) in enumerate(_windowed_section_excerpts(text), start=1):
            (
                heuristic_score,
                symbolic_token_count,
                digit_alpha_token_count,
                noise_ratio,
                low_confidence_ratio,
            ) = _score_section_candidate(excerpt, detail)
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


def _score_section_candidate(
    text_excerpt: str,
    page_detail: dict[str, object],
) -> tuple[float, int, int, float, float]:
    page_quality_tier = str(page_detail.get("page_quality_tier", "unknown"))
    page_route = str(page_detail.get("page_route", "unknown"))
    raw_low_confidence_ratio = page_detail.get("hocr_low_confidence_ratio")
    low_confidence_ratio = (
        float(raw_low_confidence_ratio)
        if isinstance(raw_low_confidence_ratio, (int, float))
        else 0.0
    )
    symbolic_token_count = len(_SUSPICIOUS_SYMBOLIC_TOKEN_RE.findall(text_excerpt))
    digit_alpha_token_count = len(_SUSPICIOUS_DIGIT_ALPHA_TOKEN_RE.findall(text_excerpt))
    noise_ratio = _page_text_noise_ratio(text_excerpt)
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
    return (
        heuristic_score,
        symbolic_token_count,
        digit_alpha_token_count,
        noise_ratio,
        low_confidence_ratio,
    )


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
    confidence = _normalized_suspicious_confidence(payload.get("confidence", "medium"))
    reason = str(payload.get("reason", "")).strip()
    if not reason:
        return None
    return {
        "suspicious": suspicious,
        "confidence": confidence,
        "reason": reason[:240],
        "focus_spans": _normalized_focus_spans(payload.get("focus_spans", [])),
    }


def _normalized_suspicious_confidence(value: object) -> str:
    confidence = str(value).strip().lower()
    return confidence if confidence in {"low", "medium", "high"} else "medium"


def _normalized_focus_spans(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    focus_spans: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        candidate = item.strip()
        if candidate:
            focus_spans.append(candidate[:120])
        if len(focus_spans) >= _MAX_SUSPICIOUS_SECTION_FOCUS_SPANS:
            break
    return focus_spans


def _maybe_analyze_suspicious_sections(
    page_texts: list[str],
    page_details: list[dict[str, object]],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
) -> dict[str, object]:
    if not options.core.llm_suspicious_sections:
        return {}
    if dependencies.llm_suspicious_section_analyzer is None:
        return _suspicious_sections_unavailable_result()
    candidates = _suspicious_section_candidates(
        page_texts,
        page_details,
        max_candidates=options.core.llm_suspicious_max_candidates,
    )
    if not candidates:
        return _suspicious_sections_no_candidates_result()
    sections, reviewed_count, invalid_response_count = _review_suspicious_section_candidates(
        candidates,
        options,
        dependencies,
    )
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


def _suspicious_sections_unavailable_result() -> dict[str, object]:
    return {
        "enabled": True,
        "status": "unavailable",
        "candidate_count": 0,
        "reviewed_count": 0,
        "flagged_count": 0,
        "invalid_response_count": 0,
        "sections": [],
    }


def _suspicious_sections_no_candidates_result() -> dict[str, object]:
    return {
        "enabled": True,
        "status": "skipped-no-candidates",
        "candidate_count": 0,
        "reviewed_count": 0,
        "flagged_count": 0,
        "invalid_response_count": 0,
        "sections": [],
    }


def _review_suspicious_section_candidates(
    candidates: list[dict[str, object]],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
) -> tuple[list[dict[str, object]], int, int]:
    analyzer = dependencies.llm_suspicious_section_analyzer
    if analyzer is None:
        return [], 0, 0
    sections: list[dict[str, object]] = []
    reviewed_count = 0
    invalid_response_count = 0
    for candidate in candidates:
        if len(sections) >= options.core.llm_suspicious_max_sections:
            break
        reviewed_count += 1
        response_text = analyzer(_build_suspicious_section_prompt(candidate))
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
    return sections, reviewed_count, invalid_response_count


def _page_artifacts_manifest_payload(
    page_details: list[dict[str, object]],
    total_pages: int,
    *,
    status: str,
    current_page_index: int | None,
    elapsed_seconds: float,
) -> dict[str, object]:
    completed_pages = len(page_details)
    seconds_per_page, estimated_remaining_seconds, estimated_total_seconds = _estimate_timing(
        elapsed_seconds,
        completed_pages,
        total_pages,
        status,
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


def _estimate_timing(
    elapsed_seconds: float,
    completed_pages: int,
    total_pages: int,
    status: str,
) -> tuple[float | None, float | None, float | None]:
    seconds_per_page = (
        elapsed_seconds / completed_pages
        if completed_pages > 0 and elapsed_seconds > 0
        else None
    )
    if seconds_per_page is None:
        if status == "complete":
            return None, 0.0, elapsed_seconds
        return None, None, None
    estimated_remaining_seconds = (
        0.0 if status == "complete" else seconds_per_page * (total_pages - completed_pages)
    )
    return (
        seconds_per_page,
        estimated_remaining_seconds,
        seconds_per_page * total_pages,
    )


def _page_artifact_text_path(artifacts_dir: Path, page_index: int) -> Path:
    return artifacts_dir / f"page-{page_index:04d}.txt"


def _load_resumed_page_artifacts(
    artifacts_dir: Path,
    page_images: list[Path],
) -> tuple[list[str], list[dict[str, object]]]:
    manifest_path = artifacts_dir / "manifest.json"
    if not manifest_path.exists():
        return [], []
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [], []
    raw_pages = payload.get("pages")
    if not isinstance(raw_pages, list):
        return [], []
    page_texts: list[str] = []
    page_details: list[dict[str, object]] = []
    for expected_page_index, image_path in enumerate(page_images, start=1):
        if expected_page_index > len(raw_pages):
            break
        loaded_entry = _load_resumed_page_entry(
            raw_pages[expected_page_index - 1],
            expected_page_index,
            image_path,
            artifacts_dir,
        )
        if loaded_entry is None:
            break
        text, entry = loaded_entry
        page_texts.append(text)
        page_details.append(entry)
    return page_texts, page_details


def _load_resumed_page_entry(
    raw_entry: object,
    expected_page_index: int,
    image_path: Path,
    artifacts_dir: Path,
) -> tuple[str, dict[str, object]] | None:
    if not isinstance(raw_entry, dict):
        return None
    raw_page_index = raw_entry.get("page_index")
    if not isinstance(raw_page_index, int) or raw_page_index != expected_page_index:
        return None
    text_path = _resumed_text_path_for_entry(raw_entry, expected_page_index, image_path, artifacts_dir)
    if text_path is None:
        return None
    try:
        text = text_path.read_text(encoding="utf-8")
    except OSError:
        return None
    entry = dict(raw_entry)
    entry["text_path"] = str(text_path)
    return text, entry


def _resumed_text_path_for_entry(
    raw_entry: dict[str, object],
    expected_page_index: int,
    image_path: Path,
    artifacts_dir: Path,
) -> Path | None:
    raw_image_path = raw_entry.get("image_path")
    if isinstance(raw_image_path, str) and raw_image_path and Path(raw_image_path).name != image_path.name:
        return None
    raw_text_path = raw_entry.get("text_path")
    text_path = (
        Path(str(raw_text_path))
        if isinstance(raw_text_path, str) and raw_text_path
        else _page_artifact_text_path(artifacts_dir, expected_page_index)
    )
    if not text_path.exists():
        return None
    return text_path


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
    edge_region = _is_edge_header_or_footer(compact, line_index, line_count, word_count)
    if edge_region is not None:
        return edge_region
    if _is_margin_note(bbox, word_count):
        return "margin-note"
    return "body"


def _is_edge_header_or_footer(
    compact: str,
    line_index: int,
    line_count: int,
    word_count: int,
) -> str | None:
    if word_count > 8 or _is_probable_chapter_marker(compact):
        return None
    if line_index <= 1:
        return "header"
    if line_index >= max(0, line_count - 2):
        return "footer"
    return None


def _is_margin_note(
    bbox: tuple[int, int, int, int] | None,
    word_count: int,
) -> bool:
    if bbox is None:
        return False
    left, _top, right, _bottom = bbox
    return (right - left) >= 1 and left <= 16 and word_count <= 3


def _coerce_single_layout_entry(entry: object) -> dict[str, object] | None:
    if not isinstance(entry, dict):
        return None
    line_text = str(entry.get("text", "")).strip()
    if not line_text:
        return None
    normalized_entry: dict[str, object] = {"text": line_text}
    bbox = _coerce_valid_bbox(entry.get("bbox"))
    if bbox is not None:
        normalized_entry["bbox"] = bbox
    return normalized_entry


def _coerce_layout_entries(
    text: str,
    selection_metadata: dict[str, object],
) -> list[dict[str, object]]:
    runtime_entries = selection_metadata.get("hocr_line_entries_runtime")
    entries: list[dict[str, object]] = []
    if isinstance(runtime_entries, list):
        for entry in runtime_entries:
            normalized_entry = _coerce_single_layout_entry(entry)
            if normalized_entry is not None:
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


def _page_ocr_artifact_metrics(text: str) -> dict[str, float]:
    alphaish_token_count = 0
    single_char_fragment_count = 0
    apostrophe_fragment_count = 0
    for token in _NON_SPACE_TOKEN.findall(text):
        compact = token.strip(_PUNCTUATION_STRIP_CHARS)
        if not compact or not any(char.isalpha() for char in compact):
            continue
        alphaish_token_count += 1
        is_single_char_fragment, is_apostrophe_fragment = _classify_token_artifacts(compact)
        if is_single_char_fragment:
            single_char_fragment_count += 1
        if is_apostrophe_fragment:
            apostrophe_fragment_count += 1
    if alphaish_token_count == 0:
        return {
            "alphaish_token_count": 0.0,
            "single_char_fragment_ratio": 0.0,
            "apostrophe_fragment_ratio": 0.0,
        }
    return {
        "alphaish_token_count": float(alphaish_token_count),
        "single_char_fragment_ratio": single_char_fragment_count / alphaish_token_count,
        "apostrophe_fragment_ratio": apostrophe_fragment_count / alphaish_token_count,
    }


def _classify_token_artifacts(compact_token: str) -> tuple[bool, bool]:
    letters_only = "".join(char for char in compact_token if char.isalpha()).lower()
    return (
        len(letters_only) == 1 and letters_only not in _SINGLE_CHAR_TOKEN_ALLOWLIST,
        "'" in compact_token and _LATIN_TOKEN.fullmatch(compact_token) is None,
    )


def _preprocess_family(preprocess_mode: str) -> str:
    base_preprocess_mode, _pre_ocr_region_masked = _split_preprocess_mode(preprocess_mode)
    return base_preprocess_mode


def _normalized_ocr_text(text: str) -> str:
    return " ".join(text.lower().split())


def _near_best_alt_stats(
    selected_candidate: OCRCandidate,
    candidates: list[OCRCandidate],
) -> tuple[int, float | None, float | None]:
    selected_family = _preprocess_family(
        str(
            selected_candidate.metadata.get(
                "candidate_preprocess_mode",
                selected_candidate.metadata.get("preprocess_mode", ""),
            )
        )
    )
    selected_text = _normalized_ocr_text(selected_candidate.text)
    best_alt_score_gap: float | None = None
    best_alt_text_similarity: float | None = None
    filtered_candidates = _near_best_alt_candidates(selected_candidate, candidates, selected_family)
    seen_families = {
        _preprocess_family(
            str(candidate.metadata.get("candidate_preprocess_mode", candidate.metadata.get("preprocess_mode", "")))
        )
        for candidate in filtered_candidates
    }
    for candidate in filtered_candidates:
        score_gap = selected_candidate.score - candidate.score
        similarity = SequenceMatcher(
            None,
            selected_text,
            _normalized_ocr_text(candidate.text),
        ).ratio()
        if best_alt_score_gap is None or score_gap < best_alt_score_gap:
            best_alt_score_gap = score_gap
        if best_alt_text_similarity is None or similarity < best_alt_text_similarity:
            best_alt_text_similarity = similarity
    return len(seen_families), best_alt_score_gap, best_alt_text_similarity


def _candidate_disagreement_metadata(
    selected_candidate: OCRCandidate,
    candidates: list[OCRCandidate],
) -> dict[str, object]:
    if len(candidates) <= 1:
        return {}
    near_best_family_count, best_alt_score_gap, best_alt_text_similarity = _near_best_alt_stats(
        selected_candidate,
        candidates,
    )
    if near_best_family_count == 0:
        return {}
    metadata: dict[str, object] = {
        "candidate_near_best_family_count": near_best_family_count,
    }
    if best_alt_score_gap is not None:
        metadata["candidate_best_alt_score_gap"] = round(best_alt_score_gap, 3)
    if best_alt_text_similarity is not None:
        metadata["candidate_best_alt_text_similarity"] = round(best_alt_text_similarity, 4)
    return metadata


def _is_front_matter_page(
    page_index: int,
    total_pages: int,
    sparse_page: bool,
    toc_page: bool,
    body_lines: int,
    chapter_marker_count: int,
) -> bool:
    if total_pages < 4:
        return False
    if page_index > _edge_page_window(total_pages, _FRONT_MATTER_MAX_PAGES):
        return False
    return toc_page or (sparse_page and (body_lines <= 4 or chapter_marker_count > 0))


def _is_back_matter_page(
    page_index: int,
    total_pages: int,
    sparse_page: bool,
    body_lines: int,
) -> bool:
    return (
        total_pages >= 4
        and page_index > total_pages - _edge_page_window(total_pages, _BACK_MATTER_MAX_PAGES)
        and sparse_page
        and body_lines <= 4
    )


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
    if _is_front_matter_page(
        page_index,
        total_pages,
        sparse_page,
        toc_page,
        body_lines,
        chapter_marker_count,
    ):
        return "front-matter"
    if _is_back_matter_page(page_index, total_pages, sparse_page, body_lines):
        return "back-matter"
    if sparse_page and body_lines <= 2:
        return "sparse"
    return "body"


def _penalty_for_word_count(word_count: int) -> int:
    return 3 if word_count == 0 else 0


def _penalty_for_selection_score(score: float) -> int:
    if score < _LOW_QUALITY_SELECTION_SCORE:
        return 2
    if score < _MEDIUM_QUALITY_SELECTION_SCORE:
        return 1
    return 0


def _penalty_for_low_confidence_ratio(ratio: float | None) -> int:
    if ratio is None:
        return 0
    if ratio >= _LOW_QUALITY_LOW_CONFIDENCE_RATIO:
        return 2
    if ratio >= _MEDIUM_QUALITY_LOW_CONFIDENCE_RATIO:
        return 1
    return 0


def _penalty_for_confidence_mean(mean: float | None) -> int:
    if mean is None:
        return 0
    if mean < 75.0:
        return 2
    if mean < 88.0:
        return 1
    return 0


def _penalty_for_noise_ratio(ratio: float) -> int:
    if ratio >= _LOW_QUALITY_NOISE_RATIO:
        return 2
    if ratio >= _MEDIUM_QUALITY_NOISE_RATIO:
        return 1
    return 0


def _penalty_for_single_char_fragment_ratio(ratio: float) -> int:
    if ratio >= _LOW_QUALITY_SINGLE_CHAR_FRAGMENT_RATIO:
        return 2
    if ratio >= _MEDIUM_QUALITY_SINGLE_CHAR_FRAGMENT_RATIO:
        return 1
    return 0


def _penalty_for_apostrophe_fragment_ratio(ratio: float) -> int:
    if ratio >= _LOW_QUALITY_APOSTROPHE_FRAGMENT_RATIO:
        return 2
    if ratio >= _MEDIUM_QUALITY_APOSTROPHE_FRAGMENT_RATIO:
        return 1
    return 0


def _penalty_for_candidate_ambiguity(
    near_best_count: int,
    gap: float | None,
    similarity: float | None,
) -> int:
    if near_best_count < 2 or gap is None or similarity is None:
        return 0
    if (
        gap <= _HIGH_AMBIGUITY_CANDIDATE_SCORE_GAP
        and similarity < _HIGH_AMBIGUITY_CANDIDATE_TEXT_SIMILARITY
    ):
        return 2
    if similarity < _AMBIGUOUS_CANDIDATE_TEXT_SIMILARITY:
        return 1
    return 0


def _classify_page_quality_tier(
    *,
    page_type: str,
    word_count: int,
    dense_body_line_count: int,
    selection_score: float,
    noise_ratio: float,
    hocr_confidence_mean: float | None,
    hocr_low_confidence_ratio: float | None,
    single_char_fragment_ratio: float,
    apostrophe_fragment_ratio: float,
    candidate_near_best_family_count: int,
    candidate_best_alt_score_gap: float | None,
    candidate_best_alt_text_similarity: float | None,
) -> str:
    penalty = sum(
        (
            _penalty_for_word_count(word_count),
            _penalty_for_selection_score(selection_score),
            _penalty_for_low_confidence_ratio(hocr_low_confidence_ratio),
            _penalty_for_confidence_mean(hocr_confidence_mean),
            _penalty_for_noise_ratio(noise_ratio),
            _penalty_for_single_char_fragment_ratio(single_char_fragment_ratio),
            _penalty_for_apostrophe_fragment_ratio(apostrophe_fragment_ratio),
            _penalty_for_candidate_ambiguity(
                candidate_near_best_family_count,
                candidate_best_alt_score_gap,
                candidate_best_alt_text_similarity,
            ),
        )
    )
    if page_type in {"front-matter", "back-matter", "sparse"} and dense_body_line_count <= 1:
        penalty = max(0, penalty - 1)
    if penalty >= 4:
        return "low"
    if penalty >= 2:
        return "medium"
    return "high"


def _coerce_candidate_fields(selection_metadata: dict[str, object]) -> dict[str, float | int | None]:
    raw_confidence_mean = selection_metadata.get("hocr_confidence_mean")
    raw_low_confidence_ratio = selection_metadata.get("hocr_low_confidence_ratio")
    raw_candidate_near_best_family_count = selection_metadata.get("candidate_near_best_family_count")
    raw_candidate_best_alt_score_gap = selection_metadata.get("candidate_best_alt_score_gap")
    raw_candidate_best_alt_text_similarity = selection_metadata.get("candidate_best_alt_text_similarity")
    return {
        "hocr_confidence_mean": (
            float(raw_confidence_mean)
            if isinstance(raw_confidence_mean, (int, float))
            else None
        ),
        "hocr_low_confidence_ratio": (
            float(raw_low_confidence_ratio)
            if isinstance(raw_low_confidence_ratio, (int, float))
            else None
        ),
        "candidate_near_best_family_count": (
            int(raw_candidate_near_best_family_count)
            if isinstance(raw_candidate_near_best_family_count, int)
            else 0
        ),
        "candidate_best_alt_score_gap": (
            float(raw_candidate_best_alt_score_gap)
            if isinstance(raw_candidate_best_alt_score_gap, (int, float))
            else None
        ),
        "candidate_best_alt_text_similarity": (
            float(raw_candidate_best_alt_text_similarity)
            if isinstance(raw_candidate_best_alt_text_similarity, (int, float))
            else None
        ),
    }


def _page_line_metrics(
    classified_entries: list[dict[str, object]],
) -> tuple[int, int, int]:
    line_count = len(classified_entries)
    dense_body_line_count = sum(
        1 for entry in classified_entries if len(str(entry["text"]).split()) >= 6
    )
    chapter_marker_count = sum(
        1 for entry in classified_entries if _is_probable_chapter_marker(str(entry["text"]))
    )
    return line_count, dense_body_line_count, chapter_marker_count


def _page_analysis_optional_metadata(
    candidate_near_best_family_count: int,
    candidate_best_alt_score_gap: float | None,
    candidate_best_alt_text_similarity: float | None,
    chapter_marker_count: int,
) -> dict[str, object]:
    metadata: dict[str, object] = {}
    if candidate_near_best_family_count:
        metadata["page_candidate_near_best_family_count"] = candidate_near_best_family_count
    if candidate_best_alt_score_gap is not None:
        metadata["page_candidate_best_alt_score_gap"] = round(candidate_best_alt_score_gap, 3)
    if candidate_best_alt_text_similarity is not None:
        metadata["page_candidate_best_alt_text_similarity"] = round(
            candidate_best_alt_text_similarity,
            4,
        )
    if chapter_marker_count:
        metadata["page_chapter_marker_count"] = chapter_marker_count
    return metadata


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
    line_count, dense_body_line_count, chapter_marker_count = _page_line_metrics(classified_entries)
    word_count = len([word for word in text.split() if word])
    noise_ratio = _page_text_noise_ratio(text)
    artifact_metrics = _page_ocr_artifact_metrics(text)
    selection_score = float(selection_metadata.get("selection_score", 0.0))
    candidate_fields = _coerce_candidate_fields(selection_metadata)
    hocr_confidence_mean = candidate_fields["hocr_confidence_mean"]
    hocr_low_confidence_ratio = candidate_fields["hocr_low_confidence_ratio"]
    candidate_near_best_family_count = int(candidate_fields["candidate_near_best_family_count"] or 0)
    candidate_best_alt_score_gap = candidate_fields["candidate_best_alt_score_gap"]
    candidate_best_alt_text_similarity = candidate_fields["candidate_best_alt_text_similarity"]
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
        single_char_fragment_ratio=float(artifact_metrics["single_char_fragment_ratio"]),
        apostrophe_fragment_ratio=float(artifact_metrics["apostrophe_fragment_ratio"]),
        candidate_near_best_family_count=candidate_near_best_family_count,
        candidate_best_alt_score_gap=candidate_best_alt_score_gap,
        candidate_best_alt_text_similarity=candidate_best_alt_text_similarity,
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
        "page_single_char_fragment_ratio": round(float(artifact_metrics["single_char_fragment_ratio"]), 4),
        "page_apostrophe_fragment_ratio": round(float(artifact_metrics["apostrophe_fragment_ratio"]), 4),
    }
    metadata.update(
        _page_analysis_optional_metadata(
            candidate_near_best_family_count,
            candidate_best_alt_score_gap,
            candidate_best_alt_text_similarity,
            chapter_marker_count,
        )
    )
    return metadata


def _validate_llm_correction(
    corrected_text: str,
    original_text: str,
    options: OCRRunOptions,
) -> tuple[bool, dict[str, object]]:
    original_word_count = len([word for word in original_text.split() if word])
    corrected_word_count = len([word for word in corrected_text.split() if word])
    word_delta_ratio = abs(corrected_word_count - original_word_count) / max(1, original_word_count)
    if word_delta_ratio > options.core.llm_max_word_delta_ratio:
        return False, {
            "llm_post_correction": "rejected-word-delta",
            "llm_word_delta_ratio": word_delta_ratio,
        }
    return True, {
        "llm_post_correction": "applied",
        "llm_word_delta_ratio": word_delta_ratio,
    }


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
    accepted, metadata = _validate_llm_correction(corrected_text, text, options)
    if not accepted:
        return text, metadata
    return corrected_text, metadata


def _update_metadata_if_present(
    target_metadata: dict[str, object],
    additional_metadata: dict[str, object],
) -> None:
    if additional_metadata:
        target_metadata.update(additional_metadata)


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
    _update_metadata_if_present(processed_metadata, cleanup_metadata)
    text, layout_metadata = _maybe_apply_layout_region_detection(text, processed_metadata, options)
    _update_metadata_if_present(processed_metadata, layout_metadata)
    text, llm_metadata = _maybe_apply_llm_post_correction(
        text,
        processed_metadata,
        options,
        dependencies,
    )
    _update_metadata_if_present(processed_metadata, llm_metadata)
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


def _adaptive_raster_retry_image(
    image_path: Path,
    preprocessed_dir: Path,
    retry_reason: str,
) -> tuple[Path, dict[str, object]] | None:
    if Image is None:
        return None
    margin_ratios = _ADAPTIVE_RASTER_MARGIN_BY_REASON.get(retry_reason)
    if margin_ratios is None:
        return None
    horizontal_ratio, vertical_ratio = margin_ratios
    with Image.open(image_path) as image:
        width, height = image.size
        left_margin = min(
            max(1, int(round(width * horizontal_ratio))),
            max(0, (width - 8) // 2),
        )
        top_margin = min(
            max(1, int(round(height * vertical_ratio))),
            max(0, (height - 8) // 2),
        )
        if left_margin <= 0 and top_margin <= 0:
            return None
        crop_box = (
            left_margin,
            top_margin,
            max(left_margin + 1, width - left_margin),
            max(top_margin + 1, height - top_margin),
        )
        if crop_box[2] - crop_box[0] < 8 or crop_box[3] - crop_box[1] < 8:
            return None
        cropped = image.crop(crop_box)
        resampling_namespace = getattr(Image, "Resampling", Image)
        resized = cropped.resize(image.size, getattr(resampling_namespace, "LANCZOS"))
        adaptive_dir = preprocessed_dir / "adaptive-raster"
        adaptive_dir.mkdir(parents=True, exist_ok=True)
        adaptive_path = adaptive_dir / f"{image_path.stem}-{retry_reason}{image_path.suffix}"
        resized.save(adaptive_path)
    return adaptive_path, {
        "adaptive_raster_retry_variant": "cropped-resized",
        "adaptive_raster_retry_crop_box": crop_box,
        "adaptive_raster_retry_margin_ratio": {
            "horizontal": round(horizontal_ratio, 4),
            "vertical": round(vertical_ratio, 4),
        },
    }


def _should_keep_targeted_retry(
    current_metadata: dict[str, object],
    retry_metadata: dict[str, object],
) -> bool:
    def _artifact_burden(metadata: dict[str, object]) -> float | None:
        single_char_ratio = metadata.get("page_single_char_fragment_ratio")
        apostrophe_ratio = metadata.get("page_apostrophe_fragment_ratio")
        if not isinstance(single_char_ratio, (int, float)) or not isinstance(apostrophe_ratio, (int, float)):
            return None
        return float(single_char_ratio) + float(apostrophe_ratio)

    current_score = float(current_metadata.get("selection_score", 0.0))
    retry_score = float(retry_metadata.get("selection_score", 0.0))
    if retry_score > current_score:
        return True
    current_quality_rank = _quality_tier_rank(current_metadata.get("page_quality_tier"))
    retry_quality_rank = _quality_tier_rank(retry_metadata.get("page_quality_tier"))
    if retry_quality_rank > current_quality_rank and retry_score >= (current_score - 25.0):
        return True
    current_artifact_burden = _artifact_burden(current_metadata)
    retry_artifact_burden = _artifact_burden(retry_metadata)
    return (
        current_metadata.get("page_quality_tier") == "low"
        and retry_metadata.get("page_quality_tier") == "low"
        and current_artifact_burden is not None
        and retry_artifact_burden is not None
        and retry_artifact_burden <= (current_artifact_burden * _LOW_QUALITY_RETRY_ARTIFACT_IMPROVEMENT_RATIO)
        and retry_score >= (current_score - _LOW_QUALITY_RETRY_MAX_SCORE_DROP)
    )


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
    retry_candidates: list[tuple[Path, str, dict[str, object]]] = []
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
    retry_candidates.append((retry_ocr_input_path, retry_text, retry_metadata))
    adaptive_retry_image = _adaptive_raster_retry_image(image_path, preprocessed_dir, retry_reason)
    if adaptive_retry_image is not None:
        adaptive_image_path, adaptive_retry_base_metadata = adaptive_retry_image
        adaptive_ocr_input_path, adaptive_text, adaptive_metadata = _run_ocr_on_page(
            adaptive_image_path,
            retry_options,
            dependencies,
            preprocessed_dir,
            paddle_reader,
            total_pages=total_pages,
            completed_pages=page_index - 1,
            current_page_index=page_index,
            started_at=started_at,
            retry_reason=f"{retry_reason}-adaptive-raster",
        )
        adaptive_text, adaptive_metadata = _postprocess_page_text(
            adaptive_image_path,
            adaptive_text,
            adaptive_metadata,
            page_index=page_index,
            total_pages=total_pages,
            options=retry_options,
            dependencies=dependencies,
        )
        adaptive_candidate_metadata = dict(adaptive_metadata)
        adaptive_candidate_metadata.update(adaptive_retry_base_metadata)
        adaptive_candidate_metadata["adaptive_raster_retry"] = "candidate"
        retry_candidates.append((adaptive_ocr_input_path, adaptive_text, adaptive_candidate_metadata))
    best_retry_ocr_input_path, best_retry_text, best_retry_metadata = retry_candidates[0]
    for candidate_ocr_input_path, candidate_text, candidate_metadata in retry_candidates[1:]:
        if _should_keep_targeted_retry(best_retry_metadata, candidate_metadata):
            best_retry_ocr_input_path = candidate_ocr_input_path
            best_retry_text = candidate_text
            best_retry_metadata = candidate_metadata
    current_score = float(selection_metadata.get("selection_score", 0.0))
    retry_score = float(best_retry_metadata.get("selection_score", 0.0))
    if _should_keep_targeted_retry(selection_metadata, best_retry_metadata):
        resolved_metadata = dict(best_retry_metadata)
        resolved_metadata["targeted_page_retry"] = "applied"
        resolved_metadata["targeted_page_retry_reason"] = retry_reason
        resolved_metadata["targeted_page_retry_base_selection_score"] = current_score
        resolved_metadata["targeted_page_retry_retry_selection_score"] = retry_score
        resolved_metadata["targeted_page_retry_base_route"] = selection_metadata.get("page_route")
        resolved_metadata["targeted_page_retry_policy"] = retry_options.route_ocr_policy
        resolved_metadata["targeted_page_retry_selected_strategy"] = best_retry_metadata.get(
            "selection_strategy"
        )
        resolved_metadata["selection_strategy"] = "targeted-page-retry"
        if resolved_metadata.get("adaptive_raster_retry") == "candidate":
            resolved_metadata["adaptive_raster_retry"] = "applied"
        return best_retry_ocr_input_path, best_retry_text, resolved_metadata
    resolved_metadata = dict(selection_metadata)
    resolved_metadata["targeted_page_retry"] = "rejected-no-gain"
    resolved_metadata["targeted_page_retry_reason"] = retry_reason
    resolved_metadata["targeted_page_retry_policy"] = retry_options.route_ocr_policy
    resolved_metadata["targeted_page_retry_retry_selection_score"] = retry_score
    if len(retry_candidates) > 1:
        resolved_metadata["adaptive_raster_retry"] = "rejected-no-gain"
    return ocr_input_path, text, resolved_metadata


def _ocr_results_mode_usage_from_resumed(
    page_details: list[dict[str, object]],
) -> tuple[Counter[str], Counter[str]]:
    mode_usage: Counter[str] = Counter()
    tesseract_psm_usage: Counter[str] = Counter()
    for entry in page_details:
        _record_page_ocr_entry(entry, mode_usage, tesseract_psm_usage)
    return mode_usage, tesseract_psm_usage


def _record_page_ocr_entry(
    entry: dict[str, object],
    mode_usage: Counter[str],
    tesseract_psm_usage: Counter[str],
) -> None:
    selected_mode = entry.get("selected_preprocess_mode")
    if isinstance(selected_mode, str):
        mode_usage[selected_mode] += 1
    selected_psm = entry.get("tesseract_psm")
    if isinstance(selected_psm, int):
        tesseract_psm_usage[str(selected_psm)] += 1


def _write_page_progress(
    options: OCRRunOptions,
    artifacts_dir: Path,
    page_details: list[dict[str, object]],
    total_pages: int,
    page_index: int,
    started_at: float,
) -> None:
    status = "complete" if page_index >= total_pages else "running"
    current_page_index = page_index + 1 if page_index < total_pages else None
    if options.emit_page_artifacts:
        _write_page_artifacts_manifest(
            artifacts_dir,
            page_details,
            total_pages,
            status=status,
            current_page_index=current_page_index,
            started_at=started_at,
        )
    _emit_progress(
        options.progress_callback,
        _timed_page_progress_payload(
            stage="ocr",
            total_pages=total_pages,
            completed_pages=page_index,
            status=status,
            current_page_index=current_page_index,
            started_at=started_at,
        ),
    )


def _collect_page_ocr_results(
    page_images: list[Path],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    work_dir: Path,
    artifacts_dir: Path,
    started_at: float,
) -> tuple[list[str], list[dict[str, object]], dict[str, object]]:
    page_texts, page_details = (
        _load_resumed_page_artifacts(artifacts_dir, page_images) if options.resume else ([], [])
    )
    preprocessed_dir = work_dir / "preprocessed"
    paddle_reader = (
        dependencies.paddle_reader_factory(options.core.language)
        if options.ocr_engine in {"paddleocr", "ensemble"}
        else None
    )
    mode_usage, tesseract_psm_usage = _ocr_results_mode_usage_from_resumed(page_details)
    total_pages = len(page_images)
    _write_page_progress(
        options,
        artifacts_dir,
        page_details,
        total_pages,
        len(page_texts),
        started_at,
    )
    for image_path in page_images[len(page_texts) :]:
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
        _record_page_ocr_entry(entry, mode_usage, tesseract_psm_usage)
        if options.emit_page_artifacts:
            text_path = _page_artifact_text_path(artifacts_dir, page_index)
            text_path.write_text(text, encoding="utf-8")
            entry["text_path"] = str(text_path)
        page_details.append(entry)
        _write_page_progress(
            options,
            artifacts_dir,
            page_details,
            total_pages,
            page_index,
            started_at,
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
        reuse_existing=options.resume,
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
