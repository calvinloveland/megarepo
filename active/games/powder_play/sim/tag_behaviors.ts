export type TagBehaviorContext = {
  width: number;
  height: number;
  grid: Uint16Array;
  nextGrid: Uint16Array;
  tagsById: Map<number, string[]>;
  nameToId: Map<string, number>;
  reacted: Uint8Array;
  rng?: () => number;
};

type Vec = { dx: number; dy: number };

const dirs: Vec[] = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

const explosionOffsets: Vec[] = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
];

function hasTag(tagsById: Map<number, string[]>, id: number, tag: string) {
  const tags = tagsById.get(id);
  return Array.isArray(tags) && tags.includes(tag);
}

function placeCell(nextGrid: Uint16Array, idx: number, id?: number) {
  if (!id) return false;
  if (nextGrid[idx] !== 0) return false;
  nextGrid[idx] = id;
  return true;
}

export function applyTagBehaviors(
  cell: number,
  x: number,
  y: number,
  idx: number,
  tags: string[],
  ctx: TagBehaviorContext,
) {
  const rng = ctx.rng ?? Math.random;
  const { width, height, grid, nextGrid, tagsById, nameToId, reacted } = ctx;
  let consumed = false;

  const isReactiveWater = tags.includes("reactive_water");
  const isExplosive = tags.includes("explosive");
  const isFire = tags.includes("fire");
  const burnsOut = tags.includes("burns_out");
  const isSeed = tags.includes("seed");
  const isPlant = tags.includes("plant");
  const canGrow = tags.includes("grow");

  if (isReactiveWater) {
    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (reacted[nidx]) continue;
      const ncell = grid[nidx];
      if (!ncell) continue;
      if (!hasTag(tagsById, ncell, "water")) continue;
      const steamId = nameToId.get("Steam");
      const smokeId = nameToId.get("Smoke");
      placeCell(nextGrid, idx, steamId ?? smokeId);
      reacted[idx] = 1;
      placeCell(nextGrid, nidx, steamId ?? smokeId);
      reacted[nidx] = 1;
      if (isExplosive) {
        for (const e of explosionOffsets) {
          const ex = x + e.dx;
          const ey = y + e.dy;
          if (ex < 0 || ex >= width || ey < 0 || ey >= height) continue;
          const eidx = ey * width + ex;
          if (reacted[eidx]) continue;
          if (rng() < 0.6) {
            placeCell(nextGrid, eidx, smokeId ?? steamId);
            reacted[eidx] = 1;
          }
        }
      }
      return { consumed: true };
    }
  }

  if (isSeed) {
    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (reacted[nidx]) continue;
      const ncell = grid[nidx];
      if (!ncell) continue;
      if (!hasTag(tagsById, ncell, "mud")) continue;
      const plantId = nameToId.get("Plant");
      const dirtId = nameToId.get("Dirt");
      placeCell(nextGrid, idx, plantId);
      reacted[idx] = 1;
      if (dirtId) placeCell(nextGrid, nidx, dirtId);
      reacted[nidx] = 1;
      return { consumed: true };
    }
  }

  if (isFire) {
    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nidx = ny * width + nx;
      if (reacted[nidx]) continue;
      const ncell = grid[nidx];
      if (!ncell) continue;
      if (hasTag(tagsById, ncell, "water") && rng() < 0.5) {
        const steamId = nameToId.get("Steam");
        if (steamId) {
          placeCell(nextGrid, idx, steamId);
          placeCell(nextGrid, nidx, steamId);
        }
        reacted[idx] = 1;
        reacted[nidx] = 1;
        return { consumed: true };
      }
      if (hasTag(tagsById, ncell, "flammable") && rng() < 0.35) {
        placeCell(nextGrid, nidx, cell);
        reacted[nidx] = 1;
      }
    }
  }

  if (burnsOut && rng() < 0.03) {
    const smokeId = nameToId.get("Smoke");
    placeCell(nextGrid, idx, smokeId);
    reacted[idx] = 1;
    consumed = true;
  }

  if (isPlant && canGrow && rng() < 0.06) {
    const plantId = nameToId.get("Plant");
    if (plantId) {
      const ny = y - 1;
      if (ny >= 0) {
        const nidx = ny * width + x;
        if (grid[nidx] === 0 && nextGrid[nidx] === 0 && !reacted[nidx]) {
          nextGrid[nidx] = plantId;
          reacted[nidx] = 1;
        }
      }
    }
  }

  return { consumed };
}
