# vroomon

Vroomon is a vehicle evolution simulator. The Python/PyGame/PyMunk prototype is
being rewritten as a standalone Electron + TypeScript app inside this project.

## Start here

- **[How Vroomon fits together](design-overview.md)** — the whole design on one
  page: the two-path body, the loop, the measured progression, the wild, the
  economy, the day cycle and the invariant suite.
- [Gameplay & UI notes](gameplay-ui-notes.md) — what was built and what broke.
- [Writing content invariants](content-invariants.md) — how the suite checks a
  world full of authored content, and the four ways to write a check that fails
  on good content.
- [Art pipeline](art-pipeline.md) — sprite assets and how to replace them.

## Layout

- `src/vroomon/` — legacy Python simulation and tests kept as a behavioral
  reference during the rewrite.
- `electron/` — the Electron + TypeScript rewrite target. This is where
  active development happens.

## Current status

Vroomon is an **evolution simulator** first: you are a rancher and breeder
tuning a system, and individual selection (cull or release) stays an optional
power tool. The rewrite covers the parity contract's capabilities — DNA v2
decoding, population evaluation, six terrain presets, lineage tracking,
persistence — and has grown well past it:

- **A world, not a menu.** Starter Town, two roads, three arenas, the Highland
  Mesa, the Canyon Quarry, the Drift Perimeter, the Long Haul waystation, the
  Marrow Orchard, and the ranch itself (a house and a yard). Twelve trading
  houses across six biomes, each with its own rivals and its own story.
- **The circuit.** Five Brands (Grassland → Salt Road → Highland → Canyon →
  Perimeter), each defended at its own arena against a bar that climbs ×1.22 a
  tier, then the **Grand Roundup**. From tier II the ground also demands a
  *shape* — driven wheels, properly built — not just a time.
- **Wild populations that evolve on their own.** Every biome keeps a pack of
  24 that breeds, mutates and takes immigrants between your visits, scored on
  that biome's ground. Encounters send the median animal, so the ground gets
  harder as the years pass.
- **A breeding bench worth reading.** The Inspector shows every plate, wheel,
  engine, shaft and gear in the chain, runs the real 3-second race on five
  surfaces with playback, traces a car's line in the Heritage tree, and reads
  its pedigree — parents, siblings, descendants.
- **Work to do.** Eight-plus side quests with derived objectives and paid
  rewards, a trade counter, a herd book with provenance, a ledger of titles to
  defend, per-biome records, and a ranch to furnish.
- **Weather, daylight and routines.** People move through their day, keepers
  work nights, rain defends a Brand, and the clock is yours to pin.

`docs/gameplay-ui-notes.md` is the running log of what was built and what it
cost — including the bugs each addition caught. The Python prototype in
`src/vroomon/` remains the behavioural reference.

## Modes

The world is the hub. The top bar no longer carries mode tabs — you walk, and
the **Barn button** (or a carrier bench in the yard) opens the Pocket Ranch,
whose scenes follow the work:

- **The road** — a tile-based overworld where you walk your rancher, talk to
  the locals, stand at tall grass to meet wild vroomon, and settle each
  biome's feud. Arrow keys or the on-screen pad move; Z / Enter interacts;
  H toggles whether the grass is dangerous.
- **Herd** — the breeding bench: generate a population, run generations, watch
  the viewport, inspect a car, save a champion to the Record Barn, and batch or
  auto-run to a plateau.
- **Test Drive** — drive one car on a road and record the lap.
- **Barn, Heritage, Trade, Dex** — the Record Barn (champions, ledger, records),
  the Heritage tree (family lines traced from the founders), Oxide's counter,
  and the Herd Book.

State persists between sessions — position, factions, brands, the herd book,
wild packs and the world clock — locally in the browser for the web build and
on disk for the desktop build.

## Batch generation

`Run → Batch` (or `B` in evolution mode) runs N generations sequentially.
The "Stop on plateau" checkbox uses a coefficient-of-variation test over
the last three best-score entries to auto-stop evolution when scores
plateau. Batch work runs in a module worker (`evolution.worker.ts`) so
the viewport stays responsive.

## The Record Barn

The Record Barn is the persistent, per-user car library, and it is what the
circuit actually races: a feud is settled by your best *recorded* champion on
that ground, so "find your best, record it, defend the ground with it" is the
loop. Save the selected car from the herd panel; browse and load entries from
the barn and test-drive panels. The library is capped at 50 entries and stored
in `userData/vroomon/hall-of-fame.json`.

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
- `npm test` — Vitest unit tests (376 at the time of writing)
- `npm run test:e2e` — Playwright e2e tests (53), run through
  `node scripts/run-playwright.mjs`; set
  `VROOMON_BROWSER_EXECUTABLE=/run/current-system/sw/bin/google-chrome-stable`
  on NixOS, where Playwright must not fetch its own Chromium. `test:e2e:smoke`
  runs the `@smoke` subset, and `tests/e2e/vroomon.e2e.ts` documents the rest
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
| `2` / `o` | Switch to overworld mode (the hub) |
| `3` / `e` | Switch to the herd bench |
| `4` / `t` | Switch to test-drive mode |
| `h` | Toggle whether the tall grass is dangerous (overworld mode) |
| `Esc` | Close the Pocket Ranch, the Inspector or an open panel |
| `s` | Save run state |
| `l` | Load run state |
