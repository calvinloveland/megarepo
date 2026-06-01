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

  it("gas swaps with denser material above when material has state", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const gas = 1;
    const sand = 2;
    densityById.set(gas, 0.2);
    densityById.set(sand, 2.0);
    tagsById.set(sand, ["solid"]); // has state → not static → can swap
    const idx = 1 + 1 * width;
    grid[idx] = gas;
    grid[1 + 0 * width] = sand;

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
    expect(nextGrid[idx]).toBe(sand);
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

  it("gas does not move through truly static materials", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const gas = 1;
    const wall = 2;
    densityById.set(gas, 0.2);
    densityById.set(wall, 10);
    // No state tag = truly static
    tagsById.set(wall, ["element"]);
    const idx = 1 + 1 * width;
    grid[idx] = gas;
    grid[1 + 0 * width] = wall;
    // Empty diagonal for escape
    grid[0 + 0 * width] = 0;

    const moved = stepByTags(["gas"], gas, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });

    // Gas cannot swap with the static wall above (isStatic check)
    // First candidate {0,-1} blocked. Next: {-1,-1} goes to (0,0) which is empty
    expect(moved).toBe(true);
    expect(nextGrid[0 + 0 * width]).toBe(gas);
    // Wall stays untouched
    expect(nextGrid[1 + 0 * width]).toBe(0);
  });

  it("light solid floats on dense liquid (full water layer below)", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const wood = 1;
    const water = 2;
    densityById.set(wood, 0.7);
    densityById.set(water, 1.0);
    tagsById.set(wood, ["solid"]);
    tagsById.set(water, ["liquid", "water"]);
    const idx = 1 + 0 * width;
    grid[idx] = wood;
    // Fill entire row below with water so wood can't slide diagonally
    for (let x = 0; x < width; x++) {
      grid[x + 1 * width] = water;
    }

    // Wood tries to fall. {0,1} → water (density 1.0)
    // shouldSwap = (dy=1, 0.7 > 1.0) = false → floats
    const moved = stepByTags(["solid"], wood, 1, 0, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(false);
    // No water cells should be taken
    for (let x = 0; x < width; x++) {
      expect(nextGrid[x + 1 * width]).toBe(0);
    }
  });

  it("dense solid sinks through lighter liquid", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const stone = 1;
    const water = 2;
    densityById.set(stone, 2.5);
    densityById.set(water, 1.0);
    tagsById.set(stone, ["solid"]);
    tagsById.set(water, ["liquid", "water"]);
    const idx = 1 + 0 * width;
    grid[idx] = stone;
    grid[1 + 1 * width] = water;

    const moved = stepByTags(["solid"], stone, 1, 0, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(true);
    expect(nextGrid[1 + 1 * width]).toBe(stone);
    expect(nextGrid[idx]).toBe(water);
  });

  it("gas rises through denser liquid", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const bubble = 1;
    const water = 2;
    densityById.set(bubble, 0.2);
    densityById.set(water, 1.0);
    tagsById.set(bubble, ["gas"]);
    tagsById.set(water, ["liquid", "water"]);
    const idx = 1 + 1 * width;
    grid[idx] = bubble;
    grid[1 + 0 * width] = water;

    const moved = stepByTags(["gas"], bubble, 1, 1, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(true);
    expect(nextGrid[1 + 0 * width]).toBe(bubble);
    expect(nextGrid[idx]).toBe(water);
  });

  it("denser liquid sinks through lighter liquid (layering)", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const densityById = new Map<number, number>();
    const tagsById = new Map<number, string[]>();
    const brine = 1;
    const oil = 2;
    densityById.set(brine, 1.2);
    densityById.set(oil, 0.9);
    tagsById.set(brine, ["liquid", "water"]);
    tagsById.set(oil, ["liquid", "flammable"]);
    const idx = 1 + 0 * width;
    grid[idx] = brine;
    grid[1 + 1 * width] = oil;

    const moved = stepByTags(["liquid"], brine, 1, 0, idx, {
      width,
      height,
      grid,
      nextGrid,
      densityById,
      tagsById,
      rng: () => 0.2,
    });
    expect(moved).toBe(true);
    expect(nextGrid[1 + 1 * width]).toBe(brine);
    expect(nextGrid[idx]).toBe(oil);
  });
});
