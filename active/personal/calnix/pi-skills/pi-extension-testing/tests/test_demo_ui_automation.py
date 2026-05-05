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
    diff = tmp_path / "diff.png"
    diff_json = tmp_path / "diff.json"
    readme = tmp_path / "README.md"

    assert baseline.exists()
    assert current.exists()
    assert diff.exists()
    assert diff_json.exists()
    assert readme.exists()

    payload = json.loads(diff_json.read_text(encoding="utf-8"))
    assert payload["changed_pixels"] > 0
    assert payload["bbox"] is not None
    assert "ui-heuristic-score" in readme.read_text(encoding="utf-8")
    assert "/ui-autopolish" in readme.read_text(encoding="utf-8")
