from __future__ import annotations

from pathlib import Path

from wizard_fight.storage import list_spells, load_spell, save_spell


def test_save_and_load_spell(tmp_path: Path) -> None:
    db_path = tmp_path / "wizard_fight.db"
    spell_id = save_spell(
        name="Arcane Sample",
        prompt="arcane sample",
        design={"theme": "Arcane"},
        spec={"name": "Arcane Sample", "mana_cost": 10},
        path=db_path,
    )

    loaded = load_spell(spell_id, path=db_path)
    assert loaded is not None
    assert loaded.name == "Arcane Sample"
    assert loaded.design["theme"] == "Arcane"


def test_list_spells_returns_latest(tmp_path: Path) -> None:
    db_path = tmp_path / "wizard_fight.db"
    save_spell(
        name="First",
        prompt="first",
        design={"theme": "First"},
        spec={"name": "First", "mana_cost": 10},
        path=db_path,
    )
    save_spell(
        name="Second",
        prompt="second",
        design={"theme": "Second"},
        spec={"name": "Second", "mana_cost": 10},
        path=db_path,
    )
    spells = list_spells(limit=5, path=db_path)
    assert spells[0].name == "Second"
