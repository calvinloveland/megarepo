import { getMap, isTilePassable } from "./maps.js";
import {
  drawNpc,
  drawPlayer,
  drawTile,
} from "./sprites.js";
import {
  PLAYER_MOVE_DURATION_MS,
  TILE_SIZE,
  type Direction,
  type NpcDefinition,
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
// One offscreen canvas per map (invalidated when the map or the sprite
// assets change): the tile layer is drawn once, then blitted per frame.
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
  const layer = document.createElement("canvas");
  layer.width = map.width * TILE_SIZE;
  layer.height = map.height * TILE_SIZE;
  const lctx = layer.getContext("2d");
  if (!lctx) {
    return layer;
  }
  lctx.fillStyle = map.ambientColor;
  lctx.fillRect(0, 0, layer.width, layer.height);
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = map.tiles[y]?.[x] ?? "grass";
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const tileAsset = spriteAssets?.get(`tile:${tile}`);
      if (tileAsset) {
        lctx.drawImage(tileAsset, px, py, TILE_SIZE, TILE_SIZE);
      } else {
        drawTile(lctx, tile, px, py, TILE_SIZE, 0);
      }
    }
  }
  bakedLayer = { key, canvas: layer };
  return layer;
}

export function invalidateBakedTileLayer(): void {
  bakedLayer = null;
  waterLayer = null;
}

/** Water tiles per map, scanned once (the renderer draws ripples over them). */
let waterLayer: { key: string; tiles: Array<{ x: number; y: number }> } | null = null;

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

  // Outside the map is deep forest, not more meadow: the bright ambient fill
  // made the letterbox around small maps look like empty paint. An interior
  // gets a dark room tone instead — a house floating in woodland read wrong.
  ctx.fillStyle = map.interior ? "#241a13" : "#14200f";
  ctx.fillRect(0, 0, width, height);

  // The static tile layer is BAKED once per map into an offscreen canvas
  // and blitted in a single draw call per frame. Drawing ~200 tiles every
  // frame was the biggest per-frame cost in the overworld; the bake keeps
  // tiles (and their PNG assets) as load-once art.
  const baked = bakedTileLayer(map, frame.spriteAssets);
  ctx.drawImage(baked, -cameraX, -cameraY);

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
    // Dialogue-only stubs sit on impassable tiles (conventionally at 0,0) and
    // resolve by id, not by position — skip them so no ghost sprites render
    // in the map corner.
    if (!isTilePassable(map.tiles[spot.y]?.[spot.x] ?? "grass")) {
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
        const npcAsset = frame.spriteAssets?.get(`npc:${npc.id}`);
        if (npcAsset) {
          ctx.drawImage(npcAsset, npcPx, npcPy, TILE_SIZE, TILE_SIZE);
        } else {
          drawNpc(ctx, npc.sprite, npcPx, npcPy, TILE_SIZE, npc.facing, tick, npc.id);
        }
        drawNpcNameTag(ctx, npc.name, npcPx, npcPy, npc.id, tick);
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
      drawPlayer(
        ctx,
        playerPx,
        playerPy,
        TILE_SIZE,
        world.playerFacing,
        tick,
        CAP_HEX[world.rancherCap] ?? PAL.cap.navy,
      );
    },
  });
  sortedEntities.sort((left, right) => left.y - right.y);
  for (const entity of sortedEntities) {
    entity.draw(0);
  }
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
  const npcAtTarget = map.npcs.find(
    (npc) => npc.x === targetX && npc.y === targetY,
  );

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
      return spot.x === world.playerX + dx && spot.y === world.playerY + dy;
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
      return spot.x === x && spot.y === y;
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


const NAME_TAG_HIDDEN_IDS = new Set([
  "professor-axle-2",
  "robby-reveal-1",
  "robby-reveal-2",
  "robby-reveal-3",
  "robby-reveal-4",
  "robby-yard-1",
  "robby-yard-2",
  "robby-yard-3",
  "robby-caught-1",
  "robby-caught-2",
  "robby-caught-3",
  "robby-caught-4",
  "elder-join-faction",
  "elder-decline",
  "elder-feud",
  "vroomdex-explain",
  "professor-farewell",
  "wanda-first-buys",
  "wanda-bye",
]);

function drawNpcNameTag(
  ctx: CanvasRenderingContext2D,
  name: string,
  npcPx: number,
  npcPy: number,
  npcId: string,
  tick: number,
): void {
  if (!name || NAME_TAG_HIDDEN_IDS.has(npcId)) {
    return;
  }
  const text = name.length > 22 ? `${name.slice(0, 20)}…` : name;
  const fontSize = 6;
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const width = ctx.measureText(text).width + 6;
  const x = npcPx + TILE_SIZE / 2;
  const y = npcPy - 3;
  const accent = houseAccentForNpc(npcId) ?? "#caa672";
  ctx.fillStyle = "rgba(10, 8, 5, 0.72)";
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - fontSize - 2, width, fontSize + 4, 2.5);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = "#f4ecd8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  void tick;
}
