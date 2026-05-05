#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops


@dataclass(frozen=True)
class DiffStats:
    baseline_path: str
    current_path: str
    diff_path: str
    width: int
    height: int
    changed_pixels: int
    changed_ratio: float
    bbox: dict[str, int] | None
    baseline_size: dict[str, int]
    current_size: dict[str, int]


def _load_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def _pad_to_common_canvas(image: Image.Image, width: int, height: int) -> Image.Image:
    if image.size == (width, height):
        return image
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.paste(image, (0, 0))
    return canvas


def compare_images(baseline_path: Path, current_path: Path, diff_path: Path) -> DiffStats:
    baseline = _load_rgba(baseline_path)
    current = _load_rgba(current_path)
    width = max(baseline.width, current.width)
    height = max(baseline.height, current.height)
    baseline_canvas = _pad_to_common_canvas(baseline, width, height)
    current_canvas = _pad_to_common_canvas(current, width, height)

    diff = ImageChops.difference(baseline_canvas, current_canvas)
    diff_path.parent.mkdir(parents=True, exist_ok=True)
    diff.save(diff_path)

    rgb_diff = diff.convert("RGB")
    bbox_tuple = rgb_diff.getbbox()
    bbox = None
    changed_pixels = 0
    if bbox_tuple is not None:
        left, top, right, bottom = bbox_tuple
        bbox = {"left": left, "top": top, "right": right, "bottom": bottom}
        pixels = rgb_diff.load()
        changed_pixels = sum(
            1
            for y in range(rgb_diff.height)
            for x in range(rgb_diff.width)
            if pixels[x, y] != (0, 0, 0)
        )
    total_pixels = width * height if width and height else 0
    changed_ratio = (changed_pixels / total_pixels) if total_pixels else 0.0

    return DiffStats(
        baseline_path=str(baseline_path),
        current_path=str(current_path),
        diff_path=str(diff_path),
        width=width,
        height=height,
        changed_pixels=changed_pixels,
        changed_ratio=changed_ratio,
        bbox=bbox,
        baseline_size={"width": baseline.width, "height": baseline.height},
        current_size={"width": current.width, "height": current.height},
    )


def save_diff_report(stats: DiffStats, json_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(asdict(stats), indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare two Pi screenshots and write a diff image plus JSON stats")
    parser.add_argument("baseline", help="Baseline screenshot path")
    parser.add_argument("current", help="Current screenshot path")
    parser.add_argument("--output-dir", default="artifacts/ui-regression", help="Directory for diff.png and diff.json")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).expanduser().resolve()
    diff_path = output_dir / "diff.png"
    json_path = output_dir / "diff.json"
    stats = compare_images(Path(args.baseline).expanduser().resolve(), Path(args.current).expanduser().resolve(), diff_path)
    save_diff_report(stats, json_path)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
