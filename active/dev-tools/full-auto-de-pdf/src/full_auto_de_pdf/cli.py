from __future__ import annotations

import argparse
from pathlib import Path

from .archive_org import build_manifest, write_manifest
from .epub import build_epub_from_ocr_file


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
        )
        print(
            f"Built {args.output} ({metrics['word_count']} words, "
            f"{metrics['paragraph_count']} paragraphs)"
        )
        return 0

    parser.error(f"{args.command!r} is not implemented yet")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
