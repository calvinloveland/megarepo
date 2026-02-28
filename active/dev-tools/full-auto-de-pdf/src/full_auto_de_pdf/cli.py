from __future__ import annotations

import argparse
from pathlib import Path

from .archive_org import build_manifest, write_manifest
from .benchmark import run_archive_benchmark, write_benchmark_report
from .epub import build_epub_from_ocr_file
from .ocr_pipeline import ocr_pdf_with_tesseract


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="full-auto-de-pdf",
        description="Scanned PDF to EPUB conversion toolkit",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    manifest_parser = subparsers.add_parser(
        "manifest", help="Build archive.org starter manifest"
    )
    manifest_parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/archive_manifest.json"),
        help="Path to write starter dataset manifest JSON",
    )
    manifest_parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=30,
        help="archive.org metadata request timeout",
    )
    build_epub_parser = subparsers.add_parser(
        "build-epub", help="Build baseline EPUB from OCR text"
    )
    build_epub_parser.add_argument(
        "--ocr-text",
        type=Path,
        required=True,
        help="Path to OCR text input file",
    )
    build_epub_parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Path to generated EPUB",
    )
    build_epub_parser.add_argument(
        "--metrics-output",
        type=Path,
        help="Optional path to metrics JSON output",
    )
    build_epub_parser.add_argument(
        "--title",
        required=True,
        help="EPUB title",
    )
    build_epub_parser.add_argument(
        "--language",
        default="en",
        help="EPUB language code",
    )
    build_epub_parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup before EPUB generation",
    )
    benchmark_parser = subparsers.add_parser(
        "benchmark-archive", help="Run OCR accuracy benchmark"
    )
    benchmark_parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/benchmark_archive_accuracy.json"),
        help="Path to write benchmark report JSON",
    )
    benchmark_parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("data/cache"),
        help="Cache directory for downloaded source texts",
    )
    benchmark_parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=60,
        help="Network request timeout",
    )
    benchmark_parser.add_argument(
        "--source-mode",
        choices=["djvu", "abbyy", "best"],
        default="djvu",
        help="OCR source policy: strict single-source or oracle best-of-both",
    )
    ocr_pdf_parser = subparsers.add_parser(
        "ocr-pdf", help="Run local PDF OCR using pdftoppm + tesseract"
    )
    ocr_pdf_parser.add_argument("--pdf", type=Path, required=True, help="Input PDF path")
    ocr_pdf_parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output text file path",
    )
    ocr_pdf_parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("data/ocr-work"),
        help="Working directory for intermediate page images",
    )
    ocr_pdf_parser.add_argument(
        "--language",
        default="eng",
        help="Tesseract language code",
    )
    ocr_pdf_parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="Rasterization DPI for pdftoppm",
    )
    ocr_pdf_parser.add_argument(
        "--preprocess-mode",
        choices=["none", "basic", "deskew"],
        default="basic",
        help="Image preprocessing before OCR",
    )
    ocr_pdf_parser.add_argument(
        "--binarize-threshold",
        type=int,
        default=170,
        help="Binarization threshold for basic preprocessing (0-255)",
    )
    ocr_pdf_parser.add_argument(
        "--deskew-max-angle",
        type=float,
        default=3.0,
        help="Maximum absolute deskew angle to search (degrees)",
    )
    ocr_pdf_parser.add_argument(
        "--deskew-angle-step",
        type=float,
        default=0.5,
        help="Deskew angle search step size (degrees)",
    )
    ocr_pdf_parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Disable OCR cleanup after extraction",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "manifest":
        manifest = build_manifest(timeout_seconds=args.timeout_seconds)
        write_manifest(args.output, manifest)
        print(f"Wrote {len(manifest)} books to {args.output}")
        return 0

    if args.command == "build-epub":
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

    if args.command == "benchmark-archive":
        report = run_archive_benchmark(
            cache_dir=args.cache_dir,
            timeout_seconds=args.timeout_seconds,
            source_mode=args.source_mode,
        )
        write_benchmark_report(args.output, report)
        summary = report["summary"]
        avg_char_accuracy = float(
            summary.get("avg_char_accuracy", summary["avg_char_accuracy_proxy"])
        )
        avg_word_accuracy = float(
            summary.get("avg_word_accuracy", summary["avg_word_accuracy_proxy"])
        )
        print(
            "Benchmark accuracy: "
            f"char={avg_char_accuracy:.4f}, "
            f"word={avg_word_accuracy:.4f} "
            f"across {int(summary['book_count'])} books"
        )
        print(f"Report: {args.output}")
        return 0

    if args.command == "ocr-pdf":
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
        )
        print(
            f"OCR complete: {metrics['page_count']} pages, "
            f"{metrics['word_count']} words -> {args.output}"
        )
        return 0

    parser.error(f"{args.command!r} is not implemented yet")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
