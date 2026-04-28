from __future__ import annotations

import argparse
import json
import itertools
from statistics import mean

from .bots import create_bot_roster, create_default_bots
from .generation import get_generator
from .models import CardKind
from .engine import run_match


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Super Ultimate Trading Card Game simulation CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    match_parser = subparsers.add_parser("match", help="Run one match")
    match_parser.add_argument("--seed", type=int, default=1)
    match_parser.add_argument("--generator", default="auto", choices=["auto", "deterministic", "openrouter"])

    playtest_parser = subparsers.add_parser("playtest", help="Run many AI-vs-AI matches")
    playtest_parser.add_argument("--matches", type=int, default=20)
    playtest_parser.add_argument("--seed", type=int, default=1)
    playtest_parser.add_argument("--generator", default="auto", choices=["auto", "deterministic", "openrouter"])

    generate_parser = subparsers.add_parser("generate-card", help="Generate one card and print it")
    generate_parser.add_argument("--prompt", required=True)
    generate_parser.add_argument("--kind", default="unit", choices=["unit", "base"])
    generate_parser.add_argument("--generator", default="auto", choices=["auto", "deterministic", "openrouter"])
    generate_parser.add_argument("--owner-id", default="preview")
    return parser


def _run_single_match(seed: int, generator_name: str) -> int:
    generator = get_generator(generator_name, seed=seed)
    left, right = create_default_bots(seed)
    result = run_match(left, right, generator, seed=seed)
    print(f"winner={result.winner_id or 'draw'} rounds={result.rounds_played} reason={result.reason} generated={result.generated_cards}")
    for line in result.event_log[:40]:
        print(line)
    if len(result.event_log) > 40:
        print(f"... {len(result.event_log) - 40} more events")
    return 0


def _run_playtest(matches: int, seed: int, generator_name: str) -> int:
    generator = get_generator(generator_name, seed=seed)
    roster = create_bot_roster(seed)
    pairings = list(itertools.combinations(range(len(roster)), 2))
    results = []
    pairing_results: dict[str, dict[str, int]] = {}
    for index in range(matches):
        left_index, right_index = pairings[index % len(pairings)]
        left = roster[left_index]
        right = roster[right_index]
        result = run_match(left, right, generator, seed=seed + index)
        results.append(result)
        pairing_key = f"{left.player_id}-vs-{right.player_id}"
        pairing_results.setdefault(pairing_key, {"draw": 0, left.player_id: 0, right.player_id: 0})
        pairing_results[pairing_key][result.winner_id or "draw"] += 1
    wins = {"draw": 0}
    for bot in roster:
        wins[bot.player_id] = 0
    for result in results:
        wins[result.winner_id or "draw"] += 1
    print(json.dumps(
        {
            "matches": matches,
            "generator": generator_name,
            "average_rounds": round(mean(result.rounds_played for result in results), 2),
            "average_generated_cards": round(mean(result.generated_cards for result in results), 2),
            "wins": wins,
            "pairings": pairing_results,
        },
        indent=2,
    ))
    return 0


def _run_generate(prompt: str, kind: str, generator_name: str, owner_id: str) -> int:
    generator = get_generator(generator_name, seed=1)
    card = generator.generate_card(owner_id, prompt, kind=CardKind(kind))
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
            },
            indent=2,
        )
    )
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    if args.command == "match":
        return _run_single_match(args.seed, args.generator)
    if args.command == "playtest":
        return _run_playtest(args.matches, args.seed, args.generator)
    if args.command == "generate-card":
        return _run_generate(args.prompt, args.kind, args.generator, args.owner_id)
    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
