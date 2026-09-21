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

## Grand Roundup — the game now has a win state (2026-09-13) ✅

"Beating Vroomon" is now a real thing: earn all **five arena Brands**
(Grassland, Salt Road, Highland, Canyon, Perimeter — Flat is the training
track), enshrine a champion in the Record Barn (Hall of Fame), then talk to
the Roundup King and **Run the Grand Roundup**. Completing it marks the world
flag, plays a celebration overlay (🏆, champion name/DNA/score), and the
stats HUD shows an honest **BRANDS n/5** chip. Decline branches cover
missing Brands / no champion gracefully. e2e covers both paths (seeded
world + hall); unit covers the node. 157 unit + 13 e2e pass.

Estimated completion: ~45 min for the tour + Brands; ~1-1.5 hrs for a real
rancher run ending in the Grand Roundup (completionist is the ~8-12h
upgrade grind, which is now optional beyond the win).

## Character creation + story opening (2026-09-13) ✅

- **Brand Yourself card** (menu, variant A): name your rancher (max 24
  chars, used in the Grand Roundup finale copy) and pick a cap color —
  navy / rust / meadow green — drawn on the player sprite (a new cap brim).
  Persists in world state (web localStorage + desktop file store).
- **Opening beats on first world entry**: an arrival line ("The road
  carries you to Starter Town…"), a first objective
  ("Professor Axle is at the schoolhouse — talk to him (Z)…") that stays
  until you meet him, and Axle's farewell now sets the goal
  ("Race a champion, win a Brand, and outrun the road.") with a met-axle
  flag. All flag-driven, so replays go back to the neutral summary.
- **Canon copy sweep**: you *run/race* the herd — vroomon are beetle-sized
  livestock. "Ride a champion" → "Race a champion", faction invitations
  "Ride with us" → "Run with us", "Ride for the Reds" → "Run for the
  Reds"; road/wind idioms ("drive safe", "ride the updrafts") kept.
- Fixed along the way: renderApp's world re-sync was dropping decor +
  identity from the persisted world (they now mirror into the controller);
  widget TDZ at boot (lazy queries); the status line now updates inside
  renderOverworldUi (not just renderApp).
- e2e: creation → arrival → objective → Axle → farewell goal → persisted
  identity; unit covers the identity roundtrip. 158 unit + 14 e2e pass.

## Race presentation + audio (2026-09-13) ✅

- **Race-result card**: feud and rider races now play a moment — a
  3-2-1-GO countdown flash, then a result card (map/rival crossed x=…,
  a bragging line, win/place chord), dismissible with OK and auto-hiding.
- **Synth audio module** (`renderer/audio.ts`, WebAudio, no assets): coin,
  deny, click, countdown beeps, win/place chords, and a finale fanfare;
  each cue owns+closes its context and fails silently. Ranch store blips
  route through it now.
- Re-added the feud e2e (lost during an earlier tail rebuild) and extended
  it to assert the race card appears and dismisses. 158 unit + 15 e2e pass.

## HUD quest/objective line (2026-09-13) ✅

- **Quest director** (`renderer/world/quest.ts`, pure + unit-tested): reads the
  world state and tells the player what's next —
  talk to Axle (opening) → next un-earned Brand in biome order
  (venue + whom to race, with a "choose your house first" hint when the
  biome has no house joined) → Grand Roundup once all five Brands →
  post-Roundup freedom line. So the summary objective and the "what do I
  do now" line always agree as flags/badges change.
- **Objectives chip**: appended inside the world stats HUD (gold pixel-text
  main line + soft hint). Fix: the dialogue advance/option paths now
  refresh the stats HUD too, so the chip flips the moment flags change
  (previously only the world-summary refreshed).

## Herd management tools (2026-09-13) ✅

- **Family lines**: every car already carried its parents; the sim also
  writes genealogy edges (parent -> children) each cycle. Now the Record
  Barn captures a 4-generation ancestry at save time and a **Line** button
  opens a lineage panel (parents -> grandparents -> … with names resolved
  against the Record Barn + current herd, plus live descendant count).
- **Split Pens upgrade ("The Split")**: 3 tiers × +2 stud slots. Cars
  marked **STUD** in the Record Barn get first pick in every breeding
  cycle (2/3 of first-parent picks + 2/3 stud-parent line-ups when the
  pen holds 2+), so you can concentrate a bloodline while the herd still
  mixes. Gated: no slots -> clear "buy The Split" message.
- **Mutation control**: the existing *grooming* upgrade (-% mutation) now
  has a consumable companion — **Calm Tonic** (no mutation next cycle)
  and **Wild Brome** (+15% next cycle) in the RANCH store's SUPPLIES row.
  Stock drains exactly once when the next cycle runs.
- **Favorites**: ★ pin in the Record Barn sorts pinned cars to the top.
- **Fix that mattered**: the Rename/action buttons only existed in a
  hidden diagnostics panel — players could never reach them. All five
  actions (rename/favorite/stud/line/remove) now render on the visible
  menu Record Barn. The HOF test-drive card keeps click-to-load.
- Seeds: `pens` upgrade id; run-state fields `supplies` + `penIds`
  (optional, old saves safe). 171 unit + 16 e2e pass.

## DNA share/import (2026-09-13) ✅

- **Copies** everywhere a genome matters: Record Barn entries (menu hall),
  the selected car in evolution (⧉ Copy), and the test-drive draft — via a
  clipboard helper with a legacy textarea fallback for old webviews.
- **Import**: paste a champion string into the evolution "Paste DNA…" input
  and hit 🌱 Seed — the imported genome becomes the herd's top seed (the
  highest-scoring entry is swapped which, on a fresh herd, is entry 0), so
  a shared champion string can re-enter any run and breed onward. The
  genealogy map stays valid because ids are untouched.
- New `plantSeedDna` helper (+2 unit tests); e2e covers barn-copy,
  draft-copy, and seeded-population assertions. 173 unit + 17 e2e pass.

## Ambient sound pad (2026-09-13) ✅

- **Ambience engine** (`renderer/ambience.ts`): a synthesized, asset-free
  pad that breathes under the event sfx — per-scene profiles (menu /
  meadow / dunes / upland / quarry / drift / trackside) mapped from the
  current mode + overworld map. One persistent AudioContext (the sfx
  cues keep their own short-lived contexts), started only after the first
  user gesture, with slow crossfades between scenes and a 0.09 Hz
  breathing LFO.
- **Sound chip**: top-right 🔊 toggle cycling med / low / off; the choice
  persists in localStorage (`vroomon:ambience`) and survives reloads and
  the future settings surface.
- Scene changes ride renderApp, so walking a biome switch crossfades the
  pad automatically. 173 unit + 18 e2e pass.

## Records Board + ghosts (2026-09-14) ✅

- **Records**: Test Drive laps are judged at the end of every viewport loop
  — the draft's ground covered on the race window competes per terrain.
  Improvements land in a RECORDS board (menu, under the Record Barn):
  best score per biome + the DNA that set it + a **Drive** button that
  drops the record straight back into Test Drive.
- **Ghosts**: when the draft races a terrain with a standing record, the
  sim is replayed with both cars head-to-head and the record car renders
  as a translucent teal **RECORD** ghost on the same track — literally
  racing your own past run.
- Persistence rides the platform (localStorage on web, file store + IPC
  on desktop) behind `loadRecords/saveRecords`, mirroring the Hall of
  Fame pattern; `records.ts` (best/propose) is pure + unit-tested and the
  new lap fires a non-intrusive toast (the earlier inline-status version
  clobbered the flat-track replay notice — caught by e2e).
- 177 unit + 19 e2e pass.

## Settings + save transfer (2026-09-14) ✅

- **Settings panel** (⚙ top-right): **master volume** slider applying to
  every sfx cue and the ambience pad (audio.ts + ambience.ts now take a
  global gain), and **ambient pad** Med/Low/Off — the old top-right chip
  stays as a quick cycle and stays in sync. Persisted under
  `vroomon:settings` (localStorage; the legacy `vroomon:ambience` key
  migrates in once). `settings.ts` normalization is unit-tested.
- **Save transfer**: export world / export run as base64-JSON share
  strings (auto-copied to the clipboard and shown in the panel's
  textarea), and import either by pasting a string back — validated
  round-trips (`save-io.ts` nulls garbage). World import restores the
  overworld live + storage; run import lands in the run state.
- 183 unit + 20 e2e pass.

## Dialogue texture (2026-09-14) ✅

- **Portraits**: every overworld dialogue now shows a parameterized SVG
  bust for the speaker — per-NPC archetypes (scholar glasses for Axle,
  crown for the Roundup King, beard + staff for the Meadow Elder,
  eyepatch marshal, bandana riders, miner's lamp, fur-hood couriers,
  sage wraps, shopkeep coin) drawn from the shared palette, with a
  generic rancher fallback and a quill bust for the narrator.
  `portraits.ts` is pure + unit-tested.
- **Typewriter**: dialogue text reveals progressively (~2 chars/11ms,
  chunkier for long lines) — Z during typing completes the line AND
  advances text lines (classic skip-through); option beats only complete
  so the menu stays interactive. Options render immediately so gameplay
  never waits on the animation. e2e re-verified across all conversation
  flows (the first cut gated options behind typing and broke fast flows —
  caught by the suite). 186 unit + 20 e2e pass.

## Polish pass (2026-09-14) ✅

- **Arena banner garlands**: feud arenas (gym_1, gym_2, hills, rocky,
  ice) now string a sagging pennant garland across the top — the joined
  house's accent on the home half, the rival's on the far half, neutral
  gold before you pick a side. Sways with the overworld tick.
- **Decor catalog 8 → 12**: Salt Road Marker, Meadow Lanterns, Roundup
  Bell, Trellis Arch (each with a biome spot).
- **World-state version stamp**: `worldVersion` (optional in the
  persisted shape) so future worldbuild iterations can migrate old saves
  explicitly; old saves without it read as version 1, always tolerated.
- 186 unit + 20 e2e pass.

## Onboarding: a slow, guided start (2026-09-14) ✅

- **NEW RUN now begins the story**: it lands you at Starter Town with the
  arrival line + Professor Axle objective (walk with arrows/WASD, Z talks)
  instead of dumping you into a racing screen. The menu gained an opaque
  backdrop, a clearer tagline ("Ranching, not racing sim…"), and a
  HOW TO PLAY strip outlining the four loops.
- **First-visit guide banners**: Evolution ("Generate a herd, breed with
  Run Gen, save your champion 🏅") with an auto-generated starter herd so
  the guide has something to point at, and Test Drive ("beats records
  plant ghosts"). Banners clear on any interaction (never block play) and
  persist as seen (`vroomon:tips`), so returning players never see them.
  Fixes a temporal-dead-zone bug where the boot render read the banner
  array before it initialized.
- 188 unit + 21 e2e (new onboarding e2e: NEW RUN lands in world,
  banners show/dismiss/persist). 

## NPC-led teaching: no meta-guide UI (2026-09-14) ✅

- Removed the HOW TO PLAY strip and the first-visit banners entirely —
  the game never spells out the loop in chrome; the fiction teaches it.
- **Professor Axle** now offers "How do I breed a champion?" — a beat
  explaining the paddock loop (breed on the bench → Run Gen → save to the
  Record Barn → records board) in-story, next to the Herd Book beat.
- **Wrench Wanda** (the starter-town shopkeeper) introduces the Ranch
  fitters' yard: pasture/stalls/tonics, and that credits come from every
  lap the Barn pays out, with a "What should I buy first?" beat.
- **Rider Vicky** (first rival) teaches racing in fiction: stand the line,
  tap Z, test-drive any bred car first, and race your own recorded ghosts.
- NEW RUN still opens the arrival story; the status line is pure
  atmosphere now (no control-syntax dump). 186 unit + 21 e2e pass,
  including a new e2e asserting Axle's paddock beat and Wanda's store
  teaching.

## The cinematic opening (2026-09-14) ✅

**Title screen**: only NEW GAME (or CONTINUE once a rancher exists), and a
looping attract race of six cars runs behind the translucent title — no
other chrome. The Record Barn + Records managers moved into a 🏟 Barn
panel in world mode (same lists/actions, still browsable).

**New Game story**:
1. Monologue beats: *"Oh what a long trip it was to get to the Isles of
   Speid… At least I've finally got the chance to start over… Maybe I
   should even change my name."* → the name + cap moment.
2. *"Hey sleepyhead! Time to wake up!"* — you wake beside the bed in the
   **shoddy ranch** (new `home_ranch` map: bedroom, kitchen, tall-grass
   yard, garden gate).
3. **Rancher Robby** in the kitchen: options *"Of course — but I didn't
   see any cattle on the way in?"* / *"For sure! How do I start!"* →
   the reveal: vroomon are beetle-sized wheeled critters, not cattle,
   and the yard floods with them; the ranch is yours.
4. Tutorial: catch a wild vroomon in the tall grass (interact → genome
   recorded into the Herd Book), Robby's praise beat auto-follows, then
   *"alright, that's all for today! explore town"* — the garden gate
   opens onto Starter Town and the existing road begins.

Also: dialogue flag changes now persist (z-advance + option clicks save
the world state — previously reveal flags were lost on reload), the menu
overlay is pointer-event transparent so the attract race + top bar stay
clickable, and the settings gear moved off the ambience toggle's corner.
186 unit + 21 e2e (a full opening-journey e2e walks trip → name → wake →
Robby → reveal → catch → gate).

## Opening polish + real sprite assets (2026-09-14) ✅

**Opening input & pacing**: clicking the intro card advances the beats
(Z/Enter too); Enter no longer loops on beat 2 (the intro now owns all
input while open, so the menu's start shortcut can't reset it); the
overworld dialogue box also advances on click. **Robby's dialogue is now
one sentence per box** (the reveal, the yard lesson, the catch praise),
click-through at a calm pace. Found + fixed a dialogue-engine bug:
setFlag was ignored on beats that ALSO chain forward — those flags were
silently lost (the reveal state vanished on reload).

**The tools are now shown, not just mentioned**: the 🏟 Barn panel gained
a real **Herd Book** section listing recorded genomes; after your first
catch Robby's beat tells you to open it, and the Barn button **pulses**
until you do. The ambience + settings buttons hide in world mode, and
every overworld NPC now has a **name tag** (faction-accented border) so
the world reads clearly.

**Sprite asset pipeline**: `npm run export:sprites` renders all 96
code-drawn sprites (tiles, NPCs, player facings) to real PNG files in
`src/renderer/assets/sprites/` + a manifest; `copy-static` ships them to
dist and the runtime **prefers the PNG files** over the code drawing
(which stays as fallback). This is the drop-in seam for AI-generated art:
name a PNG the same as its manifest id and rebuild — the game uses it.
(No image-gen model/API exists on this host, so generation itself needs
either a local GPU install or an API key placed in `.secrets` per the
repo's rules.)

## The ranching loop + component sprites (2026-09-14) ✅

**Ranching in a box**: the flock now behaves like your lore — a
microwave-sized **carrier** you keep on your hip (Robby hands it over
with the first catch; Wanda tells you it runs on grain). Gameplay:
- **Feed** is a resource riding the carrier. Every generation **costs 1
  feed** (Run Gen and batches are cut off with an "Out of feed" message /
  the batch trims to what you can feed).
- **Releasing pays it back**: 🐄 Release the selected vroomon (+1 feed,
  herd shrinks) or ⚡ Cull slow — keep the top ten, release the rest
  (+1 feed each). That's exactly "release the slower mons and keep the
  faster ones", and it funds the next breeding run.
- The RANCH store sells **🌾 Grain** (36 cr → +6 feed); the stats HUD
  gained a FEED chip. `releaseFromPopulation` / `keepFastest` are pure +
  unit-tested; a new e2e walks out-of-feed → grain → breed → release →
  cull. 189 unit + 22 e2e.

**Component sprite system**: NPCs are now assembled from three
independently generated parts — **head** (skin + face), **outfit**
(torso + trades), and **accessory** (caps/glasses/stetsons/wrenches/
bandanas/signposts) — drawn in order around a shared anchor. The exporter
emits each part as its own PNG (`head:light`, `outfit:labcoat`,
`accessory:stetson`, …) plus the assembled `npc:<id>` (runtime unchanged).
Parts can be swapped per-component, and AI-generated art can replace any
part or whole NPC by manifest id.

## Tile sprite components (2026-09-14) ✅

The same component treatment now applies to **backgrounds and walls**:
- **Ground tiles** are two layers — `tilebase:<kind>` (fill, corner shade,
  blades/pebbles/planks) and `tiledetail:<kind>` (vroom-grass glints,
  water waves, tall-grass blades, doormat weave, furniture like the bed,
  rock faces, door panels, building trim).
- **Wall faces** are assembled per kind from `wallbase:<kind>` (mortar),
  `wallbrick:<kind>` (brick courses with running offset), and
  `walltrim:<kind>` (coping + skirting shadow), shared by wall, building,
  and tree-trunk.
- The exporter now emits 146 sprites (every `tile:<kind>` assembled
  PNG, plus the per-layer files and the NPC head/outfit/accessory +
  player parts); the runtime still consumes the assembled `tile:<kind>`
  images, so behavior is unchanged and each layer is a drop-in AI-art
  swap target by manifest id. Layer outputs verified by pixel sampling
  (bricks, mortar, trim, glints). 189 unit + 22 e2e pass.

## Pocket Ranch: the world is the hub (2026-09-14) ✅

- **The top-bar mode tabs are gone** (and their 1-4/m/o/e/t shortcuts):
  the overworld is the game, and the title screen is boot-only.
- **The 🏟 carrier button opens the Pocket Ranch** — one full-screen hub
  with three scenes and a pill switcher:
  - **🐄 Herd** — the breeding bench: Generate / Run Gen / Batch, FEED,
    release, cull, copy/seed DNA, config.
  - **🏁 Test Drive** — the paddock: draft DNA, terrain, replay, records.
  - **🏟 Barn** — Herd Book, Hall of Fame, Records (with their actions).
  - **Back to the road** (or Escape) returns to the overworld, which
    pauses behind the carrier.
- The hub's scene follows the underlying mode, so loading a saved
  test-drive run (or a record's Drive button) lands on the paddock; the
  barn lists refresh on every open. Hub status copy narrates each scene.
- **The tie is diegetic too**: your **Carrier Bench** stands in the yard
  (beside Robby) — walk up and press Z to crank the herd awake and open
  the hub, so the overworld and the pocket ranch are the same place.
- Fixed en route: a leftover mode-button guard that threw on boot (the
  renderer silently died), CONTINUE never appearing on reload (the world
  load didn't re-render the shell), and the hub not syncing `runState.mode`
  (a reloaded save opened the wrong scene).
- 189 unit + 22 e2e pass (all navigation rewritten to the hub flow).

## Screenshot pass + sprite bake + test tiers (2026-09-14) ✅

Read the actual screenshots and fixed what they showed:
- **Title**: the attract race was hidden behind an opaque backdrop — now a
  translucent vignette, so the six-car race runs visibly behind the title.
- **Name tags**: were ~25 screen-px tall; now tile-scaled (small, subtle).
- **Sprites were half a tile and exported PNGs mostly empty**: the drawing
  geometry was hardcoded in pixels — now proportional to the tile, so
  characters read at world scale *and* the 96px exports are full.
- **World framing**: outside the map is deep forest instead of bright
  meadow (the letterbox read as empty paint).
- **Bed tile** redrawn (frame + mattress + striped blanket + pillow — the
  first thing a new rancher sees), tall-grass blades de-tiled from a
  dashed "fence" pattern, quest text given contrast, dialogue portraitz
  zoomed/enlarged, hub bar no longer wraps.
- **Settings toggle stays reachable** everywhere (hiding it in the world /
  hub made volume + save transfer impossible mid-session).

**Sprite bake (perf)**: the static tile layer is now baked once per map
into an offscreen canvas and blitted in one call — overworld draw calls
per frame dropped from ~195 to ~4 (**11,700 → 240 draw calls/sec**), with
no visual change. `npm run export:sprites` now writes `source` tags and
**preserves entries marked `generated`** (hand-made/AI art survives
re-exports; `--force` overwrites), which is the mix-and-match rule.

**Test tiers**: e2e now runs in parallel workers (2m25s → **46s**), with a
`@smoke` subset (**22s**) covering the paths that break silently; unit
tests stay at ~5s. See DEPLOYMENT.md.

## The evolution lab: dials, auto-run, outliers (2026-09-14) ✅

Reframed the herd bench away from "approve every mating" toward the
evolution-simulator core (the BoxCar2D lineage of the design):

- **Sim dials always visible** on the bench — HERD (20–400), MUTATION
  (2–50%), KEEP (10–75% retained), DNA length — replacing the hidden ⚙
  config panel. Dialling the simulator is now the front-and-centre act.
- **▶ AUTO**: grinds generations back to back (~0.6s apart), with
  *stop at plateau* honoured (6 dry generations), feed spent per
  generation, and automatic stops on out-of-feed or when you leave the
  bench. The button shows a live count (`⏹ AUTO · 6`) and the status line
  reads `Auto-run gen 6 · best 1001.93 · 3 dry`.
- **Outlier callout**: any generation whose best beats the run's all-time
  best by ≥2% throws a gold `NEW OUTLIER · 1001.93 (+7%)` banner with the
  win chord — the "lucky generation" moment the loop exists for. Manual
  and batch runs celebrate too.
- The BEST chip is now the **all-time** best (it showed only the latest
  generation, so it disagreed with the auto-run summary).
- `evolution-lab.ts` holds the pure decisions (`isOutlier`,
  `autoRunVerdict`, `improvementRatio`) with 7 unit tests; a `@smoke` e2e
  dials the sim and watches the counter climb without further input.

Next (from the user's steer): a **heritage/lineage tree** view so you can
trace how a champion emerged, and **scaling biomes** so yesterday's
champion is obsolete when the terrain gets harder.

## The heritage tree (2026-09-14) ✅

A fourth Pocket Ranch scene — **🌳 Heritage** — because watching families
develop was called out as a top-loved part of the design:

- **The family fabric**: every vroomon the run has ever bred is a node,
  grouped into generation columns by ancestry depth, joined by parent →
  child curves (gold for mutated offspring). Untraceable/released stock
  renders as small slate dots; scored stock scales with the best.
- **Trace a line**: tap any vroomon and the whole book dims except its
  ancestors and descendants, its chain labels itself, and the info line
  reads `#72 · 130.69 pts · gen 7 · line: #12 ← #30 ← #55 ← #72 · 3
  descendants`.
- Champion labels sit along the top per generation (with a collision
  guard), the depth ruler runs gen 0 → gen N, and the header summarises
  `75 vroomon · 22 champions · 23 generations deep`.
- `heritage.ts` holds the pure model (`buildHeritageGraph`,
  `traceHeritage`, `shortLabel`) with 9 unit tests; a `@smoke` e2e breeds
  four generations, opens the tree, checks it painted, and taps a node.
- Fixed on the way: the tree read scores from the run-state population
  (always 0) instead of the last evaluated generation, and the heritage
  scene was being overridden by the scene-follows-mode sync.

## The circuit: sweeps scale the bar (2026-09-14) ✅

The "find a new champion" pressure the design called for — a swept area
gets harder instead of just paying out a Brand:

- **Feuds are real contests.** Each arena has a **bar**: the score your
  best champion must beat. Tier I Grassland is 600; Ice starts at 840.
  The feud race compares your Record Barn's best on that terrain (or the
  live herd's best if the barn's empty) against the bar and tells you the
  result — `the bar was 600 — your champion answered 900` or
  `short by 68`.
- **Sweeping raises the bar.** A win awards the Brand *and* advances that
  circuit a tier (`×1.28` per sweep), keyed by **Brand** so the whole area
  scales: Grassland I 600 → II 768 → III 983 → IV 1258 → V 1610. A 900
  champion takes I, scrapes II, and is turned away at III — which is
  exactly when you go back to the bench.
- **A CIRCUIT readout on the bench** (`CIRCUIT Grassland II · 768 ✓`) says
  what you're breeding against and whether your champion currently clears
  it.
- `circuit.ts` is pure (`feudBar`, `tierOutcome`, `badgeForMap`,
  `nextCircuitTarget`, `venueTitle`) with 10 unit tests; the map → Brand
  table moved there so awards and tiers can't disagree. Two e2e tests
  cover the sweep (Brand + tier II) and the turn-away (short by 68, no).
- Fixed on the way: `persistWorldState` hand-listed its fields and so
  dropped new world state (circuit tiers) — it now uses the shared
  serializer.

## Three ways a written scene quietly stops working (2026-09-15) ✅

Content that references other content by name is content that can rot. The
controller degrades gracefully at every one of these — it shrugs, keeps
running, and the scene simply does not happen — which is exactly why they need
checking from the outside:

**A `goto:` that lands nowhere.** It names a map, a tile and the story node on
the far side. A bad tile and the beat drops the player inside scenery; a bad
node id and the hand-off is silently skipped, so the scene ends without
picking itself up. The audit resolves every one and requires the map to exist,
the tile to be passable, and the named node to have dialogue on the far side.

**A `next:` that names nobody.** Dialogue links resolve by hunting for an NPC
with that id on the same map — story nodes live on invisible NPCs parked at
0,0 — so renaming one cuts a conversation in half with no error anywhere.
Every `next` and every option target is now resolved.

**A flag nothing ever sets.** A condition on an unwritten flag can never fire:
written, placed, unreachable. This is how the tutorial's reveal went missing
once already, so it is checked at the source level now — every
`flags["..."]` read anywhere in the renderer, controller, quest chain or side
quests has to be written by a dialogue or by code.

All three have teeth, verified by mutation — a typo'd flag read reports
`flags read but never set: met-axl`, and a bad `goto:` reports
`lands on tree at ranch_yard:0,0`. None of them found a live fault today,
which is the point of writing them now rather than after the next map is
reshaped.

## Where people are, and where the map file says they are (2026-09-15) ✅

Chasing the "can you always talk to this person" question turned up something
better than the thing I was looking for.

**The facing rule I assumed does not exist.** Interaction is about the
*player's* facing: you stand next to someone and press Z. A keeper staring at
a wall is only ever a cosmetic oddity. So the real contract is not "the keeper
faces a walkable tile" — it is:

> there is a walkable, reachable tile next to the keeper that nobody else is
> standing on, for every keeper, at every hour

A night watch that moves into a nook with no reachable neighbour would be a
person you can see and never speak to. Swept across the clock in hundredths:
none. (There is one facing rule with no legitimate exception, so it is
asserted too: nobody faces off the edge of the map.)

### Two answers to "who is standing here"

`attemptMove` looked up an occupant by the **static** `npc.x / npc.y` from the
map file, while `findAdjacentNpc` — what actually decides who you talk to —
uses routine positions. Two answers to the same question is how a bug gets
written later. The static lookup is the wrong one: a keeper with a routine
leaves their tile at dusk, so the map file's answer is a person who is not
there.

`attemptMove` now uses the same `npcOnTile` helper, and a test walks into a
morning tile at night. Reverting the fix reproduces it:

```
long_haul: the tile cook-ada left at 3,6 is still an invisible wall
```

In game this was already unreachable, because the controller checks
`npcOnTile` before calling `attemptMove` — so this is a latent inconsistency
rather than a live bug, and worth saying plainly. It is still worth fixing:
the helper is exported, and the next caller would have inherited the wrong
answer. The controller now also passes its own pinned clock through, so both
layers agree even at a phase boundary.

## The writers' lines were never on screen (2026-09-15) ✅

Every side quest has carried an authored `offer` ("Nobody wrangles vroomon
without proving they can catch one...") and an authored `reward.thanks`
("Three races won off the rough. That's a wrangler.") since the quest layer
was built. A grep for either string across the whole renderer found **nothing
that displayed them**. The contract test asserted both were non-empty — so
they were written, checked, and read by nobody.

That is a specific and embarrassing shape of dead content: the checks passed
precisely because the lines existed, and nothing checked that they *arrived*.

### Putting them in the giver's mouth

`questBeats(world, run, npcId, npcName)` returns what a person should be
saying, in priority order:

1. **thanks** — a job you finished that they have not acknowledged to your
   face yet
2. **pending** — a job you took and have not delivered
3. **offer** — the next job, when their greeting has no menu of its own to
   say it with

The talking handler plays that line *before* their greeting (prepending, so a
greeting with options still shows its menu afterwards — appending would have
been swallowed).

### The reward lands the instant the work is done

The first live test looked like a failure: Jess said nothing. She had already
paid out — `tally` read `paid:wranglers-muster` — so there was nothing to
thank for. That is the right mechanic (nobody should have to walk back for
their money) but it meant the thank-you could never be spoken, since the
player is not mid-conversation when it fires. So the acknowledgement now waits
for the **next meeting**, tracked by `spoken:<quest>` so it happens once.

The screenshot is the whole point: Jess says *"Three races won off the rough.
That's a wrangler."*, the corner reads **JOB DONE · The Wrangler's Muster**,
and the wallet reads 120 cr — the writer's line, the job, and the money all
in the same moment.

### And the loop the feud actually asks for

Writing the arc e2e from scratch went wrong twice, in a way worth recording.
The feud is raced by the best car in the **Record Barn** — not by whatever the
herd currently holds — and the selection *sticks to whatever you last
touched*. Seeding the loaner moved it, so the test saved a 787 car while the
HUD showed a 1000+ leader, and lost the feud by 213. Both failures were the
test being wrong about the game, not the game being wrong, and the fixed test
now picks the top-scoring chip first — which is the loop a player runs: find
your best, record it, defend the ground with it.

## A correction: where the ladder actually starts asking (2026-09-15) ✅

Two cycles ago I wrote that "the first trophy is about breeding rather than
about the gift", on the strength of a measurement showing the loaner's line
crossing the tier I bar at generation 2. That measurement was of **one slot**,
not of the herd — and the sentence built on it was wrong in the way that
matters.

The number that decides whether the bars mean anything is what a *random* herd
can already do. Over 400 freshly generated cars on Grassland:

```
median 160   p90 481   max 1145
2% clear tier I (1000)   0% clear tier II (1220)
```

So the best of a new herd is already near tier I, and a first-sitting Brand can
be won by finding that car and putting it in the Record Barn. **Tier I is a
formality; the ladder starts asking at tier II, which luck never reaches.**
That is a defensible design — the first Brand teaches the loop, the second
teaches breeding — but it is not what I claimed, and the difference is now
pinned by a test that measures the distribution rather than a curve.

Two related corrections in the same pass:

- `tests/early-game.test.ts` now says out loud that it tracks `slot 0` (the
  planted loaner, and what `advanceRunState` keeps at the front) rather than
  "the herd's best". Those are different questions and I had been reading one
  answer as the other — twice, in two different files.
- A new e2e plays the whole opening arc with nothing seeded: the loaner,
  generations at the bench, then the Grassland feud won at tier I with no
  champion waiting in the Record Barn. It ends on the badge, not on a curse.

## The middle of the circuit, measured (2026-09-15) ✅

Two questions: does the climb (x1.22 a tier: 1000 / 1220 / 1488 / 1816 / 2215)
pace with what breeding can do, and is the last Brand earned or merely waited
for? Both answered by running generations against the home paddock's own wild
pack, scoring everything on Grassland.

**Hunting one animal each cycle** (the pack's middle animal — what an
encounter actually sends) and planting it:

```
T1@1  T2@5  T3@5  T4@27  T5@27      herd ceiling 2700
```

**From a pack champion, with no further imports:**

```
T1@1  T2@9  T3@15  T4@29  T5 never  ceiling 2046
```

So an engaged player never stalls — the whole Grassland ladder falls inside
about thirty generations, and the first two Brands inside five. And the last
Brand is genuinely **earned by staying in the grass**: a herd fed one good
animal and then left at the bench climbs to 2046 and stops, 169 short of 2215.

Worth noticing how tiers II and III fall in the *same* generation: a single
lucky animal off the ground (the pack swings between ~112 and ~1575) can clear
both at once. That is the hunting-lottery doing its job, not a pacing hole —
what the player is buying with those cycles is one good line.

### A trap that cost me an hour

`starter_town`'s wild pack is scored on **Flat** ground, while `gym_1` — the
Grassland arena — is Grassland. Comparing wild scores to herd scores across
two terrains produced confident nonsense: the same genome read as 1958 in a
pack and 1320 planted in a herd, which looked exactly like a simulator bug.
It is not: it is two different courses. `tests/mid-game.test.ts` says so at
the top, so the next person measuring pacing hunts and races on the same
ground.

## The early game, measured (2026-09-15) ✅

The first Brand is reachable in a first sitting, and the second one is not —
which turns out to be the hinge the whole circuit hangs on. Measured from a
fresh save with Robby's loaner planted as the top seed of a new herd, clear
sky, Grassland bar 1000:

```
best per generation   463  1118  1118  1118  1118  1119  1141  1141  1141 …
crossed tier I at     generation 2
plateau (12 gens)     1205
tier II bar           1220
```

The loaner alone (463) does **not** clear the bar, so the first trophy is
about breeding rather than about the gift — but two generations gets there
with room to spare. Then the line flattens at 1205, just under tier II's
1220: **one good import closes that gap, and nothing in the barn does.**
That is the moment the game wants a player to go and find genetics that are
not already theirs — a wild pack above founder stock, Oxide's road stock, or
a Champion string out of the herd book.

`tests/early-game.test.ts` asserts the whole shape: `best[0] < bar`,
`crossed` between 2 and 3, and the plateaus stay under tier II while staying
within 15% of it (a gulf would be a wall, not an invitation).

### What a generation actually costs

Measured in the browser, `Run Gen` at the real bench, timing from click to the
generation pill changing: **287, 309, 289, 294, 290, 276 — median 290ms.**
The on-screen race is a playback of the headless evaluation, so the wait is
three-tenths of a second, not three seconds. Scoring a generation is ~0.11s
of arithmetic in isolation, and that is guarded separately so ranch upgrades
that grow the herd can never quietly make the bench the slow part.

## A car's family, one tap from its parts (2026-09-15) ✅

The pedigree line in the Inspector now ends in a **🌳 Trace line** action:
it closes the inspector, opens the Heritage scene, focuses that same animal
and opens its line report. The reverse direction already existed (the tree's
own `🔍 Inspect`), so the two views are now a round trip —

    parts  →  🌳 Trace line  →  the tree, focused, line report open
    tree   →  🔍 Inspect     →  the parts, pedigree and all

The click path was already there but only reachable by tapping a node within
16px of its centre; the extraction (`focusHeritageNode`) means the button and
the tap do exactly the same thing rather than drifting apart.

### The labels were piling up

Opening the tree from a 27-generation herd showed the top row reading
`133 · 950.00 98.5` — champion labels drawn on top of each other. Columns are
~40px apart and a label is ~90px wide, so a label *always* overlaps its
neighbour. Labels are now placed **deepest first**, skipping any that would
land on one already placed, with a dark halo for legibility over the threads.
Recent animals win the collisions, which is the right priority — they are the
ones you are looking at — and the car you arrived for is named whatever
happens.

## Two invariant sweeps, and the two signs they caught (2026-09-15) ✅

Both of these are the same idea: stop checking the *shape* of the content and
start walking it.

### Every job's action must be inside the giver's own reach

Quest contracts already checked that a job pointed at a real map, that decor
existed, that reward genomes could drive. But "a real map" is not "a map the
giver can walk to". The contract now floods the real map graph from the giver
and requires, per objective kind:

- `catch-wild` / `win-wild` — some wild ground is in their reach
- `win-wild-on` — **the named ground has wild stock** and is in reach
- `visit` — the named map is in reach
- `champion-on` — the circuit actually covers that terrain, and they can reach
  an arena at all
- `generations`, `decor`, `release`, `champion-score`, `brands`, `dex-biomes` —
  the barn is walkable from where they stand

Verified to have teeth by mutation: pointing an orchard job at the ranch (no
grass) and a champion job at `Wetland` (no circuit) both fail it.

### Every keeper must be standing on ground you could walk to, at every hour

The existing collision check sampled five day-parts. That misses the
boundaries between them and never asked whether the tile was passable at all.
The sweep now walks the clock in hundredths and requires every on-shift
keeper to be on a tile that is **passable and reachable from the map's
entrances**. It found two signs, on the first run:

- `route_1: roundup-sign stands on tree at 19,5`
- `route_2: sand-sign stands on tree at 21,5`

Both were built inside the border treeline — which means both had dialogue
**nobody could ever read**, since interaction needs a walkable tile to stand
on and face them from. Both now sit beside the road facing it (16,5 and 18,5).
Worth noting the shape of the mistake, because it is easy to repeat: a sign is
placed by eye against the drawn map, and the drawn map's border of trees
looks like scenery rather than a blocker.

## A second pass along the arc (2026-09-15) ✅

Walking the three beats with the most systems stacked around them — the first
catch, the first Brand, the Grand Roundup — found two things.

### The first catch could be rained off

The lesson was scheduled by the weather. Racing Robby's loaner into the tall
grass **in an afternoon shower lost by 65px** — and the player has exactly one
car and no way to know that the sky, not their breeding, decided it. The first
lesson now waits for a clear spell (`encounterWeather`, unit-tested): the sky
over an encounter is clear until `tut-caught` is set. Same probe, same car,
same hour: **won by 607px.**

### The feud was named for the doorway, not the ground

Sweeping the Grassland from the Greensprouts' elder in Starter Town reported

  `Starter Town I swept! The circuit moves to II — bar 1220.`

— but the Grassland Brand is defended at *Rustler Pasture*, and the same race
accepted at the arena already read that way. The feud now resolves its venue
through `nextCircuitTarget` before naming anything, so the line reads
**`Rustler Pasture I swept!`** whichever door you came through. A circuit test
pins the resolution.

### Two things that looked like bugs and were not

- The feud result panel appeared to be **empty, showing a bare `2`** — it was
  the 3-2-1 countdown caught mid-beat. The result reads `FEUD RACE · I` /
  "Rival took second at 940. The ground is yours… for now."
- The Roundup's HUD read `BRANDS 3/5` while the finale announced five. That
  was my probe sharing one browser profile across seeded boots; the sequence
  is already covered by a passing e2e. Recorded because chasing either would
  have been a wasted afternoon.

### What the late arc looks like now

The wild panel in the grass (`arc-01-catch-rain.png`): two lanes drawn from
the real parts, `YOURS RWRWWR · 3 plates · 3 wheels · 3 driven`, the ground's
ceiling ("this ground's best runs 479px"), and the stake in one line. The
Roundup (`arc-04-roundup.png`): a trophy, "The five Brands are yours, and your
champion stands in the Record Barn", the champion's name and genome, and the
King underneath with his portrait.

## One car, read in the context of its family (2026-09-15) ✅

The Inspector now carries a **PEDIGREE** line beside the parts and stats:

```
PEDIGREE   by #102 + #116 · 37 siblings (best #123, 1177.36)
           · 9 descendants (best #110, 1233.99)
```

Its two parents, how many siblings it was raised beside (with the best one
named and scored), and what it went on to produce. A founder honestly reads as
`founder stock`.

### Two things this caught

- **The kin line first read `by #146 + #148 + #65 + #74 + #75 + #80 + …`** —
  nine parents. The graph unions ancestry edges out of the genealogy map,
  which is exactly what the *tree canvas* needs, but a pedigree wants the two
  animals it was actually bred from. The caller now passes the car's own
  parent pair, and a unit test pins it.
- **The evolution guards were failing the suite on a 5-second default
  timeout** — they measure a herd over five seeds, which is deliberately heavy.
  They now declare their own timeouts. (Worth noting because I nearly
  mis-diagnosed it as a statistical flake and "fixed" a claim that was fine.)

Also: the Inspector's stat rows now pluralise (`1 plate · 5 wheels`, not
`1 plates`).

## A fresh-playthrough pass (2026-09-15) ✅

With this much added *around* the opening, it was worth walking it again from a
genuinely empty save (`localStorage.clear()`) and reading what a new player
actually sees. Screenshots in `/tmp/vshots/pt-*.png`:

1. **Title** — only NEW GAME, CONTINUE correctly hidden.
2. **Opening** — the monologue, the name step, the wake line personalised:
   *"Somewhere, Nell's breakfast smells like it's already decided."*
3. **The kitchen** — Robby with his portrait, two options, and the quest line
   *"Robby's in the kitchen — follow the call."*
4. **The reveal** — the story walks you into the **yard** through the new
   `goto:` hand-off, and the quest advances to *"The tall grass on the left
   grazes wild vroomon."* (the bug where the ranch quest never advanced is
   fixed and visible here).
5. **The yard** — porch, paddock, grass, the lesson.

Nothing read wrong, which is the point of taking the pass rather than assuming
it.

## Rain is a defence modifier, not a fitness change (2026-09-15) ✅

The rule from the weather work — *weather may never move a measured number* —
is now the whole design of how it touches the campaign. A circuit's bar is the
ground's demand, so **bad weather raises the bar** (a shower +12%, a gale +7%,
mist +3%), while **a champion's recorded score was set in the dry and does not
move**. So:

```
clear morning:  Grassland III   you: 1550 (Lhn4yi8zKRd2)   clears 1488 by 62
afternoon shower: Grassland III   you: 1550 (Lhn4yi8zKRd2)   short by 117 · bar 1667  [go]
```

The same car, the same circuit, two skies. The race card says which way the
sky cuts — *"the bar is 1667 (raised 12% by the shower)"* — and the ledger
states the modifier above its rows, so the number you are reading is always
the number you would face.

Every other caller passes no defence, so the lab, the heritage tree, the
records and **every pacing measurement in the suite are unchanged** — which is
exactly what the tests assert, tier by tier, under a clear sky.

## The Heritage tree reads like a pedigree (2026-09-15) ✅

Tapping a car in the family fabric has always traced its line into one
sentence. It now opens a **LINE REPORT** underneath:

```
LINE REPORT · 3 LINKS
gen 0   #12    ─
gen 1   #30    420.11 pts
gen 2   #55    1033.80 pts  ★
Herd best: 1:1167.45 → 2:1167.45 → 3:1322.20 → 4:1207.43
           · best on this line: #55 (1033.80)
```

Every link, its generation, whether it was a champion of its generation, and
the score the herd recorded for it — plus the herd's own best across the last
twelve generations, so a line can be read against the curve it came out of.
Older links honestly read as `—`: only the latest generation still carries
scores, and inventing them would be worse than admitting it.
`src/renderer/heritage.ts` gained `lineReport` and `describeLine`, both pure
and unit-tested.

## Grass you cannot walk to is a mechanic that does not exist (2026-09-15) ✅

Two invariants about the wild's own precondition:

- **No map fences off its tall grass.** Encounters only fire on vroomgrass, so
  a patch the player cannot reach is a mechanic that isn't there.
- **Every outdoor ground with a wild pack has reachable grass.** Checked
  against the wild's own terrain table, so a ground that names a pack but has
  nowhere to meet it is caught. Interiors are excluded on purpose — the
  arenas name a terrain so their circuit agrees with the wild's table, but no
  encounter happens indoors, and the check found exactly that subtlety while
  being written.

## Every far road has someone on after dark (2026-09-15) ✅

The night shift is now a habit of the whole island rather than two men at one
waystation. Each far road has a keeper who exists **only between dusk and
dawn**:

- **Signal Lorn** minds the cable lamps on the Switchback: *"the lamps make a
  false summit out of nothing, and the wind comes down the gullies cold. Cars
  that grip do fine. Cars that don't, I log."* Pays for *The Lamps Of The
  Mesa*.
- **Night Powder Peg** at the Cut: *"no blasting after dark — that's the rule
  and I'm the reason it exists."* She counts what comes off the spoil heap and
  what gets left on it, and pays for *Night On The Spoil*.
- **Night-picker Sib** works the orchard's late rows, where the wild stock
  comes down to the windfalls. Pays for *The Late Rows*.

That makes four night watches in the world (with Pell on the waystation street
and Vane at the fuel shed), three new jobs, and the day cycle meaning
something in every biome: **at noon these roads are empty; after dark every
one of them has somebody on it.**

## Weather, and where it is allowed to matter (2026-09-15) ✅

The sky now follows the hour, using the same day slots as the shifts and the
day tint — **clear at dawn and morning, a shower in the afternoon, a gale at
dusk, mist by night** — and it is not just decoration:

- **A shower cuts the grip a wheel can put down** (0.72) and takes a little
  drive with it. A gale costs more drive than grip; mist costs a little of
  both. The same two cars can swap places depending on the sky, because a car
  that spins its drive away and one with drive on every wheel that is touching
  the ground are affected differently.
- **The wild race names its sky**: `shower: Wet grass: grip is what you
  brought, not what you asked for.`

### The rule that keeps it from being a bug

This is an evolution simulator: a fitness that drifts with the wall clock
would make a breed line and a circuit bar mean something different every time
you looked at them. So **weather applies where a race is already a one-off —
the wild encounter you are standing in — and nowhere else**. The lab, the
heritage tree, the circuit and your own test drives always run clear, and the
sim's weather parameter defaults to neutral, so every existing measurement in
the test suite is unchanged.

### Two things this caught

- The harness pins morning for determinism, and morning was initially *wet* —
  so two catch tests started losing races they used to win. Weather now
  follows the day's own slots (mornings clear), which is both tidier and
  matches the fiction.
- The API surface declares `window.vroomon` in **three** places (renderer,
  preload shim, preload); TypeScript merges them and demands identical
  shapes, which is how the last one gets found rather than shipped.

## The ledger is a work list, not a report (2026-09-15) ✅

Every ledger row you are *short* on now carries a **go** button: it sets the
paddock to that circuit's terrain with your best car on the line, opens Test
Drive, and says what the circuit asks — *"Paddock set for Grassland —
Lhn4yi8zKRd2 on the line. This circuit asks 1488."* Breeding past a bar starts
with knowing exactly which bar and with which car, so the screen that tells
you also takes you there.

## Every arena has a back room (2026-09-15) ✅

Both named venues now have somewhere behind the racing:

- **The Tack Room** at Rustler Pasture, where **Groom Millie** keeps the
  Reds' straps and has an opinion about finishes: *"a champion isn't a fast
  car, it's a fast car that still finishes — and I've seen more of them ruined
  in the last hundred metres than in the first."* She pays for *A Finisher's
  Number* (1,200 on the flat) and will tell you what ruins a car at the end:
  the blueprint, read before you race.
- **The Weighbridge** at the Salt Road Post, where **Weighmaster Tuck**
  weighs freight, cars and excuses, and pays for *Signed Off At The Scale*
  (two wild beaten on the Stretch).

Both are reached through a door in the arena's west wall, and the "giver
stands where the work can be done" invariant had to learn to walk: Tuck is
two gates from the nearest grass, which is fine, so the check is now a
bounded three-gate walk rather than a glance at the neighbours.

## Jobs have to be possible where they are handed out (2026-09-15) ✅

Two more invariants, aimed at content that is *possible to ask for* but
impossible to do:

- **Every objective points at ground that can provide it.** A job to beat wild
  vroomon on a map with no tall grass cannot be completed, so each
  `win-wild-on` objective must name a map that actually has vroomgrass.
- **The giver stands where the work is.** Same bug one step removed: a giver
  on a map with no grass asking for wild wins has to be at least one gate from
  some. Both pass today — which is the point of asking, not the proof that
  they always will.

And decor is now checked for **reachability**, not just walkability: a piece
parked in a sealed pocket is a piece nobody will ever see. Same flood-fill the
NPC check uses, run from each map's own entrances.

## The ledger: bars against bests (2026-09-15) ✅

The Record Barn held per-terrain bests and the circuit held a rising bar per
biome, but nothing put them side by side — so a rancher could not tell whether
their champion still cleared the ground they were about to race. The Barn now
opens on a **LEDGER**:

```
Grassland III   you: 1400 (Lhn4yi8zKRd2)   short by 88 · bar 1488
Sand I          you:  400 (RuAp2owjBaqK)   short by 900 · bar 1300
Hills I         you: —                     no run yet — bar 1150
DEFEND          2 circuits would turn your best away        breed faster
UNRUN           3 circuits never raced
```

Every row states the tier you would face, the score that asks for, your best
and the car that set it — and the margin, green when you clear it and red when
you do not. `src/renderer/ledger.ts` is pure and unit-tested, and it reads
both sources honestly: a lap board entry *and* an enshrined champion count as
cars you could still send.

**Found while building it:** the ledger first rendered with a default world
and never refreshed, because it was wired to the *boot* path rather than the
Barn's own paint. It now renders from inside the records board, so every path
that paints the barn refreshes both halves together.

## The watchman was right about the dark (2026-09-15) ✅

Two NPCs claim the wild runs better after dark — Pell (*"the wild's quicker at
night, if you believe the haulers"*) and Vane (*"same pack, colder air, and
they run it better"*). It was flavour. Now it is a rule: **a meeting after
dark costs the wild pack two generations instead of one**, so the animals you
meet at night have been bred harder.

One definition of night is shared by the wildlife, the window lights and the
shifts (`isNight` reads the same day clock), so the fiction and the mechanics
cannot drift apart. Tests cover both the pack turning over twice and the
clock agreeing on when night is.

## The road landmarks have offices (2026-09-15) ✅

Both far-road landmarks now have a roof and a keeper in it:

- **Salt Road Freight** — a bay on the Stretch where **Clerk Nessa** reads
  herds like ledgers: *"a herd that never turns over is capital sitting
  still."* She pays for *A Line That Moves* (ten generations on the bench).
- **The Fuel Shed** at the Long Light Depot, staffed **only after dark** by
  **Stoker Vane**, who explains why nothing good happens on the ice at night
  and everything fast does — and pays for *The Night Shift* (one wild beaten
  on the ice).

Both are reached from their road's own door, and the invariants that have
been earning their keep all cycle (dead doors, door loops, trigger tiles,
building clusters, reachability, dialogue links) had to pass on every new
tile and gate before this shipped — which is why the second one took minutes
rather than an afternoon.

## The campaign spine was six generations long (2026-09-15) ✅

A bot rancher with one policy — run generations on a biome until its circuit
bar falls, then move to the next — cleared **all five Brands in six
generations**, about thirty seconds of play. The whole spine of the game was a
formality, because the tier I bars (600–840) sat *below* what a random 32-car
herd already scores on those grounds (750 / 1,145 / 1,097 / 1,052 / 875).

The bars are now set between two measured bounds:

- **above** what a random herd manages on that ground, so a Brand falls to
  breeding rather than to the starting population, and
- **below** what a herd reaches even on a *poor* seed (measured low-water
  marks of 1,271 / 1,673 / 1,519 / 2,068 / 3,239), so the opening circuit is
  a real ask and never a wall.

The bot now takes **94 generations** for the five Brands (9 / 20 / 25 / 38 /
2), which is an evening of breeding. `tests/pacing.test.ts` keeps both bounds:
the bars must beat a random herd and stay under what the ground produces, and
a bot campaign must take more than a handful of generations and less than a
week.

### What this means for the ladder

Tier I is the campaign's requirement — one Brand per biome — so it is
calibrated to be reachable on any seed. The tiers above it are a **title
defence**: the bar rises 1.22× per sweep, the record books keep the scores,
and a wall there is a challenge rather than a dead end. The guard says so
explicitly rather than pretending every tier is a promise.

## Three invariants that reached across systems (2026-09-15) ✅

The bugs worth hunting now live *between* features, so these three look for
agreement between subsystems that were written separately:

- **The circuit's terrain table and the wild's must agree.** They describe the
  same ground from two directions, and a pack selected on one surface but
  raced on another is a silent mismatch.
- **Every piece of decor sits on walkable ground** — in the meadow *and* in
  each per-biome spot. It found four pieces parked inside the town's tree
  line (`duck-pond`, `salt-road-marker`, `meadow-lanterns`, `roundup-bell`);
  they now line the meadow fence, which is what their flavour text always
  claimed.
- **Every rival races a car that actually moves.** A trainer race drives a
  DNA derived from the node's id — which was pure luck, and **Tez drew a car
  that managed 0.1px** while **Sprout's managed 38px**. A rival you cannot
  lose to is not a rival. Rival cars are now **authored** (`rivalDna`), and
  the invariant refuses to let one be a dud: Hook races the 1,433px car, Tez
  the 719, Vicky the 454, and Sprout a rattletrap that at least runs.

## Night changes who is about (2026-09-15) ✅

The day cycle used to be decoration — a wash over the map and a reason for
people to stand somewhere else. Now it changes what you can *do*:

- **People can have shifts.** An NPC's `hours` is a phase range that wraps
  (`from: 0.78, to: 0.12` is dusk through dawn), and someone off shift is
  simply **not there** — not drawn, not interactable, not in the way. **Pell
  the watchman** works the waystation street only after dark, and the job he
  offers (*Work The Dark*: two wild vroomon off the Stretch) can only be
  taken at night.
- **Windows light up.** Every building and door tile carries a small warm
  pane whose brightness follows the same clock as the daylight (on through
  dusk, out after dawn), so a town at night looks occupied rather than
  painted.

### And an invariant for buildings

`every building cluster has a door` — a facade with no way in is a promise
the map doesn't keep (the same family as the dead doors and the door loops).
It found nothing to fix: the Long Haul's two buildings and the town's two are
the only ones with doors, and each cluster has one.

## Beauty pass 3: rooms lit, a square furnished (2026-09-15) ✅

- **Rooms have lamps.** Every interior draws a warm pool of light in the
  middle of the room that breathes slowly (0.88–1.0 over about two seconds),
  so a room is lit rather than merely drawn. Pure function, unit-tested, and
  scaling with the room's size.
- **The town square is furnished.** Market stalls and a well head, drawn with
  tiles the world already had (counters are walkable, so no path is blocked,
  and the walkability invariants still pass).

## A pacing audit, measured (2026-09-15) ✅

Balance can't be reasoned about in this game — what a herd can do depends on
the simulation of a given terrain — so the campaign is now measured, and the
measurements are guarded.

**What was measured** (60 cars, 120 generations, mutation 0.3, per terrain):

| terrain | tier I | tier V | generations to tier V |
|---|---|---|---|
| Grassland | 600 | 1329 | 35 |
| Sand | 660 | 1462 | 6 |
| Hills | 720 | 1595 | 21 |
| Rocky | 780 | 1728 | 38 |
| Ice | 840 | 1861 | 10 |

**What that found and changed.** At a tier growth of 1.28 the Quarry's tier V
bar was 2,094 against a Quarry run that topped out at 2,068 — the grind only
got harder from there, forever. Growth is now **1.22**: every terrain's five
tiers fit under its own ceiling and tier V arrives inside 38 generations
rather than never.

**And what it honestly can't claim.** Re-measuring on a second seed gave Sand
1,673 and Rocky 3,224 — the *starting population* decides more than the dirt
does, so "the ceiling" is a range, not a number. The guard therefore states
the weak claim (a bar must sit under what its ground has *demonstrably*
produced) rather than a strong one that would fail on noise, and the real
measurement runs opt-in (`VROOMON_SLOW_TESTS=1`). A bar above one seed's
result is a grind, not a dead end: the herd keeps breeding, and every
generation can find a better car.

**The ranch economy**, for the record: the full upgrade catalogue costs 38,190
credits and a five-terrain campaign earns roughly 28,000, so "buy everything"
is a mastery goal rather than a mid-game wall. That's a deliberate shape, not
a bug — but it is a judgement call, and the numbers are in
`tests/pacing.test.ts` for whoever wants to argue with them.

## Starter Town has rooms now (2026-09-15) ✅

The town's two buildings were facades with nothing behind them. Both open:

- **The Schoolhouse** — where **Professor Axle** actually works now, which
  finally makes the main quest's line (*"Talk to Professor Axle at the
  schoolhouse"*) literally true. **Pup Tam** sweeps up in exchange for
  lessons and knows the important one already: *"the bench doesn't care how
  fast your car is, only how fast the next one is."* Axle's whole explain
  thread (Herd Book, breeding a champion, farewell) moved in with him.
- **The Supply Store** — **Storekeep Bram** sells grain, grease and gossip,
  and pays for *Word From The Switchback*: walk the cable station above the
  Mesa and tell him what the cable hand says about light cars.

### Two more invariants, and the nine bugs they found

- **You land inside a room, not on the way back out.** A gate that lands you
  *on* another gate is a door you cannot stop falling through. The
  schoolhouse and store both did it — and then the invariant found **eight
  more across the whole world**: every mutual road gate (town↔ranch, town↔
  orchard, route↔arena, biome↔biome, waystation↔route) landed on its
  partner's exit tile, so walking a road and continuing in the same direction
  bounced you straight back.
- Moving Axle into the schoolhouse was done by **following his dialogue
  thread**: the explain nodes he points at had to move with him, or the
  conversation would stop dead (the link invariant added last cycle made that
  mechanical rather than hopeful).

## People have days, and memories (2026-09-15) ✅

NPCs were statues with a paragraph. Now they have **routines** and
**memories** (`src/renderer/world/routines.ts`, pure and unit-tested):

- **They move with the day.** Wrangler Jess works the market square in the
  morning, takes the gate road in the afternoon and drinks by the well at
  dusk. Picker Sprout works the rows and races in the afternoon. Cook Ada is
  at her stove by day and at the door in the evening. A routine only
  describes what changes — a missing slot borrows from earlier in the day, so
  a night watch stays where the evening left it.
- **They know you.** Standing is derived (`new` / `known` / `champion`) from
  Brands, Herd Book size and the Hall of Fame, and an NPC can carry opening
  lines per tier: one Brand gets *"Back off the grass, I see"*; three gets
  *"the rider with a Brand and a champion in the barn"*.
- **Rivals remember the last race.** A trainer race records the result
  against the rival's name, and a rival with `after:win` / `after:loss`
  lines opens with it: *"You beat me on my own road"* or *"Told you the Long
  Haul's quick."*

### The trap this set, and the fix

Moving people made **every position test time-dependent** — a suite that
passes at 9am and fails at noon is worse than no suite. The world now carries
a **pinned hour** (`timeOverride`, saved with everything else), the renderer's
clock, the day tint, the routines and the controller's interaction all read
the same source, and the e2e harness pins morning. The feature's own test
walks the same street at dawn and at dusk and proves the difference — which is
only possible *because* the hour is deterministic.

## The save audit now covers every store (2026-09-15) ✅

The journey e2e already proved the world, the herd and the quest tallies
survive a reload. It now also **enshrines a car in the Hall of Fame** (which
means running a generation first, because the Hall reads the ranked herd) and
**buys a ranch upgrade**, then reloads and asserts the Hall, the upgrades and
the records board all came back. Four separate stores — world, run, records,
hall — are checked in one session's worth of play.

## A landmark for every far road (2026-09-15) ✅

Each leg of the circuit now has a place with a face on it, off its biome's
map and reachable from town:

- **The Switchback** (Hills) — a cable station on the Mesa face. **Cable-hand
  Juno** explains why the Hills eat light cars and logs a climb for 900 on the
  Mesa; **Tez** races anything with a fast car and a point to prove.
- **The Cut** (Rocky) — a rock cutting with a pool and spoil. **Powder Monkey
  Bex** explains what survives rough ground (weight and a frame that doesn't
  fold); **Face Boss Halg** pays for a thousand on rock.
- **The Long Light Depot** (Ice) — the last roof before the perimeter, with
  fence lines and ice lanes. **Depot Keeper Sable** explains that ice has no
  grip, so a spinning wheel loses the run, and pays for 1,100 on the
  Perimeter; **Hauler Wren** hauls salvage twice a week in a heavy frame that
  finishes.

Each is chained behind the town board, each has its own wild pack on its own
terrain, and each one back-links to its biome map so nothing strands you.
Champion jobs now read their ground in the HUD (`0/900 pts on the Mesa`), not
just a bare score.

## Rooms behind the waystation's doors (2026-09-15) ✅

The Long Haul's two doors were painted and promised nothing — a door that
leads nowhere is the map lying to the player. Both now open onto real
interiors:

- **Ada's Cookhouse** — counters, a stove, a table, warm light, and two
  people: **Pot-washer Nim**, who turns culled stock out past the fence and
  pays for the same (*Out Past The Fence*, the first shipped use of the
  `release` objective), and **Hauler Quill**, who explains why a frame that
  holds matters as much as raw speed.
- **Raff's Workshop** — benches, scrap and a welding apprentice: **Cogs**,
  who will say the power path back to you and pays for a car that runs 800 on
  the flat.
- Two more jobs in total, from **Roundup King** (*Brands On The Board*, the
  last unused objective kind, `brands`) and the two rooms.

### Two more invariants

- **No dead doors.** Every `door` tile must have a transition on or beside it.
  It found the Long Haul's pair immediately and passes now.
- **Every objective kind is exercised by a real quest.** A declared kind no
  quest uses is a feature-shaped hole that can rot unnoticed — this is how the
  `brands` and `release` kinds got homes.

The wild chip is also hidden on interior maps, where there is no wild to
report.

## The Long Haul: a road stop, and five unreachable doors (2026-09-15) ✅

A new area on the Salt Road — a cookhouse and two workshops between Route 2
and the Highland Mesa, with its own **Sand** wild pack, a pond, fence rows and
**four people**:

- **Cook Ada** hears everything on the lane (and wants proof: 1,100 on the
  Stretch, once the orchard's cutting is paid).
- **Drover Holt** explains the trade counter out loud — sell what you catch,
  buy stock off ground you've walked — and pays for **Four Grounds**, a job
  that counts *biomes in your Herd Book* using the new specimen provenance.
- **Stoker Raff** explains the power path (cylinders, shafts, gears, and which
  wheel actually gets drive).
- **Hook** races anything that stops for bread, on a Long Haul special.

### The bug this flushed out, five times over

A new invariant now asserts that **every transition sits on a tile you can
stand on**. A door keyed to an impassable tile is dead — the player can never
step there, so the door does nothing. It immediately found five:

1. Route 1's **walk back to town** was on the border tree: you could walk into
   Route 1 but not out the way you came.
2. Route 1's **gym gate** was on the border tree as well.
3. Route 2's **gate to Route 1** was on the tree border.
4. Marrow Orchard's **hedge gate** — mine, from the previous slice — was on
   the tree border.
5. The town's **north lane** had nowhere to stand, so the orchard's town gate
   was unreachable.

And one worse: Route 1 carried **two transitions under the same key**
(`"18,5"`), so the second silently replaced the first and the Salt Road gate
simply did not exist. All six are fixed, the trigger-tile invariant is
permanent, and `defines transitions on the expected map edges` was updated to
match the corrected gates.

## A save audit, and the herd it saved (2026-09-15) ✅

A full-journey e2e now walks a session — catch a wild vroomon by racing it,
finish a job, spend the reward on meadow decor — and then reloads twice,
asserting that **nothing** was lost: rancher, map, Herd Book and its
provenance, every tally (overall wild wins, per-biome wild wins, paid jobs),
quest flags, wild packs and their generation, wallet, feed, and the herd.

It immediately caught a bug of my own making, and a bad one: **a finished job
could wipe the herd.** Settling a quest pays the rancher, which writes the run
state — and the boot settled quests as soon as the *world* had loaded. If the
herd had not loaded yet, that write used the renderer's still-empty default
run and saved it over a real herd of 100 animals. The boot now waits for both
the world and the herd before paying anything out.

## Beauty pass 2: the world keeps time and remembers feet (2026-09-15) ✅

- **A day.** `dayTint()` cycles dawn → morning → afternoon → dusk → night over
  **four minutes**, laid over outdoor maps at 3-20% strength (interiors keep
  their own light). Light enough to read through, present enough to notice.
- **Paces.** The ground keeps the last few footsteps: small puffs that bloom
  and fade in about a third of a second behind whoever is walking.
- **Breath.** NPCs bob a single pixel on a per-NPC phase, so a standing
  villager is alive rather than a decal.

### The unit bug this flushed out

Every one of these is driven by the renderer's clock, which is
`performance.now()` — **milliseconds**. The first version of the ambience
layer treated those numbers as frames: the day cycled every **5.4 seconds**,
footsteps vanished in 22ms, NPCs jittered at 22Hz, and motes and ripples
moved ~1000× too fast. It looked *fine in stills*, which is exactly why the
tests now assert **rates**, not just shapes: a day lasts minutes (>120s), a
mote crosses fewer than 30px per second, and the same day-phase holds across
five-second samples.

## The Herd Book keeps notes (2026-09-15) ✅

A sixth hub scene (`📖 Dex`). The Vroomdex used to be a bare list of DNA
strings — a specimen off the ice read exactly like one off the home paddock,
and nothing remembered what it ran. Now every catch and every purchase
records **where it came off, what it ran, and when**:

- `the Canyon Quarry · 1433px · just now` · `BOUGHT`
- `the Shoddy Ranch paddock · 719px · 1h ago` · `CAUGHT`
- and specimens from before the notes existed read honestly as
  `caught before the book kept notes`.

The header reads the collection back: **N specimens from M biomes · best wild
animal runs Xpx**. Notes are pruned with the Herd Book's own 200-entry cap, so
they cannot outlive their specimens, and selling one at Oxide's counter drops
its note with it. `src/renderer/world/specimens.ts` is pure and unit-tested
(recording, pruning, summary, and age in words).

Found while building it: the Trade and Dex panels were styled with colours
meant for a dark panel, but the console cards are **paper** — light ink on
cream, unreadable. Both now use the ledger's own variables.

## Quest contracts: the content is now checked, not trusted (2026-09-15) ✅

Writing jobs is easy; breaking them is easier. `tests/quest-contracts.test.ts`
reads the **shipped maps and catalogs** rather than a fixture and asserts that
every job can actually be played:

- **Some dialogue sets every accept flag** — a quest nobody offers is dead
  content.
- **Every giver is standing on the map their job names.**
- **Chains only reference jobs that exist**, and no chain loops.
- **Every genome a job pays in can actually drive** (a short race on the flat).
- **Every decor a job pays in exists, and is `earnedOnly`** — a reward the
  shop also sells is not a reward.
- Every per-biome objective names a real map, and every errand names ground
  something actually leads to.

It found four real content bugs the moment it ran:

1. **Fitters' Errand was offered by nobody** — the quest existed, the giver
   never did. Fitter Ollan now stands in the town square with the offer (and
   a line explaining the ranch shop).
2. **A giver name didn't match its NPC** ("Oxide, the road trader" vs
   "Oxide"), so the job looked unmatchable.
3. **The Quarry prize was a dud.** `UoZzJLj1FOFC` was a good car when it was
   chosen, but the decoder has changed twice since and it now manages 128px in
   a three-second race. It pays `A9gpwYaIPmdg` (1433px) instead.
4. **The beekeeper's skeps were for sale in the shop**, which defeats paying
   them as a reward. They are `earnedOnly` now, like the range sign.

## Jobs that chain, and a reason to ride out (2026-09-15) ✅

Eleven jobs now, and the far biomes finally have work on them:

- **Chains.** A quest can name a `requires` (the job that must be *paid*
  first). Locked follow-ups stay off the board entirely, and a save from a
  build where the chain didn't exist cannot have accepted one early. Jess's
  muster unlocks *A Name On The Board* (eight wins), and it unlocks the four
  new **biome jobs**.
- **Jobs about a specific ground.** A new objective kind, `win-wild-on`,
  counts wild races won *per biome* (`wildWins:<mapId>`), so *The Salt Road
  Wager* (two on the Stretch), *Thermals And Stone* (two on the Mesa), *A
  Shift In The Quarry* (two in the Quarry) and *The Perimeter Watch* (two on
  the ice) are about beating the wild where it lives — the wild packs you
  seeded per biome now have a reason to matter. Nine wins on the road will
  not count toward any of them, and the tests say so.

Each far-biome job is offered by the host who already lives there (the Wreck
Marshal, the Guru of the Updrafts, the Ringleader, the Frost Baron) through a
new dialogue option, so no new faces were needed to give the late game
something to do.

## Ambient life, and water that moves (2026-09-15) ✅

A still map reads as a picture. `src/renderer/world/ambience-layer.ts` is a
pure function of `(mapId, tick, view)` — no draw-time randomness, so a frame
is reproducible and the whole layer is unit-tested without a canvas — and it
gives each biome its own weather:

| where | what drifts |
|---|---|
| town, ranch yard, Route 1 | pollen motes |
| Marrow Orchard | petals |
| Route 2, Rustler Pasture, Highland Mesa | dust |
| Canyon Quarry | grit |
| Drift Perimeter | snow |
| any interior | dust in the air |

Motes have their own drift vector, wobble and pulse, and wrap around the
window, so the air never thins out. The **pond now moves**: water sits in the
baked tile layer (static by design), so staggered glints are drawn over it
each frame at per-tile phases — a couple of short lines per tile, and the pond
stops being a blue rectangle. Tests cover the weather table, mote determinism
and in-bounds wrapping, and that the ripple phase differs per tile.

## Oxide's trade counter: the herd book pays (2026-09-15) ✅

A fifth Pocket Ranch scene (`🧺 Trade`) where specimens become credits and
credits become blood:

- **Sell** any caught specimen. It is priced by a short race on the flat
  (`sellPrice = score / 4`), so the Herd Book stops being a list you can only
  add to — duplicate wild catches are worth something now.
- **Buy** road stock. The shelf is drawn from the **wild packs in your save**,
  which means it only offers ground you have actually walked, and its stock
  improves as those packs evolve on their own. Buying pays the counter's
  price (`score / 2`, always more than it pays for the same animal) and the
  vroomon arrives **in your herd as well as your Herd Book**, ready to breed
  with.
- **Seed herd** plants a caught specimen straight into the breeding pool.

Nothing here shortcuts breeding: what you buy is a wild animal, you pay over
the odds for it, and it still has to be bred with. Oxide's line in town —
"I move stock up and down this road" — finally has a counter behind it.

### Two more bugs found while building it

- **Seeding a herd never saved.** Pasting a champion DNA and refreshing lost
  it: the run state is its own save and the seed handler never wrote it.
- **Releasing and culling were not counted.** The `release` quest objective
  waited on a tally nothing incremented; both the release button and the
  cull-to-top-ten path now count, so a job can measure them.

## Marrow Orchard: a new area with its own people (2026-09-15) ✅

A new outdoor map hanging off Starter Town's north lane and Route 1's hedge —
an orchard of fence rows, a pond, and wild clover, so it founds **its own
evolving wild pack** the first time you walk the grass (`WILD unmet` until
you do).

Four people live there, each teaching something the game has but never says
out loud:

- **Orchard Keeper Maren** walks you through the **Heritage** page (tap a car
  to trace its line back to the founders) and hands out *A Marrow Cutting* —
  bring her a car that runs 900 on the flat, and she pays in a **Marrow
  scion**, a genome from her own line.
- **Fitter Aubrey** explains what the **inspector** is for: plates for
  structure, wheels joined at their centres, the power path running through
  them.
- **Picker Sprout** races anything that comes up the lane (a training race on
  the usual rider-race path).
- **Beekeeper Hollis** wants the wild thinned off her clover (*Thin The
  Clover* — six genomes, paid in **bee skeps**, an earned-only decor) and
  offers *The Long Pollination*, a walk out to the Drift Perimeter.

New tile: **fence** (posts and two rails, blocking), drawn and exported
through the normal sprite pipeline.

### Two new invariants

- **The map graph is walkable from town.** A test floods the undirected
  transition graph from Starter Town and asserts every area is reachable and
  that no area strands you (every map has at least one exit).
- **Every NPC can be walked to** (added with the ranch split) now covers the
  orchard's four givers automatically.

## Side quests, and the world-save bug they flushed out (2026-09-15) ✅

The world now hands out **jobs**. Five ship today, from three givers:

| Job | Giver | Ask | Pay |
|---|---|---|---|
| The Wrangler's Muster | Wrangler Jess (town) | beat 3 wild vroomon | 120 cr + 3 feed |
| Freight For The Mesa | Wrangler Jess | walk the Highland Mesa | 200 cr |
| Fitters' Errand | Fitter Ollan (town) | 3 pieces in the meadow | 90 cr + a range sign |
| Samples From The Grass | Oxide (route 1) | 4 Herd Book samples | 60 cr + a genome |
| Counting The Road | Oxide | run 5 generations | 140 cr + 4 feed |

`src/renderer/world/side-quests.ts` is pure and unit-tested: a quest is a
declarative objective (`win-wild`, `catch-wild`, `generations`, `decor`,
`visit`, `brands`, `champion-score`, `release`), progress is **derived** from
the world and the run rather than tracked in a dozen places, and accepting one
is a dialogue `setFlag` — the mechanism NPCs already use — so a new job never
needs new dialogue plumbing. Rewards pay out once (recorded in the world's
`tally`, so a save cannot double-pay), are announced with the same banner the
herd uses for a new outlier, and **earned-only decor** (`meadow-sign`) is
filtered out of the ranch shop so the only way to own it is to do the work.

New NPCs: **Wrangler Jess** (market square) and **Oxide** (the road), plus the
world's `tally` — counters for wild races won, maps walked and quests paid —
which ride along in the save.

### The bug this flushed out

Chasing a flaky e2e turned up a **data-loss bug in the world save**. The
debounced save refused to write while `activeNpc || currentEncounter` was set
and — because the debounce had already fired — nothing ever came back for the
change. A wild catch made during the tutorial's praise beat never reached the
file: the HUD showed `1 specimen`, the save showed none, and the loss was
silent. The guard was unnecessary in the first place: `serializeWorldState`
only writes persistent fields, so a queued dialogue is not in the shape at
all. It is gone, with a comment explaining why it must not come back.

## The wild evolves too, with nobody in charge (2026-09-15) ✅

Wild vroomon used to be a random DNA string conjured per step, so once your
own herd was any good, every encounter was a formality and the Herd Book
filled with junk. The wild now **evolves on its own**, the way a ranch herd
does but with nobody steering:

- **Each biome keeps a pack** of 24 vroomon (`src/core/wild.ts`), founded
  deterministically the first time you walk that biome's grass, so the same
  ground always starts with the same animals. Packs live in the save with a
  generation count.
- **The ground is the only selector.** The pack is raced on its own biome's
  terrain — Grassland packs are selected on Grassland, Ice packs on Ice — so
  each biome breeds its own kind of fast.
- **Every meeting turns the pack over a generation.** The fastest half breed,
  four wanderers drift in from elsewhere, and the pack's best are still out
  there (without carrying the champions over, the wild's score *wandered* —
  measured 804, 1143, 1386, then 1153, 1028, 599 — because the pool was
  rebuilt from scratch each generation).
- **You meet a specimen, not the alpha.** The encounter hands you the pack's
  middle animal. Meeting the champion made the wild a wall — and made the
  tutorial's first catch *unwinnable*, since Robby's loaner (~460px) is
  slower than a selected pack's best.

The world HUD carries the biome's pack (`WILD gen 5` / `founder stock` /
`unmet`), so the arms race is visible while you walk rather than only at the
moment of a race.

The race window makes the wild legible: it names the pack's generation, states
what the ground's best can do (`this ground's best runs 479px`), and parks both
machines in their lanes — drawn from the parts their DNA builds — before you
press Race. Esc lets the wild one go, which also breeds its pack on.

Measured on the home paddock: founder stock has a representative at **112px**
and a champion at 479px; after eight generations the representative is at
**858px** and the champion at **1744px**. Robby's loaner (460px) therefore
wins the first catch comfortably and is out-classed by generation three —
which is the point: the wild improves at roughly half the rate of a tended
herd, so *breeding* is how you stay ahead, and a catch is only worth making
when you can beat the ground it came off.

## Indoors and outdoors are separate places (2026-09-15) ✅

The ranch used to be one map with a house drawn in the top-left corner of the
paddock. It is now **two spaces with a door between them**:

- **`home_ranch` — The Shoddy Ranch House.** Walls, wooden floor, bed,
  counters. Robby is in the kitchen.
- **`ranch_yard` — The Ranch Yard.** The tall-grass paddock, the porch, the
  Carrier Bench, and the garden gate to town.

The story crosses that boundary: the reveal beat in the kitchen ends with
Robby swinging the pasture door wide, and a new `goto:<map>:<x>:<y>:<node>`
completion walks you into the yard and picks the lesson back up on the far
side (a dialogue chain cannot span two maps). The town's doorstep now opens
into the yard rather than into the house.

## Hunting is your choice, and catching means racing (2026-09-15) ✅

- **A hunt toggle** in the world HUD (`SEEKING ON 🔍` / `OFF`, or press **H**)
  decides whether the tall grass is dangerous. With it off you can cross your
  own paddock without a race every three steps. Robby puts you on the hunt
  when he hands over the loaner (otherwise the lesson's grass would never
  shake and the tutorial could not continue), and if you switch it off during
  that lesson the quest line says so instead of leaving you pressing Z at
  nothing.
- **Wild vroomon are never free.** Walking the grass opens a **race**: your
  best car (Record Barn champion, else the strongest in the herd) against the
  wild one, on the same terrain, both drawn lane-by-lane as the parts they are
  made of. Win and its genome joins your Herd Book; lose and it gets away, and
  nothing is recorded. The controller no longer records a wild genome at all —
  the race owns that verdict.
- **Robby lends a starter** ("she's slow but she runs") during the yard
  lesson, so the first catch is winnable and everything after it has to be
  *bred* faster than the one before. That is the point of the change: the wild
  can hand you a floor, not a ceiling.

- **New invariant: every NPC can be walked to.** A test floods each map
  from the tiles its entrances land on and asserts every positioned NPC has a
  reachable neighbour — the map split moved a dozen NPCs between two spaces,
  and a walled-off Robby would have been an unrecoverable tutorial.

- **The house is a room, not a corner of a field.** Interior maps render
  against a dark room tone instead of the deep forest (the house used to
  float in woodland), the floor has a bed, counters and a table, and a
  **save made before the split is relocated**: a position out in the old
  paddock belongs to the yard now, so loading it puts you on the porch
  instead of outside the new house's bounds (`safeSpawn`).

Bugs found while wiring this up, all fixed:

- **The herd was not restored on reload.** The world persisted (rancher, map,
  brands, Herd Book) but the animals did not — a refresh lost your herd, and
  Robby's loaner with it. The boot now restores the saved run silently, keeps
  the welcome status, ignores partial saves (a missing `config` used to throw
  during boot), and lands on the title screen rather than the bench.
- **The ranch quest never advanced.** `quest.ts` waited on a `tut-revealed`
  flag that nothing ever set, and the tall grass set `tut-catch` while the
  quest and renderer both read `tut-caught` — so the objective line sat on
  "Robby's in the kitchen" forever. One flag name each now, set at the beats
  that earn them, with a test walking the whole tutorial.
- **Both gym doors dropped you inside a tree** (the exits pointed at the
  route's border tile). A new test checks that every transition in every map
  lands on something you can stand on.
- The `goto` beat dropped its `setFlag`, the HUD's map chip went stale on a
  transition, the toggle repainted the state but not the chip, and closing the
  race didn't repaint the world underneath (a won race queued Robby's praise
  beat that never appeared).
- The Barn button's tutorial pulse was keyed to the house alone, so it never
  pulsed during the praise beat — which happens out in the yard now.

## Breeding was not actually working (2026-09-15) ✅

Found by measuring the loop the game is built on, and it was badly broken.

**Symptom.** Over 25 generations of 60 cars the herd's best score was
**1834, every single generation** — and 25 *fresh random populations* reached
**2363**. The simulator was worse than rolling dice, and "finding the right
combination" was impossible because nothing accumulated.

Three separate causes, each measured rather than guessed:

1. **Mutation was not local.** The decoder mixes a part's parameters from a
   window of neighbouring DNA positions, and the window was wide enough that
   a one-character mutation changed 9-13 of 13 parameters: children were
   unrelated to their parents, so selection had nothing to climb. Narrowing
   it (4 → 1) is the difference between breeding and rolling dice.
2. **Half the genome was inert.** A module read positions `index ± window`
   with a stride of 1, but the module count is decoded from the DNA and stays
   small (2-6) — so on a 12- or 20-character genome, characters past the
   early slots were **never read**. Mutating them changed nothing and a
   crossover cut in that region produced an exact clone of a parent. The
   stride now spans the whole genome, and a test asserts that flipping *any*
   character changes the car.
3. **A car's score depended on its slot in the race.** The population was
   scored by racing all 45 cars in ONE shared world, spawning car *i* at
   `220 + i*150` — so the same DNA parked next to different obstacles scored
   differently from one generation to the next. That noise went straight into
   selection, which is why the herd's best oscillated instead of climbing and
   a champion could appear to regress without its DNA changing. Every car is
   now raced alone, at the same spot.

**Measured after the fixes** (`tests/evolution.test.ts`, which exists to keep
it true): a herd climbs `757 → 2570` over 18 generations, and breeding beats
an equal-budget random control **2195 vs 1544** on average across seeds. The
elite is preserved every generation (verified by tracking champion ids).

Also fixed on the way: the decode clamps for plate width/height, wheel radius
and friction now sit inside the bounds the Godot design declares (friction
could previously reach 2.4 and radius 42, past the design's 2.0 and 40), and
the auto-run's plateau tolerance went from 6 to 15 dry generations — one
measured seed improved nothing for 8 generations and then found a 25% better
car, which the old limit gave up before reaching.

## The vroomon inspector (2026-09-15) ✅

A window for one vroomon, opened with 🔍 Inspect from the herd book, the
paddock, or a line in the heritage tree (Esc closes it):

- **The car, drawn large** — plates and wheels as the simulation builds them,
  so you can see the chain rather than guess at it.
- **Stats**: structure, power path, driven wheels, power and torque at the
  wheels, mass, what the frame costs (tilt, dragging hull), the share of the
  drive that reaches the ground, top speed, length.
- **Parts, slot by slot**: every index with its structure (plate 41×29 @ +6°,
  wheel r17), its powertrain module (cylinder/driveshaft/gearset) and the
  power that wheel actually receives.
- **Five tracks** — Flat, Grassland, Hills, Rocky, Ice — each runs the real
  simulation for a three-second race and reports `flies / competitive /
  crawls / sits there / runs backwards` with the distance and top speed. The
  run then **plays back** (▶ Run / ⏸ Pause with a scrubber and a clock), so
  you watch it move instead of reading a number.

Opened from a herd-bench selection, a herd-book row, the paddock draft, or a
line in the heritage tree. It draws above the Pocket Ranch hub it is opened
from — it rendered *behind* the hub at first, which looked like the button
doing nothing.

The maths is shared, not duplicated: `src/shared/frame.ts` holds the frame
geometry and its costs, the simulation builds from it, and the inspector
reads from it — so the window cannot describe a different car than the one
that runs.

## Parts meet: no daylight in the frame (2026-09-15) ✅

Two bugs made a vroomon look like a row of loose tiles rather than one welded
frame:

- The chain **spaced parts by their tilt-inflated bounding boxes**, and the
  drawn plate was narrower than that box, so a gap of up to 35px of
  background showed between plates at their centre line. Consecutive parts
  now **overlap by design** (`CHAIN_OVERLAP`), because parts that merely
  touch leave a wedge of daylight between tilted plates.
- The snapshot reported a plate's size as its **bounding box**, so a tilted
  plate drew wider than it is. Plates now remember their true rectangle when
  they are built (measuring the vertices does not work: a chamfered plate has
  a dozen of them).

Verified by reading the pixels: no background remains between the parts of a
vroomon's body.

## The vroomon body: one rigid frame, driven at the wheels (2026-09-15) ✅

Follow-up to the two-path port below. Pinning separate wheel bodies to a
chassis with zero-length joints turned out to be the wrong shape for Matter:
holding a car together with joints every frame meant the solver resolved
small interpenetrations by throwing cars off the ground — measure just how
badly, and 42% of bodies went airborne, one of them 6,600px up, some sank
through the floor, and a few hung in the air instead of landing.

The vehicle is now **one rigid body**: every plate and every wheel is a part
of it, so the chain is literally a chain and nothing can come apart. Drive is
a force applied *at each wheel the power path reaches*, capped by the speed
that wheel's power can hold (more engines = faster; a heavy frame = slower;
a force applied off-centre pitches the car the way real drive does). Wheels
are drawn rolling by distance travelled, since a rigid part doesn't spin.

Fixes along the way, each found by measurement rather than by eye:
- **`Body.create({ parts })` copies the parent's properties onto the parts**,
  so per-part friction is impossible in one body — and Matter's resolver
  reads `parentA.friction` anyway, never the part's. Grippy wheels and draggy
  plates at once can't be expressed in Matter, so the frame's cost is
  modelled explicitly instead (see below).
- **Matter's velocities are per step, not per second.** The drive's terminal
  speed and the speed clamp were both comparing the wrong units, so neither
  limited anything.
- **Obstacles used to start at x=600** while a 12-module car is ~1000px long,
  so long cars spawned *inside* terrain and were fired off the track. The
  first obstacle now sits at 1600 with 500px spacing, and the floor is 400px
  thick so nobody tunnels through it.
- A speed clamp plus a rollback of any step that moves a body further than a
  frame at top speed could, so a bad frame can never become a rocket.

**What the frame costs** (`SIM_TUNING` in `src/simulation/matter-simulation.ts`,
one object so tuning is one edit and can be measured): drive is scaled by
`drivenWheels / wheels` divided by the cost of plates out of line and of a
hull riding below its own wheels. So the design's rules are the physics:
an arch of plates on driven wheels runs; a folded run of plates drags; a
frame with no cylinder before a wheel doesn't move at all.

Measured over random 12-module DNA on Flat, 3-second races (the race window):
**23% are competitive** (>300px), 68% creep somewhere, none launch, and the
best does ~1,200px. Good cars still reach ~4,300px in a 30-second run, so the
circuit's score scale is unchanged.

## The vroomon body: two-path chains (2026-09-14) ✅

Ported the original design out of the legacy Python prototype
(`src/vroomon/car/`), where it had been lost in the rewrite. A vroomon is a
**chain of two parallel paths**:

- **Structure** (`frame`): rectangles and wheels in one chain. The
  rectangles are plates on ONE rigid chassis, joined edge-to-edge along the
  line and each keeping its own tilt — so a run of plates can arch (good
  breakover) or fold at a bad angle and never roll. Wheels are their own
  bodies **pinned by a zero-length joint at their centre**. `wheel wheel
  wheel` has no structure and, now, no drive either.
- **Power** (`powertrain`, same length, paired index by index): cylinders
  make power, drive shafts bleed efficiency, gear sets hand a share to the
  wheel in their own slot and pass the rest on. `wheelDriveForIndex` is a
  faithful port of the prototype's `calculate_wheel_power`, so **order
  matters**: a wheel with no cylinder upstream is dead weight, and most
  combinations simply don't work — as intended.

Fixed while porting (each one had made every car look floppy or crawl):
- every rectangle used to be its own body joined by soft springs (the
  floppiness); the chassis is now one compound body;
- wheels used to hang 50px below on a spring; they're pinned at their
  centres and the hull's real ground clearance is computed from the plate
  tilts (tilted plates drop their corners, so an arch rides high);
- cars spawned at a hardcoded y=220 with the ground at 400 — every race was
  spent free-falling; they now spawn resting on the terrain;
- the drive sign was inverted for Matter's y-DOWN world (the port of
  pymunk's y-up `-power/size` drove every car backwards);
- wheel velocity was teleported per frame, yanking the rigid chassis into
  a 17,000-radian spin; it's a torque-limited motor chase now.

Measured on Flat (30 simulated seconds): well-formed cars travel
**900–2000px** (best two-wheeler found: 1898px, plates-then-wheels with
cylinders early); ~20% of random 12-char DNA moves meaningfully at all, so
there's a real signal to select on. `tests/power-path.test.ts` (7 tests)
pins the power semantics; the DNA regression fixture and the two
drive-integrity tests now use cars that genuinely work.

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