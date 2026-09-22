/**
 * Maps: a grid of tiles, the people standing on it, and the ways out.
 *
 * `defineMap` is the only door into the engine's map type, and it checks its
 * work. Most "the player is stuck" bugs are a map that was authored wrong, and
 * it is far cheaper to catch a wall with no door at startup than to walk into
 * it in a play session.
 */

import type { Cell, Grid } from "./grid.js";
import { gridFromRows, inBounds, tileKey } from "./grid.js";
import type { Facing } from "./direction.js";
import type { TileSet } from "./tiles.js";
import type { Routine } from "./schedule.js";

export interface Warp {
  /** The tile the player steps onto to travel. */
  at: Cell;
  toMap: string;
  to: Cell;
  facing?: Facing;
}

export interface ActorSpawn {
  id: string;
  name?: string;
  sprite: string;
  x: number;
  y: number;
  facing: Facing;
  /** Dialogue script id, resolved by the game's content registry. */
  dialogue?: string;
  routine?: Routine;
  /** Free-form flags a game may use to filter or tag its people. */
  tags?: string[];
}

export interface MapDefinition {
  id: string;
  name: string;
  /** Rows of tile ids, top to bottom. */
  tiles: readonly (readonly string[])[];
  tileset: string;
  warps?: readonly Warp[];
  actors?: readonly ActorSpawn[];
  /** Interiors draw against a dark room rather than the sky. */
  interior?: boolean;
  ambientColor?: string;
  music?: string;
  meta?: Record<string, unknown>;
}

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: Grid<string>;
  tileset: string;
  /** Warps keyed by their trigger tile. */
  warps: Map<string, Warp>;
  actors: ActorSpawn[];
  interior: boolean;
  ambientColor: string;
  music: string | null;
  meta: Record<string, unknown>;
}

export function defineMap(definition: MapDefinition, tileset: TileSet): GameMap {
  const tiles = gridFromRows(definition.tiles);
  const problems: string[] = [];

  tiles.forEach((value, x, y) => {
    if (!tileset.has(value)) {
      problems.push(`${definition.id}: tile "${value}" at ${x},${y} is not in tileset "${tileset.id}"`);
    }
  });

  const warps = new Map<string, Warp>();
  for (const warp of definition.warps ?? []) {
    if (!inBounds(tiles.width, tiles.height, warp.at.x, warp.at.y)) {
      problems.push(`${definition.id}: warp at ${warp.at.x},${warp.at.y} is off the map`);
      continue;
    }
    const key = tileKey(warp.at.x, warp.at.y);
    if (warps.has(key)) {
      problems.push(`${definition.id}: two warps on ${key}`);
      continue;
    }
    warps.set(key, warp);
  }

  const seenIds = new Set<string>();
  for (const actor of definition.actors ?? []) {
    if (seenIds.has(actor.id)) {
      problems.push(`${definition.id}: two actors share the id "${actor.id}"`);
    }
    seenIds.add(actor.id);
    if (!inBounds(tiles.width, tiles.height, actor.x, actor.y)) {
      problems.push(`${definition.id}: "${actor.id}" stands off the map at ${actor.x},${actor.y}`);
      continue;
    }
    const tile = tiles.get(actor.x, actor.y)!;
    if (tileset.isSolid(tile)) {
      problems.push(`${definition.id}: "${actor.id}" stands inside a solid "${tile}" at ${actor.x},${actor.y}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`defineMap("${definition.id}") is not walkable:\n  - ${problems.join("\n  - ")}`);
  }

  return {
    id: definition.id,
    name: definition.name,
    width: tiles.width,
    height: tiles.height,
    tiles,
    tileset: definition.tileset,
    warps,
    actors: (definition.actors ?? []).map((actor) => ({ ...actor })),
    interior: definition.interior === true,
    ambientColor: definition.ambientColor ?? "#101a0d",
    music: definition.music ?? null,
    meta: { ...(definition.meta ?? {}) },
  };
}

export function isSolidTile(map: GameMap, tileset: TileSet, x: number, y: number): boolean {
  const tile = map.tiles.get(x, y);
  if (tile === undefined) {
    return true;
  }
  return tileset.isSolid(tile);
}

/**
 * The tile a warp sends you to, if any. Warps fire on the tile the player
 * stands on, so walking back out of a door does not immediately re-enter it as
 * long as the landing tile is not itself a warp — which `validateMapGraph`
 * enforces.
 */
export function warpAt(map: GameMap, x: number, y: number): Warp | null {
  return map.warps.get(tileKey(x, y)) ?? null;
}

/** The cells a player can reach on this map, without moving anyone. */
export function reachableOn(
  map: GameMap,
  tileset: TileSet,
  starts: readonly Cell[],
  blocked: (x: number, y: number) => boolean = () => false,
): Set<string> {
  const seen = new Set<string>();
  const queue: Cell[] = [];
  const push = (cell: Cell): void => {
    const key = tileKey(cell.x, cell.y);
    if (seen.has(key)) {
      return;
    }
    if (isSolidTile(map, tileset, cell.x, cell.y) || blocked(cell.x, cell.y)) {
      return;
    }
    seen.add(key);
    queue.push(cell);
  };
  for (const start of starts) {
    push(start);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    push({ x: current.x, y: current.y - 1 });
    push({ x: current.x + 1, y: current.y });
    push({ x: current.x, y: current.y + 1 });
    push({ x: current.x - 1, y: current.y });
  }
  return seen;
}

/**
 * Whole-graph checks that need every map at once. Returns human-readable
 * problems rather than throwing, so a content author sees the entire list.
 */
export function validateMapGraph(
  maps: ReadonlyMap<string, GameMap>,
  tilesets: ReadonlyMap<string, TileSet>,
): string[] {
  const problems: string[] = [];
  const adjacency = new Map<string, Set<string>>();

  for (const map of maps.values()) {
    adjacency.set(map.id, adjacency.get(map.id) ?? new Set());
    if (map.warps.size === 0) {
      problems.push(`${map.id} has no exits — walking in strands the player`);
    }
    for (const warp of map.warps.values()) {
      const target = maps.get(warp.toMap);
      const from = `${map.id} ${tileKey(warp.at.x, warp.at.y)}`;
      if (!target) {
        problems.push(`${from} warps to a missing map "${warp.toMap}"`);
        continue;
      }
      const targetTileset = tilesets.get(target.tileset);
      if (!targetTileset) {
        problems.push(`${target.id} names a missing tileset "${target.tileset}"`);
        continue;
      }
      adjacency.get(map.id)!.add(target.id);
      if (!inBounds(target.width, target.height, warp.to.x, warp.to.y)) {
        problems.push(`${from} lands off "${target.id}" at ${warp.to.x},${warp.to.y}`);
        continue;
      }
      if (targetTileset.isSolid(target.tiles.get(warp.to.x, warp.to.y)!)) {
        problems.push(`${from} lands inside a solid tile on "${target.id}"`);
      }
      if (target.warps.has(tileKey(warp.to.x, warp.to.y))) {
        problems.push(`${from} lands on a warp on "${target.id}" — a door you cannot stop falling through`);
      }
    }
  }

  const origin = maps.keys().next().value;
  if (origin !== undefined) {
    const seen = new Set<string>([origin]);
    const queue = [origin];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const id of maps.keys()) {
      if (!seen.has(id)) {
        problems.push(`${id} cannot be reached from "${origin}"`);
      }
    }
  }

  return problems;
}
