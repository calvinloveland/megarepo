# vroomon AGENTS.md

Project-specific guidance for working in `active/games/vroomon/`. Read the
[README.md](README.md) for the landing page, [docs/index.md](docs/index.md) for
the canonical project docs, and the [megarepo root AGENTS.md](../../AGENTS.md)
for global workflow rules.

## Layout

- `src/vroomon/` — legacy Python/PyGame/PyMunk prototype, kept as a behavioral
  reference while the rewrite lands.
- `electron/` — the Electron + TypeScript rewrite target. Most active work
  lives here.
- `electron/src/shared/` — DNA v2, parity contract, shared types. Pure modules,
  safe to import from both the main process and the renderer.
- `electron/src/core/` — population evolution, persistence, scoring. Pure logic,
  runs in the renderer, the worker, and the Playwright shim.
- `electron/src/simulation/` — Matter.js physics. Runs in the renderer and the
  Playwright shim. The standalone worker does **not** import this directly.
- `electron/src/renderer/` — DOM, state, view-model, and the evolution worker.
  Anything that touches `window` or `document` belongs here.
  - `index.html` — the Electron desktop app shell (control-panel style)
  - `game.html` — the web app shell (game-themed, pixel-art aesthetic, served by
    `scripts/web-server.mjs` as the default page for `vroomon.shsw.dev`).
    Action buttons (Generate, Run Generation, Run Batch, Random DNA, Save to
    Hall) are floating game-HUD overlays INSIDE the viewport, not side-rail
    controls. The viewport fills the screen in evolution / test-drive modes;
    the right rail collapses and only the Run Config panel survives (on the
    left). World mode keeps the right rail for the D-pad.
- `electron/src/main/` — Electron main process only (BrowserWindow, IPC, file
  store). Never import from the renderer.
- `electron/tests/` — Vitest unit tests + Playwright e2e tests.
- `electron/Dockerfile` + `electron/k8s/vroomon.yaml` +
  `electron/DEPLOYMENT.md` + `electron/Makefile` +
  `electron/scripts/deploy-from-secrets.sh` +
  `electron/scripts/deploy-guide.mjs` +
  `electron/scripts/deploy.sh` +
  `electron/scripts/create-tunnel-dns.sh` +
  `electron/scripts/cloudflared-ingress.yml` +
  `electron/scripts/setup-cloudflared.sh` +
  `electron/scripts/web-server.mjs` +
  `electron/.github/workflows/build-image.yml` — the deploy + serve
  surface for `vroomon.shsw.dev`. The web server (web-server.mjs)
  serves the browser-compatible renderer at port 5112 and exposes a
  `/api/feedback` endpoint (POST/GET/DELETE) that receives
  client-side error reports from the ErrorLogger. Reports are
  stored in `.secrets/feedback.jsonl` (gitignored, capped at 200
  entries). The Docker image wraps Electron in `xvfb-run`; the
  k8s manifest adds a `cloudflared` sidecar; the Makefile and
  deploy-from-secrets.sh are the local rollout. The deploy-guide
  walks through the deploy without secrets passing through chat.
  None of these files contain secrets. The CI workflow builds
  the image and runs the test suite on PRs.

## Testing

- `npm test` (in `electron/`) — Vitest, all 50+ unit tests.
- `npm run build` — runs `tsc` then `node scripts/copy-static.mjs`. Use this
  before `npm run test:e2e` or `npm run test:smoke` because both need `dist/`.
  The build step also uses `esbuild` to bundle the web-facing modules
  (`playwright-preload-shim.ts` and `renderer.ts`) into self-contained
  files. This is required for the browser to load them — the source uses
  deep relative imports (`../shared/...`, `../core/...`) that don't resolve
  in a web context.
- `npm run build` — runs `tsc` then `node scripts/copy-static.mjs`. Use this
  before `npm run test:e2e` or `npm run test:smoke` because both need `dist/`.
- `npm run test:e2e` — Playwright against the local build. Requires the
  display server flags the smoke script sets; on headless boxes rely on
  `xvfb-run`.
- `npm run test:smoke` — boots real Electron, exits when the renderer reports
  the `VROOMON_SMOKE_SUCCESS` payload. Use this when you need a "did the app
  actually start" check that unit tests can't give.
- `npm run profile:sim` — runs `scripts/profile-sim.mjs` against `dist/`.
  Useful when chasing population race performance regressions.

## Conventions

- TypeScript strict mode is on (`tsconfig.json`); do not relax it.
- ESM-only (`"type": "module"` in `electron/package.json`). Use `.js`
  extensions in import specifiers even for `.ts` files.
- Renderer code talks to the main process only through `window.vroomon.*` and
  IPC. The Playwright shim mirrors the same surface but lives in memory.
- The evolution worker is a module worker (`type: "module"`). It imports from
  `core/` and `shared/` but **not** from `simulation/`, because the worker
  uses the synchronous `runEvolutionGeneration` loop, not Matter.js.
- Never add a `.only` or `.skip` to the Vitest suite. TDD-friendly red/green
  flow means leaving a failing test in place with a clear name.
- The Hall of Fame and the run state share a `vroomon/` subfolder under
  `app.getPath("userData")`. Don't split them into separate directories
  without a migration.

## State management

- The renderer's `RendererState` (`electron/src/renderer/state.ts`) is the
  single source of truth for UI state. All mutations go through small
  exported functions that take the current state and return the next.
- `scoreHistory` and `hallOfFame` persist for the renderer session and
  reproduce from disk on startup via IPC.
- The score chart and Hall of Fame re-render via the central `renderApp()`
  call. Do **not** add `innerHTML` writes outside `renderApp`/`renderXxx`
  helpers — they bypass state.

## Commit hygiene

- One feature per commit. The recent history (Hall of Fame, batch runner,
  textures, convergence, worker) is a good template.
- If you add a new top-level dependency, run `npm install` from
  `electron/` so `package-lock.json` stays in sync.
