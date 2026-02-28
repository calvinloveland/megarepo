from __future__ import annotations

import argparse


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="full-auto-de-pdf",
        description="Scanned PDF to EPUB conversion toolkit",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("manifest", help="Build archive.org starter manifest")
    subparsers.add_parser("build-epub", help="Build baseline EPUB from OCR text")
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    parser.error(f"{args.command!r} is not implemented yet")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
