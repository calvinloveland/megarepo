# Gamebase — Gameplay Critique (2026-10-15)

Lens: **the games themselves** — rules, controls, AI, restarts, and the
Gamebase integration (tag, plays, score submission, achievements).
Auditor: Pi agent. No platform or game code was modified; this file is the only
artifact created. Instance under test: `http://127.0.0.1:5199` with 16 games,
seeded via `scripts/seed-random.sh 12 6` (fresh `/dev/urandom` tags, ratings,
comments, plays, scores).

This review is deliberately the *gameplay* lens. Two sibling notes already
cover platform infrastructure and visual/a11y concerns; overlap is noted where
a gameplay defect is only visible through the platform.

## 1. Summary

I played **12 of the 16 games** in Nix Chromium via Playwright (chess, checkers,
stratego, reversi, connect-four, tic-tac-toe, minesweeper, 2048, snake,
breakout, simon, memory), both by hand-driving the DOM and by exercising each
game's exposed `*Engine` global for deterministic rule checks. Every game loads
cleanly and every game I finished reached the server with `POST
/api/games/<slug>/scores` (HTTP 201). There were **no P0 defects**: no crash, no
soft-lock, no stuck state, and restart worked in all seven games I tested to a
terminal state.

The real problems are **integration/state bugs that a player cannot see**:

1. Winning 2048 never submits the run, so the headline achievement and the
   score are silently lost if you start a new game from the win screen.
2. Two "win-condition" achievements unlock on a **loss** (Reversi `dominant`,
   Connect Four `blitz`), because their server criteria have no result gate.
3. The play counter is triggered by *page views*, not by playing; no game ever
   calls `Gamebase.play()`, so "most played" is measuring page loads.
4. Chess declares a draw for K+B+B vs K, which is a won position.

Rule engines are otherwise strong: tic-tac-toe's AI is provably unbeatable,
Connect Four blocks open threes, chess (depth 3) defends Scholar's Mate, reversi
and checkers beat me convincingly, and en passant / castling / promotion /
forced captures / multi-jumps / minesweeper flood-fill and chording all behave
correctly.

### Game-by-game verdict

| Game | Rules | Controls | AI / difficulty | Restart | Integration | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| chess | ✅ (1 insuff.-material bug) | mouse + arrow/Enter | depth 3, defends threats | ✅ undo restores | ✅ score on finish | Solid |
| checkers | ✅ forced caps, chains, crowning | mouse + arrow/Enter | depth 5, strong | ✅ | ✅ | Solid |
| stratego | ✅ (documented simplifications) | mouse; setup swap | heuristic, hidden info | ✅ | ✅ | Ambitious, works |
| reversi | ✅ flips/pass/game-end | mouse + arrow/Enter | depth 4, beat me 47–17 | ✅ | ⚠️ `dominant` on loss | Buggy achievement |
| connect-four | ✅ all 4 directions | mouse | depth 5, blocks 3 | ✅ | ⚠️ `blitz` on loss | Buggy achievement |
| tic-tac-toe | ✅ | mouse | perfect/unbeatable | ✅ | ✅ | Solid |
| minesweeper | ✅ first-click safe, chord | mouse/right-click/flag-mode | 3 difficulties | ✅ | ✅ | Solid desktop; small on mobile |
| 2048 | ✅ merges once | arrows/WASD/swipe | n/a | ✅ undo 1-step | ❌ win never submits | Integration bug |
| snake | ✅ wall/self/growth | arrows/WASD/swipe, pause | speeds up per bite | ✅ | ✅ | Solid |
| breakout | ✅ bricks/lives/levels | mouse/touch/arrows | ball speeds per level | ✅ | ✅ | Solid |
| simon | ✅ growing sequence | click/tap + keys | memory-bound | ✅ | ✅ | Solid |
| memory | ✅ 8 pairs | click/tap | n/a | ✅ | ✅ | Solid |

## 2. What works well

- **Every game is genuinely playable**, not a placeholder. Canvas games
  (snake, breakout, marble) render, animate, and accept input; DOM board games
  highlight legal moves and render win lines.
- **Rule engines are well built and exposed** as `window.ChessEngine`,
  `CheckersEngine`, `ConnectFourEngine`, `ReversiEngine`, `MinesweeperEngine`,
  `Gamebase2048Engine`, `GamebaseSnakeEngine`, `StrategoEngine`,
  `TicTacToeEngine` — which made deterministic verification cheap.
- Verified-correct rules by engine evaluation on `/play/<slug>/`:
  - Chess: kingside+queenside castling generated, castling through an attacked
    square rejected, en passant generated after a double push, promotion
    generates exactly 4 options, Scholar's Mate detected as checkmate
    (`{over:true, reason:"checkmate", winner:0}`), 50-move uses 100 plies.
  - Checkers: 7 opening moves; captures forced (simple moves excluded);
    2-capture jump chain generated; crowning ends the chain and promotes.
  - Connect Four: horizontal/vertical/diagonal wins all detected;
    `bestMove` blocked an open three (chose column 3).
  - 2048: `[2,2,2,2]→[4,4,0,0]` scored 8; `[2,2,4,0]→[4,4,0,0]` no double
    merge; `changed` flag correct.
  - Snake: wall death, self-collision, and +10/growth on eating.
  - Minesweeper: first click never a mine, flags block reveals, flood-reveal
    wins at 71/71 safe cells, chord works.
  - Stratego: 40 pieces/army, lakes empty, Spy kills Marshal, Miner defuses
    Bomb, Bomb kills Marshal, equal ranks both die, Flag immobile.
  - Tic-tac-toe: exhaustive search from every X opening → AI (O) never loses
    (`worst=0`).
- **AI quality** is appropriate: tic-tac-toe is perfect (so the hint "the
  perfect AI never loses" is truthful), Connect Four depth 5, Reversi depth 4
  (beat me 47–17), Checkers depth 5, chess depth 3 defends f7 against 3.Qh5
  (played g7–g6).
- **Controls are broad and accurate**. Keyboard verified: chess
  arrow-cursor+Enter moved the e2 pawn to e4 (`data-sq=36`); checkers
  Enter selects a piece and shows a target; 2048 and Snake accept
  arrows/WASD; Simon accepts 1–4/qwas. Touch swipe verified on 2048
  (`Moves 1` after a synthetic right-swipe) and snake. Breakout follows the
  mouse; Minesweeper supports right-click, long-press, flag-mode, and chording.
- **Two-player mode** toggles correctly in chess/checkers/reversi/connect-four/
  tic-tac-toe (`#mode` → "Mode: 2-player", status flips to "White to move" etc.).
- **Restart is clean** in all tested games: after a terminal overlay,
  `#overlay-btn` hides the overlay and resets status (e.g. tic-tac-toe
  `Your move (✕)`, minesweeper `Beginner · 10 mines`, memory `Find all 8 pairs.`).
- **Undo works** where offered: after chess 1.e4 + AI reply, `#undo` restored
  the pawn from `data-sq=36` back to `data-sq=52` and left `36` empty.
- **Integration plumbing works for finished runs**: `Gamebase.ready()` creates
  a guest identity, the 3-letter tag renders in `#tag`, and game-over calls
  `endRun()` → `POST /api/games/<slug>/scores` 201 with `unlocked[]` and a rank
  (e.g. tic-tac-toe rank 30, memory rank 33, simon rank 26).
- The platform page (`/g/2048`) shows the tag gate, loads the sandboxed iframe
  (`/play/2048/`), records a play, accepts a 4-star rating, and posts a comment.

Evidence screenshots (in `/tmp`): `audit_platform.png`, `audit_chess.png`,
`audit_ttt_mid.png`, `audit_stratego.png`, `audit_reversi.png`,
`audit_checkers.png`, `audit_mine.png`, `audit_breakout.png`,
`audit_memory.png`, `audit_simon_mid.png`, `audit_snake.png`,
`audit_2048_mobile.png`, `audit_mobile_stratego.png`,
`audit_mobile_mine_expert.png`.

## 3. Issues

No **P0** issues were found. Severity definitions: P0 = game-breaking/crash or
unrecoverable state; P1 = wrong persistent result or silently lost progress;
P2 = correctness/polish that does not corrupt stored data.

### P1-1 — Winning 2048 never submits the run (score + `tile-2048`/`thousand` lost)

**What I saw.** I wrote a 2-ply expectimax player that reads the DOM board and
drives the game with synthetic `keydown` ArrowEvents. It reached the 2048 tile
in **957 moves**, score `20200`, and the overlay showed **"You win!"**
(`/tmp/audit_2048_win.png`). I had wrapped `Gamebase.endRun` before starting:

```
window.__endRun = 0; Gamebase.endRun = (r)=>{window.__endRun++; return orig(r);}
```

After the win overlay appeared and 2 s passed, `window.__endRun === 0` and the
network log contained **zero** `POST /api/games/2048/scores` calls. The same
solver was stopped earlier by a real `Game over` in a different run, and that
one *did* call `endRun` and POST `/scores` (201), which isolates the win path.

**Exact repro.**
1. Open `http://127.0.0.1:5199/play/2048/`.
2. Play until the 2048 tile appears; the overlay `#overlay-title` reads
   "You win!" with a "Keep going" button.
3. Click `#overlay-btn` ("New game") instead of "Keep going".
4. Observe DevTools Network → no `POST /api/games/2048/scores`. Score/achievements
   are gone.

**Why it matters.** `registry/2048/game.js` `checkState()` calls
`finish("You win!", …, true)` and `return`s, while `submitRun()` is only called
from `gameOver()`. So the game's primary win condition is the one path that
never records a score. Server-evaluated achievements `tile-2048`
(`meta.highest >= 2048`) and `thousand` (`score >= 1000`) are also never
evaluated for that run. A player who wins and immediately starts over loses
their best score and their 50-point achievement.

### P1-2 — Reversi "Dominant" unlocks when you *lose* by a big margin

**What I saw.** Playing Reversi vs the AI, my random legal move loop lost
`Black 17 · White 47` (`#overlay-title` = "AI wins", `#counts` = "⚫ 17 · ⚪ 47",
`/tmp/audit_reversi.png`). The resulting submission:

```
201 /api/games/reversi/scores
{"is_personal_best":true,"score":0.0,"rank":24,
 "unlocked":[{"id":"dominant","title":"Dominant", ...},
             {"id":"first-game", ...}]}
```

**Exact repro.**
1. Open `http://127.0.0.1:5199/play/reversi/`.
2. Click `.sq.play` repeatedly to make any legal moves until the AI wins by
   16+ discs (a random player loses to the depth-4 AI routinely — I got 17–47).
3. Open DevTools → `POST /api/games/reversi/scores`; response `unlocked`
   contains `dominant` even though `result:"loss"` and `score:0`.

**Why it matters.** `registry/reversi/game.yaml` defines `dominant` as
"Win by a margin of 16 discs or more" but the criterion is only
`{type: meta, key: margin, gte: 16}` — there is no `result: win` guard. The
server correctly evaluates what it is told; the game submits `meta.margin`
regardless of who won. This awards 25 achievement points for losing badly.

### P1-3 — Connect Four "Blitz" unlocks when you *lose* in ≤14 moves

**What I saw.** In 2-player mode (`#mode`) I deliberately lost on ply 8:
P1 plays column 5, P2 builds the bottom row at columns 0–3
(`seq = [5,0,6,1,5,2,6,3]`). Overlay `#overlay-title` = **"You lose"**,
`#counts` = "🔴 4 · 🟡 4". Submission:

```
201 /api/games/connect-four/scores
{"is_personal_best":true,"score":0.0,"rank":17,
 "unlocked":[{"id":"blitz","title":"Blitz", ...},
             {"id":"first-game", ...}]}
```

**Exact repro.**
1. Open `http://127.0.0.1:5199/play/connect-four/`, click `#mode`
   (→ "Mode: 2-player").
2. Click cells at `data-col=5,0,6,1,5,2,6,3` in order (each click via
   `.cell[data-col='N']`).
3. Overlay: "You lose". DevTools `POST /api/games/connect-four/scores` →
   `unlocked` includes `blitz`.

**Why it matters.** `registry/connect-four/game.yaml` describes `blitz` as
"Win in 14 moves or fewer" but is `{type: meta, key: moves, lte: 14}`. A short
loss is exactly when `moves <= 14`, so the achievement is farmable by losing.
Same class of defect as P1-2; `memory.efficient`/`swift` and
`minesweeper.speed-demon` happen to be safe only because those games submit a
partial `meta` **only on a win**.

### P2-1 — Chess declares a draw for K+B+B vs K (a won position)
 
**What I saw.** Engine test on `/play/chess/`:

```js
const b = new Array(64).fill(0);
b[0]=ChessEngine.pc(KING,WHITE); b[63]=ChessEngine.pc(KING,BLACK);
b[20]=ChessEngine.pc(BISHOP,WHITE); b[21]=ChessEngine.pc(BISHOP,WHITE);
ChessEngine.insufficientMaterial(b) // => true   (expected false)
```

`insufficientMaterial` returns `true` for **any** two bishops (`t0===BISHOP &&
t1===BISHOP`) regardless of owner or square colour. K+B+B vs K (bishops on
opposite colours) is a forced checkmate, not insufficient material.

**Exact repro.** Paste the snippet above in the console on
`http://127.0.0.1:5199/play/chess/`.

**Why it matters.** It is a rules-correctness bug: a winning endgame is
declared drawn (`gameStatus` → `reason:"insufficient"`). Rare in normal play
but real, and it also affects `negamax`, which treats the position as a draw at
the search leaves.

### P2-2 — Play counts are page views, not plays; no game records an in-game play

**What I saw.** Loading `/g/2048` and doing nothing fires

```
200 /api/games/2048/play   {"players":33,"plays":63}
```

`static/app.js` `recordPlay()` is called unconditionally from
`DOMContentLoaded`. Meanwhile `grep -rn "Gamebase\.play(" registry/ static/`
(excluding the SDK) finds **no caller**: none of the 12 games (nor either
tycoon bridge) reports an actual play. Direct loads of `/play/2048/` in my
playthroughs never produced a `POST /play`.

**Exact repro.** Open `/g/chess` in a fresh browser context and watch Network:
one `POST /api/games/chess/play` on load, even if you never touch the iframe.
Then open `/play/chess/` directly: zero `/play` calls.

**Why it matters.** The "most played" ranking (shown in the game sidebar and
`stats.plays`) measures page impressions, and games that are linked/embedded
heavily win regardless of engagement. It also means a real in-iframe session
started outside the wrapper is invisible.

### P2-3 — Expert Minesweeper is cramped and scroll-dependent on phones

**What I saw.** At 390×780 mobile (`/tmp/audit_mobile_mine_expert.png`),
Expert (30 columns) computes 16 px cells; `#board` is **538 px** wide inside a
**374 px** `.board-wrap`. Cells fit only by horizontally scrolling
(`getComputedStyle(.board-wrap).overflowX === "auto"`); the last cell sits at
`right=547` vs `window.innerWidth=390`. Intermediate (16 cols) is fine.
Beginner on desktop is also small (34 px cells centred in a 900 px cap).

**Exact repro.**
1. DevTools device toolbar → 390×780, open `/play/minesweeper/`.
2. Click "Expert". Measure `#board` (538 px) vs viewport (390 px).

**Why it matters.** 16 px touch targets are below the ~44 px guideline and
force two-axis panning on the hardest, most time-sensitive board. Playable, but
unpleasant.

### P2-4 — Comment timestamps render as raw ISO-8601

**What I saw.** On `/g/chess` and `/g/2048`, every comment shows
`2026-10-15T02:43:19+00:00` verbatim (`/tmp/audit_platform.png`). The template
prints `{{ comment.created_at }}` with no formatting.

**Exact repro.** Open any game page and read `.comment .muted`.

**Why it matters.** Community text looks machine-generated; a relative
timestamp ("2 min ago") is the expected affordance and costs nothing.

### P2-5 — Reversi's "black" disc is slate-blue, reducing board readability

**What I saw.** `registry/reversi/style.css`: `.disc.black` is
`radial-gradient(circle at 35% 30%, #46536b, var(--disc-b)` — a blue-grey, not
black. Against the green board and the white disc (`#ffffff → #c9d3df`) the two
sides are distinguishable but the "black" side reads as blue-grey
(`/tmp/audit_reversi.png`). Low priority; flagging for the visual/a11y lens.

## 4. Prioritized suggestions

1. **Submit on 2048 win (P1-1).** Call `submitRun()` when the 2048 tile is
   reached (or on "New game" while `ui.won`), not only in `gameOver()`. Add a
   regression test that drives `checkState()` to a win and asserts one
   `POST /scores`.
2. **Gate result-themed achievements (P1-2, P1-3).** Add
   `{type: meta, key: result, eq: win}` alongside `margin`/`moves` for
   `reversi.dominant` and `connect-four.blitz` (and audit any other
   `meta`-only "win" wording). Better: extend the criterion schema with a
   `result: win` field so authors cannot forget it.
3. **Count a play when play starts, once (P2-2).** Have each game call
   `Gamebase.play()` on its first user input / `newGame()` and remove the
   unconditional `recordPlay()` from `DOMContentLoaded` (or make the platform
   call fire on iframe `focus`/first interaction instead of page load).
4. **Fix `insufficientMaterial` (P2-1).** Only draw for `K vs K`, `K+B vs K`,
   `K+N vs K`; treat two bishops as a draw only when they are on the same square
   colour and the same side (or one each side), and never for opposite-colour
   same-side bishops.
5. **Format comment timestamps (P2-4)** — relative time on the server or a tiny
   client-side formatter; keep the raw value in `title=` for hover.
6. **Mobile Minesweeper (P2-3)** — for Expert, allow sub-16 px or an
   explicit "zoom/scroll hint", or cap difficulty columns and centre the board;
   raise the minimum touch target on phones.
7. **Polish passes that are cheap and high-value:** make Reversi's black disc
   actually dark (`#0b1220`-ish); add an inline rules blurb for chess
   (en passant / promotion chooser) and Stratego (Scout/Min Spy/Bomb rules) so
   first-time players are not surprised; consider an explicit "no score saved
   from the win screen" is *not* the fix — fix the submit instead.

### Notes / non-issues deliberately not reported

- Stratego's "pieces stay face-up once revealed" and its omitted two-square /
  no-chase rules are documented in `game.yaml`; they are intentional.
- Simon's pads look almost black in a game-over screenshot, but that is the
  `.overlay` backdrop (`rgba(4,8,15,.78)`); mid-game they are clearly
  green/red/yellow/blue (`/tmp/audit_simon_mid.png`).
- Breakout/Snake dying quickly in my harness was my controller, not the game;
  the rules and collision handling are correct.
- `Gamebase.mountHud` is unused by the 12 board games (they render their own
  `#tag`), while the two tycoon ports use bespoke chips (`#gamebase-chip`,
  `#gamebase-status`). Inconsistent but functional.
