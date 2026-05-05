from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from compare_pi_screenshots import compare_images, save_diff_report  # type: ignore[import-not-found]


def write_image(path: Path, color: tuple[int, int, int, int], size: tuple[int, int] = (4, 4)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", size, color).save(path)


def test_compare_images_reports_zero_diff_for_identical_images(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.png"
    current = tmp_path / "current.png"
    diff = tmp_path / "diff.png"
    write_image(baseline, (255, 0, 0, 255))
    write_image(current, (255, 0, 0, 255))

    stats = compare_images(baseline, current, diff)

    assert diff.exists()
    assert stats.changed_pixels == 0
    assert stats.changed_ratio == 0.0
    assert stats.bbox is None


def test_compare_images_reports_changed_pixels_and_bbox(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.png"
    current = tmp_path / "current.png"
    diff = tmp_path / "diff.png"
    write_image(baseline, (0, 0, 0, 255))
    write_image(current, (0, 0, 0, 255))

    image = Image.open(current).convert("RGBA")
    image.putpixel((1, 2), (255, 255, 255, 255))
    image.save(current)

    stats = compare_images(baseline, current, diff)

    assert stats.changed_pixels == 1
    assert stats.bbox == {"left": 1, "top": 2, "right": 2, "bottom": 3}
    assert stats.changed_ratio > 0


def test_save_diff_report_writes_json(tmp_path: Path) -> None:
    baseline = tmp_path / "baseline.png"
    current = tmp_path / "current.png"
    diff = tmp_path / "diff.png"
    report = tmp_path / "diff.json"
    write_image(baseline, (10, 20, 30, 255))
    write_image(current, (10, 20, 30, 255), size=(6, 4))

    stats = compare_images(baseline, current, diff)
    save_diff_report(stats, report)
    payload = json.loads(report.read_text(encoding="utf-8"))

    assert payload["baseline_size"] == {"width": 4, "height": 4}
    assert payload["current_size"] == {"width": 6, "height": 4}
    assert payload["width"] == 6
    assert payload["height"] == 4
