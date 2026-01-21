from __future__ import annotations

from pathlib import Path

from wizard_fight.storage import list_spell_leaderboard, list_spells, load_spell, save_spell


def test_save_and_load_spell(tmp_path: Path) -> None:
    db_path = tmp_path / "wizard_fight.db"
    spell_id = save_spell(
        name="Arcane Sample",
        prompt="arcane sample",
        design={"name": "Arcane Sample", "description": "Arcane practice spell."},
        spec={"name": "Arcane Sample", "mana_cost": 10, "emoji": "✨"},
        path=db_path,
    )

    loaded = load_spell(spell_id, path=db_path)
    assert loaded is not None
    assert loaded.name == "Arcane Sample"
    assert loaded.design["description"] == "Arcane practice spell."


def test_list_spells_returns_latest(tmp_path: Path) -> None:
    db_path = tmp_path / "wizard_fight.db"
    save_spell(
        name="First",
        prompt="first",
        design={"name": "First", "description": "First spell."},
        spec={"name": "First", "mana_cost": 10, "emoji": "🔮"},
        path=db_path,
    )
    save_spell(
        name="Second",
        prompt="second",
        design={"name": "Second", "description": "Second spell."},
        spec={"name": "Second", "mana_cost": 10, "emoji": "🔮"},
        path=db_path,
    )
    spells = list_spells(limit=5, path=db_path)
    assert spells[0].name == "Second"


def test_leaderboard_counts_spells(tmp_path: Path) -> None:
    db_path = tmp_path / "wizard_fight.db"
    save_spell(
        name="Spark",
        prompt="spark",
        design={"name": "Spark", "description": "Spark spell."},
        spec={"name": "Spark", "mana_cost": 10, "emoji": "⚡"},
        path=db_path,
    )
    save_spell(
        name="Spark",
        prompt="spark",
        design={"name": "Spark", "description": "Spark spell."},
        spec={"name": "Spark", "mana_cost": 10, "emoji": "⚡"},
        path=db_path,
    )
    save_spell(
        name="Frost",
        prompt="frost",
        design={"name": "Frost", "description": "Frost spell."},
        spec={"name": "Frost", "mana_cost": 10, "emoji": "❄️"},
        path=db_path,
    )
    leaderboard = list_spell_leaderboard(limit=5, path=db_path)
    assert leaderboard[0] == ("Spark", 2)
