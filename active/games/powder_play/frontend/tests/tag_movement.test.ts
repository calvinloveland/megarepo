import { describe, it, expect } from "vitest";
import { stepByTags } from "../../sim/tag_movement";

describe("tag movement with state tags", () => {
  it("moves solid downward when empty", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const cell = 1;
    densityById.set(cell, 2);
    const idx = 1 + 1 * width;
    grid[idx] = cell;

    const moved = stepByTags(["solid"], cell, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });

    expect(moved).toBe(true);
    expect(nextGrid[1 + 2 * width]).toBe(cell);
  });

  it("moves liquid downward and spreads laterally", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const water = 1;
    densityById.set(water, 1);
    const idx = 1 + 0 * width;
    grid[idx] = water;

    const moved = stepByTags(["liquid", "water"], water, 1, 0, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });

    expect(moved).toBe(true);
    // rng 0.2 → dx1=-1, dx2=1
    // First candidate: {dx:0, dy:1} → (1,1) is empty → moves there
    expect(nextGrid[1 + 1 * width]).toBe(water);
  });

  it("moves gas upward", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const steam = 1;
    densityById.set(steam, 0.2);
    const idx = 1 + 1 * width;
    grid[idx] = steam;

    const moved = stepByTags(["gas", "steam"], steam, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });

    expect(moved).toBe(true);
    // First candidate: {dx:0, dy:-1} → (1,0) is empty → moves there
    expect(nextGrid[1 + 0 * width]).toBe(steam);
  });

  it("gas swaps with denser material above", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const gas = 1;
    const heavy = 2;
    densityById.set(gas, 0.2);
    densityById.set(heavy, 2.0);
    const idx = 1 + 1 * width;
    grid[idx] = gas;
    grid[1 + 0 * width] = heavy;

    const moved = stepByTags(["gas"], gas, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.4,
    });

    expect(moved).toBe(true);
    expect(nextGrid[1 + 0 * width]).toBe(gas);
    expect(nextGrid[idx]).toBe(heavy);
  });

  it("no movement when no state tag is present (static)", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const wall = 1;
    densityById.set(wall, 10);
    const idx = 1 + 1 * width;
    grid[idx] = wall;

    // No state tag = static = no movement
    const moved = stepByTags([], wall, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });

    expect(moved).toBe(false);
    expect(nextGrid[idx]).toBe(0);
  });
});

describe("backward compatibility with legacy tags", () => {
  it("handles legacy 'sand' tag as solid movement", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
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
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(true);
    expect(nextGrid[1 + 2 * width]).toBe(cell);
  });

  it("handles legacy 'flow' tag as liquid movement", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const water = 1;
    densityById.set(water, 1);
    const idx = 1 + 0 * width;
    grid[idx] = water;

    const moved = stepByTags(["flow", "water"], water, 1, 0, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(true);
  });

  it("handles legacy 'float' tag as gas movement", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const steam = 1;
    densityById.set(steam, 0.2);
    const idx = 1 + 1 * width;
    grid[idx] = steam;

    const moved = stepByTags(["float", "steam"], steam, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(true);
    expect(nextGrid[1 + 0 * width]).toBe(steam);
  });

  it("fire does not move into static walls (legacy behavior preserved)", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const fire = 1;
    const wall = 2;
    densityById.set(fire, 0.2);
    densityById.set(wall, 2.0);
    tagsById.set(wall, ["static"]);
    const idx = 1 + 1 * width;
    grid[idx] = fire;
    // Wall directly above — fire should not move into it but can move to empty diagonal
    grid[1 + 0 * width] = wall;

    const moved = stepByTags(["gas", "fire"], fire, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2, // 0.2 < 0.5 → dx1=-1, dx2=1
    });

    // Fire should move diagonally up-left (0,0) since that's empty
    expect(moved).toBe(true);
    expect(nextGrid[0 + 0 * width]).toBe(fire);
    // The wall should stay untouched
    expect(nextGrid[1 + 0 * width]).toBe(0);
  });
});
