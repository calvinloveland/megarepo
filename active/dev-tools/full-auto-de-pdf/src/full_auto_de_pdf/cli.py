"""Command-line interface for full-auto-de-pdf."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Callable

from .archive_compare import build_archive_epub_compare_page
from .archive_org import build_manifest, write_manifest
from .benchmark import run_archive_benchmark, run_parallel_text_benchmark, write_benchmark_report
from .benchmark_corpus import (
    build_benchmark_corpus,
    build_image_text_corpus_manifest,
    run_benchmark_corpus,
    run_streaming_benchmark_corpus,
)
from .benchmark_viz import (
    build_local_benchmark_failure_page,
    build_local_benchmark_processing_page,
)
from .epub import build_epub_from_ocr_file
from .epub_eval import evaluate_epub_structure
from .ocr_pipeline import (
    benchmark_local_ocr_against_archive,
    evaluate_ocr_preprocess_modes,
    ocr_pdf_with_tesseract,
)


def _format_duration(seconds: object) -> str:
    if not isinstance(seconds, (int, float)):
        return "estimating"
    total_seconds = max(0, int(round(float(seconds))))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _make_progress_reporter(label: str) -> Callable[[dict[str, object]], None]:
    last_completed_by_stage: dict[str, int] = {}

    def _report(payload: dict[str, object]) -> None:
        stage = str(payload.get("stage", ""))
        status = str(payload.get("status", ""))
        if stage == "archive-compare":
            message = payload.get("message")
            if isinstance(message, str) and message:
                print(f"{label}: {message}", file=sys.stderr, flush=True)
            return
        if stage == "rasterize":
            total_pages = payload.get("total_pages")
            completed_pages = payload.get("completed_pages")
            if isinstance(total_pages, int) and isinstance(completed_pages, int):
                last_completed = last_completed_by_stage.get(stage, -1)
                should_print = (
                    status == "complete"
                    or completed_pages <= 1
                    or completed_pages == total_pages
                    or completed_pages - last_completed >= 25
                )
                if should_print:
                    last_completed_by_stage[stage] = completed_pages
                    if status == "complete":
                        print(
                            f"{label}: Rasterization complete ({completed_pages}/{total_pages} pages, "
                            f"elapsed={_format_duration(payload.get('elapsed_seconds'))})",
                            file=sys.stderr,
                            flush=True,
                        )
                    else:
                        current_page_index = payload.get("current_page_index")
                        current_text = (
                            f", current page={int(current_page_index)}"
                            if isinstance(current_page_index, int)
                            else ""
                        )
                        print(
                            f"{label}: Rasterized {completed_pages}/{total_pages} pages{current_text}, "
                            f"elapsed={_format_duration(payload.get('elapsed_seconds'))}, "
                            f"eta={_format_duration(payload.get('estimated_remaining_seconds'))}",
                            file=sys.stderr,
                            flush=True,
                        )
                return
            message = payload.get("message")
            if isinstance(message, str) and message:
                print(f"{label}: {message}", file=sys.stderr, flush=True)
            return
        if stage != "ocr":
            return
        completed_pages = int(payload.get("completed_pages", 0))
        total_pages = int(payload.get("total_pages", 0))
        current_page_index = payload.get("current_page_index")
        last_completed = last_completed_by_stage.get(stage, -1)
        should_print = (
            status == "complete"
            or completed_pages <= 1
            or completed_pages == total_pages
            or completed_pages - last_completed >= 10
        )
        if not should_print:
            return
        last_completed_by_stage[stage] = completed_pages
        if status == "complete":
            print(
                f"{label}: OCR complete ({completed_pages}/{total_pages} pages, "
                f"elapsed={_format_duration(payload.get('elapsed_seconds'))})",
                file=sys.stderr,
                flush=True,
            )
            return
        current_text = (
            f", current page={int(current_page_index)}"
            if isinstance(current_page_index, int)
            else ""
        )
        print(
            f"{label}: OCR {completed_pages}/{total_pages} pages complete{current_text}, "
            f"elapsed={_format_duration(payload.get('elapsed_seconds'))}, "
            f"eta={_format_duration(payload.get('estimated_remaining_seconds'))}",
            file=sys.stderr,
            flush=True,
        )

    return _report


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="full-auto-de-pdf",
        description="Scanned PDF to EPUB conversion toolkit",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for register in (
        _add_manifest_command,
        _add_build_epub_command,
        _add_benchmark_archive_command,
        _add_build_benchmark_corpus_command,
        _add_build_image_text_corpus_command,
        _add_benchmark_corpus_command,
        _add_streaming_benchmark_corpus_command,
        _add_benchmark_parallel_text_command,
        _add_ocr_pdf_command,
        _add_ocr_eval_modes_command,
        _add_benchmark_local_archive_command,
        _add_eval_epub_command,
        _add_failure_page_command,
        _add_processing_page_command,
        _add_archive_epub_compare_page_command,
    ):
        register(subparsers)
    return parser


def _add_manifest_command(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser("manifest", help="Build archive.org starter manifest")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/archive_manifest.json"),
        help="Path to write starter dataset manifest JSON",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=30,
        help="archive.org metadata request timeout",
    )


def _add_build_epub_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser("build-epub", help="Build baseline EPUB from OCR text")
    parser.add_argument(
        "--ocr-text",
        type=Path,
        required=True,
        help="Path to OCR text input file",
    )
    parser.add_argument("--output", type=Path, required=True, help="Path to generated EPUB")
    parser.add_argument(
        "--metrics-output",
        type=Path,
        help="Optional path to metrics JSON output",
    )
    parser.add_argument("--title", required=True, help="EPUB title")
    parser.add_argument("--language", default="en", help="EPUB language code")
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup before EPUB generation",
    )


def _add_benchmark_archive_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser("benchmark-archive", help="Run OCR accuracy benchmark")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/benchmark_archive_accuracy.json"),
        help="Path to write benchmark report JSON",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/cache"),
        help="Cache directory for downloaded source texts",
    )
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Network request timeout")
    parser.add_argument(
        "--source-mode",
        choices=["djvu", "abbyy", "best"],
        default="djvu",
        help="OCR source policy: strict single-source or oracle best-of-both",
    )


def _add_build_benchmark_corpus_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "build-benchmark-corpus",
        help="Build a generated printed-text OCR benchmark corpus from public-domain books",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/benchmark-corpus"),
        help="Directory for generated corpus assets and manifest",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/cache"),
        help="Cache directory for downloaded Gutenberg source texts",
    )
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Network request timeout")
    parser.add_argument(
        "--max-books",
        type=int,
        help="Optional limit on the number of benchmark books to generate",
    )
    parser.add_argument(
        "--excerpt-word-count",
        type=int,
        default=1200,
        help="Approximate words to keep per generated benchmark book",
    )
    parser.add_argument(
        "--skip-word-count",
        type=int,
        default=250,
        help="Words to skip before excerpt extraction to reduce front-matter noise",
    )
    parser.add_argument("--font-path", help="Optional TTF font path for synthetic page rendering")
    parser.add_argument("--font-size", type=int, default=32, help="Synthetic page font size")
    parser.add_argument("--page-width", type=int, default=1654, help="Synthetic page width in px")
    parser.add_argument("--page-height", type=int, default=2339, help="Synthetic page height in px")
    parser.add_argument("--margin", type=int, default=150, help="Synthetic page margin in px")
    parser.add_argument(
        "--artifact-profile",
        action="append",
        choices=["clean", "scan-light", "scan-moderate", "scan-heavy"],
        default=[],
        help="Synthetic scan-artifact profile to generate; may be repeated",
    )
    parser.add_argument(
        "--artifact-seed",
        type=int,
        default=0,
        help="Base seed for deterministic synthetic scan artifacts",
    )


def _add_benchmark_corpus_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "benchmark-corpus",
        help="Run local OCR against a generated corpus manifest",
    )
    parser.add_argument(
        "--corpus-manifest",
        type=Path,
        required=True,
        help="Generated corpus manifest JSON",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/benchmark_corpus_report.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("data/benchmark-corpus-work"),
        help="Working directory for OCR outputs and intermediate files",
    )
    _add_benchmark_ocr_args(parser)


def _add_streaming_benchmark_corpus_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "benchmark-streaming-corpus",
        help="Generate synthetic OCR samples on demand and only persist failures",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/benchmark_streaming_corpus_report.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("data/benchmark-streaming-work"),
        help="Working directory for temporary OCR inputs and intermediate files",
    )
    parser.add_argument(
        "--failures-dir",
        type=Path,
        default=Path("data/benchmark-streaming-failures"),
        help="Directory to keep compact failure artifacts",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/cache"),
        help="Cache directory for downloaded Gutenberg source texts",
    )
    parser.add_argument("--timeout-seconds", type=int, default=60, help="Network request timeout")
    parser.add_argument(
        "--max-books",
        type=int,
        help="Optional limit on the number of benchmark books to sample",
    )
    parser.add_argument(
        "--samples-per-book",
        type=int,
        default=1,
        help="Number of excerpt windows to stream per selected book",
    )
    parser.add_argument(
        "--excerpt-word-count",
        type=int,
        default=1200,
        help="Approximate words to keep per streamed sample",
    )
    parser.add_argument(
        "--skip-word-count",
        type=int,
        default=250,
        help="Words to skip before the first excerpt window",
    )
    parser.add_argument("--font-path", help="Optional TTF font path for synthetic page rendering")
    parser.add_argument("--font-size", type=int, default=32, help="Synthetic page font size")
    parser.add_argument("--page-width", type=int, default=1654, help="Synthetic page width in px")
    parser.add_argument("--page-height", type=int, default=2339, help="Synthetic page height in px")
    parser.add_argument("--margin", type=int, default=150, help="Synthetic page margin in px")
    parser.add_argument(
        "--artifact-profile",
        action="append",
        choices=["clean", "scan-light", "scan-moderate", "scan-heavy"],
        default=[],
        help="Synthetic scan-artifact profile to benchmark; may be repeated",
    )
    parser.add_argument(
        "--artifact-seed",
        type=int,
        default=0,
        help="Base seed for deterministic synthetic scan artifacts",
    )
    parser.add_argument(
        "--max-recorded-failures",
        type=int,
        default=100,
        help="Maximum number of failure cases to persist to failures-dir",
    )
    parser.add_argument(
        "--failure-word-accuracy-below",
        type=float,
        default=1.0,
        help="Persist samples with word accuracy below this threshold",
    )
    parser.add_argument(
        "--failure-char-accuracy-below",
        type=float,
        default=1.0,
        help="Persist samples with character accuracy below this threshold",
    )
    _add_benchmark_ocr_args(parser)


def _add_benchmark_ocr_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--language", default="eng", help="Tesseract language code")
    parser.add_argument("--dpi", type=int, default=300, help="Rasterization DPI for pdftoppm")
    parser.add_argument(
        "--ocr-engine",
        choices=["tesseract", "paddleocr"],
        default="tesseract",
        help="OCR engine backend",
    )
    parser.add_argument(
        "--preprocess-mode",
        choices=["none", "scan", "scan-local-threshold", "basic", "deskew", "dewarp", "auto"],
        default="auto",
        help="Image preprocessing before OCR",
    )
    parser.add_argument(
        "--binarize-threshold",
        type=int,
        default=190,
        help="Binarization threshold (0-255)",
    )
    parser.add_argument(
        "--deskew-max-angle",
        type=float,
        default=3.0,
        help="Maximum absolute deskew angle to search (degrees)",
    )
    parser.add_argument(
        "--deskew-angle-step",
        type=float,
        default=0.5,
        help="Deskew angle search step size (degrees)",
    )
    parser.add_argument(
        "--tesseract-psm",
        default="auto",
        help="Tesseract page segmentation mode (0-13) or 'auto' to try several layouts",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup after extraction",
    )
    parser.add_argument(
        "--no-page-artifacts",
        action="store_true",
        help="Disable per-book per-page OCR artifact text files",
    )
    _add_inverse_render_args(parser)
    _add_cleanup_verifier_args(parser)


def _add_build_image_text_corpus_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "build-image-text-corpus",
        help="Build a benchmark manifest from local page images and ground-truth text files",
    )
    parser.add_argument(
        "--output-manifest",
        type=Path,
        default=Path("data/image_text_corpus_manifest.json"),
        help="Output manifest JSON path",
    )
    parser.add_argument("--images-dir", type=Path, required=True, help="Directory containing page images")
    parser.add_argument("--texts-dir", type=Path, required=True, help="Directory containing ground-truth text files")
    parser.add_argument(
        "--image-glob",
        default="**/*.tif*",
        help="Glob pattern under images-dir for page images",
    )
    parser.add_argument(
        "--text-glob",
        default="**/*.txt",
        help="Glob pattern under texts-dir for ground-truth text files",
    )
    parser.add_argument("--limit", type=int, help="Optional limit on the number of matched pairs")
    parser.add_argument(
        "--title-prefix",
        default="Ground Truth Page",
        help="Title prefix for generated manifest entries",
    )


def _add_inverse_render_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--inverse-render-rerank",
        action="store_true",
        help="Rerank top OCR candidates by re-rendering text and comparing ink overlap",
    )
    parser.add_argument(
        "--inverse-render-top-k",
        type=int,
        default=3,
        help="Top text-scored OCR candidates to inverse-render per page",
    )


def _add_cleanup_verifier_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--verify-cleanup-spans",
        action="store_true",
        help="Opt in to narrow image-verified cleanup checks for short cleanup replacements",
    )


def _add_benchmark_parallel_text_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "benchmark-parallel-text",
        help="Benchmark a local aligned OCR/proofread TSV corpus",
    )
    parser.add_argument("--input", type=Path, required=True, help="Input TSV corpus path")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/parallel_text_benchmark.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--reference-column",
        default="gsent",
        help="TSV column containing reference text",
    )
    parser.add_argument(
        "--hypothesis-column",
        default="hsent",
        help="TSV column containing OCR hypothesis text",
    )
    parser.add_argument(
        "--domain",
        action="append",
        default=[],
        help="Optional domain filter; may be repeated",
    )
    parser.add_argument("--limit", type=int, help="Optional limit on selected TSV rows")
    parser.add_argument(
        "--reference-lexicon-cleanup",
        action="store_true",
        help="Also score oracle-style cleanup using the reference text as a lexicon",
    )


def _add_ocr_pdf_command(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser(
        "ocr-pdf",
        help="Run local PDF OCR using pdftoppm + selectable engine",
    )
    parser.add_argument("--pdf", type=Path, required=True, help="Input PDF path")
    parser.add_argument("--output", type=Path, required=True, help="Output text file path")
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("data/ocr-work"),
        help="Working directory for intermediate page images",
    )
    parser.add_argument("--language", default="eng", help="Tesseract language code")
    parser.add_argument("--dpi", type=int, default=300, help="Rasterization DPI for pdftoppm")
    parser.add_argument(
        "--ocr-engine",
        choices=["tesseract", "paddleocr"],
        default="tesseract",
        help="OCR engine backend",
    )
    parser.add_argument(
        "--preprocess-mode",
        choices=["none", "scan", "scan-local-threshold", "basic", "deskew", "dewarp", "auto"],
        default="auto",
        help="Image preprocessing before OCR (auto tries multiple modes per page)",
    )
    parser.add_argument(
        "--tesseract-psm",
        default="auto",
        help="Tesseract page segmentation mode (0-13) or 'auto' to try several layouts",
    )
    parser.add_argument(
        "--binarize-threshold",
        type=int,
        default=190,
        help="Binarization threshold for scan/basic preprocessing (0-255)",
    )
    parser.add_argument(
        "--deskew-max-angle",
        type=float,
        default=3.0,
        help="Maximum absolute deskew angle to search (degrees)",
    )
    parser.add_argument(
        "--deskew-angle-step",
        type=float,
        default=0.5,
        help="Deskew angle search step size (degrees)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup after extraction",
    )
    parser.add_argument(
        "--no-page-artifacts",
        action="store_true",
        help="Disable per-page OCR artifact text files",
    )
    parser.add_argument(
        "--page-artifacts-dir",
        type=Path,
        help="Optional directory for per-page OCR artifacts",
    )
    _add_inverse_render_args(parser)
    _add_cleanup_verifier_args(parser)


def _add_ocr_eval_modes_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "ocr-eval-modes",
        help="Run OCR across preprocess modes and compare output quality",
    )
    parser.add_argument("--pdf", type=Path, required=True, help="Input PDF path")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/ocr_mode_eval.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("data/ocr-mode-eval"),
        help="Working directory for mode evaluation artifacts",
    )
    parser.add_argument(
        "--reference-text",
        type=Path,
        help="Optional reference text file for CER/WER per mode",
    )
    parser.add_argument("--language", default="eng", help="Tesseract language code")
    parser.add_argument("--dpi", type=int, default=300, help="Rasterization DPI for pdftoppm")
    parser.add_argument(
        "--ocr-engine",
        choices=["tesseract", "paddleocr"],
        default="tesseract",
        help="OCR engine backend",
    )
    parser.add_argument(
        "--binarize-threshold",
        type=int,
        default=190,
        help="Binarization threshold (0-255)",
    )
    parser.add_argument(
        "--deskew-max-angle",
        type=float,
        default=3.0,
        help="Maximum absolute deskew angle to search (degrees)",
    )
    parser.add_argument(
        "--deskew-angle-step",
        type=float,
        default=0.5,
        help="Deskew angle search step size (degrees)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup after extraction",
    )
    parser.add_argument(
        "--tesseract-psm",
        default="auto",
        help="Tesseract page segmentation mode (0-13) or 'auto' to try several layouts",
    )


def _add_benchmark_local_archive_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "benchmark-local-archive",
        help="Benchmark local OCR modes against archive OCR text for an identifier",
    )
    parser.add_argument("--pdf", type=Path, required=True, help="Input PDF path")
    parser.add_argument(
        "--archive-identifier",
        required=True,
        help="Archive.org identifier to use as OCR reference source",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/local_archive_benchmark.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("data/local-archive-benchmark"),
        help="Working directory for intermediate artifacts",
    )
    parser.add_argument(
        "--archive-source-mode",
        choices=["djvu", "abbyy", "best"],
        default="djvu",
        help="Reference OCR source policy",
    )
    parser.add_argument("--language", default="eng", help="Tesseract language code")
    parser.add_argument("--dpi", type=int, default=300, help="Rasterization DPI for pdftoppm")
    parser.add_argument(
        "--ocr-engine",
        choices=["tesseract", "paddleocr"],
        default="tesseract",
        help="OCR engine backend",
    )
    parser.add_argument(
        "--binarize-threshold",
        type=int,
        default=190,
        help="Binarization threshold (0-255)",
    )
    parser.add_argument(
        "--deskew-max-angle",
        type=float,
        default=3.0,
        help="Maximum absolute deskew angle to search (degrees)",
    )
    parser.add_argument(
        "--deskew-angle-step",
        type=float,
        default=0.5,
        help="Deskew angle search step size (degrees)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup after extraction",
    )
    parser.add_argument(
        "--tesseract-psm",
        default="auto",
        help="Tesseract page segmentation mode (0-13) or 'auto' to try several layouts",
    )


def _add_eval_epub_command(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    parser = subparsers.add_parser(
        "eval-epub",
        help="Evaluate EPUB structure metrics and optional epubcheck status",
    )
    parser.add_argument("--epub", type=Path, required=True, help="Input EPUB path")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/epub_eval.json"),
        help="Output JSON report path",
    )
    parser.add_argument(
        "--skip-epubcheck",
        action="store_true",
        help="Skip epubcheck subprocess validation",
    )
    parser.add_argument("--epubcheck-cmd", default="epubcheck", help="epubcheck command name/path")
    parser.add_argument(
        "--reference-headings",
        type=Path,
        help="Optional newline-delimited heading/TOC reference file",
    )


def _add_failure_page_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "benchmark-failures-page",
        help="Render an HTML page showing token failures and source page images",
    )
    parser.add_argument(
        "--report",
        type=Path,
        required=True,
        help="Input benchmark-local-archive or ocr-eval-modes report JSON",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/benchmark_failures.html"),
        help="Output HTML path",
    )
    parser.add_argument(
        "--max-failures",
        type=int,
        default=50,
        help="Maximum token failures to list per mode",
    )
    parser.add_argument(
        "--max-pages-per-token",
        type=int,
        default=3,
        help="Maximum page image cards to show per token",
    )
    parser.add_argument(
        "--max-example-pages",
        type=int,
        default=6,
        help="Maximum representative PDF page examples to show per mode",
    )


def _add_processing_page_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "benchmark-processing-page",
        help="Render an HTML page explaining OCR processing with page examples",
    )
    parser.add_argument(
        "--report",
        type=Path,
        required=True,
        help="Input benchmark-local-archive or ocr-eval-modes report JSON",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/benchmark_processing.html"),
        help="Output HTML path",
    )
    parser.add_argument(
        "--max-example-pages",
        type=int,
        default=4,
        help="Maximum representative PDF page examples to show per mode",
    )


def _add_archive_epub_compare_page_command(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    parser = subparsers.add_parser(
        "archive-epub-compare-page",
        help="Build an HTML page comparing an Internet Archive EPUB with a generated EPUB",
    )
    parser.add_argument(
        "--archive-identifier",
        required=True,
        help="Internet Archive item identifier",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/archive_epub_compare.html"),
        help="Output HTML path",
    )
    parser.add_argument(
        "--archive-source-mode",
        choices=["djvu", "abbyy"],
        default="djvu",
        help="Which Internet Archive OCR text to use when --generated-source=archive-ocr",
    )
    parser.add_argument(
        "--generated-source",
        choices=["local-ocr", "archive-ocr"],
        default="local-ocr",
        help="Build the generated EPUB from local OCR of the archive PDF or from archive OCR text",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=60,
        help="Network request timeout",
    )
    parser.add_argument(
        "--run-epubcheck",
        action="store_true",
        help="Run epubcheck on both EPUBs if available",
    )
    parser.add_argument(
        "--pdf-page",
        type=int,
        help="Prefer a specific PDF page for the initial aligned comparison view",
    )
    parser.add_argument(
        "--language",
        help="Tesseract language code for local OCR (defaults from archive metadata)",
    )
    parser.add_argument("--dpi", type=int, default=300, help="Rasterization DPI for local OCR")
    parser.add_argument(
        "--ocr-engine",
        choices=["tesseract", "paddleocr"],
        default="tesseract",
        help="OCR engine backend for local OCR generation",
    )
    parser.add_argument(
        "--preprocess-mode",
        default="auto",
        help="Preprocess mode for local OCR generation",
    )
    parser.add_argument(
        "--binarize-threshold",
        type=int,
        default=190,
        help="Binarization threshold for local OCR (0-255)",
    )
    parser.add_argument(
        "--deskew-max-angle",
        type=float,
        default=3.0,
        help="Maximum absolute deskew angle to search for local OCR (degrees)",
    )
    parser.add_argument(
        "--deskew-angle-step",
        type=float,
        default=0.5,
        help="Deskew angle search step size for local OCR (degrees)",
    )
    parser.add_argument(
        "--tesseract-psm",
        default="auto",
        help="Tesseract page segmentation mode for local OCR (0-13) or 'auto'",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup before building the generated EPUB",
    )
    parser.add_argument(
        "--no-page-artifacts",
        action="store_true",
        help="Disable per-page local OCR artifacts",
    )
    parser.add_argument(
        "--page-artifacts-dir",
        type=Path,
        help="Optional directory for local OCR page artifacts",
    )
    parser.add_argument(
        "--no-inverse-render-rerank",
        action="store_true",
        help="Disable inverse-render reranking for local OCR generation",
    )
    parser.add_argument(
        "--inverse-render-top-k",
        type=int,
        default=3,
        help="Top text-scored OCR candidates to inverse-render per page",
    )
    parser.add_argument(
        "--no-verify-cleanup-spans",
        action="store_true",
        help="Disable image-verified cleanup checks for local OCR generation",
    )


def _handle_manifest(args: argparse.Namespace) -> int:
    manifest = build_manifest(timeout_seconds=args.timeout_seconds)
    write_manifest(args.output, manifest)
    print(f"Wrote {len(manifest)} books to {args.output}")
    return 0


def _handle_build_epub(args: argparse.Namespace) -> int:
    metrics = build_epub_from_ocr_file(
        ocr_text_path=args.ocr_text,
        output_epub_path=args.output,
        metrics_output_path=args.metrics_output,
        title=args.title,
        language=args.language,
        apply_cleanup=not args.no_cleanup,
    )
    print(
        f"Built {args.output} ({metrics['word_count']} words, "
        f"{metrics['paragraph_count']} paragraphs)"
    )
    return 0


def _handle_benchmark_archive(args: argparse.Namespace) -> int:
    report = run_archive_benchmark(
        cache_dir=args.cache_dir,
        timeout_seconds=args.timeout_seconds,
        source_mode=args.source_mode,
    )
    write_benchmark_report(args.output, report)
    summary = report["summary"]
    avg_char_accuracy = float(summary.get("avg_char_accuracy", summary["avg_char_accuracy_proxy"]))
    avg_word_accuracy = float(summary.get("avg_word_accuracy", summary["avg_word_accuracy_proxy"]))
    print(
        "Benchmark accuracy: "
        f"char={avg_char_accuracy:.4f}, "
        f"word={avg_word_accuracy:.4f} "
        f"across {int(summary['book_count'])} books"
    )
    print(f"Report: {args.output}")
    return 0


def _handle_build_benchmark_corpus(args: argparse.Namespace) -> int:
    manifest = build_benchmark_corpus(
        output_dir=args.output_dir,
        cache_dir=args.cache_dir,
        timeout_seconds=args.timeout_seconds,
        max_books=args.max_books,
        excerpt_word_count=args.excerpt_word_count,
        skip_word_count=args.skip_word_count,
        font_path=args.font_path,
        font_size=args.font_size,
        page_width=args.page_width,
        page_height=args.page_height,
        margin=args.margin,
        artifact_profiles=tuple(args.artifact_profile) or ("clean",),
        artifact_seed=args.artifact_seed,
    )
    print(f"Built benchmark corpus: {manifest['book_count']} books -> {args.output_dir / 'manifest.json'}")
    return 0


def _handle_build_image_text_corpus(args: argparse.Namespace) -> int:
    manifest = build_image_text_corpus_manifest(
        output_manifest_path=args.output_manifest,
        images_dir=args.images_dir,
        texts_dir=args.texts_dir,
        image_glob=args.image_glob,
        text_glob=args.text_glob,
        limit=args.limit,
        title_prefix=args.title_prefix,
    )
    print(f"Built image/text corpus: {manifest['book_count']} entries -> {args.output_manifest}")
    return 0


def _handle_benchmark_corpus(args: argparse.Namespace) -> int:
    report = run_benchmark_corpus(
        corpus_manifest_path=args.corpus_manifest,
        output_report_path=args.output,
        work_dir=args.work_dir,
        **_benchmark_ocr_kwargs_from_args(args),
    )
    summary = report["summary"]
    print(
        "Benchmark corpus complete: "
        f"word_accuracy={float(summary['avg_word_accuracy']):.4f}, "
        f"char_accuracy={float(summary['avg_char_accuracy']):.4f} -> {args.output}"
    )
    return 0


def _handle_streaming_benchmark_corpus(args: argparse.Namespace) -> int:
    report = run_streaming_benchmark_corpus(
        output_report_path=args.output,
        work_dir=args.work_dir,
        cache_dir=args.cache_dir,
        timeout_seconds=args.timeout_seconds,
        max_books=args.max_books,
        samples_per_book=args.samples_per_book,
        excerpt_word_count=args.excerpt_word_count,
        skip_word_count=args.skip_word_count,
        font_path=args.font_path,
        font_size=args.font_size,
        page_width=args.page_width,
        page_height=args.page_height,
        margin=args.margin,
        artifact_profiles=tuple(args.artifact_profile) or ("clean",),
        artifact_seed=args.artifact_seed,
        failures_dir=args.failures_dir,
        max_recorded_failures=args.max_recorded_failures,
        failure_word_accuracy_below=args.failure_word_accuracy_below,
        failure_char_accuracy_below=args.failure_char_accuracy_below,
        **_benchmark_ocr_kwargs_from_args(args),
    )
    summary = report["summary"]
    print(
        "Streaming benchmark complete: "
        f"samples={int(summary['sample_count'])}, "
        f"failures={int(summary['failure_count'])}, "
        f"word_accuracy={float(summary['avg_word_accuracy']):.4f}, "
        f"char_accuracy={float(summary['avg_char_accuracy']):.4f} -> {args.output}"
    )
    return 0


def _benchmark_ocr_kwargs_from_args(args: argparse.Namespace) -> dict[str, object]:
    return {
        "language": args.language,
        "dpi": args.dpi,
        "apply_cleanup": not args.no_cleanup,
        "preprocess_mode": args.preprocess_mode,
        "binarize_threshold": args.binarize_threshold,
        "deskew_max_angle": args.deskew_max_angle,
        "deskew_angle_step": args.deskew_angle_step,
        "tesseract_psm": args.tesseract_psm,
        "ocr_engine": args.ocr_engine,
        "emit_page_artifacts": not args.no_page_artifacts,
        "inverse_render_rerank": args.inverse_render_rerank,
        "inverse_render_top_k": args.inverse_render_top_k,
        "verify_cleanup_spans": args.verify_cleanup_spans,
    }


def _handle_benchmark_parallel_text(args: argparse.Namespace) -> int:
    report = run_parallel_text_benchmark(
        corpus_path=args.input,
        output_report_path=args.output,
        reference_column=args.reference_column,
        hypothesis_column=args.hypothesis_column,
        domains=tuple(args.domain),
        row_limit=args.limit,
        include_reference_lexicon_cleanup=args.reference_lexicon_cleanup,
    )
    summary = report["summary"]
    raw_word = float(summary["raw_metrics"]["word_accuracy"])
    cleaned_word = float(summary["cleaned_metrics"]["word_accuracy"])
    print(
        "Parallel-text benchmark complete: "
        f"raw_word_accuracy={raw_word:.4f}, "
        f"cleaned_word_accuracy={cleaned_word:.4f} -> {args.output}"
    )
    return 0


def _handle_ocr_pdf(args: argparse.Namespace) -> int:
    progress_callback = _make_progress_reporter("OCR")
    metrics = ocr_pdf_with_tesseract(
        pdf_path=args.pdf,
        output_text_path=args.output,
        work_dir=args.work_dir,
        language=args.language,
        dpi=args.dpi,
        apply_cleanup=not args.no_cleanup,
        preprocess_mode=args.preprocess_mode,
        binarize_threshold=args.binarize_threshold,
        deskew_max_angle=args.deskew_max_angle,
        deskew_angle_step=args.deskew_angle_step,
        tesseract_psm=args.tesseract_psm,
        ocr_engine=args.ocr_engine,
        emit_page_artifacts=not args.no_page_artifacts,
        page_artifacts_dir=args.page_artifacts_dir,
        inverse_render_rerank=args.inverse_render_rerank,
        inverse_render_top_k=args.inverse_render_top_k,
        verify_cleanup_spans=args.verify_cleanup_spans,
        progress_callback=progress_callback,
    )
    print(
        f"OCR complete: {metrics['page_count']} pages, "
        f"{metrics['word_count']} words -> {args.output}"
    )
    return 0


def _handle_ocr_eval_modes(args: argparse.Namespace) -> int:
    report = evaluate_ocr_preprocess_modes(
        pdf_path=args.pdf,
        work_dir=args.work_dir,
        output_report_path=args.output,
        reference_text_path=args.reference_text,
        language=args.language,
        dpi=args.dpi,
        apply_cleanup=not args.no_cleanup,
        binarize_threshold=args.binarize_threshold,
        deskew_max_angle=args.deskew_max_angle,
        deskew_angle_step=args.deskew_angle_step,
        tesseract_psm=args.tesseract_psm,
        ocr_engine=args.ocr_engine,
    )
    mode_count = len(report.get("modes", {}))
    print(f"OCR mode evaluation complete: {mode_count} modes -> {args.output}")
    return 0


def _handle_benchmark_local_archive(args: argparse.Namespace) -> int:
    report = benchmark_local_ocr_against_archive(
        pdf_path=args.pdf,
        archive_identifier=args.archive_identifier,
        output_report_path=args.output,
        work_dir=args.work_dir,
        archive_source_mode=args.archive_source_mode,
        language=args.language,
        dpi=args.dpi,
        apply_cleanup=not args.no_cleanup,
        binarize_threshold=args.binarize_threshold,
        deskew_max_angle=args.deskew_max_angle,
        deskew_angle_step=args.deskew_angle_step,
        tesseract_psm=args.tesseract_psm,
        ocr_engine=args.ocr_engine,
    )
    print(
        "Local-vs-archive benchmark complete: "
        f"source={report['selected_archive_source']}, "
        f"best_mode={report.get('best_mode')} -> {args.output}"
    )
    return 0


def _handle_eval_epub(args: argparse.Namespace) -> int:
    report = evaluate_epub_structure(
        epub_path=args.epub,
        run_epubcheck=not args.skip_epubcheck,
        epubcheck_cmd=args.epubcheck_cmd,
        reference_headings_path=args.reference_headings,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    structure_score = float(report["metrics"]["structure_score"])
    epubcheck_status = report["epubcheck"]["status"]
    print(
        "EPUB evaluation complete: "
        f"structure_score={structure_score:.3f}, epubcheck={epubcheck_status} -> {args.output}"
    )
    return 0


def _handle_benchmark_failures_page(args: argparse.Namespace) -> int:
    summary = build_local_benchmark_failure_page(
        report_path=args.report,
        output_html_path=args.output,
        max_failures=args.max_failures,
        max_pages_per_token=args.max_pages_per_token,
        max_example_pages=args.max_example_pages,
    )
    print(
        "Benchmark failure page written: "
        f"modes={summary['mode_count']} best_mode={summary['best_mode']} -> {args.output}"
    )
    return 0


def _handle_benchmark_processing_page(args: argparse.Namespace) -> int:
    summary = build_local_benchmark_processing_page(
        report_path=args.report,
        output_html_path=args.output,
        max_example_pages=args.max_example_pages,
    )
    print(
        "Benchmark processing page written: "
        f"modes={summary['mode_count']} best_mode={summary['best_mode']} -> {args.output}"
    )
    return 0


def _handle_archive_epub_compare_page(args: argparse.Namespace) -> int:
    progress_callback = _make_progress_reporter("Archive compare")
    summary = build_archive_epub_compare_page(
        archive_identifier=args.archive_identifier,
        output_html_path=args.output,
        generated_source=args.generated_source,
        archive_source_mode=args.archive_source_mode,
        timeout_seconds=args.timeout_seconds,
        run_epubcheck=args.run_epubcheck,
        selected_pdf_page=args.pdf_page,
        ocr_language=args.language,
        dpi=args.dpi,
        ocr_engine=args.ocr_engine,
        preprocess_mode=args.preprocess_mode,
        binarize_threshold=args.binarize_threshold,
        deskew_max_angle=args.deskew_max_angle,
        deskew_angle_step=args.deskew_angle_step,
        tesseract_psm=args.tesseract_psm,
        apply_cleanup=not args.no_cleanup,
        emit_page_artifacts=not args.no_page_artifacts,
        page_artifacts_dir=args.page_artifacts_dir,
        inverse_render_rerank=not args.no_inverse_render_rerank,
        inverse_render_top_k=args.inverse_render_top_k,
        verify_cleanup_spans=not args.no_verify_cleanup_spans,
        progress_callback=progress_callback,
    )
    print(
        "Archive EPUB compare page written: "
        f"generated_source={summary['generated_source']} "
        f"title={summary['title']} -> {args.output}"
    )
    return 0


_COMMAND_HANDLERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "manifest": _handle_manifest,
    "build-epub": _handle_build_epub,
    "benchmark-archive": _handle_benchmark_archive,
    "build-benchmark-corpus": _handle_build_benchmark_corpus,
    "build-image-text-corpus": _handle_build_image_text_corpus,
    "benchmark-corpus": _handle_benchmark_corpus,
    "benchmark-streaming-corpus": _handle_streaming_benchmark_corpus,
    "benchmark-parallel-text": _handle_benchmark_parallel_text,
    "ocr-pdf": _handle_ocr_pdf,
    "ocr-eval-modes": _handle_ocr_eval_modes,
    "benchmark-local-archive": _handle_benchmark_local_archive,
    "eval-epub": _handle_eval_epub,
    "benchmark-failures-page": _handle_benchmark_failures_page,
    "benchmark-processing-page": _handle_benchmark_processing_page,
    "archive-epub-compare-page": _handle_archive_epub_compare_page,
}


def main(argv: list[str] | None = None) -> int:
    """Run the CLI and return an exit code."""

    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = _COMMAND_HANDLERS.get(args.command)
    if handler is None:
        parser.error(f"{args.command!r} is not implemented yet")
        return 2
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
