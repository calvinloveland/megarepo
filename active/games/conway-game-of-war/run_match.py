#!/usr/bin/env python3
"""
Run a Conway's Game of War match between two LLMs using the pi harness.

Usage:
  python run_match.py                          # default: gpt-5.2-codex (Red) vs claude-sonnet-4.6 (Blue)
  python run_match.py --models "modelA,modelB" # custom models
  python run_match.py --board                  # show live board after each turn
  python run_match.py --seed 42                # deterministic randomness
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Add parent dir to path so we can import game_engine
sys.path.insert(0, str(Path(__file__).parent.resolve()))
from game_engine import GameState, format_player_prompt, MAX_TURNS, GRID_SIZE, MAX_RANK

RESULTS_DIR = Path(__file__).parent / "results"
SCRIPTS_DIR = Path(__file__).parent

# Default model pair: Red, Blue
DEFAULT_MODELS = [
    "github-copilot/gpt-5.4-mini",
    "github-copilot/claude-sonnet-4.6",
]


def call_llm(
    prompt: str,
    model: str,
    system_prompt: str = "",
    timeout_sec: int = 120,
) -> str:
    """Call pi CLI and return the model's response text."""
    cmd = ["pi", "--mode", "text", "-p", "--no-session", "--model", model]

    tmpfile: str | None = None
    if system_prompt:
        tmpfile = f"/tmp/cgow_system_{os.getpid()}_{int(time.time())}.md"
        with open(tmpfile, "w") as f:
            f.write(system_prompt)
        cmd.extend(["--append-system-prompt", tmpfile])

    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env={**os.environ, "PI_DISABLE_TUI": "1"},
        )
    except subprocess.TimeoutExpired:
        return "PASS"
    finally:
        if tmpfile and os.path.exists(tmpfile):
            os.unlink(tmpfile)

    output = result.stdout.strip()
    return output or "PASS"


def parse_action(llm_output: str) -> str:
    """Extract a valid action line from LLM output. Returns empty string if none found."""
    lines = llm_output.strip().split("\n")
    for line in lines:
        line = line.strip().upper()
        if line.startswith("DEPLOY") or line.startswith("FORTIFY") or line.startswith("SABOTAGE"):
            return line
    return ""  # Empty = no valid action found → auto_action will be used


def auto_action(game, owner: str) -> str:
    """Auto-generate a varied strategic action with some randomness for interest."""
    import random

    owned = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)
             if game.grid[r][c].alive and game.grid[r][c].owner == owner]
    enemy = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)
             if game.grid[r][c].alive and game.grid[r][c].owner is not None and game.grid[r][c].owner != owner]
    center_r, center_c = GRID_SIZE // 2, GRID_SIZE // 2

    # Collect adjacent empty cells
    adj_empty = []
    for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
        for r, c in owned:
            nr, nc = r + dr, c + dc
            if 0 <= nr < GRID_SIZE and 0 <= nc < GRID_SIZE and not game.grid[nr][nc].alive:
                adj_empty.append((nr, nc))

    # Random decision weighted for variety
    roll = random.random()

    # 40%: DEPLOY toward center (expand)
    if roll < 0.40 and adj_empty:
        target = min(adj_empty, key=lambda rc: abs(rc[0] - center_r) + abs(rc[1] - center_c))
        tr, tc = target
        return f"DEPLOY {chr(65 + tc)}{tr + 1}"

    # 30%: SABOTAGE strongest enemy
    if roll < 0.70 and enemy:
        worst = max(enemy, key=lambda rc: game.grid[rc[0]][rc[1]].rank)
        er, ec = worst
        return f"SABOTAGE {chr(65 + ec)}{er + 1}"

    # 30%: FORTIFY strongest own cell
    if owned:
        best = max(owned, key=lambda rc: game.grid[rc[0]][rc[1]].rank)
        br, bc = best
        cell = game.grid[br][bc]
        if cell.rank < MAX_RANK:
            return f"FORTIFY {chr(65 + bc)}{br + 1}"

    # Fallback: DEPLOY anywhere toward center
    empty = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE) if not game.grid[r][c].alive]
    if empty:
        target = min(empty, key=lambda rc: abs(rc[0] - center_r) + abs(rc[1] - center_c))
        tr, tc = target
        return f"DEPLOY {chr(65 + tc)}{tr + 1}"

    return "PASS"


def load_system_prompt(agent_path: Path) -> str:
    """Load the body content from an agent markdown file (skip frontmatter)."""
    if not agent_path.exists():
        return ""
    content = agent_path.read_text()
    # Skip frontmatter between --- delimiters
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return content.strip()


def get_status_line(model_a: str, model_b: str) -> str:
    a_short = model_a.split("/")[-1] if "/" in model_a else model_a
    b_short = model_b.split("/")[-1] if "/" in model_b else model_b
    return f"Red: {a_short}  vs  Blue: {b_short}"


def run_match(
    model_red: str,
    model_blue: str,
    show_board: bool = False,
    seed: int | None = None,
    max_turns: int = MAX_TURNS,
    system_prompt_red: str = "",
    system_prompt_blue: str = "",
) -> dict:
    """Run a full match and return results."""
    game = GameState(seed=seed)
    game.setup()

    match_log: list[str] = []
    match_log.append(f"Conway's Game of War — {datetime.now().isoformat()}")
    match_log.append(get_status_line(model_red, model_blue))
    match_log.append(f"Seed: {seed}")
    match_log.append("")

    if show_board:
        print(f"\n{'='*60}")
        print(f"  Conway's Game of War")
        print(f"  {get_status_line(model_red, model_blue)}")
        print(f"{'='*60}")

    for turn in range(max_turns):
        turn_num = turn + 1
        game.turn = turn

        if show_board:
            print(f"\n─── Turn {turn_num} ───")
            print(game)

        match_log.append(f"\n{'='*50}")
        match_log.append(f"TURN {turn_num}")
        match_log.append(f"{'='*50}")

        # Phase 1: Life
        life_log = game.life_phase()
        match_log.append(life_log)
        if show_board:
            print(f"\nAfter Life Phase:")
            print(game)
            print()

        # Phase 2: War
        war_log = game.war_phase()
        match_log.append(war_log)
        if show_board:
            print(f"After War Phase:")
            print(game)
            print()

        # Check for winner after automated phases
        winner = game.check_winner()
        if winner:
            match_log.append(f"!! {winner} wins after automated phases of turn {turn_num}!")
            if show_board:
                print(f"\n!!! {winner} WINS !!!")
            return _match_result(game, model_red, model_blue, winner, match_log, turn_num)

        # Phase 3a: Red's action
        red_prompt = format_player_prompt(game, "Red", "It's your turn to act (Red).")
        red_response = call_llm(red_prompt, model_red, system_prompt_red)
        red_action = parse_action(red_response)

        match_log.append(f"── Red Action ──")
        match_log.append(f"  Raw: {red_response[:200]}")
        if not red_action:
            red_action = auto_action(game, "R")
            match_log.append(f"  LLM failed → auto-action: {red_action}")
        red_result = game.apply_action("Red", red_action)
        match_log.append(red_result)

        if show_board:
            print(f"\nRed plays: {red_action}")
            print(game)

        # Check for winner after Red's action
        winner = game.check_winner()
        if winner:
            match_log.append(f"!! {winner} wins after Red's action!")
            if show_board:
                print(f"\n!!! {winner} WINS !!!")
            return _match_result(game, model_red, model_blue, winner, match_log, turn_num)

        # Phase 3b: Blue's action
        blue_prompt = format_player_prompt(game, "Blue", "It's your turn to act (Blue).")
        blue_response = call_llm(blue_prompt, model_blue, system_prompt_blue)
        blue_action = parse_action(blue_response)

        match_log.append(f"── Blue Action ──")
        match_log.append(f"  Raw: {blue_response[:200]}")
        if not blue_action:
            blue_action = auto_action(game, "B")
            match_log.append(f"  LLM failed → auto-action: {blue_action}")
        blue_result = game.apply_action("Blue", blue_action)
        match_log.append(blue_result)

        if show_board:
            print(f"\nBlue plays: {blue_action}")
            print(game)

        # Check for winner after Blue's action
        winner = game.check_winner()
        if winner:
            match_log.append(f"!! {winner} wins after Blue's action!")
            if show_board:
                print(f"\n!!! {winner} WINS !!!")
            return _match_result(game, model_red, model_blue, winner, match_log, turn_num)

    # Game over — count cells
    red_count = game.count_cells("R")
    blue_count = game.count_cells("B")

    if red_count > blue_count:
        winner = "R"
    elif blue_count > red_count:
        winner = "B"
    else:
        winner = "Tie"

    final_board = str(game)
    match_log.append(f"\n{'='*50}")
    match_log.append("GAME OVER")
    match_log.append(f"Final board:\n{final_board}")
    match_log.append(f"Red: {red_count}  Blue: {blue_count}")
    match_log.append(f"Winner: {winner}")

    if show_board:
        print(f"\n{'='*50}")
        print(f"  GAME OVER")
        print(f"  Red: {red_count}  |  Blue: {blue_count}")
        print(f"  WINNER: {'Red' if winner == 'R' else 'Blue' if winner == 'B' else 'Tie'}")

    return _match_result(game, model_red, model_blue, winner, match_log, max_turns)


def _match_result(game, model_red, model_blue, winner, match_log, turns_played):
    return {
        "winner": winner,
        "winner_name": "Red" if winner == "R" else "Blue" if winner == "B" else "Tie",
        "model_red": model_red,
        "model_blue": model_blue,
        "turn_count": turns_played,
        "red_cells": game.count_cells("R"),
        "blue_cells": game.count_cells("B"),
        "total_alive": game.total_alive(),
        "log": match_log,
        "final_board": str(game),
    }


def save_match(result: dict) -> Path:
    """Save match log to a file and return the path."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    a_short = result["model_red"].split("/")[-1] if "/" in result["model_red"] else result["model_red"]
    b_short = result["model_blue"].split("/")[-1] if "/" in result["model_blue"] else result["model_blue"]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"match_{a_short}_vs_{b_short}_{timestamp}.md"
    fpath = RESULTS_DIR / fname

    lines = [
        f"# Conway's Game of War — Match Report",
        f"",
        f"- **Red**: {result['model_red']}",
        f"- **Blue**: {result['model_blue']}",
        f"- **Winner**: {result['winner_name']}",
        f"- **Turns played**: {result['turn_count']}",
        f"- **Final**: Red {result['red_cells']} – Blue {result['blue_cells']}",
        f"- **Total alive**: {result['total_alive']}",
        f"",
        f"## Final Board",
        f"```",
        f"{result['final_board']}",
        f"```",
        f"",
        f"## Full Log",
        f"```",
    ]
    for entry in result["log"]:
        lines.append(entry)
    lines.append("```")
    lines.append("")

    with open(fpath, "w") as f:
        f.write("\n".join(lines))

    return fpath


def print_summary(result: dict) -> None:
    """Display a clean match summary."""
    a_short = result["model_red"].split("/")[-1] if "/" in result["model_red"] else result["model_red"]
    b_short = result["model_blue"].split("/")[-1] if "/" in result["model_blue"] else result["model_blue"]

    print()
    print(f"{'='*60}")
    print(f"  MATCH RESULT")
    print(f"{'='*60}")
    print(f"  Red  ({a_short}): {result['red_cells']} cells")
    print(f"  Blue ({b_short}): {result['blue_cells']} cells")
    print(f"  Winner: {result['winner_name']}")
    print(f"  Turns: {result['turn_count']}")
    print(f"  Total alive cells: {result['total_alive']}")
    print()
    print(f"  Final board:")
    for line in result["final_board"].split("\n"):
        print(f"    {line}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Run Conway's Game of War between two LLMs")
    parser.add_argument("--models", type=str, default=None,
                        help=f"Comma-separated models for Red and Blue. Default: {','.join(DEFAULT_MODELS)}")
    parser.add_argument("--board", "-b", action="store_true", default=True,
                        help="Show live board after each phase")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="Suppress live board output")
    parser.add_argument("--seed", type=int, default=None,
                        help="Random seed for reproducibility")
    parser.add_argument("--turns", type=int, default=MAX_TURNS,
                        help=f"Maximum turns (default: {MAX_TURNS})")
    parser.add_argument("--best-of", type=int, default=1,
                        help="Run multiple matches (best-of-N)")
    parser.add_argument("--system-red", type=str, default="",
                        help="Extra system prompt for Red")
    parser.add_argument("--system-blue", type=str, default="",
                        help="Extra system prompt for Blue")
    args = parser.parse_args()

    if args.models:
        models = [m.strip() for m in args.models.split(",")]
        if len(models) != 2:
            print("error: --models must have exactly 2 comma-separated model identifiers", file=sys.stderr)
            sys.exit(1)
        model_red, model_blue = models
    else:
        model_red, model_blue = DEFAULT_MODELS

    # Load agent prompts from markdown files as system prompts
    agents_dir = Path(__file__).parent / "agents"
    sys_red = load_system_prompt(agents_dir / "red.md") or args.system_red
    sys_blue = load_system_prompt(agents_dir / "blue.md") or args.system_blue
    if args.system_red:
        sys_red = args.system_red
    if args.system_blue:
        sys_blue = args.system_blue

    show_board = args.board and not args.quiet

    if args.best_of > 1:
        print(f"\nBest of {args.best_of} — {get_status_line(model_red, model_blue)}")
        red_wins = 0
        blue_wins = 0
        ties = 0
        reports: list[Path] = []

        for i in range(args.best_of):
            print(f"\n{'─'*50}")
            print(f"Match {i + 1} of {args.best_of}")
            print(f"{'─'*50}")
            result = run_match(
                model_red=model_red,
                model_blue=model_blue,
                show_board=show_board,
                seed=args.seed + i if args.seed is not None else None,
                max_turns=args.turns,
                system_prompt_red=sys_red,
                system_prompt_blue=sys_blue,
            )
            path = save_match(result)
            reports.append(path)
            print(f"  Match {i + 1}: {result['winner_name']} (saved to {path})")

            if result["winner"] == "R":
                red_wins += 1
            elif result["winner"] == "B":
                blue_wins += 1
            else:
                ties += 1

        print(f"\n{'='*60}")
        print(f"  BEST OF {args.best_of} — FINAL")
        print(f"  Red:  {red_wins}")
        print(f"  Blue: {blue_wins}")
        print(f"  Ties: {ties}")
        print(f"{'='*60}")
    else:
        result = run_match(
            model_red=model_red,
            model_blue=model_blue,
            show_board=show_board,
            seed=args.seed,
            max_turns=args.turns,
            system_prompt_red=sys_red,
            system_prompt_blue=sys_blue,
        )
        path = save_match(result)
        print_summary(result)
        print(f"\nMatch log saved to: {path}")


if __name__ == "__main__":
    main()
