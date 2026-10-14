# Gamebase

Gamebase is a self-hosted arcade and platform for AI-created web games. It is
the games-shaped counterpart to app hosts like lakebed.dev: instead of shipping
generic apps, you publish playable games and get a shared pile of
**platform services** — identity, high scores, achievements, matchmaking, and
remix lineage — without writing a backend per game.

Think *AddictingGames catalog* crossed with *Steam infrastructure*, where every
game is a folder that a human or an agent can generate, diff, fork, and
republish.

## Why a platform instead of N static games

Every game otherwise reimplements the same four things badly:

1. **Who is playing?** (identity, profiles)
2. **How do I rank?** (high scores / leaderboards)
3. **What have I accomplished?** (achievements)
4. **Who do I play with?** (matchmaking)

Gamebase centralizes those once. A game declares what it supports in its
manifest and calls the JavaScript SDK. The platform stores the state in SQLite
and exposes it through a REST API.

## Core concepts

| Concept | What it is |
| --- | --- |
| **Game** | A directory under `registry/<slug>/` with a `game.yaml` manifest and web assets. |
| **Manifest** | Declares the game's identity, entry point, tags, and capabilities (leaderboard, achievements, matchmaking). |
| **Registry** | The folder scanned to build the catalog. Configurable via `GAMEBASE_REGISTRY_DIR`. |
| **Player** | A platform identity. First contact creates an anonymous guest with a readable handle and a bearer token. |
| **Capability** | A platform service a game opts into (`leaderboard`, `achievements`, `matchmaking`). |
| **Remix** | A copy of a published game into a new `<slug>` that records `remix_of` for lineage. |
| **Score** | A numeric result with optional metadata; leaderboards keep each player's best. |
| **Achievement** | A named unit of progress, unlocked by server-side criteria or by the game. |
| **Ticket / Match** | A matchmaking queue entry and the resulting shared match object. |

## Architecture

```
Browser ──▶ /                catalog (server-rendered Jinja)
        ──▶ /g/<slug>        game page: iframe + leaderboard + achievements + remix
        ──▶ /play/<slug>/…   sandboxed game assets (<iframe>)
        ──▶ /sdk/gamebase.js JavaScript SDK loaded by each game
        ──▶ /api/…           JSON API (identity, scores, achievements, matchmaking, remix)

Flask app ──▶ registry.py ──▶ registry/<slug>/game.yaml + assets   (source of truth)
          └▶ models.py   ──▶ SQLite (players, games, scores, achievements, tickets, matches)
```

The **registry on disk is the source of truth** for game metadata; SQLite holds
a queryable mirror plus all player-generated state. `sync_registry` reconciles
the two on startup and on `POST /api/rescan`.

## Game manifest (`game.yaml`)

```yaml
slug: reflex-duel          # must match the directory name
title: Reflex Duel
description: A head-to-head reaction test.
author: gamebase
version: 1.0.0
entry: index.html          # served at /play/<slug>/
tags: [multiplayer, reflex]
capabilities:
  leaderboard:
    order: asc             # asc = lower is better
    min: 1
    max: 5000
    label: Reaction (ms)
  achievements:
    - id: lightning
      title: Lightning
      description: React in under 200 ms.
      icon: ⚡
      points: 25
      criteria:
        type: score
        lte: 200
  matchmaking:
    players: 2
    mode: duel
```

### Capabilities

**`leaderboard`** — enables `POST /api/games/<slug>/scores` and the game page
leaderboard.

- `order`: `desc` (default) or `asc`.
- `min` / `max`: server-side validation bounds. Omit `max` (or set `max: null`)
  for unbounded scores; set a soft cap only if the game can exceed it.
- `label`: column heading shown in the UI.

Leaderboard rows include `is_me` when the request is authenticated, so a client
can find the current player without scanning the board.

**`achievements`** — a list of achievements.

- `criteria.type: score` with `gte`/`lte` unlocks automatically when a submitted
  score satisfies the bound.
- `criteria.type: count` with `gte` unlocks after N score submissions.
- `criteria.type: meta` with `key` and `gte`/`lte`/`eq` unlocks when the same key
  in the submitted `meta` satisfies the bound, e.g.
  `criteria: {type: meta, key: level, gte: 5}`.
- `criteria: {}` (or omitted) means the game unlocks it manually via the SDK.
- `hidden: true` hides the achievement until unlocked.

**Trust model:** `score`, `count`, and `meta` achievements are evaluated on the
server from the submitted payload, so one `submitScore` call can unlock them.
Manual achievements (`criteria: {}`) are client-asserted — any authenticated
client can POST an id. Use them only for cosmetic or non-competitive markers.

**`matchmaking`** — enables the queue.

- `players`: how many players form a match.
- `mode`: a label stored with the match.

## JavaScript SDK

Games include one file:

```html
<script src="/sdk/gamebase.js"></script>
<script>
  const player = await Gamebase.ready();          // guest identity (persisted)
  await Gamebase.submitScore(1200, { level: 3 }); // server-validated, ranked
  await Gamebase.unlock("first-blood");           // idempotent
  const board = await Gamebase.leaderboard(10);
  const match = await Gamebase.findMatch();        // joins/creates a queue ticket
  const joined = await Gamebase.waitForMatch();    // real-time (SSE) until matched
  await Gamebase.endRun({ score: 1200, meta: { level: 3 } }); // score + achievements in one call
  await Gamebase.reportResult(match.id, { score: 3 });
</script>
```

The SDK infers the game slug from the URL (`/play/<slug>/`) and keeps the
identity token in `localStorage`, so a player is the same person across every
game on the platform.

| Method | Purpose |
| --- | --- |
| `ready(handle?)` | Resolve/create the player identity. |
| `player` | The cached player object. |
| `leaderboard(limit?)` | Best scores, ranked (rows include `is_me`). |
| `myBest()` | The current player's best score and rank, even below the top 100. |
| `myProgress()` | Bundled per-game progress: best, rank, points, achievement state. |
| `submitScore(score, meta?)` | Submit and rank a score; retries once on a short rate-limit. |
| `endRun({score, meta?, unlock?})` | Standard game-over handoff: score + criteria + manual unlocks; emits `runended`. |
| `achievements()` | List achievements with unlock state. |
| `unlock(idOrIds)` | Unlock one or many achievements; resolves to newly unlocked definitions. |
| `findMatch()` | Join the queue; returns a ticket (may be already matched). |
| `matchStatus()` | Current ticket. |
| `waitForMatch({interval, timeout})` | Wait for an opponent via SSE push, polling only as fallback. |
| `reportResult(matchId, result)` | Record this player's result. |
| `match(matchId)` | Read the shared match object. |
| `cancelMatch()` | Leave the queue. |
| `on(event, callback)` | Subscribe to SDK events (e.g. `ready`). |

## REST API

All mutating player endpoints accept `Authorization: Bearer <token>` (issued by
`/api/identity`) or `X-Gamebase-Token`.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/identity` | Create a player + token. Optional `{handle}`. |
| `GET` | `/api/me` | Current player, achievements, points. |
| `GET` | `/api/games` | Catalog with top scores. |
| `GET` | `/api/games/<slug>` | Game detail: versions, lineage, top scores. |
| `GET` | `/api/games/<slug>/leaderboard?limit=` | Ranked best-per-player scores (`is_me` per row). |
| `GET` | `/api/games/<slug>/my-best` | Current player's best score and rank. |
| `GET` | `/api/games/<slug>/me` | Bundled progress: best, rank, points, achievements. |
| `POST` | `/api/games/<slug>/scores` | Submit `{score, meta}`; returns rank + unlocked. |
| `GET` | `/api/games/<slug>/achievements` | Definitions + unlock state. |
| `POST` | `/api/games/<slug>/achievements/<id>` | Unlock an achievement. |
| `POST` | `/api/games/<slug>/achievements` | Batch unlock `{ids: [...]}`. |
| `POST` | `/api/games/<slug>/matchmaking` | Join queue / form a match. |
| `GET` | `/api/games/<slug>/matchmaking` | Current ticket (+ match). |
| `GET` | `/api/games/<slug>/matchmaking/stream` | SSE: push ticket/match changes (`?timeout=` seconds). |
| `DELETE` | `/api/games/<slug>/matchmaking` | Cancel a queued ticket. |
| `GET` | `/api/matches/<id>` | Read a match. |
| `POST` | `/api/matches/<id>/result` | Report `{result}`; completes when all report. |
| `POST` | `/api/games/<slug>/remix` | Copy into `{new_slug, title?}`; records lineage. |
| `POST` | `/api/games` | **Push**: create or update a game from `{manifest, files, changelog}`. |
| `GET` | `/api/games/<slug>/files` | **Pull**: manifest plus all text files. |
| `POST` | `/api/games/<slug>/publish` | Re-sync disk manifest and record `{changelog}`. |
| `POST` | `/api/rescan` | Re-scan the registry (auth required). |

## CLI

```bash
gamebase serve                  # run the platform (or: python3 -m gamebase)
gamebase list                   # list registry games
gamebase new comet-dodger --title "Comet Dodger" --author me
gamebase publish comet-dodger --changelog "Added power-ups"

gamebase push ./comet-dodger --url http://localhost:5121   # deploy a local folder
gamebase pull comet-dodger --out ./comet-dodger           # download a game's source
```

`push` and `pull` are the agent/deploy path: they talk to the REST API and
need no server filesystem access. `push` reads `game.yaml` plus every text
asset in the folder and sends them to `POST /api/games`; `pull` writes the
result of `GET /api/games/<slug>/files` back to disk. Auth uses `--token`,
`$GAMEBASE_TOKEN`, or a fresh guest identity created automatically.

### Publishing from an agent

Because `push` is self-contained, an agent can create a game by writing a
folder and running one command:

```bash
gamebase push ./my-game --url http://localhost:5121 --changelog "Initial"
```

The API accepts only text files with known web extensions (`.html`, `.js`,
`.mjs`, `.css`, `.json`, `.svg`, `.md`, `.yaml`, …), rejects path traversal and
absolute paths, caps individual files at 512 KB and uploads at 8 MB, and
requires the declared `entry` file to be present. Updating sends the full file
set (a push is a complete publish, not a patch).

## Remix and update workflow

**Remix** (fork an existing game):

1. Click **Remix** on any game card, or `POST /api/games/<slug>/remix`.
2. Gamebase copies the directory into `registry/<new-slug>/`, resets the version
   to `0.1.0`, and sets `remix_of: <original>`.
3. The new game gets its own leaderboard and achievements; lineage is shown on
   the game page and via `GET /api/games/<slug>` (`lineage`).

**Update** (publish a new version):

1. Edit the files under `registry/<slug>/` and bump `version` in `game.yaml`.
2. Run `gamebase publish <slug> --changelog "…"` (or `POST /api/games/<slug>/publish`).
3. The new version is recorded in `game_versions` and shown in the version history.

Because a game is just a folder, an agent can write one, remix one, or patch one
with ordinary file edits — no build step or deploy pipeline required. The catalog
page has a **Rescan registry** button (`POST /api/rescan`, authenticated), and
with `GAMEBASE_AUTO_RESCAN` on (the default) the catalog also resyncs when the
registry folder changes, so newly added folders appear without a restart.

> **Round-trip example:** `active/web-apps/gamebase/registry/marble-survivors/`
is a port of the megarepo's `active/games/marble-survivors`, and
`feedback/2026-10-14_marble-survivors_port.md` records the platform feedback the
port produced.

## Hosting and trust model

- Games are served same-origin under `/play/<slug>/` inside an iframe with
  `sandbox="allow-scripts allow-same-origin allow-forms"`.
- Asset paths are resolved with traversal protection (`registry.game_asset_path`),
  and the manifest (`.yaml`) plus dotfiles are never served (see
  `registry.is_private_asset`).
- Score bounds and `score`/`count`/`meta` achievement criteria are enforced
  **server-side** from the manifest. Client-submitted scores are still
  ultimately client-reported; manual achievements are client-asserted. Games
  that need stronger guarantees should validate through their own server.
- Score submission is rate-limited (`GAMEBASE_SCORE_RATE_LIMIT`, seconds). A 429
  response carries `Retry-After` and `retry_after_seconds`, and the SDK retries
  a submission once when the cooldown is short so a fast run is not lost.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `GAMEBASE_REGISTRY_DIR` | `<project>/registry` | Where games live. |
| `GAMEBASE_DB_PATH` | `<project>/instance/gamebase.sqlite3` | SQLite database. |
| `GAMEBASE_SCORE_RATE_LIMIT` | `3` | Minimum seconds between score submissions per player/game. |
| `GAMEBASE_THEME` | `default` | Set to `playful` for the brighter arcade theme in `static/themes/`. |
| `GAMEBASE_AUTO_RESCAN` | `1` | Resync the catalog when the registry folder changes. |
| `PORT` | `5120` | Server port (`5121` in the launcher registry). |

## Running and testing

```bash
cd active/web-apps/gamebase
nix-shell                       # provides Flask, PyYAML, pytest
PYTHONPATH=src PORT=5121 python3 -m gamebase
PYTHONPATH=src python3 -m pytest -q
```

Through the repo runner:

```bash
python scripts/check_all.py gamebase
```

## Included games

- **Orb Tap** — a clicker demonstrating high scores and score/count achievements.
- **Reflex Duel** — a 1v1 matchmaking reaction duel demonstrating the queue,
  match object, SSE match waiting, result reporting, and achievement unlocks.
- **Marble Survivors** — the ported `active/games/marble-survivors` roguelite,
  showing `endRun()`, `meta` achievement criteria, and `myProgress()`.

## Not yet built

- Persistent accounts (email/OAuth) beyond anonymous guest identities.
- Server-authoritative game logic / anti-cheat beyond bounds and rate limits.
- Friend lists, chat, and cross-game progression. These would build on the same
  player + match tables.
