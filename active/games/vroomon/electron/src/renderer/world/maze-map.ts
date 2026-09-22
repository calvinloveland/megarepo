/**
 * Generated maze maps, drawn with the tiles the overworld already has.
 *
 * This module is the seam between the engine and the game. The engine knows
 * nothing about `TileKind`; this file asks it for a maze and hands back a tile
 * grid plus the spots a map needs — the gate, a safe landing, and three places
 * to put people.
 *
 * That last job is the interesting one. A maze is a tree of corridors, and an
 * NPC standing in a corridor is a wall: a keeper dropped on the route to the
 * middle cuts the maze in half and the player never finds out why. So every
 * keeper here stands on a **dead end**, where blocking the tile costs one leaf
 * and nothing else, and the three spots are chosen by distance from the gate —
 * one near, one half-way, one at the far end.
 *
 * The same builder makes the orchard's hedge maze (fences, wild clover) and
 * the Quarry's Deep (stone walls, no grass at all).
 */

import { isMazeConnected, generateMaze, openCells, type Maze } from "../../engine/maze.js";
import { neighbors4, tileKey, type Cell } from "../../engine/grid.js";
import type { TileKind } from "./types.js";

export interface MazeMapLayout {
  width: number;
  height: number;
  tiles: TileKind[][];
  /** The gate you arrive on; stepping here walks you back out. */
  gate: Cell;
  /** One safe step inside the gate: where the outer warp lands you. */
  landing: Cell;
  /** A dead end near the gate. */
  keeper: Cell;
  /** A dead end about half-way in. */
  lost: Cell;
  /** The dead end furthest from the gate. */
  hollow: Cell;
  /** A free tile near the gate, for parking a bought decoration on. */
  decor: Cell;
  /** Open tiles carrying wild grass: the maze is hunting ground too. */
  wildTiles: number;
  /** Every tile a person can stand on, for the content checks. */
  open: Cell[];
}

export interface MazeMapOptions {
  seed: string | number;
  width?: number;
  height?: number;
  /** How the maze is named in an error, so the message says which one. */
  name?: string;
  /** Internal walls. Must be a solid tile: a maze of walkthrough hedges is not a maze. */
  wall: TileKind;
  /** The outer ring; defaults to the same tile as the walls. */
  border?: TileKind;
  floor: TileKind;
  /** A tile for the wild-grass patches. No wild tile means no encounters. */
  wildTile?: TileKind;
  /** Fraction of open tiles carrying wild grass. */
  wildShare?: number;
  /** Chance of opening a dead end into a loop. */
  braid?: number;
}

export function buildMazeMap(options: MazeMapOptions): MazeMapLayout {
  const name = options.name ?? "maze";
  const width = options.width ?? 19;
  const height = options.height ?? 15;
  const border = options.border ?? options.wall;
  const wildShare = options.wildShare ?? 0.16;
  const braid = options.braid ?? 0.18;

  // Braiding makes loops, which is kinder to walk and still leaves plenty of
  // dead ends to put people on. If a seed ever braids too well, fall back to a
  // perfect maze rather than fail.
  let maze = generateMaze({ width, height, seed: options.seed, braid });
  if (deadEnds(maze).length < 6) {
    maze = generateMaze({ width, height, seed: options.seed, braid: 0 });
  }
  if (!isMazeConnected(maze)) {
    throw new Error(`the ${name} at seed "${String(options.seed)}" came out disconnected`);
  }

  const gate: Cell = { x: maze.entrance.x, y: maze.entrance.y };
  const landing: Cell = { x: gate.x, y: gate.y + 1 };
  const distance = distancesFrom(maze, gate);
  const leaves = deadEnds(maze);

  // The gate itself is excluded: it is the way out, not a spot to stand.
  const candidates = leaves.filter((cell) => tileKey(cell.x, cell.y) !== tileKey(gate.x, gate.y));
  if (candidates.length < 3) {
    throw new Error(`the ${name} needs three dead ends to station people on, found ${candidates.length}`);
  }
  const byDistance = [...candidates].sort(
    (left, right) => (distance.get(tileKey(left.x, left.y)) ?? 0) - (distance.get(tileKey(right.x, right.y)) ?? 0),
  );
  const keeper = byDistance[0]!;
  const hollow = byDistance[byDistance.length - 1]!;
  const farDistance = distance.get(tileKey(hollow.x, hollow.y)) ?? 0;
  const lost =
    [...candidates]
      .filter((cell) => cell !== keeper && cell !== hollow)
      .sort(
        (left, right) =>
          Math.abs((distance.get(tileKey(left.x, left.y)) ?? 0) - farDistance / 2) -
          Math.abs((distance.get(tileKey(right.x, right.y)) ?? 0) - farDistance / 2),
      )[0] ?? keeper;

  const occupants = new Set([gate, landing, keeper, lost, hollow].map((cell) => tileKey(cell.x, cell.y)));
  const landingKey = tileKey(landing.x, landing.y);

  // Wild grass on open ground nobody is standing on. A deterministic stream of
  // its own, so moving a keeper does not re-roll the whole meadow.
  const grassRng = maze.rng.fork("maze-grass");
  const tiles: TileKind[][] = maze.rows.map((row, y) =>
    row.map((tile, x) => {
      // The landing is carved by hand: the outer warp has to put the player
      // somewhere, and "somewhere" cannot depend on the seed. Opening the wall
      // between the gate and the first cell also guarantees the whole maze is
      // walkable from the gate, whatever the generator did.
      if (tileKey(x, y) === landingKey) {
        return "path";
      }
      if (tile !== maze.floor) {
        return x === 0 || y === 0 || x === maze.width - 1 || y === maze.height - 1 ? border : options.wall;
      }
      if (occupants.has(tileKey(x, y))) {
        return options.floor;
      }
      if (options.wildTile && grassRng.bool(wildShare)) {
        return options.wildTile;
      }
      return options.floor;
    }),
  );
  tiles[gate.y]![gate.x] = "doormat";

  // Nobody's doorstep is wild grass. The tile you stand on to talk to a keeper
  // is a tile you arrive on by walking, and if it rolled an encounter you would
  // be racing before you could say hello.
  if (options.wildTile) {
    for (const spot of [keeper, lost, hollow]) {
      for (const step of [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ]) {
        if (tiles[spot.y + step.y]?.[spot.x + step.x] === options.wildTile) {
          tiles[spot.y + step.y]![spot.x + step.x] = options.floor;
        }
      }
    }
  }

  const open = openCells(maze);
  const decor =
    [...open]
      .filter((cell) => !occupants.has(tileKey(cell.x, cell.y)))
      .sort(
        (left, right) =>
          (distance.get(tileKey(left.x, left.y)) ?? 0) - (distance.get(tileKey(right.x, right.y)) ?? 0),
      )[0] ?? landing;
  const wildTiles = options.wildTile ? tiles.flat().filter((tile) => tile === options.wildTile).length : 0;
  if (options.wildTile && wildTiles === 0) {
    throw new Error(`the ${name} came out with no wild grass at all`);
  }

  return {
    width: maze.width,
    height: maze.height,
    tiles,
    gate,
    landing,
    keeper,
    lost,
    hollow,
    decor,
    wildTiles,
    open,
  };
}

/** The orchard's hedge maze: fence rows, grass walks, clover to hunt in. */
export function buildHedgeMaze(seed: string | number = "marrow-hedge"): MazeMapLayout {
  return buildMazeMap({
    seed,
    name: "hedge maze",
    width: 19,
    height: 15,
    wall: "fence",
    border: "tree",
    floor: "grass",
    wildTile: "vroomgrass",
    wildShare: 0.16,
    braid: 0.18,
  });
}

/** The Quarry's Deep: stone walls, stone floor, and nothing green down there. */
export function buildDeepMaze(seed: string | number = "quarry-deep"): MazeMapLayout {
  return buildMazeMap({
    seed,
    name: "Deep",
    width: 17,
    height: 13,
    wall: "wall",
    floor: "indoor-floor",
    wildTile: undefined,
    braid: 0.2,
  });
}

/** The Mesa's Brambles: thorn scrub for walls, hill grass for walks. */
export function buildBrambleMaze(seed: string | number = "mesa-bramble"): MazeMapLayout {
  return buildMazeMap({
    seed,
    name: "brambles",
    width: 17,
    height: 13,
    wall: "tree",
    floor: "grass",
    wildTile: "vroomgrass",
    wildShare: 0.14,
    braid: 0.16,
  });
}

/** Open tiles with exactly one open neighbour: a person here blocks a leaf. */
function deadEnds(maze: Maze): Cell[] {
  return openCells(maze).filter((cell) => openNeighbours(maze, cell).length === 1);
}

function openNeighbours(maze: Maze, cell: Cell): Cell[] {
  return neighbors4(cell.x, cell.y).filter((next) => maze.grid.get(next.x, next.y) === maze.floor);
}

/** Step distance from `start` to every open tile, ignoring who is standing where. */
function distancesFrom(maze: Maze, start: Cell): Map<string, number> {
  const distance = new Map<string, number>();
  const queue: Cell[] = [];
  if (maze.grid.get(start.x, start.y) !== maze.floor) {
    return distance;
  }
  distance.set(tileKey(start.x, start.y), 0);
  queue.push(start);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const here = distance.get(tileKey(current.x, current.y))!;
    for (const next of openNeighbours(maze, current)) {
      const key = tileKey(next.x, next.y);
      if (distance.has(key)) {
        continue;
      }
      distance.set(key, here + 1);
      queue.push(next);
    }
  }
  return distance;
}
