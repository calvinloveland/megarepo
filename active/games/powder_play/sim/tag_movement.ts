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

export function stepByTags(
  tags: string[],
  cell: number,
  x: number,
  y: number,
  idx: number,
  ctx: MovementContext,
) {
  const rng = ctx.rng ?? Math.random;
  if (tags.includes("static")) return false;
  const hasFloat = tags.includes("float");
  const hasFlow = tags.includes("flow");
  const hasSand = tags.includes("sand");
  const blockStatic = tags.includes("fire");
  if (hasFloat) {
    const [dx1, dx2] = rng() < 0.5 ? [-1, 1] : [1, -1];
    const candidates: MoveCandidate[] = [
      { dx: 0, dy: -1 },
      { dx: dx1, dy: -1 },
      { dx: dx2, dy: -1 },
      { dx: dx1, dy: 0 },
      { dx: dx2, dy: 0 },
    ];
    return attemptMoves(cell, x, y, idx, candidates, ctx, { blockStatic });
  }
  if (hasFlow) {
    const [dx1, dx2] = rng() < 0.5 ? [-1, 1] : [1, -1];
    const candidates: MoveCandidate[] = [
      { dx: 0, dy: 1 },
      { dx: dx1, dy: 1 },
      { dx: dx2, dy: 1 },
      { dx: dx1, dy: 0 },
      { dx: dx2, dy: 0 },
    ];
    return attemptMoves(cell, x, y, idx, candidates, ctx, { blockStatic });
  }
  if (hasSand) {
    const [dx1, dx2] = rng() < 0.5 ? [-1, 1] : [1, -1];
    const candidates: MoveCandidate[] = [
      { dx: 0, dy: 1 },
      { dx: dx1, dy: 1 },
      { dx: dx2, dy: 1 },
    ];
    return attemptMoves(cell, x, y, idx, candidates, ctx, { blockStatic });
  }
  return false;
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
