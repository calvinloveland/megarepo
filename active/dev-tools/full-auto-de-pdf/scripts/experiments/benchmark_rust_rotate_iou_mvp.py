#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path

from full_auto_de_pdf.rust_mvp import benchmark_rust_rotate_iou_mvp


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark a Rust rewrite of inverse-render rotation plus bitmap comparison.",
    )
    parser.add_argument("--rust-binary", type=Path, required=True, help="Path to compiled Rust benchmark binary")
    parser.add_argument("--draw-repeats", type=int, default=8, help="Repeats for draw-only timing")
    parser.add_argument("--compare-repeats", type=int, default=20, help="Repeats for Python and Rust rotate+compare timing")
    parser.add_argument("--current-repeats", type=int, default=8, help="Repeats for current end-to-end scorer timing")
    parser.add_argument("--output", type=Path, help="Optional JSON output path")
    args = parser.parse_args()

    result = benchmark_rust_rotate_iou_mvp(
        args.rust_binary,
        draw_repeats=args.draw_repeats,
        compare_repeats=args.compare_repeats,
        current_repeats=args.current_repeats,
    )
    output_text = json.dumps(result, indent=2, sort_keys=True)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output_text + "\n", encoding="utf-8")
    print(output_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
