from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .bots import PrototypeBot
from .models import CardDefinition, CardKind, MatchResult, PassiveAbility


@dataclass(frozen=True)
class StoredMatch:
    match_id: int
    seed: int
    generator: str
    left_player: str
    right_player: str
    winner_id: str | None
    rounds_played: int
    reason: str
    generated_cards: int
    event_log: list[str]


@dataclass(frozen=True)
class StoredDeck:
    deck_id: int
    owner_id: str
    name: str
    base_card_id: str
    card_ids: list[str]
    is_active: bool


@dataclass(frozen=True)
class StoredLiveMatch:
    match_id: int
    mode: str
    status: str
    seed: int
    generator: str
    left_player: str
    right_player: str
    state: dict[str, Any]


@dataclass(frozen=True)
class StoredProfile:
    player_id: str
    display_name: str
    persona: str
    preferred_generator: str


@dataclass(frozen=True)
class StoredMatchmakingEntry:
    player_id: str
    preferred_generator: str


def default_db_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "sutcg.sqlite3"


def init_db(path: Path | None = None) -> None:
    db_path = path or default_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cards (
                card_id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                card_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seed INTEGER NOT NULL,
                generator TEXT NOT NULL,
                left_player TEXT NOT NULL,
                right_player TEXT NOT NULL,
                winner_id TEXT,
                rounds_played INTEGER NOT NULL,
                reason TEXT NOT NULL,
                generated_cards INTEGER NOT NULL,
                event_log_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS decks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id TEXT NOT NULL,
                name TEXT NOT NULL,
                base_card_id TEXT NOT NULL,
                card_ids_json TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS live_matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                seed INTEGER NOT NULL,
                generator TEXT NOT NULL,
                left_player TEXT NOT NULL,
                right_player TEXT NOT NULL,
                state_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                player_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                persona TEXT NOT NULL,
                preferred_generator TEXT NOT NULL DEFAULT 'openrouter'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS matchmaking_queue (
                player_id TEXT PRIMARY KEY,
                preferred_generator TEXT NOT NULL
            )
            """
        )
        profile_columns = {row[1] for row in conn.execute("PRAGMA table_info(profiles)").fetchall()}
        if "preferred_generator" not in profile_columns:
            conn.execute("ALTER TABLE profiles ADD COLUMN preferred_generator TEXT NOT NULL DEFAULT 'openrouter'")
        conn.commit()


def card_to_payload(card: CardDefinition) -> dict[str, Any]:
    return {
        "card_id": card.card_id,
        "name": card.name,
        "theme": card.theme,
        "prompt": card.prompt,
        "owner_id": card.owner_id,
        "kind": card.kind.value,
        "hp": card.hp,
        "attack": card.attack,
        "cpc": card.cpc,
        "speed": card.speed,
        "attack_range": card.attack_range,
        "income": card.income,
        "keywords": list(card.keywords),
        "role_tags": list(card.role_tags),
        "passive": {
            "type": card.passive.type,
            "magnitude": card.passive.magnitude,
            "text": card.passive.text,
        },
        "ability_summary": card.ability_summary,
        "ability_script": card.ability_script,
    }


def card_from_payload(payload: dict[str, Any]) -> CardDefinition:
    passive_payload = payload["passive"]
    return CardDefinition(
        card_id=str(payload["card_id"]),
        name=str(payload["name"]),
        theme=str(payload["theme"]),
        prompt=str(payload["prompt"]),
        owner_id=str(payload["owner_id"]),
        kind=CardKind(str(payload["kind"])),
        hp=int(payload["hp"]),
        attack=int(payload["attack"]),
        cpc=None if payload["cpc"] is None else int(payload["cpc"]),
        speed=int(payload["speed"]),
        attack_range=int(payload["attack_range"]),
        income=int(payload["income"]),
        keywords=tuple(str(item) for item in payload.get("keywords", [])),
        role_tags=tuple(str(item) for item in payload.get("role_tags", [])),
        passive=PassiveAbility(
            type=str(passive_payload.get("type", "none")),
            magnitude=int(passive_payload.get("magnitude", 0)),
            text=str(passive_payload.get("text", "No passive ability.")),
        ),
        ability_summary=str(payload.get("ability_summary", "No scripted ability.")),
        ability_script=str(payload.get("ability_script", "")),
    )


def save_card(card: CardDefinition, path: Path | None = None) -> None:
    db_path = path or default_db_path()
    init_db(db_path)
    payload = card_to_payload(card)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO cards (card_id, owner_id, kind, name, prompt, card_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                card.card_id,
                card.owner_id,
                card.kind.value,
                card.name,
                card.prompt,
                json.dumps(payload),
            ),
        )
        conn.commit()


def save_bot_collection(bot: PrototypeBot, path: Path | None = None) -> None:
    for card in bot.profile.owned_cards.values():
        save_card(card, path=path)
    for base in bot.profile.owned_bases.values():
        save_card(base, path=path)


def owner_ids(path: Path | None = None) -> list[str]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT DISTINCT owner_id FROM cards ORDER BY owner_id").fetchall()
    return [str(row[0]) for row in rows]


def save_profile(
    player_id: str,
    display_name: str,
    persona: str,
    preferred_generator: str = "openrouter",
    path: Path | None = None,
) -> None:
    db_path = path or default_db_path()
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO profiles (player_id, display_name, persona, preferred_generator)
            VALUES (?, ?, ?, ?)
            """,
            (player_id, display_name, persona, preferred_generator),
        )
        conn.commit()


def load_profile(player_id: str, path: Path | None = None) -> StoredProfile | None:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT player_id, display_name, persona, preferred_generator FROM profiles WHERE player_id = ?",
            (player_id,),
        ).fetchone()
    if row is None:
        return None
    return StoredProfile(player_id=str(row[0]), display_name=str(row[1]), persona=str(row[2]), preferred_generator=str(row[3]))


def list_profiles(path: Path | None = None) -> list[StoredProfile]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT player_id, display_name, persona, preferred_generator FROM profiles ORDER BY display_name",
        ).fetchall()
    return [
        StoredProfile(
            player_id=str(row[0]),
            display_name=str(row[1]),
            persona=str(row[2]),
            preferred_generator=str(row[3]),
        )
        for row in rows
    ]


def save_matchmaking_entry(player_id: str, preferred_generator: str, path: Path | None = None) -> None:
    db_path = path or default_db_path()
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO matchmaking_queue (player_id, preferred_generator)
            VALUES (?, ?)
            """,
            (player_id, preferred_generator),
        )
        conn.commit()


def load_matchmaking_entry(player_id: str, path: Path | None = None) -> StoredMatchmakingEntry | None:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT player_id, preferred_generator FROM matchmaking_queue WHERE player_id = ?",
            (player_id,),
        ).fetchone()
    if row is None:
        return None
    return StoredMatchmakingEntry(player_id=str(row[0]), preferred_generator=str(row[1]))


def list_matchmaking_entries(path: Path | None = None) -> list[StoredMatchmakingEntry]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT player_id, preferred_generator FROM matchmaking_queue ORDER BY rowid ASC",
        ).fetchall()
    return [StoredMatchmakingEntry(player_id=str(row[0]), preferred_generator=str(row[1])) for row in rows]


def remove_matchmaking_entry(player_id: str, path: Path | None = None) -> None:
    db_path = path or default_db_path()
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("DELETE FROM matchmaking_queue WHERE player_id = ?", (player_id,))
        conn.commit()


def load_owned_cards(owner_id: str, path: Path | None = None) -> tuple[dict[str, CardDefinition], dict[str, CardDefinition]]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return {}, {}
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT card_json FROM cards WHERE owner_id = ?",
            (owner_id,),
        ).fetchall()
    owned_cards: dict[str, CardDefinition] = {}
    owned_bases: dict[str, CardDefinition] = {}
    for (raw_json,) in rows:
        payload = json.loads(raw_json)
        card = card_from_payload(payload)
        if card.kind is CardKind.BASE:
            owned_bases[card.card_id] = card
        else:
            owned_cards[card.card_id] = card
    return owned_cards, owned_bases


def hydrate_bot_collection(bot: PrototypeBot, path: Path | None = None) -> None:
    owned_cards, owned_bases = load_owned_cards(bot.player_id, path=path)
    bot.profile.owned_cards.update(owned_cards)
    bot.profile.owned_bases.update(owned_bases)


def save_match(
    *,
    seed: int,
    generator: str,
    left_player: str,
    right_player: str,
    result: MatchResult,
    path: Path | None = None,
) -> int:
    db_path = path or default_db_path()
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO matches (
                seed, generator, left_player, right_player, winner_id,
                rounds_played, reason, generated_cards, event_log_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                seed,
                generator,
                left_player,
                right_player,
                result.winner_id,
                result.rounds_played,
                result.reason,
                result.generated_cards,
                json.dumps(result.event_log),
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def load_match(match_id: int, path: Path | None = None) -> StoredMatch | None:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, seed, generator, left_player, right_player, winner_id,
                   rounds_played, reason, generated_cards, event_log_json
            FROM matches
            WHERE id = ?
            """,
            (match_id,),
        ).fetchone()
    if row is None:
        return None
    return StoredMatch(
        match_id=int(row[0]),
        seed=int(row[1]),
        generator=str(row[2]),
        left_player=str(row[3]),
        right_player=str(row[4]),
        winner_id=None if row[5] is None else str(row[5]),
        rounds_played=int(row[6]),
        reason=str(row[7]),
        generated_cards=int(row[8]),
        event_log=list(json.loads(row[9])),
    )


def list_matches(limit: int = 10, path: Path | None = None) -> list[StoredMatch]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, seed, generator, left_player, right_player, winner_id,
                   rounds_played, reason, generated_cards, event_log_json
            FROM matches
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        StoredMatch(
            match_id=int(row[0]),
            seed=int(row[1]),
            generator=str(row[2]),
            left_player=str(row[3]),
            right_player=str(row[4]),
            winner_id=None if row[5] is None else str(row[5]),
            rounds_played=int(row[6]),
            reason=str(row[7]),
            generated_cards=int(row[8]),
            event_log=list(json.loads(row[9])),
        )
        for row in rows
    ]


def save_deck(
    *,
    owner_id: str,
    name: str,
    base_card_id: str,
    card_ids: list[str],
    path: Path | None = None,
    deck_id: int | None = None,
    active: bool = True,
) -> int:
    db_path = path or default_db_path()
    init_db(db_path)
    card_ids_json = json.dumps(card_ids)
    with sqlite3.connect(db_path) as conn:
        if active:
            conn.execute("UPDATE decks SET is_active = 0 WHERE owner_id = ?", (owner_id,))
        if deck_id is None:
            cursor = conn.execute(
                """
                INSERT INTO decks (owner_id, name, base_card_id, card_ids_json, is_active)
                VALUES (?, ?, ?, ?, ?)
                """,
                (owner_id, name, base_card_id, card_ids_json, 1 if active else 0),
            )
            saved_id = int(cursor.lastrowid)
        else:
            conn.execute(
                """
                UPDATE decks
                SET owner_id = ?, name = ?, base_card_id = ?, card_ids_json = ?, is_active = ?
                WHERE id = ?
                """,
                (owner_id, name, base_card_id, card_ids_json, 1 if active else 0, deck_id),
            )
            saved_id = deck_id
        conn.commit()
    return saved_id


def set_active_deck(owner_id: str, deck_id: int, path: Path | None = None) -> None:
    db_path = path or default_db_path()
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE decks SET is_active = 0 WHERE owner_id = ?", (owner_id,))
        conn.execute("UPDATE decks SET is_active = 1 WHERE id = ? AND owner_id = ?", (deck_id, owner_id))
        conn.commit()


def load_deck(deck_id: int, path: Path | None = None) -> StoredDeck | None:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT id, owner_id, name, base_card_id, card_ids_json, is_active FROM decks WHERE id = ?",
            (deck_id,),
        ).fetchone()
    if row is None:
        return None
    return StoredDeck(
        deck_id=int(row[0]),
        owner_id=str(row[1]),
        name=str(row[2]),
        base_card_id=str(row[3]),
        card_ids=list(json.loads(row[4])),
        is_active=bool(row[5]),
    )


def list_decks(owner_id: str, path: Path | None = None) -> list[StoredDeck]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, owner_id, name, base_card_id, card_ids_json, is_active
            FROM decks
            WHERE owner_id = ?
            ORDER BY is_active DESC, id ASC
            """,
            (owner_id,),
        ).fetchall()
    return [
        StoredDeck(
            deck_id=int(row[0]),
            owner_id=str(row[1]),
            name=str(row[2]),
            base_card_id=str(row[3]),
            card_ids=list(json.loads(row[4])),
            is_active=bool(row[5]),
        )
        for row in rows
    ]


def active_deck(owner_id: str, path: Path | None = None) -> StoredDeck | None:
    decks = list_decks(owner_id, path=path)
    return decks[0] if decks and decks[0].is_active else None


def save_live_match(
    *,
    mode: str,
    status: str,
    seed: int,
    generator: str,
    left_player: str,
    right_player: str,
    state: dict[str, Any],
    path: Path | None = None,
    match_id: int | None = None,
) -> int:
    db_path = path or default_db_path()
    init_db(db_path)
    state_json = json.dumps(state)
    with sqlite3.connect(db_path) as conn:
        if match_id is None:
            cursor = conn.execute(
                """
                INSERT INTO live_matches (mode, status, seed, generator, left_player, right_player, state_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (mode, status, seed, generator, left_player, right_player, state_json),
            )
            saved_id = int(cursor.lastrowid)
        else:
            conn.execute(
                """
                UPDATE live_matches
                SET mode = ?, status = ?, seed = ?, generator = ?, left_player = ?, right_player = ?, state_json = ?
                WHERE id = ?
                """,
                (mode, status, seed, generator, left_player, right_player, state_json, match_id),
            )
            saved_id = match_id
        conn.commit()
    return saved_id


def load_live_match(match_id: int, path: Path | None = None) -> StoredLiveMatch | None:
    db_path = path or default_db_path()
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, mode, status, seed, generator, left_player, right_player, state_json
            FROM live_matches
            WHERE id = ?
            """,
            (match_id,),
        ).fetchone()
    if row is None:
        return None
    return StoredLiveMatch(
        match_id=int(row[0]),
        mode=str(row[1]),
        status=str(row[2]),
        seed=int(row[3]),
        generator=str(row[4]),
        left_player=str(row[5]),
        right_player=str(row[6]),
        state=dict(json.loads(row[7])),
    )


def list_live_matches(limit: int = 20, path: Path | None = None) -> list[StoredLiveMatch]:
    db_path = path or default_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, mode, status, seed, generator, left_player, right_player, state_json
            FROM live_matches
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        StoredLiveMatch(
            match_id=int(row[0]),
            mode=str(row[1]),
            status=str(row[2]),
            seed=int(row[3]),
            generator=str(row[4]),
            left_player=str(row[5]),
            right_player=str(row[6]),
            state=dict(json.loads(row[7])),
        )
        for row in rows
    ]
