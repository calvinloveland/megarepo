import { describe, expect, it } from "vitest";

import {
  braidMaze,
  carveRooms,
  generateMaze,
  isMazeConnected,
  isMazePerfect,
  openCells,
  solveMaze,
} from "../../src/engine/maze.js";
import { createRng } from "../../src/engine/rng.js";

describe("maze", () => {
  it("generates a connected maze with an entrance and an exit you can reach", () => {
    const maze = generateMaze({ width: 21, height: 15, seed: "quarry" });
    expect(maze.width).toBe(21);
    expect(maze.height).toBe(15);
    expect(maze.rows).toHaveLength(15);
    expect(maze.rows[0]).toHaveLength(21);
    expect(maze.grid.get(maze.entrance.x, maze.entrance.y)).toBe(maze.floor);
    expect(maze.grid.get(maze.exit.x, maze.exit.y)).toBe(maze.floor);
    expect(isMazeConnected(maze)).toBe(true);
    expect(solveMaze(maze, maze.entrance, maze.exit)).not.toBeNull();
  });

  it("rounds even dimensions down to odd, and refuses anything smaller", () => {
    const maze = generateMaze({ width: 12, height: 8, seed: "x" });
    expect(maze.width).toBe(11);
    expect(maze.height).toBe(7);
    expect(() => generateMaze({ width: 2, height: 2 })).toThrow(/at least 3x3/);
  });

  it("is deterministic per seed and confirms it is a perfect maze", () => {
    const first = generateMaze({ width: 17, height: 17, seed: "salt-road" });
    const second = generateMaze({ width: 17, height: 17, seed: "salt-road" });
    expect(second.rows).toEqual(first.rows);
    expect(isMazePerfect(first)).toBe(true);
    expect(isMazePerfect(second)).toBe(true);

    const other = generateMaze({ width: 17, height: 17, seed: "canyon" });
    expect(other.rows).not.toEqual(first.rows);
  });

  it("braids dead ends into loops on purpose", () => {
    const perfect = generateMaze({ width: 17, height: 17, seed: "quiet" });
    const braided = generateMaze({ width: 17, height: 17, seed: "quiet", braid: 1 });
    expect(isMazePerfect(braided)).toBe(false);
    expect(isMazeConnected(braided)).toBe(true);
    expect(openCells(braided).length).toBeGreaterThan(openCells(perfect).length);

    // Braiding is idempotent enough to survive being asked twice.
    const twice = braidMaze(braided, 1, createRng("again"));
    expect(isMazeConnected(twice)).toBe(true);

    // A chance of 0 leaves it perfect.
    expect(isMazePerfect(braidMaze(perfect, 0, createRng("none")))).toBe(true);
  });

  it("carves rooms without disconnecting the maze", () => {
    const maze = generateMaze({ width: 21, height: 19, seed: "cut" });
    const before = openCells(maze).length;
    carveRooms(maze, { count: 3, minSize: 3, maxSize: 5, rng: createRng("rooms") });
    expect(openCells(maze).length).toBeGreaterThan(before);
    expect(isMazeConnected(maze)).toBe(true);
    expect(maze.rows).toEqual(maze.grid.rows());
  });

  it("reports when two tiles are walled off from each other", () => {
    const maze = generateMaze({ width: 11, height: 11, seed: "wall" });
    const walled = solveMaze(maze, { x: 0, y: 0 }, maze.exit);
    expect(walled).toBeNull();
    // A wall is not a starting point either.
    expect(solveMaze(maze, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});
