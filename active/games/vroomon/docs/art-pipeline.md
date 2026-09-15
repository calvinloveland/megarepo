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

## Manifest ids

Every sprite has one id in `manifest.json`. To replace art, generate a PNG
with the **same id**, write it to `src/renderer/assets/sprites/<file>`,
keep the manifest entry, and rebuild — the game uses your image.

(Sprite resolution is 96x96 px; tiles look best at 32px-equivalent crisp
pixel art, ~3x scaled.)

| Prefix | Meaning | Examples |
| --- | --- | --- |
| `tile:<kind>` | Assembled ground/object tile (what the game draws) | `tile:grass`, `tile:bed` |
| `tilebase:<kind>` | Ground layer 1: fill, corner shade, pattern | `tilebase:path` |
| `tiledetail:<kind>` | Ground layer 2: accents, animation, furniture | `tiledetail:vroomgrass` |
| `wallbase:<kind>` | Wall layer 1: mortar fill | `wallbase:wall` |
| `wallbrick:<kind>` | Wall layer 2: brick courses | `wallbrick:building` |
| `walltrim:<kind>` | Wall layer 3: coping + skirting | `walltrim:tree-trunk` |
| `head:<id>` | NPC head component (skin + face) | `head:light`, `head:mid` |
| `outfit:<id>` | NPC torso component (trades) | `outfit:labcoat`, `outfit:rider` |
| `accessory:<id>` | NPC accessory component | `accessory:stetson`, `accessory:beanie-wrench` |
| `npc:<npc-id>` | Assembled NPC (head + outfit + accessory) | `npc:professor-axle`, `npc:meadow-elder` |
| `player:<facing>` | The rancher, per facing | `player:down`, `player:left` |

## Swapping art

- **Per-layer**: replace `tilebase:grass` alone and the grass base changes
  under the unchanged detail layer; replace `accessory:stetson` and every
  stetson-wearing host updates.
- **Wholesale**: replace `npc:<id>` (or `tile:<kind>`) and the whole
  character/tile changes; the fallback code drawing is only used when the
  PNG is missing.
- Keep the same resolution for seamless seams; walls brick-course at
  ~12px rows, ground pattern repeats per tile.

## Palette anchors

The component palettes are defined in
`electron/src/renderer/world/sprites-palette.ts`. Known anchors:

- Grounds: grass `#7eb34b`, vroomgrass `#5fa343`, path `#c2a673`,
  indoor-floor `#b89a6b`, doormat `#a86b3a`, water `#4a78c2`.
- Walls: mortar `#3a2416` / brick `#6a4630` (wall), `#c9b48a` (building),
  `#4a2f18` (tree-trunk), coping trim `#8a6a4a`.
- Accents: house accents in `HOUSE_ACCENTS` (greensprouts `#6fb44d`,
  redlines `#cf3a3a`, saltcaravan `#c2a670`, skimmers `#9ad0e8`, …).
- The stetson band and player cap use the host/faction accent — keep
  those bands colored if you swap that accessory.

## Generating with AI

No image-gen model/API is installed on the dev host. To generate a full
replacement set: run any image generator (local model, or an API key in
`.secrets/` per the repo's secret rules) at 96x96 px with a prompt such as
*"pixel-art ranch NPC bust, 32px-equivalent, [role] with a [hat/glasses],
flat matte palette, dark outline"*, name the file by manifest id, and
rebuild. Layer swaps tend to look better than wholesale swaps because the
game's light and outline conventions stay consistent.