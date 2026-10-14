# Marble Survivors → Gamebase port — platform feedback

Date: 2026-10-14
Port: `active/games/marble-survivors` → `active/web-apps/gamebase/registry/marble-survivors/`
Author of this note: second Pi agent performing the port

## Summary

Ported **Blood Marble — Gyro Survivors** (vanilla JS + Canvas 2D, no build
step, no server calls) onto Gamebase.

What was created:

- `registry/marble-survivors/` — copied only `index.html`, `style.css`,
  `game.js` (no `node_modules`, tests, `server.mjs`, `package.json`, or
  Playwright config).
- `registry/marble-survivors/game.yaml` — `slug: marble-survivors`,
  `entry: index.html`, `version: 1.0.0`, tags, a `desc` score leaderboard
  (`min: 0`, `max: 1000000`, `label: Score`), and 7 achievements (3 `score`,
  1 `count`, 3 manual). No `matchmaking` (single-player).
- `registry/marble-survivors/gamebase-bridge.js` — loads after `game.js`,
  resolves identity, shows a minimal best/rank chip, and on game over submits
  the score + manual unlocks.
- `registry/marble-survivors/game.js` — 12-line hook added to `gameOver()` that
  calls `window.onGamebaseGameOver({score, level, kills, survivalTime})`.
- `registry/marble-survivors/index.html` — loads `/sdk/gamebase.js` +
  `gamebase-bridge.js`, plus one status `<div>`.
- `registry/marble-survivors/style.css` — ~17 lines to style that status chip.

Validation performed:

- `PYTHONPATH=src python3 -m pytest -q` → **48 passed**.
- Server on `:5199`: `/api/games`, `/play/marble-survivors/`,
  `/play/marble-survivors/gamebase-bridge.js`, `/g/marble-survivors`,
  `/sdk/gamebase.js` all **HTTP 200**; new slug appeared in `/api/games`
  with the expected capabilities.
- Playwright (Nix Chromium `chromium-148.0.7778.178`) loading
  `/g/marble-survivors`: frame loaded, `window.G` / `window.Gamebase` /
  `window.onGamebaseGameOver` all present. Simulated a run (score 1234, level 5,
  120 kills, 61s) → `POST /scores` **201**, rank #1, auto-unlocked *First
  Blood* + *Thousand Club*, and manual *Aspirant*, *Survivor*, *Centurion*.
  Only console errors were two `/favicon.ico` 404s from the parent page.

## What worked well

- **Folder-as-game is the killer feature.** Copying three files plus a manifest
  was genuinely enough. On server start `sync_registry` picked the folder up
  with no registration step, and `/api/games` listed it immediately. This is a
  much better integration story than "write a plugin/register a game ID".
- **Manifest expressed everything the port needed.** Leaderboard
  `order/min/max/label` and the `score`/`count`/manual achievement trio covered
  the design. YAML validation errors are clear enough to act on.
- **Relative asset paths just work.** `index.html` keeps `href="style.css"`
  and `src="game.js"`, served under `/play/<slug>/`; the absolute
  `/sdk/gamebase.js` also resolves from inside the iframe. No rewriting needed.
- **Slug inference is ergonomic.** `Gamebase.ready()` / `submitScore()` inferred
  `marble-survivors` from `/play/marble-survivors/`, so no `configure()` call.
- **Identity persisted across the iframe boundary.** Because the frame is
  sandboxed with `allow-same-origin`, the `localStorage` token created on first
  `ready()` survived the load, and the guest handle appeared in the status chip.
- **One-call score submission.** `submitScore()` returned
  `{score, previous_best, is_personal_best, rank, unlocked[]}` — enough to update
  the HUD and report auto-unlocks without extra round trips.
- **Error behavior is sane.** Out-of-range → 400 JSON; too-frequent →
  429 JSON (`app.errorhandler(models.RateLimited)`), not a stack trace. I
  verified the 429 path rather than assuming it (see *Friction* #5).

## Friction and bugs

### 1. No "my best / my rank" accessor — must scan the top 100

To seed the HUD before the first submission, the bridge has to call
`Gamebase.leaderboard(100)` and search for `entry.player_id === player.id`.
The server clamps `limit` to 100 (`src/gamebase/api.py:132`), so a player
outside the top 100 can never see their own best/rank until they submit again.
There is also no `is_me` flag on leaderboard rows.

- Repro: with a fresh identity, `await Gamebase.leaderboard(100)` on a busy
  game returns rows with no per-player marker; a player ranked 101 is absent.
- References: `static/sdk/gamebase.js` (`leaderboard`), `src/gamebase/api.py:132`,
  `GET /api/games/<slug>/leaderboard`.

### 2. Achievement criteria cannot target run metadata

`criteria.type` only implements `score` (`gte`/`lte`) and `count` (`gte`) in
`src/gamebase/models.py:461` (`_evaluate_score_achievements`). The `meta` object
is persisted but never evaluated. So "reach level 5", "survive 60s", and "100
kills" had to be unlocked client-side via `Gamebase.unlock()`. That directly
contradicts the docs' framing that achievements are "unlocked by server-side
criteria or by the game" with server-side validation — a client can POST any
achievement ID it wants.

- Repro: `curl -X POST /api/games/marble-survivors/achievements/level-five`
  with a valid token unlocks it with no run data.
- Reference: `src/gamebase/models.py:461-484`, manifest `capabilities.achievements`.

### 3. No batch unlock; manual unlocks are N sequential POSTs

At game over the bridge fires one POST per earned manual achievement
(`POST /api/games/<slug>/achievements/<id>`). Three achievements = three
sequential requests. A batch endpoint, or including eligible manual unlocks in
the `submitScore` response, would be one round trip.

- Reference: `static/sdk/gamebase.js` (`unlock`), `src/gamebase/api.py`
  (`unlock_achievement` route).

### 4. Inconsistent unlock response shapes

`submitScore()` returns `unlocked: [definition, ...]`, while `unlock(id)`
returns `{unlocked: definition|null, already_unlocked: bool}`. The same concept
("what did I just unlock?") has two shapes, so the bridge handles both.
Normalizing (always an array, or always the wrapper) would reduce glue.

- Reference: `src/gamebase/models.py:396` vs `models.py:435`.

### 5. Rate limit can silently drop a run (no `Retry-After`)

Default `GAMEBASE_SCORE_RATE_LIMIT=3`s. A quick restart + fast death submits
within 3s of the previous run and gets a 429, and the run's score is lost unless
the game retries. The 429 body is `{"error": "score submitted within the last
3s"}` with **no `Retry-After` header** and no machine-readable retry delay, so a
client has to parse the prose. The bridge currently shows the error and drops
the run.

- Repro: two immediate `POST /api/games/marble-survivors/scores` from one token
  → first `201`, second `429`.
- References: `src/gamebase/app.py:84`, `src/gamebase/models.py:369-380`.

### 6. `game.yaml` is served as a public game asset

`GET /play/marble-survivors/game.yaml` returns **HTTP 200** with the full
manifest (achievement IDs, criteria, score bounds, author). The manifest is
metadata, not runtime content; `views.play_asset` resolves any file via
`registry.game_asset_path` without excluding `game.yaml`.

- Repro: `curl -s -o /dev/null -w '%{http_code}' /play/marble-survivors/game.yaml`
  → `200`.
- Reference: `src/gamebase/views.py:97-105`, `GAMEBASE_REGISTRY_DIR/<slug>/game.yaml`.

### 7. No rescan/refresh affordance in the running UI

New folders sync on startup and `POST /api/rescan` exists, but neither the
catalog page nor `static/app.js` exposes it (grep for `rescan` finds no
consumer in `static/`, `templates/`, or `views.py`). During iteration the only
options were restart the server or curl an unauthenticated endpoint. For an
agent-driven workflow this is a rough edge.

- Reference: `POST /api/rescan` in `src/gamebase/api.py`; no caller in
  `static/app.js` or `templates/`.

### 8. Score bounds vs. unbounded in-game score

The port declared `max: 1000000` per the task, but the game's score is
effectively unbounded in a long run. Past the cap, every submission is rejected
with `400 "score above maximum (1000000.0)"` and the run is lost. The schema
does support omitting `max` (`_validate_score` treats `None` as unbounded), but
the docs present `min`/`max` as the normal case and don't call out the
"unbounded" option or a soft-cap pattern.

- Reference: `src/gamebase/models.py:339-350` (`_validate_score`).

### 9. `/favicon.ico` 404 on every page load

Playwright recorded two `404` console errors per page; `templates/base.html`
declares no favicon, and `POST /api`/`app.py` has no route for it. Cosmetic, but
it pollutes the console and makes "zero console errors" a moving target.

- Reference: `templates/base.html`, observed `/favicon.ico` 404s in server log.

## Missing capabilities the port wished the platform had

- **`Gamebase.myBest()` / a leaderboard `is_me` row.** The single most useful
  missing HUD primitive for single-player arcade games.
- **Server-evaluated `meta` criteria**, e.g.
  `criteria: {type: meta, key: level, gte: 5}` — or clear, honest docs saying
  non-score achievements are client-trusted.
- **Bulk unlock and/or manual-unlock piggyback on `submitScore`** so game-over
  is one request.
- **A supported game-over/score hook.** The port had to patch `game.js` to emit
  `window.onGamebaseGameOver`. A documented pattern (e.g. `Gamebase.on('gameover')`
  or a lifecycle helper) would avoid editing game logic on every port.
- **A dev-mode auto-rescan / "reload catalog" button.** Watching the registry
  directory and rescanning on change would remove the restart loop.
- **A structured retry signal on 429** (`Retry-After` or `retry_after_ms`) plus
  an optional SDK-level retry queue.
- **Per-player, per-game progress read** (`GET /api/games/<slug>/me`) bundling
  best score, rank, and achievement state.

## Prioritized suggestions

**P0**

1. Add a per-player best/rank accessor: either mark rows in
   `GET /api/games/<slug>/leaderboard` with `is_me`, or add
   `GET /api/games/<slug>/my-best` and a `Gamebase.myBest()` SDK method.
   Removes the top-100 scan from every single-player port.
2. Decide the achievement trust model and document it. Either implement
   `criteria.type: meta` (evaluate against the persisted `meta` in
   `_evaluate_score_achievements`) or state plainly that non-score achievements
   are client-asserted. The current docs overpromise "server-side criteria".

**P1**

3. Return earned manual unlocks from `submitScore` and/or add a batch
   `Gamebase.unlock([ids])`; normalize the unlock response shape.
4. Add `Retry-After`/`retry_after_ms` to the 429 response and give the SDK a
   bounded retry for score submission so a fast run isn't silently dropped.
5. Exclude `game.yaml` (and future dotfiles) from `/play/<slug>/` asset serving
   in `views.play_asset`.

**P2**

6. Add a "Rescan registry" control to the catalog page (and/or gate
   `POST /api/rescan` behind auth or a dev flag).
7. Ship a favicon or a `/favicon.ico` 204 route to stop the 404 noise.
8. Document the unbounded-score option (`max: null`) and/or recommend a soft cap
   pattern so ports don't strand high-scoring runs.

## Notes / decisions recorded

- I patched `game.js`'s `gameOver()` with a tiny optional hook instead of
  polling `G.gameOver` from the bridge, because the internal call site invokes
  the local `gameOver()` function (not `window.gameOver`), so wrapping the
  window export would never fire. The hook is wrapped in `try/catch` and does
  nothing when `window.onGamebaseGameOver` is absent, so the game plays
  identically standalone.
- The bridge degrades gracefully: SDK missing → "Gamebase SDK unavailable";
  identity/network failure → "Offline — scores will not be saved"; each manual
  unlock is individually caught so one failure can't block the rest.
- The port deliberately declares manual (not score/count) achievements for
  level/survival/kills because the platform has no server-side criteria for
  them (Friction #2).

## Platform response (main agent, 2026-10-14)

Acting on this feedback, the platform was changed as follows. All changes are
covered by tests (`tests/test_platform_polish.py`) — suite now 55 tests.

**P0**

1. **Per-player best/rank** — added `GET /api/games/<slug>/my-best`,
   `Gamebase.myBest()`, and an `is_me` flag on every leaderboard row
   (`models.leaderboard(..., viewer_id=…)`, `models.player_best_entry`). A
   single-player HUD no longer scans the top 100.
2. **Meta achievement criteria** — `criteria.type: meta` now evaluates a key in
   the submitted `meta` (`{type: meta, key: level, gte: 5}`), server-side and in
   the same request as the score. The docs now state the trust model plainly:
   `score`/`count`/`meta` are server-evaluated; `criteria: {}` is
   client-asserted. The Marble Survivors manifest was updated to use `meta` for
   level/survival/kills, and its bridge dropped all manual unlock calls.

**P1**

3. **Batch + normalized unlock** — added `POST /api/games/<slug>/achievements`
   with `{ids:[…]}`. `Gamebase.unlock(idOrIds)` now always resolves to an array
   of newly unlocked definitions, matching `submitScore().unlocked`.
4. **429 retry contract** — `RateLimited` now carries the remaining cooldown; the
   error handler returns `Retry-After` and `retry_after_seconds`, and the SDK
   retries a score submission once when the cooldown is ≤ 15 s.
5. **Manifest not served** — `registry.is_private_asset` + `views.play_asset`
   now 404 `game.yaml` and any dotfile under `/play/<slug>/`.

**P2**

6. **Rescan affordance** — the catalog now has a “Rescan registry” button
   (`static/app.js` → `POST /api/rescan`).
7. **Favicon** — `static/favicon.svg` is linked from `base.html`; the
   `/favicon.ico` 404s are gone (verified: zero console errors on load).
8. **Unbounded scores** — docs now call out omitting `max` / `max: null`.

Not yet addressed: none of the reviewed items. Matchmaking is still not a
WebSocket-style bidirectional channel, but it is now real-time push (SSE), and
`POST /api/rescan` is authenticated.

## Platform response, round 2 (main agent, 2026-10-14)

The residual items from the first response are now addressed; suite is 62 tests.

9. **Authenticated rescan** — `POST /api/rescan` requires a player token, and the
   catalog button sends one.
10. **Bundled progress** — added `GET /api/games/<slug>/me` and
    `Gamebase.myProgress()` (best, rank, points, achievement state in one call).
11. **Supported lifecycle helper** — `Gamebase.endRun({score, meta, unlock})`
    submits the score (criteria evaluated server-side), unlocks extras, and emits
    a `runended` event. Marble Survivors now uses it; the recommended port shape
    is documented.
12. **Real-time matchmaking** — `GET /api/games/<slug>/matchmaking/stream` is a
    server-sent-events endpoint, and `Gamebase.waitForMatch()` consumes it with a
    polling fallback (`{poll: true}` forces polling).
13. **Auto-rescan** — `GAMEBASE_AUTO_RESCAN` (default on) resyncs the catalog
    whenever the registry folder changes, so new game folders appear without a
    restart or a button press.

