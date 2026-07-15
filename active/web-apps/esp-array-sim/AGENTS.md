# AGENTS.md — ESP Speaker Array Simulator

A vanilla-JS + Node static-server web app, following the megarepo's sandbox shape
(no build step, ESM modules, `node --test`). Canonical docs: [`docs/index.md`](docs/index.md).

## Layout

- `src/` — pure ESM modules shared by the **UI and tests** (single source of truth):
  - `acoustics.mjs` — speed of sound, propagation delay, distance, noise.
  - `world.mjs` — room + seeded RNG, random node mesh, emit schedule.
  - `capture.mjs` — simulates microphone captures across the calibration sweep.
  - `localize.mjs` — joint position+clock LM solver, multistart, Procrustes alignment.
  - `surround.mjs` — 5.1 channel→real-speaker panning.
  - `dsp.mjs` — chirp template + matched-filter TOA estimator (the real firmware-side block).
  - `scenario.mjs` — orchestrates a whole run; **drive new features through this**.
- `app.js` — canvas renderer + controls; imports the `src/` modules directly.
- `server.mjs` — bare static server (serves `/`, `/app.js`, `/src/*`, `/styles.css`).
- `tests/` — `node --test` (acoustics, localization/surround scenario, server smoke).

## Workflow

```bash
npm run check   # syntax + unit + server tests (the primary check)
npm start       # UI at http://127.0.0.1:5193
```

## Conventions

- Keep the physics/solver in `src/` browser-safe (no Node-only APIs) so the page and tests share it.
- No build step. Add new math to a `src/*.mjs` module with a unit test, then surface it in
  `scenario.mjs` (if it's part of a run) and `app.js` (if it's visual).
- The mirror ambiguity is resolved against ground truth only for **evaluation/display**; never use
  truth to inform the solver's positions or clock offsets. Keep that invariant when adding features.
- Expose UI state on `window.espArraySim` so Playwright tests can inspect it later.
- Register/check via the launcher `apps.yaml` (id `esp-array-sim`, port 5193); update this file's
  port if you change `PORT`.

## Don't

- Don't pull Playwright/Chromium blobs; browser E2E is a deferred follow-up (see docs/index.md).
- Don't reimplement physics in the renderer — read it from `src/`.