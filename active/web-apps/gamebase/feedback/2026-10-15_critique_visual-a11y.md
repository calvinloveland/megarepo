# Gamebase — visual design, responsiveness & accessibility critique

Date: 2026-10-15
Author: Pi audit agent (lens: visual design, responsiveness, accessibility)
Live instance: http://127.0.0.1:5199 (16 games)
Seed run: `GAMEBASE_URL=http://127.0.0.1:5199 bash scripts/seed-random.sh 12 6`

## 1. Summary

Gamebase is visually cohesive and structurally sound: a dark arcade theme with
tokenised CSS, a responsive card grid that reflows cleanly from 4 columns
(1440px) to 2 (768px) to 1 (390px), no horizontal overflow at any of the three
tested widths, and no layout shift from the aspect-ratio thumbnail boxes.
Keyboard focus rings are visible on links, buttons and star controls, text
contrast passes WCAG AA almost everywhere, and most games use real `<button>`
elements so they remain keyboard-operable.

The problems cluster in three areas:

1. **A first-run identity gate that blocks the entire product** (catalog,
   `/create`, player pages and even the game iframe itself) with no skip, and
   which is not implemented as an accessible modal.
2. **A cluster of genuine accessibility defects** around the rating widget,
   the comment form, the game iframe focus indicator, and async status
   announcements.
3. **Information hierarchy / polish** — the rating + leaderboard + achievements
   are pushed below a long comment thread (worse on mobile), 404s return raw
   JSON, timestamps are raw ISO, and thumbnails are oversized PNGs with
   `no-cache`.

Screenshots referenced below were captured with Playwright + Nix Chromium at
1440x900 (`_1440`), 768x1024 (`_768`) and 390x844 (`_390`) into
`/tmp/gb_shots/` (e.g. `catalog_1440.png`, `game_2048_390_full.png`,
`focus_iframe_1440.png`, `404.png`).

---

## 2. What works well

- **Responsive grid & no overflow.** At `/`, `/g/2048` and `/create`,
  `document.documentElement.scrollWidth === clientWidth` at 390, 768 and 1440.
  `gridTemplateColumns` is 4x276.5px at 1440 and reflows to 2/1 columns.
- **Cohesive visual language.** `--bg/--panel/--accent/--radius` variables,
  consistent 12px radii, pill tags, panel headings. Cards are uniform and the
  hover lift (`catalog_1440.png`) is tasteful.
- **Contrast.** Measured: muted `#8896ad` on body `#0a0e17` = **6.45:1**, on
  `#111827` = **5.92:1**; accent `#4ade80` on body = **11.08:1**; muted pill on
  its blended background = **4.87:1**. All pass AA for their sizes.
- **Semantic markup.** `<header>/<nav>/<main>/<aside>/<footer>` landmarks;
  interactive controls are real `<button>`s; `<iframe title="2048">`; catalog
  thumbnails are decorative (`alt=""` + `aria-hidden="true"` wrapper +
  `tabindex="-1"`) so they aren't redundant stops; tag slots carry
  `aria-label="Tag character N"`; the remix input has a `<label for="new_slug">`.
- **Visible focus rings.** `focus_sort_1440.png` and `focus_star_1440.png`
  show the UA ring clearly on the active sort link and star buttons; tag slots
  get a custom accent ring (`.tag-slot:focus`).
- **Games are mostly keyboard-capable.** Inside the iframes, Memory cards are
  `<button role="gridcell" aria-label>`, Minesweeper cells are `<button>` (and
  its flag toggle correctly uses `aria-pressed`), Connect Four columns are
  `<button aria-label="column c, row r">`, Orb Tap is a single labelled
  `<button>`, and 2048's board has `role="grid" aria-label`.
- **Games fit mobile.** All 16 games had `scrollWidth === clientWidth` inside
  the iframe at 390px (no inner horizontal scroll).
- **Tag gate geometry.** Slots are 64x84, fit comfortably at 390 (`gate_390.png`)
  and autofocus the first slot.

---

## 3. Issues

Severity: **P0** blocks the product, **P1** breaks a core task or an
accessibility requirement, **P2** polish / lower-impact.

### P0-1 — First-run tag gate blocks the whole site with no way to skip

**What I saw.** With `localStorage["gamebase.token"]` cleared, loading `/`
shows the full-screen `#tag-gate` overlay (`catalog_gate_1440.png`,
`gate_390.png`, `gate_768.png`). The catalog, nav and footer are dimmed behind
it. Escape and clicking the backdrop do **not** close it
(`gate_after_escape_visible=true`, `gate_after_backdrop_visible=true`). The gate
also appears on **`/create`**, **`/g/2048`** and **`/players/AUX`**
(`gate_on/=[true,true,true,true]`). The game itself never loads first: the
iframe has no `src` until identity exists (`iframe_src_before_identity=null`),
because `app.js` only calls `startGames()` after `ensureIdentity()` resolves.

**Repro.**
```js
// devtools
localStorage.removeItem("gamebase.token"); location.reload();
```
Then observe `document.getElementById("tag-gate").hidden === false` and that
`Escape`/backdrop click leave it open. Visit `/create` fresh — same overlay.

**Why it matters.** Every new visitor is forced to create a 3-letter identity
before they can see a single game, read the publishing guide, or load gameplay.
There is no "browse as guest" path. This is the very first screen of the
product and it blocks the primary task; it also hurts first impressions and
shareability of deep links.

**Fix.** Allow anonymous browsing; prompt for a tag only when an action needs
identity (rate/comment/submit). Offer "Browse without a tag" or auto-assign a
temporary tag. Defer `recordPlay()` so the iframe loads regardless of identity.

---

### P1-1 — HTTP 404s render raw JSON with no site chrome

**What I saw.** Navigating to `http://127.0.0.1:5199/g/does-not-exist`
returns `Content-Type: application/json`, body `{"error":"not found"}`, and the
browser renders an unstyled white page with pretty-printed JSON (`404.png`).
Same for `/nope`. Root cause: `src/gamebase/app.py` `_register_error_handlers`
registers `@app.errorhandler(404)` that returns `jsonify({"error": "not found"})`
for *all* routes.

**Repro.** `curl -i http://127.0.0.1:5199/g/does-not-exist` → JSON 404; open the
URL in a browser → bare JSON page.

**Why it matters.** Any stale/bad link looks like an application crash. There is
no branding, navigation, or recovery path, and the wrong content type is
returned to browsers. Fails basic error-page UX.

**Fix.** Content-negotiate: HTML 404 template for browser navigations, JSON only
under `/api/*` (or when `Accept` prefers JSON).

---

### P1-2 — Comment textarea has no accessible name

**What I saw.** On `/g/2048`, `[data-comment-form] textarea` has `id=""`, no
`aria-label`, no `aria-labelledby`, and no associated `<label>`
(`comment_textarea_label.hasLabel=false`). Its only text is the placeholder
"Share a tip, a high score, or a bug…".

**Repro.** In devtools console on `/g/2048`:
```js
document.querySelector("[data-comment-form] textarea").labels.length // 0
```
Or run an accessibility audit (axe) — "Form elements must have labels".

**Why it matters.** Screen readers announce the field as an unlabelled "edit
text"; placeholders are not labels and disappear once text is entered. WCAG
3.3.2 / 4.1.2.

**Fix.** `<label for="comment-body">Comment</label>` + `id="comment-body"`, or
`aria-label="Your comment"`.

---

### P1-3 — Star rating exposes no selected state to assistive tech

**What I saw.** On `/g/2048`, each `.star-btn` has `aria-label="N star(s)"` but
**no `aria-pressed`/`aria-checked`**, and `.rating-stars` has no
`role="radiogroup"` (`star_group_role=null`). Pressing Enter on a focused star
turns it amber (`.on`) but `aria-pressed` stays `null` (`star_after_enter`),
and the only confirmation is the `#rating-yours` text, which is not a live
region.

**Repro.** On `/g/2048`, Tab to the stars (see P1-6 for how far), press Enter,
then inspect: `document.querySelectorAll(".star-btn")[0].getAttribute("aria-pressed")` → `null`.

**Why it matters.** A screen-reader user cannot tell what they rated or that the
rating registered. Selection is conveyed by colour/visual class only. Note the
Minesweeper flag button already does this correctly with `aria-pressed`, so the
pattern exists in-repo.

**Fix.** Use a `radiogroup` with `aria-checked`, or add `aria-pressed` to each
star and update it in `paintStars()`; announce `#rating-yours` via `aria-live`.

---

### P1-4 — Game iframe has no visible keyboard focus indicator

**What I saw.** On `/g/2048`, Tab to `iframe.play-frame`: computed style is
`outline: rgb(226,232,240) none 3px` with no `box-shadow`. `focus_iframe_1440.png`
shows no ring around the game — contrast this with `focus_sort_1440.png` and
`focus_star_1440.png`, where the ring is obvious.

**Repro.** On `/g/2048` press Tab until the iframe is focused; no visible
indicator appears.

**Why it matters.** Keyboard players press Tab to enter a game (e.g. 2048 arrow
keys, Chess) and cannot tell the game has focus. WCAG 2.4.7 Focus Visible.

**Fix.** `.play-frame:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.

---

### P1-5 — Tag gate is not an accessible modal (focus escapes; no dialog roles; errors silent)

**What I saw.** With the gate open, the Tab order runs
`.tag-slot ×3 → Start → Random → BODY → brand → nav links`
(`gate_390_tab_escape` and `gate_768_tab_escape` both show `BODY[OUT]` then
`brand[OUT]`). The background is not `inert`/`aria-hidden`. `#tag-gate` has no
`role="dialog"`/`aria-modal`, and `#tag-hint` has no `aria-live`
(`gate_390_hint_live=null`), so the "Tag in use — try another" error and shake
are not announced.

**Repro.** Clear the token, open `/`, press Tab four times — focus leaves the
gate and lands on the hidden catalog nav. Enter a taken tag with a screen
reader → no error announcement.

**Why it matters.** Keyboard/SR users can interact with the obscured page and
never hear why submission failed. WCAG 2.4.3 (focus order) and 4.1.3 (status
messages).

**Fix.** `role="dialog" aria-modal="true" aria-labelledby`, trap focus while
open, set the rest of the page `inert`, and make `#tag-hint` `aria-live="polite"`.

---

### P1-6 — Rating / leaderboard / achievements are buried below the comment thread

**What I saw.** DOM order is `main` (iframe + comments) then `aside` (rating,
high scores, achievements, remix). Measured with only 16 comments, the first
star is tab stop **24** (`tab_index_of_first_star=24`); the server allows up to
50 comments, which would push it to roughly 58. At 390px the page order
(`game_2048_390_full.png`) is: game → 16 comments (~2.5 screens) → "Rate this
game" → High scores → Achievements → Remix.

**Repro.** On `/g/2048`, press Tab from the top and count until the first
`.star-btn`; or open at 390px and scroll — the rating control is below the whole
comment list.

**Why it matters.** Rating a game and reading the leaderboard are primary
secondary tasks on a game page, but they are effectively below the fold and,
for keyboard users, behind every comment. On mobile the "Rate this game"
affordance is easy to miss entirely.

**Fix.** Place a compact rating + leaderboard summary near the game title/iframe
(e.g. move the aside's rating panel above comments via CSS `order` on mobile, or
duplicate a small rating control in the main column); consider collapsing long
comment threads.

---

### P1-7 — Async status text is not announced to assistive tech

**What I saw.** `grep -rn "aria-live" static/ templates/` finds none in the
platform UI. `#comment-status` ("Posting…"/"Posted"), `#rating-yours`,
`#remix-status` and `#tag-hint` are plain `<span>`/`<p>`/`<div>`s with no live
region.

**Repro.** On `/g/2048`, submit a comment while running a screen reader (or
check `getAttribute("aria-live")` on `#comment-status` → `null`). Nothing is
announced.

**Fix.** Add a shared visually-hidden `aria-live="polite"` region and write
status changes into it (or put `aria-live` on the status elements).

---

### P2-1 — Active sort state is colour-only (no `aria-current`)

**What I saw.** On `/`, `nav.sort-bar` has `aria-label="Sort games"` (good), but
the active item is indicated only by `.sort-link.active { color: var(--accent) }`;
`sort_active_aria_current=null` and there is no `aria-current` anywhere.

**Repro.** `document.querySelector(".sort-link.active").getAttribute("aria-current")` → `null`.

**Fix.** Add `aria-current="true"` to the active sort link.

### P2-2 — Heading order skips a level

**What I saw.** `/` has one `H1` ("16 games, one platform") then jumps to `H3`
for every card title (`headings` list). No `H2`.

**Repro.** Devtools → accessibility tree on `/`.

**Fix.** Make card titles `H2`, or add an `H2` section heading above the grid.

### P2-3 — `prefers-reduced-motion` is ignored

**What I saw.** `grep -rn "prefers-reduced-motion" static/ templates/` → none.
Under emulated reduced motion, `.card` still reports
`transition: transform 0.12s, border-color 0.12s` and `.card-thumb img`
`transition: transform 0.25s`; `.star-btn` animates `transform` on hover
(`reduced_violations`).

**Fix.** Wrap hover/transform animations in `@media (prefers-reduced-motion: no-preference)`
or add a `reduce` block that disables transforms/animation.

### P2-4 — Raw ISO timestamps in comments

**What I saw.** `/g/2048` comment headers render `2026-10-15T02:43:21+00:00`
(also visible in `game_2048_390_full.png`). No localisation or relative time.

**Fix.** Render "2 minutes ago" / a short local date server- or client-side.

### P2-5 — Oversized, unoptimised thumbnails and revalidating cache

**What I saw.** All 16 thumbnails are `900x563` PNGs (displayed at ~260–350px),
12–172 KB each (~1.4 MB total). No `srcset`, no WebP/AVIF, no size hint. Both
`/static/gamebase.css` and `/play/<slug>/thumbnail.png` return
`Cache-Control: no-cache` (Etag revalidation on every navigation). With
`loading="lazy"` and a `#05070c` card background and **no placeholder**, the
full-page capture at 768px (`catalog_768.png`) shows several thumbnails still as
black rectangles while they load — which is also what a user on a slow link
sees.

**Fix.** Serve responsive/`srcset` thumbnails (or smaller default), prefer
WebP/AVIF, set a long `max-age` with hashed/versioned URLs, and add a subtle
placeholder/skeleton behind lazy images.

### P2-6 — Small tap targets at 390px

**What I saw.** At 390px: `.sort-link` **39x18**, `Play` button **56x31**,
`.star-btn` **27x30**. The sort links fall below even the WCAG 2.5.8 24px
minimum, and all are below the 44px touch recommendation.

**Fix.** Increase vertical padding / hit area (e.g. `min-height:44px`, larger
line box) for the sort bar and card actions on touch widths.

### P2-7 — Low-contrast "off" star states

**What I saw.** Computed `.star-btn` off colour `#334155` on panel `#111827`
= **1.71:1**; `.stars-mini` off `#475569` on panel = **2.34:1**. These are
paired with numeric rating text so they aren't the *only* signal, but the
inactive stars are nearly invisible.

**Fix.** Lighten inactive stars (e.g. `#64748b`) or add an outline so the scale
is legible.

### P2-8 — Primary hero CTA is an internal admin action

**What I saw.** The only control in the `/` hero is
`<button data-rescan>Rescan registry</button>` (`rescan_accessible_name`), shown
to every anonymous visitor, and pressing it triggers the identity gate. There
is no "Browse" or "Add a game" CTA at the top of the catalog.

**Fix.** Move rescan to an admin/advanced surface and give the hero a
player-facing CTA.

### P2-9 — Player profile page is nearly empty

**What I saw.** `/players/AUX` (`player_1440.png`) shows only the handle,
"0 achievements · 0 points · guest player" and "No achievements yet. Go play
something." There is no list of played games, recent comments, ratings or
score history.

**Fix.** Show recent plays/scores, ratings and comments to make profiles useful
(match the "Steam-like" positioning).

### Note (outside the visual/a11y lens)

The game iframe uses `sandbox="allow-scripts allow-same-origin"`, which logs a
Chromium console warning: *"An iframe which has both allow-scripts and
allow-same-origin for its sandbox attribute can escape its sandboxing."* Worth
a security review; not counted above.

---

## 4. Prioritised suggestions

1. **Let people browse and play without an identity (P0-1).** Decouple
   `startGames()` from `ensureIdentity()` and gate only write actions. Add a
   "browse without a tag" escape. This single change unblocks the whole site.
2. **Fix the 404 handler (P1-1)** to return the site's HTML shell for browser
   requests and JSON only for `/api/*`.
3. **Close the accessibility defects in one pass (P1-2/3/4/5/7):** label the
   comment textarea, add `aria-pressed`/radiogroup to the stars, add an accent
   focus ring to `.play-frame`, make the tag gate a real modal
   (`role=dialog`, focus trap, `inert`, `aria-live` hint), and add a shared
   `aria-live` region for comment/rating/remix status.
4. **Re-order the game page (P1-6):** surface rating + top scores next to the
   game (especially on mobile) and collapse/limit the comment thread.
5. **Polish pass (P2):** `aria-current` on sort, H2 card headings, a
   `prefers-reduced-motion` block, humanised timestamps, responsive/optimised
   thumbnails with a placeholder and long-lived cache, larger tap targets, and
   a real player profile.
6. **Reposition the hero CTA (P2-8)** and replace "Rescan registry" with a
   player-facing action.

Run `python scripts/check_all.py gamebase` and the pytest suite before/after any
change; none of the above alters game code.
