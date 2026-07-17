# Blood Marble AGENTS.md

Project-specific guidance for `active/games/marble-survivors/`.

## Layout

- `index.html` — Entry point: canvas, overlays, controls bar.
- `style.css` — Mobile-first dark theme, responsive, touch-optimized.
- `game.js` — All game logic (~900 lines). Pure Canvas 2D, no frameworks.
- `server.mjs` — Minimal Node HTTP static server. `npm start` to serve.
- `docs/index.md` — Web docs for the project site.

## Game Architecture

- **Game state** lives in the global `G` object.
- **Systems** are plain functions called from `gameLoop()` each frame:
  - `updateShake`, `updateWave`, `updatePlayer`, `updateEnemies`,
    `updateProjectiles`, `updateXP`, `updateParticles`,
    `updateFloatingTexts`, `updateDamageNumbers`
- **Rendering** is a single `render()` pass with a DPR-aware canvas transform.
- **Upgrade UI** is DOM-based (not canvas) so it's accessible on mobile.
- **Audio** uses Web Audio API oscillators — no asset files needed.

## Controls

- Gyroscope (DeviceOrientationEvent) on mobile.
- Mouse/touch/WASD fallback on desktop.
- Toggle between schemes with the bottom bar button.

## Convictions

- No build step. The game is served as static files.
- No framework dependencies. Vanilla JS only.
- Canvas 2D (not WebGL) to keep the codebase simple and hackable.
- Only one script file (`game.js`) — keep it that way.
- The end-of-file `window.*` export block is a **test surface**: it exposes
  `G`, `UPGRADES`, and the system functions so Playwright can drive the game
  deterministically via `page.evaluate`. Do not remove it; keep it in sync
  when adding new exported functions.

## Testing

`npm test` runs the Playwright suite (`tests/*.spec.cjs`). The config
(`playwright.config.cjs`) auto-starts `server.mjs` and points at the
Nix-managed Chromium (`/nix/store/.../chromium`) — override with
`CHROMIUM_PATH`. Helpers in `tests/helpers.cjs` provide `waitForGameReady`,
`stepGame` (deterministic fixed-dt stepping without rAF), `getState`, and
an error collector.
