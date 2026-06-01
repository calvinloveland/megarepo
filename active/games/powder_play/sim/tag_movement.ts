/**
 * Movement system driven by state (solid/liquid/gas) and density.
 *
 * State determines movement direction and spread behavior:
 *   solid  → falls down, slides diagonally to form piles
 *   liquid → falls down, spreads laterally, finds level
 *   gas    → floats up, spreads laterally
 *
 * Density determines buoyancy: higher density sinks below lower density.
 *
 * Backward compatibility: old tags (sand, flow, float, static) map to
 * (solid, liquid, gas, solid) automatically.
 */

export type MoveCandidate = { dx: number; dy: number };

export type MovementContext = {
  width: number;
  height: number;
  grid: Uint16Array;
  nextGrid: Uint16Array;
  densityById: Map<number, number>;
  tagsById?: Map<number, string[]>;
  rng?: () => number;
};

/**
 * Resolve physical state from tags.
 * Returns null when no movement tag is present (material is static).
 * Backward compatible with legacy sand/flow/float tags.
 */
function resolveState(tags: string[]): "solid" | "liquid" | "gas" | null {
  if (tags.includes("gas")) return "gas";
  if (tags.includes("liquid")) return "liquid";
  if (tags.includes("solid")) return "solid";
  // Legacy tags
  if (tags.includes("float")) return "gas";
  if (tags.includes("flow")) return "liquid";
  if (tags.includes("sand")) return "solid";
  return null; // static — no movement
}

export function stepByTags(
  tags: string[],
  cell: number,
  x: number,
  y: number,
  idx: number,
  ctx: MovementContext,
) {
  const state = resolveState(tags);
  if (!state) return false; // solid with no movement = static

  const rng = ctx.rng ?? Math.random;
  const blockStatic = tags.includes("fire");
  const [dx1, dx2] = rng() < 0.5 ? [-1, 1] : [1, -1];

  if (state === "gas") {
    // Float upward, spread laterally
    const candidates: MoveCandidate[] = [
      { dx: 0, dy: -1 },
      { dx: dx1, dy: -1 },
      { dx: dx2, dy: -1 },
      { dx: dx1, dy: 0 },
      { dx: dx2, dy: 0 },
    ];
    return attemptMoves(cell, x, y, idx, candidates, ctx, { blockStatic });
  }

  if (state === "liquid") {
    // Fall down, spread laterally, find level
    const candidates: MoveCandidate[] = [
      { dx: 0, dy: 1 },
      { dx: dx1, dy: 1 },
      { dx: dx2, dy: 1 },
      { dx: dx1, dy: 0 },
      { dx: dx2, dy: 0 },
    ];
    return attemptMoves(cell, x, y, idx, candidates, ctx, { blockStatic });
  }

  // Solid (sand-like): fall down, slide diagonally to form piles
  const candidates: MoveCandidate[] = [
    { dx: 0, dy: 1 },
    { dx: dx1, dy: 1 },
    { dx: dx2, dy: 1 },
  ];
  return attemptMoves(cell, x, y, idx, candidates, ctx, { blockStatic });
}

export function attemptMoves(
  cell: number,
  x: number,
  y: number,
  idx: number,
  candidates: MoveCandidate[],
  ctx: MovementContext,
  options?: { blockStatic?: boolean },
) {
  const { width, height, grid, nextGrid, densityById, tagsById } = ctx;
  const dSelf = densityById.get(cell) ?? 1;
  const blockStatic = options?.blockStatic ?? false;
  for (const c of candidates) {
    const nx = x + c.dx;
    const ny = y + c.dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const nidx = ny * width + nx;
    if (nextGrid[nidx] !== 0) continue;
    const target = grid[nidx];
    if (target === 0) {
      nextGrid[nidx] = cell;
      return true;
    }
    if (blockStatic && tagsById?.get(target)?.includes("static")) {
      continue;
    }
    const dTarget = densityById.get(target) ?? 1;
    const shouldSwap =
      (c.dy > 0 && dSelf > dTarget) || (c.dy < 0 && dSelf < dTarget);
    if (
      shouldSwap &&
      nextGrid[idx] === 0 &&
      (nextGrid[nidx] === 0 || nextGrid[nidx] === target)
    ) {
      if (blockStatic && tagsById?.get(target)?.includes("static")) {
        continue;
      }
      nextGrid[nidx] = cell;
      nextGrid[idx] = target;
      return true;
    }
  }
  return false;
}
