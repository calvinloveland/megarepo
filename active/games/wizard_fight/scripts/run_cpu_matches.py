#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

from loguru import logger

from wizard_fight.engine import build_initial_state, step
from wizard_fight.server import Lobby, SpellLibrary, Telemetry, _cpu_take_turn, _resolve_research


def _wizard_snapshot(lobby: Lobby) -> Dict[str, Any]:
    return {
        str(wizard_id): {
            "health": round(wizard.health, 2),
            "mana": round(wizard.mana, 2),
        }
        for wizard_id, wizard in lobby.state.wizards.items()
    }


def _run_match(
    match_id: int,
    seed: int,
    steps_per_tick: int,
    max_ticks: int,
) -> Dict[str, Any]:
    lobby = Lobby(lobby_id=f"cpu-{seed}", state=build_initial_state(seed=seed), cpu_players={0, 1})
    spells = SpellLibrary()
    telemetry = Telemetry()

    events: List[Dict[str, Any]] = []
    casts_by_cpu: Dict[str, Counter] = defaultdict(Counter)
    baseline_name = spells.baseline().get("name", "Baseline")

    def sink(message: Any) -> None:
        record = message.record
        event = record.get("message")
        extra = record.get("extra", {})
        if event not in {
            "cpu_cast_spell",
            "cpu_cast_baseline",
            "cpu_research_started",
            "research_completed",
            "research_failed",
        }:
            return
        spell_name = extra.get("spell_name")
        if event == "cpu_cast_baseline":
            spell_name = baseline_name
        entry = {
            "match_id": match_id,
            "time_seconds": round(lobby.state.time_seconds, 2),
            "event": event,
            "player_id": extra.get("player_id"),
            "spell_name": spell_name,
            "prompt": extra.get("prompt"),
            "wizards": _wizard_snapshot(lobby),
        }
        events.append(entry)
        if event in {"cpu_cast_spell", "cpu_cast_baseline"}:
            cpu_id = str(extra.get("player_id"))
            if cpu_id is not None:
                casts_by_cpu[cpu_id][spell_name or "unknown"] += 1

    sink_id = logger.add(sink, level="INFO")

    tick = 0
    while tick < max_ticks:
        w0 = lobby.state.wizards[0].health
        w1 = lobby.state.wizards[1].health
        if w0 <= 0 or w1 <= 0:
            break
        _cpu_take_turn(lobby, spells)
        _resolve_research(lobby, telemetry)
        step(lobby.state, steps=steps_per_tick)
        _cpu_take_turn(lobby, spells)
        _resolve_research(lobby, telemetry)
        tick += 1

    logger.remove(sink_id)

    winner = "draw"
    if lobby.state.wizards[0].health > 0 and lobby.state.wizards[1].health <= 0:
        winner = "cpu_0"
    elif lobby.state.wizards[1].health > 0 and lobby.state.wizards[0].health <= 0:
        winner = "cpu_1"

    summary = {
        "casts_by_cpu": {cpu: dict(counter) for cpu, counter in casts_by_cpu.items()},
        "ticks": tick,
        "winner": winner,
        "telemetry": asdict(telemetry),
    }

    return {
        "match_id": match_id,
        "seed": seed,
        "summary": summary,
        "events": events,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CPU vs CPU Wizard Fight matches.")
    parser.add_argument("--matches", type=int, default=3, help="Number of matches to run.")
    parser.add_argument("--seed", type=int, default=7, help="Base RNG seed for matches.")
    parser.add_argument("--steps-per-tick", type=int, default=6, help="Engine steps per tick.")
    parser.add_argument("--max-ticks", type=int, default=600, help="Maximum ticks per match.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("cpu_battle_log.json"),
        help="Output JSON file path.",
    )
    args = parser.parse_args()

    os.environ.setdefault("WIZARD_FIGHT_LLM_MODE", "disabled")

    results = []
    for idx in range(args.matches):
        match_seed = args.seed + idx
        results.append(
            _run_match(
                match_id=idx + 1,
                seed=match_seed,
                steps_per_tick=args.steps_per_tick,
                max_ticks=args.max_ticks,
            )
        )

    output_payload = {"matches": results}
    args.output.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")

    print(f"Saved battle log to {args.output}")
    for match in results:
        summary = match["summary"]
        print(
            f"Match {match['match_id']} (seed {match['seed']}): winner={summary['winner']} "
            f"casts={summary['casts_by_cpu']}"
        )


if __name__ == "__main__":
    main()
