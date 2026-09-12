# Vroomon audit — 2026-09-10

Audit of `active/games/vroomon/` (the Electron/TS rewrite + legacy Python
prototype). Baseline: build clean, 135 Vitest unit tests pass, the 8 Playwright
web e2e tests pass (~10s), `profile:sim` averages ~55 ms/generation.

Findings are ordered by severity. "Needs fixing" = shipped code that is broken
or will break; "needs doing" = backlog/drift items.

**Resolution status (2026-09-10): → ✅ RESOLVED** — see below for each item's
state and commit. Baseline for the fixes: 143 Vitest unit tests + 16 Playwright
e2e pass, `python scripts/check_web_app.py vroomon --e2e` green.

1. ✅ Dockerfile/k8s/DEPLOYMENT switched to the web-server model
   (web-server.mjs serves on 5112; httpGet probes; UID 1001 + fsGroup;
   `vroomon:web-test` image verified serving + feedback round-trip as root
   and as 1001). Commit `98d532c2`.
2. ⚠️ esbuild/yaml: still undeclared in package.json (transitive-only) —
   smallest remaining clean-up; works today.
3. ✅ check_web_app.py `vroomon` entry + CI e2e job (`6157f5a3`).
4. ✅ Legacy Python suite: restored to green (101 passed + 17 subtests; was
   12 failed + 3 errors). Rectangle/populate/simulation test drifts repaired
   and simulation.py hardened (headless fallback, broad draw-error catch,
   removal-error logging); `full_auto_ci` moved to an optional dep.
5. ✅ DEPLOYMENT.md/Dockerfile/AGENTS re-themed to the web-server + ranch
   fiction (`98d532c2`, `05fc6ab1`).
Bonus (this cycle): UI overhaul (menu A/B, stats HUD, labels/art), faction
worldbuilding with playable mini-stories for all six biomes, dead-end
overworld fixed, web persistence via localStorage (`0f435162`).

---
 — nothing binds port 5112

- `src/main.ts` (Electron main process) binds **zero** TCP ports. The only
  listener on 5112 is `scripts/web-server.mjs` (plain Node HTTP), which is what
  the launcher runs (`apps.yaml` → `npm run build && node scripts/web-server.mjs`).
- `k8s/vroomon.yaml` uses `tcpSocket` readiness **and** liveness probes against
  port 5112, plus a `Service` → 5112.
- `DEPLOYMENT.md` claims "the app's smoke-test webview listens" on 5112
  ("Local Electron … routes `vroomon.shsw.dev` → `127.0.0.1:5112` where the
  app's smoke-test webview listens"). There is no such webview in the current
  code — it was removed when the browser-compatible web-server architecture
  landed. The container runs `xvfb-run … electron .`, which neither binds 5112
  nor serves HTTP.
- The cloudflared sidecar/ingress rule maps `vroomon.shsw.dev` →
  `http://127.0.0.1:5112` **inside the pod**, so it proxies to a refused
  connection.

Consequence if the documented rollout is executed today: the pod never becomes
Ready (probe connection refused → container restarted), and the tunnel serves
502/1033. The image has not actually been pushed yet (status table: ❌ pending),
so this is a latent blocker, not an outage.

**Fix (one PR):**
1. `Dockerfile`: `CMD ["node", "scripts/web-server.mjs"]` and drop the
   Electron/xvfb layer (libgtk/libnss3/xvfb etc. are unused by the web server).
   Keep `EXPOSE 5112` — now truthful. (Optional: keep a dist-based
   multi-stage so the image only copies `dist/`, `package.json`, lockfile.)
2. `k8s/vroomon.yaml`: probes → `httpGet { path: /, port: 5112 }`; keep the
   Service; the `VROOMON_*_` Electron-only env vars become unnecessary.
3. `DEPLOYMENT.md`: rewrite "Why this isn't a normal web container", the status
   table, the local-origin section, caveats, and the verification snippet that
   does `kubectl exec … curl http://127.0.0.1:5112` — the web server *is* a
   normal web container now.
4. `tests/deployment.test.ts`: the `"ships a Dockerfile that wraps electron in
   xvfb-run"` assertion currently locks in the stale design; update it to assert
   the web-server serving model.

## 2. [High] Undeclared direct dependencies: `esbuild` and `yaml`

- `scripts/copy-static.mjs` imports **`esbuild`**; `tests/deployment.test.ts`
  and CI's `Validate k8s manifest` step (`require('yaml')`) use **`yaml`**.
- Neither is in `package.json`; both arrive only via transitive hoisting
  (verified: `node_modules/esbuild@0.27.4`, `node_modules/yaml@2.8.2`, both
  absent from `dependencies`/`devDependencies`).
- Works today; breaks the moment a transitive dep tree changes. The Docker
  build (which only runs `npm ci`) is especially fragile here.

**Fix:** add `esbuild` and `yaml` to `devDependencies` and `npm install` to
refresh the lockfile.

## 3. [Medium] CI coverage gaps

- `build-image.yml` push path-filter omits `electron/scripts/**` (the actual
  serving runtime, `web-server.mjs`) and `electron/package-lock.json`, so
  pushes that change the server skip the image build.
- CI runs unit tests only; the 8 Playwright tests (`tests/e2e/vroomon.e2e.ts`,
  ~10s) — the real regression gate for the browser UI — never run in CI.
- `scripts/check_all.py` / `scripts/check_web_app.py` have **no vroomon entry**,
  unlike thermofluid, vernissage, esp-array-sim, watch-forge — so there is no
  local on-demand check for this app.

## 4. [Medium] Legacy Python reference suite is red (12 failed + 3 errors)

Runnable locally via:
`nix-shell -p python312Packages.pytest python312Packages.pygame python312Packages.pymunk python312Packages.tqdm python312Packages.loguru --run "pytest"`.

Three distinct drifts (code and tests evolved apart):

- `tests/test_rectangle.py` (6 fails): code now warns via loguru
  (`_warn_invalid_dimension` → `logger.warning`), tests still patch
  `builtins.print` and assert it was called.
- `tests/test_population_mutate.py` (3 errors): the autouse fixture patches
  `pop.ALL_FRAME_PARTS` / `pop.ALL_POWERTRAIN_PARTS`, which no longer exist as
  `population` module attributes (refactored into `_runtime_dependencies()`).
- `tests/test_simulation.py` (6 fails): pygame-mocking assumptions drifted
  (e.g. expecting `AttributeError` when `vroomon.simulation.pygame` is patched
  to `None`; the module now guards that path).
- Also `pyproject.toml` declares `full_auto_ci` (git ref) as a **runtime**
  dependency, but nothing in `src/` or `tests/` imports it.

Since the prototype is the parity/reference model for the rewrite, a red
reference suite undermines that claim. Either repair the three files or
annotate them as known-legacy (and move `full_auto_ci` to a dev/optional dep).

## 5. [Medium] Documentation drift

- `DEPLOYMENT.md` + `Dockerfile` describe the pre-web-server architecture
  (xvfb Electron, "Electron does not serve HTTP", smoke-test webview on 5112),
  while `AGENTS.md`, `apps.yaml`, and `web-server.mjs` describe the current
  browser-serving model. The two halves contradict each other (see #1).
- `AGENTS.md` Testing section lists the `npm run build` bullet twice.

## 6. [Low] NixOS e2e ergonomics

`scripts/run-playwright.mjs` on NixOS shells out to `nix build nixpkgs#chromium`
(slow, no cache). During this audit the full e2e suite passed in ~10s with:

```bash
VROOMON_BROWSER_EXECUTABLE=/run/current-system/sw/bin/google-chrome-stable npm run test:e2e
```

Worth documenting in AGENTS.md (or having the script prefer a present Nix
`google-chrome` before falling back to a Nix build).

## 7. [Low] Code nits

- `src/simulation/matter-simulation.ts`: `lastWheelAnchorX` is assigned but
  never read; the orphan-wheel entry's `wheel` field is unused after the
  deferred attach pass.
- `src/renderer/state.ts`: `applyGenerationToState` prints
  "Completed generation ${state.runState.generation + 1}" while the new entry
  records `nextRunState.generation` — equivalent in practice, but use one
  source of truth.

---

## Positive findings (no action)

- `npm run build` clean; TS strict, zero `any` usages; no TODO/FIXME/HACK/BUG
  markers anywhere in `src/`, `tests/`, `scripts/`.
- `web-server.mjs`: traversal guard (`resolve` + `startsWith(DIST_DIR)`),
  feedback payload validation, JSONL cap at 200 entries, no open writes outside
  `.secrets/` (gitignored).
- Secrets hygiene is good: tokens only ever come from the gitignored
  `.secrets/` dir or `kubectl create secret`; `deploy-from-secrets.sh` refuses
  chat-pasted secrets; CI workflow never embeds credentials.
- DNA v2 decode clamps every parameter (motor power ≥ 0, friction ≥ 0.4, sizes
  ≥ 0) — the NaN/zero-power-wheel failure modes that plagued the Python
  prototype are structurally excluded in the TS implementation.
- Launcher/`apps.yaml` registration is internally consistent with
  `web-server.mjs` (port 5112, `VROOMON_WEB_*` env).