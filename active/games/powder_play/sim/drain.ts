export type DrainContext = {
  width: number;
  height: number;
  grid: Uint16Array;
  nextGrid: Uint16Array;
  reacted: Uint8Array;
  tagsById: Map<number, string[]>;
  nameById: Map<number, string>;
  onDrain?: (materialName: string, amount: number) => void;
};

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

export function applyDrains(ctx: DrainContext) {
  const { width, height, grid, nextGrid, reacted, tagsById, nameById, onDrain } = ctx;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[idx];
      if (cell === 0) continue;
      const tags = tagsById.get(cell) || [];
      if (!tags.includes("drain")) continue;

      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nidx = ny * width + nx;
        if (reacted[nidx]) continue;
        const target = grid[nidx];
        if (target === 0) continue;
        const targetTags = tagsById.get(target) || [];
        if (targetTags.includes("drain") || targetTags.includes("source")) continue;

        reacted[nidx] = 1;
        if (nextGrid[idx] === 0) nextGrid[idx] = cell;

        const targetName = nameById.get(target);
        if (targetName) onDrain?.(targetName, 1);
      }
    }
  }
}
