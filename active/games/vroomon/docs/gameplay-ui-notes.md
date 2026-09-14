# Vroomon gameplay & UI notes (2026-09-10)

Companion to `docs/audit.md`. Covers the gameplay/UI pass: how we reviewed the
rendered app, what we found, what we fixed, and reusable recipes (vision
sub-agents, OCR, pixel probes) for future sessions.

## How this pass was run

No human/screenshot viewing was possible in-session, so the review used three
layers of evidence:

1. **DOM/CSS/behavioral probes** (Playwright + `scripts/web-server.mjs`):
   computed styles, `getBoundingClientRect`, `hidden` vs CSS `display`,
   keyboard behavior, and canvas pixel readback (`getImageData`).
2. **OCR** of full-page screenshots with `tesseract` (v5.5.2 available via the
   nix profile) — `tesseract shot.png stdout --psm 11`.
3. **A vision-model sub-agent** (see the pi recipe below) that critiqued the
   14 captures and corroborated the probe evidence.

## Confirmed bugs → fixed

### 1. Mode-scoped overlays ignored `hidden` (P1) — FIXED

`game.html` / `index.html`: `.viewport-overlay--actions`, `--status`
(leader pill) and `--progress` (batch bar) set `display: flex`, which overrides
the UA `[hidden] { display: none }` rule. Result: evolution HUD + test-drive
HUD + leader pill + "Batch 0/0" bar rendered in **every** mode (cluttered menu,
overlap with the world D-pad, stale cross-mode readouts). The ⚙ config toggle
was also a no-op (`data-config-panel` had an inline `style="display:flex"`).

**Fix:** one global rule in both shells:

```css
[hidden] { display: none !important; }
```

(Note the inline `display:flex` on `data-config-panel` is now defeated
correctly by the `!important` guard.)

### 2. Overworld never painted — blank green screen (P1) — FIXED

`renderer.ts`: `stopOverworldAnimationLoop()` runs on every non-world
`renderApp()` (including the very first one at boot), which bumped
`overworldAnimationToken` to 1; `startOverworldAnimationLoop()` guarded on
`token !== 0`, so the loop never started and the canvas stayed transparent
forever. No error was thrown. The e2e suite missed it because it only asserted
canvas *visibility* (CSS), not painted pixels.

**Fix** (`renderer.ts`): guard on a boolean (`overworldLoopRunning`) instead of
the token value; wrap `renderOverworld` in try/catch so one bad frame can't
kill the loop. Verified: `paintedPixels == 640*480`.

### 3. Keyboard mode-switch keys dead inside the overworld (P2) — FIXED

`renderer.ts` keydown handler routed every key to `handleOverworldKeydown` in
world mode and returned, so 1-4 / m / o / e / t silently did nothing and the
player could not leave the map by keyboard. Docs claimed the shortcuts worked.

**Fix** (`renderer.ts`): resolve mode-switch keys *before* the world branch
(shared `MODE_SWITCH_KEYS` map; removed the now-dead bottom-switch cases).

### 4. "Save to Hall of Fame" unreachable in evolution mode (P2) — FIXED

The `data-save-to-hall` button lived in the **test-drive** HUD but its handler
(`saveSelectedToHall`) saves the **evolution-selected** vehicle. It only ever
worked because of bug #1 (drive HUD visible in evolution mode). Added a proper
`data-save-selected-to-hall` button in the evolution HUD (visible with the
vehicle focus strip) in both shells; kept the test-drive one.

## Regression tests added

`tests/e2e/vroomon.e2e.ts`:
- "hides mode-scoped overlays and paints the overworld canvas" — asserts the
  evolution/drive HUDs, leader pill, progress bar, config panel are hidden in
  menu mode, correct per-mode visibility, config toggle works, and the
  overworld canvas has >1000 painted pixels.
- "mode-switch keyboard shortcuts work inside the overworld" — 3/2/m/o/t from
  world mode.

## Menu screen — built via A/B (2026-09-10) ✅

`MENU` mode previously rendered only the sample preview with dead
`.viewport-overlay--menu` CSS. Now it ships a proper arcade start screen:

- **Variant A (winner)** — centered cream "title screen" card: VROOMON
  wordmark, pixel-font tagline, green `NEW RUN` primary + WORLD/CONTINUE
  (rows), clickable Hall-of-Fame list, hints + version footer, over an
  opaque slate scrim.
- **B (tried, rejected by user)** — left "garage console" panel with live
  world preview, nav list, GEN/WALLET/BEST stats, keyboard hints. The user
  preferred A: *"I prefer the more explicit menu. I want it to feel like a
  proper game rather than a toy."*
- Both variants were implemented for real in `game.html` + `index.html`
  (selectable via `?menu=a|b`), screenshotted with a populated Hall of Fame,
  pre-reviewed by the vision sub-agent (A 72/100 vs B 58/100) and then A/B-
  tested with the user; after the pick, the loser was removed and the winner
  polished through two vision-review fix passes (measured results):
  - leader pill + status line previously bled through the scrim (1.1:1) →
    mode-scoped `data-viewport-status-overlay[data-mode=evolution]` +
    `z-index:12` status line (9.2:1).
  - gold accents on cream (1.5-2.3:1) → new `--gold-ink: #7a5a12` token
    (4.9-6.7:1); primary CTA gradient darkened.
  - emoji glyphs → dropped/made consistent; button rhythm uniformed
    (12px gaps, 3px shadow).
  - scrim made opaque; gen pill + terrain select + error ring hidden in
    menu mode; HOF entries no longer duplicate the generation in their name.
- `Enter`/`Space` in menu mode starts a new run.

## Race viewport labels — fixed (2026-09-10) ✅

Previously every racer printed its full run id (22px, 5px stroke) clamped to
one y — a "wall of text" at density. Now:

- `layoutViewportLabels()` assigns collision-free label slots cascading
  top-down in score order (21px step, +17px when the focused metric row is
  present). Labels are compact `#N · <seq-tail>`; solo previews keep the label
  directly above the car.
- Travel readout (`NN.NN px`) renders only for leader/selected (+solo),
  tinted to match the label.
- Leader lines run from the label tower to the **top of the vehicle's body
  bbox** (topmost part's x, not the center) and end in a white bead with a
  dark ring; dashes are phase-aligned so a dash lands on the bead; line/dot
  tinted per variant (leader gold, selected blue) so label, line and dot are
  color-consistent.
- Tighter type: 15px labels / 2.5px stroke, 12px metric / 2px stroke.

Verified by 4 rounds of vision-model review (final: 0 critical/high/medium
defects; 4/4 dots touching cars; no metric collisions). Flat gray obstacles,
translucent car blobs, and the clipped bottom caption remain separate backlog
items.

## Player stats HUD + batch pill placement — fixed (2026-09-10) ✅

- `[data-viewport-stats-overlay]` (top-left, below the top bar) renders a
  mode-scoped chip stack: evolution → BEST / POP / GEN / WALLET; world →
  MAP / BADGES / DEX / WALLET; test-drive → HOF TOP / GEN / WALLET; hidden on
  the menu start screen. Values come from live state (wallet, population,
  score history, world badges/vroomdex, map name via `getMap`).
- The batch-progress pill moved from `top: 0.5rem` (behind the fixed 36px top
  bar — a blurred smudge) to `top: 3.25rem` with a solid background; verified
  sharp and centered below the bar.
- Verified by vision-model review (clean chips, no overlap with tabs/leader
  pill/pill) + new e2e test asserting per-mode chip content.

## Focus strip, HOF rows, obstacle/car art — fixed (2026-09-10) ✅

- **Vehicle focus strip**: `focus-chip` styling (active gold / ghost muted) on
  a dark strip backdrop so chips stay legible over any scene, id + score per
  chip, full 8-vehicle row with no clipping.
- **HOF card values** verified populating (Top/saved — earlier 'blank' was an
  OCR misread at low resolution); HOF row meta shortened to date-only
  (`Sep 10, 2026`) and entry names ellipsized.
- **Obstacles**: linear-gradient + dark edge + base contact shadow (no longer
  flat gray slabs); **cars**: dark outlines (no body-merging), wheels drawn as
  tire + accent hub; rank-1 renders gold like the leader pill (leader wins
  over selected for the default selection).
- Verified by 4 vision-model review rounds; 0 blockers on the final pass.

## Cross-mode chrome + boot copy — fixed (2026-09-10) ✅

- The generation pill and terrain select are now hidden in **world mode** too
  (previously only on the menu) — the overworld has no terrain preset and no
  active generation.
- Boot status copy replaced: "Ready to begin the Electron rewrite preview."
  → "Welcome to the Continent of Vroom." (player-facing; the dev catch-copy
  also existed in e2e assertions, updated).
- The bottom status line is no longer clipped: it's a dark pill (padding +
  bottom 0.55rem) and verified inside the viewport bounds.

## Worldbuilding: ranch-faction system (2026-09-10) ✅

The user redefined the fiction (no Pokémon/gym residue): vroomon are
mouse-sized, non-intelligent creatures free-roaming in small ranches; the
player is a racer/rancher. Each biome is its own mini-culture with **two
rival households** you choose between.

- `world/factions.ts` — 12 factions / 6 biomes with local titles: Grassland
  (Meadow Elder/Roundup King), Flat (King of the Commission / King of the
  Underroads), Sand (Trail Boss / Wreck Marshal), Hills (Guru of the Updrafts
  / Guru of the Stone Path), Rocky (Lay Foreman / Ringleader), Ice (Keeper of
  the Long Light / Frost Baron).
- `WorldState.factionChoices` (biomeId → factionId) persists through
  serialize/parse and the main-process file store (backwards-compatible with
  pre-faction saves).
- Grassland mini-story is playable: Meadow Elder (Starter Town) and Roundup
  King (Route 1 → Rustler Pasture, ex "gym_1") each offer the join via a
  dialogue choice; `onComplete: "join-faction:<id>"` records the choice,
  persists it, and surfaces a status line + the HOUSES stat chip; the other
  household appears as the rival. Salt Road Post (ex "Sandy Gym") + gate
  signs stub the remaining biomes behind lore.
- Latent bug fixed along the way: dialogue **option** clicks used a
  text-match lookup that never matched, so any choice silently ended the
  scene — they now resolve the target dialogue by NPC id (faction joins and
  Axle's explain options actually navigate).
- Badge strings re-themed to Brands; docs/index.md + AGENTS.md updated.

## Sand mini-story + overworld reachability — fixed (2026-09-10) ✅

- Salt Road Post (ex "gym_2") hosts the **Wreck Marshal** (join-faction:
  wreckpickers); Route 2 hosts the **Trail Boss of the Salt Road**
  (join-faction:saltcaravan), mirroring the Grassland choice pattern.
- Hills/Rocky/Ice teased as dialogue-only NPCs on Route 2
  (highland-herder / canyon-hauler / frost-courier) naming both factions
  of each biome (gurus; Lay Foreman vs Ringleader; Keeper of the Long
  Light vs Frost Baron).
- Gameplay fixes found along the way (pre-existing, blocked ALL map exits):
  - `attemptMove` left the stored position one tile behind on transition
    tiles, so `isAtEdgeTransition` never matched — no edge transition ever
    fired and the overworld was a dead end. Now the position advances onto
    the tile and transitions fire.
  - Map transitions committed in a microtask never re-rendered the new
    map; added `onMapTransition` so the overworld paints immediately.
  - Starter Town's exit was parked on an untraversable tree tile — moved
    to path (13,2); Route 1 gained the Salt Road entrance at (18,6).
- Note: tests/world.test.ts was accidentally committed with every describe
  doubled; deduplicated (140 distinct unit tests).

## Sand passage playable end-to-end — verified (2026-09-10) ✅

The full world loop now works and is covered by an e2e (19s): Starter Town →
Route 1 → through the vroomgrass wild-encounter band → Route 2 → stand at
the Trail Boss and join the Salt Road Caravan. Wild-encounter tiles only post
a status line (non-blocking), so navigation never stalls.

- The Route-2 gate was originally on route_1 (18,6) — the tile Rider Vicky
  stands on — so the crossing was impossible. Moved to (18,5) (return trip
  lands there too).
- Approach quirk: the Trail Boss occupies (6,12), so the player must stand at
  (5,12) facing right (or (7,12) facing left) to talk.
- Hills/Rocky/Ice faction mini-stories remain dialogue-only teasers until
  those biomes get maps (deferred; their two-faction lore is in place).

## Herd Book rename — done (2026-09-10) ✅

All player-facing "Vroomdex" copy is now "Herd Book": the stats chip label
(DEX -> HERD), Professor Axle's dialogs (option label + the fingerprint
explanation), the "N specimens recorded in your Herd Book" readout, and the
overworld reset confirm. Internal identifiers (world.vroomdex,
data-overworld-vroomdex-count, onVroomdexTick, the "vroomdex" onComplete
kind) stay as-is to avoid churn.

## Hills / Rocky / Ice biome maps — added (2026-09-10) ✅

The three remaining biomes are now playable maps chained off Route 2's
mountain pass (`19,3`):

- **Highland Mesa** — Guru of the Updrafts (Skimmers) vs Guru of the Stone
  Path (Miners); `join-faction:skimmers|miners`.
- **Canyon Quarry** — The Lay Foreman (Stonecutters' Union) vs The
  Ringleader (Canyon Runners); `join-faction:union|runners`.
- **Drift Perimeter** — Keeper of the Long Light (Herdsmen) vs The Frost
  Baron (Drift Syndicate); `join-faction:herdsmen|drift-syndicate`.

Chain: Route 2 → Highland Mesa → Canyon Quarry → Drift Perimeter (returns
west each way). All hosts use the choice-dialogue pattern and the
factionChoices persistence from earlier. Also fixed the pre-existing
"ghost sprite" cosmetic bug: dialogue-stub NPCs (conventionally parked at
0,0 on impassable tiles) are no longer rendered at map corners — only
physical NPCs on walkable tiles draw. Map data is validated by a script
(reachability + transition targeting) and guarded by unit tests (144 total
incl. biome hosts, joins, and the chain).

## Web persistence — wired (2026-09-10) ✅

The web build's store was memory-only, so Hall of Fame / run / world state
vanished on every reload. The shim (playwright-preload-shim.ts) now persists
to localStorage per origin (`vroomon:*` keys) with a graceful in-memory
fallback when storage is blocked (private mode / sandboxed iframe). Desktop
Electron's main-process file store is unchanged. New e2e proves: save run
state → reload → load (terrain preserved), and join a faction → autosave →
reload → HOUSES chip still shows the choice.

## Legacy Python suite — restored to green (2026-09-10) ✅

The reference prototype's suite was red (12 failed + 3 errors). All three
known drifts fixed:

- test_rectangle: 6 tests patched `builtins.print`, the code now warns via
  loguru — tests assert `logger.warning` instead.
- test_population_mutate: fixture patched dead module attrs; mutate() resolves
  parts through `_runtime_dependencies()` — fixture now stubs the resolver
  (Dummy parts + a non-Car sentinel class so the fallback branch runs).
- test_simulation: the module moved to lazy `importlib`-based pygame + narrow
  exception handling; tests now use an importlib seam that delegates other
  imports to the real import_module (keeps patch() resolution working). Code
  hardened alongside: pygame-missing falls back to a headless run with a
  warning; draw errors are caught broadly and disable viz; car-removal errors
  are logged (debug) instead of crashing.
- pyproject: `full_auto_ci` moved from runtime dependencies to an optional
  `ci` group (it was never imported by vroomon).

Run: `nix-shell -p python312Packages.pytest python312Packages.pygame
python312Packages.pymunk python312Packages.tqdm python312Packages.loguru --
run "python -m pytest -q"` → 101 passed, 17 subtests passed, no failures.

## HERD TREND chart + MEAN chip — added (2026-09-10) ✅

Playtest finding: best-score is very noisy generation-to-generation while
the stable signal (mean) lived only in hidden diagnostics — progress didn't
read like progress. Now:

- A **HERD TREND** panel (bottom-right, evolution mode only) mirrors the
  score chart (best gold bars + mean blue bars + first/last generation
  labels) that was previously rendered only into a hidden stub.
- The evolution stats HUD gained a **MEAN** chip (last generation's mean)
  alongside BEST/POP/GEN/WALLET.

Both are mode-scoped and covered by the stats e2e. 144 unit + 16 e2e pass.

## Ranch economy — wired into the game (2026-09-13) ✅

The dictionary-seeded inspiration pack (docs/economy) became a real system:

- `src/core/economy.ts`: six purchasable ranch upgrades with 5 tiers each —
  The Shrewed (pasture: +25 herd cap/tier), Gamesman Stalls (+10 HOF slots),
  Hardwired & Placate (+2% retain), The Surcingle (+2s races), The Pretence
  (−1% mutation), Atmometer Tack (+10% income). Costs 40..1200 base, ×tier.
- Effects land at the right seams without double-counting: the effective
  config sizes new populations and breeding knobs (runEvolutionGeneration)
  but is never baked into stored config; income multiplies in advanceRunState;
  HOF capacity grows in addHallOfFameEntry.
- **RANCH YARD store**: a 🌾 RANCH button in the evolution HUD opens a modal
  (six cards, wallet, tier/level, effect now→next, buy with disable when
  unaffordable/maxed); purchases debit credits, set the status line, and
  persist. Upgrades are **campaign progression** — auto-loaded at boot via a
  dedicated upgrades store (web: localStorage `vroomon:upgrades`; desktop:
  IPC + `upgrades.json`), so they survive runs and reloads.
- HUD surfacing: the evolution stats add HERD (effective herd cap — 125
  after The Shrewed, while POP shows the live herd) and a RANCH L<n> chip
  counting owned tiers; the store cards carry per-upgrade icons and buy
  actions play tiny WebAudio blips (coin/deny).
- Unit tests cover the economy (costs, wallet, caps, modifiers, capacity,
  income) and an e2e plays the full loop: earn 40 cr → buy pasture → herd
  grows 100→125 on regenerate → reload keeps tier 1/5 in the store.
- 151 unit + 17 e2e pass.

## Biome feud payoffs + brand revival (2026-09-13) ✅

Roadmap #1. Every faction host (all 10 across the six biomes) now offers a
"Race to settle the feud" option that reuses the gym-race scaffolding; the
winner's local Brand is awarded (BADGE_BY_MAP extended to starter_town /
route_2 / hills_map / rocky_map / ice_map — Grassland/Salt Road/Highland/
Canyon/Perimeter Brands) with feud-flavoured status copy.

Two latent bugs fixed along the way:
- completeDialogue returned a pre-side-effect state, so advanceDialogueInput's
  `commit(...)` instantly wiped badges/factions awarded inside the nested
  onEncounterStart handler — now returns the live closure state.
- endDialogue populated currentEncounter for trainer/gym onComplete, which
  made persistWorldState bail (activeNpc || currentEncounter guard) — the
  world NEVER saved after a gym fight. Encounters are fire-and-forget
  reports; currentEncounter is left untouched (and saves work again).

Tests: unit feud-node coverage (10 nodes, onComplete gym, brands) + a
feud e2e (Elder -> Race feud -> Grassland Brand in status AND badge list,
surviving reload). 152 unit + 18 e2e pass.

## Ranch decor — purely pretty things (2026-09-13) ✅

The RANCH YARD store gained a **ROOM TO ADORN** section: eight cosmetic
decor items (🌻 Sunflower Bower, 🌷 Wildflower Bed, 🦆 Duck Pond, 🐝 Bee
Skeps, 🧺 Hay Hamper, 🌳 Shade Spindle, ⛲ Wishing Well, 🎏 Weather Pennant,
10–34 cr) with NO gameplay effect. Purchases are placed in Starter Town's
meadow (canvas-drawn emoji under NPCs/player at anchored tiles), persist in
world state (`decor: string[]` — web localStorage + desktop file store,
parse-tolerant), and survive reloads with a canvas-draw e2e check.

Also: persistWorldState now serializes rendererState.world (carries decor —
it previously could only see the controller's world).

## Decor polish (2026-09-13) ✅

- Meadow decor now draws at ~2x the tile size with a grounding shadow — it
  reads as scenery instead of a tiny glyph.
- Each of five decor items gained an extra per-biome spot (Sunflower Bower on
  Route 1, Wildflower Bed on Route 2, Duck Pond in Highland Mesa, Bee Skeps
  in Canyon Quarry, Hay Hamper on Drift Perimeter), verified passable and
  NPC-free by script.
- The RANCH YARD store shows a fade-in/out toast on purchases
  ("🌻 Sunflower Bower placed in the meadow" / "The Shrewed built to tier 2")
  alongside the status line.

## Sprite palette formalized + faction-coded hosts (2026-09-13) ✅

- New `world/sprites-palette.ts`: a single source of truth for overworld
  sprite colors (skin/ink/feet/cap/body/accent roles mirroring the warm
  meadow theme) — NPC palettes, the player sprite, and the viewport label
  tints (leader gold, selected blue) all route through it. Pure refactor,
  no visual change for existing sprites.
- **Faction-coded hosts**: each of the 10 household bosses wears their
  house's signature accent band (meadow green, rust red, dune tan, salvage
  brown, summit sky, stone brown, safety blue, stunt orange, aurora pale,
  ice slate) via HOST_ACCENTS — the Meadow Elder now reads Greensprouts at
  a glance vs the Roundup King's rust.
- Tile/terrain fills remain in TILE_COLORS (sprites.ts) with intentional
  detail fills (tree shade, vroomgrass sparkle, outline highlights).
- Unit tests: palette roles, 10 distinct house accents, and every host id
  resolving in the maps. 156 unit + 12 e2e pass.

## Outstanding gameplay/UI issues (identified, not yet fixed — design work)

From the vision-model critique + probes, ordered by impact:

- **Equipment/cosmetic depth**: car bodies are still flat color blocks without
  shading or per-chassis variation; cross-entity z-order means a dense pileup
  can still look like a web of constraint lines.
- **Hall of Fame card blank** ("Top:"/"Saved:" empty) and overlapped by the
  error-logger ring (`.error-toggle` bottom-right). Error badge shows "0" and
  is permanent player chrome — hide it until `data-has-errors="true"`.
- **Batch progress pill** is positioned at `top: 0.5rem` behind the fixed
  36px top bar (blurred smudge); move below the bar.
- **Vehicle focus strip buttons are unstyled** (`.active`/`.ghost` have no CSS
  in game.html) and overlap the config panel.
- **Status line** at 8px, `rgba(255,244,209,0.75)` on the sky (~1.2:1 contrast),
  baseline clipped; dev copy "Ready to begin the Electron rewrite preview."
  ships in the status line (`state.ts` createRendererState).
- **Terrain select + gen pill shown in world mode** (meaningless there).
- **Aesthetic**: obstacles are flat gray slabs; cars are translucent blobs with
  no wheel shading; three Google Fonts loaded from CDN (offline risk in the
  Electron build); ~60-90% empty sky in most modes.

Candidate A/B tests for later (use `ab_test_visuals`): menu screen design,
label strategy (leader-only vs collision-avoidance), HOF surfacing in web UI.

## Recipes for future sessions

### Run nested pi (vision sub-agent)

Installed `pi` (v0.85.1). The big gotchas:

- `pi --print` text mode emits **nothing** when the autopilot-complete
  extension is active (the run ends with a `complete` tool call, not a reply).
  **Use `--no-extensions`** for sub-agents that must answer.
- `--mode json` (rich session stream, works even with extensions) is the
  fallback; parse `message_update` events for assistant text.
- Usable vision models on provider `opencode-go`:
  - `opencode-go/deepseek-v4-flash-vision-exp` — worked; 6 downscaled 1280px
    images took ~5 min.
  - `opencode-go/muse-spark-1.3-contributor` — configured but returns 403
    DataPolicyError (requires opt-in at opencode.ai).
  - `opencode-go/qwen3.6-plus`, `glm-5.1` — catalog entries reachable but
    returned nothing in testing.
- 14 full-size (2160x1350) images blew the timeout; downscale with ImageMagick
  (`convert shot.png -resize 1280x shot-small.png`) and cap at ~6 images.

Working invocation (from `megarepo`):

```bash
timeout 560 pi --print --no-session --no-extensions \
  --model opencode-go/deepseek-v4-flash-vision-exp \
  --append-system-prompt "You are a meticulous UI critic..." \
  "Review these captions." @/tmp/vroomon-captures/01-menu-small.png ... \
  > /tmp/vision-critique.md 2>/tmp/vision-critique.err
```

### Overworld canvas verification (blank-screen regression)

```js
const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
// painted pixels = count of alpha > 0; was 0 before the fix, 640*480 after.
```

### OCR-based screen reading

`tesseract <shot.png> stdout --psm 11` — sparse text; good for confirming
which readouts/buttons are actually on screen (e.g., it proved the menu screen
showed GENERATE/REPLAY buttons and that the world showed only the status line).

### Overlay visibility probe

For each mode, check the overlay wrappers: `hidden` attribute, computed
`display`, and `getBoundingClientRect().width>0`. Any `display:flex` element
with `hidden=true` but non-zero rect = the hidden-attribute bug.

## Verified baseline (post-fix)

- `npm run build` clean; `npm test` 135/135; `npm run test:e2e` 10/10
  (`VROOMON_BROWSER_EXECUTABLE=/run/current-system/sw/bin/google-chrome-stable`).
- Menu/evolution/test-drive screens are now per-mode clean; overworld paints;
  keyboard mode switching works everywhere.