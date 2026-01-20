from __future__ import annotations

from wizard_fight.research import design_spell, research_spell, upgrade_spell
from wizard_fight.validators import validate_spell


def test_research_spell_outputs_valid_spec() -> None:
    spec = research_spell("summon a wind monkey")
    assert validate_spell(spec) == []


def test_design_contains_prompt_context() -> None:
    design = design_spell("fiery shield")
    assert "fiery" in design.prompt
    assert design.theme
    assert design.intended_use


def test_upgrade_spell_keeps_valid_schema() -> None:
    spec = research_spell("gravity wave")
    upgraded = upgrade_spell(spec, "gravity wave")
    assert validate_spell(upgraded) == []
