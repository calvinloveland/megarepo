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
- `min` / `max`: server-side validation bounds; out-of-range submissions are rejected.
- `label`: column heading shown in the UI.

**`achievements`** — a list of achievements.

- `criteria.type: score` with `gte`/`lte` unlocks automatically when a submitted
  score satisfies the bound.
- `criteria.type: count` with `gte` unlocks after N score submissions.
- `criteria: {}` (or omitted) means the game unlocks it manually via the SDK.
- `hidden: true` hides the achievement until unlocked.

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
  const joined = await Gamebase.waitForMatch();    // polls until matched
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
| `leaderboard(limit?)` | Best scores, ranked. |
| `submitScore(score, meta?)` | Submit and rank a score. |
| `achievements()` | List achievements with unlock state. |
| `unlock(id)` | Unlock an achievement (idempotent). |
| `findMatch()` | Join the queue; returns a ticket (may be already matched). |
| `matchStatus()` | Current ticket. |
| `waitForMatch({interval, timeout})` | Poll until an opponent joins. |
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
| `GET` | `/api/games/<slug>/leaderboard?limit=` | Ranked best-per-player scores. |
| `POST` | `/api/games/<slug>/scores` | Submit `{score, meta}`; returns rank + unlocked. |
| `GET` | `/api/games/<slug>/achievements` | Definitions + unlock state. |
| `POST` | `/api/games/<slug>/achievements/<id>` | Unlock an achievement. |
| `POST` | `/api/games/<slug>/matchmaking` | Join queue / form a match. |
| `GET` | `/api/games/<slug>/matchmaking` | Current ticket (+ match). |
| `DELETE` | `/api/games/<slug>/matchmaking` | Cancel a queued ticket. |
| `GET` | `/api/matches/<id>` | Read a match. |
| `POST` | `/api/matches/<id>/result` | Report `{result}`; completes when all report. |
| `POST` | `/api/games/<slug>/remix` | Copy into `{new_slug, title?}`; records lineage. |
| `POST` | `/api/games/<slug>/publish` | Re-sync disk manifest and record `{changelog}`. |
| `POST` | `/api/rescan` | Re-scan the registry. |

## CLI

```bash
gamebase serve                  # run the platform (or: python3 -m gamebase)
gamebase list                   # list registry games
gamebase new comet-dodger --title "Comet Dodger" --author me
gamebase publish comet-dodger --changelog "Added power-ups"
```

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
with ordinary file edits — no build step or deploy pipeline required.

## Hosting and trust model

- Games are served same-origin under `/play/<slug>/` inside an iframe with
  `sandbox="allow-scripts allow-same-origin allow-forms"`.
- Asset paths are resolved with traversal protection (`registry.game_asset_path`).
- Score bounds and achievement criteria are enforced **server-side** from the
  manifest. Client-submitted scores are still ultimately client-reported; games
  that need stronger guarantees should report through their own server-side
  validation. Rate limiting (`GAMEBASE_SCORE_RATE_LIMIT`, seconds) blunts spam.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `GAMEBASE_REGISTRY_DIR` | `<project>/registry` | Where games live. |
| `GAMEBASE_DB_PATH` | `<project>/instance/gamebase.sqlite3` | SQLite database. |
| `GAMEBASE_SCORE_RATE_LIMIT` | `3` | Minimum seconds between score submissions per player/game. |
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
  match object, result reporting, and achievement unlocks.

## Not yet built

- Persistent accounts (email/OAuth) beyond anonymous guest identities.
- Server-authoritative game logic / anti-cheat beyond bounds and rate limits.
- Real-time transport (currently matchmaking is polling-based).
- Friend lists, chat, and cross-game progression. These would build on the same
  player + match tables.
