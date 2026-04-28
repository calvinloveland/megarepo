from __future__ import annotations

import itertools
from pathlib import Path
from statistics import mean
from typing import Any

from .bots import PrototypeBot, create_bot_roster
from .engine import run_match
from .generation import get_generator
from .models import CardDefinition, CardKind, MatchResult
from .storage import (
    default_db_path,
    hydrate_bot_collection,
    init_db,
    list_matches,
    load_match,
    load_owned_cards,
    save_bot_collection,
    save_card,
    save_match,
)

DEFAULT_BOT_IDS = ("alpha", "beta", "gamma")


def _hydrated_roster(seed: int, db_path: Path) -> list[PrototypeBot]:
    init_db(db_path)
    roster = create_bot_roster(seed)
    for bot in roster:
        hydrate_bot_collection(bot, path=db_path)
    return roster


def _roster_by_id(seed: int, db_path: Path) -> dict[str, PrototypeBot]:
    roster = _hydrated_roster(seed, db_path)
    return {bot.player_id: bot for bot in roster}


def ensure_builtin_collection(
    owner_id: str,
    *,
    seed: int,
    generator_name: str,
    db_path: Path | None = None,
) -> None:
    resolved_db = db_path or default_db_path()
    bot_map = _roster_by_id(seed, resolved_db)
    bot = bot_map.get(owner_id)
    if bot is None:
        return
    generator = get_generator(generator_name, seed=seed)
    bot.ensure_collection(generator)
    save_bot_collection(bot, path=resolved_db)


def run_saved_match(
    *,
    seed: int,
    generator_name: str,
    left_id: str,
    right_id: str,
    db_path: Path | None = None,
) -> tuple[int, MatchResult]:
    resolved_db = db_path or default_db_path()
    if left_id == right_id:
        raise ValueError("Choose two different players.")
    bot_map = _roster_by_id(seed, resolved_db)
    try:
        left = bot_map[left_id]
        right = bot_map[right_id]
    except KeyError as exc:
        raise ValueError(f"Unknown player id: {exc.args[0]}") from exc
    generator = get_generator(generator_name, seed=seed)
    result = run_match(left, right, generator, seed=seed)
    save_bot_collection(left, path=resolved_db)
    save_bot_collection(right, path=resolved_db)
    match_id = save_match(
        seed=seed,
        generator=generator_name,
        left_player=left.player_id,
        right_player=right.player_id,
        result=result,
        path=resolved_db,
    )
    return match_id, result


def run_playtest_batch(
    *,
    matches: int,
    seed: int,
    generator_name: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    generator = get_generator(generator_name, seed=seed)
    roster = _hydrated_roster(seed, resolved_db)
    pairings = list(itertools.combinations(range(len(roster)), 2))
    results: list[MatchResult] = []
    pairing_results: dict[str, dict[str, int]] = {}
    for index in range(matches):
        left_index, right_index = pairings[index % len(pairings)]
        left = roster[left_index]
        right = roster[right_index]
        result = run_match(left, right, generator, seed=seed + index)
        save_bot_collection(left, path=resolved_db)
        save_bot_collection(right, path=resolved_db)
        save_match(
            seed=seed + index,
            generator=generator_name,
            left_player=left.player_id,
            right_player=right.player_id,
            result=result,
            path=resolved_db,
        )
        results.append(result)
        pairing_key = f"{left.player_id}-vs-{right.player_id}"
        pairing_results.setdefault(pairing_key, {"draw": 0, left.player_id: 0, right.player_id: 0})
        pairing_results[pairing_key][result.winner_id or "draw"] += 1

    wins = {"draw": 0}
    for bot in roster:
        wins[bot.player_id] = 0
    for result in results:
        wins[result.winner_id or "draw"] += 1

    return {
        "matches": matches,
        "generator": generator_name,
        "average_rounds": round(mean(result.rounds_played for result in results), 2) if results else 0.0,
        "average_generated_cards": round(mean(result.generated_cards for result in results), 2) if results else 0.0,
        "wins": wins,
        "pairings": pairing_results,
    }


def generate_card_result(
    *,
    prompt: str,
    kind: CardKind,
    generator_name: str,
    owner_id: str,
    db_path: Path | None = None,
    save: bool = False,
) -> CardDefinition:
    resolved_db = db_path or default_db_path()
    init_db(resolved_db)
    generator = get_generator(generator_name, seed=1)
    card = generator.generate_card(owner_id, prompt, kind=kind)
    if save:
        save_card(card, path=resolved_db)
    return card


def load_collection_result(
    *,
    owner_id: str,
    db_path: Path | None = None,
    ensure_seed: bool = True,
) -> dict[str, Any]:
    resolved_db = db_path or default_db_path()
    if ensure_seed:
        ensure_builtin_collection(owner_id, seed=1, generator_name="deterministic", db_path=resolved_db)
    owned_cards, owned_bases = load_owned_cards(owner_id, path=resolved_db)
    return {
        "owner_id": owner_id,
        "bases": [
            {
                "card_id": base.card_id,
                "name": base.name,
                "hp": base.hp,
                "attack": base.attack,
                "income": base.income,
                "ability_summary": base.ability_summary,
            }
            for base in owned_bases.values()
        ],
        "cards": [
            {
                "card_id": card.card_id,
                "name": card.name,
                "cpc": card.cpc,
                "hp": card.hp,
                "attack": card.attack,
                "keywords": list(card.keywords),
                "ability_summary": card.ability_summary,
            }
            for card in owned_cards.values()
        ],
    }


def recent_matches(limit: int = 10, db_path: Path | None = None):
    return list_matches(limit=limit, path=db_path or default_db_path())


def stored_match(match_id: int, db_path: Path | None = None):
    return load_match(match_id, path=db_path or default_db_path())
