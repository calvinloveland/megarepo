#!/usr/bin/env python3
"""
Conway's Game of War — game engine.

A hybrid of Conway's Game of Life and the card game War.
Two players (Red, Blue) compete on a 5×5 grid.

Each turn:
  1. War Phase — adjacent enemy cells battle (higher rank wins)
  2. Life Phase — Conway's rules (births/deaths)
  3. Action Phase — each player acts (DEPLOY / FORTIFY / SABOTAGE)

PASS is NOT allowed on turns 1-5. The game auto-picks a valid action if you try.
"""

from __future__ import annotations

import copy
import random
from dataclasses import dataclass
from typing import Optional

GRID_SIZE = 5
MAX_RANK = 10
MIN_RANK = 1
MAX_TURNS = 10
NO_PASS_UNTIL_TURN = 5  # PASS not allowed before this turn


@dataclass
class Cell:
    owner: Optional[str] = None  # 'R' | 'B' | None
    rank: int = 0  # 0 = dead, 1-10 = alive
    alive: bool = False

    def __str__(self) -> str:
        if not self.alive:
            return " . "
        return f"{self.owner}{self.rank:>2d}"


class GameState:
    """Full state of a Conway's Game of War match."""

    def __init__(self, seed: Optional[int] = None):
        self.grid: list[list[Cell]] = [[Cell() for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
        self.turn = 0
        self.history: list[str] = []
        self.winner: Optional[str] = None
        self.consecutive_passes: dict[str, int] = {"R": 0, "B": 0}
        if seed is not None:
            random.seed(seed)

    def setup(self) -> None:
        """Place initial cells for both players — close enough to force interaction."""
        # Red 2×2 block (top-left)
        self.grid[0][0] = Cell(owner="R", rank=3, alive=True)
        self.grid[0][1] = Cell(owner="R", rank=3, alive=True)
        self.grid[1][0] = Cell(owner="R", rank=3, alive=True)
        self.grid[1][1] = Cell(owner="R", rank=3, alive=True)

        # Blue 2×2 block (bottom-right) - just 1 column gap from Red!
        self.grid[3][3] = Cell(owner="B", rank=3, alive=True)
        self.grid[3][4] = Cell(owner="B", rank=3, alive=True)
        self.grid[4][3] = Cell(owner="B", rank=3, alive=True)
        self.grid[4][4] = Cell(owner="B", rank=3, alive=True)

        self._log("=== SETUP ===")
        self._log(RED_STARTS_MSG)
        self._log(str(self))

    # ── Phase 1: War ──────────────────────────────────────────────────

    def war_phase(self) -> str:
        """Adjacent enemy cells battle — higher rank wins, tie = both die."""
        battles: list[tuple[int, int, int, int]] = []
        processed_pairs: set[tuple[int, int, int, int]] = set()

        for r in range(GRID_SIZE):
            for c in range(GRID_SIZE):
                cell = self.grid[r][c]
                if not cell.alive or not cell.owner:
                    continue
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        if dr == 0 and dc == 0:
                            continue
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < GRID_SIZE and 0 <= nc < GRID_SIZE:
                            neighbor = self.grid[nr][nc]
                            if neighbor.alive and neighbor.owner and neighbor.owner != cell.owner:
                                if (r, c, nr, nc) not in processed_pairs and (nr, nc, r, c) not in processed_pairs:
                                    battles.append((r, c, nr, nc))
                                    processed_pairs.add((r, c, nr, nc))
                                    processed_pairs.add((nr, nc, r, c))

        deaths: set[tuple[int, int]] = set()

        for r1, c1, r2, c2 in battles:
            cell1 = self.grid[r1][c1]
            cell2 = self.grid[r2][c2]
            if not cell1.alive or not cell2.alive:
                continue
            if cell1.rank > cell2.rank:
                deaths.add((r2, c2))
            elif cell2.rank > cell1.rank:
                deaths.add((r1, c1))
            else:
                deaths.add((r1, c1))
                deaths.add((r2, c2))

        summary = "── War Phase ──\n"
        if not deaths:
            summary += "  No battles.\n"
        else:
            for r, c in deaths:
                cell = self.grid[r][c]
                summary += f"  {self._coord(r, c)}: {cell.owner}{cell.rank} defeated\n"
                self.grid[r][c] = Cell()

        summary += "\n"
        self._log(summary)
        return summary

    # ── Phase 2: Life (Conway) ────────────────────────────────────────

    def life_phase(self) -> str:
        """Apply Conway's Game of Life rules."""
        changes = []
        next_grid = [[Cell() for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]

        for r in range(GRID_SIZE):
            for c in range(GRID_SIZE):
                cell = self.grid[r][c]
                neighbors = self._live_neighbors(r, c)
                neighbor_count = len(neighbors)

                if cell.alive:
                    if neighbor_count < 2 or neighbor_count > 3:
                        next_grid[r][c] = Cell()
                        changes.append(f"  {self._coord(r, c)}: R{cell.rank} dies ({neighbor_count} neighbors)")
                    else:
                        next_grid[r][c] = Cell(owner=cell.owner, rank=cell.rank, alive=True)
                else:
                    if neighbor_count == 3:
                        owner = self._birth_owner(neighbors)
                        new_rank = 1
                        next_grid[r][c] = Cell(owner=owner, rank=new_rank, alive=True)
                        changes.append(f"  {self._coord(r, c)}: born {owner}{new_rank}")
                    else:
                        next_grid[r][c] = Cell()

        self.grid = next_grid
        summary = "── Life Phase ──\n"
        if not changes:
            summary += "  No changes.\n"
        else:
            summary += "\n".join(changes) + "\n"
        self._log(summary)
        return summary

    def _live_neighbors(self, r: int, c: int) -> list[tuple[int, int, Cell]]:
        result = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < GRID_SIZE and 0 <= nc < GRID_SIZE:
                    cell = self.grid[nr][nc]
                    if cell.alive:
                        result.append((nr, nc, cell))
        return result

    def _birth_owner(self, neighbors: list[tuple[int, int, Cell]]) -> str:
        counts: dict[str, int] = {}
        for _, _, cell in neighbors:
            if cell.owner:
                counts[cell.owner] = counts.get(cell.owner, 0) + 1
        if not counts:
            return random.choice(["R", "B"])
        max_count = max(counts.values())
        top = [o for o, c in counts.items() if c == max_count]
        return random.choice(top)

    # ── Phase 3: Player Actions ───────────────────────────────────────

    @staticmethod
    def _owner_code(player: str) -> str:
        p = player.strip().upper()
        if p in ("R", "RED"):
            return "R"
        if p in ("B", "BLUE"):
            return "B"
        return p

    def apply_action(self, player: str, action: str) -> str:
        """Apply a player's action. Returns a result message."""
        owner = self._owner_code(player)
        if owner not in ("R", "B"):
            return f"  Invalid player: {player}"

        action = action.strip().upper()
        parts = action.split()
        if not parts:
            return "  Invalid: empty action."

        cmd = parts[0]

        # PASS hurts: one of your cells loses 1 rank (desertion/attrition)
        if cmd == "PASS":
            self.consecutive_passes[owner] += 1
            player_name = "Red" if owner == "R" else "Blue"
            # Find owned cells and penalize one
            owned = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                     if self.grid[r][c].alive and self.grid[r][c].owner == owner]
            if owned:
                r, c = random.choice(owned)
                cell = self.grid[r][c]
                cell.rank -= 1
                if cell.rank <= 0:
                    old_owner = cell.owner
                    self.grid[r][c] = Cell()
                    msg = f"  {player_name} PASSES → cell at {self._coord(r, c)} deserts and dies!"
                else:
                    msg = f"  {player_name} PASSES → cell at {self._coord(r, c)} loses morale (rank {cell.rank + 1} → {cell.rank})"
                self._log(f"  {msg}")
                return msg
            else:
                msg = f"  {player_name} passes (no cells to punish)."
                self._log(f"  {msg}")
                return msg

        # Non-PASS action resets pass counter
        self.consecutive_passes[owner] = 0

        if cmd in ("DEPLOY", "FORTIFY", "SABOTAGE"):
            if len(parts) < 2:
                return f"  Invalid: {cmd} requires a cell coordinate (e.g., DEPLOY B3)."
            coord = parts[1]
            r, c = self._parse_coord(coord)
            if r is None:
                return f"  Invalid coordinate: {coord}"

            if cmd == "DEPLOY":
                return self._action_deploy(owner, r, c)
            elif cmd == "FORTIFY":
                return self._action_fortify(owner, r, c)
            elif cmd == "SABOTAGE":
                return self._action_sabotage(owner, r, c)

        return f"  Unknown action: {action}"

    def _action_deploy(self, owner: str, r: int, c: int) -> str:
        cell = self.grid[r][c]
        if cell.alive:
            return f"  {self._coord(r, c)} is already occupied. Deploy failed."
        self.grid[r][c] = Cell(owner=owner, rank=1, alive=True)
        player_name = "Red" if owner == "R" else "Blue"
        msg = f"  {player_name} deploys rank-1 at {self._coord(r, c)}."
        self._log(f"  {msg}")
        return msg

    def _action_fortify(self, owner: str, r: int, c: int) -> str:
        cell = self.grid[r][c]
        if not cell.alive or cell.owner != owner:
            return f"  {self._coord(r, c)} is not your cell. Fortify failed."
        if cell.rank >= MAX_RANK:
            return f"  {self._coord(r, c)} is already max rank ({MAX_RANK})."
        cell.rank += 1
        player_name = "Red" if owner == "R" else "Blue"
        msg = f"  {player_name} fortifies {self._coord(r, c)} to rank {cell.rank}."
        self._log(f"  {msg}")
        return msg

    def _action_sabotage(self, owner: str, r: int, c: int) -> str:
        cell = self.grid[r][c]
        if not cell.alive or cell.owner == owner or cell.owner is None:
            return f"  {self._coord(r, c)} is not an enemy cell. Sabotage failed."
        player_name = "Red" if owner == "R" else "Blue"
        if cell.rank <= MIN_RANK:
            cell.alive = False
            cell.owner = None
            cell.rank = 0
            msg = f"  {player_name} sabotages {self._coord(r, c)} — cell destroyed!"
        else:
            cell.rank -= 1
            msg = f"  {player_name} sabotages {self._coord(r, c)} to rank {cell.rank}."
        self._log(f"  {msg}")
        return msg

    # ── Game Loop ──────────────────────────────────────────────────────

    def check_winner(self) -> Optional[str]:
        red_count = self.count_cells("R")
        blue_count = self.count_cells("B")
        if red_count == 0 and blue_count == 0:
            return "Tie"
        if red_count == 0:
            return "B"
        if blue_count == 0:
            return "R"
        return None

    def count_cells(self, player: str) -> int:
        return sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                   if self.grid[r][c].alive and self.grid[r][c].owner == player)

    def total_alive(self) -> int:
        return sum(1 for r in range(GRID_SIZE) for c in range(GRID_SIZE)
                   if self.grid[r][c].alive)

    # ── Helpers ────────────────────────────────────────────────────────

    def _coord(self, r: int, c: int) -> str:
        return f"{chr(65 + c)}{r + 1}"

    def _parse_coord(self, s: str) -> tuple[Optional[int], Optional[int]]:
        s = s.strip().upper()
        if len(s) < 2:
            return (None, None)
        col_char = s[0]
        if col_char < 'A' or col_char > chr(ord('A') + GRID_SIZE - 1):
            return (None, None)
        try:
            row = int(s[1:]) - 1
        except ValueError:
            return (None, None)
        col = ord(col_char) - ord('A')
        if row < 0 or row >= GRID_SIZE:
            return (None, None)
        return (row, col)

    def _log(self, msg: str) -> None:
        self.history.append(msg)

    def __str__(self) -> str:
        lines = []
        lines.append("     " + " ".join(f" {chr(65 + c)} " for c in range(GRID_SIZE)))
        for r in range(GRID_SIZE):
            row_str = f" {r + 1:2d}  "
            for c in range(GRID_SIZE):
                row_str += str(self.grid[r][c]) + " "
            lines.append(row_str)
        lines.append("")
        red_count = self.count_cells("R")
        blue_count = self.count_cells("B")
        lines.append(f"  Red: {red_count} live cells  |  Blue: {blue_count} live cells")
        lines.append(f"  Total alive: {self.total_alive()}")
        return "\n".join(lines)


# ── Prompt templates ──────────────────────────────────────────────────

ACTION_RULES = "ACTIONS: DEPLOY <cell> | FORTIFY <cell> | SABOTAGE <cell>"

RED_STARTS_MSG = "Red starts. Each turn: WAR → LIFE → Red acts → Blue acts."


def format_player_prompt(game: GameState, player: str, phase: str) -> str:
    """Build the prompt shown to an LLM player."""
    red_cells = game.count_cells("R")
    blue_cells = game.count_cells("B")
    my_cells = red_cells if player.upper().startswith("R") else blue_cells
    opp_cells = blue_cells if player.upper().startswith("R") else red_cells

    prompt = f"""CONWAY'S GAME OF WAR — Turn {game.turn+1}/{MAX_TURNS} — You are {player} ({my_cells} vs {opp_cells})

{str(game)}

DEPLOY <cell> | FORTIFY <cell> | SABOTAGE <cell>

Your order:"""
    return prompt
