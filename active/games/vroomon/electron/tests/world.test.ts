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
  joinFaction,
} from "../src/renderer/world/world-state.js";

describe("world maps", () => {
  it("exposes the three faction biomes with their host NPCs", () => {
    const joins: Array<[string, string, string]> = [
      ["hills_map", "guru-updrafts", "join-faction:skimmers"],
      ["hills_map", "guru-stone", "join-faction:miners"],
      ["rocky_map", "lay-foreman", "join-faction:union"],
      ["rocky_map", "canyon-ringleader", "join-faction:runners"],
      ["ice_map", "keeper-long-light", "join-faction:herdsmen"],
      ["ice_map", "frost-baron", "join-faction:drift-syndicate"],
    ];
    for (const [mapId, hostId, joinKind] of joins) {
      const map = getMap(mapId);
      expect(map, mapId).toBeDefined();
      const host = map?.npcs.find((npc) => npc.id === hostId);
      expect(host, `${mapId}/${hostId}`).toBeDefined();
      expect(host?.dialogue?.options?.length).toBeGreaterThan(0);
      // the join node is an NPC resolved by id (stub convention at 0,0)
      const joinNode = map?.npcs.find((npc) => npc.id === joinKind.slice(0, -"join-faction:".length));
      expect(map?.npcs.some((npc) => npc.dialogue?.onComplete === joinKind)).toBe(true);
    }
  });

  it("chains the faction biomes after the Salt Road", () => {
    expect(getMap("route_2")?.transitions["19,3"]?.mapId).toBe("hills_map");
    expect(getMap("hills_map")?.transitions["14,6"]?.mapId).toBe("rocky_map");
    expect(getMap("rocky_map")?.transitions["14,6"]?.mapId).toBe("ice_map");
    expect(getMap("ice_map")?.transitions["1,6"]?.mapId).toBe("rocky_map");
    expect(getMap("rocky_map")?.transitions["1,6"]?.mapId).toBe("hills_map");
  });

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
    expect(town?.transitions["13,2"]?.mapId).toBe("route_1");
    expect(town?.transitions["1,0"]).toBeUndefined();
    expect(route?.transitions["0,5"]?.mapId).toBe("starter_town");
    expect(route?.transitions["18,5"]?.mapId).toBe("route_2");
    expect(route?.transitions["19,5"]?.mapId).toBe("gym_1");
    expect(gym?.transitions["6,9"]?.mapId).toBe("route_1");
    expect(route2?.transitions["0,7"]?.mapId).toBe("route_1");
    expect(route2?.transitions["21,5"]?.mapId).toBe("gym_2");
    expect(gym2?.transitions["6,9"]?.mapId).toBe("route_2");
  });

  it("has the Trail Boss and Wreck Marshal as the Sand faction hosts", () => {
    const route2 = getMap("route_2");
    expect(route2?.npcs.some((npc) => npc.id === "trail-boss")).toBe(true);
    expect(
      route2?.npcs.find((npc) => npc.id === "trailboss-join-faction")?.dialogue?.onComplete,
    ).toBe("join-faction:saltcaravan");

    const post = getMap("gym_2");
    expect(post?.name).toBe("Salt Road Post");
    expect(
      post?.npcs.find((npc) => npc.id === "marshal-join-faction")?.dialogue?.onComplete,
    ).toBe("join-faction:wreckpickers");
  });

  it("teases the Hills/Rocky/Ice factions as dialogue-only NPCs", () => {
    const route2 = getMap("route_2");
    for (const npcId of ["highland-herder", "canyon-hauler", "frost-courier"]) {
      const npc = route2?.npcs.find((candidate) => candidate.id === npcId);
      expect(npc).toBeDefined();
      expect(npc?.dialogue?.onComplete).toBeUndefined();
      expect((npc?.dialogue?.text ?? "").length).toBeGreaterThan(40);
    }
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

  it("joins one faction per biome and records the flag", () => {
    const world = joinFaction(createInitialWorldState(), "grassland", "greensprouts");
    expect(world.factionChoices).toEqual({ grassland: "greensprouts" });
    expect(world.flags["faction-joined-grassland"]).toBe(true);
    expect(world.activeNpc).toBeNull();

    // Switching in a NEW biome keeps the first choice.
    const again = joinFaction(world, "sand", "wreckpickers");
    expect(again.factionChoices).toEqual({
      grassland: "greensprouts",
      sand: "wreckpickers",
    });
  });

  it("persists faction choices and tolerates pre-faction saves", () => {
    const world = joinFaction(createInitialWorldState(), "grassland", "redlines");
    const serialized = serializeWorldState(world);
    expect(serialized.factionChoices).toEqual({ grassland: "redlines" });
    const parsed = parsePersistedWorld(JSON.stringify(serialized));
    expect(parsed?.factionChoices).toEqual({ grassland: "redlines" });

    // Legacy saves without the field still parse (backwards compatible).
    const legacy = JSON.stringify({ ...serialized, factionChoices: undefined });
    const reparsed = parsePersistedWorld(legacy.replace('"factionChoices":{"grassland":"redlines"},', ""));
    expect(reparsed).not.toBeNull();
  });

  it("defines the faction choice NPCs for the Grassland mini-story", () => {
    const town = getMap("starter_town");
    const elder = town?.npcs.find((npc) => npc.id === "meadow-elder");
    expect(elder).toBeDefined();
    expect(elder?.dialogue?.options?.some((o) => o.next === "elder-join-faction")).toBe(true);
    expect(
      town?.npcs.find((npc) => npc.id === "elder-join-faction")?.dialogue?.onComplete,
    ).toBe("join-faction:greensprouts");

    const pasture = getMap("gym_1");
    expect(pasture?.name).toBe("Rustler Pasture");
    expect(
      pasture?.npcs.find((npc) => npc.id === "king-join-faction")?.dialogue?.onComplete,
    ).toBe("join-faction:redlines");
  });
});

describe("overworld movement queries", () => {
  it("advances onto a transition tile so the edge transition can fire", () => {
    // Regression: attemptMove used to leave playerX/playerY one tile
    // behind on transition tiles, so isAtEdgeTransition never matched and
    // no map edge transition ever triggered (dead-end overworld).
    const world = setPlayerPosition(createInitialWorldState(), 12, 2, "right");
    const moveResult = attemptMove(world, "right");
    expect(moveResult.transitionKey).toBe("13,2");
    expect(moveResult.state.playerX).toBe(13);
    expect(moveResult.state.playerY).toBe(2);
    expect(isAtEdgeTransition(moveResult.state)?.mapId).toBe("route_1");
  });

  it("returns the edge transition when standing on one", () => {
    const world = setPlayerPosition(createInitialWorldState(), 13, 2, "right");
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
