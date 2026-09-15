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
  counter: { fill: "#8a5a30" },
  water: { fill: "#4a78c2" },
  wall: { fill: "#5a3a2a", stroke: "#2a1a10" },
  "indoor-floor": { fill: "#b89a6b" },
  "tall-grass-edge": { fill: "#65a045" },
};

export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tick: number,
): void {
  const colors = TILE_COLORS[tile];
  ctx.fillStyle = colors.fill;
  ctx.fillRect(px, py, size, size);

  if (colors.stroke) {
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
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

  if (tile === "bed") {
    // A low bunk with a striped blanket.
    const hue = tick % 3 === 0 ? "#7a5c3e" : "#8a6a4a";
    ctx.fillStyle = "#3b2a1c";
    ctx.fillRect(px + 2, py + 10, size - 4, size - 12);
    ctx.fillStyle = hue;
    ctx.fillRect(px + 2, py + 10, size - 4, 9);
    ctx.fillStyle = "#d8b48a";
    ctx.fillRect(px + 4, py + 10, 10, 5);
    ctx.fillStyle = "#f2e8d8";
    ctx.fillRect(px + 4, py + size - 12, size - 8, 4);
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

  if (tile === "rock") {
    ctx.fillStyle = "#5a5a5a";
    ctx.fillRect(px + 4, py + 6, size - 8, size - 12);
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(px + 6, py + 8, 2, 2);
  }

  if (tile === "building") {
    ctx.fillStyle = "#7a5a3a";
    ctx.fillRect(px + 2, py + size - 8, size - 4, 6);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(px + 6, py + 6, 6, 6);
    ctx.fillRect(px + size - 12, py + 6, 6, 6);
  }
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  facing: Direction,
  step: number,
  capColor: string = PAL.cap.navy,
): void {
  const bobY = Math.sin(step / 100) * 1.5;
  const cy = py + size / 2 + bobY;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(px + size / 2, py + size - 4, size / 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PAL.skin.light;
  ctx.fillRect(px + size / 2 - 5, cy - 8, 10, 10);

  ctx.fillStyle = PAL.cap.navy;
  const eyeOffset = facing === "left" ? -2 : facing === "right" ? 2 : 0;
  ctx.fillRect(px + size / 2 - 3 + eyeOffset, cy - 5, 1.5, 1.5);
  ctx.fillRect(px + size / 2 + 1 + eyeOffset, cy - 5, 1.5, 1.5);

  // Cap brim (the rancher's signature color).
  ctx.fillStyle = capColor;
  ctx.fillRect(px + size / 2 - 7, cy - 14, 14, 3);
  ctx.fillStyle = PAL.cap.red;
  ctx.fillRect(px + size / 2 - 6, cy - 11, 12, 4);

  ctx.fillStyle = PAL.body.navy;
  ctx.fillRect(px + size / 2 - 7, cy + 2, 14, 12);

  ctx.fillStyle = "#fff4d1";
  const footOffset = Math.sin(step / 100) > 0 ? 1 : -1;
  ctx.fillRect(px + size / 2 - 6, cy + 14 + footOffset, 5, 3);
  ctx.fillRect(px + size / 2 + 1, cy + 14 - footOffset, 5, 3);
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
  const bobY = Math.sin(step / 220 + px) * 0.8;
  const cy = py + size / 2 + bobY;

  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  ctx.ellipse(px + size / 2, py + size - 4, size / 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const palette = NPC_PALETTE[sprite] ?? NPC_PALETTE.default!;
  const headColor = palette.head;
  const bodyColor = palette.body;
  const accent = palette.accent;
  // Faction-coded band: hosts wear their household's signature accent.
  const bandColor = (npcId ? houseAccentForNpc(npcId) : null) ?? accent;

  ctx.fillStyle = headColor;
  ctx.fillRect(px + size / 2 - 5, cy - 8, 10, 10);

  ctx.fillStyle = PAL.ink.eyes;
  const eyeOffset = facing === "left" ? -2 : facing === "right" ? 2 : 0;
  ctx.fillRect(px + size / 2 - 3 + eyeOffset, cy - 5, 1.5, 1.5);
  ctx.fillRect(px + size / 2 + 1 + eyeOffset, cy - 5, 1.5, 1.5);

  ctx.fillStyle = bandColor;
  ctx.fillRect(px + size / 2 - 6, cy - 12, 12, 4);

  ctx.fillStyle = bodyColor;
  ctx.fillRect(px + size / 2 - 7, cy + 2, 14, 12);

  ctx.fillStyle = PAL.ink.feet;
  ctx.fillRect(px + size / 2 - 6, cy + 14, 5, 3);
  ctx.fillRect(px + size / 2 + 1, cy + 14, 5, 3);

  if (sprite === "gym-leader" || sprite === "professor" || sprite === "mechanic") {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(px + 4, py + 4, 8, 8);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.strokeRect(px + 4.5, py + 4.5, 7, 7);
  }
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
  const playerFacings = ["down", "up", "left", "right"] as const;
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
