from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from ui_regression_loop import run_regression_loop  # type: ignore[import-not-found]


def write_image(path: Path, color: tuple[int, int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (4, 4), color).save(path)


def test_run_regression_loop_creates_baseline_when_missing(tmp_path: Path) -> None:
    def fake_capture(output_path: Path, **_: object) -> None:
        write_image(output_path, (10, 10, 10, 255))

    result = run_regression_loop(output_dir=tmp_path, capture_runner=fake_capture, judge_runner=None)

    assert result.status == "baseline-created"
    assert (tmp_path / "baseline.png").exists()
    assert (tmp_path / "report.md").read_text(encoding="utf-8").find("Baseline created") != -1


def test_run_regression_loop_compares_current_image_and_includes_judge_output(tmp_path: Path) -> None:
    write_image(tmp_path / "baseline.png", (0, 0, 0, 255))

    def fake_capture(output_path: Path, **_: object) -> None:
        write_image(output_path, (255, 255, 255, 255))

    def fake_judge(baseline: Path, current: Path, diff: Path, diff_json: Path, subject: str) -> str:
        payload = json.loads(diff_json.read_text(encoding="utf-8"))
        assert baseline.name == "baseline.png"
        assert current.name == "current.png"
        assert diff.name == "diff.png"
        assert subject == "Pi UI regression review"
        return f"Overall score: 72\nChanged pixels: {payload['changed_pixels']}"

    result = run_regression_loop(output_dir=tmp_path, capture_runner=fake_capture, judge_runner=fake_judge)

    assert result.status == "compared"
    assert result.diff_stats is not None
    assert result.diff_stats.changed_pixels == 16
    assert (tmp_path / "diff.png").exists()
    assert (tmp_path / "diff.json").exists()
    report = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "Overall score: 72" in report
    assert "Changed pixels" in report
