import { describe, expect, it } from "vitest";

import { createTileSet } from "../../src/engine/tiles.js";
import { FACINGS, facingVector, oppositeFacing } from "../../src/engine/direction.js";
import {
  defineMap,
  isSolidTile,
  reachableOn,
  validateActors,
  validateMapGraph,
  warpAt,
} from "../../src/engine/map.js";
import { gridFromRows } from "../../src/engine/grid.js";
import { phaseIndex, phaseName, resolveRoutine, isOnDuty } from "../../src/engine/schedule.js";

const tileset = createTileSet("test", [
  { id: "grass" },
  { id: "wall", solid: true },
  { id: "tall", encounter: "meadow" },
]);

describe("tiles", () => {
  it("answers the questions a map asks of a tile", () => {
    expect(tileset.has("grass")).toBe(true);
    expect(tileset.has("lava")).toBe(false);
    expect(tileset.isSolid("wall")).toBe(true);
    expect(tileset.isSolid("grass")).toBe(false);
    expect(tileset.encounterFor("tall")).toBe("meadow");
    expect(tileset.encounterFor("grass")).toBeNull();
    expect(tileset.ids).toEqual(["grass", "wall", "tall"]);
  });

  it("refuses duplicates and unknown tiles by name", () => {
    expect(() =>
      createTileSet("dup", [
        { id: "a" },
        { id: "a", solid: true },
      ]),
    ).toThrow(/twice/);
    expect(() => createTileSet("empty", [])).toThrow(/no tiles/);
    expect(() => tileset.define("lava")).toThrow(/no tile "lava"/);
    expect(createTileSet("tagged", [{ id: "a", tags: ["floor"] }]).withTag("floor")).toEqual(["a"]);
  });
});

describe("direction", () => {
  it("offers vectors, opposites and a stable order", () => {
    expect(facingVector("up")).toEqual({ x: 0, y: -1 });
    expect(facingVector("right")).toEqual({ x: 1, y: 0 });
    expect(oppositeFacing("left")).toBe("right");
    expect(oppositeFacing("down")).toBe("up");
    expect(FACINGS).toEqual(["up", "right", "down", "left"]);
    // The vector is a copy, not the table itself.
    facingVector("up").y = 99;
    expect(facingVector("up").y).toBe(-1);
  });
});

describe("map", () => {
  const base = {
    id: "map",
    name: "Map",
    tileset: "test",
    tiles: [
      ["grass", "grass", "wall"],
      ["grass", "tall", "wall"],
    ],
  } as const;

  it("builds a map and keys its warps by trigger tile", () => {
    const map = defineMap(
      { ...base, warps: [{ at: { x: 1, y: 1 }, toMap: "other", to: { x: 0, y: 0 } }] },
      tileset,
    );
    expect(map.width).toBe(3);
    expect(map.height).toBe(2);
    expect(warpAt(map, 1, 1)?.toMap).toBe("other");
    expect(warpAt(map, 0, 0)).toBeNull();
    expect(isSolidTile(map, tileset, 2, 0)).toBe(true);
    expect(isSolidTile(map, tileset, 0, 0)).toBe(false);
    // Off the map counts as solid, so no collision check can walk into the void.
    expect(isSolidTile(map, tileset, 9, 9)).toBe(true);
  });

  it("refuses maps that would strand or hide the player", () => {
    expect(() =>
      defineMap({ ...base, tiles: [["lava", "grass"]] }, tileset),
    ).toThrow(/not in tileset "test"/);

    expect(() =>
      defineMap({ ...base, warps: [{ at: { x: 0, y: 0 }, toMap: "a", to: { x: 0, y: 0 } }, { at: { x: 0, y: 0 }, toMap: "b", to: { x: 0, y: 0 } }] }, tileset),
    ).toThrow(/two warps/);

    expect(() =>
      defineMap(
        { ...base, actors: [{ id: "npc", sprite: "npc", x: 9, y: 9, facing: "down" }] },
        tileset,
      ),
    ).toThrow(/off the map/);

    expect(() =>
      defineMap(
        { ...base, actors: [{ id: "npc", sprite: "npc", x: 2, y: 0, facing: "down" }] },
        tileset,
      ),
    ).toThrow(/solid "wall"/);

    expect(() =>
      defineMap(
        {
          ...base,
          actors: [
            { id: "npc", sprite: "npc", x: 0, y: 0, facing: "down" },
            { id: "npc", sprite: "npc", x: 1, y: 0, facing: "down" },
          ],
        },
        tileset,
      ),
    ).toThrow(/share the id/);
  });

  it("reports the whole map graph's problems at once", () => {
    const good = defineMap({ ...base, id: "a" }, tileset);
    const maps = new Map([
      ["a", good],
      [
        "b",
        defineMap(
          {
            ...base,
            id: "b",
            tiles: [
              ["grass", "grass"],
              ["grass", "grass"],
            ],
            warps: [{ at: { x: 1, y: 1 }, toMap: "a", to: { x: 2, y: 0 } }],
          },
          tileset,
        ),
      ],
    ]);
    const tilesets = new Map([["test", tileset]]);
    const problems = validateMapGraph(maps, tilesets);
    // "a" has no exits, and "b" lands inside "a"'s wall.
    expect(problems.join("\n")).toMatch(/a has no exits/);
    expect(problems.join("\n")).toMatch(/lands inside a solid tile/);
  });

  it("spotlights a warp that lands on another warp, and an unreachable map", () => {
    const maps = new Map([
      [
        "a",
        defineMap(
          {
            ...base,
            id: "a",
            warps: [{ at: { x: 1, y: 0 }, toMap: "b", to: { x: 1, y: 1 } }],
          },
          tileset,
        ),
      ],
      [
        "b",
        defineMap(
          {
            ...base,
            id: "b",
            warps: [{ at: { x: 1, y: 1 }, toMap: "a", to: { x: 1, y: 0 } }],
          },
          tileset,
        ),
      ],
      [
        "island",
        defineMap(
          {
            ...base,
            id: "island",
            warps: [{ at: { x: 0, y: 0 }, toMap: "b", to: { x: 0, y: 0 } }],
          },
          tileset,
        ),
      ],
    ]);
    const problems = validateMapGraph(maps, new Map([["test", tileset]]));
    expect(problems.join("\n")).toMatch(/a door you cannot stop falling through/);
    expect(problems.join("\n")).toMatch(/island cannot be reached from/);
  });

  it("floods the ground a player can actually walk", () => {
    const map = defineMap(base, tileset);
    const reachable = reachableOn(map, tileset, [{ x: 0, y: 0 }]);
    expect([...reachable].sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });
});

describe("routine checks", () => {
  const flat = {
    id: "flat",
    name: "Flat",
    tileset: "test",
    tiles: [
      ["grass", "grass", "grass"],
      ["grass", "grass", "grass"],
    ],
  };

  it("refuses a routine that walks somebody into a hedge", () => {
    expect(() =>
      defineMap(
        {
          ...flat,
          actors: [
            { id: "keeper", sprite: "npc", x: 0, y: 0, facing: "down", routine: { stops: { afternoon: { x: 9, y: 9 } } } },
          ],
        },
        tileset,
      ),
    ).toThrow(/nobody can stand on/);
  });

  it("refuses two people in one tile at any hour", () => {
    // Tidy at dawn and colliding at dusk is the failure a routine makes
    // possible: one of them is invisible and unreachable, and nothing in the
    // file looks wrong.
    expect(() =>
      defineMap(
        {
          ...flat,
          actors: [
            { id: "mover", sprite: "npc", x: 0, y: 0, facing: "down", routine: { stops: { afternoon: { x: 1, y: 1 } } } },
            { id: "sitter", sprite: "npc", x: 1, y: 1, facing: "down" },
          ],
        },
        tileset,
      ),
    ).toThrow(/both stand on 1,1/);
  });

  it("lets a night watch be off duty at noon, and checks the hours make sense", () => {
    const offDuty = defineMap(
      {
        ...flat,
        actors: [
          {
            id: "watch",
            sprite: "npc",
            x: 0,
            y: 0,
            facing: "down",
            routine: { stops: { dawn: { x: 1, y: 0 }, afternoon: null } },
          },
        ],
      },
      tileset,
    );
    expect(offDuty.actors).toHaveLength(1);

    expect(() =>
      defineMap(
        {
          ...flat,
          actors: [
            {
              id: "all-day",
              sprite: "npc",
              x: 0,
              y: 0,
              facing: "down",
              routine: { stops: { dawn: { x: 1, y: 0 } }, hours: { from: 0, to: 24 } },
            },
          ],
        },
        tileset,
      ),
    ).toThrow(/fraction of the day/);
  });

  it("reports the routine problems on their own, or nothing at all", () => {
    const grid = gridFromRows(flat.tiles);
    expect(validateActors("flat", [], grid, tileset)).toEqual([]);
    expect(
      validateActors(
        "flat",
        [
          { id: "ghost", sprite: "npc", x: 0, y: 0, facing: "down", routine: { stops: { night: { x: 2, y: 1 } } } },
          { id: "wall", sprite: "npc", x: 0, y: 0, facing: "down", routine: { stops: { night: { x: 9, y: 9 } } } },
        ],
        grid,
        tileset,
      ),
    ).toEqual(['flat: "wall" is at 9,9 in the night, which nobody can stand on']);
  });
});

describe("schedule", () => {
  it("falls back to the previous slot instead of teleporting people", () => {
    const routine = {
      stops: {
        dawn: { x: 1, y: 1 },
        night: { x: 9, y: 9 },
      },
    };
    expect(resolveRoutine(routine, 0)).toEqual({ x: 1, y: 1 });
    expect(resolveRoutine(routine, 0.3)).toEqual({ x: 1, y: 1 });
    expect(resolveRoutine(routine, 0.9)).toEqual({ x: 9, y: 9 });
  });

  it("reads an explicit null as off duty", () => {
    const routine = { stops: { dawn: { x: 1, y: 1 }, night: null } };
    expect(resolveRoutine(routine, 0)).toEqual({ x: 1, y: 1 });
    expect(resolveRoutine(routine, 0.9)).toBeNull();
  });

  it("wraps duty hours that cross midnight", () => {
    expect(isOnDuty({ stops: {}, hours: { from: 0.8, to: 0.1 } }, 0.9)).toBe(true);
    expect(isOnDuty({ stops: {}, hours: { from: 0.8, to: 0.1 } }, 0.05)).toBe(true);
    expect(isOnDuty({ stops: {}, hours: { from: 0.8, to: 0.1 } }, 0.5)).toBe(false);
    expect(isOnDuty({ stops: {}, hours: { from: 0.1, to: 0.4 } }, 0.2)).toBe(true);
    expect(resolveRoutine({ stops: { dawn: { x: 1, y: 1 } }, hours: { from: 0.8, to: 0.1 } }, 0.5)).toBeNull();
  });

  it("alternates a patrol between its stops", () => {
    const routine = {
      stops: {
        dawn: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
        ],
      },
    };
    const seen = new Set<string>();
    for (let phase = 0; phase < 0.2; phase += 0.01) {
      const stop = resolveRoutine(routine, phase);
      if (stop) {
        seen.add(`${stop.x},${stop.y}`);
      }
    }
    expect(seen.size).toBe(2);
    expect(resolveRoutine({ stops: { dawn: [] } }, 0)).toBeNull();
    expect(resolveRoutine({ stops: {} }, 0)).toBeNull();
  });

  it("names the five phases of the day", () => {
    expect(phaseIndex(0)).toBe(0);
    expect(phaseIndex(0.999)).toBe(4);
    expect(phaseName(0.5)).toBe("afternoon");
    expect(phaseName(-1)).toBe("dawn");
  });
});
