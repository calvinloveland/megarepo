"""SQLite persistence for Gamebase.

A single file holds players, published games and versions, scores,
achievements, matchmaking tickets, and matches. We use the standard library
``sqlite3`` module directly — the schema is small and a full ORM would add
more indirection than it removes.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    is_guest INTEGER NOT NULL DEFAULT 1,
    recovery_secret TEXT,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_recovery ON players (recovery_secret);

CREATE TABLE IF NOT EXISTS player_states (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    schema_version INTEGER NOT NULL DEFAULT 1,
    data BLOB NOT NULL,
    raw_bytes INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, slug)
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    current_version TEXT NOT NULL,
    entry TEXT NOT NULL DEFAULT 'index.html',
    tags TEXT NOT NULL DEFAULT '[]',
    thumbnail TEXT,
    remix_of TEXT,
    capabilities TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
    version TEXT NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    manifest TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE (slug, version)
);

CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_slug_score ON scores (slug, score);
CREATE INDEX IF NOT EXISTS idx_scores_player ON scores (player_id);

CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '🏆',
    points INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    criteria TEXT NOT NULL DEFAULT '{}',
    UNIQUE (slug, achievement_id)
);

CREATE TABLE IF NOT EXISTS player_achievements (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (player_id, slug, achievement_id)
);

CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    match_id TEXT,
    created_at TEXT NOT NULL,
    matched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_slug_status ON tickets (slug, status);

CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    players TEXT NOT NULL DEFAULT '[]',
    result TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remixes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_slug TEXT NOT NULL,
    child_slug TEXT NOT NULL,
    player_id TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_remixes_parent ON remixes (parent_slug);
"""


def connect(database_path: Path | str) -> sqlite3.Connection:
    """Open a connection with sensible defaults for the platform."""
    path = str(database_path)
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(connection: sqlite3.Connection) -> None:
    """Create tables and indexes. Safe to run on every startup."""
    connection.executescript(SCHEMA)
    _migrate(connection)
    connection.commit()


def _migrate(connection: sqlite3.Connection) -> None:
    """Add columns introduced after a database was first created."""
    columns = {row[1] for row in connection.execute("PRAGMA table_info(players)")}
    if "recovery_secret" not in columns:
        connection.execute("ALTER TABLE players ADD COLUMN recovery_secret TEXT")
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_players_recovery ON players (recovery_secret)"
        )


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]
