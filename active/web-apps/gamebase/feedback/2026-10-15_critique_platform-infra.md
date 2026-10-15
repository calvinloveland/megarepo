# Gamebase platform / API / agent-workflow critique

Date: 2026-10-15
Auditor lens: platform + REST API + agent publishing workflow + adversarial review
Instance: `http://127.0.0.1:5199` (container `gamebase-critique`, registry
bind-mounted at `/tmp/gamebase-critique-registry`, DB at
`/tmp/gamebase-critique-data/gamebase.sqlite3`).
Method: black-box HTTP via stdlib `urllib`, the vendored `gamebase.cli`, and a
headless Chromium (Playwright) for the same-origin test. Seeded activity first
(`scripts/seed-random.sh 12 6`). Every finding below was reproduced against the
live instance; commands are copy-pasteable.

---

## 1. Summary

The publishing contract is small and mostly honest, and the happy path works
first try: I built a game straight from `/agent.md`, pushed it with
`gamebase.cli push`, and it appeared in the catalog and served at
`/play/<slug>/` with no surprises. Input validation for scores, ratings,
comments, save-state, and path traversal on `/play` is genuinely solid, and the
`/agent.md` file is byte-identical to the in-repo `AGENT_GUIDE.md`.

The problems are concentrated in two places: (a) **trust boundaries are
missing**, so any anonymous guest can overwrite any game, and a game iframe can
read every player's bearer token; and (b) **unvalidated manifest/`meta` input
reaches the DB/float parser and produces raw HTML 500s or partially-committed
writes**. There is also an easy availability DoS via long-lived SSE streams on a
single 8-thread gunicorn worker.

I published 12 probe games and remixes, then removed every folder and its DB
rows; the catalog is back to the 16 seeded games.

## 2. What works well

- `/agent.md` → `gamebase.cli push` is a real one-command success. The starter
  manifest/HTML from the guide pushed as `agt-test-game` on the first attempt.
- `gamebase.cli pull` and `gamebase.cli new` round-trip correctly
  (`Pulled audit-caps (1 files)`; scaffold produced `game.yaml`, `index.html`,
  `game.js`, `style.css`).
- Path traversal on `/play` is properly blocked for every encoding I tried
  (`..`, `%2e%2e`, `..%2f`, `....//`, absolute `//etc/passwd`, `game.yaml`,
  dotfiles) — all 404 except Flask's harmless 308 slash-merge.
- Score validation is thorough: non-number/bool/null → 400, NaN/Infinity → 400,
  `min`/`max` respected, unknown slug → 404, no auth → 401.
- Rate limits work and are standards-correct: `429` with a `Retry-After` header
  and `retry_after_seconds` in the JSON body (scores 3s, comments 15s).
- Optimistic concurrency on save state works: stale `revision` → `409` with
  `current_revision`; the 8 MiB limit returns 413.
- Comments are HTML-escaped in server render and DOM-built with `textContent`
  in `static/app.js`; an injected `<script>alert(1)</script>` rendered as
  `&lt;script&gt;...`. Comment delete is ownership-checked (other token → 404).
- Remix lineage, version listing, and the `POST /api/games/<slug>/files` pull
  contract are coherent and easy to consume.
- Matchmaking pairing, `reportResult` permission checks (non-member → 403),
  and SSE status/done events behave as documented.

## 3. Issues

### P0-1 — Any guest can silently overwrite any published game (no ownership/authorization)

**Saw:** `POST /api/games` upserts by `slug` with no ownership check. A second,
unrelated identity overwrote my game's title, author, files, and version, and
the change was immediately visible in the catalog and in `/api/games/<slug>`.
`/api/games/<slug>/publish`, `/remix`, and `/rescan` are likewise callable by
any authenticated identity.

**Repro**
```bash
A=$(curl -s -X POST localhost:5199/api/identity -H 'Content-Type: application/json' -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
B=$(curl -s -X POST localhost:5199/api/identity -H 'Content-Type: application/json' -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
# A owns it; B hijacks it:
curl -s -X POST localhost:5199/api/games -H "Authorization: Bearer $A" -H 'Content-Type: application/json' \
  -d '{"manifest":{"slug":"target-game","title":"Mine","entry":"index.html"},"files":{"index.html":"<b>a</b>"}}'
curl -s -X POST localhost:5199/api/games -H "Authorization: Bearer $B" -H 'Content-Type: application/json' \
  -d '{"manifest":{"slug":"target-game","title":"HIJACKED BY OTHER PLAYER","version":"9.9.9"},"files":{"index.html":"<b>pwn</b>"}}'
# -> 200, author/title/version replaced; no error.
```
Also `POST /api/games/<slug>/publish` with a foreign token returned 200 and
recorded a version.

**Why it matters:** game code runs same-origin (see P0-2). Anyone can implant or
replace arbitrary JS in any game and harvest credentials, deface the arcade, or
poison a remix chain. Author attribution is decorative.

### P0-2 — Same-origin game iframe can read the platform bearer token (account takeover)

**Saw:** `templates/game.html` uses
`sandbox="allow-scripts allow-same-origin allow-forms"`. `allow-scripts` +
`allow-same-origin` for same-origin content defeats the sandbox; the game can
reach `window.parent` and the shared `localStorage`. The SDK stores the bearer
token at `localStorage['gamebase.token']` (`static/sdk/gamebase.js`,
`static/app.js`). A headless-Chromium test loading `/g/snake` with a victim
token seeded confirmed the iframe at `/play/snake/` reads it:

```
frames: ['.../g/snake', '.../play/snake/']
iframe read own localStorage token:   -6DqK-o2J-  len 32
iframe read parent localStorage token: -6DqK-o2J-  len 32
iframe read parent DOM game slug:      snake
```

**Repro**
```bash
# 1) mint victim token
TOK=$(curl -s -X POST localhost:5199/api/identity -H 'Content-Type: application/json' -d '{}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
# 2) in a browser: localStorage.setItem('gamebase.token', TOK); open /g/snake
# 3) from devtools/console *inside the game iframe*:
#    localStorage.getItem('gamebase.token')            // -> TOK
#    window.parent.document.title                       // -> "Snake — Gamebase"
#    fetch('/api/me',{headers:{Authorization:'Bearer '+localStorage.getItem('gamebase.token')}})
```
(P0-1 makes delivery trivial: just publish/hijack a game.)

**Why it matters:** every player's session token is stealable by any game
author, and the token is a permanent, non-rotating credential (see P2-3), so the
attacker keeps access and can read/write scores, state, comments, and the
recovery code for every victim.

### P1-1 — `recovery_secret` (account credential) is leaked in every `player` object

**Saw:** `models.create_player` returns `get_player()` (a `SELECT *` row), and
`api.py` forwards it verbatim. The raw recovery secret — the thing the
recovery code is derived from — is returned by `POST /api/identity`,
`POST /api/identity/recover`, and `GET /api/me`.

```
POST /api/identity  -> {"player":{"...","recovery_secret":"3601404b5a95"}, "recovery_code":"3601-404B-5A95","token":...}
GET  /api/me        -> {"player":{"...","recovery_secret":"27de19446dab"},"points":0,...}
```

**Repro**
```bash
curl -s -X POST localhost:5199/api/identity -H 'Content-Type: application/json' -d '{}' | tee /tmp/id.json
curl -s localhost:5199/api/me -H "Authorization: Bearer $(python3 -c 'import json;print(json.load(open("/tmp/id.json"))["token"])')"
```
**Why it matters:** the secret is a portable password (`normalize_recovery_code`
strips separators/case, so the secret itself is a valid recovery code). Any
proxy log, APM trace, browser extension, or screenshot of a response leaks the
account permanently, independent of the bearer token.

### P1-2 — Unvalidated `meta` on scores → HTTP 500 and partially-committed write

**Saw:** `submit_score` never validates that `meta` is a mapping. A string/list
`meta` is accepted and stored, and if the game has a `distinct` achievement the
next evaluation does `record[key]` on a string and raises.

**Repro** (game `audit-caps` declared a `distinct` achievement on key `level`)
```bash
curl -s -X POST localhost:5199/api/games/audit-caps/scores \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOK" \
  -d '{"score":21,"meta":"level"}'
# -> 500 <!doctype html>... Internal Server Error
```
The insert happens *before* achievement evaluation, so the score is committed
even though the client sees a 500 (the same is true for an unknown id in
`unlock`, which returns 404 after the score is saved). Meta is also unbounded:
a 20 MB `meta` blob was accepted with `201`.

**Why it matters:** a malformed client payload turns a leaderboard write into an
opaque HTML 500 while the write actually landed — retrying double-inserts and
the client can't tell. Unbounded `meta` is a cheap storage-amplification vector.

### P1-3 — Unvalidated manifest numbers cause HTML 500s at publish time and scoring time

**Saw:** `registry._parse_achievements` does `int(entry.get("points"))` and
`_parse_capabilities` does `int(matchmaking.get("players"))` with no error
mapping, and `leaderboard.min/max` are stored unvalidated.

**Repro**
```bash
# publish-time 500 (points non-numeric)
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5199/api/games -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d '{"manifest":{"slug":"manv1","title":"T","entry":"index.html","capabilities":{"achievements":[{"id":"a","points":"abc","criteria":{}}]}},"files":{"index.html":"x"}}'
# -> 500 (HTML)
# publish-time 500 (matchmaking.players non-numeric)
# ... {"capabilities":{"matchmaking":{"players":"two"}}} -> 500 (HTML)
# runtime 500 (leaderboard.max is an object); publish accepts it:
# {"capabilities":{"leaderboard":{"order":"desc","max":{"x":1}}}} -> 201
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5199/api/games/m2-max/scores \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"score":1}'
# -> 500 (HTML)
```
`leaderboard.min` as a string at least yields a JSON 400
(`could not convert string to float: 'abc'`), i.e. internal text leaks.

**Why it matters:** an agent iterating on a manifest gets an unstructured HTML
500 (the SDK/JSON clients choke parsing it) instead of a precise 400, and a typo
can make a published game permanently unscoreable.

### P1-4 — Deleting a game folder does not remove it from the catalog

**Saw:** `models.sync_registry` only INSERT/UPDATE-upserts; it never deletes
rows that no longer exist on disk. After removing the folder and calling
`POST /api/rescan`, the slug still appears in `/api/games` and
`GET /api/games/<slug>` returns 200, while `/play/<slug>/` 404s.

**Repro**
```bash
rm -rf /tmp/gamebase-critique-registry/manv9
curl -s -X POST localhost:5199/api/rescan -H "Authorization: Bearer $TOK" >/dev/null
curl -s localhost:5199/api/games | grep -c manv9        # -> 1 (still listed)
curl -s -o /dev/null -w '%{http_code}\n' localhost:5199/api/games/manv9  # -> 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:5199/play/manv9/      # -> 404
```

**Why it matters:** the catalog advertises unplayable games; deleting/renaming a
game (a normal registry operation, and the mechanism I was told to use for
cleanup) leaves permanent phantom entries. This is also why cleanup required
direct DB edits.

### P1-5 — Long-lived SSE streams exhaust the single gunicorn worker (trivial DoS)

**Saw:** the server runs `gunicorn -w 1 --threads 8`. Each
`GET /api/games/<slug>/matchmaking/stream?timeout=120` holds a thread in a
`while ... time.sleep(0.5)` loop. With 8 queued streams, a normal page request
stalled ~4.75s waiting for a thread.

**Repro** (publish a game with `matchmaking.players: 100` so tickets stay
queued, then queue 8 identities and open 8 streams)
```bash
# after 8 streams are open, in another shell:
time curl -s -o /dev/null localhost:5199/          # -> ~4-5 s instead of ~0.05 s
```
**Why it matters:** any anonymous visitor (guest identities are free and
unlimited) can hold all worker threads for up to 120s each and take the whole
arcade offline with 8 concurrent connections.

### P2-1 — No request body size limit

`{"score":1,"meta":{"x":"<20 MB of A>"}}` to `/api/games/snake/scores` returned
`201` and persisted the blob. Set `MAX_CONTENT_LENGTH` (or cap `meta`) so a
single authenticated request can't amplify storage/CPU.

### P2-2 — Arbitrary handle values and case-confusion in identity

Only 3-char alphanumeric handles are normalized; everything else is stored
as typed. Accepted: `"A"`, `"ABCD"`, a 300-char handle,
`"<img src=x onerror=alert(1)>"`, `"ab\ncd"`, `"ÄÖÜ"`. `"QQQQ"` and `"qqqq"`
are **two distinct players** because `normalize_tag` only uppercases 3-char
tags. Only whitespace-only is rejected. This contradicts the "3-letter tags"
promise in `/agent.md` and enables impersonation (e.g. `Admin` vs `admin`) and
layout/URL weirdness.

### P2-3 — Tokens never expire and cannot be revoked

`sessions` has no expiry and there is no logout/revocation endpoint. Recovery
mints a *new* session but leaves all old tokens valid (`create_session` on
recover). A leaked token (P0-2) is valid forever.

### P2-4 — Rate limits are per-identity and identity creation is unlimited

`POST /api/identity` has no rate limit; comment/score 429s are keyed on
`player_id`. Minting fresh identities trivially bypasses both limits, enabling
comment/score spam and leaderboard flooding. Consider an IP/global bucket plus
identity quota.

### P2-5 — API method errors return HTML; malformed JSON is silently ignored

`GET /api/games/snake/scores` and `DELETE` return
`405 <!doctype html>... Method Not Allowed` (Content-Type `text/html`) even
under `/api`. Malformed JSON on `POST /api/identity` is treated as `{}` and
returns `201` with a brand-new guest, so a client with a serialization bug
silently gets a new account instead of a 400.

### P2-6 — No security headers

The app sends no `Content-Security-Policy`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, or `X-Frame-Options` on `/` or
`/g/<slug>`. A CSP that disallows inline game scripts is hard with this design,
but at minimum a CSP for the platform pages plus `X-Content-Type-Options` would
reduce blast radius.

### P2-7 — Internal `player_id` exposed in public payloads

`/api/games` `top_scores`, `/api/games/<slug>/leaderboard`, and
`/api/matches/<id>` return `player_id` alongside `handle`. It's a stable internal
identifier and an enumeration aid; the public contract only needs `handle`.

### P2-8 — Re-pushing the same `version` overwrites version history

`record_version` UPSERTs on `(slug, version)`. Pushing `1.0.0` with changelog
"A" then "B" leaves a single `1.0.0` entry showing only "B". The docs don't tell
agents to bump `version`, so normal iterative pushes erase history.

### P2-9 — Unknown `unlock` id turns a successful score into 404 (after saving)

`POST /api/games/checkers/scores` with `{"score":2,"unlock":["does-not-exist"]}`
returns `404 {"error":"unknown achievement: does-not-exist"}` even though the
score was committed. Batch unlock has the same partial-failure shape.

### P2-10 — `/agent.md` documents the SDK but not the REST contract

The guide covers the manifest and the JS SDK, and gives one publish example, but
never documents identity/recover, scores, achievements, state, matchmaking, or
error shapes. An agent that must publish over HTTP (as the guide headlines) has
to reverse-engineer the endpoints. `GET /api/games/<slug>/files` is also
undocumented and public (fine for a remix platform, but worth stating). The
"3-letter tags" line also mismatches actual behavior (P2-2).

### P2-11 — CLI ergonomics

`gamebase.cli push` mints a new guest identity every run unless
`--token`/`GAMEBASE_TOKEN` is set, so repeated pushes `changelog:"Push"` are
attributed to different random authors. `_collect_files` silently drops files
with unknown extensions (e.g. `LICENSE`, `README.md` is fine, but `LICENSE`
disappears), which is surprising for a "push the folder" command.

## 4. Prioritized suggestions

1. **Add ownership/authorization to the registry writes (P0-1).** Record
   `owner_player_id` on publish, and require the caller to match for
   `POST /api/games` updates and `/publish`; remix can stay open (new slug).
   Until then, treat the registry as untrusted and sign/attest game bundles.
2. **Stop putting the bearer token where game code can read it (P0-2).** Move
   tokens to a separate origin or issue per-game scoped capabilities, drop
   `allow-same-origin` from the sandbox (serve games from a distinct origin),
   and/or use `postMessage` from a platform-controlled bridge. At minimum,
   document this as an accepted risk with compensating controls.
3. **Fix the credential leak (P1-1):** serialize players through an explicit
   allow-list, never `SELECT *`/`dict(row)`; never return `recovery_secret`
   (rotate it if it was ever exposed).
4. **Validate inputs at the boundary (P1-2, P1-3, P2-9):** require `meta` to be
   a JSON object with a byte cap; validate `min/max/points/players/gte/lte/eq`
   as finite numbers in `manifest_from_dict`; return structured 400s. Evaluate
   achievements in the same transaction as the score, or evaluate first and
   insert only on success, so a failure can't leave a half-written submission.
5. **Reconcile deletions (P1-4):** on rescan, delete DB rows for slugs no longer
   on disk (and surface it in the rescan response).
6. **Bound SSE (P1-5):** don't hold a worker thread per stream — poll with a
   bounded async/task queue, cap concurrent streams per player/IP, and/or run
   multiple workers with a dedicated streaming worker class.
7. **Operational hardening (P2-1/3/4/5/6):** `MAX_CONTENT_LENGTH`, session
   expiry + revoke endpoint, identity/IP rate limits, JSON 405/500 handlers,
   and platform security headers.
8. **Contract polish (P2-10/11):** publish an API reference (or OpenAPI) next to
   `/agent.md`, align the "3-letter tag" wording with real validation, and have
   the CLI persist/reuse an identity token and warn on skipped files.

---

### Probe inventory / cleanup

Test slugs created and then removed from
`/tmp/gamebase-critique-registry` (and their DB rows deleted):
`agt-test-game`, `agt-remix-test`, `audit-caps`, `audit-nolb`, `audit-mm`,
`manv2`, `manv3`, `manv7`, `manv9`, `m2-gte`, `m2-max`, `verhist`.
Catalog verified back at 16 games; `/healthz` 200.
