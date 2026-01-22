from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class StoredSpell:
    spell_id: int
    name: str
    prompt: str
    design: Dict[str, Any]
    spec: Dict[str, Any]


def default_db_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "wizard_fight.db"


def init_db(path: Path | None = None) -> None:
    db_path = path or default_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS spells (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                design_json TEXT NOT NULL,
                spec_json TEXT NOT NULL
            )
            """
        )
        conn.commit()


def save_spell(
    name: str,
    prompt: str,
    design: Dict[str, Any],
    spec: Dict[str, Any],
    path: Path | None = None,
) -> int:
    db_path = path or default_db_path()
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            "INSERT INTO spells (name, prompt, design_json, spec_json) VALUES (?, ?, ?, ?)",
            (name, prompt, json.dumps(design), json.dumps(spec)),
        )
        conn.commit()
        return int(cursor.lastrowid)


def load_spell(spell_id: int, path: Path | None = None) -> Optional[StoredSpell]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name, prompt, design_json, spec_json FROM spells WHERE id = ?",
            (spell_id,),
        ).fetchone()
    if row is None:
        return None
    design = json.loads(row[3])
    spec = json.loads(row[4])
    return StoredSpell(spell_id=row[0], name=row[1], prompt=row[2], design=design, spec=spec)


def load_spell_by_prompt(prompt: str, path: Path | None = None) -> Optional[StoredSpell]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    normalized = prompt.strip().lower()
    if not normalized:
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, name, prompt, design_json, spec_json FROM spells WHERE LOWER(prompt) = ? ORDER BY id DESC LIMIT 1",
            (normalized,),
        ).fetchone()
    if row is None:
        return None
    design = json.loads(row[3])
    spec = json.loads(row[4])
    return StoredSpell(spell_id=row[0], name=row[1], prompt=row[2], design=design, spec=spec)


def list_spells(limit: int = 50, path: Path | None = None) -> List[StoredSpell]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, name, prompt, design_json, spec_json FROM spells ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    spells: List[StoredSpell] = []
    for row in rows:
        design = json.loads(row[3])
        spec = json.loads(row[4])
        spells.append(
            StoredSpell(spell_id=row[0], name=row[1], prompt=row[2], design=design, spec=spec)
        )
    return spells


def list_spell_leaderboard(limit: int = 10, path: Path | None = None) -> List[Tuple[str, int]]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT name, COUNT(*) as count FROM spells GROUP BY name ORDER BY count DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [(row[0], int(row[1])) for row in rows]
