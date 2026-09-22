/**
 * Maze generation.
 *
 * A perfect maze on an odd-sized grid (a recursive-backtracker), plus optional
 * braiding so it can be a loop rather than a trap, plus rooms and a solver.
 * Output is rows of tile ids, so the same call feeds a hand-authored map and a
 * generated one.
 */

import type { Cell, Grid } from "./grid.js";
import { createGrid, findPath, tileKey } from "./grid.js";
import { createRng, type Rng } from "./rng.js";

export const MAZE_WALL = "#";
export const MAZE_FLOOR = ".";

export interface MazeOptions {
  width: number;
  height: number;
  seed?: string | number;
  rng?: Rng;
  wall?: string;
  floor?: string;
  /** 0..1 chance of opening one wall at each dead end, turning traps into loops. */
  braid?: number;
}

export interface Maze {
  width: number;
  height: number;
  rows: string[][];
  grid: Grid<string>;
  wall: string;
  floor: string;
  entrance: Cell;
  exit: Cell;
  rng: Rng;
}

export function isFloor(maze: Maze, x: number, y: number): boolean {
  return maze.grid.get(x, y) === maze.floor;
}

/** Generate a connected maze. Even dimensions are rounded down to odd. */
export function generateMaze(options: MazeOptions): Maze {
  const width = oddFloor(options.width);
  const height = oddFloor(options.height);
  if (options.width < 3 || options.height < 3) {
    throw new Error(`generateMaze needs at least 3x3, got ${options.width}x${options.height}`);
  }
  const wall = options.wall ?? MAZE_WALL;
  const floor = options.floor ?? MAZE_FLOOR;
  const rng = options.rng ?? createRng(options.seed ?? "maze");

  const grid = createGrid(width, height, wall);
  const cellsX = (width - 1) / 2;
  const cellsY = (height - 1) / 2;
  const cellAt = (col: number, row: number): Cell => ({ x: col * 2 + 1, y: row * 2 + 1 });

  const visited = new Set<string>();
  const start = cellAt(0, 0);
  visited.add(tileKey(start.x, start.y));
  grid.set(start.x, start.y, floor);
  const stack: Cell[] = [start];

  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    const col = (current.x - 1) / 2;
    const row = (current.y - 1) / 2;
    const candidates: { cell: Cell; wall: Cell }[] = [];
    const moves: Array<[number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    for (const [dx, dy] of moves) {
      const nextCol = col + dx;
      const nextRow = row + dy;
      if (nextCol < 0 || nextRow < 0 || nextCol >= cellsX || nextRow >= cellsY) {
        continue;
      }
      const cell = cellAt(nextCol, nextRow);
      if (visited.has(tileKey(cell.x, cell.y))) {
        continue;
      }
      candidates.push({
        cell,
        wall: { x: current.x + dx, y: current.y + dy },
      });
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const chosen = rng.pick(candidates);
    grid.set(chosen.wall.x, chosen.wall.y, floor);
    grid.set(chosen.cell.x, chosen.cell.y, floor);
    visited.add(tileKey(chosen.cell.x, chosen.cell.y));
    stack.push(chosen.cell);
  }

  const maze: Maze = {
    width,
    height,
    rows: grid.rows(),
    grid,
    wall,
    floor,
    entrance: { x: 1, y: 1 },
    exit: { x: width - 2, y: height - 2 },
    rng,
  };

  if ((options.braid ?? 0) > 0) {
    braidMaze(maze, options.braid!);
  }

  return maze;
}

/**
 * Open one wall at each dead end with the given probability. A perfect maze is
 * a single path between any two tiles, which is a fine puzzle and a miserable
 * place to be lost; braiding makes loops.
 */
export function braidMaze(maze: Maze, chance: number, rng: Rng = maze.rng): Maze {
  const deadEnds = openCells(maze).filter((cell) => openNeighbors(maze, cell).length === 1);
  for (const cell of deadEnds) {
    if (!rng.bool(chance)) {
      continue;
    }
    const options: Cell[] = [];
    for (const direction of [
      { x: 0, y: -2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: -2, y: 0 },
    ]) {
      const wall = { x: cell.x + direction.x / 2, y: cell.y + direction.y / 2 };
      const beyond = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (maze.grid.get(wall.x, wall.y) === maze.wall && maze.grid.get(beyond.x, beyond.y) === maze.floor) {
        options.push(wall);
      }
    }
    if (options.length > 0) {
      const opening = rng.pick(options);
      maze.grid.set(opening.x, opening.y, maze.floor);
    }
  }
  maze.rows = maze.grid.rows();
  return maze;
}

export interface RoomOptions {
  count: number;
  minSize?: number;
  maxSize?: number;
  floor?: string;
  rng?: Rng;
}

/**
 * Stamp rectangular rooms over the maze. Rooms are how a maze becomes a
 * dungeon: chambers to fight in, corridors to be ambushed in.
 */
export function carveRooms(maze: Maze, options: RoomOptions): Maze {
  const rng = options.rng ?? maze.rng;
  const floor = options.floor ?? maze.floor;
  const minSize = Math.max(3, options.minSize ?? 3);
  const maxSize = Math.max(minSize, options.maxSize ?? 7);

  for (let index = 0; index < options.count; index += 1) {
    const roomWidth = Math.min(maze.width - 2, minSize + rng.int(maxSize - minSize + 1));
    const roomHeight = Math.min(maze.height - 2, minSize + rng.int(maxSize - minSize + 1));
    const left = 1 + rng.int(Math.max(1, maze.width - roomWidth - 1));
    const top = 1 + rng.int(Math.max(1, maze.height - roomHeight - 1));
    for (let y = top; y < top + roomHeight; y += 1) {
      for (let x = left; x < left + roomWidth; x += 1) {
        if (x <= 0 || y <= 0 || x >= maze.width - 1 || y >= maze.height - 1) {
          continue;
        }
        maze.grid.set(x, y, floor);
      }
    }
  }
  maze.rows = maze.grid.rows();
  return maze;
}

export function openCells(maze: Maze): Cell[] {
  const out: Cell[] = [];
  maze.grid.forEach((value, x, y) => {
    if (value === maze.floor) {
      out.push({ x, y });
    }
  });
  return out;
}

export function openNeighbors(maze: Maze, cell: Cell): Cell[] {
  return [
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x - 1, y: cell.y },
  ].filter((candidate) => maze.grid.get(candidate.x, candidate.y) === maze.floor);
}

/** Shortest way through, endpoints included; null when walled off. */
export function solveMaze(maze: Maze, from: Cell, to: Cell): Cell[] | null {
  return findPath(maze.grid, from, to, (value) => value === maze.floor);
}

/**
 * True when every open cell is reachable from the entrance — the one property
 * a generated maze must have, because a pocket the player cannot walk to is
 * content that does not exist.
 */
export function isMazeConnected(maze: Maze): boolean {
  const cells = openCells(maze);
  if (cells.length === 0) {
    return false;
  }
  const reached = flood(maze, maze.entrance);
  return cells.every((cell) => reached.has(tileKey(cell.x, cell.y)));
}

/** A maze with exactly one route between any two tiles has no loops. */
export function isMazePerfect(maze: Maze): boolean {
  const cells = openCells(maze);
  if (cells.length === 0) {
    return false;
  }
  let edges = 0;
  for (const cell of cells) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      if (maze.grid.get(cell.x + dx, cell.y + dy) === maze.floor) {
        edges += 1;
      }
    }
  }
  return isMazeConnected(maze) && edges === cells.length - 1;
}

function flood(maze: Maze, start: Cell): Set<string> {
  const seen = new Set<string>();
  const queue: Cell[] = [];
  if (maze.grid.get(start.x, start.y) === maze.floor) {
    seen.add(tileKey(start.x, start.y));
    queue.push(start);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of openNeighbors(maze, current)) {
      const key = tileKey(next.x, next.y);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen;
}

function oddFloor(value: number): number {
  const floored = Math.max(3, Math.floor(value));
  return floored % 2 === 0 ? floored - 1 : floored;
}
