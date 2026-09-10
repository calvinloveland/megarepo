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

## Outstanding gameplay/UI issues (identified, not yet fixed — design work)

From the vision-model critique + probes, ordered by impact:

- **MENU mode has no menu** — no title/logo/Play/Continue; `viewport-overlay--menu`
  CSS exists but no markup; menu just shows the sample preview.
- **Race vehicle labels unreadable at high density** — all clamped to the same
  `y`, 22px over a 20px baseline gap, stacked into a "wall of text" when >5
  vehicles race; the "px" readouts overlap bodies. Suggest labels only for
  leader/selected + collision avoidance, or leader lines.
- **No player-facing stats HUD** — wallet/credits, pending generation info,
  badges, Vroomdex, map name, score chart all live in the hidden
  `display:none` stub container in game.html (the desktop shell shows more).
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