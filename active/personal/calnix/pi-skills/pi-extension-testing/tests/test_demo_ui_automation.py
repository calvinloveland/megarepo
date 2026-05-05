from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from demo_ui_automation import build_demo  # type: ignore[import-not-found]


def test_build_demo_generates_expected_artifacts(tmp_path: Path) -> None:
    build_demo(tmp_path)

    baseline = tmp_path / "baseline.png"
    current = tmp_path / "current.png"
    polished = tmp_path / "polished.png"
    regression_diff = tmp_path / "regression-diff.png"
    regression_diff_json = tmp_path / "regression-diff.json"
    polished_diff = tmp_path / "polished-diff.png"
    polished_diff_json = tmp_path / "polished-diff.json"
    readme = tmp_path / "README.md"

    assert baseline.exists()
    assert current.exists()
    assert polished.exists()
    assert regression_diff.exists()
    assert regression_diff_json.exists()
    assert polished_diff.exists()
    assert polished_diff_json.exists()
    assert readme.exists()

    regression_payload = json.loads(regression_diff_json.read_text(encoding="utf-8"))
    polished_payload = json.loads(polished_diff_json.read_text(encoding="utf-8"))
    assert regression_payload["changed_pixels"] > 0
    assert regression_payload["bbox"] is not None
    assert polished_payload["changed_pixels"] > 0
    assert polished_payload["changed_pixels"] < regression_payload["changed_pixels"]
    assert "ui-heuristic-score" in readme.read_text(encoding="utf-8")
    assert "/ui-autopolish" in readme.read_text(encoding="utf-8")
