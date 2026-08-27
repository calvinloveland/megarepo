# Watch Forge AGENTS.md

Project-specific guidance for `active/games/watch-forge/`.

## What this is

Watch Forge is an evolutionary mechanical-watch simulator. A genetic algorithm
breeds a population of watch chromosomes toward a **charter** — a scoring
equation — while the champion renders as an animated skeletonized dial on
Canvas 2D. Five charters price different virtues:

- **Glass Palace** — expose as many components as possible (skeletonization +
  part count)
- **Less Is More** — chronometric accuracy with the fewest possible parts
- **Thin King** — maximum complications in the slimmest form factor
- **Chronometer Trials** — pure rate accuracy + reliability
- **Eight-Day Pocket Hero** — power reserve + dependability

## Layout

```
index.html          # App shell: three-column lab layout
style.css           # Dark watchmaker theme
data.js             # Component catalog (base genes + 17 complications)
watch.js            # Genotype → phenotype model + deterministic RNG
evolution.js        # Charters (scoring equations) + genetic algorithm
render.js           # Canvas painting: dial, side profile, fitness chart
game.js             # Controller: RAF loop, DOM wiring, Hall of Fame
server.mjs          # Minimal Node static server (npm start)
scripts/smoke.mjs   # Browser smoke probe (optional, needs Playwright)
playwright.config.cjs   # E2E config, points at Nix-managed Chrome
tests/              # node:test unit suite (watch / fitness / evolution)
tests/e2e/          # Playwright specs (8 checks)
docs/index.md       # Web docs
```

## Architecture notes

- **data.js / watch.js / evolution.js** are dual-environment modules:
  `module.exports` for node:test, `root.WATCH_*` globals for the browser.
  Each is wrapped in an IIFE — **do not add top-level `const`s that leak into
  the shared script scope** (classic `<script>` tags share one lexical
  environment; every file needs its own scope).
- Phenotypes are **deterministic**: manufacturing noise is seeded from the
  genotype hash, so fitness comparisons in the GA are stable.
- Accuracy is **multiplicative** (`3.0 s/day × accFactor of escapement ×
  balance × hairspring × beat` + linear friction penalties) so upgrades can
  never overshoot into "worse" territory.
- The GA is deliberately small and inspectable: rank by charter score, keep
  elites, uniform-blend crossover, adaptive mutation that rises when the best
  fitness stalls.
- Every charter gets a themed founder archetype (see `FOUNDERS` in
  `evolution.js`); keep them visually distinct when tuning.
- **Never rebalance a charter equation without updating
  `tests/fitness.test.mjs`** — every charter has a behavioural lock (e.g.
  "skeletonizing an identical build scores higher", "loaded complications
  beat plain for Thin King").
- `game.js` exports `window.WATCH_FORGE` (state + engine hooks) as the test
  surface for Playwright. Keep it in sync when refactoring.
- Share permalinks are base64 JSON in the URL fragment (`#watch=…`) and
  import via `applySession(p, founding)` — **founding genotypes must be
  passed as the SECOND argument**; stuffing them into the payload is an
  easy way to end up with a random lab (that exact bug shipped and was
  caught by e2e).

## Commands

```bash
npm test          # node:test unit suite (28 tests)
npm run check     # node --check on every source file
npm run test:e2e  # Playwright suite (needs Nix Chrome; see config)
npm run test:smoke  # quick browser probe + screenshots
npm start         # serve on :5120
```

From the repo root: `nix-shell -p python3 --run "python scripts/check_web_app.py watch-forge"`.

## Browser testing on NixOS

Playwright's own browser download is dynamically linked and will NOT run.
The `.npmrc` sets `playwright_skip_browser_download=1` and the Playwright
config points at `/run/current-system/sw/bin/google-chrome` (override with
`CHROMIUM_PATH`). Never install Playwright's bundled browser here.