# Gamebase — first-time player experience critique

Date: 2026-10-15
Author: Pi audit agent (lens: **first-time player / onboarding UX**)
Live instance: http://127.0.0.1:5199 (Dockerised, 16 games)
Seed run first: `nix-shell -p python3 curl --run 'GAMEBASE_URL=http://127.0.0.1:5199 bash scripts/seed-random.sh 12 6'`
→ `games: 16  players: 12` / `== seeded 12 random players ==`. Random ratings,
comments, plays and scores were written via the public API (e.g. `GET /api/games/orb-tap/rating` → `{"average":3.31,"count":36,...}`).
Browser: Playwright + Nix Chromium. Screenshots in `/tmp/gb_ux/`.

> Scope note: this audit intentionally overlaps a little with the same-day
> `2026-10-15_critique_visual-a11y.md` and `2026-10-15_critique_platform-infra.md`
> where a defect is central to onboarding. Those overlaps are called out, and
> the new evidence here is the *newcomer flow* (what the visitor understands,
> what they can do next, and how the site reacts to mistakes).

---

## 1. Summary

Gamebase's catalog and game pages are clean, fast and pleasant, and the tag
gate has some genuinely nice mechanics (per-character slots, auto-advance,
uppercase/alphanumeric filtering, a clear collision message, a Random button,
and token persistence across reloads). Playing a game works: Orb Tap reached
`Score: 12`, `Personal best: 10`, `Unlocked: First Point`.

The first-time experience fails at the two moments that matter most:

1. **Before the product.** A brand-new visitor is dropped into a full-screen
   `#tag-gate` overlay that blocks `/`, `/create`, `/g/<slug>` and
   `/players/<handle>`, with no Escape/backdrop dismiss, **no explanation of
   what a "tag" is**, no branding on the overlay itself, and no way to skip or
   browse. The game iframe does not even load until identity exists.
2. **Immediately after the product.** The identity the player was forced to
   create is then **invisible and unmanageable**: the handle never appears in
   the site chrome, the recovery code returned by `POST /api/identity` is
   thrown away by the client, and there is no rename / log-out / recover UI.
   Worse, a stale token makes the game silently mint a *new* identity.

Secondary onboarding friction: on mobile the rating widget, leaderboard and
achievements are buried ~2,100 px down the page beneath the comment thread;
keyboard games do nothing until the player clicks the canvas (no cue); and the
player path is mixed with developer/agent controls (`Rescan registry`,
`Add a game`, `Remix` via a native `window.prompt`).

---

## 2. What works well

- **The gate's input mechanics are good.** A fresh load autofocuses slot 1
  (`document.activeElement` = "Tag character 1"). Typing `!` is dropped, `a`
  becomes `A` and advances focus; a partial submit shows `ENTER 3 CHARACTERS`.
  Entering an existing tag (`Y0N`, and lowercase `y0n`) produces
  `TAG IN USE — TRY ANOTHER` with a shake, clears the slots and refocuses
  slot 1 (`/tmp/gb_ux/02_collision.png`). `Random` creates a working identity.
- **Persistence/back behaviour is correct.** After the Random button,
  `localStorage["gamebase.token"]` is set, the gate stays hidden on reload, and
  the browser Back button returns to the catalog without re-gating.
- **The catalog is legible and looks trustworthy.** 16 cards
  (`/tmp/gb_ux/10_catalog_1280.png`) with 16:10 thumbnails, tag pills, title,
  description, a star row with numeric average + count, a play count, `PLAY` /
  `REMIX` and the achievement count. The sort bar offers `A → Z`,
  `MOST PLAYED`, `TOP RATED`, `NEWEST`, and the active sort is highlighted.
- **Game pages get the player into the game fast.** The iframe auto-loads
  (`src="/play/orb-tap/"`), the global top-10 leaderboard and achievements sit
  in a right sidebar on desktop, and the rating widget is at the top of that
  sidebar (`y=84`, above the iframe at `y=203`).
- **Community actions work.** Posting a comment returns `Posted`, the comment
  is prepended, and the player's own comment gets a `delete` button
  (`/tmp/gb_ux/31_comment.png`). Clicking a star updates the count and shows
  `· you rated N` (`/tmp/gb_ux/30_rating.png`).
- **Empty-state copy exists in the templates.** `No comments yet — be the
  first.`, `No scores yet — be the first.`, `This game has no achievements.`
  (not reachable live because the seeded instance has data for every game, but
  the copy is sensible).
- **Gameplay genuinely worked in a quick play-through**: Orb Tap incremented
  and submitted, Memory Match flipped cards and scored, Tic-Tac-Toe accepted a
  move and the AI replied, Minesweeper revealed a cell.

---

## 3. Issues

Severity: **P0** blocks the product for a newcomer; **P1** breaks a core
first-run task or badly misleads; **P2** polish / lower impact.

### P0-1 — An unexplained tag gate blocks the entire product (no skip, no browse)

**What I saw.** With `localStorage["gamebase.token"]` cleared, `GET /` renders
the full-screen `#tag-gate` (`hidden` removed by `static/app.js`) over a dimmed
catalog. Escape does **not** close it and neither does clicking the backdrop
(`gate visible after Escape: True`, `gate visible after backdrop click: True`).
The overlay contains only `ENTER YOUR TAG`, `3 CHARACTERS · A–Z / 0–9`,
`START`, `RANDOM` — no Gamebase branding inside the panel, no sentence telling
the visitor what a tag is, that it is their permanent player name, or that
creating one is required. The same gate appears on `/create`, `/g/orb-tap` and
`/players/UHD` (`/create gate: True`, `/g/orb-tap gate: True`,
`/players/UHD gate: True`), and on a deep link the game iframe has no source at
all (`iframe src: None`), because `startGames()` only runs after
`ensureIdentity()` resolves.

**Repro.**
```js
// devtools on http://127.0.0.1:5199/
localStorage.removeItem("gamebase.token");
location.reload();
// gate is visible; press Escape and click the backdrop — it stays
// then: http://127.0.0.1:5199/g/snake  ->  gate visible, iframe src = null
```
Screenshot: `/tmp/gb_ux/01_catalog_gate.png`.

**Why it matters.** This is the first screen of the product and it blocks the
primary task (playing a game) for every new visitor, including someone
following a shared deep link. A newcomer cannot even read what Gamebase is,
browse the 16 games, or read the publishing guide before being asked for a name
they don't understand and can't change. It also makes the arcade feel like an
internal login wall rather than an arcade.

*(Confirms visual-a11y P0-1; the onboarding-specific addition is the missing
purpose/branding copy and the absence of a "browse as guest" path.)*

---

### P1-1 — The identity you are forced to create is invisible, unchangeable and unrecoverable

**What I saw.** After creating a tag (or clicking `RANDOM`), the platform chrome
never shows who you are. For a fresh identity `U58`, the own handle does not
appear on `/`, `/create`, or `/g/orb-tap` (`shows own handle? False` for all
three), and `/` has **0** links to `/players/` — profiles are only reachable by
typing the URL or clicking someone else's comment handle. There is no "change
tag", "log out", "account", "settings" or "recovery" text anywhere. Meanwhile
`POST /api/identity` returns a recovery code
(`{"rediscovery_code":"2C72-18D5-22C9","token":...}`, real response in
`/tmp/i.json`) that `static/app.js` discards: `createIdentity()` only calls
`storeToken(data.token)` and returns the token. Nothing in the UI ever shows the
code, and no route lets a player use one.

**Repro.**
```bash
# The server hands out a recovery code:
curl -s -X POST http://127.0.0.1:5199/api/identity \
  -H 'Content-Type: application/json' -d '{"handle":"ABC"}'
# -> {"player":{...},"token":"...","recovery_code":"....-....-...."}
# But in the browser, after creating a tag, search every page:
#   /, /create, /g/orb-tap -> own handle not present; no rename/logout/recover UI
```

**Why it matters.** The forced identity is the player's account. A newcomer who
clicks `RANDOM` (or mistypes a tag) is stuck with it forever, has no surface to
inspect their own progress, and silently loses everything if `localStorage` is
cleared or they switch device — even though the backend already supports
recovery (`/api/identity/recover`). It undermines the platform's whole
identity/points promise.

---

### P1-2 — A stale token silently fails in the shell and silently mints a new identity in the game

**What I saw.** With a deliberately invalid token, the platform shell does
**not** re-prompt: loading `/g/orb-tap` shows no gate, but protected calls fail
with `401 (UNAUTHORIZED)` in the console and no user-visible error
(`any visible user-facing error text?: False`). Then the game iframe's SDK
recovers *differently*: `Gamebase.ready()` catches the 401, clears the token and
creates a brand-new guest identity. Measured:

```
before load /g/orb-tap: token=totally-invalid-token-xyz, /api/me -> 401
after iframe load:       token_changed=True, new handle=DJN, /api/me -> ok
```

Platform requests race against that swap, so the star click later "succeeds"
under the new identity (`3.3 / 36 ratings · you rated 3`,
`/tmp/gb_ux/50_stale_token.png` shows `Playing as 5AI`).

**Repro.**
```js
// devtools on http://127.0.0.1:5199/
localStorage.setItem("gamebase.token", "totally-invalid-token-xyz");
location.href = "/g/orb-tap";
// console shows 401s from /api/me, /api/games/orb-tap/play, /rating, /comments
// then the game shows "Playing as <brand-new-tag>" and localStorage token changed
```

**Why it matters.** A returning/newcomer with a bad token is silently given a
new account; their old scores and achievements vanish with no warning, and the
shell briefly looks broken. Identity errors must be surfaced and resolved
consistently (re-prompt / offer recovery), not one way in the shell and another
inside games.

---

### P1-3 — On mobile, rating / leaderboard / achievements are buried ~2,100 px under the comment thread

**What I saw.** At `390×844`, `.game-layout` collapses to a single column and
the DOM order is title → iframe → description → comments → **sidebar**. For
`/g/snake` the geometry was:

```
iframe y=203, comments y=714, rating y=2123, leaderboard y=2468, achievements y=2806
viewport height = 844
```

So the rating widget, leaderboard and achievements are ~2.5 screens below the
fold, after 17 comments. The rating widget — one of the few first-class
onboarding/community actions — is the *last* thing a phone player reaches.
Screenshot: `/tmp/gb_ux/70_game_mobile_fold.png` (above the fold shows only the
game, description and the top of the comment form).

**Repro.** Open `http://127.0.0.1:5199/g/snake` at 390×844 and scroll: the
comment form appears right under the game; `RATE THIS GAME` does not appear
until ~2,100 px of scrolling (eval
`document.querySelector('[data-rating-widget]').getBoundingClientRect().y`).

**Why it matters.** Most web-game traffic is mobile; the platform's community
and progress loop is effectively undiscoverable there. A newcomer never learns
they can rate or that a leaderboard exists.

---

### P1-4 — Keyboard games give no focus cue: arrow keys do nothing until you click the canvas

**What I saw.** On `/g/2048` with the page focused but the iframe not clicked,
pressing `ArrowLeft`/`ArrowUp` did **not** move tiles (board stayed `Score 0
Moves 0`) — and the page did not scroll either. After clicking
`iframe.play-frame`, `document.activeElement.tagName` was `IFRAME` and the same
keys moved tiles (`Score 4 Best 4 Moves 2`). There is no "click to play"
overlay, no visible focus ring (see visual-a11y P1-4), and no instruction above
the frame.

**Repro.** Open `http://127.0.0.1:5199/g/2048`, press Arrow keys (nothing
happens), then click once inside the frame and press again (tiles move).

**Why it matters.** 2048, Snake and similar keyboard games look broken to a
first-timer. The first interaction should be obvious and self-teaching.

---

### P2-1 — The player-facing chrome is dominated by developer / agent actions

**What I saw.**
- The hero's primary call-to-action is **`RESCAN REGISTRY`** (an internal admin
  operation) — it is the only button in the hero (`hero buttons:
  ['RESCAN REGISTRY']`).
- The global nav is `ARCADE · ADD A GAME · SDK`, and the SDK link downloads raw
  JavaScript.
- Every catalog card exposes a `REMIX` button next to `PLAY`; clicking it opens
  a native `window.prompt("New slug for the remix:")` dialog
  (`native dialog messages: ['New slug for the remix:']`), which is jarring and
  looks unfinished.
- `/create` is entirely agent instructions ("Give your agent this link").

**Repro.** Open `http://127.0.0.1:5199/`, click `REMIX` on any card and observe
the OS/browser prompt; note the hero button and nav labels.

**Why it matters.** A newcomer cannot tell whether Gamebase is an arcade or a
developer tool. The native prompt in particular breaks the polished dark-arcade
feel on the very first click.

*(Overlaps visual-a11y P2-8.)*

---

### P2-2 — No search and no tag browsing; the only discovery axis is the sort bar

**What I saw.** `input[type=search]` count is **0**, and the tag pills
(`puzzle`, `classic`, `2048`, …) are plain `<span>`, not links or filters. With
16 games this is survivable, but a newcomer who wants "a two-player board game"
has to read every card.

**Repro.** `document.querySelectorAll("input[type=search]").length === 0` on `/`;
try clicking a tag pill — nothing happens.

---

### P2-3 — After you play, the platform shows no personal best, no "you" in the leaderboard, and stale achievements

**What I saw.** Playing Orb Tap drove the in-game UI to `Score: 12`,
`Personal best: 10`, `Unlocked: First Point` (`/tmp/gb_ux/40_orb_played.png`),
but the surrounding platform page showed none of it:

```
'your best'/'your rank' text present: False
.is-me / .you rows: 0
leaderboard rows containing own handle: 0
```

The sidebar `ACHIEVEMENTS` panel still rendered `First Point` **locked** while
the game said it was unlocked; it never updates after page load. The backend
already has `GET /api/games/<slug>/my-best` and `/me` (with `is_me`, `rank`,
`unlocked`), but `views.py` builds the page leaderboard with
`models.leaderboard(..., viewer_id=None)` and `app.js` never calls `my-best`.

**Repro.** Play Orb Tap to ≥10 (unlocks First Point), then inspect the page:
no "your best" element, no highlight on your row, achievement still locked
until a manual reload.

**Why it matters.** A newcomer gets no confirmation that their run counted or
that they made progress. That is the feedback loop that turns a first visit into
a second one.

---

### P2-4 — The "Newest" sort is effectively reverse-alphabetical

**What I saw.** All 16 games share `created_at = 2026-10-15T02:40:14+00:00`
(they were synced together), so `/ ?sort=new` falls back to the
reverse-title tiebreak: `Washing Machine Tycoon, Tic-Tac-Toe, Stratego, Snake,
Simon`. It is labelled `NEWEST` but conveys no recency.

**Repro.** `GET /api/games` → every `created_at` identical; compare
`http://127.0.0.1:5199/?sort=new` to the title order.

---

### P2-5 — Comment timestamps are raw ISO-8601

**What I saw.** A freshly posted comment renders as
`XI9 2026-10-15T03:14:02+00:00 …` (`/tmp/gb_ux/31_comment.png`). It reads like
a database dump, not a social product.

**Repro.** Post any comment and look at `.comment-head .muted.small`.

*(Overlaps visual-a11y P2-4 and gameplay P2-4.)*

---

### P2-6 — Star display floors to whole stars, and an unrated game would show "0.0"

**What I saw.** The catalog macro uses `avg|round(0, 'floor')|int`, so
tic-tac-toe at `2.3` lights only **2** stars (`tic-tac-toe filled stars: 2`)
while its aria-label says 2.3/5. There are no half-stars, so 2.9 (Breakout) and
2.3 (tic-tac-toe) look identical. The rating widget exposes no selected state to
assistive tech (`aria-pressed any: 0`).

**Repro.** `http://127.0.0.1:5199/` → compare the `.stars-mini .star.on` count
against the numeric average; inspect `.star-btn` for `aria-pressed`.

*(Accessibility half overlaps visual-a11y P1-3 / P2-7.)*

---

### P2-7 — Mobile tag-gate buttons are under the 44 px tap-target guideline

**What I saw.** At 390×844 the gate fits with no overflow
(`scrollWidth === clientWidth === 390`), but `#tag-submit` is 76×38 and
`#tag-random` is 94×38 — 38 px tall, below the 44 px recommendation — and the
inputs use `inputmode="text"`. Screenshot: `/tmp/gb_ux/60_gate_mobile.png`.

**Repro.** Open `http://127.0.0.1:5199/` with a mobile emulation and measure
`document.querySelector('#tag-submit').getBoundingClientRect()`.

---

## 4. Prioritised suggestions

1. **Make the gate non-blocking and self-explanatory (fixes P0-1).** Let people
   browse and play anonymously; prompt for a tag only on the first write action
   (rate / comment / score submit). Add Gamebase branding and one sentence of
   purpose ("Pick a 3-letter player tag — it's how your scores are saved"),
   plus a `Browse without a tag` escape and Escape-to-dismiss. Load the game
   iframe regardless of identity.
2. **Give the tag a home (fixes P1-1).** Add an identity chip in the header
   (`Playing as ABC · change · recover · log out`) linking to
   `/players/<handle>`, show the recovery code once at creation with a copy
   button, and add a rename flow. The backend already supports recovery; wire
   it up.
3. **Resolve identity errors the same way everywhere (fixes P1-2).** Validate
   the stored token on page load; on 401, re-open the gate or offer recovery
   instead of failing silently. Stop the SDK from silently minting a new player
   without telling the page.
4. **Reorder the mobile game page (fixes P1-3).** Put rating, leaderboard and
   achievements directly under the game (or in sticky tabs), above the comment
   thread, at `max-width: 900px`.
5. **Teach the first interaction (fixes P1-4).** Add a "Click to play" focus
   affordance on the frame, focus/allow keyboard focus into it on load where
   safe, and keep the control hint above the frame rather than below.
6. **Separate "play" from "build" (fixes P2-1).** Move `Rescan registry`,
   `Remix`, `Add a game` and the SDK link out of the default player hero/nav
   (e.g. into an explicit "Create" area) and replace `window.prompt` with an
   inline remix form.
7. **Close the feedback loop (fixes P2-3).** Render "Your best: N (rank R)"
   from `my-best`, highlight the viewer's leaderboard row (`is_me` already
   exists), and refresh achievements live when the game reports an unlock
   (e.g. a small toast driven by SDK events).
8. **Humanise the catalog (fixes P2-2, P2-4, P2-5, P2-6).** Add a search box
   and clickable tag filters; make `NEWEST` use a real publish timestamp or
   drop it; format comment timestamps relatively; render half-stars and an
   explicit "No ratings yet" for unrated games; add `aria-pressed` to the stars.
9. **Polish mobile (fixes P2-7).** Raise the gate buttons to ≥44 px and set
   `inputmode`/`autocapitalize` for the tag slots.

### Audit artifacts left on the instance
- New guest identities created during testing (e.g. `FQ9`, `NIS`, `XI9`, `U58`,
  `5AI`, `DJN`) plus one test comment on Orb Tap
  (`/tmp/gb_ux/31_comment.png`). No platform or game code was modified and no
  commit was made.
