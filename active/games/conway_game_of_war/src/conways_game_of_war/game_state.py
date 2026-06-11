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
ENERGY_PER_CELL = 1.0        # legacy baseline cost scale
STARTING_ENERGY = 5.0         # energy each player begins with
FREE_BASE_RADIUS = 1          # cells within 1 of the immortal base are free
DISTANCE_COST_POWER = 2       # farther actions become sharply more expensive

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
    """Easy AI: claims frontier cells but avoids combat zones."""

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
        # Filter out cells that would immediately die from combat
        safe = [
            (x, y) for x, y in frontier
            if not game_state._has_unfriendly_neighbor(x, y, player_obj)
        ]
        if safe:
            x, y = random.choice(safe)
        else:
            x, y = random.choice(frontier)
        game_state._claim_cell(x, y, player_obj)


class MediumAIPlayer(AIPlayer):
    """Medium AI: scores frontier cells by survival potential and cost efficiency."""

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
        scored = []
        for x, y in frontier:
            friendly = game_state.count_friendly_neighbors(x, y, player_obj)
            unfriendly = 1 if game_state._has_unfriendly_neighbor(x, y, player_obj) else 0
            cost = game_state.energy_cost_for_player(x, y, player_obj)
            # Survival score: friendly neighbors minus combat risk
            survival = friendly - unfriendly * 3
            # Energy efficiency: prefer cheaper cells
            energy_penalty = cost * 0.5
            scored.append((-(survival - energy_penalty), x, y))
        scored.sort(key=lambda t: t[0])
        best = scored[0]
        ties = [s for s in scored if abs(s[0] - best[0]) < 0.01]
        _, x, y = random.choice(ties)
        game_state._claim_cell(x, y, player_obj)


class HardAIPlayer(AIPlayer):
    """Hard AI: aggressive multi-phase strategy with block building, energy harvesting, and combat avoidance."""

    def _find_block_cells(self, game_state, player_obj, cx, cy):
        cells = []
        block = [(cx, cy), (cx, cy + 1), (cx + 1, cy), (cx + 1, cy + 1)]
        for x, y in block:
            nx = x % game_state.board_size_x
            ny = y % game_state.board_size_y
            cell = game_state.board[nx][ny]
            if not cell.alive and cell.owner in (None, player_obj) and not cell.immortal:
                cells.append((nx, ny))
        return cells

    def _harvest_score(self, game_state, x, y) -> float:
        """Score a cell by the energy it could generate from crop."""
        cell = game_state.board[x][y]
        if cell.owner is None:
            return 0.0
        return cell.crop_level * 3.0

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

        scored = []
        for x, y in frontier:
            friendly = game_state.count_friendly_neighbors(x, y, player_obj)
            combat = 1 if game_state._has_unfriendly_neighbor(x, y, player_obj) else 0
            cost = game_state.energy_cost_for_player(x, y, player_obj)
            dist_to_enemy = abs(x - ox) + abs(y - oy)
            block = self._find_block_cells(game_state, player_obj, x, y)
            block_bonus = -80 if len(block) >= 3 else (-30 if len(block) >= 2 else 0)
            harvest = self._harvest_score(game_state, x, y)
            # Score: prefer cheap, safe, block-forming cells near enemy with energy potential
            score = friendly * 5 - combat * 10 - cost * 2 - dist_to_enemy * 0.3 + block_bonus + harvest
            scored.append((-score, x, y))
        scored.sort(key=lambda t: t[0])
        best = scored[0]
        ties = [s for s in scored if abs(s[0] - best[0]) < 0.1]
        _, x, y = random.choice(ties)

        game_state._claim_cell(x, y, player_obj)

        # Claim additional block cells if affordable
        block = self._find_block_cells(game_state, player_obj, x, y)
        for bx, by in block:
            cell = game_state.board[bx][by]
            if cell.owner != player_obj or not cell.alive:
                cost = game_state.energy_cost_for_player(bx, by, player_obj)
                if player_obj.energy >= cost:
                    game_state._claim_cell(bx, by, player_obj)


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
                if (
                    (not cell.alive)
                    and (cell.owner in (None, player_obj))
                    and self.can_afford_action(nx, ny, player_obj)
                ):
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
        cost = self.energy_cost_for_player(x, y, player_obj)
        if player_obj.energy < cost:
            return False
        player_obj.energy -= cost
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
        return (
            self.count_friendly_neighbors(x, y, player_obj) > 0
            and self.can_afford_action(x, y, player_obj)
        )

    def update_ownership_around_cell(self, x, y):
        """Update the ownership of the cells around a cell."""
        cell = self.board[x][y]
        player_counts = self._count_neighbor_owners(x, y)
        cell.owner = self._pick_owner_from_counts(cell.owner, player_counts)

    def count_friendly_neighbors(self, x, y, player):
        """Count same-owner alive neighbours (used for click validation)."""
        board = self.board
        sx, sy = self.board_size_x, self.board_size_y
        count = 0
        for i, j in NEIGHBOR_OFFSETS:
            cell = board[(x + i) % sx][(y + j) % sy]
            if cell.alive and cell.owner == player:
                count += 1
        return count

    def count_alive_neighbors(self, x, y):
        """Count ALL alive neighbours regardless of owner (used for GoL rules)."""
        board = self.board
        sx, sy = self.board_size_x, self.board_size_y
        count = 0
        for i, j in NEIGHBOR_OFFSETS:
            cell = board[(x + i) % sx][(y + j) % sy]
            if cell.alive:
                count += 1
        return count

    def update_friend_counts(self, x0=0, y0=0, x1=None, y1=None):
        """Update per-cell neighbour counts for cells in [x0..x1]×[y0..y1]."""
        if x1 is None: x1 = self.board_size_x - 1
        if y1 is None: y1 = self.board_size_y - 1
        board = self.board
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                board[x][y].friendly_neighbors = self.count_alive_neighbors(x, y)

    def _has_unfriendly_neighbor(self, x, y, player):
        """Check if cell has any unfriendly neighbors (for combat)."""
        if player is None:
            return False
        p0 = self.players[0]
        p1 = self.players[1]
        for i, j in NEIGHBOR_OFFSETS:
            neighbor_cell = self.board[(x + i) % self.board_size_x][
                (y + j) % self.board_size_y
            ]
            if neighbor_cell.alive and neighbor_cell.owner is not None:
                # Identity check — avoid expensive dataclass ==
                if neighbor_cell.owner is not p0 and neighbor_cell.owner is not p1:
                    continue
                if neighbor_cell.owner is not player:
                    return True
        return False

    def _compute_new_owner(self, x, y):
        """Compute what the new owner of a cell should be based on neighbors."""
        cell = self.board[x][y]
        player_counts = self._count_neighbor_owners(x, y)
        return self._pick_owner_from_counts(cell.owner, player_counts)

    def _player_idx(self, player) -> int:
        """Fast identity-based player lookup (avoids dataclass __eq__)."""
        return 0 if player is self.players[0] else 1

    def _count_neighbor_owners(self, x: int, y: int) -> list[int]:
        player_counts = [0, 0]
        p0 = self.players[0]
        for i, j in NEIGHBOR_OFFSETS:
            loop_cell = self.board[(x + i) % self.board_size_x][
                (y + j) % self.board_size_y
            ]
            if loop_cell.alive and loop_cell.owner is not None:
                if loop_cell.owner is p0:
                    player_counts[0] += 1
                else:
                    player_counts[1] += 1
        return player_counts

    def _pick_owner_from_counts(
        self, current_owner: Optional[Player], player_counts: list[int]
    ) -> Optional[Player]:
        current_owner_count = (
            player_counts[self._player_idx(current_owner)]
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
        """Update the state of a cell at (x,y)."""
        margin = 1
        x0 = max(0, x - margin)
        y0 = max(0, y - margin)
        x1 = min(self.board_size_x - 1, x + margin)
        y1 = min(self.board_size_y - 1, y + margin)
        self.update_friend_counts(x0, y0, x1, y1)
        change = self._compute_cell_update(x, y)
        if change:
            self._apply_change(change)

    def _compute_active_bounds(self, margin: int = 2):
        """Return active bounds for sparse updates.

        The game board is toroidal, so patterns near an edge can affect the
        opposite edge. When live cells approach any border, fall back to the
        full board so wrap-around births/survivals remain correct.
        """
        board = self.board
        sx, sy = self.board_size_x, self.board_size_y
        xmin, ymin = sx, sy
        xmax, ymax = -1, -1
        for x in range(sx):
            row = board[x]
            for y in range(sy):
                if row[y].alive:
                    if x < xmin: xmin = x
                    if x > xmax: xmax = x
                    if y < ymin: ymin = y
                    if y > ymax: ymax = y
        if xmax < xmin:
            return 0, 0, sx - 1, sy - 1
        if (
            xmin < margin
            or ymin < margin
            or xmax >= sx - margin
            or ymax >= sy - margin
        ):
            return 0, 0, sx - 1, sy - 1
        return (
            max(0, xmin - margin),
            max(0, ymin - margin),
            min(sx - 1, xmax + margin),
            min(sy - 1, ymax + margin),
        )

    def update(self):
        """Update the board.
        Only processes cells within the active bounding box (alive cells +
        margin) instead of the full board, for a significant speedup when
        activity is sparse.
        """
        bounds = self._compute_active_bounds(margin=2)
        x0, y0, x1, y1 = bounds
        self.update_friend_counts(x0, y0, x1, y1)
        changes = self._collect_changes(x0, y0, x1, y1)
        self._apply_changes(changes)
        if self.ai_player:
            self.ai_player.make_move(self)
        return self.board

    def _collect_changes(self, x0=0, y0=0, x1=None, y1=None) -> list[dict]:
        if x1 is None: x1 = self.board_size_x - 1
        if y1 is None: y1 = self.board_size_y - 1
        changes = []
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
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

    def count_owned_cells(
        self,
        player_obj: Player,
        *,
        alive_only: bool = False,
        include_immortal: bool = True,
    ) -> int:
        """Count cells owned by a player, optionally filtering by state."""
        count = 0
        for x in range(self.board_size_x):
            for y in range(self.board_size_y):
                cell = self.board[x][y]
                if cell.owner != player_obj:
                    continue
                if alive_only and not cell.alive:
                    continue
                if not include_immortal and cell.immortal:
                    continue
                count += 1
        return count

    def toroidal_distance_to_player_base(self, x: int, y: int, player_obj: Player) -> int:
        """Return the toroidal Chebyshev distance from a cell to a player's base."""
        sx, sy = player_obj.start_point
        dx = abs(x - sx)
        dy = abs(y - sy)
        dx = min(dx, self.board_size_x - dx)
        dy = min(dy, self.board_size_y - dy)
        return max(dx, dy)

    def energy_cost_for_player(self, x: int, y: int, player_obj: Player) -> float:
        """Return the energy cost to interact with a cell for a player."""
        distance = self.toroidal_distance_to_player_base(x, y, player_obj)
        if distance <= FREE_BASE_RADIUS:
            return 0.0
        return float((distance - FREE_BASE_RADIUS) ** DISTANCE_COST_POWER)

    def can_afford_action(self, x: int, y: int, player_obj: Player) -> bool:
        """Return whether the player can currently afford this cell interaction."""
        return player_obj.energy >= self.energy_cost_for_player(x, y, player_obj)

    @staticmethod
    def compact_cost_label(cost: float) -> str:
        """Return a compact cost label suitable for tiny overlay cells."""
        if cost <= 0:
            return ""
        if cost < 100:
            return str(int(cost))
        if cost < 1000:
            return f"{int(cost / 10) * 10}+"
        return "∞"

    def cost_overlay_background(self, x: int, y: int, player_obj: Optional[Player]) -> str:
        """Return a compact heatmap color for the cell-cost overlay."""
        if player_obj is None:
            return "rgba(0,0,0,0)"
        distance = self.toroidal_distance_to_player_base(x, y, player_obj)
        if distance <= FREE_BASE_RADIUS:
            return "rgba(95, 205, 120, 0.26)"
        intensity = min(0.18 + (distance - FREE_BASE_RADIUS) * 0.06, 0.82)
        return f"rgba(255, 136, 74, {intensity:.2f})"

    def winner_index(self) -> Optional[int]:
        """Return the winning player's index when only one side has territory left.

        A player is defeated once they no longer control any non-immortal cells.
        The immortal star/base may remain visible, but by itself it is not enough
        to keep the player in the game.
        """
        surviving = [
            index
            for index, player in enumerate(self.players)
            if self.count_owned_cells(player, include_immortal=False) > 0
        ]
        if len(surviving) == 1:
            return surviving[0]
        return None

    def _clamp_rgb(self, r, g, b):
        r = int(max(0, min(255, r)))
        g = int(max(0, min(255, g)))
        b = int(max(0, min(255, b)))
        return (r, g, b)

    def generate_cell_color(self, x, y):
        """Generate the background color of a cell.

        Alive cells are bright and owned-color coded.
        Dead cells stay dark so alive/dead contrast remains obvious.
        Harvestable energy is rendered separately as an in-cell bar.
        """
        cell = self.board[x][y]
        if cell.alive and cell.owner is not None:
            return self._clamp_rgb(*cell.owner.color)
        if cell.owner is not None:
            return (34, 34, 34)
        return (24, 24, 24)

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
                html.append(self._cell_html(x, y, current_player_index))
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

    def _cell_html(self, x: int, y: int, current_player_index: Optional[int] = None) -> str:
        color = self.generate_cell_color(x, y)
        border_color = self.generate_cell_border_color(x, y)
        cell = self.board[x][y]
        owner_key = self._cell_owner_key(cell)
        alive_attr = "1" if cell.alive else "0"
        action = self.cell_interaction_hint(x, y, current_player_index)
        cost = self._cell_cost_for_player(x, y, current_player_index)
        return (
            f"<td data-owner='{owner_key}' data-alive='{alive_attr}' data-action='{action}' data-base-action='{action}' data-cost='{cost:.0f}' "
            f"style='width:{CELL_PX}px; height:{CELL_PX}px; background-color:rgb("
            f"{color[0]},{color[1]},{color[2]}); border: 1px solid rgb("
            f"{border_color[0]},{border_color[1]},{border_color[2]});'>"
            f"{self._cell_inner_div(x, y, current_player_index)}</td>"
        )

    def _cell_inner_div(self, x: int, y: int, current_player_index: Optional[int] = None) -> str:
        cell = self.board[x][y]
        player_obj = (
            self.players[current_player_index]
            if current_player_index is not None
            else None
        )
        crop_px = self._crop_bar_px(cell.crop_level) if cell.owner is not None else 0
        cost = self._cell_cost_for_player(x, y, current_player_index)
        cost_label = self.compact_cost_label(cost)
        cost_title = f"Cost {cost_label}" if cost_label else "Free"
        cost_html = (
            f"<span class='cell-cost-overlay' title='{cost_title}' "
            f"style='background:{self.cost_overlay_background(x, y, player_obj)}'></span>"
        )
        territory_html = "<span class='cell-territory-overlay'></span>"
        bar_html = (
            f"<span class='cell-energy-bar' style='height:{crop_px}px'></span>"
            if crop_px > 0
            else "<span class='cell-energy-bar' style='height:0'></span>"
        )
        star_html = "<span class='immortal-star'>★</span>" if cell.immortal else ""
        common = f"class='cell-shell{' cell' if not cell.immortal else ''}' style='height:{CELL_PX}px;width:{CELL_PX}px'"
        if cell.immortal:
            return f"<div {common}>{cost_html}{territory_html}{bar_html}{star_html}</div>"
        return (
            f"<div {common} data-x='{x}' data-y='{y}'>"
            f"{cost_html}{territory_html}{bar_html}{star_html}</div>"
        )

    def _crop_bar_px(self, crop_level: float) -> int:
        """Convert crop level to an in-cell energy bar height."""
        usable_px = max(1, CELL_PX - 2)
        clamped = max(0.0, min(1.0, crop_level))
        return int(round(usable_px * clamped))

    def _cell_cost_for_player(
        self, x: int, y: int, current_player_index: Optional[int]
    ) -> float:
        if current_player_index is None:
            return 0.0
        return self.energy_cost_for_player(x, y, self.players[current_player_index])

    def can_toggle_for_player(self, x: int, y: int, player_obj: Player) -> bool:
        """Return whether the given player can claim/toggle this cell."""
        cell = self.board[x][y]
        if cell.immortal or not self.can_afford_action(x, y, player_obj):
            return False
        if cell.owner == player_obj:
            return True
        return (
            (not cell.alive)
            and (cell.owner in (None, player_obj))
            and (self.count_friendly_neighbors(x, y, player_obj) > 0)
        )

    def cell_interaction_hint(
        self, x: int, y: int, current_player_index: Optional[int]
    ) -> str:
        """Return the client-side action hint for the current player."""
        if current_player_index is None:
            return "none"
        player_obj = self.players[current_player_index]
        if not self.can_toggle_for_player(x, y, player_obj):
            return "none"
        cell = self.board[x][y]
        if cell.owner is None:
            return "claim"
        if cell.alive:
            return "toggle-off"
        return "toggle-on"

    def _cell_owner_key(self, cell: CellState) -> str:
        """Return a stable owner label for DOM/data attributes."""
        if cell.owner == self.players[PLAYER_1]:
            return "p1"
        if cell.owner == self.players[PLAYER_2]:
            return "p2"
        return "none"

    def flip_cell(self, x, y):
        """Flip the state of a cell."""
        if self.is_cell_owned_by_player(x, y):
            self.board[x][y].alive = not self.board[x][y].alive
        return self.board[x][y].alive

    def is_cell_owned_by_player(self, x, y):
        """Check if a cell is owned by the current player."""
        cell = self.board[x][y]
        return cell.owner in (self.players[PLAYER_1], self.players[PLAYER_2])
