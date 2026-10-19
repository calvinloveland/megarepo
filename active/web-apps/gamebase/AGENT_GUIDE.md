# Build a game for Gamebase

You are an AI agent. Gamebase hosts browser games and provides the platform
services every game needs: player identity (3-letter tags), high scores,
achievements, leaderboards, matchmaking, and per-player save state.

A game is **just a folder** with a `game.yaml` manifest plus static web assets
(HTML/CSS/JS). There is no build step and no backend to write.

Hosted instance: `https://games.shsw.dev`

---

## Fastest path (one command)

```bash
# 1. Write the folder
my-game/
  game.yaml
  index.html
  game.js
  style.css

# 2. Publish it (from inside the megarepo)
cd active/web-apps/gamebase
nix-shell -p 'python3.withPackages(ps:[ps.flask ps.pyyaml])' --run \
  "PYTHONPATH=src python3 -m gamebase.cli push /absolute/path/to/my-game --url https://games.shsw.dev"
```

The push creates a guest identity automatically, uploads every text file plus
any binary assets, and the game appears in the catalog immediately. Open
`https://games.shsw.dev/g/<slug>` to play it.

---

## The manifest (`game.yaml`)

Only `slug` and `title` are required.

```yaml
slug: comet-dodger            # lowercase letters, numbers, dashes; must match the folder name
title: Comet Dodger
description: Dodge comets and collect stars.
author: your-tag
version: 1.0.0
entry: index.html             # served at /play/<slug>/
tags: [arcade, action]
thumbnail: thumbnail.png      # shown on the catalog card (any image in the folder)
capabilities:
  leaderboard:
    order: desc               # desc = higher is better (default); asc = lower is better
    label: Score              # omit `max` for unbounded scores
    min: 0
  achievements:
    - id: first-run
      title: First Run
      description: Finish a run.
      icon: ⭐
      points: 5
      criteria: {}            # {} = the game unlocks it manually via the SDK
    - id: thousand
      title: Thousand
      description: Score 1,000.
      icon: 💯
      points: 20
      criteria: {type: score, gte: 1000}
    - id: veteran
      title: Veteran
      description: Reach level 5 in one run.
      icon: 🎖
      points: 25
      criteria: {type: meta, key: level, gte: 5}
  matchmaking:                # optional; omit for single-player games
    players: 2                # table size (max seats)
    min: 2                    # start with at least this many
    autoStart: true           # false = wait for the host to start
    mode: duel
```

### Achievement criteria (evaluated server-side)

| `criteria` | Unlocks when |
| --- | --- |
| `{type: score, gte: N}` / `lte: N` | the submitted score meets the bound |
| `{type: meta, key: K, gte/lte/eq: V}` | `meta[K]` in the submission meets the bound |
| `{type: count, gte: N}` | the player has N score submissions |
| `{type: distinct, key: K, gte: N}` | the player has N distinct `meta[K]` values |
| `{type: all, all: [c1, c2, …]}` | every nested condition holds (e.g. `result=win` AND `moves≤14`) |
| `{}` | never automatically; call `Gamebase.unlock(id)` |

Prefer `meta`/`distinct` over `count` for idle/continuous games.

---

## Using the SDK

Serve one script inside your game (it is same-origin, so relative `/sdk/...`
works):

```html
<script src="/sdk/gamebase.js"></script>
<script>
  const player = await Gamebase.ready();          // 3-letter tag identity
  const best = await Gamebase.myBest();           // {best, rank} or null
  const progress = await Gamebase.myProgress();   // best, rank, points, achievements

  // At game over (arcade):
  await Gamebase.endRun({ score: 1200, meta: { level: 3 }, unlock: ["first-run"] });

  // Continuous games (tycoon/idle):
  await Gamebase.checkpoint({ score: 40, meta: { year: 1946 } });
  await Gamebase.progress({ year: 1947 });         // milestone, no score

  // Save state between sessions:
  const saved = await Gamebase.loadState();
  await Gamebase.saveState({ level: 3 }, { revision: saved ? saved.revision : 0 });
</script>
```

Key methods: `ready`, `player`, `leaderboard(limit)`, `myBest()`,
`myProgress()`, `submitScore(score, meta, {unlock})`, `endRun`, `checkpoint`,
`progress`, `unlock(idOrIds)`, `achievements()`, `saveState`, `loadState`,
`findMatch`, `waitForMatch`, `match(matchId)`, `updateMatch(matchId, state, revision)`,
`reportResult`, `on(event, cb)`.

### Online turn-based games

`findMatch()` + `waitForMatch()` pair you with an opponent (`match.players[0]` is
the first player to move). Relay the shared game state with
`updateMatch(matchId, state, revision)` and poll `match(matchId)` (every ~1.5s)
to receive the opponent's move; the `revision` you pass guards against
simultaneous writes (a stale revision returns 409). Call
`reportResult(matchId, {result})` when the game ends. A complete example is
`registry/tic-tac-toe/game.js` (chess, checkers, reversi, connect-four, and
stratego follow the same pattern).

### Real-time games (action / FPS)

For games that need more than a turn every second, open a WebSocket room bound
to the match:

```js
await Gamebase.findMatch();
const match = await Gamebase.waitForMatch({ timeout: 120000 });
const channel = await Gamebase.joinRealtime(match.id);
channel.on("open", () => {});
channel.on("roster", (playerIds) => {});   // who is connected
channel.on("message", (data) => {});       // data.from = sender player id
channel.send({ t: "state", x, y, angle, hp });
```

Messages you `send` are relayed to the other room members with `from` added; the
server does not simulate. Behind the scenes the host page mints a short-lived,
member-scoped token and the game connects to `wss://<host>/api/rt`; this works
inside the strict sandbox (no cookies needed). Keep messages small and JSON, and
send your own state at ~10–20 Hz. See `registry/arena-fps/game.js` for a full
first-person example, and `waitForMatch`/`match` for the turn-based relay.

For lower latency and **zero relay load**, `Gamebase.connectPeers(matchId)`
returns the same `send` / `on("open"|"roster"|"message"|"close")` API but
connects peers **directly with WebRTC data channels**, falling back to the relay
automatically if a direct connection cannot be made. `match.players[0]` is the
host (`Gamebase.hostId(matchId)` / `channel.isHost`), so the host can run the
authoritative simulation while peers only send input — no server compute per
game, and nothing runs when nobody is connected.

Lobby tables (more than two players) declare `matchmaking: {players: 6, min: 2,
autoStart: false}`: everyone queues with `findMatch()` (autoStart false means no
match forms yet), the host seats them with `Gamebase.startMatch()`, and then all
call `connectPeers(matchId)` — a star with the host at the centre.

Peer messaging and failover:
- `channel.send(data)` broadcasts to every peer; `channel.send(data, playerId)`
  targets one peer (use this for private state such as hole cards).
- `channel.isHost` / `channel.hostId` update live, and `channel.on("hostchange",
  ({hostId, previousHostId, isHost}) => …)` fires when the host leaves. Election is
  deterministic (the earliest seated player still present), so every client agrees.
- To make a takeover seamless, the current host should broadcast a **public
  checkpoint** after each change; the new host resumes from it and re-syncs. See
  `registry/holdem/game.js` for a full table that survives the host leaving.

The platform handles community features for you: players rate games 1–5 stars,
comment, and every launch is counted for the “most played” ranking. The SDK
exposes `rate`/`rating`, `comments`/`comment`, and `play` if you want to surface
them in-game.

The game page reflects progress **live**: when your game submits a score,
unlocks an achievement, or records a play, the page's leaderboard, achievements,
rating, and comment list update without a reload. You do not need to do anything
for this — the platform pushes the changes.

Events: `ready`, `runended`, `checkpoint`, `unlocked`.

---

## Platform service: on-device LLM (`GamebaseAI`)

Gamebase ships an optional, shared LLM service that runs **in the browser** —
no per-game backend, no API key, nothing sent to a server. It wraps
[Transformers.js](https://huggingface.co/docs/transformers.js) running a
quantized chat model on WebAssembly and is exposed as `GamebaseAI`.

```html
<script src="/sdk/gamebase.js"></script>
<script src="/static/services/ai.js"></script>
<script>
  await GamebaseAI.ready({
    model: GamebaseAI.models.balanced,
    onProgress: ({ progress }) => console.log(progress),
  });

  const reply = await GamebaseAI.chat({
    system: "You are a wary homeowner.",
    messages: [{ role: "user", content: "Cold night, isn't it?" }],
    maxTokens: 80,
    onToken: (chunk) => console.log(chunk),
  });
</script>
```

- `GamebaseAI.ready({model, onProgress})` loads the model (idempotent). The
  first call downloads ~100–350 MB from the Hugging Face Hub; the browser caches
  it. `GamebaseAI.models` is `{fast, balanced, sharp}`.
- `GamebaseAI.chat({system, messages, maxTokens, temperature, onToken})` returns
  the assistant text; pass `onToken` to stream.
- `GamebaseAI.info()` / `isReady()` / `unload()` inspect or free the model.
- `Gamebase.ai({warm: true, ...})` is a lazy SDK wrapper that injects
  `/static/services/ai.js` if the game did not include it.

**Requirements and tradeoffs**

- Games using it should declare `capabilities.sandbox: same-origin` so the Cache
  API can store the model. A strict (opaque-origin) sandbox can still run the
  model, but it re-downloads every session.
- Inference runs on the CPU (~a few tokens/second on desktop). Keep replies
  short (≤80 tokens) and stream them.
- Use the LLM for flavour, not for refereeing. Score rules deterministically so
  a small model — or a player prompt-injecting it — cannot hand out a win.
  `registry/invite-me-in/game.js` is the reference.
- The runtime is imported from a pinned CDN
  (`@huggingface/transformers@4.3.1`). Self-hosters can override it with
  `window.GAMEBASE_AI_RUNTIME = "/static/services/vendor/transformers.web.js"`
  before loading the service.
- This is a **shared platform service**, not a per-game capability: do not add a
  `service`/`backend` key to `capabilities` (the hosting policy rejects it).

---

## Publishing over HTTP (no repo access needed)

```bash
BASE=https://games.shsw.dev
TOKEN=$(curl -s -X POST "$BASE/api/identity" \
  -H 'Content-Type: application/json' -d '{"handle":"AGT"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s -X POST "$BASE/api/games" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "manifest": {"slug":"my-game","title":"My Game","version":"1.0.0","entry":"index.html"},
    "files":    {"index.html":"<!doctype html><h1>Hello</h1>", "game.js":"console.log(1)"},
    "binary":   {},
    "changelog": "Initial publish"
  }'
```

`files` holds text; `binary` holds base64-encoded assets
(`.png/.jpg/.gif/.webp/.ico/.mp3/.ogg/.wav/.woff2/.ttf/.wasm/.map`).

Text files: ≤ 512 KB each, ≤ 8 MB total. Binary: ≤ 4 MB each, ≤ 16 MB total.
The declared `entry` file is required. Paths must be relative (no `..`).

---

## Rules

- **No game may have an always-on backend.** A game is static files that run in
  the browser and use the shared Gamebase platform for identity, scores,
  achievements, and peer transport. Anything that would normally need a server —
  a dealer, an AI director, an authoritative simulation — runs on the **host
  client** (`match.players[0]`) and/or **peer-to-peer** (`Gamebase.connectPeers`),
  or as local bots. There is no per-game service, so an unplayed game costs
  nothing. `tests/test_hosting_policy.py` enforces this across the whole registry.
- Link the **shared kit** instead of re-implementing common UI and plumbing:
  ```html
  <link rel="stylesheet" href="/static/kit/gamekit.css">
  <body class="gb"><div class="gb-shell">…</div></body>
  <script src="/sdk/gamebase.js"></script>
  <script src="/static/kit/gamekit.js"></script>
  ```
  `GameKit` offers `ready({tagElement, onPlayer})`, `overlay({overlay,title,body,button})`,
  `modeCycle(button, modes, labels, getMode, setMode)`, `localStore.get/set`,
  `escapeHtml`, and online helpers `online.findMatch()`, `online.realtime(id)`,
  `online.publish(id, state, rev)`, `online.poll(id, onState)`,
  `finish(matchId, result, run)`, `playerId()`. The CSS provides `gb-shell`,
  `gb-topbar`, `gb-tag`, `gb-status`, `gb-btn`, `gb-hud`, `gb-board`, `gb-cell`,
  `gb-overlay`, `gb-card`, `gb-panel` plus theme tokens. Override freely.

- Games you create are **owned by your identity**: only you can push an update
  to the same slug. Games already on the server are managed on disk and cannot
  be overwritten through the API (an operator can use `X-Admin-Token`).
- Self-contained: `index.html` plus your JS/CSS. No build tooling at runtime.
- Absolute `/sdk/gamebase.js` and relative asset paths both work.
- Add a square-ish preview image (`thumbnail.png`, ~16:10) next to the game and
  set `thumbnail: thumbnail.png` in the manifest so the catalog shows it.
- The game runs in a **strict, opaque-origin sandbox** by default: no cookies, no
  `localStorage`, and no access to the host page. Use the SDK for everything,
  including persistence (`Gamebase.saveState`/`loadState`). The host page brokers
  API calls and only allows calls a game needs for *its own* slug. A trusted game
  that truly needs same-origin (e.g. its own `localStorage` save) can set
  `capabilities.sandbox: same-origin`, but prefer the SDK.
- The game runs in an iframe with an HTML canvas or DOM; mobile-friendly and
  keyboard-friendly is best.
- To find `my-best` outside the top 100, use `Gamebase.myBest()` — do not scan
  the leaderboard.
- Do not add third-party scripts; the sandbox blocks cross-origin network access.

---

## Starter game (copy this)

`game.yaml`

```yaml
slug: tap-orb
title: Tap Orb
description: Tap the orb. Every ten points saves your score.
author: AGT
version: 1.0.0
entry: index.html
tags: [arcade]
capabilities:
  leaderboard: {order: desc, label: Score}
  achievements:
    - id: first-point
      title: First Point
      points: 5
      criteria: {type: score, gte: 1}
```

`index.html`

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Tap Orb</title>
<style>body{background:#0a0e17;color:#e2e8f0;font-family:monospace;text-align:center;padding-top:15vh}
button{font-size:64px;width:140px;height:140px;border-radius:50%;border:0;background:#4ade80;cursor:pointer}</style>
</head><body>
<h1>Tap Orb</h1><button id="orb">◆</button><p>Score: <span id="s">0</span></p>
<script src="/sdk/gamebase.js"></script>
<script>
let n=0; const s=document.getElementById('s');
document.getElementById('orb').onclick=async()=>{ n++; s.textContent=n;
  if(n%10===0){ try{ const r=await Gamebase.submitScore(n); if(r.unlocked.length) console.log('unlocked',r.unlocked); }catch(e){} } };
Gamebase.ready();
</script>
</body></html>
```

---

## REST endpoints

All responses are JSON. Auth is an httpOnly session cookie (browser) or a
bearer token in `Authorization: Bearer <token>` (CLI/agents). Get a token from
`POST /api/identity`.

| Method | Path |
| --- | --- |
| `POST` | `/api/identity` / `/api/identity/recover` / `/api/logout` |
| `GET` | `/api/session`, `/api/me`, `/api/me/recovery` |
| `GET` | `/api/games`, `/api/games/<slug>`, `/api/games/<slug>/files` |
| `POST` | `/api/games` (push), `/api/games/<slug>/publish` |
| `GET` | `/api/games/<slug>/leaderboard`, `/api/games/<slug>/my-best`, `/api/games/<slug>/me` |
| `POST` | `/api/games/<slug>/scores`, `/progress`, `/rating`, `/comments`, `/play` |
| `GET` | `/api/games/<slug>/rating`, `/comments`, `/achievements` |
| `POST` | `/api/games/<slug>/achievements` (`{ids}`), `/achievements/<id>` |
| `POST`/`GET`/`DELETE` | `/api/games/<slug>/state` (save blob) |
| `POST`/`GET`/`DELETE` | `/api/games/<slug>/matchmaking` |
| `GET` | `/api/matches/<id>` · `POST /api/matches/<id>/result` |
| `POST` | `/api/games/<slug>/remix`, `/api/rescan` |

## Copy-paste prompt for the human

> Build me a Gamebase game called "<name>". Read
> `https://games.shsw.dev/agent.md` and follow it exactly: create the game
> folder with `game.yaml`, `index.html` and assets, wire `/sdk/gamebase.js` for
> scores/achievements, then publish it with
> `python3 -m gamebase.cli push <folder> --url https://games.shsw.dev`.
