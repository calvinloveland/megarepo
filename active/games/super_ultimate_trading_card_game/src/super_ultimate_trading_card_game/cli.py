from __future__ import annotations

import argparse
import json
from pathlib import Path

from .models import CardKind
from .sim_api import (
    DEFAULT_BOT_IDS,
    generate_card_result,
    load_collection_result,
    recent_matches,
    run_playtest_batch,
    run_saved_match,
    stored_match,
)
from .storage import default_db_path


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Super Ultimate Trading Card Game simulation CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    match_parser = subparsers.add_parser("match", help="Run one match")
    match_parser.add_argument("--seed", type=int, default=1)
    match_parser.add_argument("--generator", default="auto", choices=["auto", "deterministic", "openrouter"])
    match_parser.add_argument("--db", default=str(default_db_path()))
    match_parser.add_argument("--full-log", action="store_true")
    match_parser.add_argument("--left-id", default="alpha", choices=list(DEFAULT_BOT_IDS))
    match_parser.add_argument("--right-id", default="beta", choices=list(DEFAULT_BOT_IDS))

    playtest_parser = subparsers.add_parser("playtest", help="Run many AI-vs-AI matches")
    playtest_parser.add_argument("--matches", type=int, default=20)
    playtest_parser.add_argument("--seed", type=int, default=1)
    playtest_parser.add_argument("--generator", default="auto", choices=["auto", "deterministic", "openrouter"])
    playtest_parser.add_argument("--db", default=str(default_db_path()))

    generate_parser = subparsers.add_parser("generate-card", help="Generate one card and print it")
    generate_parser.add_argument("--prompt", required=True)
    generate_parser.add_argument("--kind", default="unit", choices=["unit", "base"])
    generate_parser.add_argument("--generator", default="auto", choices=["auto", "deterministic", "openrouter"])
    generate_parser.add_argument("--owner-id", default="preview")
    generate_parser.add_argument("--db", default=str(default_db_path()))
    generate_parser.add_argument("--save", action="store_true")

    collection_parser = subparsers.add_parser("collection", help="Show owned cards and bases for a player")
    collection_parser.add_argument("--owner-id", required=True)
    collection_parser.add_argument("--db", default=str(default_db_path()))

    log_parser = subparsers.add_parser("show-match", help="Show a stored match log")
    log_parser.add_argument("--id", type=int, required=True)
    log_parser.add_argument("--db", default=str(default_db_path()))

    history_parser = subparsers.add_parser("match-history", help="List recent stored matches")
    history_parser.add_argument("--limit", type=int, default=10)
    history_parser.add_argument("--db", default=str(default_db_path()))
    return parser


def _run_single_match(
    seed: int,
    generator_name: str,
    db_path: Path,
    full_log: bool,
    left_id: str,
    right_id: str,
) -> int:
    match_id, result = run_saved_match(
        seed=seed,
        generator_name=generator_name,
        left_id=left_id,
        right_id=right_id,
        db_path=db_path,
    )
    print(
        f"match_id={match_id} winner={result.winner_id or 'draw'} "
        f"rounds={result.rounds_played} reason={result.reason} generated={result.generated_cards}"
    )
    lines = result.event_log if full_log else result.event_log[:40]
    for line in lines:
        print(line)
    if not full_log and len(result.event_log) > 40:
        print(f"... {len(result.event_log) - 40} more events")
    return 0


def _run_playtest(matches: int, seed: int, generator_name: str, db_path: Path) -> int:
    summary = run_playtest_batch(matches=matches, seed=seed, generator_name=generator_name, db_path=db_path)
    print(json.dumps(summary, indent=2))
    return 0


def _run_generate(prompt: str, kind: str, generator_name: str, owner_id: str, db_path: Path, save: bool) -> int:
    card = generate_card_result(
        prompt=prompt,
        kind=CardKind(kind),
        generator_name=generator_name,
        owner_id=owner_id,
        db_path=db_path,
        save=save,
    )
    print(
        json.dumps(
            {
                "card_id": card.card_id,
                "name": card.name,
                "theme": card.theme,
                "kind": card.kind.value,
                "hp": card.hp,
                "attack": card.attack,
                "cpc": card.cpc,
                "speed": card.speed,
                "range": card.attack_range,
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
            },
            indent=2,
        )
    )
    return 0


def _run_collection(owner_id: str, db_path: Path) -> int:
    print(json.dumps(load_collection_result(owner_id=owner_id, db_path=db_path), indent=2))
    return 0


def _run_show_match(match_id: int, db_path: Path) -> int:
    stored = stored_match(match_id, db_path=db_path)
    if stored is None:
        raise ValueError(f"Match {match_id} not found in {db_path}")
    print(
        f"match_id={stored.match_id} seed={stored.seed} generator={stored.generator} "
        f"winner={stored.winner_id or 'draw'} rounds={stored.rounds_played} reason={stored.reason} generated={stored.generated_cards}"
    )
    for line in stored.event_log:
        print(line)
    return 0


def _run_match_history(limit: int, db_path: Path) -> int:
    matches = recent_matches(limit=limit, db_path=db_path)
    print(
        json.dumps(
            [
                {
                    "match_id": match.match_id,
                    "seed": match.seed,
                    "generator": match.generator,
                    "left_player": match.left_player,
                    "right_player": match.right_player,
                    "winner": match.winner_id,
                    "rounds": match.rounds_played,
                    "reason": match.reason,
                    "generated_cards": match.generated_cards,
                }
                for match in matches
            ],
            indent=2,
        )
    )
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    if args.command == "match":
        return _run_single_match(args.seed, args.generator, Path(args.db), args.full_log, args.left_id, args.right_id)
    if args.command == "playtest":
        return _run_playtest(args.matches, args.seed, args.generator, Path(args.db))
    if args.command == "generate-card":
        return _run_generate(args.prompt, args.kind, args.generator, args.owner_id, Path(args.db), args.save)
    if args.command == "collection":
        return _run_collection(args.owner_id, Path(args.db))
    if args.command == "show-match":
        return _run_show_match(args.id, Path(args.db))
    if args.command == "match-history":
        return _run_match_history(args.limit, Path(args.db))
    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
