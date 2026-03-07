"""Local OCR pipeline and mode-evaluation helpers."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import importlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Callable

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError:
    Image = None
    ImageDraw = None
    ImageFilter = None
    ImageFont = None
    ImageOps = None

from . import benchmark as benchmark_module
from .ocr_cleanup import cleanup_ocr_text

_VALID_PREPROCESS_MODES = (
    "none",
    "scan",
    "scan-local-threshold",
    "basic",
    "deskew",
    "dewarp",
    "auto",
)
_AUTO_PREPROCESS_MODES = ("none", "scan", "basic", "deskew", "dewarp")
_MODE_EVAL_PREPROCESS_MODES = ("none", "scan", "scan-local-threshold", "basic", "deskew", "dewarp")
_AUTO_TESSERACT_PSMS = ("3", "4", "6")
_DEFAULT_RENDER_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
)
_INVERSE_RENDER_SIZE_ADJUSTMENTS = (-2, 0, 2)
_INVERSE_RENDER_ROTATIONS = (-0.5, 0.0, 0.5)
_INVERSE_RENDER_OFFSETS = (-4, 0, 4)
_LATIN_TOKEN = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_NON_TEXT_CHAR = re.compile(r"[^A-Za-z0-9\s\.,;:!\?'\-\"()\[\]]")
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
    deskew_max_angle: float = 3.0
    deskew_angle_step: float = 0.5
    tesseract_psm: str = "auto"
    cleanup_lexicon_texts: tuple[str, ...] = ()
    inverse_render_rerank: bool = False
    inverse_render_top_k: int = 3


@dataclass(frozen=True)
class OCRRunOptions:
    """Config for a single OCR execution."""

    core: OCRCoreOptions
    preprocess_mode: str = "basic"
    ocr_engine: str = "tesseract"
    emit_page_artifacts: bool = True
    page_artifacts_dir: Path | None = None


@dataclass(frozen=True)
class OCRDependencies:
    """Injectable dependencies for OCR execution and testing."""

    run_command: Callable[[list[str], bool], str]
    preprocess_image: Callable[[Path, Path, str, int, float, float], None]
    paddle_reader_factory: Callable[[str], Callable[[Path], str]]
    which: Callable[[str], str | None]


@dataclass(frozen=True)
class OCRCandidate:
    """One OCR candidate and its selection metadata."""

    score: float
    ocr_input_path: Path
    text: str
    metadata: dict[str, object]


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
    if Image is None or ImageFilter is None or ImageOps is None:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        )
    with Image.open(input_path) as image:
        gray = image.convert("L")
        if _uses_scan_preprocess_stack(preprocess_mode):
            contrasted = ImageOps.autocontrast(gray)
            denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
            ocr_ready = _upsample_for_ocr(denoised, scale_factor=3)
        else:
            contrasted = ImageOps.autocontrast(gray)
            denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
            ocr_ready = _upsample_for_ocr(denoised)
        candidate = _preprocess_candidate(
            ocr_ready,
            preprocess_mode,
            deskew_max_angle,
            deskew_angle_step,
            binarize_threshold,
        )
        binarized = _binarize_preprocessed_candidate(candidate, preprocess_mode, binarize_threshold)
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


def _upsample_for_ocr(image: Any, scale_factor: int = 2) -> Any:
    if Image is None:
        return image
    if image.width >= 2400 or image.height >= 3200:
        return image
    resampling_namespace = getattr(Image, "Resampling", Image)
    resampling = getattr(resampling_namespace, "LANCZOS")
    return image.resize((image.width * scale_factor, image.height * scale_factor), resampling)


def _uses_scan_preprocess_stack(preprocess_mode: str) -> bool:
    return preprocess_mode in {"scan", "scan-local-threshold"}


def _binarize_preprocessed_candidate(
    candidate: Any,
    preprocess_mode: str,
    binarize_threshold: int,
) -> Any:
    if preprocess_mode == "scan":
        effective_threshold = _otsu_threshold(candidate)
        return candidate.point(lambda value: 255 if value >= effective_threshold else 0)
    if preprocess_mode == "scan-local-threshold":
        return _adaptive_gaussian_threshold(candidate, block_size=51, subtract_constant=15)
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
        deskew_max_angle=float(kwargs.pop("deskew_max_angle", 3.0)),
        deskew_angle_step=float(kwargs.pop("deskew_angle_step", 0.5)),
        tesseract_psm=_normalize_tesseract_psm(kwargs.pop("tesseract_psm", "auto")),
        cleanup_lexicon_texts=cleanup_lexicon_texts,
        inverse_render_rerank=bool(kwargs.pop("inverse_render_rerank", False)),
        inverse_render_top_k=int(kwargs.pop("inverse_render_top_k", 3)),
    )
    return OCRRunOptions(
        core=core_options,
        preprocess_mode=str(kwargs.pop("preprocess_mode", "basic")),
        ocr_engine=str(kwargs.pop("ocr_engine", "tesseract")),
        emit_page_artifacts=bool(kwargs.pop("emit_page_artifacts", True)),
        page_artifacts_dir=page_artifacts_dir,
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
    if options.preprocess_mode not in _VALID_PREPROCESS_MODES:
        raise ValueError(
            "preprocess_mode must be 'none', 'scan', 'scan-local-threshold', "
            "'basic', 'deskew', 'dewarp', or 'auto'"
        )
    if options.ocr_engine not in {"tesseract", "paddleocr"}:
        raise ValueError("ocr_engine must be 'tesseract' or 'paddleocr'")
    if not 0 <= options.core.binarize_threshold <= 255:
        raise ValueError("binarize_threshold must be between 0 and 255")
    if options.core.deskew_max_angle <= 0:
        raise ValueError("deskew_max_angle must be greater than 0")
    if options.core.deskew_angle_step <= 0:
        raise ValueError("deskew_angle_step must be greater than 0")
    if options.core.inverse_render_top_k <= 0:
        raise ValueError("inverse_render_top_k must be greater than 0")
    if options.core.tesseract_psm != "auto":
        psm_value = int(options.core.tesseract_psm)
        if not 0 <= psm_value <= 13:
            raise ValueError("tesseract_psm must be 'auto' or an integer between 0 and 13")
    if options.ocr_engine == "tesseract" and which("tesseract") is None:
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


def _rasterize_pdf_to_images(
    pdf_path: Path,
    work_dir: Path,
    dpi: int,
    run_command: Callable[[list[str], bool], str],
) -> list[Path]:
    pages_dir = work_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    page_prefix = pages_dir / "page"
    run_command(
        [
            "pdftoppm",
            "-r",
            str(dpi),
            "-gray",
            "-png",
            str(pdf_path),
            str(page_prefix),
        ],
        False,
    )
    page_images = sorted(pages_dir.glob("page-*.png"))
    if not page_images:
        raise RuntimeError("pdftoppm produced no page images")
    return page_images


def _prepare_artifacts_dir(work_dir: Path, options: OCRRunOptions) -> Path:
    artifacts_dir = options.page_artifacts_dir or (work_dir / "page_ocr")
    if options.emit_page_artifacts:
        artifacts_dir.mkdir(parents=True, exist_ok=True)
    return artifacts_dir


def _candidate_preprocess_modes(preprocess_mode: str) -> tuple[str, ...]:
    if preprocess_mode == "auto":
        return _AUTO_PREPROCESS_MODES
    return (preprocess_mode,)


def _candidate_tesseract_psms(options: OCRRunOptions) -> tuple[str, ...]:
    if options.ocr_engine != "tesseract":
        return ("",)
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


def _score_ocr_text(text: str, language: str, cleanup_lexicon_texts: tuple[str, ...]) -> float:
    stripped = cleanup_ocr_text(text, lexicon_texts=cleanup_lexicon_texts).strip()
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
    for raw_line in _inverse_render_text_lines(text):
        for rendered_line in _wrap_render_line(draw, font, raw_line, max_width):
            if rendered_line:
                draw.text((x, y), rendered_line, font=font, fill=0)
            y += line_height
        if not raw_line.strip():
            y += line_height
    if abs(rotation) < 1e-9:
        return canvas
    resampling_namespace = getattr(Image, "Resampling", Image)
    bicubic = getattr(resampling_namespace, "BICUBIC")
    return canvas.rotate(rotation, resample=bicubic, fillcolor=255)


def _binary_ink_iou(observed_binary: Any, rendered_binary: Any) -> float:
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


def _inverse_render_score_candidate(
    observed_binary: Any,
    bbox: tuple[int, int, int, int],
    text: str,
) -> tuple[float, dict[str, object]]:
    lines = _inverse_render_text_lines(text)
    if not lines:
        return -1.0, {"inverse_render_score": -1.0}
    base_font_size = _estimate_inverse_render_font_size(bbox, lines)
    font_paths = _inverse_render_font_paths()
    render_fonts = font_paths if font_paths else (None,)
    best_score = -1.0
    best_metadata: dict[str, object] = {
        "inverse_render_score": -1.0,
        "inverse_render_bbox": list(bbox),
    }
    for font_path in render_fonts:
        for adjustment in _INVERSE_RENDER_SIZE_ADJUSTMENTS:
            font_size = max(10, base_font_size + adjustment)
            for offset_x in _INVERSE_RENDER_OFFSETS:
                for offset_y in _INVERSE_RENDER_OFFSETS:
                    for rotation in _INVERSE_RENDER_ROTATIONS:
                        rendered = _render_inverse_text_image(
                            text,
                            observed_binary.size,
                            bbox,
                            font_path=font_path,
                            font_size=font_size,
                            offset_x=offset_x,
                            offset_y=offset_y,
                            rotation=rotation,
                        )
                        score = _binary_ink_iou(observed_binary, rendered)
                        if score <= best_score:
                            continue
                        best_score = score
                        best_metadata = {
                            "inverse_render_score": score,
                            "inverse_render_bbox": list(bbox),
                            "inverse_render_font_path": font_path,
                            "inverse_render_font_size": font_size,
                            "inverse_render_offset_x": offset_x,
                            "inverse_render_offset_y": offset_y,
                            "inverse_render_rotation": rotation,
                        }
    return best_score, best_metadata


def _maybe_inverse_render_rerank(
    image_path: Path,
    candidates: list[OCRCandidate],
    options: OCRRunOptions,
) -> OCRCandidate | None:
    if not options.core.inverse_render_rerank or len(candidates) < 2:
        return None
    ranked_candidates = sorted(candidates, key=lambda candidate: candidate.score, reverse=True)
    limit = min(len(ranked_candidates), options.core.inverse_render_top_k)
    rerank_subset = ranked_candidates[:limit]
    observed_binary, bbox = _normalize_scan_for_inverse_render(image_path)
    best_candidate: OCRCandidate | None = None
    best_score = -1.0
    for candidate in rerank_subset:
        candidate_variants = [(candidate.text, "raw")]
        if options.core.apply_cleanup:
            cleaned_variant = cleanup_ocr_text(
                candidate.text,
                lexicon_texts=options.core.cleanup_lexicon_texts,
            )
            if cleaned_variant and cleaned_variant != candidate.text:
                candidate_variants.append((cleaned_variant, "cleaned"))
        best_variant: OCRCandidate | None = None
        best_variant_score = -1.0
        for variant_text, variant_label in candidate_variants:
            inverse_render_score, inverse_metadata = _inverse_render_score_candidate(
                observed_binary,
                bbox,
                variant_text,
            )
            variant_metadata = dict(candidate.metadata)
            variant_metadata.update(inverse_metadata)
            variant_metadata["inverse_render_text_variant"] = variant_label
            variant_candidate = OCRCandidate(
                score=candidate.score,
                ocr_input_path=candidate.ocr_input_path,
                text=variant_text,
                metadata=variant_metadata,
            )
            if (
                best_variant is None
                or inverse_render_score > best_variant_score
                or (
                    math.isclose(inverse_render_score, best_variant_score)
                    and variant_label == "cleaned"
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


def _run_candidate_ocr(
    ocr_input_path: Path,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    paddle_reader: Callable[[Path], str] | None,
    tesseract_psm: str,
) -> str:
    if options.ocr_engine == "tesseract":
        return _run_tesseract(
            dependencies.run_command,
            ocr_input_path,
            options.core.language,
            tesseract_psm,
        )
    return _run_paddle_reader(paddle_reader, ocr_input_path)


def _run_ocr_on_page(
    image_path: Path,
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    preprocessed_dir: Path,
    paddle_reader: Callable[[Path], str] | None,
) -> tuple[Path, str, dict[str, object]]:
    prepared_inputs: dict[str, Path] = {}
    candidate_runs: list[dict[str, object]] = []
    candidates: list[OCRCandidate] = []
    for preprocess_mode in _candidate_preprocess_modes(options.preprocess_mode):
        ocr_input_path = _prepare_ocr_input_path(
            image_path,
            preprocess_mode,
            options,
            dependencies,
            preprocessed_dir,
            prepared_inputs,
        )
        for tesseract_psm in _candidate_tesseract_psms(options):
            text = _run_candidate_ocr(
                ocr_input_path,
                options,
                dependencies,
                paddle_reader,
                tesseract_psm,
            )
            score = _score_ocr_text(
                text,
                options.core.language,
                options.core.cleanup_lexicon_texts,
            )
            candidate_metadata: dict[str, object] = {
                "preprocess_mode": preprocess_mode,
                "score": score,
                "word_count": len([word for word in text.split() if word]),
                "character_count": len(text),
            }
            if options.ocr_engine == "tesseract":
                candidate_metadata["tesseract_psm"] = int(tesseract_psm)
            candidate_runs.append(candidate_metadata)
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
    selected_candidate = reranked_candidate or best_candidate
    selected_metadata = dict(selected_candidate.metadata)
    selected_metadata["selected_preprocess_mode"] = selected_metadata["preprocess_mode"]
    selected_metadata["selection_score"] = selected_candidate.score
    selected_metadata["selection_strategy"] = (
        "inverse-render-rerank" if reranked_candidate is not None else "text-score"
    )
    if len(candidate_runs) > 1:
        selected_metadata["candidate_runs"] = candidate_runs
    return selected_candidate.ocr_input_path, selected_candidate.text, selected_metadata


def _run_tesseract(
    run_command: Callable[[list[str], bool], str],
    image_path: Path,
    language: str,
    tesseract_psm: str,
) -> str:
    return run_command(
        [
            "tesseract",
            str(image_path),
            "stdout",
            "-l",
            language,
            "--psm",
            tesseract_psm,
        ],
        True,
    )


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


def _collect_page_ocr_results(
    page_images: list[Path],
    options: OCRRunOptions,
    dependencies: OCRDependencies,
    work_dir: Path,
    artifacts_dir: Path,
) -> tuple[list[str], list[dict[str, object]], dict[str, object]]:
    page_texts: list[str] = []
    page_details: list[dict[str, object]] = []
    preprocessed_dir = work_dir / "preprocessed"
    paddle_reader = (
        dependencies.paddle_reader_factory(options.core.language)
        if options.ocr_engine == "paddleocr"
        else None
    )
    mode_usage: Counter[str] = Counter()
    tesseract_psm_usage: Counter[str] = Counter()
    for image_path in page_images:
        ocr_input_path, text, selection_metadata = _run_ocr_on_page(
            image_path,
            options,
            dependencies,
            preprocessed_dir,
            paddle_reader,
        )
        page_texts.append(text)
        page_index = len(page_texts)
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
    selection_summary: dict[str, object] = {
        "mode_usage": dict(mode_usage),
    }
    if tesseract_psm_usage:
        selection_summary["tesseract_psm_usage"] = dict(tesseract_psm_usage)
    return page_texts, page_details, selection_summary


def _finalize_ocr_output(
    page_texts: list[str],
    output_text_path: Path,
    options: OCRRunOptions,
) -> tuple[str, dict[str, object]]:
    combined_text = "\n\n".join(page_texts)
    final_text = (
        cleanup_ocr_text(combined_text, lexicon_texts=options.core.cleanup_lexicon_texts)
        if options.core.apply_cleanup
        else combined_text
    )
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
) -> None:
    artifacts_manifest_path = artifacts_dir / "manifest.json"
    artifacts_manifest_path.write_text(
        json.dumps({"pages": page_details}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
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
    page_images = _rasterize_pdf_to_images(
        pdf_path,
        work_dir,
        options.core.dpi,
        dependencies.run_command,
    )
    artifacts_dir = _prepare_artifacts_dir(work_dir, options)
    page_texts, page_details, selection_summary = _collect_page_ocr_results(
        page_images,
        options,
        dependencies,
        work_dir,
        artifacts_dir,
    )
    _final_text, result = _finalize_ocr_output(page_texts, output_text_path, options)
    result.update(selection_summary)
    if options.emit_page_artifacts:
        _attach_page_artifacts(result, artifacts_dir, page_details)
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
    artifacts_dir = _prepare_artifacts_dir(work_dir, options)
    page_texts, page_details, selection_summary = _collect_page_ocr_results(
        page_images,
        options,
        dependencies,
        work_dir,
        artifacts_dir,
    )
    _final_text, result = _finalize_ocr_output(page_texts, output_text_path, options)
    result.update(selection_summary)
    if options.emit_page_artifacts:
        _attach_page_artifacts(result, artifacts_dir, page_details)
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
        deskew_max_angle=float(kwargs.pop("deskew_max_angle", 3.0)),
        deskew_angle_step=float(kwargs.pop("deskew_angle_step", 0.5)),
        tesseract_psm=_normalize_tesseract_psm(kwargs.pop("tesseract_psm", "auto")),
        cleanup_lexicon_texts=tuple(),
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
        deskew_max_angle=float(kwargs.pop("deskew_max_angle", 3.0)),
        deskew_angle_step=float(kwargs.pop("deskew_angle_step", 0.5)),
        tesseract_psm=_normalize_tesseract_psm(kwargs.pop("tesseract_psm", "auto")),
        cleanup_lexicon_texts=tuple(),
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
