from __future__ import annotations

import argparse
from pathlib import Path

from .archive_org import build_manifest, write_manifest


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
    subparsers.add_parser("build-epub", help="Build baseline EPUB from OCR text")
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    if args.command == "manifest":
        manifest = build_manifest(timeout_seconds=args.timeout_seconds)
        write_manifest(args.output, manifest)
        print(f"Wrote {len(manifest)} books to {args.output}")
        return 0

    parser.error(f"{args.command!r} is not implemented yet")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
