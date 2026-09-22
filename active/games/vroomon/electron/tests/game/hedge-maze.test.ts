import { describe, expect, it } from "vitest";

import { buildHedgeMaze, type HedgeMazeLayout } from "../../src/renderer/world/hedge-maze.js";
import { getMap, isTilePassable } from "../../src/renderer/world/maps.js";

const key = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

const NEIGHBOURS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** What the player can walk to from the landing, optionally with a tile blocked. */
function reachable(layout: HedgeMazeLayout, blocked: { x: number; y: number } | null): Set<string> {
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

describe("the hedge maze generator", () => {
  it("is deterministic for a seed and different across seeds", () => {
    const first = buildHedgeMaze();
    const second = buildHedgeMaze();
    expect(second.tiles).toEqual(first.tiles);
    expect(second.keeper).toEqual(first.keeper);
    expect(second.hollow).toEqual(first.hollow);
    expect(buildHedgeMaze({ seed: "another-hedge" }).tiles).not.toEqual(first.tiles);
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
    const layout = buildHedgeMaze();
    const seen = reachable(layout, null);
    for (const cell of layout.open) {
      expect(seen.has(key(cell)), `${key(cell)} cannot be walked to from the landing`).toBe(true);
    }
  });

  it("leaves no doorstep on wild grass", () => {
    // The tile you stand on to talk to somebody has to be walkable, and a
    // wild encounter on the way to a conversation interrupts it. The generator
    // clears the ring around every person it stations.
    const layout = buildHedgeMaze();
    for (const spot of [layout.keeper, layout.lost, layout.hollow]) {
      for (const step of [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ]) {
        const tile = layout.tiles[spot.y + step.y]?.[spot.x + step.x];
        expect(tile, `${key(spot)} has no tile at ${step.x},${step.y}`).toBeDefined();
        expect(tile).not.toBe("vroomgrass");
      }
    }
  });

  it("stations its people on tiles that block nothing", () => {
    // The whole reason the spots are dead ends: a keeper dropped in a corridor
    // cuts the maze in half, and the player never finds out why. Blocking each
    // keeper's tile must cost exactly that tile.
    const layout = buildHedgeMaze();
    for (const spot of [layout.keeper, layout.lost, layout.hollow]) {
      const seen = reachable(layout, spot);
      const unreachable = layout.open
        .filter((cell) => key(cell) !== key(spot))
        .filter((cell) => !seen.has(key(cell)));
      expect(unreachable.map(key), `${key(spot)} seals the maze`).toEqual([]);
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

  it("refuses to build when the ground is too small to station anyone", () => {
    expect(() => buildHedgeMaze({ width: 3, height: 3 })).toThrow(/dead ends/);
  });
});

describe("the Marrow Hedge Maze in the world", () => {
  it("is a real map, wired to the orchard both ways", () => {
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
