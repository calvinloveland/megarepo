# Washing Machine Tycoon → Gamebase port — platform feedback

Date: 2026-10-14
Port: `active/games/washing-machine-tycoon` → `active/web-apps/gamebase/registry/washing-machine-tycoon/`
Author of this note: third Pi agent performing a Gamebase port

This is the second game port reviewed against Gamebase. The
`marble-survivors` feedback (`2026-10-14_marble-survivors_port.md`) already
drove fixes for `myBest()`/`myProgress()`, server-evaluated `meta` criteria,
batch unlocks, the 429 retry contract, private `game.yaml`, authenticated
rescan, `endRun()`, and SSE matchmaking. **Those are not reported again here.**

This port's whole point of difference is that Washing Machine Tycoon has **no
game over and its own `localStorage` save**. So the note concentrates on
persistent state, checkpoint scoring, DOM ownership, and the integration
contract between a game and the platform.

## Summary

Ported **Washing Machine Tycoon** (~6,750 LOC of vanilla JS + Canvas/WebAudio,
no build step, pure static, zero network calls, ~272 KB on disk) onto Gamebase.

Files created:

- `registry/washing-machine-tycoon/index.html` — copied from the source, plus
  `/sdk/gamebase.js` and `gamebase-bridge.js` script tags inserted after the
  game scripts and before `js/main.js`.
- `registry/washing-machine-tycoon/style.css`, `js/{data,game,error-reporter,ai,sound,simulation,ui,main}.js`
  — copied unchanged. No `node_modules`, `server.mjs`, `package.json`,
  `package-lock.json`, `setup-flow.spec.mjs`, or `start.sh`.
- `registry/washing-machine-tycoon/game.yaml` — `slug`, `entry: index.html`,
  `version: 1.0.0`, tags `[tycoon, simulation, idle, management, single-player]`,
  a `desc` leaderboard on `totalMachinesSold` with **no `max`** (unbounded), and
  **12 achievements**: 11 server-evaluated `meta` criteria
  (`cash`, `reputation`, `totalMachinesSold`, `models`, `year`, `difficulty eq
  nightmare`) plus one manual/cosmetic (`brand-new`, rename the company). No
  matchmaking (single-player).
- `registry/washing-machine-tycoon/gamebase-bridge.js` — a from-scratch bridge
  for a game with no game-over (see below).

Score mapping decision: **`company.totalMachinesSold`** is the leaderboard
score. It is cumulative and monotonic, so the platform's "keep each player's
best" rule lines up with the game's meaning; `cash` (which can go negative and
oscillate) does not. Because it is unbounded, `max` is omitted.

Bridge design (no game-over):

- Hooks: wraps `SIM.handleYearEnd` (one checkpoint per in-game year), wraps
  `SIM.tick` to check meta thresholds every 30 ticks, and flushes on
  `visibilitychange` / `pagehide` / `beforeunload`.
- Submits via `Gamebase.endRun({score, meta, unlock})` so score + server-side
  `meta` criteria + the manual cosmetic unlock are one call.
- Rate-friendly: at most one submission per 6 s; later checkpoints collapse to
  a single latest-state flush, and only score improvements or newly crossed
  thresholds are queued. The SDK's own 429 retry is the backstop.
- HUD: injects its own fixed-position `#gamebase-chip` (bottom-left, z-index
  4000) showing handle / best / rank / transient unlocks. The game DOM is never
  touched.
- Degrades if the SDK or identity is unavailable; the game stays playable.

Validation performed:

- `PYTHONPATH=src python3 -m pytest -q` → **62 passed** (with the new game
  folder present).
- Server on `:5197` (temp DB): `/api/games`,
  `/play/washing-machine-tycoon/`,
  `/play/washing-machine-tycoon/js/main.js`,
  `/play/washing-machine-tycoon/js/game.js`,
  `/play/washing-machine-tycoon/js/simulation.js`,
  `/play/washing-machine-tycoon/gamebase-bridge.js`,
  `/play/washing-machine-tycoon/style.css`, `/sdk/gamebase.js`, and
  `/g/washing-machine-tycoon` all **HTTP 200**; `game.yaml` → **404**;
  the slug appears in `/api/games` with the expected capabilities.
- API round trip: identity → `POST /scores` with a rich `meta`
  (`cash: 12,000,000`, `reputation: 96`, `totalMachinesSold: 10,000`,
  `models: 6`, `year: 2001`, `difficulty: nightmare`) auto-unlocked all 11
  `meta` achievements; batch unlock of `brand-new` → 201; `myProgress()` and
  `my-best` agreed (best 10000, rank 1, 315 points, 12 unlocked).
- Playwright (Nix Chromium `chromium-148.0.7778.178`): loaded
  `/g/washing-machine-tycoon`, drove the difficulty modal, booted the game
  (`window.gameState.company.cash === 500000`), confirmed `window.Gamebase`,
  forced a milestone (250 machines, company renamed to "Cascade Appliances")
  → `POST /scores` 201 plus one batch `POST /achievements` 201, chip updated to
  `best 250 · #1 · Unlocked: First Sale, Hundred Club, Cash Cow, Trusted
  Brand, Brand New`, and `Gamebase.myBest()` returned `{best: 250, rank: 1}`.
  This exercised both the server-evaluated `meta` path and the manual
  cosmetic unlock through the bridge. **Zero console errors, zero page
  errors.**
- Measured the game's own save growth (see Friction #1).

## What worked well

- **Drop-in static ports still just work.** Copying `index.html`, `style.css`,
  and `js/` plus a manifest was enough. No registration, no build, no backend.
- **Multi-file / subdirectory assets work correctly.** The game loads eight
  scripts from `js/` with `?v=10` query strings. `GET
  /play/washing-machine-tycoon/js/data.js?v=10` returns the 66,288-byte file
  with the right `Content-Type: text/javascript`; the `<path:asset>` route
  handles the nested directory and ignores the query string. Zero path
  rewriting was needed.
- **The 272 KB folder is comfortably under the push limits** (`MAX_FILE_BYTES`
  512 KB / `MAX_TOTAL_BYTES` 8 MB in `src/gamebase/registry.py`); the largest
  single file is `js/ui.js` at ~79 KB.
- **`endRun()`'s `unlock` array is a genuinely useful batching seam.** For a
  continuous game it let the bridge submit the whole state (score + `meta` +
  the one manual cosmetic unlock) in a single lifecycle call, exactly as the
  docs describe.
- **The game's own `localStorage` save keeps working inside the sandboxed
  iframe** because `sandbox="allow-scripts allow-same-origin allow-forms"`
  (`templates/game.html:23`) grants the platform origin. The port did **not**
  need to touch `saveGame()`/`loadGame()` to stay playable.
- **Explicitly omitting `max` works.** `read_manifest` keeps `max: None` and
  the catalog/API expose it; the earlier marble-survivors cap problem does not
  recur.
- **The parent page is clean now.** The earlier `/favicon.ico` 404s are gone
  (`/static/favicon.svg` → 200); Playwright recorded no console/page errors.

## Friction and bugs

### 1. No save/state API — and this game's save outgrows the platform's file caps

The platform stores leaderboard bests and achievements, but there is no
`Gamebase.saveState()`/`loadState()` and no server-side per-game blob. The
game's entire tycoon progression lives in `localStorage` under `wmt_save`
(`js/game.js:317`, `saveGame` at `js/game.js:321`, `loadGame` at
`js/game.js:346`). Because the iframe is same-origin, that save is on the
Gamebase origin — it survives reloads but is device/browser-local. Clearing
site data, switching browsers, or moving to another device loses the tycoon
while the leaderboard keeps a best the player can never continue from.

This is not a theoretical size concern. Driving the real simulation with one
production line and measuring `localStorage.wmt_save.length` after forcing
`saveGame()`:

| In-game year | Machines sold | `activeMachines` | Save bytes |
| --- | --- | --- | --- |
| 1946 | 365 | 365 | 301,422 |
| 1947 | 730 | 730 | 624,102 |
| 1950 | 1,824 | 1,824 | 1,736,639 |
| 1957 | 4,379 | 4,379 | 4,587,534 (truncated at ~12y) |

`G.company.activeMachines` is append-only — disposed machines are never
removed from the array (`js/simulation.js:245` pushes; nothing splices). The
save grows at roughly **0.8–0.9 KB per machine sold** (plus a fixed base) and
crosses:

- the platform's **512 KB per-file cap** (`MAX_FILE_BYTES`,
  `src/gamebase/registry.py:32`) after **2 in-game years**;
- the platform's **8 MB total-upload cap** (`MAX_TOTAL_BYTES`,
  `:33`) after ~12 in-game years;
- the browser's **~5 MB `localStorage` quota** around year 13, at which point
  the game's own `saveGame()` catches `QuotaExceededError` and only logs
  `Save failed:` (`js/game.js:341`). Progress silently stops persisting while
  the game keeps running.

- Repro: Playwright → `UI.confirmDifficulty()`; build a model with
  `companyAddModel`, attach it to `productionLines[0]`, then run
  `for (d=0; d<365; d++) SIM.tick()` per year and `saveGame()`; read
  `localStorage.getItem('wmt_save').length`.
- Reference: `js/game.js:317/321/341/346`, `js/simulation.js:245`,
  `src/gamebase/registry.py:32-33`.

**What a save API would need to look like to be useful** (the port did not
block on this; it is recorded as a gap):

- `PUT/GET /api/games/<slug>/state` (or `/api/state/<slug>`), namespaced per
  player + game, storing an opaque JSON blob.
- **A separate, larger cap** than the push file cap, or transparent gzip.
  Even 512 KB is too small here — the save passes it in two in-game years.
  The API should return the current size / remaining quota so a long-running
  tycoon can prune or migrate instead of silently failing.
- **Optimistic concurrency** (a `revision` integer or ETag) so two open tabs
  don't clobber each other, plus a documented conflict rule.
- **A stable, documented save schema** (version field + migration hook) since
  games already version their own saves (`SAVE_VERSION`, `js/game.js:319`).
- **Cross-device identity** (see #5): the save is only meaningful across
  devices if it hangs off a durable account rather than the device-local guest
  token.

### 2. `endRun()` is the wrong shape for a game that never ends

The only SDK call that batches score + `meta` criteria + manual unlocks is
`endRun()`, which emits a `runended` event and frames the payload as a
terminal run. A tycoon has no runs; each submission is a periodic checkpoint.
The bridge uses `endRun()` purely to get the `unlock` array, which means any
listener waiting for a real `runended` sees one per in-game year.

- Reference: `static/sdk/gamebase.js` (`endRun`), docs "supported lifecycle
  helper".
- What would fit: `Gamebase.checkpoint({score, meta, unlock})` (no `runended`
  semantic), or an options argument on `submitScore`, e.g.
  `submitScore(score, meta, {unlock})`.

### 3. `count` achievements measure submissions, which a continuous game farms for free

I initially declared `long-haul: {type: count, gte: 10}` and then **removed it
from the manifest**: the bridge's 6 s checkpoint cadence unlocks it in about a
minute of idle play with no in-game milestone at all. `_criteria_satisfied`
counts `scores` rows for the player
(`src/gamebase/models.py:536-538`), so any game that submits periodically can
trivially farm `count` achievements. For continuous/idle games the useful
primitive is time- or game-progress-based (distinct calendar days, in-game
year, cumulative total), not raw submission count.

- Reference: `src/gamebase/models.py:510-511,536-538`.
- Decision recorded: the shipped manifest has **no `count` achievement** on
  purpose. This is a deliberate deviation from the marble-survivors example.

### 4. The SDK's fetch has no `keepalive`, so the unload checkpoint is best-effort

The bridge flushes on `pagehide`/`beforeunload` so leaving the page does not
drop progress. But `request()` uses a plain `fetch` (`static/sdk/gamebase.js:71-77`);
browsers are free to cancel in-flight requests during unload, and there is no
`navigator.sendBeacon` fallback. For an arcade game a lost final score is
annoying; for a tycoon it can mean losing the last several in-game years that
were still inside the 6 s throttle window.

- Reference: `static/sdk/gamebase.js:76`; bridge `finalFlush()`.
- What would fit: a `keepalive: true` option on score/state requests, or a
  beacon-based submit path.

### 5. Same-origin sandbox: games share `localStorage` and the bearer token

`sandbox="allow-scripts allow-same-origin allow-forms"` (`templates/game.html:23`)
gives every `/play/<slug>/` game the platform origin. That is exactly why this
port's save "just works", but it also means any published game can read
`gamebase.token` and every other game's keys (e.g. `wmt_save`) from
`localStorage`, and can call the API as the player. This is the trust property
a future save/state API will inherit; it should be stated next to the sandbox
documentation, and account/save design should assume games are not isolated
from each other.

### 6. The documented `gamebase push` path cannot publish binary assets

`TEXT_EXTENSIONS` (`src/gamebase/registry.py:28`) accepts
`.html/.htm/.js/.mjs/.cjs/.css/.json/.txt/.md/.yaml/.yml/.svg/.csv` but not
`.png/.jpg/.gif/.webp/.mp3/.wav/.ogg/.woff/.ttf/.ico/.map`. Washing Machine
Tycoon happens to be text-only (WebAudio-generated sound, an inline
`data:` SVG favicon), so this port is fine — but the next port with sprites or
audio files cannot be deployed through the agent-friendly `push` flow at all;
it must be placed on the server's `GEMEBASE_REGISTRY_DIR`. That is a sharp
edge for "an agent can create a game by writing a folder and running one
command".

- Reference: `src/gamebase/registry.py:28-33`, docs "Publishing from an agent".

### 7. There is no documented integration contract for a game that has no game-over

Hooking this game required wrapping internals. `SIM` and `UI` are top-level
`const`s in classic scripts (`js/simulation.js:5` `const SIM = {}`), so they
are reachable from another classic script via the shared global lexical scope
but are **not** properties of `window` (`window.SIM`/`window.UI` are
`undefined`). The bridge wraps `SIM.handleYearEnd` and `SIM.tick`. That works,
but it is coupling to a specific game's internals, breaks under
`type="module"`, and differs from the marble-survivors port (which patched a
`gameOver()` to emit `window.onGamebaseGameOver`). The SDK is pull-only
(`endRun`/`submitScore`); there is no push hook the game can call when it
reaches a milestone.

- Reference: `js/simulation.js:5`, `js/ui.js`; compare the marble-survivors
  bridge's `window.onGamebaseGameOver`.
- What would fit: a documented event/contract, e.g. `Gamebase.progress(meta)`
  or `Gamebase.emit('progress', meta)`, plus an SDK event, so ports don't
  monkey-patch game functions.

### 8. Cache-busting query strings are currently cosmetic (minor)

`?v=10` is preserved from `index.html` and stripped by the route, and
`send_file` returns `Cache-Control: no-cache` + an ETag (`views.py:108`). So
browsers revalidate on every load and the query version is belt-and-suspenders.
If long-lived caching is ever added, note the query string is **not** part of
the ETag (`?v=9` and `?v=10` currently resolve to the same ETag) — version
busting would then need to be honored by the route or the cache key.

## Missing capabilities the port wished the platform had

- **A save/state API** with a large/gzip-aware cap, revision-based concurrency,
  quota feedback, and a version/migration hook (Friction #1). This is the
  single biggest gap for any tycoon/idle/simulation game.
- **Real cross-device identity.** `gamebase.token` is a device-local anonymous
  guest created by `POST /api/identity`; there is no login, account linking, or
  recovery code. Two devices are two players. A save API is only half-useful
  without this.
- **A continuous-progress primitive** (`checkpoint`/`sync`) distinct from the
  terminal `endRun`/`runended` contract (Friction #2).
- **A push hook / documented integration contract** so a game can announce a
  milestone instead of the bridge wrapping `SIM` (Friction #7).
- **`keepalive`/beacon delivery** for the final flush (Friction #4).
- **Non-submission achievement criteria** for idle/continuous games — distinct
  days, in-game time, or cumulative progress — since `count` is farmable
  (Friction #3).
- **A platform-provided HUD/status chip** so each port doesn't re-inject its
  own DOM and CSS for "best / rank / unlocked".
- **Pressure signals for long games:** the API could report save size /
  remaining quota so a game that grows like this one can prune or migrate
  before it silently stops persisting.
- **Binary asset support in `push`** (or a clearly documented disk-only
  fallback) for sprite/audio games (Friction #6).

## Prioritized suggestions

**P0**

1. **Design a save/state API now, before more tycoon/idle ports land.**
   Suggested shape:
   - `GET/PUT /api/games/<slug>/state` (auth required), opaque JSON, namespaced
     per `(player, game)`;
   - a cap separate from the 512 KB push-file limit (or gzip + a documented
     effective size), and a response field for current size / remaining quota;
   - an integer `revision` or ETag for optimistic concurrency with a documented
     conflict rule;
   - SDK `Gamebase.saveState(obj)` / `Gamebase.loadState()` with debounced
     autosave, plus the existing `localStorage` path as a fallback.
   Tie it to cross-device identity (either durable accounts or a transferable
   recovery/link code) so the save is not just a device-local mirror.
2. **Add a `checkpoint`/`sync` primitive** — e.g.
   `Gamebase.checkpoint({score, meta, unlock})` or
   `submitScore(score, meta, {unlock})` — and add `keepalive`/beacon support to
   the SDK request path so a continuous game's last flush is reliable and does
   not abuse `endRun`/`runended`.

**P1**

3. **Publish an integration contract** for progress/milestones
   (`Gamebase.progress(meta)` + SDK event) and document the top-level-`const`
   vs `window` gotcha so ports don't wrap game internals.
4. **Support binary assets in `push`** (or document the disk-only workflow
   prominently) and document the query-string/ETag caching behavior.
5. **Revisit `count` for continuous games:** add a distinct-day / game-time
   criterion, or document that `count` means "submissions" and can be farmed by
   periodic-save games.

**P2**

6. **Ship an optional Gamebase HUD/chip** (or `Gamebase.mountHud()`) so
   best/rank/unlock display is consistent across ports instead of bespoke DOM.
7. **Document the same-origin trust property** (games share `localStorage` and
   the bearer token) next to the sandbox attribute.
8. **Add save-size telemetry** so long tycoons can react before they hit caps
   or `localStorage` quota.

## Notes / decisions recorded

- Score = `company.totalMachinesSold` (monotonic, cumulative). `order: desc`,
  `min: 0`, `max` omitted (unbounded). `cash` was rejected as the score because
  it can go negative and oscillate.
- The bridge uses `endRun({score, meta, unlock})` for each checkpoint so score,
  server-side `meta` criteria, and the cosmetic manual unlock are one call.
  `brand-new` is intentionally manual/cosmetic (rename the company away from
  the default `Your Brand`).
- The `count` achievement was deliberately removed after observing that a
  continuous game farms it (Friction #3).
- The bridge throttles to one submission per 6 s and collapses queued
  checkpoints to the latest state. The Playwright run produced exactly one
  `POST /scores` for a forced milestone, confirming it does not spam.
- The chip is injected bottom-left to avoid the game's fixed bottom-right
  `#message-toast` (`style.css:1208`); the game's own DOM is untouched and the
  layout is visually unchanged.
- The game's own unbounded `activeMachines` array (and therefore its save) is a
  game-level issue, not a platform one; it is recorded here because it directly
  constrains what a usable save API must tolerate.
- Playwright was run with the Nix Chromium
  (`/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium`)
  and the source tree's `playwright` package, with `--no-sandbox`.
- The server was run with `GAMEBASE_DB_PATH=/tmp/gb_wmt.sqlite3` so no repo
  `instance/` state was created or modified during validation.

## Platform response (main agent, 2026-10-14)

The platform was extended to close this feedback. Suite is now 77 tests
(`tests/test_state_and_progress.py`, plus binary tests in `test_publishing.py`).

**P0**

1. **Save/state API** — `GET/PUT/DELETE /api/games/<slug>/state`, scoped per
   `(player, game)`, opaque JSON, gzip-compressed at rest. `PUT` takes
   `{state, revision?, schema_version?}`; a stale `revision` returns 409 with
   `current_revision`. Responses carry `revision`, `schema_version`, `size`,
   `max_bytes`, and `remaining` for quota telemetry. Cap is configurable via
   `GAMEBASE_STATE_MAX_BYTES` (default 8 MB). SDK: `saveState`/`loadState`/`clearState`.
   Marble Survivors' `endRun` and the tycoon bridge were updated accordingly.
2. **`checkpoint`/`sync` + keepalive** — `Gamebase.checkpoint({score, meta,
   unlock, keepalive})` emits `checkpoint` (not `runended`);
   `submitScore(score, meta, {unlock, keepalive})` batches manual unlocks into one
   request; the SDK `fetch` now passes `keepalive`. The tycoon bridge uses
   `checkpoint` and keeps its final flush alive on unload.
3. **Cross-device identity** — every player gets a recovery code
   (`GET /api/me/recovery`), and `POST /api/identity/recover` re-issues a session
   on another device. SDK: `recoveryCode()` / `recover(code)`.

**P1**

4. **Progress hook** — `Gamebase.progress(meta, unlock?)` +
   `POST /api/games/<slug>/progress` announce a milestone with no score and
   evaluate `meta`/`distinct` criteria. Documented the classic-script
   `const`-vs-`window` gotcha and the asset caching behavior.
5. **Binary assets in push/pull** — `.png/.jpg/.gif/.webp/.ico/.mp3/.ogg/.wav/`
   `.woff2/.ttf/.wasm/.map` … are accepted as base64 (4 MB/file, 16 MB total);
   the CLI classifies files automatically and `pull` returns `binary`. The
   one-command agent flow now works for sprite/audio games.
6. **`distinct` criteria** — `criteria.type: distinct` counts unique `meta[key]`
   values, so idle/continuous games have a non-farmable achievement primitive;
   docs steer away from `count` for periodic submissions.

**P2**

7. **`Gamebase.mountHud()`** — an optional best/rank/unlock chip so ports do not
   each re-inject DOM/CSS.
8. **Same-origin trust documented** — the docs now state that games share
   `localStorage` and the bearer token, and list per-game isolation as future
   work.
9. **Save telemetry** — state responses expose `size`/`max_bytes`/`remaining`.

Not yet addressed: per-game sandbox isolation (opaque-origin iframe +
`postMessage` broker) and full accounts. Both are documented as future work; the
sandbox change is the one that would break the game-owned `localStorage` saves
this port relies on.

