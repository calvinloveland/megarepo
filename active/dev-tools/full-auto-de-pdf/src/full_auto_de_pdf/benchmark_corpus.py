"""Benchmark corpus generation and evaluation helpers."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Callable

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = None
    ImageDraw = None
    ImageFont = None

from .benchmark import BENCHMARK_BOOKS, BenchmarkBook, calculate_accuracy_metrics
from .benchmark import fetch_gutenberg_text, strip_gutenberg_boilerplate
from .ocr_pipeline import ocr_page_images, ocr_pdf_with_tesseract

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
_WORD_RE = re.compile(r"\S+")
_PNG_DPI = (300, 300)


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


def _load_or_fetch_text(path: Path, fetcher: Callable[[], str]) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8")
    text = fetcher()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def _load_reference_text(book: BenchmarkBook, cache_dir: Path, timeout_seconds: int) -> str:
    cached_path = _gutenberg_cache_path(cache_dir, book)
    raw_text = _load_or_fetch_text(
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


def _render_page_images(
    excerpt_text: str,
    output_dir: Path,
    *,
    font_path: str | None,
    font_size: int,
    page_width: int,
    page_height: int,
    margin: int,
) -> tuple[list[Path], str]:
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
                page_paths.append(_save_page_image(_ocr_ready_image(page_image), page_number, pages_dir))
                page_number += 1
                page_image = Image.new("L", (page_width, page_height), color=255)
                draw = ImageDraw.Draw(page_image)
                y = margin
            draw.text((margin, y), line, font=font, fill=0)
            y += line_height
        y += line_height

    page_paths.append(_save_page_image(_ocr_ready_image(page_image), page_number, pages_dir))
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
) -> dict[str, Any]:
    """Build a local synthetic printed-text OCR benchmark corpus."""

    if excerpt_word_count <= 0:
        raise ValueError("excerpt_word_count must be greater than 0")
    if skip_word_count < 0:
        raise ValueError("skip_word_count must be zero or greater")
    selected_books = books[:max_books] if max_books is not None else books
    if not selected_books:
        raise ValueError("build_benchmark_corpus requires at least one book")

    built_books: list[CorpusBook] = []
    for book in selected_books:
        reference_text = _load_reference_text(book, cache_dir, timeout_seconds)
        excerpt_text = _extract_excerpt(reference_text, excerpt_word_count, skip_word_count)
        book_dir = output_dir / _slugify(book.identifier)
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
        )
        _write_pdf(page_image_paths, pdf_path)
        built_books.append(
            CorpusBook(
                book=book,
                reference_text=excerpt_text,
                excerpt_text=excerpt_text,
                pdf_path=pdf_path,
                reference_text_path=reference_text_path,
                excerpt_text_path=excerpt_text_path,
                page_image_paths=tuple(page_image_paths),
                font_path=resolved_font_path,
            )
        )

    manifest = {
        "corpus_type": "generated-public-domain-printed-text",
        "description": (
            "Synthetic printed-text benchmark corpus generated from Project Gutenberg "
            "reference texts rendered into reproducible PDFs."
        ),
        "recommended_external_corpus": _EXTERNAL_CORPUS_NOTE,
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


def run_benchmark_corpus(
    corpus_manifest_path: Path,
    output_report_path: Path,
    work_dir: Path,
    **ocr_kwargs: Any,
) -> dict[str, Any]:
    """Run local OCR against a generated corpus manifest."""

    payload = json.loads(corpus_manifest_path.read_text(encoding="utf-8"))
    books = payload.get("books", [])
    if not isinstance(books, list) or not books:
        raise ValueError("corpus manifest did not include any books")

    results: list[dict[str, Any]] = []
    for book in books:
        if not isinstance(book, dict):
            continue
        identifier = str(book["identifier"])
        title = str(book["title"])
        pdf_path = Path(str(book["pdf_path"]))
        reference_text_path = Path(str(book["reference_text_path"]))
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
                **ocr_kwargs,
            )
            if page_image_paths
            else ocr_pdf_with_tesseract(
                pdf_path=pdf_path,
                output_text_path=output_text_path,
                work_dir=work_dir / _slugify(identifier),
                **ocr_kwargs,
            )
        )
        reference_text = reference_text_path.read_text(encoding="utf-8")
        hypothesis_text = output_text_path.read_text(encoding="utf-8")
        accuracy = calculate_accuracy_metrics(reference_text, hypothesis_text)
        results.append(
            {
                "identifier": identifier,
                "title": title,
                "pdf_path": str(pdf_path),
                "reference_text_path": str(reference_text_path),
                "ocr_output_path": str(output_text_path),
                "page_count": ocr_result["page_count"],
                "word_count": ocr_result["word_count"],
                "character_count": ocr_result["character_count"],
                "cer": accuracy["cer"],
                "wer": accuracy["wer"],
                "char_accuracy": accuracy["char_accuracy"],
                "word_accuracy": accuracy["word_accuracy"],
                "mode_usage": ocr_result.get("mode_usage", {}),
                "tesseract_psm_usage": ocr_result.get("tesseract_psm_usage", {}),
            }
        )

    summary = {
        "book_count": len(results),
        "avg_cer": _average_metric(results, "cer"),
        "avg_wer": _average_metric(results, "wer"),
        "avg_char_accuracy": _average_metric(results, "char_accuracy"),
        "avg_word_accuracy": _average_metric(results, "word_accuracy"),
    }
    report = {
        "corpus_manifest_path": str(corpus_manifest_path),
        "metric_note": (
            "This benchmark uses synthetic printed PDFs rendered from clean public-domain "
            "reference text. It is useful for measuring OCR engine and cleanup quality on "
            "clean printed pages, but it is easier than real scanned-book evaluation."
        ),
        "books": results,
        "summary": summary,
    }
    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report
