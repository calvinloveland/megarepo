import { describe, it, expect } from "vitest";
import { stepByTags } from "../../sim/tag_movement";

describe("tag movement", () => {
  it("moves sand downward when empty", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const cell = 1;
    densityById.set(cell, 2);
    const idx = 1 + 1 * width;
    grid[idx] = cell;

    const moved = stepByTags(["sand"], cell, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      rng: () => 0.2,
    });

    expect(moved).toBe(true);
    expect(nextGrid[1 + 2 * width]).toBe(cell);
  });

  it("sand falls diagonally when blocked", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const cell = 1;
    const blocker = 2;
    densityById.set(cell, 1);
    densityById.set(blocker, 2);
    const idx = 1 + 1 * width;
    grid[idx] = cell;
    grid[1 + 2 * width] = blocker;

    const moved = stepByTags(["sand"], cell, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      rng: () => 0.1,
    });

    expect(moved).toBe(true);
    expect(nextGrid[0 + 2 * width]).toBe(cell);
  });

  it("flow spreads laterally when blocked below", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const cell = 1;
    const blocker = 2;
    densityById.set(cell, 1);
    densityById.set(blocker, 2);
    const idx = 1 + 1 * width;
    grid[idx] = cell;
    grid[1 + 2 * width] = blocker;
    grid[0 + 2 * width] = blocker;
    grid[2 + 2 * width] = blocker;

    const moved = stepByTags(["flow"], cell, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      rng: () => 0.9,
    });

    expect(moved).toBe(true);
    expect(nextGrid[2 + 1 * width]).toBe(cell);
  });

  it("float rises upward through heavier material", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const cell = 1;
    const heavy = 2;
    densityById.set(cell, 0.2);
    densityById.set(heavy, 2.0);
    const idx = 1 + 1 * width;
    grid[idx] = cell;
    grid[1 + 0 * width] = heavy;

    const moved = stepByTags(["float"], cell, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      rng: () => 0.4,
    });

    expect(moved).toBe(true);
    expect(nextGrid[1 + 0 * width]).toBe(cell);
    expect(nextGrid[idx]).toBe(heavy);
  });
});
