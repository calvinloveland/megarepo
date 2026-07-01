import { describe, expect, it } from "vitest";

import { getMap, isTilePassable } from "../src/renderer/world/maps.js";
import {
  attemptMove,
  isAtEdgeTransition,
  isOnWildEncounterTile,
} from "../src/renderer/world/overworld-renderer.js";
import {
  EMPTY_PERSISTED_WORLD,
  parsePersistedWorld,
  serializeWorldState,
} from "../src/renderer/world/types.js";
import {
  awardBadge,
  createInitialWorldState,
  endDialogue,
  recordEncounterDna,
  setFlag,
  setPlayerPosition,
  startDialogue,
  transitionToMap,
} from "../src/renderer/world/world-state.js";

describe("world maps", () => {
  it("exposes the five vertical-slice maps", () => {
    expect(getMap("starter_town")).toBeDefined();
    expect(getMap("route_1")).toBeDefined();
    expect(getMap("gym_1")).toBeDefined();
    expect(getMap("route_2")).toBeDefined();
    expect(getMap("gym_2")).toBeDefined();
    expect(getMap("not_a_map")).toBeUndefined();
  });

  it("defines transitions on the expected map edges", () => {
    const town = getMap("starter_town");
    const route = getMap("route_1");
    const gym = getMap("gym_1");
    const route2 = getMap("route_2");
    const gym2 = getMap("gym_2");
    expect(town?.transitions["1,0"]?.mapId).toBe("route_1");
    expect(route?.transitions["0,5"]?.mapId).toBe("starter_town");
    expect(route?.transitions["19,5"]?.mapId).toBe("gym_1");
    expect(gym?.transitions["6,9"]?.mapId).toBe("route_1");
    expect(route2?.transitions["0,7"]?.mapId).toBe("route_1");
    expect(route2?.transitions["21,5"]?.mapId).toBe("gym_2");
    expect(gym2?.transitions["6,9"]?.mapId).toBe("route_2");
  });

  it("has Dr. Dusty as the Sandy Gym leader", () => {
    const gym2 = getMap("gym_2");
    expect(gym2?.npcs.some((npc) => npc.id === "dr-dusty")).toBe(true);
  });

  it("classifies tiles correctly for collision", () => {
    expect(isTilePassable("grass")).toBe(true);
    expect(isTilePassable("vroomgrass")).toBe(true);
    expect(isTilePassable("path")).toBe(true);
    expect(isTilePassable("indoor-floor")).toBe(true);
    expect(isTilePassable("tree")).toBe(false);
    expect(isTilePassable("water")).toBe(false);
    expect(isTilePassable("wall")).toBe(false);
    expect(isTilePassable("building")).toBe(false);
  });
});

describe("world state transitions", () => {
  it("creates an initial world state with the player in starter town", () => {
    const world = createInitialWorldState();
    expect(world.currentMapId).toBe("starter_town");
    expect(world.playerX).toBe(7);
    expect(world.playerY).toBe(7);
    expect(world.playerFacing).toBe("down");
    expect(world.badges).toEqual([]);
    expect(world.vroomdex).toEqual([]);
  });

  it("moves the player", () => {
    const world = setPlayerPosition(createInitialWorldState(), 3, 5, "up");
    expect(world.playerX).toBe(3);
    expect(world.playerY).toBe(5);
    expect(world.playerFacing).toBe("up");
  });

  it("transitions to a new map and resets movement state", () => {
    const world = transitionToMap(createInitialWorldState(), "route_1", 1, 5, "right");
    expect(world.currentMapId).toBe("route_1");
    expect(world.playerX).toBe(1);
    expect(world.playerFacing).toBe("right");
    expect(world.isMoving).toBe(false);
  });

  it("starts and ends dialogue", () => {
    const started = startDialogue(createInitialWorldState(), "npc-1", {
      text: "Hello there!",
    });
    expect(started.activeNpc).toBe("npc-1");
    expect(started.dialogueQueue).toHaveLength(1);

    const ended = endDialogue(started, null, "met_axle");
    expect(ended.activeNpc).toBeNull();
    expect(ended.dialogueQueue).toEqual([]);
    expect(ended.flags.met_axle).toBe(true);
  });

  it("records new DNA into the vroomdex without duplicates", () => {
    const world = recordEncounterDna(createInitialWorldState(), "A3x9K2m7P4zQ");
    const again = recordEncounterDna(world, "A3x9K2m7P4zQ");
    expect(world.vroomdex).toEqual(["A3x9K2m7P4zQ"]);
    expect(again.vroomdex).toEqual(["A3x9K2m7P4zQ"]);

    const enriched = recordEncounterDna(world, "zzYY1199ABcd");
    expect(enriched.vroomdex).toEqual(["A3x9K2m7P4zQ", "zzYY1199ABcd"]);
  });

  it("awards unique badges", () => {
    const world = awardBadge(createInitialWorldState(), "Grass Badge");
    const again = awardBadge(world, "Grass Badge");
    expect(world.badges).toEqual(["Grass Badge"]);
    expect(again.badges).toEqual(["Grass Badge"]);

    const enriched = awardBadge(world, "Sand Badge");
    expect(enriched.badges).toEqual(["Grass Badge", "Sand Badge"]);
  });

  it("sets flags in the world state", () => {
    const world = setFlag(createInitialWorldState(), "defeated_flint", true);
    expect(world.flags.defeated_flint).toBe(true);
  });
});

describe("overworld movement queries", () => {
  it("returns the edge transition when standing on one", () => {
    const world = setPlayerPosition(createInitialWorldState(), 1, 0, "up");
    const transition = isAtEdgeTransition(world);
    expect(transition?.mapId).toBe("route_1");
    expect(transition?.x).toBe(1);
    expect(transition?.y).toBe(10);
  });

  it("detects wild encounters on vroomgrass", () => {
    const world = transitionToMap(createInitialWorldState(), "route_1", 1, 1);
    const route = getMap("route_1");
    if (route) {
      route.tiles[1]![1] = "vroomgrass";
    }
    expect(isOnWildEncounterTile(world)).toBe(true);
  });

  it("refuses to move when blocked by a tile", () => {
    const world = setPlayerPosition(createInitialWorldState(), 1, 1);
    const before = { ...world };
    const result = attemptMove(world, "left");
    expect(result.state.playerX).toBe(before.playerX);
  });
});

describe("world persistence", () => {
  it("serializes a world state into a parseable persisted shape", () => {
    const world = createInitialWorldState();
    const serialized = serializeWorldState(world);

    expect(serialized.version).toBe(1);
    expect(serialized.currentMapId).toBe("starter_town");
    expect(serialized.lastSavedAt.length).toBeGreaterThan(0);

    const roundTrip = parsePersistedWorld(JSON.stringify(serialized));
    expect(roundTrip).toEqual(serialized);
  });

  it("strips transient fields from the persisted shape", () => {
    const world = createInitialWorldState();
    const serialized = serializeWorldState(world);

    const keys = Object.keys(serialized);
    expect(keys).not.toContain("dialogueQueue");
    expect(keys).not.toContain("activeNpc");
    expect(keys).not.toContain("currentEncounter");
    expect(keys).not.toContain("isMoving");
    expect(keys).not.toContain("movementTarget");
  });

  it("returns null for malformed JSON", () => {
    expect(parsePersistedWorld("not json")).toBeNull();
    expect(parsePersistedWorld("")).toBeNull();
    expect(parsePersistedWorld(JSON.stringify({ version: 999 }))).toBeNull();
  });

  it("exposes the empty-persisted-world shape", () => {
    expect(EMPTY_PERSISTED_WORLD.version).toBe(1);
    expect(EMPTY_PERSISTED_WORLD.currentMapId).toBe("starter_town");
    expect(EMPTY_PERSISTED_WORLD.badges).toEqual([]);
  });
});

describe("badge-by-map naming", () => {
  const BADGE_BY_MAP: Record<string, string> = {
    gym_1: "Grass Badge",
    gym_2: "Sand Badge",
    gym_3: "Hill Badge",
    gym_4: "Rock Badge",
    gym_5: "Ice Badge",
  };

  it.each(Object.entries(BADGE_BY_MAP))(
    "awards the %s for defeating %s",
    (mapId, badge) => {
      const state = createInitialWorldState();
      const resolved = BADGE_BY_MAP[mapId] ?? mapId;
      expect(resolved).toBe(badge);
      expect(awardBadge(state, resolved).badges).toEqual([badge]);
    },
  );
});
