"""Schema validation tests for bundled sample spell JSON files."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from wizard_fight.validators import validate_spell

REPO_ROOT = Path(__file__).resolve().parents[1]

SPELLS_DIR = REPO_ROOT / "docs" / "spells"


@pytest.mark.parametrize("spell_path", sorted(SPELLS_DIR.glob("*.json")))
def test_sample_spells_validate(spell_path: Path) -> None:
    """All sample spells should satisfy schema constraints."""
    payload = json.loads(spell_path.read_text(encoding="utf-8"))
    errors = validate_spell(payload)
    assert not errors, f"{spell_path.name} errors: {errors}"


def test_invalid_spell_rejected() -> None:
    """Invalid spell should produce at least one validation error."""
    spell = {
        "name": "Overdraw",
        "school": "Chaos",
        "mana_cost": 999,
        "cooldown": 0,
        "duration": 0,
    }
    errors = validate_spell(spell)
    assert errors, "expected validation errors for excessive mana_cost"
