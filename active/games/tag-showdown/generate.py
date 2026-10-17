"""The locked arena generator. Same seed, same arena, always. Every arena it returns passes validate_arena.

    python generate.py --seed 123 --count 5 --out my_arenas/     write 5 arenas (arena_1.txt ...)
    python generate.py --text "event secret" --count 5           seed from any text, just print them

Tournaments use tournament_arenas(): one secret seed produces the five arenas and their match seeds.
"""
import argparse
import hashlib
import os

import numpy as np

from arena import Arena, ArenaError, validate_arena
from spec import SPEC

TOURNEY = SPEC["tournament"]


def seed_from_text(text):
    """Any text becomes a stable integer seed."""
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")


# ---------------------------------------------------------------- obstacle shapes (cell offsets)
def _bar(rng):
    n, t = int(rng.integers(4, 11)), int(rng.integers(1, 3))
    return {(r, c) for r in range(t) for c in range(n)}


def _rect(rng):
    return {(r, c) for r in range(int(rng.integers(2, 7))) for c in range(int(rng.integers(2, 7)))}


def _ell(rng):
    a, b, t = int(rng.integers(4, 9)), int(rng.integers(4, 9)), int(rng.integers(1, 3))
    return {(r, c) for r in range(t) for c in range(a)} | {(r, c) for r in range(b) for c in range(t)}


def _tee(rng):
    n, s, t = int(rng.integers(5, 10)), int(rng.integers(3, 7)), int(rng.integers(1, 3))
    mid = n // 2
    return {(r, c) for r in range(t) for c in range(n)} | {(r, c) for r in range(t, t + s) for c in range(mid, mid + t)}


def _plus(rng):
    k = int(rng.integers(2, 5))
    return {(k, c) for c in range(2 * k + 1)} | {(r, k) for r in range(2 * k + 1)}


def _cup(rng):
    w, h = int(rng.integers(5, 9)), int(rng.integers(3, 6))
    return ({(h - 1, c) for c in range(w)} | {(r, 0) for r in range(h)} | {(r, w - 1) for r in range(h)})


def _blob(rng):
    n = int(rng.integers(6, 17))
    cells, frontier = {(0, 0)}, [(0, 0)]
    for _ in range(n * 6):
        if len(cells) >= n:
            break
        r, c = frontier[int(rng.integers(len(frontier)))]
        dr, dc = [(1, 0), (-1, 0), (0, 1), (0, -1)][int(rng.integers(4))]
        cells.add((r + dr, c + dc))
        frontier.append((r + dr, c + dc))
    return cells


SHAPES = [_bar, _rect, _rect, _ell, _tee, _plus, _cup, _blob, _blob]


def _transform(cells, rng):
    for _ in range(int(rng.integers(4))):
        cells = {(c, -r) for r, c in cells}                  # rotate 90 degrees
    if rng.integers(2):
        cells = {(r, -c) for r, c in cells}                  # mirror
    r0, c0 = min(r for r, _ in cells), min(c for _, c in cells)
    return {(r - r0, c - c0) for r, c in cells}


# -------------------------------------------------------------------------------- the generator
def _build(rng, width, height):
    wall = np.zeros((height, width), bool)
    wall[0, :] = wall[-1, :] = wall[:, 0] = wall[:, -1] = True
    interior = (width - 2) * (height - 2)
    target = rng.uniform(0.08, 0.18) * interior
    placed = 0
    for _ in range(300):
        if placed >= target:
            break
        cells = _transform(SHAPES[int(rng.integers(len(SHAPES)))](rng), rng)
        sh, sw = max(r for r, _ in cells) + 1, max(c for _, c in cells) + 1
        if sh > height - 6 or sw > width - 6:
            continue
        r0, c0 = int(rng.integers(3, height - 3 - sh + 1)), int(rng.integers(3, width - 3 - sw + 1))
        if wall[max(0, r0 - 2):r0 + sh + 2, max(0, c0 - 2):c0 + sw + 2].any():      # keep a 2-cell gap
            continue
        for r, c in cells:
            wall[r0 + r, c0 + c] = True
        placed += len(cells)

    mud = np.zeros_like(wall)
    walkable = int((~wall).sum())
    mud_target = rng.uniform(0.06, 0.18) * walkable
    for _ in range(200):
        if mud.sum() >= mud_target:
            break
        cells = _transform(_blob(rng) if rng.integers(2) else _rect(rng), rng)
        r0, c0 = int(rng.integers(1, height - 1)), int(rng.integers(1, width - 1))
        for r, c in cells:
            if 0 < r0 + r < height - 1 and 0 < c0 + c < width - 1 and not wall[r0 + r, c0 + c]:
                mud[r0 + r, c0 + c] = True
    return ["".join("#" if wall[y, x] else "~" if mud[y, x] else "." for x in range(width)) for y in range(height)]


def generate_arena(seed, width=TOURNEY["arena_width"], height=TOURNEY["arena_height"], name=None):
    """A valid arena for this seed (int or numpy SeedSequence)."""
    rng = np.random.default_rng(seed)
    for _ in range(500):
        rows = _build(rng, width, height)
        if not validate_arena(rows):
            return Arena(rows, name or f"seed_{seed}" if isinstance(seed, int) else name or "arena")
    raise ArenaError(f"Could not generate a valid {width}x{height} arena for this seed.")


def tournament_arenas(secret_seed):
    """The tournament's arenas: a list of (arena, match_seed). secret_seed is an int or any text."""
    if isinstance(secret_seed, str):
        secret_seed = seed_from_text(secret_seed)
    out = []
    for i, child in enumerate(np.random.SeedSequence(secret_seed).spawn(TOURNEY["matches"])):
        arena_seq, match_seq = child.spawn(2)
        arena = generate_arena(arena_seq, name=f"arena_{i + 1}")
        out.append((arena, int(match_seq.generate_state(1)[0]) % (2 ** 31)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--seed", type=int)
    g.add_argument("--text", help="any text, used to derive the seed")
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--width", type=int, default=TOURNEY["arena_width"])
    ap.add_argument("--height", type=int, default=TOURNEY["arena_height"])
    ap.add_argument("--out", help="folder to write arena_1.txt, arena_2.txt, ... into")
    a = ap.parse_args()
    base = a.seed if a.seed is not None else seed_from_text(a.text)
    for i, child in enumerate(np.random.SeedSequence(base).spawn(a.count)):
        arena = generate_arena(child, a.width, a.height, name=f"arena_{i + 1}")
        print(f"\n{arena.name}\n{arena.text()}")
        if a.out:
            os.makedirs(a.out, exist_ok=True)
            with open(os.path.join(a.out, arena.name + ".txt"), "w") as f:
                f.write(arena.text())


if __name__ == "__main__":
    main()
