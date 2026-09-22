import { describe, expect, it } from "vitest";

import {
  buildDeepMaze,
  buildHedgeMaze,
  buildMazeMap,
  type MazeMapLayout,
} from "../../src/renderer/world/maze-map.js";
import { getMap, isTilePassable } from "../../src/renderer/world/maps.js";

const key = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

const NEIGHBOURS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** What the player can walk to from the landing, optionally with a tile blocked. */
function reachable(layout: MazeMapLayout, blocked: { x: number; y: number } | null): Set<string> {
  const seen = new Set<string>([key(layout.landing)]);
  const queue = [layout.landing];
  while (queue.length > 0) {
    const cell = queue.shift()!;
    for (const step of NEIGHBOURS) {
      const next = { x: cell.x + step.x, y: cell.y + step.y };
      if (next.x < 0 || next.y < 0 || next.x >= layout.width || next.y >= layout.height) {
        continue;
      }
      const cellKey = key(next);
      if (seen.has(cellKey) || (blocked && key(blocked) === cellKey)) {
        continue;
      }
      if (!isTilePassable(layout.tiles[next.y]![next.x]!)) {
        continue;
      }
      seen.add(cellKey);
      queue.push(next);
    }
  }
  return seen;
}

describe("the maze builder", () => {
  it("takes its walls, floor and wild tile from the caller", () => {
    const plain = buildMazeMap({
      seed: "custom",
      name: "test maze",
      width: 13,
      height: 11,
      wall: "fence",
      border: "tree",
      floor: "grass",
    });
    expect(plain.tiles[0]!.every((tile) => tile === "tree")).toBe(true);
    expect(plain.tiles.flat()).toContain("fence");
    expect(plain.tiles.flat()).toContain("grass");
    // No wild tile asked for, so no encounters and no doorstep to clear.
    expect(plain.wildTiles).toBe(0);
    expect(plain.tiles.flat()).not.toContain("vroomgrass");

    const wild = buildMazeMap({
      seed: "custom",
      width: 13,
      height: 11,
      wall: "wall",
      floor: "indoor-floor",
      wildTile: "vroomgrass",
      wildShare: 0.5,
    });
    expect(wild.wildTiles).toBeGreaterThan(0);
    expect(wild.tiles.flat()).not.toContain("fence");
  });

  it("names itself when the ground is too small to station anyone", () => {
    expect(() =>
      buildMazeMap({ seed: "x", name: "little maze", width: 3, height: 3, wall: "fence", floor: "grass" }),
    ).toThrow(/little maze needs three dead ends/);
  });

  it("is deterministic for a seed and different across seeds", () => {
    const first = buildHedgeMaze();
    const second = buildHedgeMaze();
    expect(second.tiles).toEqual(first.tiles);
    expect(second.keeper).toEqual(first.keeper);
    expect(second.hollow).toEqual(first.hollow);
    expect(buildHedgeMaze("another-hedge").tiles).not.toEqual(first.tiles);
  });

  it("is odd-sized, walled, and floored the way the overworld expects", () => {
    const layout = buildHedgeMaze();
    expect(layout.width % 2).toBe(1);
    expect(layout.height % 2).toBe(1);
    expect(layout.tiles).toHaveLength(layout.height);
    for (const row of layout.tiles) {
      expect(row).toHaveLength(layout.width);
    }
    // The border is a treeline; the hedges inside it are fences. Both block.
    expect(layout.tiles[0]!.every((tile) => tile === "tree")).toBe(true);
    expect(layout.tiles.flat()).toContain("fence");
    expect(isTilePassable("tree")).toBe(false);
    expect(isTilePassable("fence")).toBe(false);
  });

  it("puts a passable gate, landing and three safe spots in the maze", () => {
    const layout = buildHedgeMaze();
    expect(layout.tiles[layout.gate.y]![layout.gate.x]).toBe("doormat");
    expect(layout.tiles[layout.landing.y]![layout.landing.x]).toBe("path");
    expect(layout.landing).toEqual({ x: layout.gate.x, y: layout.gate.y + 1 });
    expect(layout.wildTiles).toBeGreaterThan(0);
    expect(layout.open.length).toBeGreaterThan(30);

    const spots = [layout.keeper, layout.lost, layout.hollow, layout.decor];
    for (const spot of spots) {
      const tile = layout.tiles[spot.y]![spot.x]!;
      expect(isTilePassable(tile), `${key(spot)} is a ${tile}`).toBe(true);
    }
    expect(new Set(spots.map(key)).size).toBe(spots.length);
  });

  it("reaches every open tile from the landing", () => {
    for (const layout of [buildHedgeMaze(), buildDeepMaze()]) {
      const seen = reachable(layout, null);
      for (const cell of layout.open) {
        expect(seen.has(key(cell)), `${key(cell)} cannot be walked to from the landing`).toBe(true);
      }
    }
  });

  it("stations its people on tiles that block nothing", () => {
    // The whole reason the spots are dead ends: a keeper dropped in a corridor
    // cuts the maze in half, and the player never finds out why. Blocking each
    // keeper's tile must cost exactly that tile.
    for (const layout of [buildHedgeMaze(), buildDeepMaze()]) {
      for (const spot of [layout.keeper, layout.lost, layout.hollow]) {
        const seen = reachable(layout, spot);
        const unreachable = layout.open
          .filter((cell) => key(cell) !== key(spot))
          .filter((cell) => !seen.has(key(cell)));
        expect(unreachable.map(key), `${key(spot)} seals the maze`).toEqual([]);
      }
    }
  });

  it("spreads the three spots out — near, half-way, far", () => {
    const layout = buildHedgeMaze();
    // Cheap proxy for "spread": the spots are not all sitting together.
    const spread = Math.max(
      Math.abs(layout.keeper.x - layout.hollow.x),
      Math.abs(layout.keeper.y - layout.hollow.y),
    );
    expect(spread).toBeGreaterThan(Math.floor(layout.width / 4));
    expect(layout.keeper).not.toEqual(layout.hollow);
    expect(layout.lost).not.toEqual(layout.keeper);
  });

  it("leaves no doorstep on wild grass", () => {
    // The tile you stand on to talk to somebody has to be walkable, and a
    // wild encounter on the way to a conversation interrupts it. The generator
    // clears the ring around every person it stations.
    const layout = buildHedgeMaze();
    for (const spot of [layout.keeper, layout.lost, layout.hollow]) {
      for (const step of NEIGHBOURS) {
        const tile = layout.tiles[spot.y + step.y]?.[spot.x + step.x];
        expect(tile, `${key(spot)} has no tile at ${step.x},${step.y}`).toBeDefined();
        expect(tile).not.toBe("vroomgrass");
      }
    }
  });
});

describe("the Deep", () => {
  it("is stone all the way down, with nothing green in it", () => {
    const layout = buildDeepMaze();
    expect(layout.wildTiles).toBe(0);
    expect(layout.tiles.flat()).not.toContain("vroomgrass");
    expect(layout.tiles.flat()).toContain("wall");
    expect(layout.tiles.flat()).toContain("indoor-floor");
    expect(layout.tiles[0]!.every((tile) => tile === "wall")).toBe(true);
  });

  it("uses a different seed, so it is not the hedge maze with different tiles", () => {
    expect(buildDeepMaze().tiles).not.toEqual(buildHedgeMaze().tiles);
    expect(buildDeepMaze().keeper).not.toEqual(buildHedgeMaze().keeper);
  });
});

describe("the generated maps in the world", () => {
  it("wires the hedge maze to the orchard both ways", () => {
    const maze = getMap("hedge_maze");
    expect(maze).toBeDefined();
    expect(maze!.name).toBe("Marrow Hedge Maze");
    expect(maze!.npcs.filter((npc) => npc.x > 0 || npc.y > 0)).toHaveLength(3);
    expect(maze!.tiles.flat()).toContain("vroomgrass");

    const orchard = getMap("marrow_orchard")!;
    const gate = orchard.transitions["16,12"];
    expect(gate?.mapId).toBe("hedge_maze");
    // The orchard's door lands inside the maze, not on the maze's own gate.
    expect(maze!.tiles[gate!.toY]?.[gate!.toX]).toBe("path");
    expect(maze!.transitions[`${gate!.toX},${gate!.toY}`]).toBeUndefined();

    // ...and the way back lands beside the orchard's door.
    const back = Object.values(maze!.transitions)[0]!;
    expect(back.mapId).toBe("marrow_orchard");
    expect(orchard.tiles[back.toY]?.[back.toX]).toBe("grass");
    expect(orchard.transitions[`${back.toX},${back.toY}`]).toBeUndefined();
  });

  it("wires the Deep to the Quarry both ways, and keeps it indoors", () => {
    const deep = getMap("the_deep");
    expect(deep).toBeDefined();
    expect(deep!.interior).toBe(true);
    expect(deep!.npcs.filter((npc) => npc.x > 0 || npc.y > 0)).toHaveLength(3);

    const quarry = getMap("rocky_map")!;
    const shaft = quarry.transitions["14,10"];
    expect(shaft?.mapId).toBe("the_deep");
    expect(isTilePassable(quarry.tiles[10]![14]!)).toBe(true);
    expect(deep!.tiles[shaft!.toY]?.[shaft!.toX]).toBe("path");
    expect(deep!.transitions[`${shaft!.toX},${shaft!.toY}`]).toBeUndefined();

    const back = Object.values(deep!.transitions)[0]!;
    expect(back.mapId).toBe("rocky_map");
    expect(quarry.tiles[back.toY]?.[back.toX]).toBe("grass");
    expect(quarry.transitions[`${back.toX},${back.toY}`]).toBeUndefined();
  });

  it("walks Tam back to the orchard without dropping them on the door", () => {
    // The `goto:` escape hatch is the one place content moves the player by
    // hand, and the landing is checked by the same rule a warp is.
    const walk = getMap("hedge_maze")!.npcs.find((npc) => npc.id === "tam-walk")!;
    expect(walk.dialogue?.onComplete).toBe("goto:marrow_orchard:16:11");
    const orchard = getMap("marrow_orchard")!;
    expect(isTilePassable(orchard.tiles[11]![16]!)).toBe(true);
    expect(orchard.transitions["16,11"]).toBeUndefined();
  });
});
