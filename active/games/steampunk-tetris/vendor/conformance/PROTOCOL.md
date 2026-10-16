# Tetris Protocol v2 (real-time)

Your game is a **web page**. It runs its own clock, its own rendering, and its own physics.
The Arena loads it in a sandboxed iframe and talks to it with `postMessage`.
A bot drives it through exactly the same messages, so **any compliant bot can play any compliant game**.

> **v2 is real-time.** Pieces fall on their own. A bot that does nothing will still lose a game.
> This replaces the turn-based v1 protocol.

Everything in this document is **mandatory** unless marked optional. Where the spec is explicit, it wins over
"how Tetris usually works". Your colours, sounds, animations, and layout are entirely yours — see
[`FEATURES.md`](FEATURES.md).

---

## 1. Board and coordinates

- The board is **10 columns x 20 rows**. `x` is the column (0 = left), `y` is the row (0 = top).
- `board` is an array of 20 strings of length 10, **top row first**. `.` is empty; `I O T S Z J L` mark locked
  cells of that piece type.
- Cells above row 0 do not exist. A move or rotation that would put any cell outside the board or onto a filled
  cell is **illegal**.
- The falling piece is **not** drawn into `board`. It is reported separately in `piece`.

## 2. Pieces and rotation (SRS)

Each piece lives in a square box (4x4 for `I`, `O` is treated as 4x4 with its cells as below, 3x3 for the rest).
`rotation` is 0-3 (0 = spawn, 1 = clockwise, 2 = 180, 3 = counter-clockwise). A piece is described by `x`, `y`
(top-left of its box) and `rotation`. Cells are `(col, row)` offsets inside the box:

| Piece | rot 0 | rot 1 | rot 2 | rot 3 |
|-------|-------|-------|-------|-------|
| I | (0,1)(1,1)(2,1)(3,1) | (2,0)(2,1)(2,2)(2,3) | (0,2)(1,2)(2,2)(3,2) | (1,0)(1,1)(1,2)(1,3) |
| O | (1,0)(2,0)(1,1)(2,1) | same | same | same |
| T | (1,0)(0,1)(1,1)(2,1) | (1,0)(1,1)(2,1)(1,2) | (0,1)(1,1)(2,1)(1,2) | (1,0)(0,1)(1,1)(1,2) |
| S | (1,0)(2,0)(0,1)(1,1) | (1,0)(1,1)(2,1)(2,2) | (1,1)(2,1)(0,2)(1,2) | (0,0)(0,1)(1,1)(1,2) |
| Z | (0,0)(1,0)(1,1)(2,1) | (2,0)(1,1)(2,1)(1,2) | (0,1)(1,1)(1,2)(2,2) | (1,0)(0,1)(1,1)(0,2) |
| J | (0,0)(0,1)(1,1)(2,1) | (1,0)(2,0)(1,1)(1,2) | (0,1)(1,1)(2,1)(2,2) | (1,0)(1,1)(0,2)(1,2) |
| L | (2,0)(0,1)(1,1)(2,1) | (1,0)(1,1)(1,2)(2,2) | (0,1)(1,1)(2,1)(0,2) | (0,0)(1,0)(1,1)(1,2) |

**Spawn.** A new piece appears at `x = 3`, `y = 0`, `rotation = 0`. If any spawn cell is already filled, the game
is over (see §6).

**Rotation.** Rotating tries the new orientation in place first, then the standard SRS wall-kick offsets. The
first legal position wins; if none is legal the rotation is **illegal** and nothing changes.

Kick tables are `(dx, dy)` in board coordinates, where **`+y` is downward**. Tested in the order listed, after
the in-place attempt:

J, L, S, T, Z:

| Transition | Kicks |
|---|---|
| 0->1 | (-1,0) (-1,-1) (0,2) (-1,2) |
| 1->0 | (1,0) (1,1) (0,-2) (1,-2) |
| 1->2 | (1,0) (1,1) (0,-2) (1,-2) |
| 2->1 | (-1,0) (-1,-1) (0,2) (-1,2) |
| 2->3 | (1,0) (1,-1) (0,2) (1,2) |
| 3->2 | (-1,0) (-1,1) (0,-2) (-1,-2) |
| 3->0 | (-1,0) (-1,1) (0,-2) (-1,-2) |
| 0->3 | (1,0) (1,-1) (0,2) (1,2) |

I:

| Transition | Kicks |
|---|---|
| 0->1 | (-2,0) (1,0) (-2,1) (1,-2) |
| 1->0 | (2,0) (-1,0) (2,-1) (-1,2) |
| 1->2 | (-1,0) (2,0) (-1,-2) (2,1) |
| 2->1 | (1,0) (-2,0) (1,2) (-2,-1) |
| 2->3 | (2,0) (-1,0) (2,-1) (-1,2) |
| 3->2 | (-2,0) (1,0) (-2,1) (1,-2) |
| 3->0 | (1,0) (-2,0) (1,2) (-2,-1) |
| 0->3 | (-1,0) (2,0) (-1,-2) (2,1) |

`O` never kicks. 180-degree rotation is not part of the protocol.

## 3. Randomizer — seeded, and identical in every game

Pieces come from a **7-bag**: each bag is a permutation of all seven pieces; bags are concatenated.
`next` always shows the **next 5** pieces after the current one.

So that every bot faces the same pieces on every game, the shuffle is **fully specified**. `new` is given a
`seed` string. Implement exactly this:

```js
// FNV-1a 32-bit hash of the seed string
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 PRNG -> float in [0, 1)
function makeRng(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// one bag: Fisher-Yates, descending, on this exact starting order
function nextBag(rng) {
  const bag = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
```

The first bag is produced by the first call to `nextBag`, using an rng made from `hashSeed(seed)`.
With `seed: "arena"` the first fourteen pieces are exactly:

```
T L O J I S Z   O S Z L I J T
```

Your game **must** reproduce that sequence. The conformance checker tests it.

`new` may also be given an explicit `sequence` string (e.g. `"OOOOOIT"`). If present, those pieces are used in
order first, then play continues with seeded bags. This is used by the tests.

## 4. The clock — gravity, lock delay, levels

This is the part that makes v2 real-time, and the part most likely to go wrong. Read it carefully.

**Drive everything from wall-clock time, not from frame count.** Use `performance.now()`. On each animation
frame, work out how much time has actually elapsed and apply *all* the gravity steps that are now due. A game
that moves one row per frame will run at a different speed on a 60 Hz laptop and a 144 Hz monitor, and will
fail conformance.

```js
// correct: accumulate real elapsed time
this.acc += now - this.last;
this.last = now;
while (this.acc >= this.gravityMs) { this.acc -= this.gravityMs; this.stepDown(); }
```

**Gravity and lock delay are a fixed table, not a formula.** Use these exact numbers so that every submitted
game runs at the same speed. `gravity_ms` is the time for the piece to fall one row.

| Level | gravity_ms | lock_delay_ms |
|---|---|---|
| 1 | 1000 | 500 |
| 2 | 770 | 410 |
| 3 | 593 | 336 |
| 4 | 457 | 276 |
| 5 | 352 | 226 |
| 6 | 271 | 185 |
| 7 | 208 | 152 |
| 8 | 160 | 125 |
| 9 | 124 | 102 |
| 10 | 95 | 84 |
| 11 | 73 | 69 |
| 12 | 56 | 56 |
| 13 | 43 | 46 |
| 14 | 33 | 38 |
| 15 | 26 | 31 |
| 16 | 20 | 25 |
| 17 | 15 | 21 |
| 18 | 12 | 17 |
| 19 | 9 | 14 |
| 20 | 7 | 12 |
| 21 | 5 | 9 |
| 22 | 4 | 8 |
| 23 | 3 | 6 |
| 24 | 2 | 5 |
| 25 | 2 | 5 |
| 26+ | 1 | 5 |

There is deliberately **no plateau**: both numbers keep dropping every level, all the way to a physics floor
(1ms is already a single engine tick; 5ms is near the limit of what any bot, however fast, can act within).
Level 26 and beyond repeats the floor — there's nothing lower to give. Difficulty is meant to become
genuinely unsurvivable, not level off into a steady state a sufficiently fast bot could sit in forever.

- `level = 1 + floor(lines / 10)`. The level changes the moment the lines are cleared.
- **Lock delay.** When the piece comes to rest on the stack or the floor, start a timer of `lock_delay_ms`.
  When it expires, the piece locks. If the piece ever becomes unsupported again (you moved it over a hole), the
  timer stops and gravity resumes.
- **Lock delay resets.** A *successful* `left`, `right`, `rotate_cw` or `rotate_ccw` while the piece is resting
  restarts the timer, up to **15 resets per piece**. After the 15th reset the timer runs to expiry no matter
  what the bot does. `soft_drop` does **not** reset the timer. This cap is what guarantees a game ends.
- **No entry delay and no line-clear pause.** The next piece spawns immediately when the previous one locks.
  You may animate a line clear, but the clock must not stop for it.
- Games do not slow down or pause when the tab is in the background; the Arena always runs the live match in a
  visible foreground tab.

## 5. Actions

| Action | Effect |
|--------|--------|
| `left` / `right` | Move the piece one column. Illegal if blocked. Resets lock delay (max 15). |
| `rotate_cw` / `rotate_ccw` | Rotate with SRS kicks. Illegal if no kick fits. Resets lock delay (max 15). |
| `soft_drop` | Move down one row. Illegal if blocked. Does **not** lock and does **not** reset lock delay. |
| `hard_drop` | Move down as far as possible, then **lock immediately**, ignoring lock delay. |
| `hold` | Swap the current piece with the held piece (or take the next piece if hold is empty). Allowed once per piece; illegal until the next piece locks. The swapped-in piece spawns fresh at the spawn position with a fresh lock-delay budget. |

An illegal action leaves the state **unchanged** and reports `legal: false`. It is not an error.

Bots are rate-limited by the Arena to **30 actions per second**. Your game must accept actions at any rate
and must never require an action to make progress.

Unlike v2's first draft, this limit is no longer what makes a match end — the gravity and lock-delay curve in
§4 has no plateau, so it does that on its own: benchmarked against the reference bot, matches end within
15–120 seconds at any action rate from 12/s up to 200/s. The rate limit exists to keep things fair and the
Arena's single live-match slot from being flooded, not to manufacture difficulty. It is an Arena policy, not a
game rule — your game must not enforce it.

A human playing at the keyboard is on their own: key repeat, DAS/ARR, and key bindings are yours to choose and
are not part of the protocol.

## 6. Locking, clearing, scoring, game over

- A piece locks on `hard_drop`, or when its lock-delay timer expires.
- After locking: full rows are removed, rows above shift down, `lines` increases, `level` is recalculated, and
  the next piece spawns.
- Score per lock, with `level` the level **before** the clear:

  | Lines | Points |
  |---|---|
  | 1 | 100 x level |
  | 2 | 300 x level |
  | 3 | 500 x level |
  | 4 | 800 x level |

- Each successful `soft_drop` adds **1** point. A `hard_drop` adds **2 points per row dropped**. Both are added
  before the line-clear score.
- No other scoring. No T-spin, combo, or back-to-back bonuses — you may *detect and display* them (see
  `FEATURES.md`), but they must not change `score`, or your game will out-score everyone else's and the
  leaderboard becomes meaningless.
- **Game over** when a newly spawned piece overlaps a filled cell. Set `game_over: true`, set `piece` to `null`,
  stop the clock, and make every subsequent action `legal: false`.

## 7. The message interface

The Arena loads your `index.html` in a sandboxed iframe and speaks to it with `window.postMessage`. Your page
listens on `window` for `message` events and replies with `event.source.postMessage(reply, '*')`.

Every message is a JSON-safe object shaped like:

```json
{ "proto": "tetris/2", "id": 17, "type": "input", "payload": { "action": "left" } }
```

### Requests the Arena sends you

| `type` | `payload` | You reply with |
|---|---|---|
| `new` | `{ "seed": "arena", "sequence": "OOOO" }` (both optional) | `result` carrying a **state** |
| `state` | none | `result` carrying a **state** |
| `input` | `{ "action": "left" }` | `result` carrying `{ "legal": bool, "state": <state> }` |
| `pause` | `{ "paused": true }` | `result` carrying a **state**. While paused, the clock stops entirely. |

### Your reply

```json
{ "proto": "tetris/2", "id": 17, "type": "result", "ok": true, "payload": { "legal": true, "state": { } } }
```

Reply with the **same `id`** you were given. On failure, `ok: false` and
`payload: { "error": "human readable" }`. Reply within 100 ms.

### Messages you send unprompted

| `type` | When | `payload` |
|---|---|---|
| `ready` | Once, as soon as your adapter is listening | `{ "name": "Neon Blocks", "author": "you" }` |
| `update` | On every state change, and at least 10 times a second while playing | a **state** |

`ready` is how the Arena knows your game loaded. Send it last in your startup, and send it even if the player
has not pressed anything yet. `update` is what drives the live score on the big screen.

[`examples/game-adapter.js`](examples/game-adapter.js) is a drop-in implementation of this whole section. You
only have to wire it to your game.

### State object

```json
{
  "board": ["..........", "...18 more rows...", ".........."],
  "piece": { "type": "T", "x": 3, "y": 0, "rotation": 0, "cells": [[4,0],[3,1],[4,1],[5,1]] },
  "next": ["I", "O", "S", "Z", "J"],
  "hold": null,
  "can_hold": true,
  "score": 0,
  "lines": 0,
  "level": 1,
  "game_over": false,
  "elapsed_ms": 0,
  "gravity_ms": 1000,
  "lock_timer_ms": null,
  "piece_count": 1
}
```

| Field | Meaning |
|---|---|
| `piece.cells` | Absolute `[col, row]` board coordinates of the 4 cells. `piece` is `null` when `game_over`. |
| `next` | Exactly 5 upcoming piece letters. |
| `hold` | A piece letter, or `null`. |
| `can_hold` | `false` after a hold, until the next piece locks. |
| `elapsed_ms` | Milliseconds of unpaused play since `new`. Integer. |
| `gravity_ms` | Current gravity from the table in §4. Lets a bot know how much time it has. |
| `lock_timer_ms` | Milliseconds left before the resting piece locks, or `null` if it is still falling. |
| `piece_count` | How many pieces have spawned, including the current one. |

JSON Schemas live in [`schemas/`](schemas/).

## 8. Bots

A bot is a **single JavaScript module** with a default-exported function. The Arena runs it in its own sandbox
and gives it a client that speaks the protocol for it:

```js
export default async function bot(game, info) {
  // game.state()        -> latest state (synchronous, always fresh)
  // await game.input(a) -> send one action, resolves with { legal, state }
  // await game.sleep(ms)
  // game.done           -> true once the game is over or the match was stopped
  // info                -> { seed, gameName, deadlineMs }
  while (!game.done) {
    const s = game.state();
    if (!s || s.game_over) break;
    await game.input('left');
  }
}
```

Rules:

- Your bot may only use `game`. No `fetch`, no DOM, no reaching into the game's internals, no reading the
  opponent's source. The sandbox blocks all of it anyway.
- It must not block the thread. Use `await`; never spin in a `while` loop without awaiting something.
- Actions are rate-limited to 30/second. Exceeding it does not error — your extra actions are just delayed, and
  the piece keeps falling while they queue. Budget roughly 12-15 actions per piece, and less past level 15 —
  gravity and lock delay escalate with no plateau (§4), so there is no clever way to outlast the clock, only
  committing to a placement fast.
- It must work against *any* compliant game. Do not assume a board size, theme, or speed beyond this spec.

See [`examples/bot-template.js`](examples/bot-template.js).

## 9. Conformance

Open [`tests/conformance.html`](tests/conformance.html) in a browser, point it at your game, and run the checks.
The Arena runs the same suite on upload and shows you the failures. Passing is required before your game enters
the competition.
