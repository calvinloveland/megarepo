"""Deterministic practice opponents. They are omniscient (they read the true positions and the true map) but act
only through the standard [turn, thrust] vector, so the physics they face is identical to a trained agent's.

    actions = OPPONENTS["omniscient_chaser"](env)      # (B, 2), ready to pass to env.step

Both plan on walking-distance fields (how many cells it takes to walk from one cell to every other), cached per arena.
"""
from collections import deque

import numpy as np

from env import CHASER, EVADER, wrap_angle
from spec import DT, PAD, TURN_RATE

FAR = 9999
_MOVES = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]    # row, column steps


def _field(arena, col, row):
    """Walking distance in steps from cell (col, row) to every cell. Diagonal steps are allowed only when both
    neighbouring cells are open (no corner cutting). Cached on the arena."""
    cache = arena.__dict__.setdefault("_field_cache", {})
    f = cache.get((col, row))
    if f is None:
        f = np.full((arena.height, arena.width), FAR, dtype=np.int32)
        open_ = ~arena.wall
        f[row, col] = 0
        todo = deque([(row, col)])
        while todo:
            r, c = todo.popleft()
            d = f[r, c] + 1
            for dr, dc in _MOVES:
                nr, nc = r + dr, c + dc
                if open_[nr, nc] and f[nr, nc] > d and (dr == 0 or dc == 0 or (open_[r + dr, c] and open_[r, c + dc])):
                    f[nr, nc] = d
                    todo.append((nr, nc))
        cache[(col, row)] = f
    return f


def _next_cell(arena, field, col, row):
    """The neighbouring cell (reachable without cutting a corner) with the smallest field value, or None if no
    neighbour improves on the current cell."""
    open_, best, cur = ~arena.wall, None, field[row, col]
    for dr, dc in _MOVES:
        nr, nc = row + dr, col + dc
        if open_[nr, nc] and (dr == 0 or dc == 0 or (open_[row + dr, col] and open_[row, col + dc])) and field[nr, nc] < cur:
            if best is None or field[nr, nc] < field[best]:
                best = (nr, nc)
    return best


def _line_clear(arena, a, b):
    """True where the straight line from a to b crosses no wall. a, b: (B, 2)."""
    t = np.linspace(0.0, 1.0, 96)[None, :, None]
    pts = a[:, None, :] + (b - a)[:, None, :] * t
    return ~arena.wall_p[np.floor(pts[..., 1]).astype(int) + PAD, np.floor(pts[..., 0]).astype(int) + PAD].any(axis=1)


def _steer(env, who, goal):
    """Turn as hard as allowed toward a goal point, at full thrust."""
    d = goal - env.pos[:, who]
    err = wrap_angle(np.arctan2(d[:, 1], d[:, 0]) - env.heading[:, who])
    return np.stack([np.clip(err / (TURN_RATE[who] * DT), -1.0, 1.0), np.ones(env.B)], axis=1)


def omniscient_chaser(env):
    """Runs straight at the evader when it can see it, otherwise follows the shortest walking route around walls."""
    A, goal = env.arena, env.pos[:, EVADER].copy()
    clear = _line_clear(A, env.pos[:, CHASER], goal)
    for b in np.flatnonzero(~clear):
        field = _field(A, int(goal[b, 0]), int(goal[b, 1]))
        nxt = _next_cell(A, field, int(env.pos[b, CHASER, 0]), int(env.pos[b, CHASER, 1]))
        if nxt is not None:
            goal[b] = (nxt[1] + 0.5, nxt[0] + 0.5)
    return _steer(env, CHASER, goal)


REPLAN_TICKS = 1      # the evader re-picks its destination every tick, so its choice depends only on the current positions (easy to imitate)
OPEN_WEIGHT = 8.0     # how much open space (away from corners and edges) matters compared with one step of extra distance from the chaser


def _openness(arena):
    """Fraction of open cells in the 5x5 neighbourhood of every cell (corners are low, open floor is 1.0). Cached."""
    o = arena.__dict__.get("_openness")
    if o is None:
        padded = np.pad((~arena.wall).astype(float), 2)
        o = sum(padded[dy:dy + arena.height, dx:dx + arena.width] for dy in range(5) for dx in range(5)) / 25
        arena.__dict__["_openness"] = o
    return o


def omniscient_evader(env):
    """Heads for the open cell it can reach before the chaser that is farthest from the chaser (open space preferred over
    dead ends), walking around walls. Falls back to running directly away when nowhere is safe."""
    A, open_, openness = env.arena, ~env.arena.wall, _openness(env.arena)
    plan = env.__dict__.setdefault("_evader_plan", np.full((env.B, 2), -1))      # destination (column, row) per match
    goal = env.pos[:, EVADER].copy()
    for b in range(env.B):
        ec, er = int(env.pos[b, EVADER, 0]), int(env.pos[b, EVADER, 1])
        if env.tick[b] % REPLAN_TICKS == 0 or plan[b, 0] < 0:
            fc = _field(A, int(env.pos[b, CHASER, 0]), int(env.pos[b, CHASER, 1]))
            safe = open_ & (_field(A, ec, er) < fc)
            if safe.any():
                tr, tc = np.unravel_index(np.where(safe, fc + OPEN_WEIGHT * openness, -1.0).argmax(), safe.shape)
                plan[b] = (tc, tr)
            else:
                plan[b] = (-1, -1)
        if plan[b, 0] >= 0:
            nxt = _next_cell(A, _field(A, int(plan[b, 0]), int(plan[b, 1])), ec, er)
            if nxt is not None:
                goal[b] = (nxt[1] + 0.5, nxt[0] + 0.5)
                continue
            plan[b] = (-1, -1)                                                    # arrived: pick a new destination next tick
        away = env.pos[b, EVADER] - env.pos[b, CHASER]
        goal[b] = env.pos[b, EVADER] + away / (np.linalg.norm(away) + 1e-9)
    return _steer(env, EVADER, goal)


OPPONENTS = {"omniscient_chaser": omniscient_chaser, "omniscient_evader": omniscient_evader}
