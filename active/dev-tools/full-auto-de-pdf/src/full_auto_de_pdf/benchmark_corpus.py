"""Benchmark corpus generation and evaluation helpers."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from pathlib import Path
import random
import re
import shutil
import subprocess
import time
from typing import Any

from .benchmark import BENCHMARK_BOOKS, BenchmarkBook, calculate_accuracy_metrics
from .benchmark import fetch_gutenberg_text, strip_gutenberg_boilerplate
from .image_validation import validate_raster_image
from .ocr_pipeline import ocr_page_images, ocr_pdf_with_tesseract
from .pillow_compat import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from .text_cache import load_or_fetch_text

_EXTERNAL_CORPUS_NOTE = {
    "name": "Gutenberg-HathiTrust Parallel Corpus",
    "url": "https://hdl.handle.net/2142/109695",
    "description": (
        "Large aligned OCR/proofread corpus described by the 2021 UIUC iConference "
        "poster; use it when you need a broader external benchmark beyond the built-in "
        "generated public-domain corpus."
    ),
}
_DEFAULT_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
)
ARTIFACT_PROFILES = (
    "clean",
    "scan-light",
    "scan-moderate",
    "scan-heavy",
    "scan-extreme",
    "scan-photocopy",
)
_WORD_RE = re.compile(r"\S+")
_ALPHA_TOKEN_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_PNG_DPI = (300, 300)
_SYNTHETIC_CORPUS_METRIC_NOTE = (
    "This benchmark uses synthetic printed PDFs rendered from clean public-domain "
    "reference text. It is useful for measuring OCR engine and cleanup quality on "
    "clean printed pages, but it is easier than real scanned-book evaluation."
)
_STREAMING_SYNTHETIC_CORPUS_METRIC_NOTE = (
    _SYNTHETIC_CORPUS_METRIC_NOTE
    + " The streaming benchmark generates one synthetic sample at a time and only "
    "persists failure artifacts, which lets you probe many more samples without "
    "keeping a large on-disk corpus."
)
_LOCAL_IMAGE_TEXT_METRIC_NOTE = (
    "This benchmark uses existing local page images paired with local ground-truth "
    "transcriptions. It measures OCR quality on the selected raster corpus rather "
    "than the synthetic printed-PDF benchmark."
)


@dataclass(frozen=True)
class CorpusBook:
    """One generated benchmark book entry."""

    book: BenchmarkBook
    reference_text: str
    excerpt_text: str
    pdf_path: Path
    reference_text_path: Path
    excerpt_text_path: Path
    page_image_paths: tuple[Path, ...]
    font_path: str
    artifact_profile: str


def _fontconfig_match(family: str) -> str | None:
    if shutil.which("fc-match") is None:
        return None
    completed = subprocess.run(
        ["fc-match", "-f", "%{file}\n", family],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    candidate = completed.stdout.strip()
    return candidate or None


def _gutenberg_cache_path(cache_dir: Path, book: BenchmarkBook) -> Path:
    return cache_dir / f"pg{book.gutenberg_id}_gutenberg.txt"


def _load_reference_text(book: BenchmarkBook, cache_dir: Path, timeout_seconds: int) -> str:
    cached_path = _gutenberg_cache_path(cache_dir, book)
    raw_text = load_or_fetch_text(
        cached_path,
        lambda book=book: fetch_gutenberg_text(book.gutenberg_id, timeout_seconds=timeout_seconds),
    )
    return strip_gutenberg_boilerplate(raw_text)


def _normalize_paragraphs(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return [paragraph.strip() for paragraph in normalized.split("\n\n") if paragraph.strip()]


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text))


def _extract_excerpt(text: str, excerpt_word_count: int, skip_word_count: int) -> str:
    paragraphs = _normalize_paragraphs(text)
    if not paragraphs:
        return text.strip()
    selected: list[str] = []
    seen_words = 0
    collected_words = 0
    for paragraph in paragraphs:
        paragraph_words = _word_count(paragraph)
        if seen_words + paragraph_words <= skip_word_count:
            seen_words += paragraph_words
            continue
        selected.append(paragraph)
        collected_words += paragraph_words
        seen_words += paragraph_words
        if collected_words >= excerpt_word_count:
            break
    if selected:
        return "\n\n".join(selected).strip()
    fallback_words = max(200, excerpt_word_count)
    fallback: list[str] = []
    collected_words = 0
    for paragraph in paragraphs:
        fallback.append(paragraph)
        collected_words += _word_count(paragraph)
        if collected_words >= fallback_words:
            break
    return "\n\n".join(fallback).strip()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "book"


def _resolve_font(font_path: str | None, font_size: int) -> tuple[Any, str]:
    if ImageFont is None:
        raise RuntimeError(
            "Missing dependency for corpus rendering: pillow. "
            "Install with `pip install pillow`."
        )
    candidates = [font_path] if font_path else []
    candidates.extend(
        candidate
        for candidate in (
            _fontconfig_match("serif"),
            _fontconfig_match("sans"),
            _fontconfig_match("monospace"),
        )
        if candidate is not None
    )
    candidates.extend(_DEFAULT_FONT_CANDIDATES)
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=font_size), str(path)
    return ImageFont.load_default(), "Pillow default bitmap font"


def _wrap_paragraph(draw: Any, font: Any, paragraph: str, max_width: int) -> list[str]:
    words = paragraph.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            continue
        lines.append(current)
        current = word
    lines.append(current)
    return lines


def _save_page_image(page_image: Any, page_number: int, pages_dir: Path) -> Path:
    page_path = pages_dir / f"page-{page_number:04d}.png"
    page_image.save(page_path, dpi=_PNG_DPI)
    return page_path


def _ocr_ready_image(page_image: Any) -> Any:
    grayscale = page_image.convert("L")
    return grayscale.point(lambda value: 255 if value >= 220 else 0, mode="1").convert("L")


def _normalize_artifact_profiles(artifact_profiles: tuple[str, ...] | list[str] | None) -> tuple[str, ...]:
    raw_values = artifact_profiles if artifact_profiles else ("clean",)
    normalized = tuple(str(value).strip().lower() for value in raw_values if str(value).strip())
    if not normalized:
        return ("clean",)
    invalid = [value for value in normalized if value not in ARTIFACT_PROFILES]
    if invalid:
        raise ValueError(
            "artifact_profiles must be chosen from: " + ", ".join(ARTIFACT_PROFILES)
        )
    return normalized


def _resampling_filter(name: str) -> Any:
    if Image is None:
        return None
    namespace = getattr(Image, "Resampling", Image)
    return getattr(namespace, name)


def _noise_texture(size: tuple[int, int], rng: random.Random, amplitude: int) -> Any:
    if Image is None:
        raise RuntimeError("pillow is required for artifact rendering")
    tile = Image.new("L", (96, 96), color=128)
    tile.putdata(
        [
            max(0, min(255, 128 + rng.randint(-amplitude, amplitude)))
            for _ in range(96 * 96)
        ]
    )
    return tile.resize(size, _resampling_filter("BILINEAR"))


def _gradient_mask(size: tuple[int, int], rng: random.Random, intensity: int) -> Any:
    if Image is None:
        raise RuntimeError("pillow is required for artifact rendering")
    width, height = size
    vertical = Image.new("L", (1, 64), color=255)
    horizontal = Image.new("L", (64, 1), color=255)
    vertical_start = 255 - rng.randint(0, 4 * intensity)
    vertical_end = 255 - rng.randint(6 * intensity, 14 * intensity)
    horizontal_start = 255 - rng.randint(0, 3 * intensity)
    horizontal_end = 255 - rng.randint(4 * intensity, 10 * intensity)
    vertical.putdata(
        [
            int(round(vertical_start + ((vertical_end - vertical_start) * index / 63.0)))
            for index in range(64)
        ]
    )
    horizontal.putdata(
        [
            int(round(horizontal_start + ((horizontal_end - horizontal_start) * index / 63.0)))
            for index in range(64)
        ]
    )
    vertical_mask = vertical.resize((width, height), _resampling_filter("BILINEAR"))
    horizontal_mask = horizontal.resize((width, height), _resampling_filter("BILINEAR"))
    return ImageChops.multiply(vertical_mask, horizontal_mask)


def _paper_texture(size: tuple[int, int], rng: random.Random, intensity: int) -> Any:
    if Image is None or ImageChops is None:
        raise RuntimeError("pillow is required for artifact rendering")
    texture = Image.new("L", size, color=248 - (intensity * 3))
    texture = ImageChops.multiply(texture, _gradient_mask(size, rng, intensity))
    noise = _noise_texture(size, rng, amplitude=5 * intensity)
    texture = ImageChops.add(texture, noise, scale=2.0, offset=-8 * intensity)
    return texture


def _edge_shadow_mask(size: tuple[int, int], rng: random.Random, intensity: int) -> Any:
    if Image is None or ImageFilter is None:
        raise RuntimeError("pillow is required for artifact rendering")
    width, height = size
    band_width = max(120, width // 7)
    minimum_value = max(112, 255 - (28 * intensity))
    edge = rng.choice(("left", "right"))
    gradient = Image.new("L", (64, 1), color=255)
    if edge == "left":
        gradient.putdata(
            [
                int(round(minimum_value + ((255 - minimum_value) * index / 63.0)))
                for index in range(64)
            ]
        )
    else:
        gradient.putdata(
            [
                int(round(255 - ((255 - minimum_value) * index / 63.0)))
                for index in range(64)
            ]
        )
    band = gradient.resize((band_width, height), _resampling_filter("BILINEAR"))
    shadow = Image.new("L", size, color=255)
    shadow.paste(band, (0 if edge == "left" else width - band_width, 0))
    return shadow.filter(ImageFilter.GaussianBlur(radius=6.0 + intensity))


def _speckle_mask(size: tuple[int, int], rng: random.Random, intensity: int) -> Any:
    if Image is None or ImageFilter is None:
        raise RuntimeError("pillow is required for artifact rendering")
    coarse_width = max(48, size[0] // 28)
    coarse_height = max(48, size[1] // 28)
    mask = Image.new("L", (coarse_width, coarse_height), color=255)
    threshold = min(48, 4 + (4 * intensity))
    mask.putdata(
        [255 if rng.randint(0, 255) < threshold else 0 for _ in range(coarse_width * coarse_height)]
    )
    return mask.resize(size, _resampling_filter("NEAREST")).filter(
        ImageFilter.GaussianBlur(radius=0.5 + (0.2 * intensity))
    )


def _apply_scan_artifacts(page_image: Any, artifact_profile: str, seed: int) -> Any:
    if Image is None or ImageChops is None or ImageFilter is None:
        raise RuntimeError(
            "Missing dependency for corpus rendering: pillow. "
            "Install with `pip install pillow`."
        )
    if artifact_profile == "clean":
        return _ocr_ready_image(page_image)

    if artifact_profile == "scan-photocopy":
        rng = random.Random(seed)
        processed = page_image.convert("L")
        width, height = processed.size
        processed = processed.rotate(
            rng.uniform(-0.45, 0.45),
            resample=_resampling_filter("BICUBIC"),
            fillcolor=255,
        )
        processed = processed.filter(ImageFilter.GaussianBlur(radius=0.9))
        processed = ImageChops.multiply(processed, _paper_texture((width, height), rng, 2))
        processed = ImageChops.multiply(processed, _edge_shadow_mask((width, height), rng, 3))
        processed = ImageChops.lighter(processed, _speckle_mask((width, height), rng, 4))
        processed = ImageChops.add(
            processed,
            _noise_texture((width, height), rng, amplitude=10),
            scale=2.0,
            offset=12,
        )
        processed = processed.point(lambda value: 255 if value >= 120 else 0)
        processed = processed.filter(ImageFilter.MedianFilter(3))
        return processed.convert("L")

    intensity_map = {
        "scan-light": 1,
        "scan-moderate": 2,
        "scan-heavy": 3,
        "scan-extreme": 4,
    }
    intensity = intensity_map[artifact_profile]
    rng = random.Random(seed)
    processed = page_image.convert("L")
    width, height = processed.size
    rotation = rng.uniform(-0.35, 0.35) * float(intensity)
    processed = processed.rotate(
        rotation,
        resample=_resampling_filter("BICUBIC"),
        fillcolor=255,
    )
    shrink_floor = 0.62 if intensity >= 4 else 0.70
    shrink_factor = max(shrink_floor, 1.0 - (0.06 * intensity) - rng.uniform(0.0, 0.02 * intensity))
    downsampled = processed.resize(
        (
            max(1, int(round(width * shrink_factor))),
            max(1, int(round(height * shrink_factor))),
        ),
        _resampling_filter("BILINEAR"),
    )
    processed = downsampled.resize((width, height), _resampling_filter("BICUBIC"))
    processed = processed.filter(ImageFilter.GaussianBlur(radius=0.35 * intensity))
    ink_floor = 8 * intensity
    background_ceiling = 255 - (4 * intensity)
    processed = processed.point(
        lambda value: int(
            round(ink_floor + ((value / 255.0) * (background_ceiling - ink_floor)))
        )
    )
    texture = _paper_texture((width, height), rng, intensity)
    processed = ImageChops.multiply(processed, texture)
    if intensity >= 2:
        transpose_namespace = getattr(Image, "Transpose", Image)
        bleed = processed.transpose(getattr(transpose_namespace, "FLIP_LEFT_RIGHT")).filter(
            ImageFilter.GaussianBlur(radius=2.0 + intensity)
        )
        bleed = bleed.point(lambda value: 255 if value > 245 else min(255, value + 55))
        processed = ImageChops.multiply(processed, bleed)
    if artifact_profile == "scan-extreme":
        processed = ImageChops.multiply(processed, _edge_shadow_mask((width, height), rng, intensity))
        processed = ImageChops.lighter(processed, _speckle_mask((width, height), rng, intensity))
        processed = processed.filter(ImageFilter.GaussianBlur(radius=0.4))
    return processed


def _variant_identifier(identifier: str, artifact_profile: str) -> str:
    if artifact_profile == "clean":
        return identifier
    return f"{identifier}-{artifact_profile}"


def _stable_variant_seed(identifier: str, artifact_profile: str, artifact_seed: int) -> int:
    seed_material = f"{identifier}:{artifact_profile}:{artifact_seed}"
    return sum((index + 1) * ord(char) for index, char in enumerate(seed_material))


def _render_page_images(
    excerpt_text: str,
    output_dir: Path,
    *,
    font_path: str | None,
    font_size: int,
    page_width: int,
    page_height: int,
    margin: int,
    artifact_profile: str,
    artifact_seed: int,
) -> tuple[list[Path], str]:
    # lizard forgive: page rendering and rollover logic are intentionally centralized.
    if Image is None or ImageDraw is None:
        raise RuntimeError(
            "Missing dependency for corpus rendering: pillow. "
            "Install with `pip install pillow`."
        )
    pages_dir = output_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    font, resolved_font_path = _resolve_font(font_path, font_size)
    page_paths: list[Path] = []
    page_image = Image.new("L", (page_width, page_height), color=255)
    draw = ImageDraw.Draw(page_image)
    page_number = 1
    max_width = page_width - (margin * 2)
    line_height = font_size + max(10, font_size // 2)
    y = margin

    for paragraph in _normalize_paragraphs(excerpt_text):
        for line in _wrap_paragraph(draw, font, paragraph, max_width):
            if y + line_height > page_height - margin:
                page_paths.append(
                    _save_page_image(
                        _apply_scan_artifacts(
                            page_image,
                            artifact_profile,
                            artifact_seed + page_number,
                        ),
                        page_number,
                        pages_dir,
                    )
                )
                page_number += 1
                page_image = Image.new("L", (page_width, page_height), color=255)
                draw = ImageDraw.Draw(page_image)
                y = margin
            draw.text((margin, y), line, font=font, fill=0)
            y += line_height
        y += line_height

    page_paths.append(
        _save_page_image(
            _apply_scan_artifacts(
                page_image,
                artifact_profile,
                artifact_seed + page_number,
            ),
            page_number,
            pages_dir,
        )
    )
    return page_paths, resolved_font_path


def _write_pdf(page_image_paths: list[Path], pdf_path: Path) -> None:
    if Image is None:
        raise RuntimeError(
            "Missing dependency for corpus rendering: pillow. "
            "Install with `pip install pillow`."
        )
    images = [Image.open(path).convert("RGB") for path in page_image_paths]
    try:
        first, rest = images[0], images[1:]
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        first.save(pdf_path, "PDF", resolution=300.0, save_all=True, append_images=rest)
    finally:
        for image in images:
            image.close()


def build_benchmark_corpus(
    output_dir: Path,
    cache_dir: Path,
    *,
    timeout_seconds: int = 60,
    books: tuple[BenchmarkBook, ...] = BENCHMARK_BOOKS,
    max_books: int | None = None,
    excerpt_word_count: int = 1200,
    skip_word_count: int = 250,
    font_path: str | None = None,
    font_size: int = 32,
    page_width: int = 1654,
    page_height: int = 2339,
    margin: int = 150,
    artifact_profiles: tuple[str, ...] = ("clean",),
    artifact_seed: int = 0,
) -> dict[str, Any]:
    # lizard forgive: corpus assembly wires together fetching, rendering, and manifest output.
    """Build a local synthetic printed-text OCR benchmark corpus."""

    if excerpt_word_count <= 0:
        raise ValueError("excerpt_word_count must be greater than 0")
    if skip_word_count < 0:
        raise ValueError("skip_word_count must be zero or greater")
    normalized_artifact_profiles = _normalize_artifact_profiles(artifact_profiles)
    selected_books = books[:max_books] if max_books is not None else books
    if not selected_books:
        raise ValueError("build_benchmark_corpus requires at least one book")

    built_books: list[CorpusBook] = []
    for book in selected_books:
        reference_text = _load_reference_text(book, cache_dir, timeout_seconds)
        excerpt_text = _extract_excerpt(reference_text, excerpt_word_count, skip_word_count)
        for artifact_profile in normalized_artifact_profiles:
            variant_identifier = _variant_identifier(book.identifier, artifact_profile)
            book_dir = output_dir / _slugify(variant_identifier)
            reference_text_path = book_dir / "reference.txt"
            excerpt_text_path = book_dir / "excerpt.txt"
            pdf_path = book_dir / "synthetic.pdf"
            reference_text_path.parent.mkdir(parents=True, exist_ok=True)
            reference_text_path.write_text(excerpt_text, encoding="utf-8")
            excerpt_text_path.write_text(excerpt_text, encoding="utf-8")
            page_image_paths, resolved_font_path = _render_page_images(
                excerpt_text,
                book_dir,
                font_path=font_path,
                font_size=font_size,
                page_width=page_width,
                page_height=page_height,
                margin=margin,
                artifact_profile=artifact_profile,
                artifact_seed=_stable_variant_seed(
                    book.identifier,
                    artifact_profile,
                    artifact_seed,
                ),
            )
            _write_pdf(page_image_paths, pdf_path)
            built_books.append(
                CorpusBook(
                    book=BenchmarkBook(variant_identifier, book.title, book.gutenberg_id),
                    reference_text=excerpt_text,
                    excerpt_text=excerpt_text,
                    pdf_path=pdf_path,
                    reference_text_path=reference_text_path,
                    excerpt_text_path=excerpt_text_path,
                    page_image_paths=tuple(page_image_paths),
                    font_path=resolved_font_path,
                    artifact_profile=artifact_profile,
                )
            )

    manifest = {
        "corpus_type": "generated-public-domain-printed-text",
        "description": (
            "Synthetic printed-text benchmark corpus generated from Project Gutenberg "
            "reference texts rendered into reproducible PDFs."
        ),
        "recommended_external_corpus": _EXTERNAL_CORPUS_NOTE,
        "artifact_profiles": list(normalized_artifact_profiles),
        "artifact_seed": artifact_seed,
        "book_count": len(built_books),
        "books": [
            {
                "identifier": item.book.identifier,
                "title": item.book.title,
                "gutenberg_id": item.book.gutenberg_id,
                "pdf_path": str(item.pdf_path),
                "reference_text_path": str(item.reference_text_path),
                "excerpt_text_path": str(item.excerpt_text_path),
                "page_image_paths": [str(path) for path in item.page_image_paths],
                "page_count": len(item.page_image_paths),
                "reference_word_count": _word_count(item.reference_text),
                "font_path": item.font_path,
                "artifact_profile": item.artifact_profile,
            }
            for item in built_books
        ],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def _average_metric(results: list[dict[str, Any]], key: str) -> float:
    return sum(float(item[key]) for item in results) / len(results) if results else 0.0


def _minimum_metric(results: list[dict[str, Any]], key: str) -> float:
    return min(float(item[key]) for item in results) if results else 0.0


def _exact_metric_rate(results: list[dict[str, Any]], key: str) -> float:
    return (
        sum(1 for item in results if float(item[key]) >= 1.0) / len(results)
        if results
        else 0.0
    )


def _sorted_counter_dict(counter: Counter[str]) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


def _lowest_metric_rows(
    results: list[dict[str, Any]],
    key: str,
    *,
    limit: int = 5,
) -> list[dict[str, object]]:
    ranked = sorted(results, key=lambda item: (float(item[key]), str(item.get("identifier", ""))))[:limit]
    rows: list[dict[str, object]] = []
    for item in ranked:
        row: dict[str, object] = {
            "identifier": str(item.get("identifier", "")),
            "title": str(item.get("title", "")),
            key: float(item[key]),
            "char_accuracy": float(item.get("char_accuracy", 0.0)),
            "word_accuracy": float(item.get("word_accuracy", 0.0)),
        }
        artifact_profile = item.get("artifact_profile")
        if isinstance(artifact_profile, str):
            row["artifact_profile"] = artifact_profile
        unexpected_alpha_token_count = item.get("unexpected_alpha_token_count")
        if isinstance(unexpected_alpha_token_count, int):
            row["unexpected_alpha_token_count"] = unexpected_alpha_token_count
        rows.append(row)
    return rows


def _artifact_profile_summary(results: list[dict[str, Any]]) -> dict[str, dict[str, object]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in results:
        artifact_profile = item.get("artifact_profile")
        if not isinstance(artifact_profile, str):
            continue
        grouped.setdefault(artifact_profile, []).append(item)
    summary: dict[str, dict[str, object]] = {}
    for artifact_profile, profile_results in sorted(grouped.items()):
        entry: dict[str, object] = {
            "item_count": len(profile_results),
            "avg_char_accuracy": _average_metric(profile_results, "char_accuracy"),
            "avg_word_accuracy": _average_metric(profile_results, "word_accuracy"),
            "avg_unexpected_alpha_token_rate": _average_metric(
                profile_results,
                "unexpected_alpha_token_rate",
            ),
            "perfect_char_accuracy_rate": _exact_metric_rate(profile_results, "char_accuracy"),
            "perfect_word_accuracy_rate": _exact_metric_rate(profile_results, "word_accuracy"),
            "worst_char_accuracy": _minimum_metric(profile_results, "char_accuracy"),
            "worst_word_accuracy": _minimum_metric(profile_results, "word_accuracy"),
        }
        if any("failure" in item for item in profile_results):
            entry["failure_count"] = sum(1 for item in profile_results if bool(item.get("failure")))
        summary[artifact_profile] = entry
    return summary


def _string_counter_from_mapping(value: object) -> Counter[str]:
    counter: Counter[str] = Counter()
    if not isinstance(value, dict):
        return counter
    for key, raw_count in value.items():
        if not isinstance(key, str):
            continue
        if isinstance(raw_count, bool):
            continue
        if isinstance(raw_count, int):
            counter[key] = raw_count
            continue
        if isinstance(raw_count, float) and raw_count.is_integer():
            counter[key] = int(raw_count)
    return counter


def _int_list(value: object) -> list[int]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, int)]


def _normalized_page_analysis(value: object) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    page_type_counts = _string_counter_from_mapping(payload.get("page_type_counts"))
    page_quality_tier_counts = _string_counter_from_mapping(payload.get("page_quality_tier_counts"))
    page_route_counts = _string_counter_from_mapping(payload.get("page_route_counts"))
    targeted_page_retry_reason_counts = _string_counter_from_mapping(
        payload.get("targeted_page_retry_reason_counts")
    )
    front_matter_page_indices = _int_list(payload.get("front_matter_page_indices"))
    low_quality_page_indices = _int_list(payload.get("low_quality_page_indices"))
    targeted_page_retry_page_indices = _int_list(payload.get("targeted_page_retry_page_indices"))
    return {
        "page_type_counts": _sorted_counter_dict(page_type_counts),
        "page_quality_tier_counts": _sorted_counter_dict(page_quality_tier_counts),
        "page_route_counts": _sorted_counter_dict(page_route_counts),
        "front_matter_page_count": int(payload.get("front_matter_page_count", len(front_matter_page_indices))),
        "front_matter_page_indices": front_matter_page_indices,
        "low_quality_page_count": int(payload.get("low_quality_page_count", len(low_quality_page_indices))),
        "low_quality_page_indices": low_quality_page_indices,
        "targeted_page_retry_count": int(
            payload.get("targeted_page_retry_count", len(targeted_page_retry_page_indices))
        ),
        "targeted_page_retry_page_indices": targeted_page_retry_page_indices,
        "targeted_page_retry_reason_counts": _sorted_counter_dict(targeted_page_retry_reason_counts),
    }


def _iter_streaming_excerpts(
    reference_text: str,
    excerpt_word_count: int,
    skip_word_count: int,
    samples_per_book: int,
) -> list[tuple[int, int, str]]:
    excerpts: list[tuple[int, int, str]] = []
    seen_excerpts: set[str] = set()
    for sample_index in range(samples_per_book):
        sample_skip_word_count = skip_word_count + (sample_index * excerpt_word_count)
        excerpt_text = _extract_excerpt(reference_text, excerpt_word_count, sample_skip_word_count)
        if not excerpt_text or excerpt_text in seen_excerpts:
            break
        seen_excerpts.add(excerpt_text)
        excerpts.append((sample_index + 1, sample_skip_word_count, excerpt_text))
    return excerpts


def _streaming_sample_identifier(
    identifier: str,
    artifact_profile: str,
    sample_number: int,
) -> str:
    return f"{_variant_identifier(identifier, artifact_profile)}-sample-{sample_number:03d}"


def _streaming_sample_title(title: str, artifact_profile: str, sample_number: int) -> str:
    return f"{title} ({artifact_profile}, sample {sample_number})"


def _update_token_failure_counters(
    reference_text: str,
    hypothesis_text: str,
    *,
    substitution_counter: Counter[tuple[str, str]],
    missing_counter: Counter[str],
    unexpected_counter: Counter[str],
) -> None:
    reference_tokens = _WORD_RE.findall(reference_text)
    hypothesis_tokens = _WORD_RE.findall(hypothesis_text)
    matcher = SequenceMatcher(a=reference_tokens, b=hypothesis_tokens, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace":
            reference_span = reference_tokens[i1:i2]
            hypothesis_span = hypothesis_tokens[j1:j2]
            if reference_span and hypothesis_span and max(len(reference_span), len(hypothesis_span)) <= 4:
                substitution_counter[(" ".join(reference_span), " ".join(hypothesis_span))] += 1
            continue
        if tag == "delete":
            missing_counter.update(reference_tokens[i1:i2])
            continue
        if tag == "insert":
            unexpected_counter.update(hypothesis_tokens[j1:j2])


def _substitution_summary_rows(
    substitution_counter: Counter[tuple[str, str]],
    *,
    limit: int = 20,
) -> list[dict[str, object]]:
    return [
        {
            "reference": reference,
            "hypothesis": hypothesis,
            "count": count,
        }
        for (reference, hypothesis), count in substitution_counter.most_common(limit)
    ]


def _token_summary_rows(counter: Counter[str], *, limit: int = 20) -> list[dict[str, object]]:
    return [{"token": token, "count": count} for token, count in counter.most_common(limit)]


def _timed_benchmark_progress_payload(
    *,
    stage: str,
    status: str,
    started_at: float,
    completed_items: int,
    total_items: int,
    current_identifier: str | None = None,
) -> dict[str, object]:
    elapsed_seconds = max(0.0, time.monotonic() - started_at)
    seconds_per_item = (
        elapsed_seconds / completed_items if completed_items > 0 and elapsed_seconds > 0 else None
    )
    estimated_remaining_seconds = (
        seconds_per_item * (total_items - completed_items)
        if seconds_per_item is not None and status != "complete"
        else 0.0 if status == "complete"
        else None
    )
    payload: dict[str, object] = {
        "stage": stage,
        "status": status,
        "completed_items": completed_items,
        "total_items": total_items,
        "elapsed_seconds": elapsed_seconds,
        "seconds_per_item": seconds_per_item,
        "estimated_remaining_seconds": estimated_remaining_seconds,
    }
    if current_identifier:
        payload["current_identifier"] = current_identifier
    return payload


def _emit_benchmark_progress(
    progress_callback: Any,
    payload: dict[str, object],
) -> None:
    if callable(progress_callback):
        progress_callback(payload)


def _alpha_tokens(text: str) -> list[str]:
    return [token.lower() for token in _ALPHA_TOKEN_RE.findall(text)]


def _unexpected_alpha_token_counts(reference_text: str, hypothesis_text: str) -> Counter[str]:
    reference_tokens = set(_alpha_tokens(reference_text))
    counts: Counter[str] = Counter()
    for token in _alpha_tokens(hypothesis_text):
        if len(token.replace("'", "")) < 3:
            continue
        if token in reference_tokens:
            continue
        counts[token] += 1
    return counts


def _record_streaming_failure_artifacts(
    *,
    sample_dir: Path,
    ocr_work_dir: Path,
    failure_dir: Path,
    reference_text: str,
    hypothesis_text: str,
    metadata: dict[str, Any],
) -> None:
    if failure_dir.exists():
        shutil.rmtree(failure_dir, ignore_errors=True)
    if failure_dir.exists():
        raise RuntimeError(f"could not clear existing failure artifact directory: {failure_dir}")
    failure_dir.mkdir(parents=True, exist_ok=True)
    (failure_dir / "reference.txt").write_text(reference_text, encoding="utf-8")
    (failure_dir / "hypothesis.txt").write_text(hypothesis_text, encoding="utf-8")
    (failure_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    generated_pages_dir = sample_dir / "pages"
    if generated_pages_dir.exists():
        shutil.copytree(generated_pages_dir, failure_dir / "pages")
    page_ocr_dir = ocr_work_dir / "page_ocr"
    if page_ocr_dir.exists():
        shutil.copytree(page_ocr_dir, failure_dir / "page_ocr")


def _index_paths_by_stem(root_dir: Path, pattern: str) -> dict[str, Path]:
    return {
        path.stem: path
        for path in sorted(root_dir.glob(pattern))
        if path.is_file()
    }


def _metric_note_for_corpus_type(corpus_type: str) -> str:
    if corpus_type == "local-image-text-groundtruth":
        return _LOCAL_IMAGE_TEXT_METRIC_NOTE
    return _SYNTHETIC_CORPUS_METRIC_NOTE


def build_image_text_corpus_manifest(
    output_manifest_path: Path,
    images_dir: Path,
    texts_dir: Path,
    *,
    image_glob: str = "**/*.tif*",
    text_glob: str = "**/*.txt",
    limit: int | None = None,
    title_prefix: str = "Ground Truth Page",
) -> dict[str, Any]:
    """Build a benchmark manifest from local page-image and text pairs."""

    image_paths = _index_paths_by_stem(images_dir, image_glob)
    text_paths = _index_paths_by_stem(texts_dir, text_glob)
    shared_identifiers = sorted(set(image_paths).intersection(text_paths))
    if limit is not None:
        shared_identifiers = shared_identifiers[:limit]
    if not shared_identifiers:
        raise ValueError("no matching image/text pairs were found for the requested corpus paths")

    books = []
    for identifier in shared_identifiers:
        image_path = image_paths[identifier]
        validate_raster_image(image_path, context="build-image-text-corpus rejected")
        reference_text_path = text_paths[identifier]
        reference_text = reference_text_path.read_text(encoding="utf-8")
        books.append(
            {
                "identifier": identifier,
                "title": f"{title_prefix} {identifier}",
                "reference_text_path": str(reference_text_path),
                "page_image_paths": [str(image_path)],
                "page_count": 1,
                "reference_word_count": _word_count(reference_text),
            }
        )

    manifest = {
        "corpus_type": "local-image-text-groundtruth",
        "description": (
            "Image/text OCR corpus manifest built from existing local page images and "
            "ground-truth transcription files."
        ),
        "book_count": len(books),
        "images_dir": str(images_dir),
        "texts_dir": str(texts_dir),
        "image_glob": image_glob,
        "text_glob": text_glob,
        "books": books,
    }
    output_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    output_manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def run_benchmark_corpus(
    corpus_manifest_path: Path,
    output_report_path: Path,
    work_dir: Path,
    **ocr_kwargs: Any,
) -> dict[str, Any]:
    # lizard forgive: benchmark execution keeps manifest parsing and OCR dispatch in one place.
    """Run local OCR against a benchmark corpus manifest."""

    payload = json.loads(corpus_manifest_path.read_text(encoding="utf-8"))
    corpus_type = str(payload.get("corpus_type") or "")
    books = payload.get("books", [])
    if not isinstance(books, list) or not books:
        raise ValueError("corpus manifest did not include any books")

    progress_callback = ocr_kwargs.get("progress_callback")
    started_at = time.monotonic()
    _emit_benchmark_progress(
        progress_callback,
        _timed_benchmark_progress_payload(
            stage="benchmark-corpus",
            status="running",
            started_at=started_at,
            completed_items=0,
            total_items=len(books),
        ),
    )
    results: list[dict[str, Any]] = []
    unexpected_alpha_counter: Counter[str] = Counter()
    page_type_counter: Counter[str] = Counter()
    page_quality_tier_counter: Counter[str] = Counter()
    page_route_counter: Counter[str] = Counter()
    targeted_page_retry_reason_counter: Counter[str] = Counter()
    for book in books:
        if not isinstance(book, dict):
            continue
        identifier = str(book["identifier"])
        title = str(book["title"])
        pdf_value = book.get("pdf_path")
        pdf_path = Path(str(pdf_value)) if pdf_value else None
        reference_text_path = Path(str(book["reference_text_path"]))
        reference_text = reference_text_path.read_text(encoding="utf-8")
        output_text_path = work_dir / f"{_slugify(identifier)}.txt"
        page_image_values = book.get("page_image_paths", [])
        page_image_paths = (
            [Path(str(path)) for path in page_image_values]
            if isinstance(page_image_values, list)
            else []
        )
        ocr_result = (
            ocr_page_images(
                page_images=page_image_paths,
                output_text_path=output_text_path,
                work_dir=work_dir / _slugify(identifier),
                cleanup_lexicon_texts=(reference_text,),
                **ocr_kwargs,
            )
            if page_image_paths
            else ocr_pdf_with_tesseract(
                pdf_path=_require_pdf_path(pdf_path, identifier),
                output_text_path=output_text_path,
                work_dir=work_dir / _slugify(identifier),
                cleanup_lexicon_texts=(reference_text,),
                **ocr_kwargs,
            )
        )
        hypothesis_text = output_text_path.read_text(encoding="utf-8")
        accuracy = calculate_accuracy_metrics(reference_text, hypothesis_text)
        unexpected_alpha_tokens = _unexpected_alpha_token_counts(reference_text, hypothesis_text)
        unexpected_alpha_token_count = sum(unexpected_alpha_tokens.values())
        hypothesis_alpha_token_count = max(len(_alpha_tokens(hypothesis_text)), 1)
        page_analysis = _normalized_page_analysis(ocr_result.get("page_analysis"))
        unexpected_alpha_counter.update(unexpected_alpha_tokens)
        page_type_counter.update(page_analysis["page_type_counts"])
        page_quality_tier_counter.update(page_analysis["page_quality_tier_counts"])
        page_route_counter.update(page_analysis["page_route_counts"])
        low_quality_page_count = int(page_analysis["low_quality_page_count"])
        front_matter_page_count = int(page_analysis["front_matter_page_count"])
        targeted_page_retry_count = int(page_analysis["targeted_page_retry_count"])
        targeted_page_retry_reason_counter.update(page_analysis["targeted_page_retry_reason_counts"])
        results.append(
            {
                "identifier": identifier,
                "title": title,
                "artifact_profile": book.get("artifact_profile"),
                "pdf_path": str(pdf_path) if pdf_path is not None else None,
                "reference_text_path": str(reference_text_path),
                "ocr_output_path": str(output_text_path),
                "page_count": ocr_result["page_count"],
                "word_count": ocr_result["word_count"],
                "character_count": ocr_result["character_count"],
                "cer": accuracy["cer"],
                "wer": accuracy["wer"],
                "char_accuracy": accuracy["char_accuracy"],
                "word_accuracy": accuracy["word_accuracy"],
                "unexpected_alpha_token_count": unexpected_alpha_token_count,
                "unexpected_alpha_token_rate": unexpected_alpha_token_count / hypothesis_alpha_token_count,
                "unexpected_alpha_tokens": _token_summary_rows(unexpected_alpha_tokens),
                "mode_usage": ocr_result.get("mode_usage", {}),
                "tesseract_psm_usage": ocr_result.get("tesseract_psm_usage", {}),
                "page_analysis": page_analysis,
                "low_quality_page_count": low_quality_page_count,
                "low_quality_page_rate": low_quality_page_count / max(int(ocr_result["page_count"]), 1),
                "front_matter_page_count": front_matter_page_count,
                "front_matter_page_rate": front_matter_page_count / max(int(ocr_result["page_count"]), 1),
                "targeted_page_retry_count": targeted_page_retry_count,
                "targeted_page_retry_rate": targeted_page_retry_count / max(int(ocr_result["page_count"]), 1),
            }
        )
        _emit_benchmark_progress(
            progress_callback,
            _timed_benchmark_progress_payload(
                stage="benchmark-corpus",
                status="running",
                started_at=started_at,
                completed_items=len(results),
                total_items=len(books),
                current_identifier=identifier,
            ),
        )

    summary = {
        "book_count": len(results),
        "avg_cer": _average_metric(results, "cer"),
        "avg_wer": _average_metric(results, "wer"),
        "avg_char_accuracy": _average_metric(results, "char_accuracy"),
        "avg_word_accuracy": _average_metric(results, "word_accuracy"),
        "perfect_char_accuracy_rate": _exact_metric_rate(results, "char_accuracy"),
        "perfect_word_accuracy_rate": _exact_metric_rate(results, "word_accuracy"),
        "worst_char_accuracy": _minimum_metric(results, "char_accuracy"),
        "worst_word_accuracy": _minimum_metric(results, "word_accuracy"),
        "avg_unexpected_alpha_token_rate": _average_metric(results, "unexpected_alpha_token_rate"),
        "avg_low_quality_page_rate": _average_metric(results, "low_quality_page_rate"),
        "avg_front_matter_page_rate": _average_metric(results, "front_matter_page_rate"),
        "avg_targeted_page_retry_rate": _average_metric(results, "targeted_page_retry_rate"),
        "lowest_word_accuracy_items": _lowest_metric_rows(results, "word_accuracy"),
        "common_unexpected_alpha_tokens": _token_summary_rows(unexpected_alpha_counter),
        "artifact_profile_summary": _artifact_profile_summary(results),
        "page_type_counts": _sorted_counter_dict(page_type_counter),
        "page_quality_tier_counts": _sorted_counter_dict(page_quality_tier_counter),
        "page_route_counts": _sorted_counter_dict(page_route_counter),
        "targeted_page_retry_reason_counts": _sorted_counter_dict(targeted_page_retry_reason_counter),
    }
    report = {
        "corpus_manifest_path": str(corpus_manifest_path),
        "corpus_type": corpus_type or None,
        "metric_note": _metric_note_for_corpus_type(corpus_type),
        "books": results,
        "summary": summary,
    }
    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _emit_benchmark_progress(
        progress_callback,
        _timed_benchmark_progress_payload(
            stage="benchmark-corpus",
            status="complete",
            started_at=started_at,
            completed_items=len(results),
            total_items=len(books),
        ),
    )
    return report


def run_streaming_benchmark_corpus(
    output_report_path: Path,
    work_dir: Path,
    cache_dir: Path,
    **ocr_kwargs: Any,
) -> dict[str, Any]:
    # lizard forgive: streaming benchmark coordinates generation, OCR, cleanup, and failure capture.
    """Benchmark synthetic OCR samples on demand and persist only failure artifacts."""

    timeout_seconds = int(ocr_kwargs.pop("timeout_seconds", 60))
    books = tuple(ocr_kwargs.pop("books", BENCHMARK_BOOKS))
    max_books = ocr_kwargs.pop("max_books", None)
    samples_per_book = int(ocr_kwargs.pop("samples_per_book", 1))
    excerpt_word_count = int(ocr_kwargs.pop("excerpt_word_count", 1200))
    skip_word_count = int(ocr_kwargs.pop("skip_word_count", 250))
    font_path = ocr_kwargs.pop("font_path", None)
    font_size = int(ocr_kwargs.pop("font_size", 32))
    page_width = int(ocr_kwargs.pop("page_width", 1654))
    page_height = int(ocr_kwargs.pop("page_height", 2339))
    margin = int(ocr_kwargs.pop("margin", 150))
    artifact_profiles = _normalize_artifact_profiles(ocr_kwargs.pop("artifact_profiles", ("clean",)))
    artifact_seed = int(ocr_kwargs.pop("artifact_seed", 0))
    failures_dir = Path(str(ocr_kwargs.pop("failures_dir", work_dir / "failures")))
    max_recorded_failures = int(ocr_kwargs.pop("max_recorded_failures", 100))
    failure_word_accuracy_below = float(ocr_kwargs.pop("failure_word_accuracy_below", 1.0))
    failure_char_accuracy_below = float(ocr_kwargs.pop("failure_char_accuracy_below", 1.0))

    if excerpt_word_count <= 0:
        raise ValueError("excerpt_word_count must be greater than 0")
    if skip_word_count < 0:
        raise ValueError("skip_word_count must be zero or greater")
    if samples_per_book <= 0:
        raise ValueError("samples_per_book must be greater than 0")
    if max_recorded_failures < 0:
        raise ValueError("max_recorded_failures must be zero or greater")
    if not 0.0 <= failure_word_accuracy_below <= 1.0:
        raise ValueError("failure_word_accuracy_below must be between 0.0 and 1.0")
    if not 0.0 <= failure_char_accuracy_below <= 1.0:
        raise ValueError("failure_char_accuracy_below must be between 0.0 and 1.0")

    selected_books = books[:max_books] if max_books is not None else books
    if not selected_books:
        raise ValueError("run_streaming_benchmark_corpus requires at least one book")

    progress_callback = ocr_kwargs.get("progress_callback")
    total_samples = len(selected_books) * samples_per_book * len(artifact_profiles)
    started_at = time.monotonic()
    _emit_benchmark_progress(
        progress_callback,
        _timed_benchmark_progress_payload(
            stage="benchmark-streaming-corpus",
            status="running",
            started_at=started_at,
            completed_items=0,
            total_items=total_samples,
        ),
    )
    generated_dir = work_dir / "generated"
    ocr_dir = work_dir / "ocr"
    generated_dir.mkdir(parents=True, exist_ok=True)
    ocr_dir.mkdir(parents=True, exist_ok=True)
    failures_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    recorded_failure_count = 0
    substitution_counter: Counter[tuple[str, str]] = Counter()
    missing_counter: Counter[str] = Counter()
    unexpected_counter: Counter[str] = Counter()
    unexpected_alpha_counter: Counter[str] = Counter()
    page_type_counter: Counter[str] = Counter()
    page_quality_tier_counter: Counter[str] = Counter()
    page_route_counter: Counter[str] = Counter()
    targeted_page_retry_reason_counter: Counter[str] = Counter()
    processed_samples = 0

    for book in selected_books:
        reference_text = _load_reference_text(book, cache_dir, timeout_seconds)
        excerpts = _iter_streaming_excerpts(
            reference_text,
            excerpt_word_count,
            skip_word_count,
            samples_per_book,
        )
        for sample_number, sample_skip_word_count, excerpt_text in excerpts:
            for artifact_profile in artifact_profiles:
                sample_identifier = _streaming_sample_identifier(
                    book.identifier,
                    artifact_profile,
                    sample_number,
                )
                sample_slug = _slugify(sample_identifier)
                sample_dir = generated_dir / sample_slug
                ocr_work_dir = ocr_dir / sample_slug
                output_text_path = ocr_dir / f"{sample_slug}.txt"
                stable_seed = _stable_variant_seed(
                    sample_identifier,
                    artifact_profile,
                    artifact_seed,
                )
                try:
                    page_image_paths, resolved_font_path = _render_page_images(
                        excerpt_text,
                        sample_dir,
                        font_path=font_path,
                        font_size=font_size,
                        page_width=page_width,
                        page_height=page_height,
                        margin=margin,
                        artifact_profile=artifact_profile,
                        artifact_seed=stable_seed,
                    )
                    ocr_result = ocr_page_images(
                        page_images=page_image_paths,
                        output_text_path=output_text_path,
                        work_dir=ocr_work_dir,
                        cleanup_lexicon_texts=(excerpt_text,),
                        **ocr_kwargs,
                    )
                    hypothesis_text = output_text_path.read_text(encoding="utf-8")
                    accuracy = calculate_accuracy_metrics(excerpt_text, hypothesis_text)
                    unexpected_alpha_tokens = _unexpected_alpha_token_counts(excerpt_text, hypothesis_text)
                    unexpected_alpha_token_count = sum(unexpected_alpha_tokens.values())
                    hypothesis_alpha_token_count = max(len(_alpha_tokens(hypothesis_text)), 1)
                    page_analysis = _normalized_page_analysis(ocr_result.get("page_analysis"))
                    unexpected_alpha_counter.update(unexpected_alpha_tokens)
                    page_type_counter.update(page_analysis["page_type_counts"])
                    page_quality_tier_counter.update(page_analysis["page_quality_tier_counts"])
                    page_route_counter.update(page_analysis["page_route_counts"])
                    low_quality_page_count = int(page_analysis["low_quality_page_count"])
                    front_matter_page_count = int(page_analysis["front_matter_page_count"])
                    targeted_page_retry_count = int(page_analysis["targeted_page_retry_count"])
                    targeted_page_retry_reason_counter.update(
                        page_analysis["targeted_page_retry_reason_counts"]
                    )
                    is_failure = (
                        accuracy["word_accuracy"] < failure_word_accuracy_below
                        or accuracy["char_accuracy"] < failure_char_accuracy_below
                    )
                    result: dict[str, Any] = {
                        "identifier": sample_identifier,
                        "source_book_identifier": book.identifier,
                        "title": _streaming_sample_title(book.title, artifact_profile, sample_number),
                        "artifact_profile": artifact_profile,
                        "sample_number": sample_number,
                        "excerpt_skip_word_count": sample_skip_word_count,
                        "reference_word_count": _word_count(excerpt_text),
                        "page_count": ocr_result["page_count"],
                        "word_count": ocr_result["word_count"],
                        "character_count": ocr_result["character_count"],
                        "cer": accuracy["cer"],
                        "wer": accuracy["wer"],
                        "char_accuracy": accuracy["char_accuracy"],
                        "word_accuracy": accuracy["word_accuracy"],
                        "unexpected_alpha_token_count": unexpected_alpha_token_count,
                        "unexpected_alpha_token_rate": unexpected_alpha_token_count
                        / hypothesis_alpha_token_count,
                        "unexpected_alpha_tokens": _token_summary_rows(unexpected_alpha_tokens),
                        "mode_usage": ocr_result.get("mode_usage", {}),
                        "tesseract_psm_usage": ocr_result.get("tesseract_psm_usage", {}),
                        "page_analysis": page_analysis,
                        "low_quality_page_count": low_quality_page_count,
                        "low_quality_page_rate": low_quality_page_count / max(int(ocr_result["page_count"]), 1),
                        "front_matter_page_count": front_matter_page_count,
                        "front_matter_page_rate": front_matter_page_count
                        / max(int(ocr_result["page_count"]), 1),
                        "targeted_page_retry_count": targeted_page_retry_count,
                        "targeted_page_retry_rate": targeted_page_retry_count
                        / max(int(ocr_result["page_count"]), 1),
                        "font_path": resolved_font_path,
                        "failure": is_failure,
                        "failure_artifact_dir": None,
                    }
                    if is_failure:
                        _update_token_failure_counters(
                            excerpt_text,
                            hypothesis_text,
                            substitution_counter=substitution_counter,
                            missing_counter=missing_counter,
                            unexpected_counter=unexpected_counter,
                        )
                        if recorded_failure_count < max_recorded_failures:
                            failure_artifact_dir = failures_dir / sample_slug
                            failure_metadata = dict(result)
                            failure_metadata["ocr_output_path"] = "hypothesis.txt"
                            failure_metadata["reference_text_path"] = "reference.txt"
                            _record_streaming_failure_artifacts(
                                sample_dir=sample_dir,
                                ocr_work_dir=ocr_work_dir,
                                failure_dir=failure_artifact_dir,
                                reference_text=excerpt_text,
                                hypothesis_text=hypothesis_text,
                                metadata=failure_metadata,
                            )
                            result["failure_artifact_dir"] = str(failure_artifact_dir)
                            recorded_failure_count += 1
                    results.append(result)
                    processed_samples += 1
                    _emit_benchmark_progress(
                        progress_callback,
                        _timed_benchmark_progress_payload(
                            stage="benchmark-streaming-corpus",
                            status="running",
                            started_at=started_at,
                            completed_items=processed_samples,
                            total_items=total_samples,
                            current_identifier=sample_identifier,
                        ),
                    )
                finally:
                    if sample_dir.exists():
                        shutil.rmtree(sample_dir, ignore_errors=True)
                    if ocr_work_dir.exists():
                        shutil.rmtree(ocr_work_dir, ignore_errors=True)
                    if output_text_path.exists():
                        output_text_path.unlink()

    summary: dict[str, Any] = {
        "sample_count": len(results),
        "book_count": len(selected_books),
        "failure_count": sum(1 for result in results if bool(result["failure"])),
        "recorded_failure_count": recorded_failure_count,
        "avg_cer": _average_metric(results, "cer"),
        "avg_wer": _average_metric(results, "wer"),
        "avg_char_accuracy": _average_metric(results, "char_accuracy"),
        "avg_word_accuracy": _average_metric(results, "word_accuracy"),
        "perfect_char_accuracy_rate": _exact_metric_rate(results, "char_accuracy"),
        "perfect_word_accuracy_rate": _exact_metric_rate(results, "word_accuracy"),
        "worst_char_accuracy": _minimum_metric(results, "char_accuracy"),
        "worst_word_accuracy": _minimum_metric(results, "word_accuracy"),
        "avg_unexpected_alpha_token_rate": _average_metric(results, "unexpected_alpha_token_rate"),
        "avg_low_quality_page_rate": _average_metric(results, "low_quality_page_rate"),
        "avg_front_matter_page_rate": _average_metric(results, "front_matter_page_rate"),
        "avg_targeted_page_retry_rate": _average_metric(results, "targeted_page_retry_rate"),
        "lowest_word_accuracy_items": _lowest_metric_rows(results, "word_accuracy"),
        "common_unexpected_alpha_tokens": _token_summary_rows(unexpected_alpha_counter),
        "artifact_profile_summary": _artifact_profile_summary(results),
        "page_type_counts": _sorted_counter_dict(page_type_counter),
        "page_quality_tier_counts": _sorted_counter_dict(page_quality_tier_counter),
        "page_route_counts": _sorted_counter_dict(page_route_counter),
        "targeted_page_retry_reason_counts": _sorted_counter_dict(targeted_page_retry_reason_counter),
        "common_failure_patterns": {
            "substitutions": _substitution_summary_rows(substitution_counter),
            "missing_tokens": _token_summary_rows(missing_counter),
            "unexpected_tokens": _token_summary_rows(unexpected_counter),
        },
    }
    report = {
        "corpus_type": "streaming-generated-public-domain-printed-text",
        "metric_note": _STREAMING_SYNTHETIC_CORPUS_METRIC_NOTE,
        "failures_dir": str(failures_dir),
        "artifact_profiles": list(artifact_profiles),
        "artifact_seed": artifact_seed,
        "samples_per_book": samples_per_book,
        "failure_word_accuracy_below": failure_word_accuracy_below,
        "failure_char_accuracy_below": failure_char_accuracy_below,
        "samples": results,
        "summary": summary,
    }
    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _emit_benchmark_progress(
        progress_callback,
        _timed_benchmark_progress_payload(
            stage="benchmark-streaming-corpus",
            status="complete",
            started_at=started_at,
            completed_items=processed_samples,
            total_items=total_samples,
        ),
    )
    return report


def _require_pdf_path(pdf_path: Path | None, identifier: str) -> Path:
    if pdf_path is None:
        raise ValueError(
            f"corpus entry {identifier!r} did not include page_image_paths or a pdf_path"
        )
    return pdf_path
