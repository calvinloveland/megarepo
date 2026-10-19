# Vroomon art pipeline

The game has no baked-in art: every sprite is drawn in code and exported to
real PNG files at built time. The files live under
`electron/src/renderer/assets/sprites/` (copied into `dist/renderer/assets/`
by the build), and the runtime **prefers the PNG files over the code
drawing**, with the code drawing as automatic fallback when a file is
missing.

Regenerate everything after changing any drawing code:

```bash
cd electron
npm run export:sprites        # Chrome needed: VROOMON_BROWSER_EXECUTABLE on NixOS
```

The export script builds (which copies `assets/` into `dist/`), renders every
sprite, and then copies static again — the second copy matters: without it the
freshly written PNGs never reach the served `dist/`, and the game keeps showing
the previous art until some unrelated build happens to run.
`tests/game/sprite-export.test.ts` hashes the drawing sources against a stamp
the exporter writes, so a stale export fails the suite instead of shipping.

## The grid

All art is authored on a **16-column grid** and scaled by `size / 16`, so a
32px tile is exactly 2 screen pixels per art pixel, a 96px tile export is 6,
and a 1.5-tile-tall person is 96×144. Nothing lands on a half pixel at either
scale, which is what keeps the canvas crisp when the window scales it.

- Ground tiles fill edge to edge with no border; all texture is interior. Per
  cell variety (`drawGroundScatter` in `sprites.ts`) is hashed from the tile
  coordinate at bake time, on top of whichever layer drew the tile — that is
  what stops a field of one PNG from looking like wallpaper.
- Walls are context-aware: the coping is drawn only where a wall has no wall
  above it, and a floor below a wall takes a contact shadow. Both happen in
  the baked tile layer (`overworld-renderer.ts`), not in the tile image,
  because a single tile cannot know what is beside it.
- People are 16×24 character grids in `sprite-art.ts`, drawn
  at 1.5 tiles tall and anchored to the tile's floor. Head, outfit and
  accessory each own a fixed row band so any combination composes to the same
  height.

## Manifest ids

Every sprite has one id in `manifest.json`. To replace art, generate a PNG
with the **same id**, write it to `src/renderer/assets/sprites/<file>`,
keep the manifest entry, and rebuild — the game uses your image.

(Tiles are 96×96 px and people are 96×144 px — 6 screen pixels per art pixel,
and both are drawn at 32px tiles in game.)

| Prefix | Meaning | Examples |
| --- | --- | --- |
| `tile:<kind>` | Assembled ground/object tile (what the game draws) | `tile:grass`, `tile:bed` |
| `tilebase:<kind>` | Ground layer 1: fill, corner shade, pattern | `tilebase:path` |
| `tiledetail:<kind>` | Ground layer 2: accents, animation, furniture | `tiledetail:vroomgrass` |
| `wallbase:<kind>` | Wall layer 1: mortar fill | `wallbase:wall` |
| `wallbrick:<kind>` | Wall layer 2: brick courses | `wallbrick:building` |
| `walltrim:<kind>` | Wall layer 3: coping (drawn by the bake on the top edge of a wall run) | `walltrim:tree-trunk` |
| `head:<id>` | NPC head component (skin + face) | `head:light`, `head:mid` |
| `outfit:<id>` | NPC torso component (trades) | `outfit:labcoat`, `outfit:rider` |
| `accessory:<id>` | NPC accessory component | `accessory:stetson`, `accessory:beanie-wrench` |
| `npc:<npc-id>` | Assembled NPC (head + outfit + accessory) | `npc:professor-axle`, `npc:meadow-elder` |
| `player:<facing>:<frame>` | The rancher, two walk frames per facing | `player:down:0`, `player:left:1` |

## Swapping art

- **Per-layer**: replace `tilebase:grass` alone and the grass base changes
  under the unchanged detail layer; replace `accessory:stetson` and every
  stetson-wearing host updates.
- **Wholesale**: replace `npc:<id>` (or `tile:<kind>`) and the whole
  character/tile changes; the fallback code drawing is only used when the
  PNG is missing.
- Keep the same resolution for seamless seams; wall bricks course on a 4-cell
  pitch (24px at the 96px export), and ground pattern repeats per tile.
- Characters: keep the 16-cell grid and the layer bands (head rows 2–12,
  outfit 13–23, accessory as authored). `tests/game/sprite-art.test.ts` checks
  the tables, not your replacement PNGs, so a hand-drawn swap only has to match
  the cell size.

## Palette anchors

The component palettes are defined in
`electron/src/renderer/world/sprites-palette.ts`. Known anchors:

- Grounds (base tone; each has a four-step ramp in `RAMPS`):
  grass `#6da53f`, vroomgrass `#4c8a34`, path `#c8ab77`,
  indoor-floor `#a9855a`, doormat `#9c6234`, water `#2e6ca6`, tree `#2f6b3a`.
- Walls: mortar `#33210f` / brick `#5a3d27` (wall), `#cbb488` (building),
  `#4a2f18` (tree-trunk), coping `#a37c52`.
- People: skin `#f2c79a` (shade `#d9a878`), hair `#4a3222`, keyline `#1b1109`
  — a warm near-black, never pure black.
- Accents: house accents in `HOUSE_ACCENTS` (greensprouts `#6fb44d`,
  redlines `#cf3a3a`, saltcaravan `#c2a670`, skimmers `#9ad0e8`, …).
- The stetson band and player cap use the host/faction accent — keep
  those bands colored if you swap that accessory.

## Generating with AI

No image-gen model/API is installed on the dev host. To generate a full
replacement set: run any image generator (local model, or an API key in
`.secrets/` per the repo's secret rules) at 96×96 px for a tile (96×144 for a person) with a prompt such as
*"pixel-art ranch NPC bust, 32px-equivalent, [role] with a [hat/glasses],
flat matte palette, dark outline"*, name the file by manifest id, and
rebuild. Layer swaps tend to look better than wholesale swaps because the
game's light and outline conventions stay consistent.