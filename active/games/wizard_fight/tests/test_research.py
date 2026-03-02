"""Research pipeline tests for spell design and upgrades."""

from __future__ import annotations

from wizard_fight.research import design_spell, research_spell, upgrade_spell
from wizard_fight.validators import validate_spell


def test_research_spell_outputs_valid_spec() -> None:
    """Research output should pass validation."""
    spec = research_spell("summon a wind monkey")
    assert not validate_spell(spec)


def test_design_contains_prompt_context() -> None:
    """Designed spell metadata should be populated."""
    design = design_spell("fiery shield")
    assert design.name
    assert design.description


def test_upgrade_spell_keeps_valid_schema() -> None:
    """Upgraded spell should stay schema-valid."""
    spec = research_spell("gravity wave")
    upgraded = upgrade_spell(spec, "gravity wave")
    assert not validate_spell(upgraded)
