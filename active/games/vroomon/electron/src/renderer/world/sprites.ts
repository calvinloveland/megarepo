import type { Direction, TileKind } from "./types.js";

export const TILE_COLORS: Record<TileKind, { fill: string; stroke?: string; accent?: string }> = {
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
): void {
  const bobY = Math.sin(step / 100) * 1.5;
  const cy = py + size / 2 + bobY;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(px + size / 2, py + size - 4, size / 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f7d4a0";
  ctx.fillRect(px + size / 2 - 5, cy - 8, 10, 10);

  ctx.fillStyle = "#1f3a5a";
  const eyeOffset = facing === "left" ? -2 : facing === "right" ? 2 : 0;
  ctx.fillRect(px + size / 2 - 3 + eyeOffset, cy - 5, 1.5, 1.5);
  ctx.fillRect(px + size / 2 + 1 + eyeOffset, cy - 5, 1.5, 1.5);

  ctx.fillStyle = "#cf3a3a";
  ctx.fillRect(px + size / 2 - 6, cy - 11, 12, 4);

  ctx.fillStyle = "#2a4a7a";
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
): void {
  const bobY = Math.sin(step / 220 + px) * 0.8;
  const cy = py + size / 2 + bobY;

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(px + size / 2, py + size - 4, size / 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const palette = NPC_PALETTE[sprite] ?? NPC_PALETTE.default!;
  const headColor = palette.head;
  const bodyColor = palette.body;
  const accent = palette.accent;

  ctx.fillStyle = headColor;
  ctx.fillRect(px + size / 2 - 5, cy - 8, 10, 10);

  ctx.fillStyle = "#0a0a0a";
  const eyeOffset = facing === "left" ? -2 : facing === "right" ? 2 : 0;
  ctx.fillRect(px + size / 2 - 3 + eyeOffset, cy - 5, 1.5, 1.5);
  ctx.fillRect(px + size / 2 + 1 + eyeOffset, cy - 5, 1.5, 1.5);

  ctx.fillStyle = accent;
  ctx.fillRect(px + size / 2 - 6, cy - 12, 12, 4);

  ctx.fillStyle = bodyColor;
  ctx.fillRect(px + size / 2 - 7, cy + 2, 14, 12);

  ctx.fillStyle = "#1a1a1a";
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
  professor: { head: "#f7d4a0", body: "#5a3a8a", accent: "#f0f0f0" },
  mechanic: { head: "#f0c896", body: "#7a3a3a", accent: "#cf3a3a" },
  rider: { head: "#f7d4a0", body: "#3a8a5a", accent: "#ffd166" },
  "gym-leader": { head: "#f0c896", body: "#3a3a3a", accent: "#ffd166" },
  sign: { head: "#7a5a3a", body: "#5a4530", accent: "#3a2a1a" },
  default: { head: "#f7d4a0", body: "#444444", accent: "#999999" },
};
