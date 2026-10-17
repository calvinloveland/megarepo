# Tag Environment Contract (v1.0)

This is the single source of truth for the game. `env_spec.json` holds every number below in
machine-readable form, and all code (training, validator, tournament) reads its constants from that file.
If this document and the spec ever disagree, that is a bug. Report it.

**The idea:** the world is locked. Your agent is not. You decide *what your network sees*, *how big it is*,
*how it is trained*, and *what it is trained against*. The only thing you submit is a weights JSON file.

Items marked **(provisional)** will be tuned after playtesting, then frozen before the event.

---

## 1. What is locked and what is yours

| Locked (same for everyone) | Yours to change |
|---|---|
| Arena rules, terrain, physics, tick order | Which inputs your network uses (from the catalog) |
| The input catalog and its scaling | Number of layers, units per layer, activations (within limits) |
| The two outputs: turn and thrust | Fitness function, GA or any other training method |
| Tournament format and the arena generator | Population size, mutation, selection, crossover, everything |
| Network limits and the file format | Training arenas (must pass the arena validator) |
| | Training opponents (any logic, including self-play) |

You submit **only a weights JSON file**. No code is ever run from it.

---

## 2. World and arenas

- Coordinates: `x` is the column and increases to the right, `y` is the row and increases downward. One cell is
  1.0 x 1.0, and the top-left corner of the arena is (0, 0). A point belongs to cell (column `floor(x)`, row `floor(y)`).
- Arenas are ASCII files, one character per cell: `#` wall, `.` floor, `~` mud.
- **Arena rules** (a locked validator checks every arena, including your custom training arenas):
  1. Rectangular, using only `#`, `.`, `~`.
  2. Width 30 to 48, height 20 to 32.
  3. The whole outer border is wall.
  4. Interior walls cover at most 25% of the interior cells.
  5. Mud covers at most 25% of the walkable cells.
  6. Floor and mud together form **one connected region** (4-connected: up, down, left, right).
  7. Separate obstacles (8-connected wall groups, the perimeter included) are at least 2 empty cells apart.
  8. There are at least two non-mud floor cells at least 14 cells apart (so a match can start).
- **Terrain:** mud multiplies speed by 0.5 for both roles. It does not affect turning.
- Walls are solid for both agents. Agents do **not** collide with each other.

---

## 3. Agents, roles, and physics

- Every agent has a square collision box with half-width 0.3 around its capsule. It slides along walls and
  can never overlap one. **No agent can ever move farther in one tick than its speed allows.**
- Two roles, set by the file you submit. **(provisional)**

| Role | Max speed (cells/s) | Max turn rate (rad/s) |
|---|---|---|
| chaser | 3.3 | 3.0 |
| evader | 3.0 | 5.0 |

- Time step `dt = 0.1 s`. A match lasts at most 400 ticks (40 s).
- **Tag:** if the distance between the two centers is at most 0.7 after movement, the chaser wins immediately.
  If time runs out, the evader wins.
- **Spawns:** both agents start at the center of a non-mud floor cell, at least 14 cells apart, with a random
  heading. Everything random comes from the match seed (numpy `Generator(PCG64)`), so a match is exactly
  repeatable from its arena and seed.

### Tick order (identical for training and tournaments)

1. Build both observations from the state at the start of the tick.
2. Each agent produces its two raw outputs, which are clamped to [-1, 1].
3. Update both headings, wrapped to [-pi, pi).
4. Compute each speed (mud is looked up at the cell containing the agent's center at the start of the tick).
5. Move both agents along their new headings by `speed * dt`, one axis at a time (x, then y), stopping flush
   against any wall in the way (so agents slide along walls).
6. Record each agent's actual displacement. This becomes next tick's `move_x`, `move_y`.
7. If the tag condition holds, the chaser wins and the match ends. If it was the last tick, the evader wins.

---

## 4. Actions (fixed: exactly 2 outputs, in this order)

| Index | Name | Range | Effect |
|---|---|---|---|
| 0 | `turn` | [-1, 1] | `heading += turn * turn_rate * dt` |
| 1 | `thrust` | [-1, 1] | `speed = max_speed * (thrust + 1) / 2 * terrain multiplier` |

So thrust -1 means stop, 0 means half speed, and +1 means full speed. Outputs outside [-1, 1] are clamped.
Your output layer must have exactly 2 units.

---

## 5. Observations: the input catalog

The environment computes every item below each tick. **Your file lists which ones your network wants, in the
order you want them.** The first layer's input size is the length of that list. You may pick any non-empty
subset with no duplicates, in any order.

### Block values (13 items)

The agent knows the type of 13 cells around it, laid out on a checkerboard pattern in a 5x5 window. Offsets are
relative to the cell containing the agent's center (`dx` columns to the right, `dy` rows down):

```
X . X . X        names:  blk_<dx>_<dy>
. X . X .        e.g.    blk_-2_-2   blk_0_-2   blk_2_-2
X . O . X                blk_-1_-1   blk_1_-1
. X . X .                blk_-2_0    blk_0_0    blk_2_0
X . X . X                blk_-1_1    blk_1_1
                         blk_-2_2    blk_0_2    blk_2_2
```

`blk_0_0` is the cell the agent stands on. Values: **floor 0.0, mud 0.5, wall 1.0**, and anything outside the
arena counts as wall (1.0). The window is aligned to the world (it does not rotate with the agent).

### Self and opponent (8 items)

| Name | Meaning |
|---|---|
| `self_x`, `self_y` | own center x and y, divided by 48 |
| `heading_cos`, `heading_sin` | cos and sin of own heading (y points down) |
| `move_x`, `move_y` | own displacement during the previous tick (after mud and walls), divided by 0.33 (zero on tick 0) |
| `opp_x`, `opp_y` | the opponent's center x and y, divided by 48 (always known) |

There are **21 items** in total.

**A hint, not a feature:** the catalog gives *positions*, not *directions*. The direction to your opponent is
not provided. Think about what your first layer would need to compute to find it, and whether you want to
spend network capacity on that.

---

## 6. Matches and tournaments

- A **series** is one chaser file against one evader file: **best of five**.
- The five matches are played on **five different arenas** (40 x 28, produced by the locked arena generator from
  the organizer's secret seed), one match per arena. Nobody sees these arenas in advance.
- The chaser wins a match by tagging. The evader wins a match by surviving 40 s. **First to 3 match wins takes
  the series.**
- How participants are paired into a bracket is the organizer's decision.

---

## 7. Practice opponents (sparring partners)

There is no random target any more. Two deterministic opponents ship with the environment. They act only
through the standard action vector, so the physics is identical to a trained agent:

- **omniscient_chaser:** takes the shortest walking route around walls to the evader's true position at full thrust.
- **omniscient_evader:** heads for the open cell it can reach before the chaser that is farthest from the chaser (open
  space preferred over dead ends), walking around walls.

Two **baseline agents** (`baselines/baseline_chaser.json`, `baselines/baseline_evader.json`) are ordinary weights files
made with the starter trainer; they are mid-skill and meant for testing against. The starter trainer can also train
against a smooth random **wanderer** (a training aid, not part of the locked competition). Using any of these is optional. You may train against anything, including your own earlier agents.

---

## 8. Agent file format (schema version 1)

```json
{
  "schema_version": 1,
  "env_version": "1.0",
  "name": "Team Hotdog",
  "role": "chaser",
  "color": "#ff8800",
  "inputs": ["blk_0_0", "blk_1_1", "self_x", "self_y", "opp_x", "opp_y"],
  "layers": [
    {"units": 16, "activation": "tanh"},
    {"units": 2,  "activation": "tanh"}
  ],
  "weights": [ ... flat list of numbers ... ]
}
```

- `name`: 1 to 24 characters from letters, digits, space, and `_ . ' ! -`.
- `color`: a `#rrggbb` hex string. This is your capsule color in the viewer.
- `notes` (optional): free text of at most 500 characters, ignored.
- **Weight layout:** for each layer in order, first the kernel `W` (shape `n_in x units`, row-major), then the
  bias `b` (length `units`). A layer computes `activation(x @ W + b)`. The first layer's `n_in` is
  `len(inputs)`; every later layer's `n_in` is the previous layer's `units`.
- **Parameter count** = the sum over layers of `(n_in + 1) * units`. `len(weights)` must match it exactly.
- **Activations:** `tanh`, `relu`, `leaky_relu` (slope 0.01), `sigmoid`, `linear`.

### Network limits

| Limit | Value |
|---|---|
| Weight layers (hidden layers + output) | at most 6 |
| Units in any layer | at most 256 |
| Total parameters | at most 50,000 |
| Largest allowed `\|weight\|` | 100 |
| Output layer | exactly 2 units |
| File size | at most 2 MB (a maximum-size network is about 1.2 MB) |

### Validation (run it before the event, the tournament runs the same code)

Checks, each with a plain-language failure message:

1. Valid JSON (NaN and Infinity are rejected), required keys present, `schema_version` is 1, `env_version` matches.
2. Name, role, and color are valid.
3. Every entry of `inputs` is in the catalog, with no duplicates and at least one.
4. Layer sizes are positive integers within the limits, and the last layer has 2 units.
5. Every activation is on the list.
6. `len(weights)` equals the parameter count, and every weight is a finite number within bounds.
7. A short smoke match (30 ticks against a practice opponent) runs without errors and the network's outputs are finite.

The validator also prints a **network summary** so you can watch your budget while designing, for example:

```
inputs 6 -> 16 (tanh) -> 2 (tanh)
layers 2 of 6 | widest 16 of 256 | parameters 146 of 50,000 (0.3%)
```

---

## 9. Replay output (what the viewer reads)

Each match produces a replay (`replay_version` 2): arena name and rows, `dt`, tag radius, frame count,
`tag_tick` (null if no tag), `winner`, and for each agent its name, role, color, and per-frame `x`, `y`,
`heading`. The viewer shows names above the capsules, in each agent's color.

---

## 10. Versioning

Every agent file carries `env_version`. A file with a different version is refused with a clear message.
Any change to the numbers in `env_spec.json` bumps the version.
