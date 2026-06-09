"""Conway's game of life but with some extra sauce to enable WAR!"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional

from loguru import logger

DEFAULT_BOARD_SIZE_X = 127
DEFAULT_BOARD_SIZE_Y = 131
CELL_PX = 12

PLAYER_1 = 0
PLAYER_2 = 1

PLAYER_1_COLOR = (255, 0, 0)
PLAYER_2_COLOR = (0, 0, 255)

PLAYER_1_START_POINT = (20, 20)
PLAYER_2_START_POINT = (DEFAULT_BOARD_SIZE_X - 20, DEFAULT_BOARD_SIZE_Y - 20)

# Energy
ENERGY_PER_CELL = 1.0        # cost to claim a new cell
STARTING_ENERGY = 5.0         # energy each player begins with

NEIGHBOR_OFFSETS = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
]


@dataclass
class Player:
    """Represents a player in the game."""

    color: tuple
    start_point: tuple
    energy: float = 0.0

    def get_energy_level(self):
        """Return the player's energy level as a string."""
        return f"Energy: {self.energy}"


@dataclass
class CellState:
    """Represents the state of a cell in the game."""

    alive: bool = False
    immortal: bool = False
    crop_level: float = 2.0 / (2**4)
    owner: Optional[Player] = None
    friendly_neighbors: int = 0


class AIPlayer(Player):
    """Represents an AI player in the game."""

    def make_move(self, game_state):
        """Determine the AI's move. Override in subclasses."""


class EasyAIPlayer(AIPlayer):
    """Represents an easy AI player in the game."""

    def make_move(self, game_state):
        """Make a random move for the AI player's side, only on frontier cells."""
        idx = (
            game_state.ai_player_index
            if game_state.ai_player_index is not None
            else PLAYER_2
        )
        player_obj = game_state.players[idx]
        frontier = game_state.collect_frontier_cells(player_obj)
        if not frontier:
            frontier = game_state.collect_fallback_frontier(player_obj)
        game_state.claim_random_cell(frontier, player_obj)


class MediumAIPlayer(AIPlayer):
    """Medium AI: claims the frontier cell with the most friendly neighbours
    (prefers denser clusters for better survival)."""

    def make_move(self, game_state):
        idx = (
            game_state.ai_player_index
            if game_state.ai_player_index is not None
            else PLAYER_2
        )
        player_obj = game_state.players[idx]
        frontier = game_state.collect_frontier_cells(player_obj)
        if not frontier:
            frontier = game_state.collect_fallback_frontier(player_obj)
        if not frontier:
            return
        # Score each cell by friendly neighbour count (prefer denser areas)
        scored = [
            (game_state.count_friendly_neighbors(x, y, player_obj), x, y)
            for x, y in frontier
        ]
        scored.sort(key=lambda t: -t[0])
        best = scored[0]
        ties = [s for s in scored if s[0] == best[0]]
        _, x, y = random.choice(ties)
        game_state._claim_cell(x, y, player_obj)


class HardAIPlayer(AIPlayer):
    """Hard AI: claims frontier cells closest to the enemy's start point
    (offensive — pushes into enemy territory)."""

    def make_move(self, game_state):
        idx = (
            game_state.ai_player_index
            if game_state.ai_player_index is not None
            else PLAYER_2
        )
        player_obj = game_state.players[idx]
        opponent = game_state.players[1 - idx]
        ox, oy = opponent.start_point
        frontier = game_state.collect_frontier_cells(player_obj)
        if not frontier:
            frontier = game_state.collect_fallback_frontier(player_obj)
        if not frontier:
            return
        # Score each cell by inverse distance to opponent's start
        scored = [
            (abs(x - ox) + abs(y - oy), x, y) for x, y in frontier
        ]
        scored.sort(key=lambda t: t[0])
        best = scored[0]
        ties = [s for s in scored if s[0] == best[0]]
        _, x, y = random.choice(ties)
        game_state._claim_cell(x, y, player_obj)


class GameState:
    """Represents the state of the game board."""

    def __init__(
        self,
        board=None,
        board_size_x=DEFAULT_BOARD_SIZE_X,
        board_size_y=DEFAULT_BOARD_SIZE_Y,
    ):
        self.players = [
            Player(PLAYER_1_COLOR, PLAYER_1_START_POINT, energy=STARTING_ENERGY),
            Player(PLAYER_2_COLOR, PLAYER_2_START_POINT, energy=STARTING_ENERGY),
        ]
        self.ai_player: Optional[AIPlayer] = None
        self.ai_player_index: Optional[int] = None
        if board is not None:
            self.board = board
            self.board_size_y = len(self.board)
            self.board_size_x = len(self.board[0])
        else:
            self.board = [
                [CellState() for _ in range(board_size_x)] for _ in range(board_size_y)
            ]
            self.board_size_y = len(self.board)
            self.board_size_x = len(self.board[0])
            self.init_players()
        self.board_size_x = len(self.board)
        logger.debug(f"Board size x: {self.board_size_x}")
        self.board_size_y = len(self.board[0])
        logger.debug(f"Board size y: {self.board_size_y}")
        # ensure that the board is a rectangle
        for row in self.board:
            assert len(row) == self.board_size_y

    def _claim_neighbors(self, x: int, y: int, player: Player) -> None:
        """Claim the 8 neighbour cells for the given player (territory expansion)."""
        for i, j in NEIGHBOR_OFFSETS:
            nx = (x + i) % self.board_size_x
            ny = (y + j) % self.board_size_y
            cell = self.board[nx][ny]
            if cell.owner is None and not cell.immortal:
                cell.owner = player

    def init_players(self):
        """Initialize the players on the board."""
        for player in self.players:
            sx, sy = player.start_point
            cell = self.board[sx][sy]
            cell.owner = player
            cell.alive = True
            cell.immortal = True
            # Territory: neighbours of the start cell are also owned
            self._claim_neighbors(sx, sy, player)

    def collect_frontier_cells(self, player_obj: Player) -> list[tuple[int, int]]:
        """Collect legal frontier cells for an AI move."""
        frontier = []
        for x in range(self.board_size_x):
            for y in range(self.board_size_y):
                if self._is_frontier_cell(x, y, player_obj):
                    frontier.append((x, y))
        return frontier

    def collect_fallback_frontier(self, player_obj: Player) -> list[tuple[int, int]]:
        """Collect legal fallback cells near a player's start location."""
        frontier = []
        sx, sy = player_obj.start_point
        for i in range(-1, 2):
            for j in range(-1, 2):
                nx = (sx + i) % self.board_size_x
                ny = (sy + j) % self.board_size_y
                cell = self.board[nx][ny]
                if (not cell.alive) and (cell.owner in (None, player_obj)):
                    frontier.append((nx, ny))
        return frontier

    def claim_random_cell(
        self, frontier: list[tuple[int, int]], player_obj: Player
    ) -> None:
        """Claim a random cell from frontier cells for the specified player."""
        if not frontier:
            return
        x, y = random.choice(frontier)
        self._claim_cell(x, y, player_obj)

    def _claim_cell(self, x: int, y: int, player_obj: Player) -> bool:
        """Claim a specific cell and its neighbours. Returns True if claimed."""
        if player_obj.energy < ENERGY_PER_CELL:
            return False
        player_obj.energy -= ENERGY_PER_CELL
        target = self.board[x][y]
        target.owner = player_obj
        target.alive = True
        self._claim_neighbors(x, y, player_obj)
        return True

    def _is_frontier_cell(self, x: int, y: int, player_obj: Player) -> bool:
        cell = self.board[x][y]
        if cell.alive:
            return False
        if cell.owner is not None and cell.owner != player_obj:
            return False
        return self.count_friendly_neighbors(x, y, player_obj) > 0

    def update_ownership_around_cell(self, x, y):
        """Update the ownership of the cells around a cell."""
        cell = self.board[x][y]
        player_counts = self._count_neighbor_owners(x, y)
        cell.owner = self._pick_owner_from_counts(cell.owner, player_counts)

    def count_friendly_neighbors(self, x, y, player):
        """Count same-owner alive neighbours (used for click validation)."""
        count = 0
        for i, j in NEIGHBOR_OFFSETS:
            cell = self.board[(x + i) % self.board_size_x][(y + j) % self.board_size_y]
            if cell.alive and cell.owner == player:
                count += 1
        return count

    def count_alive_neighbors(self, x, y):
        """Count ALL alive neighbours regardless of owner (used for GoL rules)."""
        count = 0
        for i, j in NEIGHBOR_OFFSETS:
            cell = self.board[(x + i) % self.board_size_x][(y + j) % self.board_size_y]
            if cell.alive:
                count += 1
        return count

    def update_friend_counts(self):
        """
        Update per-cell neighbour counts for GoL rules.
        
        Uses *total* alive neighbours (not just friendly) so that unowned
        cells next to player territory are born correctly.  The war mechanic
        (friendly-only counting) applies to ownership changes instead.
        """
        for x in range(self.board_size_x):
            for y in range(self.board_size_y):
                self.board[x][y].friendly_neighbors = self.count_alive_neighbors(x, y)

    def _has_unfriendly_neighbor(self, x, y, player):
        """Check if cell has any unfriendly neighbors (for combat)."""
        if player is None:
            return False
        for i in range(-1, 2):
            for j in range(-1, 2):
                if i == 0 and j == 0:
                    continue
                neighbor_cell = self.board[(x + i) % self.board_size_x][
                    (y + j) % self.board_size_y
                ]
                if (
                    neighbor_cell.alive
                    and neighbor_cell.owner is not None
                    and neighbor_cell.owner != player
                ):
                    return True
        return False

    def _compute_new_owner(self, x, y):
        """Compute what the new owner of a cell should be based on neighbors."""
        cell = self.board[x][y]
        player_counts = self._count_neighbor_owners(x, y)
        return self._pick_owner_from_counts(cell.owner, player_counts)

    def _count_neighbor_owners(self, x: int, y: int) -> list[int]:
        player_counts = [0 for _ in range(len(self.players))]
        for i, j in NEIGHBOR_OFFSETS:
            loop_cell = self.board[(x + i) % self.board_size_x][
                (y + j) % self.board_size_y
            ]
            if loop_cell.alive and loop_cell.owner is not None:
                player_counts[self.players.index(loop_cell.owner)] += 1
        return player_counts

    def _pick_owner_from_counts(
        self, current_owner: Optional[Player], player_counts: list[int]
    ) -> Optional[Player]:
        current_owner_count = (
            player_counts[self.players.index(current_owner)]
            if current_owner is not None
            else 0
        )
        selected_owner = current_owner
        for index, count in enumerate(player_counts):
            if count > current_owner_count:
                selected_owner = self.players[index]
                current_owner_count = count
        return selected_owner

    def _compute_cell_update(self, x, y):
        """
        Compute what changes should happen to a cell without applying them.
        Returns a dict of changes or None if no changes needed.
        """
        cell = self.board[x][y]
        change = {"x": x, "y": y}
        change.update(self._crop_growth_change(cell))
        in_combat = self._has_unfriendly_neighbor(x, y, cell.owner)
        new_alive = self._resolve_alive_state(cell, cell.friendly_neighbors, in_combat)
        if new_alive != cell.alive:
            change["alive"] = new_alive
        change.update(self._energy_and_crop_change(cell, new_alive))
        new_owner = self._compute_new_owner(x, y)
        if new_owner != cell.owner:
            change["owner"] = new_owner
        return change if len(change) > 2 else None

    @staticmethod
    def _crop_growth_change(cell: CellState) -> dict:
        if not cell.alive and cell.crop_level < 2 and cell.owner is not None:
            return {"crop_level": cell.crop_level * 2}
        return {}

    def _resolve_alive_state(
        self, cell: CellState, friendly_neighbors: int, in_combat: bool
    ) -> bool:
        if cell.immortal:
            return cell.alive
        if in_combat and cell.alive:
            return False
        if not cell.alive:
            return friendly_neighbors == 3
        return 2 <= friendly_neighbors <= 3

    @staticmethod
    def _energy_and_crop_change(cell: CellState, new_alive: bool) -> dict:
        if cell.owner is not None and new_alive:
            return {"energy_delta": cell.crop_level, "crop_level": 2.0 / (2**4)}
        return {}

    def update_cell(self, x, y):
        """
        Update the state of a cell following the rules of conway's game of life.
        with the additional rules of war!
        """
        self.update_friend_counts()
        change = self._compute_cell_update(x, y)
        if change:
            self._apply_change(change)

    def update(self):
        """Update the board.
        
        Uses a copy-based approach to avoid reading partially-updated state
        when calculating cell transitions (fixes issue #24).
        """
        self.update_friend_counts()
        changes = self._collect_changes()
        self._apply_changes(changes)
        if self.ai_player:
            self.ai_player.make_move(self)
        return self.board

    def _collect_changes(self) -> list[dict]:
        changes = []
        for x in range(self.board_size_x):
            for y in range(self.board_size_y):
                change = self._compute_cell_update(x, y)
                if change:
                    changes.append(change)
        return changes

    def _apply_change(self, change: dict) -> None:
        x, y = change["x"], change["y"]
        cell = self.board[x][y]
        if "alive" in change:
            cell.alive = change["alive"]
        if "crop_level" in change:
            cell.crop_level = change["crop_level"]
        if "owner" in change:
            cell.owner = change["owner"]
        if "energy_delta" in change and cell.owner is not None:
            cell.owner.energy += change["energy_delta"]

    def _apply_changes(self, changes: list[dict]) -> None:
        for change in changes:
            self._apply_change(change)

    def _clamp_rgb(self, r, g, b):
        r = int(max(0, min(255, r)))
        g = int(max(0, min(255, g)))
        b = int(max(0, min(255, b)))
        return (r, g, b)

    def generate_cell_color(self, x, y):
        """Generate the color of a cell."""
        base = (50, 50, 50)
        cell = self.board[x][y]
        if cell.alive and cell.owner is not None:
            base = cell.owner.color
        # Boost green channel by crop level for a subtle growth effect
        r, g, b = base
        g = g + (255 / 2) * cell.crop_level
        return self._clamp_rgb(r, g, b)

    def generate_cell_border_color(self, x, y):
        """Generate the border color of a cell."""
        color = (150, 150, 150)
        cell = self.board[x][y]
        if cell.owner is not None:
            color = cell.owner.color
        return self._clamp_rgb(*color)

    def board_to_html(self, current_player_index: Optional[int] = None,
                       fib_remaining: int = 0):
        """Convert the board to an html string, with data for client-side zoom.
        If fib_remaining > 0 the table tag includes an auto-trigger for /step."""
        bbox = self._player_bbox(current_player_index)
        html = [self._table_prefix(*bbox, fib_remaining)]
        for y in range(self.board_size_y):
            html.append("<tr>")
            for x in range(self.board_size_x):
                html.append(self._cell_html(x, y))
            html.append("</tr>")
        html.append("</table>")
        return "".join(html)

    def _player_bbox(self, current_player_index: Optional[int]) -> tuple[int, int, int, int]:
        if current_player_index is None:
            return 0, 0, self.board_size_x - 1, self.board_size_y - 1
        player_obj = self.players[current_player_index]
        xmin, ymin = self.board_size_x, self.board_size_y
        xmax, ymax = -1, -1
        for x in range(self.board_size_x):
            for y in range(self.board_size_y):
                cell = self.board[x][y]
                if cell.owner == player_obj and (cell.alive or cell.immortal):
                    xmin = min(xmin, x)
                    ymin = min(ymin, y)
                    xmax = max(xmax, x)
                    ymax = max(ymax, y)
        if xmax < xmin or ymax < ymin:
            sx, sy = player_obj.start_point
            return sx, sy, sx, sy
        return xmin, ymin, xmax, ymax

    def _table_prefix(self, xmin: int, ymin: int, xmax: int, ymax: int,
                       fib_remaining: int = 0) -> str:
        fib_attr = f' data-fib-remaining="{fib_remaining}"'
        return (
            "<style>table {border-collapse: collapse;} "
            "td {padding: 0;} #game{transform-origin:0 0;}</style>"
            f"<table id='game' data-bbox-xmin='{xmin}' data-bbox-ymin='{ymin}' "
            f"data-bbox-xmax='{xmax}' data-bbox-ymax='{ymax}' data-cell-px='{CELL_PX}' "
            f"data-board-w='{self.board_size_x}' data-board-h='{self.board_size_y}'"
            f"{fib_attr}>"
        )

    def _cell_html(self, x: int, y: int) -> str:
        color = self.generate_cell_color(x, y)
        border_color = self.generate_cell_border_color(x, y)
        return (
            f"<td style='width:{CELL_PX}px; height:{CELL_PX}px; background-color:rgb("
            f"{color[0]},{color[1]},{color[2]}); border: 1px solid rgb("
            f"{border_color[0]},{border_color[1]},{border_color[2]});'>"
            f"{self._cell_inner_div(x, y)}</td>"
        )

    def _cell_inner_div(self, x: int, y: int) -> str:
        if self.board[x][y].immortal:
            return f"<div style='height:{CELL_PX}px;width:{CELL_PX}px'></div>"
        return (
            f"<div class='cell' data-x='{x}' data-y='{y}'"
            f" style='height:{CELL_PX}px;width:{CELL_PX}px'></div>"
        )

    def flip_cell(self, x, y):
        """Flip the state of a cell."""
        if self.is_cell_owned_by_player(x, y):
            self.board[x][y].alive = not self.board[x][y].alive
        return self.board[x][y].alive

    def is_cell_owned_by_player(self, x, y):
        """Check if a cell is owned by the current player."""
        cell = self.board[x][y]
        return cell.owner in (self.players[PLAYER_1], self.players[PLAYER_2])
