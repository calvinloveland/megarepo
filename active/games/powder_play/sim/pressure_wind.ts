import { attemptMoves, type MoveCandidate } from "./tag_movement";

export type PressureFieldContext = {
  width: number;
  height: number;
  grid: Uint16Array;
  pressure: Float32Array;
  densityById: Map<number, number>;
  tagsById: Map<number, string[]>;
};

export type WindContext = {
  width: number;
  height: number;
  grid: Uint16Array;
  nextGrid: Uint16Array;
  pressure: Float32Array;
  densityById: Map<number, number>;
  tagsById: Map<number, string[]>;
  reacted: Uint8Array;
};

const PRESSURE_DIFFUSE = 0.24;
const PRESSURE_DECAY = 0.92;
const PRESSURE_GAS = 0.42;
const PRESSURE_FIRE = 0.25;
const PRESSURE_COMPRESSION = 0.18;
const WIND_FORCE_DENSITY = 1.2;
const MIN_WIND_GRADIENT = 0.14;

const NEIGHBORS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

function pressureAt(
  pressure: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  if (x < 0 || x >= width || y < 0 || y >= height) return 0;
  return pressure[y * width + x] || 0;
}

export function pressureGradientAt(
  pressure: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const left = pressureAt(pressure, width, height, x - 1, y);
  const right = pressureAt(pressure, width, height, x + 1, y);
  const up = pressureAt(pressure, width, height, x, y - 1);
  const down = pressureAt(pressure, width, height, x, y + 1);
  const dx = left - right;
  const dy = up - down;
  return { dx, dy, magnitude: Math.hypot(dx, dy) };
}

export function simulatePressureField(ctx: PressureFieldContext) {
  const { width, height, grid, pressure, densityById, tagsById } = ctx;
  const nextPressure = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[idx];
      const tags = cell ? tagsById.get(cell) || [] : [];
      const density = cell ? densityById.get(cell) ?? 1 : 1;
      const isAmbient = tags.includes("ambient");
      const isGas = (tags.includes("gas") || tags.includes("float")) && !isAmbient;
      const isFire = tags.includes("fire");

      let neighborSum = 0;
      let occupiedNeighbors = 0;
      for (const d of NEIGHBORS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nidx = ny * width + nx;
        neighborSum += pressure[nidx] || 0;
        if (grid[nidx] !== 0) occupiedNeighbors++;
      }
      const avgNeighbor = neighborSum / NEIGHBORS.length;

      let source = 0;
      if (isFire) source += PRESSURE_FIRE;
      if (isGas && density < 0.35) source += PRESSURE_GAS;
      if (cell !== 0 && !isAmbient && (isGas || isFire || density < 0.6) && occupiedNeighbors >= 2) {
        source += (occupiedNeighbors - 1) * PRESSURE_COMPRESSION;
      }

      const oldP = (pressure[idx] || 0) * PRESSURE_DECAY;
      const diffused = (avgNeighbor - oldP) * PRESSURE_DIFFUSE;
      nextPressure[idx] = Math.max(0, oldP + source + diffused);
    }
  }

  return nextPressure;
}

function toAxisStep(value: number) {
  if (value > 0.001) return 1;
  if (value < -0.001) return -1;
  return 0;
}

function buildWindCandidates(dx: number, dy: number): MoveCandidate[] {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const sx = toAxisStep(dx);
  const sy = toAxisStep(dy);
  const candidates: MoveCandidate[] = [];

  if (absX >= absY) {
    if (sx) candidates.push({ dx: sx, dy: 0 });
    if (sx && sy) candidates.push({ dx: sx, dy: sy });
    if (sy) candidates.push({ dx: 0, dy: sy });
  } else {
    if (sy) candidates.push({ dx: 0, dy: sy });
    if (sx && sy) candidates.push({ dx: sx, dy: sy });
    if (sx) candidates.push({ dx: sx, dy: 0 });
  }

  return candidates;
}

export function applyPressureWind(ctx: WindContext) {
  const { width, height, grid, nextGrid, pressure, densityById, tagsById, reacted } = ctx;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[idx];
      if (cell === 0 || reacted[idx]) continue;

      const tags = tagsById.get(cell) || [];
      if (tags.includes("drain") || tags.includes("source")) continue;

      const density = densityById.get(cell) ?? 1;
      if (density > WIND_FORCE_DENSITY) continue;

      const gradient = pressureGradientAt(pressure, width, height, x, y);
      const densityScale = Math.max(0.45, density / WIND_FORCE_DENSITY);
      if (gradient.magnitude < MIN_WIND_GRADIENT * densityScale) continue;

      const candidates = buildWindCandidates(gradient.dx, gradient.dy);
      if (!candidates.length) continue;

      const moved = attemptMoves(cell, x, y, idx, candidates, {
        width,
        height,
        grid,
        nextGrid,
        densityById,
        tagsById,
      });
      if (moved) reacted[idx] = 1;
    }
  }
}
