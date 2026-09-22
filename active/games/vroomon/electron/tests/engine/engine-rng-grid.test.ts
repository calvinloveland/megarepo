import { describe, expect, it } from "vitest";

import { createRng, hashSeed } from "../../src/engine/rng.js";
import {
  createGrid,
  findPath,
  floodFill,
  gridFromRows,
  inBounds,
  neighbors4,
  parseTileKey,
  tileKey,
} from "../../src/engine/grid.js";

describe("rng", () => {
  it("reproduces the same stream from the same seed", () => {
    const first = createRng("hedge");
    const second = createRng("hedge");
    const other = createRng("meadow");
    const left = Array.from({ length: 8 }, () => first.next());
    expect(Array.from({ length: 8 }, () => second.next())).toEqual(left);
    expect(Array.from({ length: 8 }, () => other.next())).not.toEqual(left);
  });

  it("keeps int, range and bool inside their promises", () => {
    const rng = createRng(7);
    for (let index = 0; index < 200; index += 1) {
      const integer = rng.int(6);
      expect(integer).toBeGreaterThanOrEqual(0);
      expect(integer).toBeLessThan(6);
      const value = rng.range(-2, 3);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThan(3);
    }
    expect(rng.int(0)).toBe(0);
    expect(rng.bool(0)).toBe(false);
    expect(rng.bool(1)).toBe(true);
    expect(createRng("always").bool()).toBeTypeOf("boolean");
  });

  it("picks, shuffles without mutating, and throws rather than returning nothing", () => {
    const rng = createRng("pick");
    const source = ["a", "b", "c", "d", "e"];
    expect(source).toContain(rng.pick(source));
    const shuffled = rng.shuffle(source);
    expect([...shuffled].sort()).toEqual([...source].sort());
    expect(source).toEqual(["a", "b", "c", "d", "e"]);
    expect(() => rng.pick([])).toThrow(/empty list/);
  });

  it("forks into a deterministic, independent stream", () => {
    const parent = createRng("world");
    const forkA = parent.fork("maze");
    const forkB = createRng("world").fork("maze");
    expect(forkA.next()).toBe(forkB.next());
    // Drawing from the fork does not move the parent.
    const before = createRng("world").next();
    parent.fork("noise").next();
    expect(parent.next()).toBe(createRng("world").next());
    void before;
  });

  it("hashes names and numbers stably", () => {
    expect(hashSeed("hedge")).toBe(hashSeed("hedge"));
    expect(hashSeed("hedge")).not.toBe(hashSeed("hedges"));
    expect(hashSeed(42)).toBe(42);
    expect(createRng("x").seed).toBe(hashSeed("x"));
  });
});

describe("grid", () => {
  it("builds, reads and writes with bounds checking", () => {
    const grid = createGrid(3, 2, (x, y) => `${x}${y}`);
    expect(grid.width).toBe(3);
    expect(grid.height).toBe(2);
    expect(grid.get(2, 1)).toBe("21");
    expect(grid.get(3, 0)).toBeUndefined();
    expect(grid.get(-1, 0)).toBeUndefined();
    expect(grid.inBounds(2, 1)).toBe(true);
    expect(grid.inBounds(3, 1)).toBe(false);
    grid.set(0, 0, "x");
    expect(grid.get(0, 0)).toBe("x");
    expect(() => grid.set(3, 0, "y")).toThrow(/outside/);
    expect(grid.values()).toHaveLength(6);
    expect(grid.rows()[1]).toEqual(["01", "11", "21"]);
    expect(grid.count((value) => value === "x")).toBe(1);
    expect(grid.find((value) => value === "21")).toEqual({ x: 2, y: 1 });
    expect(grid.find(() => false)).toBeNull();
  });

  it("refuses ragged rows instead of guessing a width", () => {
    expect(() => gridFromRows([[1, 2], [3]])).toThrow(/expected 2/);
  });

  it("has the neighbourhood and key helpers the rest of the engine uses", () => {
    expect(neighbors4(2, 2)).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
    ]);
    expect(parseTileKey(tileKey(4, 9))).toEqual({ x: 4, y: 9 });
    expect(inBounds(3, 3, 2, 2)).toBe(true);
    expect(inBounds(3, 3, 3, 2)).toBe(false);
  });

  it("floods through open ground and stops at walls", () => {
    const grid = gridFromRows([
      [".", ".", "#"],
      ["#", ".", "#"],
      ["#", ".", "."],
    ]);
    const reached = floodFill(grid, [{ x: 0, y: 0 }], (value) => value === ".");
    expect([...reached].sort()).toEqual(["0,0", "1,0", "1,1", "1,2", "2,2"].sort());
  });

  it("finds the shortest path and reports when there is none", () => {
    const grid = gridFromRows([
      [".", ".", "."],
      ["#", "#", "."],
      [".", ".", "."],
    ]);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 0, y: 2 }, (value) => value === ".");
    expect(path?.[0]).toEqual({ x: 0, y: 0 });
    expect(path?.at(-1)).toEqual({ x: 0, y: 2 });
    expect(path).toHaveLength(7);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 0, y: 0 }, (value) => value === ".")).toEqual([
      { x: 0, y: 0 },
    ]);

    const walled = gridFromRows([
      [".", "#", "."],
      ["#", "#", "#"],
      [".", "#", "."],
    ]);
    expect(findPath(walled, { x: 0, y: 0 }, { x: 2, y: 2 }, (value) => value === ".")).toBeNull();
  });
});
