from __future__ import annotations

import json
from pathlib import Path

TIMING_PATH = Path(__file__).resolve().parents[1] / "docs" / "timing_v1.json"


def test_timing_config_ranges() -> None:
    payload = json.loads(TIMING_PATH.read_text(encoding="utf-8"))
    assert 10 <= payload["tick_rate_hz"] <= 60
    assert 0.2 <= payload["cast_time_seconds"] <= 1.5
    assert 4.0 <= payload["research_delay_seconds"] <= 20.0
    assert 1.0 <= payload["mana_regen_per_second"] <= 10.0
    assert 20 <= payload["starting_mana"] <= 150
    assert 80 <= payload["starting_health"] <= 200
