"""Arenas: parsing and the arena validator.

An arena is a text file, one character per cell:  # wall   . floor   ~ mud
Check one from the command line:   python arena.py my_arena.txt
Rows and columns in messages are counted from 1, the way you see them in a text editor.
"""
import os
import sys
from collections import deque

import numpy as np

from spec import BLOCK_VALUES, MIN_SEP, PAD, SPEC

RULES = SPEC["arena_rules"]
ALLOWED = set(RULES["allowed_characters"])


class ArenaError(ValueError):
    """Raised for an arena that breaks the rules. The message lists every problem found."""


def _structure_problems(rows):
    if not rows:
        return ["The arena is empty."]
    problems, width = [], len(rows[0])
    for i, r in enumerate(rows):
        if len(r) != width:
            problems.append(f"Row {i + 1} has {len(r)} characters but row 1 has {width}; every row must be the same length.")
        bad = sorted(set(r) - ALLOWED)
        if bad:
            problems.append(f"Row {i + 1} contains {bad}; only # . ~ are allowed.")
    return problems


def _grids(rows):
    wall = np.array([[c == "#" for c in r] for r in rows])
    mud = np.array([[c == "~" for c in r] for r in rows])
    return wall, mud


def _label(mask, eight):
    """Connected components of a boolean grid. Returns (labels, count); label 0 = not in the mask."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=int)
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if eight:
        steps += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    count = 0
    for r0, c0 in np.argwhere(mask):
        if labels[r0, c0]:
            continue
        count += 1
        labels[r0, c0] = count
        todo = deque([(r0, c0)])
        while todo:
            r, c = todo.popleft()
            for dr, dc in steps:
                nr, nc = r + dr, c + dc
                if 0 <= nr < h and 0 <= nc < w and mask[nr, nc] and not labels[nr, nc]:
                    labels[nr, nc] = count
                    todo.append((nr, nc))
    return labels, count


def _far_pair_exists(cells, min_sep):
    pts = cells.astype(float)
    for start in range(0, len(pts), 256):
        d2 = ((pts[start:start + 256, None, :] - pts[None, :, :]) ** 2).sum(-1)
        if (d2 >= min_sep ** 2).any():
            return True
    return False


def validate_arena(rows):
    """Returns a list of plain-language problems. An empty list means the arena is valid."""
    problems = _structure_problems(rows)
    if problems:
        return problems
    h, w = len(rows), len(rows[0])
    wall, mud = _grids(rows)

    wr, hr = RULES["width"], RULES["height"]
    if not wr["min"] <= w <= wr["max"]:
        problems.append(f"Width is {w}; it must be between {wr['min']} and {wr['max']}.")
    if not hr["min"] <= h <= hr["max"]:
        problems.append(f"Height is {h}; it must be between {hr['min']} and {hr['max']}.")
    if h < 3 or w < 3:
        return problems + ["The arena is too small to have an interior."]

    border = np.ones((h, w), bool)
    border[1:-1, 1:-1] = False
    gaps = np.argwhere(border & ~wall)
    if len(gaps):
        r, c = gaps[0]
        problems.append(f"The outer border must be all wall (#), but {len(gaps)} border cell(s) are not; the first is at row {r + 1}, column {c + 1}.")

    interior = wall[1:-1, 1:-1]
    frac = interior.mean()
    if frac > RULES["max_interior_wall_fraction"]:
        problems.append(f"Interior walls cover {frac:.0%} of the interior; the limit is {RULES['max_interior_wall_fraction']:.0%}.")

    walkable = ~wall
    mud_frac = mud.sum() / max(walkable.sum(), 1)
    if mud_frac > RULES["max_mud_fraction_of_walkable"]:
        problems.append(f"Mud covers {mud_frac:.0%} of the walkable area; the limit is {RULES['max_mud_fraction_of_walkable']:.0%}.")

    labels, n = _label(walkable, eight=False)
    if n > 1:
        sizes = np.bincount(labels.ravel())[1:]
        main = int(sizes.argmax()) + 1
        cut = np.argwhere(walkable & (labels != main))
        r, c = cut[0]
        problems.append(f"The walkable area is split into {n} separate regions; {len(cut)} cell(s) are cut off, the first at row {r + 1}, column {c + 1}.")

    wl, _ = _label(wall, eight=True)
    lp = np.pad(wl, 2)
    gap = RULES["min_gap_between_obstacles_cells"]
    close = np.zeros((h, w), bool)
    for dy in range(-gap, gap + 1):
        for dx in range(-gap, gap + 1):
            if dy or dx:
                nb = lp[2 + dy:2 + dy + h, 2 + dx:2 + dx + w]
                close |= (wl > 0) & (nb > 0) & (nb != wl)
    if close.any():
        r, c = np.argwhere(close)[0]
        problems.append(f"Obstacles must be at least {gap} empty cells apart (the perimeter counts as an obstacle); the wall at row {r + 1}, column {c + 1} is too close to a different one.")

    spawn = np.argwhere(~wall & ~mud)
    if len(spawn) < 2 or not _far_pair_exists(spawn, MIN_SEP):
        problems.append(f"There must be two floor cells (not mud) at least {MIN_SEP:g} cells apart so a match can start.")
    return problems


class Arena:
    """Parsed arena with the lookup tables the environment needs.
    Padded arrays (suffix _p) are offset by PAD cells and count everything outside the arena as wall."""

    def __init__(self, rows, name="arena", validate=True):
        rows = [r.rstrip("\n") for r in rows]
        problems = validate_arena(rows) if validate else _structure_problems(rows)
        if problems:
            raise ArenaError(f"Arena '{name}' is not valid:\n  - " + "\n  - ".join(problems))
        self.rows, self.name = rows, name
        self.height, self.width = len(rows), len(rows[0])
        self.wall, self.mud = _grids(rows)
        self.blocks = np.where(self.wall, BLOCK_VALUES["wall"],
                               np.where(self.mud, BLOCK_VALUES["mud"], BLOCK_VALUES["floor"]))
        self.wall_p = np.pad(self.wall, PAD, constant_values=True)
        self.mud_p = np.pad(self.mud, PAD, constant_values=False)
        self.block_p = np.pad(self.blocks, PAD, constant_values=BLOCK_VALUES["outside_arena"])
        self.spawn_cells = np.argwhere(~self.wall & ~self.mud)[:, ::-1]      # (column, row)

    @classmethod
    def from_file(cls, path, validate=True):
        with open(path) as f:
            rows = [line.rstrip("\n") for line in f if line.strip()]
        return cls(rows, os.path.splitext(os.path.basename(path))[0], validate)

    def text(self):
        return "\n".join(self.rows) + "\n"


def load_arena(path):
    return Arena.from_file(path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1]) as f:
        found = validate_arena([line.rstrip("\n") for line in f if line.strip()])
    if found:
        print("NOT VALID:")
        for p in found:
            print("  -", p)
        sys.exit(1)
    print("Valid arena.")
