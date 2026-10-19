import { getMap, isTilePassable } from "./maps.js";
import {
  drawBuildingEaves,
  drawGroundScatter,
  drawGroundTransition,
  drawNpc,
  drawTallProp,
  drawPlayer,
  drawTile,
  drawWallShadow,
  drawWallTrim,
  PERSON_HEIGHT_TILES,
  TALL_PROP_TILES,
} from "./sprites.js";
import {
  PLAYER_MOVE_DURATION_MS,
  TILE_SIZE,
  type Direction,
  type NpcDefinition,
  type TileKind,
  type Tilemap,
  type WorldState,
} from "./types.js";
import { findDecor } from "./decor.js";
import { HOUSE_ACCENTS, houseAccentForNpc, SPRITE_PALETTE as PAL } from "./sprites-palette.js";
import { FACTIONS } from "./factions.js";
import {
  ambientMotes,
  dayPhase,
  dayTint,
  footstepPuffs,
  lampGlow,
  waterPhase,
  windowLight,
  type Track,
} from "./ambience-layer.js";
import { npcPositionAt } from "./routines.js";

export interface OverworldRenderFrame {
  map: Tilemap;
  tick: number;
  world: WorldState;
  /** Recent paces (tile + tick), for the dust behind the rancher. */
  puffs?: { tracks: Track[] };
  /** Owned cosmetic decor ids (lives in renderer state, not world state). */
  decor: string[];
  /** Loaded sprite PNGs keyed by id (tile:<kind>, npc:<id>, player:<facing>).
   * When an image exists it wins over the code-drawn fallback. */
  spriteAssets?: Map<string, HTMLImageElement>;
}

// ---- Static tile-layer bake ----
/** Tiles that are drawn as a standing surface: walls, house fronts and the
 * tree border. They take the coping and cast the contact shadow. */
const SOLID_FACE_TILES = new Set<TileKind>(["wall", "building", "tree-trunk", "tree"]);

// One offscreen canvas per map (invalidated when the map or the sprite
// assets change): the tile layer is drawn once, then blitted per frame.

/**
 * The bake is padded by this many tiles on every side, each one a clamped copy
 * of the nearest tile inside the map. That is what makes the world continue
 * past the map's edge instead of stopping at a bright rectangle laid on a dark
 * rug: a treeline keeps being trees, a road keeps being a road, and the camera
 * never reaches the pad's own edge (it is clamped to the map).
 */
const LAYER_PAD = 14;

let bakedLayer: { key: string; canvas: HTMLCanvasElement } | null = null;

function bakedTileLayer(
  map: Tilemap,
  spriteAssets?: Map<string, HTMLImageElement>,
): HTMLCanvasElement {
  const usingAssets = Boolean(spriteAssets && spriteAssets.size > 0);
  const key = `${map.id}|${usingAssets ? "png" : "code"}|${map.width}x${map.height}`;
  if (bakedLayer && bakedLayer.key === key) {
    return bakedLayer.canvas;
  }
  const cols = map.width + LAYER_PAD * 2;
  const rows = map.height + LAYER_PAD * 2;
  const layer = document.createElement("canvas");
  layer.width = cols * TILE_SIZE;
  layer.height = rows * TILE_SIZE;
  const lctx = layer.getContext("2d");
  if (!lctx) {
    return layer;
  }
  lctx.fillStyle = map.ambientColor;
  lctx.fillRect(0, 0, layer.width, layer.height);

  // Clamped access: any coordinate outside the map reads the nearest tile in
  // it, which is what extends the edge outward. Props on the edge (a doormat at
  // a town gate, a counter against a wall) are looked *past* — extending one
  // outward paved the forest with stone slabs. The ground behind it is the
  // honest continuation.
  const FEATURE_TILES = new Set<TileKind>([
    "doormat",
    "door",
    "counter",
    "bed",
    "fence",
    "rock",
  ]);
  const rawTileAt = (x: number, y: number): TileKind => {
    const cx = Math.max(0, Math.min(map.width - 1, x));
    const cy = Math.max(0, Math.min(map.height - 1, y));
    return map.tiles[cy]?.[cx] ?? "grass";
  };
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < map.width && y < map.height;
  const tileAt = (x: number, y: number): TileKind => {
    const tile = rawTileAt(x, y);
    // Inside the map every tile is itself, props included. The substitution is
    // only for the padded apron outside it.
    if (inside(x, y) || !FEATURE_TILES.has(tile)) {
      return tile;
    }
    // Step from the clamped point toward the map's inside and take the first
    // tile that is terrain.
    const cx = Math.max(0, Math.min(map.width - 1, x));
    const cy = Math.max(0, Math.min(map.height - 1, y));
    const inX = x < 0 ? 1 : x >= map.width ? -1 : 0;
    const inY = y < 0 ? 1 : y >= map.height ? -1 : 0;
    const dx = inX !== 0 ? inX : cx < map.width - 1 ? 1 : -1;
    const dy = inY !== 0 ? inY : cy < map.height - 1 ? 1 : -1;
    for (let step = 1; step <= 4; step += 1) {
      const candidate = map.tiles[cy + dy * step]?.[cx + dx * step];
      if (candidate && !FEATURE_TILES.has(candidate)) {
        return candidate;
      }
    }
    return "grass";
  };
  const isWallAt = (x: number, y: number): boolean =>
    SOLID_FACE_TILES.has(tileAt(x, y));
  const gx = (x: number): number => (x + LAYER_PAD) * TILE_SIZE;
  const outsideDepth = (x: number, y: number): number =>
    Math.max(0, -x, x - (map.width - 1), -y, y - (map.height - 1));

  for (let y = -LAYER_PAD; y < map.height + LAYER_PAD; y += 1) {
    for (let x = -LAYER_PAD; x < map.width + LAYER_PAD; x += 1) {
      const tile = tileAt(x, y);
      const px = gx(x);
      const py = gx(y);
      // A room is not a field: beyond its walls is darkness, not more wall.
      // One tile of half-lit wall reads as the building's thickness, and then
      // the bake simply stops — the renderer's near-black base shows through.
      const depth = outsideDepth(x, y);
      if (map.interior) {
        if (depth > 1) {
          continue;
        }
        lctx.globalAlpha = depth === 0 ? 1 : 0.45;
      }
      const tileAsset = spriteAssets?.get(`tile:${tile}`);
      if (tileAsset) {
        lctx.drawImage(tileAsset, px, py, TILE_SIZE, TILE_SIZE);
      } else {
        drawTile(lctx, tile, px, py, TILE_SIZE, 0, x, y);
      }
      // Per-cell scatter goes on top of whichever layer drew the tile, so a
      // field of identical PNG grass still varies cell by cell instead of
      // repeating like wallpaper.
      drawGroundScatter(lctx, tile, px, py, TILE_SIZE, x, y);
      lctx.globalAlpha = 1;
    }
  }

  // Walls are context: a lit coping belongs on the top edge of a run (not on
  // every tile in it, which reads as shelving), and the ground below a wall
  // takes its contact shadow. Both are drawn here rather than in the tile art
  // because a single tile image cannot know what is beside it.
  for (let y = -LAYER_PAD; y < map.height + LAYER_PAD; y += 1) {
    for (let x = -LAYER_PAD; x < map.width + LAYER_PAD; x += 1) {
      if (map.interior && outsideDepth(x, y) > 1) {
        continue;
      }
      const tile = tileAt(x, y);
      const px = gx(x);
      const py = gx(y);
      if (!SOLID_FACE_TILES.has(tile)) {
        if (TALL_PROP_TILES.has(tile)) {
          drawTallProp(lctx, tile, px, py, TILE_SIZE, {
            west: tileAt(x - 1, y) === tile,
            east: tileAt(x + 1, y) === tile,
          });
          continue;
        }
        const shadowDepth = isWallAt(x, y - 1) ? TILE_SIZE * 0.34 : 0;
        drawWallShadow(lctx, px, py, TILE_SIZE, shadowDepth);
        drawGroundTransition(lctx, tile, tileAt(x, y - 1), "north", px, py, TILE_SIZE, x, y);
        drawGroundTransition(lctx, tile, tileAt(x, y + 1), "south", px, py, TILE_SIZE, x, y);
        drawGroundTransition(lctx, tile, tileAt(x - 1, y), "west", px, py, TILE_SIZE, x, y);
        drawGroundTransition(lctx, tile, tileAt(x + 1, y), "east", px, py, TILE_SIZE, x, y);
        continue;
      }
      // A treeline has no coping (a light edge on a canopy reads as a UI line)
      // and a house gets eaves instead, so a row of building tiles reads as a
      // front with a roof rather than as a row of crates. The test is against
      // the SAME surface: a tree above a house is not the house's roof line,
      // which is what a plain "is anything above" check got wrong.
      const sameAbove = tileAt(x, y - 1) === tile;
      if (!sameAbove) {
        if (tile === "building") {
          drawBuildingEaves(lctx, px, py, TILE_SIZE);
        } else if (tile !== "tree") {
          drawWallTrim(lctx, tile, px, py, TILE_SIZE);
        }
      }
    }
  }
  bakedLayer = { key, canvas: layer };
  return layer;
}

// (There was an `invalidateBakedTileLayer` here, referenced exactly once - by
// its own definition. The baked layer's key already covers every case that
// matters: map id, whether the tiles came from PNGs or from the drawing code,
// and the map's size. Removed rather than kept as an unused escape hatch.)

/** Water tiles per map, scanned once (the renderer draws ripples over them). */
let waterLayer: { key: string; tiles: Array<{ x: number; y: number }> } | null = null;

/** Building and door tiles: the windows that light up after dark. */
let windowLayer: { key: string; tiles: Array<{ x: number; y: number }> } | null = null;

function windowTiles(map: Tilemap): Array<{ x: number; y: number }> {
  const key = `${map.id}:${map.width}x${map.height}:${map.tiles.length}`;
  if (windowLayer && windowLayer.key === key) {
    return windowLayer.tiles;
  }
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = map.tiles[y]?.[x];
      if (tile === "building" || tile === "door") {
        tiles.push({ x, y });
      }
    }
  }
  windowLayer = { key, tiles };
  return tiles;
}

function waterTiles(map: Tilemap): Array<{ x: number; y: number }> {
  const key = `${map.id}:${map.width}x${map.height}:${map.tiles.length}`;
  if (waterLayer && waterLayer.key === key) {
    return waterLayer.tiles;
  }
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.tiles[y]?.[x] === "water") {
        tiles.push({ x, y });
      }
    }
  }
  waterLayer = { key, tiles };
  return tiles;
}

export function renderOverworld(
  canvas: HTMLCanvasElement,
  frame: OverworldRenderFrame,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const { map, tick, world, decor } = frame;
  const puffsRef = frame.puffs;
  const width = canvas.width;
  const height = canvas.height;

  const cameraX = computeCameraX(world, map, width);
  const cameraY = computeCameraY(world, map, height);

  // The bake is padded, so the world simply continues past the map's edge.
  // Only the far corners of a room (or the deep forest) need a base fill.
  ctx.fillStyle = map.interior ? "#120c07" : "#101a0c";
  ctx.fillRect(0, 0, width, height);

  // The static tile layer is BAKED once per map into an offscreen canvas
  // and blitted in a single draw call per frame. Drawing ~200 tiles every
  // frame was the biggest per-frame cost in the overworld; the bake keeps
  // tiles (and their PNG assets) as load-once art.
  const baked = bakedTileLayer(map, frame.spriteAssets);
  ctx.drawImage(
    baked,
    -cameraX - LAYER_PAD * TILE_SIZE,
    -cameraY - LAYER_PAD * TILE_SIZE,
  );

  // Water moves. The pond sits in the baked layer (static), so the ripples
  // are drawn over it each frame — a couple of lines per tile is cheap and
  // it stops the pond reading as a blue rectangle.
  for (const water of waterTiles(map)) {
    const wx = water.x * TILE_SIZE - cameraX;
    const wy = water.y * TILE_SIZE - cameraY;
    if (wx < -TILE_SIZE || wy < -TILE_SIZE || wx > width || wy > height) {
      continue;
    }
    const phase = waterPhase(tick, water.x, water.y);
    ctx.strokeStyle = "rgba(226, 242, 255, 0.22)";
    ctx.lineWidth = 1;
    // Two short glints per tile, staggered by the tile's own row so a pond
    // reads as water rather than a set of stripes.
    for (let line = 0; line < 2; line += 1) {
      const drift = (Math.sin(phase + line * 2.1) + 1) / 2;
      const ly = wy + 7 + line * 11 + ((water.y * 5 + water.x * 3 + line * 4) % 6);
      const length = TILE_SIZE * (0.34 + drift * 0.3);
      const lx = wx + 3 + drift * (TILE_SIZE - 6 - length);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + length, ly);
      ctx.stroke();
    }
  }

  // The ground remembers a few paces.
  if (puffsRef) {
    const puffs = footstepPuffs(puffsRef.tracks, tick, { lifeMs: 320, count: 5 });
    for (const puff of puffs) {
      ctx.globalAlpha = puff.alpha;
      ctx.fillStyle = "#e7d8b4";
      ctx.beginPath();
      ctx.ellipse(puff.x - cameraX, puff.y - cameraY, puff.radius, puff.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Ambient life over the ground (and behind whatever is standing on it).
  const view = {
    minX: cameraX,
    minY: cameraY,
    width,
    height,
  };
  for (const mote of ambientMotes(map.id, tick, view, map.interior ? 10 : 18, Boolean(map.interior))) {
    ctx.globalAlpha = mote.alpha;
    ctx.fillStyle =
      mote.kind === "snow"
        ? "#f4fbff"
        : mote.kind === "petal"
          ? "#ffd9e6"
          : mote.kind === "grit"
            ? "#cbb9a4"
            : mote.kind === "dust"
              ? "#e8d9b8"
              : "#fff3c4";
    if (mote.kind === "snow" || mote.kind === "petal") {
      ctx.beginPath();
      ctx.arc(mote.x - cameraX, mote.y - cameraY, mote.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(mote.x - cameraX, mote.y - cameraY, mote.size, mote.size);
    }
  }
  ctx.globalAlpha = 1;

  // Lit windows: buildings look occupied once it is dark.
  const lit = windowLight(tick);
  if (lit > 0.01) {
    for (const window of windowTiles(map)) {
      const wx = window.x * TILE_SIZE - cameraX;
      const wy = window.y * TILE_SIZE - cameraY;
      if (wx < -TILE_SIZE || wy < -TILE_SIZE || wx > width || wy > height) {
        continue;
      }
      ctx.globalAlpha = lit * 0.75;
      ctx.fillStyle = "#ffd98a";
      ctx.fillRect(wx + TILE_SIZE * 0.28, wy + TILE_SIZE * 0.3, TILE_SIZE * 0.44, TILE_SIZE * 0.34);
      ctx.globalAlpha = 1;
    }
  }

  // Indoors: a warm pool of lamplight where the room's centre is.
  if (map.interior) {
    const glow = lampGlow(tick, map);
    const gradient = ctx.createRadialGradient(
      glow.x - cameraX,
      glow.y - cameraY,
      8,
      glow.x - cameraX,
      glow.y - cameraY,
      glow.radius,
    );
    gradient.addColorStop(0, `rgba(255, 226, 160, ${glow.intensity})`);
    gradient.addColorStop(1, "rgba(255, 214, 130, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // Time of day: a light wash over everything outside. Interiors keep their
  // own light, so no tint indoors.
  if (!map.interior) {
    const tint = dayTint(tick);
    ctx.globalAlpha = tint.alpha;
    ctx.fillStyle = tint.color;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  // Festive pennant garlands across the feud arenas: the joined house's
  // colors on the home half, the rival's on the far half, neutral gold
  // before any house is chosen.
  const ARENA_BIOME: Record<string, string> = {
    gym_1: "grassland",
    gym_2: "sand",
    hills_map: "hills",
    rocky_map: "rocky",
    ice_map: "ice",
  };
  const arenaBiome = ARENA_BIOME[map.id];
  if (arenaBiome) {
    drawArenaGarlands(ctx, map, cameraX, cameraY, arenaBiome, world, tick);
  }

  // Cosmetic meadow decor (drawn under NPCs and the player). Each item has
  // a Starter Town anchor plus optional per-biome spots; glyphs are drawn at
  // ~2x tile size with a soft shadow so they read as scenery, not pixels.
  for (const decorId of decor) {
    const item = findDecor(decorId);
    if (!item) {
      continue;
    }
    const spot = item.spots?.[map.id] ?? item.anchor;
    if (spot.x < 0 || spot.x >= map.width || spot.y < 0 || spot.y >= map.height) {
      continue;
    }
    const px = spot.x * TILE_SIZE - cameraX;
    const py = spot.y * TILE_SIZE - cameraY;
    const half = TILE_SIZE;
    if (px < -half || px > width + half || py < -half || py > height + half) {
      continue;
    }
    const cx = px + TILE_SIZE / 2;
    const baseY = py + TILE_SIZE - 4;
    // Grounding shadow.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, baseY, TILE_SIZE * 0.42, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // The pretty thing itself, scaled up.
    const glyphSize = Math.round(TILE_SIZE * 1.7);
    ctx.font = `${glyphSize}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.emoji, cx, baseY - glyphSize * 0.38);
  }

  const sortedEntities: Array<{ y: number; draw: (px: number) => void }> = [];
  const clockPhase = dayPhase(tick);
  for (const npc of map.npcs) {
    // People with a routine are wherever the day has put them.
    const spot = npcPositionAt(npc, clockPhase);
    // Off shift (a night watch at noon), or a dialogue-only stub sitting on an
    // impassable tile: skip, so no ghost sprites render.
    if (!spot || !isTilePassable(map.tiles[spot.y]?.[spot.x] ?? "grass")) {
      continue;
    }
    sortedEntities.push({
      y: spot.y,
      draw: (px) => {
        const npcPx = spot.x * TILE_SIZE - cameraX;
        const npcPy = spot.y * TILE_SIZE - cameraY;
        if (
          npcPx < -TILE_SIZE ||
          npcPx > width ||
          npcPy < -TILE_SIZE ||
          npcPy > height
        ) {
          return;
        }
        drawPersonShadow(ctx, npcPx, npcPy);
        const npcAsset = frame.spriteAssets?.get(`npc:${npc.id}`);
        if (npcAsset) {
          drawPersonAsset(ctx, npcAsset, npcPx, npcPy);
        } else {
          drawNpc(ctx, npc.sprite, npcPx, npcPy, TILE_SIZE, npc.facing, tick, npc.id);
        }
        // Names belong to the conversation, not to the map: a field of
        // floating pill labels reads as a debug view. Only the person within
        // talking distance is announced.
        if (withinTalkRange(world, spot)) {
          drawTalkPrompt(ctx, npcPx, npcPy, tick);
        }
        void px;
      },
    });
  }
  sortedEntities.push({
    y: world.playerY,
    draw: (px) => {
      const drawX =
        world.movementTarget && world.isMoving
          ? interpolate(
              world.playerX,
              world.movementTarget.x,
              easeOutCubic(currentMoveProgress(tick)),
            )
          : world.playerX;
      const drawY =
        world.movementTarget && world.isMoving
          ? interpolate(
              world.playerY,
              world.movementTarget.y,
              easeOutCubic(currentMoveProgress(tick)),
            )
          : world.playerY;
      const playerPx = drawX * TILE_SIZE - cameraX;
      const playerPy = drawY * TILE_SIZE - cameraY;
      const CAP_HEX: Record<string, string> = {
        navy: PAL.cap.navy,
        rust: PAL.cap.red,
        green: PAL.cap.green,
      };
      // Two-frame stride: the asset exporter writes both frames, so the
      // PNG path animates exactly like the drawn fallback.
      const strideFrame = Math.sin(tick / 90) > 0 ? 1 : 0;
      drawPersonShadow(ctx, playerPx, playerPy);
      const playerAsset =
        frame.spriteAssets?.get(`player:${world.playerFacing}:${strideFrame}`) ??
        frame.spriteAssets?.get(`player:${world.playerFacing}`);
      if (playerAsset) {
        drawPersonAsset(ctx, playerAsset, playerPx, playerPy);
      } else {
        drawPlayer(
          ctx,
          playerPx,
          playerPy,
          TILE_SIZE,
          world.playerFacing,
          tick,
          CAP_HEX[world.rancherCap] ?? PAL.cap.navy,
        );
      }
      void px;
    },
  });
  sortedEntities.sort((left, right) => left.y - right.y);
  for (const entity of sortedEntities) {
    entity.draw(0);
  }

  // Atmosphere: the room or the map keeps a soft edge. Without it a small
  // interior floats in a flat void; with it the same void reads as unlit
  // space beyond the lamplight.
  drawFrameVignette(ctx, width, height, Boolean(map.interior));
}

function computeCameraX(world: WorldState, map: Tilemap, width: number): number {
  const playerX = world.movementTarget && world.isMoving
    ? interpolate(
        world.playerX,
        world.movementTarget.x,
        easeOutCubic(currentMoveProgress(performance.now())),
      )
    : world.playerX;
  const mapWidthPx = map.width * TILE_SIZE;
  const desired = playerX * TILE_SIZE - width / 2 + TILE_SIZE / 2;
  if (mapWidthPx <= width) {
    return (mapWidthPx - width) / 2;
  }
  return Math.max(0, Math.min(mapWidthPx - width, desired));
}

function computeCameraY(world: WorldState, map: Tilemap, height: number): number {
  const playerY = world.movementTarget && world.isMoving
    ? interpolate(
        world.playerY,
        world.movementTarget.y,
        easeOutCubic(currentMoveProgress(performance.now())),
      )
    : world.playerY;
  const mapHeightPx = map.height * TILE_SIZE;
  const desired = playerY * TILE_SIZE - height / 2 + TILE_SIZE / 2;
  if (mapHeightPx <= height) {
    return (mapHeightPx - height) / 2;
  }
  return Math.max(0, Math.min(mapHeightPx - height, desired));
}

let lastMoveStartedAt = 0;

export function startMoveAnimation(): void {
  lastMoveStartedAt = performance.now();
}

function currentMoveProgress(tick: number): number {
  return Math.min(1, (tick - lastMoveStartedAt) / PLAYER_MOVE_DURATION_MS);
}

function interpolate(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function attemptMove(
  world: WorldState,
  direction: Direction,
  timeMs: number = Date.now(),
): { state: WorldState; transitionKey: string | null } {
  if (world.isMoving || world.activeNpc) {
    return { state: world, transitionKey: null };
  }

  const map = getMap(world.currentMapId);
  if (!map) {
    return { state: world, transitionKey: null };
  }

  const facing = direction;
  const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  const targetX = world.playerX + dx;
  const targetY = world.playerY + dy;

  if (
    targetX < 0 ||
    targetX >= map.width ||
    targetY < 0 ||
    targetY >= map.height
  ) {
    return {
      state: { ...world, playerFacing: facing },
      transitionKey: null,
    };
  }

  const targetTile = map.tiles[targetY]?.[targetX] ?? "grass";
  // Where people are standing *now*, not where the map file puts them: a
  // keeper with a routine leaves their tile at dusk, and blocking the tile
  // they used to occupy leaves an invisible wall in the road.
  const npcAtTarget = npcOnTile(map, targetX, targetY, timeMs);

  if (npcAtTarget) {
    return {
      state: { ...world, playerFacing: facing },
      transitionKey: null,
    };
  }

  if (!isTilePassable(targetTile)) {
    return {
      state: { ...world, playerFacing: facing },
      transitionKey: null,
    };
  }

  const transitionKey = `${targetX},${targetY}`;
  const transition = map.transitions[transitionKey];

  if (transition) {
    // Advance the stored position onto the transition tile so the move
    // handler's `isAtEdgeTransition` check (which keys off playerX/playerY)
    // actually fires. Without this the position permanently lagged one tile
    // behind and NO edge transition ever triggered — the overworld was a
    // dead end and Route 2 / the pastures were unreachable.
    return {
      state: {
        ...world,
        playerX: targetX,
        playerY: targetY,
        playerFacing: facing,
        movementTarget: { x: targetX, y: targetY },
        isMoving: true,
      },
      transitionKey,
    };
  }

  startMoveAnimation();
  return {
    state: {
      ...world,
      playerFacing: facing,
      playerX: targetX,
      playerY: targetY,
      movementTarget: { x: targetX, y: targetY },
      isMoving: true,
    },
    transitionKey: null,
  };
}

export function isAtEdgeTransition(
  world: WorldState,
): { mapId: string; x: number; y: number; facing: Direction } | null {
  const map = getMap(world.currentMapId);
  if (!map) {
    return null;
  }
  const transition = map.transitions[`${world.playerX},${world.playerY}`];
  if (!transition) {
    return null;
  }
  return {
    mapId: transition.mapId,
    x: transition.toX,
    y: transition.toY,
    facing: transition.facing ?? "down",
  };
}

export function isOnWildEncounterTile(world: WorldState): boolean {
  const map = getMap(world.currentMapId);
  if (!map) {
    return false;
  }
  const tile = map.tiles[world.playerY]?.[world.playerX];
  return tile === "vroomgrass";
}

export function findAdjacentNpc(
  world: WorldState,
  timeMs: number = Date.now(),
): ReturnType<typeof getNpcByPosition> {
  const map = getMap(world.currentMapId);
  if (!map) {
    return null;
  }
  const dx = world.playerFacing === "left" ? -1 : world.playerFacing === "right" ? 1 : 0;
  const dy = world.playerFacing === "up" ? -1 : world.playerFacing === "down" ? 1 : 0;
  const phase = dayPhase(timeMs);
  return (
    map.npcs.find((npc) => {
      const spot = npcPositionAt(npc, phase);
      return spot !== null && spot.x === world.playerX + dx && spot.y === world.playerY + dy;
    }) ?? null
  );
}

/** Is somebody standing on this tile right now? */
export function npcOnTile(
  map: Tilemap,
  x: number,
  y: number,
  timeMs: number = Date.now(),
): NpcDefinition | null {
  const phase = dayPhase(timeMs);
  return (
    map.npcs.find((npc) => {
      const spot = npcPositionAt(npc, phase);
      return spot !== null && spot.x === x && spot.y === y;
    }) ?? null
  );
}

export function getNpcByPosition(map: Tilemap, x: number, y: number) {
  return map.npcs.find((npc) => npc.x === x && npc.y === y) ?? null;
}


/** A sagging garland of faction pennants strung across the arena's top. */
function drawArenaGarlands(
  ctx: CanvasRenderingContext2D,
  map: Tilemap,
  cameraX: number,
  cameraY: number,
  biomeId: string,
  world: WorldState,
  tick: number,
): void {
  const joined = world.factionChoices[biomeId] ?? null;
  const home = joined ? (HOUSE_ACCENTS[joined] ?? "#caa672") : "#caa672";
  const rival = joined
    ? FACTIONS.find((faction) => faction.biomeId === biomeId && faction.id !== joined)
    : null;
  const away = rival ? (HOUSE_ACCENTS[rival.id] ?? "#8a5a28") : "#8a5a28";
  const postsX = 2;
  const postsY = 2;
  const span = Math.max(2, Math.floor((map.width - postsX) / 2));
  const poleBase = (postsX + span) * TILE_SIZE - cameraX;
  const poleTop = postsY * TILE_SIZE + 28 - cameraY;
  const sag = 34;
  const sway = Math.sin(tick / 900) * 6;

  // Hanging rope.
  ctx.strokeStyle = "rgba(255, 240, 210, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo((postsX - 0.3) * TILE_SIZE - cameraX, poleTop);
  ctx.quadraticCurveTo(poleBase / 2, poleTop + sag + sway, poleBase + 10, poleTop);
  ctx.stroke();

  // Pennants: home colors on the near half, away colors on the far half.
  const pennants = Math.max(3, Math.floor(span * 1.4));
  for (let i = 0; i < pennants; i += 1) {
    const t = (i + 0.5) / pennants;
    const x = (postsX - 0.3) * TILE_SIZE - cameraX + t * (span * 2 * TILE_SIZE);
    const y = poleTop + (sag + sway) * 4 * t * (1 - t) - 10;
    const color = t < 0.5 ? home : away;
    const flutter = Math.sin(tick / 260 + i * 1.7) * 3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10, y + 22 + flutter);
    ctx.lineTo(x + 6, y + 18 + flutter);
    ctx.lineTo(x - 6, y + 18 + flutter);
    ctx.lineTo(x - 10, y + 22 + flutter);
    ctx.closePath();
    ctx.fill();
  }

  // Two little post lights so the arena reads as an arena at dusk.
  ctx.fillStyle = "rgba(255, 209, 102, 0.9)";
  ctx.beginPath();
  ctx.arc((postsX - 0.3) * TILE_SIZE - cameraX, poleTop - 6, 4, 0, Math.PI * 2);
  ctx.arc(poleBase + 10, poleTop - 6, 4, 0, Math.PI * 2);
  ctx.fill();
}


/** Talking distance: the tile in front of the player, or the one the player is
 * standing on (for a host who has stepped aside). */
function withinTalkRange(
  world: WorldState,
  spot: { x: number; y: number },
): boolean {
  const dx = spot.x - world.playerX;
  const dy = spot.y - world.playerY;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && dx * dx + dy * dy <= 2;
}

/**
 * The cue that a person is close enough to talk to. A name tag drawn in canvas
 * text always looked like a web tooltip floating over pixel art — and the
 * dialogue window names the speaker anyway. Three dots in a speech chip is the
 * era-correct way to say "press the button here".
 */
function drawTalkPrompt(
  ctx: CanvasRenderingContext2D,
  npcPx: number,
  npcPy: number,
  tick: number,
): void {
  const w = 18;
  const h = 14;
  const x = Math.round(npcPx + TILE_SIZE / 2 - w / 2);
  // Above the head: a person is 1.5 tiles tall, so the tile's top edge is
  // across their face.
  const bob = Math.round(Math.sin(tick / 320) * 1.5);
  const y = Math.round(npcPy - h - 10 + bob);
  ctx.fillStyle = "rgba(16, 11, 7, 0.92)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  // Tail, so the chip points at the person.
  ctx.fillStyle = "rgba(16, 11, 7, 0.92)";
  ctx.fillRect(x + w / 2 - 2, y + h, 4, 2);
  ctx.fillRect(x + w / 2 - 1, y + h + 2, 2, 1);
  // Speaker dots.
  ctx.fillStyle = "#f7ecd4";
  for (let i = 0; i < 3; i += 1) {
    const phase = (Math.sin(tick / 260 - i * 0.7) + 1) / 2;
    ctx.globalAlpha = 0.45 + phase * 0.55;
    ctx.fillRect(x + 4 + i * 4, y + 6, 2, 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * A contact shadow under the feet.
 *
 * The old one was a hard ellipse centred two pixels above the tile's bottom
 * edge and nearly as wide as the tile, so it stuck out on both sides of the
 * boots and read as a separate disc — every villager looked like they were
 * hovering over a puddle. This is a soft blob that starts at the feet and
 * fades out before the tile edge, so the figure and its shadow share an edge.
 */
function drawPersonShadow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
): void {
  const cx = px + TILE_SIZE / 2;
  const cy = py + TILE_SIZE - 1;
  const rx = TILE_SIZE * 0.27;
  const ry = TILE_SIZE * 0.1;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  gradient.addColorStop(0, "rgba(10, 6, 2, 0.45)");
  gradient.addColorStop(0.55, "rgba(10, 6, 2, 0.26)");
  gradient.addColorStop(1, "rgba(10, 6, 2, 0)");
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** People are 1.5 tiles tall and stand on the tile they occupy, so their
 * picture hangs half a tile above it. */
function drawPersonAsset(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  px: number,
  py: number,
): void {
  ctx.drawImage(
    image,
    px,
    py + TILE_SIZE - TILE_SIZE * PERSON_HEIGHT_TILES,
    TILE_SIZE,
    TILE_SIZE * PERSON_HEIGHT_TILES,
  );
}

/** The soft edge of the lit world. Exported for the tests that assert a
 * vignette exists rather than trusting the eye. */
export function drawFrameVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  interior: boolean,
): void {
  const reach = Math.max(width, height) * 0.75;
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    reach * 0.45,
    width / 2,
    height / 2,
    reach,
  );
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(
    1,
    interior ? "rgba(8, 5, 3, 0.62)" : "rgba(6, 12, 5, 0.5)",
  );
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
