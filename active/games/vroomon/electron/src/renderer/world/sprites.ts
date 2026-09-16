import type { Direction, TileKind } from "./types.js";
import { MAPS } from "./maps.js";
import { SPRITE_PALETTE as PAL, houseAccentForNpc } from "./sprites-palette.js";

export const TILE_COLORS: Record<TileKind, { fill: string; stroke?: string; accent?: string }> = {
  bed: { fill: "#8a6a4a" },
  grass: { fill: "#7eb34b" },
  vroomgrass: { fill: "#5fa343", accent: "#ffe066" },
  path: { fill: "#c2a673" },
  tree: { fill: "#2d6b3a" },
  "tree-trunk": { fill: "#5a3b22" },
  rock: { fill: "#7a7a7a" },
  building: { fill: "#d9c8a0", stroke: "#5a4530" },
  door: { fill: "#7a4a2a", stroke: "#3a2010" },
  doormat: { fill: "#a86b3a" },
  counter: { fill: "#6f4423" },
  water: { fill: "#4a78c2" },
  wall: { fill: "#5a3a2a", stroke: "#2a1a10" },
  "indoor-floor": { fill: "#b89a6b" },
  "tall-grass-edge": { fill: "#65a045" },
};

// ---- Tile component sprites ----
// Ground tiles are two layers — a BASE (fill, shade, pattern) and a DETAIL
// (accents, animation, furniture); walls are a shared BRICK face + TRIM +
// skirting assembled per kind. Each layer exports as its own PNG so art can
// be swapped per-layer (or AI-replaced by manifest id) without touching the
// other layers or the runtime, which keeps consuming the assembled
// `tile:<kind>` images.

const WALL_KINDS = new Set<TileKind>(["wall", "building", "tree-trunk"]);

export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tick: number,
): void {
  if (WALL_KINDS.has(tile)) {
    drawWallBase(ctx, tile, px, py, size);
    drawWallBrick(ctx, tile, px, py, size);
    drawWallTrim(ctx, tile, px, py, size);
    return;
  }
  drawGroundBase(ctx, tile, px, py, size);
  drawGroundDetail(ctx, tile, px, py, size, tick);
}

function drawGroundBase(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
): void {
  const colors = TILE_COLORS[tile];
  ctx.fillStyle = colors.fill;
  ctx.fillRect(px, py, size, size);
  // Soft corner shade so tiles read as a continuous floor.
  ctx.fillStyle = "rgba(30, 22, 12, 0.08)";
  ctx.fillRect(px + size - 6, py, 6, size);
  ctx.fillRect(px, py + size - 5, size, 5);

  if (tile === "grass" || tile === "tall-grass-edge") {
    // Scattered blade specks.
    ctx.fillStyle = "rgba(40, 90, 30, 0.5)";
    for (let d = 0; d < 5; d += 1) {
      ctx.fillRect(px + (d * 7 + 3) % size, py + (d * 11 + 5) % size, 4, 1);
    }
  }
  if (tile === "path") {
    // Pebble dots.
    ctx.fillStyle = "rgba(90, 70, 40, 0.35)";
    for (let d = 0; d < 6; d += 1) {
      ctx.fillRect(px + (d * 9 + 4) % size, py + (d * 13 + 6) % size, 3, 2);
    }
  }
  if (tile === "indoor-floor") {
    // Planked floor lines.
    ctx.strokeStyle = "rgba(90, 66, 40, 0.35)";
    ctx.lineWidth = 1;
    for (let row = 1; row < 4; row += 1) {
      ctx.beginPath();
      ctx.moveTo(px + 2, py + (row * size) / 4);
      ctx.lineTo(px + size - 2, py + (row * size) / 4);
      ctx.stroke();
    }
  }
  if (tile === "vroomgrass") {
    ctx.fillStyle = "rgba(30, 80, 20, 0.45)";
    for (let d = 0; d < 5; d += 1) {
      ctx.fillRect(px + (d * 11 + 2) % size, py + (d * 7 + 4) % size, 4, 2);
    }
  }
  if (tile === "water" || tile === "bed") {
    // Base only; details carry the waves/blanket.
  }
  if (tile === "doormat") {
    ctx.strokeStyle = "rgba(58, 32, 16, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 3, py + 3, size - 6, size - 6);
  }
  if (tile === "counter") {
    // Dark top edge + shadow so a counter reads as furniture instead of
    // another patch of floor.
    ctx.fillStyle = "#3f2413";
    ctx.fillRect(px, py + size - 8, size, 8);
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(px, py + size - 3, size, 3);
  }
  if (tile === "rock") {
    ctx.fillStyle = "#5a5a5a";
    ctx.fillRect(px + 4, py + 6, size - 8, size - 12);
  }
  if (tile === "tree") {
    ctx.fillStyle = "#1d4b2a";
    ctx.beginPath();
    ctx.moveTo(px + size / 2, py + 4);
    ctx.lineTo(px + size - 4, py + size - 4);
    ctx.lineTo(px + 4, py + size - 4);
    ctx.closePath();
    ctx.fill();
  }
  if (tile === "door") {
    ctx.strokeStyle = "#3a2010";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
  }
}

function drawGroundDetail(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tick: number,
): void {
  if (tile === "bed") {
    const u = size / 32;
    // Wooden frame, mattress, striped blanket, and a fat pillow — the
    // first thing a new rancher sees, so it should read as a bed.
    ctx.fillStyle = "#5a3b22";
    ctx.fillRect(px + 1 * u, py + 2 * u, size - 2 * u, size - 4 * u);
    ctx.fillStyle = "#efe6d2";
    ctx.fillRect(px + 3 * u, py + 4 * u, size - 6 * u, size - 8 * u);
    ctx.fillStyle = "#cf3a3a";
    ctx.fillRect(px + 3 * u, py + 10 * u, size - 6 * u, size - 14 * u);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let i = 0; i < 3; i += 1) {
      ctx.fillRect(px + 3 * u, py + (12 + i * 5) * u, size - 6 * u, 1 * u);
    }
    ctx.fillStyle = "#fffaf0";
    ctx.fillRect(px + 5 * u, py + 5 * u, size - 10 * u, 4 * u);
    ctx.strokeStyle = "rgba(40, 24, 10, 0.65)";
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeRect(px + 1 * u, py + 2 * u, size - 2 * u, size - 4 * u);
    void tick;
    return;
  }
  if (tile === "vroomgrass") {
    const wobble = Math.sin(tick / 240 + (px + py) * 0.1) * 1.5;
    for (let i = 0; i < 4; i += 1) {
      const x = px + (i * size) / 4 + size / 8;
      const y = py + size - 6 + wobble;
      ctx.fillStyle = "#ffe066";
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (tile === "water") {
    const wave = Math.sin(tick / 600 + (px + py) * 0.05) * 2;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(px + 4, py + 8 + wave, size - 8, 2);
    ctx.fillRect(px + 4, py + size - 12 - wave, size - 8, 2);
  }
  if (tile === "tall-grass-edge") {
    // A few irregular blades (not a repeating dash pattern, which tiled
    // into a fence-like line across the yard).
    const u = size / 32;
    ctx.strokeStyle = "rgba(47, 96, 32, 0.8)";
    ctx.lineWidth = 1.6 * u;
    const blades = [
      [5, 9],
      [11, 6],
      [18, 8],
      [26, 5],
    ] as const;
    for (const [bx, bh] of blades) {
      ctx.beginPath();
      ctx.moveTo(px + bx * u, py + size - 1);
      ctx.quadraticCurveTo(
        px + (bx + 1) * u,
        py + (32 - bh / 2) * u,
        px + (bx + 2) * u,
        py + (32 - bh) * u,
      );
      ctx.stroke();
    }
  }
  if (tile === "rock") {
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(px + 6, py + 8, 2, 2);
    ctx.fillStyle = "rgba(220,220,220,0.25)";
    ctx.fillRect(px + 4, py + 7, size - 8, 2);
  }
  if (tile === "door") {
    ctx.fillStyle = "rgba(220,160,90,0.85)";
    ctx.fillRect(px + 6, py + 2, 3, size - 4);
    ctx.fillRect(px + size - 9, py + 2, 3, size - 4);
    ctx.fillStyle = "rgba(255,235,190,0.8)";
    ctx.fillRect(px + size - 7, py + size / 2 - 1, 3, 3);
  }
  if (tile === "building") {
    ctx.fillStyle = "#7a5a3a";
    ctx.fillRect(px + 2, py + size - 8, size - 4, 6);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(px + 6, py + 6, 6, 6);
    ctx.fillRect(px + size - 12, py + 6, 6, 6);
  }
  if (tile === "counter") {
    // The work surface: lighter than the floor, with a grain line.
    ctx.fillStyle = "rgba(255, 236, 200, 0.55)";
    ctx.fillRect(px + 2, py + 2, size - 4, size - 11);
    ctx.strokeStyle = "rgba(80, 48, 24, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 4, py + size / 2 - 3);
    ctx.lineTo(px + size - 4, py + size / 2 - 3);
    ctx.stroke();
  }
}

// ---- Wall face components (brick + trim + skirting) ----
const WALL_PALETTES: Record<string, { brick: string; mortar: string; trim: string }> = {
  wall: { brick: "#6a4630", mortar: "#3a2416", trim: "#8a6a4a" },
  building: { brick: "#c9b48a", mortar: "#8a7450", trim: "#5a4530" },
  "tree-trunk": { brick: "#4a2f18", mortar: "#2a1a0c", trim: "#6a4a2a" },
};

function drawWallBase(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
): void {
  const colors = WALL_PALETTES[tile] ?? WALL_PALETTES.wall!;
  ctx.fillStyle = colors.mortar;
  ctx.fillRect(px, py, size, size);
}

function drawWallBrick(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
): void {
  const colors = WALL_PALETTES[tile] ?? WALL_PALETTES.wall!;
  const rows = Math.max(2, Math.round(size / 12));
  const rowH = size / rows;
  ctx.fillStyle = colors.brick;
  for (let r = 0; r < rows; r += 1) {
    const offset = r % 2 === 0 ? 0 : size / 4;
    ctx.fillRect(px + offset, py + r * rowH, size - offset, rowH - 2);
    if (offset > 0) {
      ctx.fillRect(px, py + r * rowH, size / 4, rowH - 2);
    }
  }
}

function drawWallTrim(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
): void {
  const colors = WALL_PALETTES[tile] ?? WALL_PALETTES.wall!;
  ctx.fillStyle = colors.trim;
  ctx.fillRect(px, py, size, 3);
  // Skirting shadow at the foot of the wall.
  ctx.fillStyle = "rgba(20, 12, 6, 0.5)";
  ctx.fillRect(px, py + size - 4, size, 4);
}

// ---- Component sprite system ----
// NPCs are assembled from three independent parts — a HEAD (skin + face),
// an OUTFIT (torso + details), and an ACCESSORY — drawn in that order and
// connected by the shared anchor. Each part is exported as its own PNG by
// the exporter, so art can be swapped per-component (or replaced wholesale
// with AI-generated files by manifest id).

export type HeadId = "light" | "mid" | "dark" | "pale";
export type OutfitId = "labcoat" | "mechanic" | "rider" | "leader" | "worker" | "plain";
export type AccessoryId =
  | "flatcap-glasses"
  | "beanie-wrench"
  | "bandana-ponytail"
  | "stetson"
  | "sign-post"
  | "none";

interface NpcParts {
  head: HeadId;
  outfit: OutfitId;
  accessory: AccessoryId;
}

const HEAD_SKINS: Record<HeadId, string> = {
  light: PAL.skin.light,
  mid: PAL.skin.mid,
  dark: PAL.skin.dark,
  pale: "#f0dfc4",
};

const OUTFIT_COLORS: Record<OutfitId, { main: string; trim: string }> = {
  labcoat: { main: "#e8e6df", trim: "#b7b2a6" },
  mechanic: { main: PAL.body.maroon, trim: "#5a3e2e" },
  rider: { main: PAL.body.green, trim: "#2a6b4f" },
  leader: { main: PAL.body.charcoal, trim: PAL.accent.gold },
  worker: { main: "#7d6a52", trim: "#5a4a38" },
  plain: { main: PAL.body.gray, trim: "#4a4a55" },
};

const NPC_PARTS: Record<string, NpcParts> = {
  professor: { head: "light", outfit: "labcoat", accessory: "flatcap-glasses" },
  mechanic: { head: "mid", outfit: "mechanic", accessory: "beanie-wrench" },
  rider: { head: "light", outfit: "rider", accessory: "bandana-ponytail" },
  "gym-leader": { head: "mid", outfit: "leader", accessory: "stetson" },
  sign: { head: "dark", outfit: "worker", accessory: "sign-post" },
  default: { head: "light", outfit: "plain", accessory: "none" },
};

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  facing: Direction,
  step: number,
  capColor: string = PAL.cap.navy,
): void {
  // Every dimension is relative to the tile (32px is the design unit), so
  // the same figure reads correctly at world scale and in the 96px exports.
  const u = size / 32;
  const bobY = Math.sin(step / 100) * 1.5 * u;
  const cy = py + size / 2 + bobY;
  const cx = px + size / 2;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, py + size - 4 * u, size / 3, 4 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PAL.skin.light;
  ctx.fillRect(cx - 5 * u, cy - 8 * u, 10 * u, 10 * u);

  ctx.fillStyle = PAL.ink.eyes;
  const eyeOffset = (facing === "left" ? -2 : facing === "right" ? 2 : 0) * u;
  ctx.fillRect(cx - 3 * u + eyeOffset, cy - 5 * u, 1.5 * u, 1.5 * u);
  ctx.fillRect(cx + 1 * u + eyeOffset, cy - 5 * u, 1.5 * u, 1.5 * u);

  // Cap brim (the rancher's signature color).
  ctx.fillStyle = capColor;
  ctx.fillRect(cx - 7 * u, cy - 14 * u, 14 * u, 3 * u);
  ctx.fillStyle = PAL.cap.red;
  ctx.fillRect(cx - 6 * u, cy - 11 * u, 12 * u, 4 * u);

  ctx.fillStyle = PAL.body.navy;
  ctx.fillRect(cx - 7 * u, cy + 2 * u, 14 * u, 12 * u);

  ctx.strokeStyle = "rgba(20, 14, 8, 0.7)";
  ctx.lineWidth = Math.max(1, u);
  ctx.strokeRect(cx - 5 * u, cy - 8 * u, 10 * u, 10 * u);
  ctx.strokeRect(cx - 7 * u, cy + 2 * u, 14 * u, 12 * u);

  ctx.fillStyle = "#fff4d1";
  const footOffset = (Math.sin(step / 100) > 0 ? 1 : -1) * u;
  ctx.fillRect(cx - 6 * u, cy + 14 * u + footOffset, 5 * u, 3 * u);
  ctx.fillRect(cx + 1 * u, cy + 14 * u - footOffset, 5 * u, 3 * u);
}

export function drawNpc(
  ctx: CanvasRenderingContext2D,
  sprite: string,
  px: number,
  py: number,
  size: number,
  facing: Direction,
  step: number,
  npcId?: string,
): void {
  const parts = NPC_PARTS[sprite] ?? NPC_PARTS.default!;
  drawNpcShadow(ctx, px, py, size, step);
  drawNpcHead(ctx, parts.head, px, py, size, facing);
  drawNpcOutfit(ctx, parts.outfit, px, py, size, facing);
  drawNpcAccessory(ctx, parts.accessory, px, py, size, facing, npcId);
  drawNpcOutline(ctx, px, py, size);
}

function drawNpcShadow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  step: number,
): void {
  const u = size / 32;
  const bobY = Math.sin(step / 220 + px) * 0.8 * u;
  const cy = py + size / 2 + bobY;
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  ctx.ellipse(px + size / 2, py + size - 4, size / 3, 4 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  void cy;
}

function drawNpcHead(
  ctx: CanvasRenderingContext2D,
  head: HeadId,
  px: number,
  py: number,
  size: number,
  facing: Direction,
): void {
  const u = size / 32;
  const cy = py + size / 2;
  const skin = HEAD_SKINS[head];
  ctx.fillStyle = skin;
  ctx.fillRect(px + size / 2 - 5 * u, cy - 8 * u, 10 * u, 10 * u);
  // Hair cap on the crown for extra readability.
  ctx.fillStyle = "rgba(52, 38, 26, 0.65)";
  ctx.fillRect(px + size / 2 - 5 * u, cy - 8 * u, 10 * u, 3 * u);
  ctx.fillStyle = PAL.ink.eyes;
  const eyeOffset = facing === "left" ? -2 : facing === "right" ? 2 : 0;
  ctx.fillRect(px + size / 2 - 3 * u + eyeOffset, cy - 5 * u, 1.5 * u, 1.5 * u);
  ctx.fillRect(px + size / 2 + 1 * u + eyeOffset, cy - 5 * u, 1.5 * u, 1.5 * u);
  // Mouth.
  ctx.fillRect(px + size / 2 - 1 * u + eyeOffset, cy - 1 * u, 2 * u, 1 * u);
}

function drawNpcOutfit(
  ctx: CanvasRenderingContext2D,
  outfit: OutfitId,
  px: number,
  py: number,
  size: number,
  facing: Direction,
): void {
  const u = size / 32;
  const cx = px + size / 2;
  const cy = py + size / 2;
  const colors = OUTFIT_COLORS[outfit];
  ctx.fillStyle = colors.main;
  ctx.fillRect(cx - 7 * u, cy + 2 * u, 14 * u, 12 * u);
  if (outfit === "labcoat") {
    // Open collar + pocket lines.
    ctx.fillStyle = colors.trim;
    ctx.fillRect(cx - 1 * u, cy + 3 * u, 2 * u, 3 * u);
    ctx.fillRect(cx - 5 * u, cy + 7 * u, 4 * u, 3 * u);
  } else if (outfit === "mechanic") {
    ctx.fillStyle = colors.trim;
    ctx.fillRect(cx - 5 * u, cy + 5 * u, 10 * u, 1 * u);
    ctx.fillRect(cx + 3 * u, cy + 6 * u, 2 * u, 4 * u);
  } else if (outfit === "rider") {
    ctx.fillStyle = colors.trim;
    ctx.fillRect(cx - 3 * u, cy - 1 * u, 6 * u, 2 * u);
    ctx.fillRect(cx - 1 * u, cy + 1 * u, 2 * u, 12 * u);
  } else if (outfit === "leader") {
    ctx.fillStyle = colors.trim;
    ctx.fillRect(cx - 7 * u, cy + 2 * u, 14 * u, 2 * u);
    ctx.fillRect(cx - 2 * u, cy + 6 * u, 4 * u, 4 * u);
  } else if (outfit === "worker") {
    ctx.fillStyle = colors.trim;
    ctx.fillRect(cx - 7 * u, cy + 4 * u, 14 * u, 1 * u);
    ctx.fillRect(cx - 5 * u, cy + 9 * u, 10 * u, 1 * u);
  }
  ctx.fillStyle = PAL.ink.feet;
  ctx.fillRect(cx - 6 * u, cy + 13 * u, 5 * u, 3 * u);
  ctx.fillRect(cx + 1 * u, cy + 13 * u, 5 * u, 3 * u);
  void facing;
}

function drawNpcAccessory(
  ctx: CanvasRenderingContext2D,
  accessory: AccessoryId,
  px: number,
  py: number,
  size: number,
  facing: Direction,
  npcId: string | undefined,
): void {
  const u = size / 32;
  const cx = px + size / 2;
  const cy = py + size / 2;
  const eyeShift = (facing === "left" ? -1.5 : facing === "right" ? 1.5 : 0) * (size / 32);
  switch (accessory) {
    case "flatcap-glasses":
      ctx.fillStyle = "#4a4452";
      ctx.fillRect(cx - 7 * u, cy - 15 * u, 14 * u, 4 * u);
      ctx.fillRect(cx - 9 * u, cy - 12 * u, 18 * u, 2 * u);
      ctx.strokeStyle = "rgba(30, 24, 34, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx - 2.5 * u + eyeShift, cy - 5 * u, 2.4 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 2.5 * u + eyeShift, cy - 5 * u, 2.4 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(cx - 6 * u + eyeShift, cy - 4 * u, 12 * u, 2 * u);
      break;
    case "beanie-wrench":
      ctx.fillStyle = "#7d6a52";
      ctx.beginPath();
      ctx.arc(cx, cy - 9 * u, 7 * u, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#c9c9c9";
      ctx.fillRect(cx + 8 * u, cy + 4 * u, 2 * u, 6 * u);
      ctx.fillRect(cx + 6 * u, cy + 9 * u, 6 * u, 2 * u);
      break;
    case "bandana-ponytail":
      ctx.fillStyle = "#2a6b4f";
      ctx.fillRect(cx - 5 * u, cy + 2 * u, 3 * u, 7 * u);
      ctx.fillRect(cx + 2 * u, cy + 2 * u, 3 * u, 7 * u);
      ctx.fillStyle = "#7a4a1e";
      ctx.fillRect(cx + 6 * u, cy - 9 * u, 2 * u, 6 * u);
      break;
    case "stetson": {
      const bandColor = npcId ? houseAccentForNpc(npcId) ?? "#caa672" : "#caa672";
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(cx - 9 * u, cy - 14 * u, 18 * u, 2 * u);
      ctx.fillRect(cx - 5 * u, cy - 19 * u, 11 * u, 6 * u);
      ctx.fillStyle = bandColor;
      ctx.fillRect(cx - 5 * u, cy - 13 * u, 11 * u, 2 * u);
      break;
    }
    case "sign-post":
      ctx.fillStyle = "#7a5c3e";
      ctx.fillRect(cx + 6 * u, cy - 12 * u, 3 * u, 24 * u);
      ctx.fillStyle = "#c9a176";
      ctx.fillRect(cx - 4 * u, cy - 14 * u, 12 * u, 11 * u);
      ctx.strokeStyle = "rgba(40, 26, 12, 0.7)";
      ctx.strokeRect(cx - 4 * u, cy - 14 * u, 12 * u, 11 * u);
      ctx.fillStyle = "#3b2a1c";
      ctx.fillRect(cx, cy - 12 * u, 1.5 * u, 1.5 * u);
      ctx.fillRect(cx, cy - 6 * u, 1.5 * u, 1.5 * u);
      break;
    case "none":
      break;
  }
}

function drawNpcOutline(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
): void {
  const u = size / 32;
  const cy = py + size / 2;
  ctx.strokeStyle = "rgba(20, 14, 8, 0.75)";
  ctx.lineWidth = Math.max(1, u);
  ctx.strokeRect(px + size / 2 - 5 * u, cy - 8 * u, 10 * u, 10 * u);
  ctx.strokeRect(px + size / 2 - 7 * u, cy + 2 * u, 14 * u, 12 * u);
}

const NPC_PALETTE: Record<string, { head: string; body: string; accent: string }> = {
  professor: { head: PAL.skin.light, body: PAL.body.purple, accent: PAL.accent.white },
  mechanic: { head: PAL.skin.mid, body: PAL.body.maroon, accent: PAL.accent.red },
  rider: { head: PAL.skin.light, body: PAL.body.green, accent: PAL.accent.gold },
  "gym-leader": { head: PAL.skin.mid, body: PAL.body.charcoal, accent: PAL.accent.gold },
  sign: { head: PAL.skin.dark, body: PAL.body.brown, accent: PAL.accent.tan },
  default: { head: PAL.skin.light, body: PAL.body.gray, accent: PAL.accent.gray },
};


// ---- Sprite asset exports ----
// The game's art is all drawn in code; this renders each sprite to a real
// PNG data URL so a build-time exporter (scripts/export-sprites.mjs) can
// write actual image files. Dropping a file at assets/sprites/<id>.png
// (same id, see manifest.json) makes the runtime prefer it over the code
// draw — the pipeline for replacing art with AI-generated images.

const EXPORT_TILE_KINDS: TileKind[] = [
  "grass",
  "path",
  "tree",
  "building",
  "door",
  "vroomgrass",
  "water",
  "wall",
  "counter",
  "indoor-floor",
  "tall-grass-edge",
  "tree-trunk",
  "rock",
  "doormat",
  "bed",
];

export function collectSpriteExports(): Array<{ id: string; dataUrl: string }> {
  const mapsForExport = Object.values(MAPS);
  const out: Array<{ id: string; dataUrl: string }> = [];
  const canvas = document.createElement("canvas");
  const SIZE = 96; // 3x the 32px tile so exported PNGs stay crisp
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return out;
  }
  const snap = (id: string): void => {
    out.push({ id, dataUrl: canvas.toDataURL("image/png") });
    ctx.clearRect(0, 0, SIZE, SIZE);
  };
  for (const kind of EXPORT_TILE_KINDS) {
    drawTile(ctx, kind, 0, 0, SIZE, 0);
    snap(`tile:${kind}`);
  }
  for (const kind of EXPORT_TILE_KINDS) {
    if (WALL_KINDS.has(kind)) {
      drawWallBase(ctx, kind, 0, 0, SIZE);
      snap(`wallbase:${kind}`);
      drawWallBrick(ctx, kind, 0, 0, SIZE);
      snap(`wallbrick:${kind}`);
      drawWallTrim(ctx, kind, 0, 0, SIZE);
      snap(`walltrim:${kind}`);
    } else {
      drawGroundBase(ctx, kind, 0, 0, SIZE);
      snap(`tilebase:${kind}`);
      drawGroundDetail(ctx, kind, 0, 0, SIZE, 0);
      snap(`tiledetail:${kind}`);
    }
  }
  const playerFacings = ["down", "up", "left", "right"] as const;
  for (const head of Object.keys(HEAD_SKINS) as HeadId[]) {
    drawNpcHead(ctx, head, 0, 0, SIZE, "down");
    snap(`head:${head}`);
  }
  for (const outfit of Object.keys(OUTFIT_COLORS) as OutfitId[]) {
    drawNpcOutfit(ctx, outfit, 0, 0, SIZE, "down");
    snap(`outfit:${outfit}`);
  }
  const accessoryIds: AccessoryId[] = [
    "flatcap-glasses",
    "beanie-wrench",
    "bandana-ponytail",
    "stetson",
    "sign-post",
    "none",
  ];
  for (const accessory of accessoryIds) {
    drawNpcAccessory(ctx, accessory, 0, 0, SIZE, "down", undefined);
    snap(`accessory:${accessory}`);
  }
  for (const facing of playerFacings) {
    drawPlayer(ctx, 0, 0, SIZE, facing, 0);
    snap(`player:${facing}`);
  }
  const seen = new Set<string>();
  for (const map of mapsForExport) {
    for (const npc of map.npcs ?? []) {
      if (seen.has(npc.id)) {
        continue;
      }
      seen.add(npc.id);
      drawNpc(
        ctx,
        npc.sprite,
        0,
        0,
        SIZE,
        npc.facing as "down" | "up" | "left" | "right",
        0,
        npc.id,
      );
      snap(`npc:${npc.id}`);
    }
  }
  return out;
}

declare global {
  interface Window {
    __vroomonSprites?: () => Array<{ id: string; dataUrl: string }>;
  }
}
