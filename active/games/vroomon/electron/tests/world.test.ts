import { describe, expect, it } from "vitest";

import { MAPS, getMap, isTilePassable, safeSpawn } from "../src/renderer/world/maps.js";
import { npcPositionAt } from "../src/renderer/world/routines.js";

const MAP_LIST = Object.values(MAPS);
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

  it("ships a Grand Roundup finale node on the Roundup King", () => {
    const node = getMap("gym_1")?.npcs.find((npc) => npc.id === "grand-roundup");
    expect(node?.dialogue?.onComplete).toBe("grand-roundup");
    const king = getMap("gym_1")?.npcs.find((npc) => npc.id === "roundup-king");
    expect(
      king?.dialogue?.options?.some((opt) => opt.next === "grand-roundup"),
    ).toBe(true);
  });

  it("hosts offer a feud race that settles the biome's brand", () => {
    const feudNodes: Array<[string, string, string]> = [
      ["starter_town", "elder-feud", "Grassland Brand"],
      ["gym_1", "king-feud", "Grassland Brand"],
      ["route_2", "trailboss-feud", "Salt Road Brand"],
      ["gym_2", "marshal-feud", "Salt Road Brand"],
      ["hills_map", "skimmers-feud", "Highland Brand"],
      ["hills_map", "miners-feud", "Highland Brand"],
      ["rocky_map", "union-feud", "Canyon Brand"],
      ["rocky_map", "runners-feud", "Canyon Brand"],
      ["ice_map", "herdsmen-feud", "Perimeter Brand"],
      ["ice_map", "drift-feud", "Perimeter Brand"],
    ];
    for (const [mapId, feudId, brand] of feudNodes) {
      const node = getMap(mapId)?.npcs.find((npc) => npc.id === feudId);
      expect(node?.dialogue?.onComplete, `${mapId}/${feudId}`).toBe("gym");
      expect(node?.dialogue?.text).toContain("GO!");
    }
    expect(awardBadge(createInitialWorldState(), "Highland Brand").badges).toContain("Highland Brand");
  });

  it("ships a flavor NPC per faction biome", () => {
    const flavor: Array<[string, string]> = [
      ["hills_map", "vent-keeper"],
      ["rocky_map", "assay-clerk"],
      ["ice_map", "lamp-lighter"],
    ];
    for (const [mapId, npcId] of flavor) {
      const npc = getMap(mapId)?.npcs.find((candidate) => candidate.id === npcId);
      expect(npc, `${mapId}/${npcId}`).toBeDefined();
      expect((npc?.dialogue?.text ?? "").length).toBeGreaterThan(30);
      expect(npc?.dialogue?.onComplete).toBeUndefined();
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

  it("keeps the ranch house and the yard as two spaces", () => {
    const house = getMap("home_ranch");
    const yard = getMap("ranch_yard");
    expect(house).toBeDefined();
    expect(yard).toBeDefined();

    // The house is indoors: no grass, no vroomgrass, no trees.
    const indoorTiles = new Set(["wall", "indoor-floor", "counter", "bed", "doormat"]);
    for (const row of house!.tiles) {
      for (const tile of row) {
        expect(indoorTiles.has(tile), `${tile} in the house`).toBe(true);
      }
    }

    // The yard is outdoors: no walls or indoor floor.
    for (const row of yard!.tiles) {
      for (const tile of row) {
        expect(["wall", "indoor-floor", "counter", "bed"].includes(tile), `${tile} in the yard`).toBe(false);
      }
    }
    expect(yard!.tiles.flat()).toContain("vroomgrass");

    // The porch joins them both ways, and the gate leads to town.
    const houseDoor = Object.values(house!.transitions).map((t) => t.mapId);
    const yardPorch = Object.values(yard!.transitions).map((t) => t.mapId);
    expect(houseDoor).toContain("ranch_yard");
    expect(yardPorch).toContain("home_ranch");
    expect(yardPorch).toContain("starter_town");
    // The town's doorstep opens into the yard, not into the house.
    expect(Object.values(getMap("starter_town")!.transitions).map((t) => t.mapId)).toContain(
      "ranch_yard",
    );
  });

/**
 * Every tile a player can walk to after arriving on a map from any of its
 * entrances. Used to prove nobody is walled away (and that the tutorial's
 * NPCs are actually reachable after a map is reshaped).
 */
function reachableFrom(mapId: string, entries: Array<{ x: number; y: number }>): Set<string> {
  const map = getMap(mapId)!;
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key)) {
      continue;
    }
    const tile = map.tiles[y]?.[x];
    if (!tile || !isTilePassable(tile)) {
      continue;
    }
    seen.add(key);
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return seen;
}

/** Where every map is entered from, gathered off every other map. */
function entriesFor(mapId: string): Array<{ x: number; y: number }> {
  const entries: Array<{ x: number; y: number }> = [];
  for (const other of MAP_LIST) {
    for (const transition of Object.values(other.transitions)) {
      if (transition.mapId === mapId) {
        entries.push({ x: transition.toX, y: transition.toY });
      }
    }
  }
  return entries;
}

describe("world reachability", () => {
  it("keeps the map graph walkable from town, with no dead ends", () => {
    // Undirected adjacency: a transition exists in one direction or the other.
    const adjacency = new Map<string, Set<string>>();
    for (const map of MAP_LIST) {
      adjacency.set(map.id, adjacency.get(map.id) ?? new Set());
      for (const transition of Object.values(map.transitions)) {
        adjacency.get(map.id)!.add(transition.mapId);
        adjacency.set(
          transition.mapId,
          (adjacency.get(transition.mapId) ?? new Set()).add(map.id),
        );
      }
    }

    // Flood from town: every area must be walkable to.
    const seen = new Set<string>(["starter_town"]);
    const queue = ["starter_town"];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const map of MAP_LIST) {
      expect(seen.has(map.id), `${map.id} cannot be reached from Starter Town`).toBe(
        true,
      );
    }

    // And no area is a trap: every map has at least one way out.
    for (const map of MAP_LIST) {
      expect(
        Object.keys(map.transitions).length,
        `${map.id} has no exits — walking in strands the player`,
      ).toBeGreaterThan(0);
    }
  });

  it("can walk to every NPC from where the player arrives", () => {
    for (const map of MAP_LIST) {
      const entries = entriesFor(map.id);
      if (entries.length === 0) {
        continue;
      }
      const reachable = reachableFrom(map.id, entries);
      for (const npc of map.npcs) {
        // Story nodes with no position are virtual (dialogue handed off by id).
        if (npc.x <= 0 && npc.y <= 0) {
          continue;
        }
        const neighbours = [
          `${npc.x + 1},${npc.y}`,
          `${npc.x - 1},${npc.y}`,
          `${npc.x},${npc.y + 1}`,
          `${npc.x},${npc.y - 1}`,
        ];
        expect(
          neighbours.some((key) => reachable.has(key)),
          `${map.id}: ${npc.id} at ${npc.x},${npc.y} cannot be reached`,
        ).toBe(true);
      }
    }
  });
});

  it("ships Marrow Orchard with its people, gates, and wild clover", () => {
    const orchard = getMap("marrow_orchard");
    expect(orchard).toBeDefined();
    expect(orchard!.npcs.map((npc) => npc.id)).toEqual(
      expect.arrayContaining([
        "keeper-maren",
        "picker-sprout",
        "fitter-aubrey",
        "beekeeper-hollis",
      ]),
    );
    // Gates both ways: down the lane to town, west along the hedge to Route 1.
    const exits = Object.values(orchard!.transitions).map((t) => t.mapId);
    expect(exits).toContain("starter_town");
    expect(exits).toContain("route_1");
    expect(Object.values(getMap("starter_town")!.transitions).map((t) => t.mapId)).toContain(
      "marrow_orchard",
    );

    // Wild clover for its own evolving pack, and fences that actually block.
    expect(orchard!.tiles.flat()).toContain("vroomgrass");
    expect(isTilePassable("fence")).toBe(false);
    expect(orchard!.tiles.flat()).toContain("fence");
  });

  it("puts a save that predates the split somewhere it can stand", () => {
    // The ranch used to be one map: a save out in the old paddock now points
    // outside the house, so it belongs in the yard instead of the void.
    const old = safeSpawn("home_ranch", 2, 7);
    expect(old.relocated).toBe(true);
    expect(old.mapId).toBe("ranch_yard");
    expect(isTilePassable(getMap(old.mapId)!.tiles[old.y]![old.x]!)).toBe(true);

    // Any other impossible spot resolves to the nearest tile you can stand on.
    const wall = safeSpawn("ranch_yard", 0, 0);
    expect(wall.relocated).toBe(true);
    expect(isTilePassable(getMap(wall.mapId)!.tiles[wall.y]![wall.x]!)).toBe(true);

    // A good position is left exactly alone.
    expect(safeSpawn("ranch_yard", 7, 3)).toEqual({
      mapId: "ranch_yard",
      x: 7,
      y: 3,
      relocated: false,
    });

    // A map that no longer exists falls back to town.
    const gone = safeSpawn("demolished_map", 3, 3);
    expect(gone.mapId).toBe("starter_town");
    expect(gone.relocated).toBe(true);
  });

  it("never stands two people on the same tile, at any hour", () => {
    // Routines make this a real risk: two NPCs can be tidy at dawn and
    // collide at dusk, and then one of them is invisible and unreachable.
    for (const map of MAP_LIST) {
      for (const phase of [0.05, 0.25, 0.5, 0.7, 0.95]) {
        const seen = new Map<string, string>();
        for (const npc of map.npcs) {
          // Virtual dialogue nodes live at 0,0 and are never drawn.
          if (npc.x <= 0 && npc.y <= 0) {
            continue;
          }
          const spot = npcPositionAt(npc, phase);
          if (!spot) {
            continue; // off shift: nowhere, so nothing to collide with
          }
          const key = `${spot.x},${spot.y}`;
          const other = seen.get(key);
          expect(
            other,
            `${map.id}: ${npc.id} and ${other} both stand on ${key} at phase ${phase}`,
          ).toBeUndefined();
          seen.set(key, npc.id);
        }
      }
    }
  });

  it("gives every person something to say", () => {
    // An NPC with an empty dialogue is an interaction that does nothing.
    for (const map of MAP_LIST) {
      for (const npc of map.npcs) {
        if (!npc.dialogue) {
          continue;
        }
        expect(npc.dialogue.text.length, `${map.id}: ${npc.id} says nothing`).toBeGreaterThan(10);
        for (const option of npc.dialogue.options ?? []) {
          expect(option.label.length, `${map.id}: ${npc.id} has an empty option`).toBeGreaterThan(2);
        }
      }
    }
  });

  it("resolves every dialogue link inside its own map", () => {
    // A `next` that names a node nobody has is a conversation that stops dead
    // — the exact failure that made faction joins and the professor's explain
    // options silently impossible once before.
    for (const map of MAP_LIST) {
      const ids = new Set(map.npcs.map((npc) => npc.id));
      for (const npc of map.npcs) {
        const dialogue = npc.dialogue;
        if (!dialogue) {
          continue;
        }
        if (dialogue.next) {
          expect(
            ids.has(dialogue.next),
            `${map.id}: ${npc.id} points at a missing node "${dialogue.next}"`,
          ).toBe(true);
        }
        for (const option of dialogue.options ?? []) {
          expect(
            ids.has(option.next),
            `${map.id}: ${npc.id} option "${option.label}" points at a missing node "${option.next}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("never paints a door that leads nowhere", () => {
    // A door tile promises a room. If nothing near it transitions, the map is
    // lying to the player — the Long Haul's cookhouse and workshop doors both
    // did, until the rooms behind them were built.
    for (const map of MAP_LIST) {
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (map.tiles[y]?.[x] !== "door") {
            continue;
          }
          const nearby = [`${x},${y}`, `${x},${y + 1}`, `${x + 1},${y}`, `${x - 1},${y}`];
          expect(
            nearby.some((key) => map.transitions[key]),
            `${map.id}: the door at ${x},${y} has nothing behind it`,
          ).toBe(true);
        }
      }
    }
  });

  it("puts every transition on a tile you can stand on to trigger it", () => {
    // A transition keyed to an impassable tile is unreachable: the player can
    // never stand there, so the door does nothing. (Route 2's gate to the
    // Salt Road Post sat on the map's tree border for exactly this reason.)
    for (const map of MAP_LIST) {
      for (const [key, transition] of Object.entries(map.transitions)) {
        const [rawX, rawY] = key.split(",");
        const tile = map.tiles[Number(rawY)]?.[Number(rawX)];
        expect(tile, `${map.id} ${key} is off the map`).toBeDefined();
        expect(
          isTilePassable(tile!),
          `${map.id} ${key} (-> ${transition.mapId}) sits on ${tile} and can never be stepped on`,
        ).toBe(true);
      }
    }
  });

  it("lands you inside a room rather than on the way back out", () => {
    // A gate that lands you ON another gate is a door you cannot stop
    // falling through: the schoolhouse and the store both did this, walking
    // a player straight back into the street.
    for (const map of MAP_LIST) {
      for (const [key, transition] of Object.entries(map.transitions)) {
        const target = getMap(transition.mapId);
        if (!target) {
          continue;
        }
        const landing = `${transition.toX},${transition.toY}`;
        expect(
          target.transitions[landing],
          `${map.id} ${key} lands on ${transition.mapId} ${landing}, which is itself a gate`,
        ).toBeUndefined();
      }
    }
  });

  it("lands every transition somewhere you can stand", () => {
    for (const mapId of ["starter_town", "home_ranch", "ranch_yard", "route_1", "route_2", "gym_1", "gym_2"]) {
      const map = getMap(mapId);
      if (!map) continue;
      for (const [key, transition] of Object.entries(map.transitions)) {
        const target = getMap(transition.mapId);
        expect(target, `${mapId} ${key} -> ${transition.mapId}`).toBeDefined();
        const tile = target!.tiles[transition.toY]?.[transition.toX];
        expect(tile, `${mapId} ${key} lands on ${transition.toX},${transition.toY}`).toBeDefined();
        expect(
          isTilePassable(tile!),
          `${mapId} ${key} lands on an impassable ${tile}`,
        ).toBe(true);
      }
    }
  });

  it("carries the wild packs through persistence", () => {
    const world = {
      ...createInitialWorldState(),
      wildPacks: { ranch_yard: ["aaaa", "bbbb"] },
      wildGenerations: { ranch_yard: 3 },
    };
    const saved = serializeWorldState(world);
    expect(saved.wildPacks).toEqual({ ranch_yard: ["aaaa", "bbbb"] });
    expect(saved.wildGenerations).toEqual({ ranch_yard: 3 });

    // A save from before the wild existed loads with empty packs (they are
    // founded the first time that biome's grass is walked).
    const legacy = { ...EMPTY_PERSISTED_WORLD } as Record<string, unknown>;
    delete legacy.wildPacks;
    delete legacy.wildGenerations;
    const parsed = parsePersistedWorld(JSON.stringify(legacy));
    expect(parsed).not.toBeNull();
    expect(parsed!.wildPacks).toBeUndefined();
  });

  it("carries the hunt toggle through persistence, defaulting to on", () => {
    const hunting = { ...createInitialWorldState(), hunting: true };
    expect(serializeWorldState(hunting).hunting).toBe(true);
    expect(serializeWorldState({ ...hunting, hunting: false }).hunting).toBe(false);

    // A save from before the toggle existed reads as "looking".
    const legacy = { ...EMPTY_PERSISTED_WORLD } as Record<string, unknown>;
    delete legacy.hunting;
    const parsed = parsePersistedWorld(JSON.stringify(legacy));
    expect(parsed).not.toBeNull();
    expect(parsed!.hunting).toBeUndefined();
  });

  it("defines transitions on the expected map edges", () => {
    const town = getMap("starter_town");
    const route = getMap("route_1");
    const gym = getMap("gym_1");
    const route2 = getMap("route_2");
    const gym2 = getMap("gym_2");
    expect(town?.transitions["13,2"]?.mapId).toBe("route_1");
    expect(town?.transitions["1,0"]).toBeUndefined();
    expect(route?.transitions["1,9"]?.mapId).toBe("starter_town");
    expect(route?.transitions["18,5"]?.mapId).toBe("route_2");
    // The gym gate sits one tile in: on the border tree you could not reach it.
    expect(route?.transitions["17,5"]?.mapId).toBe("gym_1");
    expect(gym?.transitions["6,9"]?.mapId).toBe("route_1");
    expect(route2?.transitions["1,7"]?.mapId).toBe("route_1");
    expect(route2?.transitions["20,4"]?.mapId).toBe("gym_2");
    // ...and the Salt Road stop at the waystation.
    expect(route2?.transitions["20,5"]?.mapId).toBe("long_haul");
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

  it("carries the rancher identity through persistence", () => {
    const base = createInitialWorldState();
    expect(base.rancherName).toBe("");
    expect(base.rancherCap).toBe("navy");
    const world = { ...base, rancherName: "Io", rancherCap: "rust" as const };
    const serialized = serializeWorldState(world);
    expect(serialized.rancherName).toBe("Io");
    expect(serialized.rancherCap).toBe("rust");
    const parsed = parsePersistedWorld(JSON.stringify({ ...serialized, version: 1 }));
    expect(parsed?.rancherName).toBe("Io");
    expect(parsed?.rancherCap).toBe("rust");
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
