"""STARTER SPARRING PARTNERS: smooth random walkers that are pulled toward, or pushed away from, the agent being trained.

They exist only to give a trainer something moving to learn against. They are scaffolding, not part of the locked
competition, and can be deleted (along with the "wanderer" option in trainer.py) once you no longer need them.

    actions = wanderer(env, who, pull=-2.5)       # (B, 2) standard action vector, ready for env.step

pull > 0 is attracted to the other agent (use for a chaser-like partner), pull < 0 is repelled (an evader-like partner).
The wandering is a heading that drifts smoothly (no jitter), so the walker sweeps in curves. The random numbers are the
same for every match in the batch and depend only on the start positions, so a population is scored fairly and
the same start always gives the same walk.
"""
import numpy as np

from env import wrap_angle
from spec import DT, MAX_TICKS, PAD, TURN_RATE


def _wall_at(arena, pts):
    return arena.wall_p[np.floor(pts[:, 1]).astype(int) + PAD, np.floor(pts[:, 0]).astype(int) + PAD]


def _drift(env):
    """A smooth random heading drift for every tick of the match (shared by all matches in the batch)."""
    key = tuple(np.round(env.pos[0].ravel(), 3))
    if env.__dict__.get("_drift_key") != key or env.tick[0] == 0:
        rng = np.random.default_rng(abs(hash(key)) % (2 ** 31))
        rate = np.cumsum(rng.normal(0, 0.18, MAX_TICKS + 1))              # a wandering turn rate...
        rate -= np.convolve(rate, np.ones(40) / 40, mode="same")           # ...kept from running off to one side forever
        env.__dict__["_drift"] = np.cumsum(rate) * 0.25
        env.__dict__["_drift_key"] = key
    return env.__dict__["_drift"]


def wanderer(env, who, pull=-2.5, thrust=0.9, wander=1.0):
    """who: 0 to drive the chaser, 1 to drive the evader. pull: signed attraction to the other agent."""
    me, other = env.pos[:, who], env.pos[:, 1 - who]
    t = np.minimum(env.tick, MAX_TICKS)
    drift = _drift(env)[t]                                                 # (B,) heading a pure wanderer would aim for
    wish = wander * np.stack([np.cos(drift), np.sin(drift)], axis=1)
    d = other - me
    wish = wish + pull * d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-9)
    aim = np.arctan2(wish[:, 1], wish[:, 0])
    head = env.heading[:, who]
    # Walls: probe a little to each side of the aim and swing toward the clearer side if the way is blocked.
    for look in (1.2, 2.2):
        ahead = me + look * np.stack([np.cos(aim), np.sin(aim)], axis=1)
        blocked = _wall_at(env.arena, ahead)
        if blocked.any():
            left = me + look * np.stack([np.cos(aim + 0.9), np.sin(aim + 0.9)], axis=1)
            right = me + look * np.stack([np.cos(aim - 0.9), np.sin(aim - 0.9)], axis=1)
            aim = np.where(blocked, aim + np.where(_wall_at(env.arena, left), -1.3, 1.3), aim)
    turn = np.clip(wrap_angle(aim - head) / (TURN_RATE[who] * DT), -1.0, 1.0)
    return np.stack([turn, np.full(env.B, 2 * thrust - 1)], axis=1)
