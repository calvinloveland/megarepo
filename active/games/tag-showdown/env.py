"""The locked environment. One arena, B independent matches running side by side (B=1 for a tournament
match, B=population size for training). Follows the tick order in CONTRACT.md exactly.

    env = TagEnv(arena, batch=1)
    env.reset(seed)
    obs = env.observe("chaser")              # (B, 21) full catalog, columns in spec.CATALOG order
    env.step(chaser_actions, evader_actions) # each (B, 2): raw [turn, thrust], clamped to [-1, 1]
    env.done, env.winner, env.tag_tick       # per-match results

Agent index 0 is the chaser and 1 the evader in every (B, 2, ...) array.
"""
import numpy as np

from arena import ArenaError
from spec import (BLOCK_OFFSETS, CATALOG, COORD_SCALE, DT, MAX_SPEED, MAX_TICKS, MIN_SEP, MOVE_SCALE, MUD_MULT,
                  PAD, RADIUS, ROLES, TAG_RADIUS, TURN_RATE)

CHASER, EVADER = 0, 1
_BLK_DX = np.array([o[0] for o in BLOCK_OFFSETS])
_BLK_DY = np.array([o[1] for o in BLOCK_OFFSETS])


def wrap_angle(a):
    """Wrap to [-pi, pi)."""
    return (a + np.pi) % (2 * np.pi) - np.pi


def spawn(arena, seed):
    """Deterministic start for one match: chaser position, evader position, both headings."""
    rng = np.random.Generator(np.random.PCG64(int(seed)))
    centers = arena.spawn_cells + 0.5
    for _ in range(1000):
        i = int(rng.integers(len(centers)))
        far = np.flatnonzero(np.linalg.norm(centers - centers[i], axis=1) >= MIN_SEP)
        if len(far):
            j = int(far[int(rng.integers(len(far)))])
            return centers[i], centers[j], rng.uniform(-np.pi, np.pi, 2)
    raise ArenaError(f"Arena '{arena.name}' has no two floor cells {MIN_SEP:g} apart to start a match.")


class TagEnv:
    def __init__(self, arena, batch=1, record=False):
        self.arena, self.B, self.record = arena, int(batch), record
        self.reset(0)

    # ------------------------------------------------------------------ state
    def reset(self, seeds=0):
        """seeds: one int (every match gets the same start, which is fair for comparing a population)
        or a sequence of B ints (a different start per match)."""
        seeds = np.broadcast_to(np.asarray(seeds, dtype=np.int64), (self.B,))
        self.pos = np.zeros((self.B, 2, 2))
        self.heading = np.zeros((self.B, 2))
        for b, s in enumerate(seeds):
            c, e, h = spawn(self.arena, s)
            self.pos[b, CHASER], self.pos[b, EVADER], self.heading[b] = c, e, h
        self.move = np.zeros((self.B, 2, 2))
        self.tick = np.zeros(self.B, dtype=int)
        self.done = np.zeros(self.B, dtype=bool)
        self.winner = np.zeros(self.B, dtype=np.int8)        # 0 none yet, 1 chaser, 2 evader
        self.tag_tick = np.full(self.B, -1, dtype=int)
        if self.record:
            self.hist_pos, self.hist_head = [self.pos.copy()], [self.heading.copy()]

    @property
    def all_done(self):
        return bool(self.done.all())

    def distance(self):
        return np.linalg.norm(self.pos[:, CHASER] - self.pos[:, EVADER], axis=1)

    # ----------------------------------------------------------- observations
    def _cells(self, p):
        return np.floor(p[..., 0]).astype(int), np.floor(p[..., 1]).astype(int)      # column, row

    def observe(self, role):
        """Full input catalog for one role, shape (B, len(CATALOG)), columns in spec.CATALOG order."""
        me, opp = ROLES.index(role), 1 - ROLES.index(role)
        p, o = self.pos[:, me], self.pos[:, opp]
        col, row = self._cells(p)
        blocks = self.arena.block_p[row[:, None] + _BLK_DY + PAD, col[:, None] + _BLK_DX + PAD]
        h = self.heading[:, me]
        rest = np.stack([p[:, 0] / COORD_SCALE, p[:, 1] / COORD_SCALE, np.cos(h), np.sin(h),
                         self.move[:, me, 0] / MOVE_SCALE, self.move[:, me, 1] / MOVE_SCALE,
                         o[:, 0] / COORD_SCALE, o[:, 1] / COORD_SCALE], axis=1)
        return np.concatenate([blocks, rest], axis=1)

    # ---------------------------------------------------------------- physics
    def _slide(self, p, d):
        """Move square collision boxes (half-width RADIUS) by d, one axis at a time, stopping flush against walls.
        Clamping can only shorten a move, so an agent never travels farther than its speed allows."""
        wp, eps = self.arena.wall_p, 1e-12
        x, y = p[:, 0], p[:, 1]
        # x axis: look at the cells just past the leading edge, across the box's height
        nx = x + d[:, 0]
        col = np.floor(nx + np.sign(d[:, 0]) * RADIUS).astype(int)
        r0, r1 = np.floor(y - RADIUS).astype(int), np.floor(y + RADIUS).astype(int)
        hit = (d[:, 0] != 0) & (wp[r0 + PAD, col + PAD] | wp[r1 + PAD, col + PAD])
        nx = np.where(hit, np.where(d[:, 0] > 0, np.maximum(x, col - RADIUS - eps), np.minimum(x, col + 1 + RADIUS + eps)), nx)
        # y axis, using the x we just settled on
        ny = y + d[:, 1]
        row = np.floor(ny + np.sign(d[:, 1]) * RADIUS).astype(int)
        c0, c1 = np.floor(nx - RADIUS).astype(int), np.floor(nx + RADIUS).astype(int)
        hit = (d[:, 1] != 0) & (wp[row + PAD, c0 + PAD] | wp[row + PAD, c1 + PAD])
        ny = np.where(hit, np.where(d[:, 1] > 0, np.maximum(y, row - RADIUS - eps), np.minimum(y, row + 1 + RADIUS + eps)), ny)
        return np.stack([nx, ny], axis=1)

    def _mud(self, p):
        col, row = self._cells(p)
        return self.arena.mud_p[row + PAD, col + PAD]

    def step(self, chaser_actions, evader_actions):
        """Advance every unfinished match by one tick."""
        raw = np.stack([np.asarray(chaser_actions, float).reshape(self.B, 2),
                        np.asarray(evader_actions, float).reshape(self.B, 2)], axis=1)
        act = np.clip(np.nan_to_num(raw, nan=0.0, posinf=1.0, neginf=-1.0), -1.0, 1.0)     # (B, 2, 2)
        alive = ~self.done

        heading = wrap_angle(self.heading + act[..., 0] * TURN_RATE * DT)                  # steps 2-3
        mult = np.where(self._mud(self.pos), MUD_MULT, 1.0)                                # step 4
        speed = MAX_SPEED * (act[..., 1] + 1) / 2 * mult
        step_vec = np.stack([np.cos(heading), np.sin(heading)], axis=-1) * (speed * DT)[..., None]
        new_pos = self._slide(self.pos.reshape(-1, 2), step_vec.reshape(-1, 2)).reshape(self.B, 2, 2)   # step 5

        live = alive[:, None]
        self.move = np.where(live[..., None], new_pos - self.pos, self.move)               # step 6
        self.pos = np.where(live[..., None], new_pos, self.pos)
        self.heading = np.where(live, heading, self.heading)
        self.tick = self.tick + alive

        tagged = alive & (self.distance() <= TAG_RADIUS)                                   # step 7
        timeout = alive & ~tagged & (self.tick >= MAX_TICKS)
        self.winner[tagged], self.winner[timeout] = 1, 2
        self.tag_tick[tagged] = self.tick[tagged]
        self.done |= tagged | timeout
        if self.record:
            self.hist_pos.append(self.pos.copy())
            self.hist_head.append(self.heading.copy())
