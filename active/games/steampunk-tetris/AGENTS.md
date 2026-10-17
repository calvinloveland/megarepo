# Brass & Boiler AGENTS.md

Project-specific guidance for `active/games/steampunk-tetris/`.

## What this is

Two deliverables in one folder:

1. **The game** — a single static page implementing Tetris Protocol v2 exactly,
   for the AI Tetris Challenge Arena. Steampunk themed; the mechanics are not
   ours to change.
2. **Two submitted bots** — single-file ES modules that play any compliant game
   through the protocol alone.

Author metadata everywhere: *Calvin Loveland, agent deepseek*.

## Layout

```
index.html            # Cabinet shell: gauge deck, board frame, ledger, touch pad
style.css             # Brass/rivets/steam theme, all gradients, no images
game-adapter.js       # Vendored from the challenge repo — DO NOT EDIT
src/constants.js      # Protocol tables: pieces, SRS kicks, gravity, lock, scoring
src/engine.js         # Pure rules engine, no DOM (so Node tests can drive it)
src/render.js         # Canvas 2D: riveted tiles, ghost, particles, steam, flashes
src/audio.js          # Web Audio only — oscillators and noise, no asset files
src/main.js           # rAF loop, keyboard/DAS, HUD, adapter wiring, test surface
bots/src/core.js      # Shared brain; concatenated into each bundle by the builder
bots/src/{score,hunter}.js
bots/dist/*.js        # Generated single-file bots — the submission artefacts
scripts/build-bots.mjs  # The "bundler" (strips module syntax, concatenates)
scripts/run-bot.mjs     # Scoreboard over a seed set
scripts/tune.mjs        # Weight sweeps over a seed set
scripts/debug-bot.mjs   # Piece-by-piece dump of what a brain is choosing
scripts/package.mjs     # Builds the submission zip from an allow-list
scripts/verify-archive.mjs  # Unpacks the zip and re-runs conformance on it
tests/node/           # Engine + bot unit tests (node --test, deterministic)
tests/harness/        # conformance.html + bot-runner.html (browser harnesses)
tests/*.spec.cjs      # Playwright suites
vendor/conformance/   # Challenge's conformance.js + PROTOCOL.md, copied verbatim
```

## Convictions

- **The rules are not ours.** `src/constants.js` is a transcription of
  `PROTOCOL.md`; every table there has a matching assertion in
  `tests/node/engine.test.mjs`. If you change a number, change it in both and
  re-read §2/§4/§6.
- **Time comes from the clock.** Gravity and lock delay are driven by
  `performance.now()` deltas in `engine.tick(now)`. Never count frames, never
  add a plateau to the tables.
- **Cosmetics never touch score.** T-spins, combos, perfect clears and
  level-up fanfare are display-only. §6's table is the only thing that pays.
- **No build step for the game.** Static files, relative paths, no CDN, no
  storage. `scripts/package.mjs` asserts all of that before writing the zip.
- **Bots are single files.** Edit `bots/src/`, then `npm run bots:build`. A
  stale bundle fails `tests/node/bots.test.mjs` (it runs the bundler with
  `--check`).
- **The engine is DOM-free** so the same code runs the page and the Node
  bot harness. Keep DOM access in `main.js`/`render.js`/`audio.js`.

## Test surface

`window.__tetris` exposes `engine`, `renderer`, and `api.{state,reset,press,advance,freeze,unfreeze,tally}`
for Playwright. `api.advance(ms)` freezes the page clock and steps the engine
deterministically — use it instead of `waitForTimeout` when a test needs time
to pass.

## Running checks

```bash
npm run test:unit                    # node --test (engine + bots) — seconds
npm run test:e2e                     # Playwright: conformance, game, bots
node scripts/verify-archive.mjs      # conformance against the packaged zip
node scripts/run-bot.mjs --seed arena,deepseek
```

From the repo root: `python scripts/check_all.py steampunk-tetris` (add `--e2e`
via `python scripts/check_web_app.py steampunk-tetris --e2e`).

On NixOS the Playwright config points at the system Chrome
(`CHROMIUM_PATH` overrides). Do not let Playwright download its own Chromium.
