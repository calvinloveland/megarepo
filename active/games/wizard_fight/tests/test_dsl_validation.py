from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_ROOT))

from wizard_fight.validators import validate_spell

SPELLS_DIR = REPO_ROOT / "docs" / "spells"


@pytest.mark.parametrize("spell_path", sorted(SPELLS_DIR.glob("*.json")))
def test_sample_spells_validate(spell_path: Path) -> None:
    payload = json.loads(spell_path.read_text(encoding="utf-8"))
    errors = validate_spell(payload)
    assert errors == [], f"{spell_path.name} errors: {errors}"


def test_invalid_spell_rejected() -> None:
    spell = {
        "name": "Overdraw",
        "school": "Chaos",
        "mana_cost": 999,
        "cooldown": 0,
        "duration": 0,
    }
    errors = validate_spell(spell)
    assert errors, "expected validation errors for excessive mana_cost"
