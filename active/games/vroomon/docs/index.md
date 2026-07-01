# vroomon

Vroomon is a vehicle evolution simulator. The Python/PyGame/PyMunk prototype is
being rewritten as a standalone Electron + TypeScript app inside this project.

## Layout

- `src/vroomon/` — legacy Python simulation and tests kept as a behavioral
  reference during the rewrite.
- `electron/` — the Electron + TypeScript rewrite target. This is where
  active development happens.

## Current status

The rewrite covers the parity contract capabilities declared in
`electron/src/shared/parity-contract.ts`:

- DNA v2 decoding (base62, locality-preserving)
- Multi-car racing with concurrent population evaluation
- Six terrain presets (Grassland, Flat, Sand, Hills, Rocky, Ice) with visual
  texture overlays
- Lineage tracking (parent IDs, mutation flags, genealogy)
- Persistence (run state, generation log, Hall of Fame)
- The Python prototype remains available for behavioral reference

## Modes

The app shell ships with four modes:

- **Menu** — overview, parity contract summary, and the persistent
  Hall of Fame. Click any saved vehicle to load its DNA into test-drive.
- **Overworld** — a 2D tile-based world (Starter Town + Route 1 +
  Grassland Gym + Route 2 + Sandy Gym) where you walk your rider, talk
  to NPCs, encounter wild DNA in the Vroomgrass, and challenge Gym
  Leaders. Arrow keys (or the on-screen D-pad) move, Z / Enter
  interacts. State persists between sessions (badges, position, Vroomdex).
- **Evolution** — generate a population, run generations, watch the
  viewport race them, and (optionally) save top cars to the Hall of Fame.
  Supports batch generation, "Stop on plateau" auto-convergence, and a
  running score history chart.
- **Test Drive** — preview a single car. Type a DNA string, randomize,
  load a Hall of Fame entry, or watch the 11,000-step flat-track
  regression replay for the canonical simple car.

## Batch generation

`Run → Batch` (or `B` in evolution mode) runs N generations sequentially.
The "Stop on plateau" checkbox uses a coefficient-of-variation test over
the last three best-score entries to auto-stop evolution when scores
plateau. Batch work runs in a module worker (`evolution.worker.ts`) so
the viewport stays responsive.

## Hall of Fame

The Hall of Fame is a persistent, per-user vehicle library. Save the
currently-selected evolution car from the evolution panel (`Save to
Hall of Fame`); browse and load saved vehicles from the menu and
test-drive panels. The library is capped at 50 entries and stored in
`userData/vroomon/hall-of-fame.json`.

## Electron development

From `active/games/vroomon/`:

- `./run.sh`

The helper script changes into the Electron app directory, installs
dependencies when needed, and starts the app. On NixOS it automatically
launches through `nix shell nixpkgs#electron`, applies the Electron
runtime stability flags used by the app, and uses `xvfb-run` automatically
when no display is available.

From `active/games/vroomon/electron/`:

- `npm install`
- `npm test` — Vitest unit tests (50+ tests)
- `npm run test:e2e` — Playwright e2e tests
- `npm run test:smoke` — boots Electron headless and reports the
  `VROOMON_SMOKE_SUCCESS` payload
- `npm run build` — `tsc` + static copy
- `npm run profile:sim` — runs the population race profiler
- `npm run package:dir` — `electron-builder --dir` for a local package
- `npm start` — `npm run build` + `electron .`

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `r` | Run generation (evolution mode) |
| `g` | Generate population (evolution mode) |
| `b` | Run batch (evolution mode) |
| `d` | Randomize DNA (test-drive mode) |
| `↑ ↓ ← →` / `WASD` | Walk the rider (overworld mode) |
| `Z` / `Enter` / `Space` | Interact / advance dialogue (overworld mode) |
| `1` / `m` | Switch to menu mode |
| `2` / `o` | Switch to overworld mode |
| `3` / `e` | Switch to evolution mode |
| `4` / `t` | Switch to test-drive mode |
| `s` | Save run state |
| `l` | Load run state |
