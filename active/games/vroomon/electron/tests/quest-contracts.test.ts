// Contracts the quest system has to keep, checked against the real content.
//
// Writing jobs is easy and breaking them is easier: a quest whose accept flag
// no dialogue ever sets can never be taken, one whose prerequisite id is a
// typo can never unlock, a reward genome that cannot drive is a prize nobody
// wants, and a reward decor id that does not exist silently pays nothing.
// These tests read the shipped maps and catalogs rather than a fixture, so
// adding content is what gets checked.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAPS, isTilePassable } from "../src/renderer/world/maps.js";
import { DECOR_ITEMS, findDecor } from "../src/renderer/world/decor.js";
import { SIDE_QUESTS, type QuestObjective } from "../src/renderer/world/side-quests.js";
import { VENUE_ORDER, VENUE_TERRAIN } from "../src/renderer/circuit.js";
import {
  createMatterVehicle,
  snapshotMatterVehicle,
  stepMatterVehicle,
} from "../src/simulation/matter-simulation.js";

/** Every flag any dialogue node sets, anywhere in the world. */
function dialogueFlags(): Set<string> {
  const flags = new Set<string>();
  for (const map of Object.values(MAPS)) {
    for (const npc of map.npcs) {
      const flag = (npc.dialogue as { setFlag?: string } | null)?.setFlag;
      if (flag) {
        flags.add(flag);
      }
    }
  }
  return flags;
}

/** Every flag the renderer or controller sets in code. */
function codeFlags(): Set<string> {
  const flags = new Set<string>();
  const files = [
    "src/renderer/renderer.ts",
    "src/renderer/world/overworld-controller.ts",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/setFlag\(\s*"([^"]+)"/g)) {
      flags.add(match[1]!);
    }
    for (const match of source.matchAll(/flags\["([^"]+)"\]/g)) {
      flags.add(match[1]!);
    }
  }
  return flags;
}

interface DialogueRef {
  mapId: string;
  owner: string;
  id: string;
  node: {
    next?: string;
    options?: Array<{ label: string; next: string }>;
    onComplete?: string | null;
  };
}

/** Every dialogue node in the world, including the story nodes that live on
 * invisible NPCs parked at 0,0. */
function allDialogueNodes(): DialogueRef[] {
  const out: DialogueRef[] = [];
  for (const map of Object.values(MAPS)) {
    for (const npc of map.npcs) {
      const dialogue = npc.dialogue as DialogueRef["node"] | null | undefined;
      if (!dialogue) {
        continue;
      }
      out.push({ mapId: map.id, owner: npc.id, id: npc.id, node: dialogue });
    }
  }
  return out;
}

function travelOnFlat(dna: string): number {
  const vehicle = createMatterVehicle(dna, "Flat");
  const start = snapshotMatterVehicle(vehicle);
  const end = stepMatterVehicle(vehicle, 180);
  return end.centerX - start.centerX;
}

describe("quest contracts", () => {
  const flags = dialogueFlags();

  it("can actually be offered: some dialogue sets every accept flag", () => {
    for (const quest of SIDE_QUESTS) {
      expect(flags.has(quest.acceptFlag), `${quest.id} (${quest.acceptFlag}) is offered by nobody`).toBe(
        true,
      );
    }
  });

  it("points every giver and job at a real map", () => {
    for (const quest of SIDE_QUESTS) {
      expect(MAPS[quest.mapId], `${quest.id} names ${quest.mapId}`).toBeDefined();
      // The giver should be standing somewhere (a virtual node is x/y 0,0).
      const giver = MAPS[quest.mapId]?.npcs.find((npc) => npc.name === quest.giver);
      expect(giver, `${quest.id}: no ${quest.giver} on ${quest.mapId}`).toBeDefined();
    }
  });

  it("chains only to jobs that exist, with no loops", () => {
    const byId = new Map(SIDE_QUESTS.map((quest) => [quest.id, quest]));
    expect(byId.size).toBe(SIDE_QUESTS.length);

    for (const quest of SIDE_QUESTS) {
      if (!quest.requires) {
        continue;
      }
      expect(byId.has(quest.requires), `${quest.id} requires unknown ${quest.requires}`).toBe(true);

      // Walk the chain: it must terminate at a job nobody requires.
      const seen = new Set<string>([quest.id]);
      let cursor = quest.requires;
      while (cursor) {
        expect(seen.has(cursor), `quest chain loops at ${cursor}`).toBe(false);
        seen.add(cursor);
        cursor = byId.get(cursor)?.requires ?? "";
      }
    }
  });

  it("pays in genomes that can actually drive", () => {
    const dnaRewards = SIDE_QUESTS.flatMap((quest) =>
      quest.reward.dna ? [{ id: quest.id, dna: quest.reward.dna }] : [],
    );
    expect(dnaRewards.length).toBeGreaterThan(0);
    for (const reward of dnaRewards) {
      expect(travelOnFlat(reward.dna), `${reward.id} pays a dud: ${reward.dna}`).toBeGreaterThan(200);
    }
  });

  it("pays in decor that exists, and only earned-only decor", () => {
    for (const quest of SIDE_QUESTS) {
      if (!quest.reward.decor) {
        continue;
      }
      expect(findDecor(quest.reward.decor), `${quest.id} pays unknown decor`).toBeDefined();
      // A reward that could simply be bought is not a reward.
      expect(
        DECOR_ITEMS.find((item) => item.id === quest.reward.decor)?.earnedOnly,
        `${quest.id} pays ${quest.reward.decor}, which the shop also sells`,
      ).toBe(true);
    }
  });

  it("exercises every objective kind with real content", () => {
    // A declared kind that no quest uses is dead code pretending to be a
    // feature: it can rot without anything noticing.
    const kinds = new Set(SIDE_QUESTS.map((quest) => quest.objective.kind));
    const every: QuestObjective["kind"][] = [
      "catch-wild",
      "win-wild",
      "win-wild-on",
      "dex-biomes",
      "champion-on",
      "champion-score",
      "generations",
      "decor",
      "visit",
      "brands",
      "release",
    ];
    for (const kind of every) {
      expect(kinds.has(kind), `no shipped quest uses the ${kind} objective`).toBe(true);
    }
  });

  it("gives every rival a car that actually races", () => {
    // A trainer race drives a DNA derived from the NPC's id. If that car does
    // not move, the "race" is a walkover and the rival is a lie.
    const rivals: Array<{ mapId: string; npcId: string; dna: string }> = [];
    for (const map of Object.values(MAPS)) {
      for (const npc of map.npcs) {
        const dialogue = npc.dialogue as { onComplete?: string; rivalDna?: string } | null;
        if (dialogue?.onComplete === "trainer") {
          rivals.push({
            mapId: map.id,
            npcId: npc.id,
            dna: dialogue.rivalDna ?? `trainer-${npc.id}`,
          });
        }
      }
    }
    // There is at least one rival per biome's road, and they all drive.
    expect(rivals.length).toBeGreaterThanOrEqual(3);
    for (const rival of rivals) {
      const travel = travelOnFlat(rival.dna);
      expect(
        travel,
        `${rival.npcId} (${rival.mapId}) races a car that manages ${Math.round(travel)}px`,
      ).toBeGreaterThan(50);
    }
  });

  it("asks for things the ground it names can actually provide", () => {
    // A job to beat wild vroomon on a map with no wild grass is impossible.
    // Every objective that names a ground has to find that ground capable.
    const wildGrassMaps = new Set(
      Object.values(MAPS)
        .filter((map) => map.tiles.flat().includes("vroomgrass"))
        .map((map) => map.id),
    );
    expect(wildGrassMaps.size).toBeGreaterThan(3);

    for (const quest of SIDE_QUESTS) {
      const objective = quest.objective;
      if (objective.kind === "win-wild-on") {
        expect(
          wildGrassMaps.has(objective.mapId),
          `${quest.id}: asked to beat wild vroomon on ${objective.mapId}, which has no tall grass`,
        ).toBe(true);
      }
      if (objective.kind === "catch-wild") {
        // Catching needs grass somewhere reachable from the giver's world.
        expect(wildGrassMaps.size).toBeGreaterThan(0);
      }
    }
  });

  it("hands out work where the work can be done", () => {
    // A giver standing on ground with no wild grass, asking for wild wins on
    // that same ground, is the same bug one step removed. Check the fiction's
    // own claim: the giver's map either has grass or is one gate from it.
    const grassMaps = new Set(
      Object.values(MAPS)
        .filter((map) => map.tiles.flat().includes("vroomgrass"))
        .map((map) => map.id),
    );
    const neighbours = (mapId: string): string[] => {
      const map = MAPS[mapId];
      if (!map) {
        return [];
      }
      const out = Object.values(map.transitions).map((transition) => transition.mapId);
      // Interiors open onto each other through their own gates.
      for (const other of Object.values(MAPS)) {
        if (Object.values(other.transitions).some((t) => t.mapId === mapId)) {
          out.push(other.id);
        }
      }
      return out;
    };

    /** Is any wild ground within a short walk of here? Three gates is a ride. */
    const grassWithin = (mapId: string, hops: number): boolean => {
      let frontier = [mapId];
      const seen = new Set(frontier);
      for (let step = 0; step <= hops; step += 1) {
        if (frontier.some((id) => grassMaps.has(id))) {
          return true;
        }
        const next: string[] = [];
        for (const id of frontier) {
          for (const neighbour of neighbours(id)) {
            if (!seen.has(neighbour)) {
              seen.add(neighbour);
              next.push(neighbour);
            }
          }
        }
        frontier = next;
      }
      return false;
    };

    for (const quest of SIDE_QUESTS) {
      if (quest.objective.kind !== "win-wild-on") {
        continue;
      }
      expect(
        grassWithin(quest.mapId, 3),
        `${quest.id}: ${quest.giver} on ${quest.mapId} is nowhere near wild ground`,
      ).toBe(true);
    }
  });

  it("keeps every job's action inside the giver's own reach", () => {
    // The strongest form of "the work can be done": walk the real map graph
    // from the giver and confirm the thing they are asking for is in the set
    // of places they can actually get to. A rancher jobs a stranger on the
    // far shore, and the errand is impossible.
    const neighbours = (mapId: string): string[] => {
      const map = MAPS[mapId];
      if (!map) {
        return [];
      }
      const out = Object.values(map.transitions).map((transition) => transition.mapId);
      for (const other of Object.values(MAPS)) {
        if (Object.values(other.transitions).some((t) => t.mapId === mapId)) {
          out.push(other.id);
        }
      }
      return out;
    };

    /** Every map reachable from here, the giver's own included. */
    const region = (from: string): Set<string> => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length > 0) {
        for (const neighbour of neighbours(queue.pop()!)) {
          if (!seen.has(neighbour)) {
            seen.add(neighbour);
            queue.push(neighbour);
          }
        }
      }
      return seen;
    };

    const hasGrass = (mapId: string): boolean =>
      Boolean(MAPS[mapId]?.tiles.flat().includes("vroomgrass"));
    const grassMaps = Object.values(MAPS)
      .filter((map) => hasGrass(map.id))
      .map((map) => map.id);
    // A herd job needs the barn; the barn is the ranch pair.
    const barnMaps = ["home_ranch", "ranch_yard"];
    const circuitTerrains = new Set(VENUE_ORDER.map((venue) => VENUE_TERRAIN[venue]!));

    for (const quest of SIDE_QUESTS) {
      const reach = region(quest.mapId);
      // The giver's own map must exist in the graph at all.
      expect(MAPS[quest.mapId], `${quest.id}: giver on ${quest.mapId}`).toBeDefined();
      const inReach = (candidates: string[]): boolean =>
        candidates.some((candidate) => reach.has(candidate));

      switch (quest.objective.kind) {
        case "catch-wild":
        case "win-wild":
          // Wild stock, within the giver's own reach.
          expect(
            grassMaps.some((mapId) => reach.has(mapId)),
            `${quest.id}: ${quest.giver} asks for wild stock but cannot reach grass`,
          ).toBe(true);
          break;
        case "win-wild-on":
          // Specifically the named ground, and it must be wild ground.
          expect(
            hasGrass(quest.objective.mapId),
            `${quest.id}: asks for a wild win on ${quest.objective.mapId}, which has no wild stock`,
          ).toBe(true);
          expect(
            reach.has(quest.objective.mapId),
            `${quest.id}: ${quest.giver} cannot reach ${quest.objective.mapId}`,
          ).toBe(true);
          break;
        case "visit":
          expect(
            reach.has(quest.objective.mapId),
            `${quest.id}: ${quest.giver} cannot reach ${quest.objective.mapId}`,
          ).toBe(true);
          break;
        case "champion-on":
          // The circuit has to cover the ground they name.
          expect(
            circuitTerrains.has(quest.objective.terrain),
            `${quest.id}: asks for ${quest.objective.terrain} champion, which no circuit covers`,
          ).toBe(true);
          expect(
            inReach(VENUE_ORDER),
            `${quest.id}: ${quest.giver} cannot reach any arena`,
          ).toBe(true);
          break;
        case "generations":
        case "decor":
        case "release":
        case "champion-score":
        case "brands":
        case "dex-biomes":
          // Herd work: the ranch must be walkable from the giver.
          expect(
            inReach(barnMaps),
            `${quest.id}: ${quest.giver} asks for herd work but cannot reach the barn`,
          ).toBe(true);
          break;
      }
    }
  });

  it("leaves no earned-only decor item unearnable", () => {
    // An item marked `earnedOnly` is hidden from the ranch shop, so a quest
    // reward is the only way it can ever exist in a save. Add one without a
    // job that pays it and the flavour text describes furniture nobody can
    // have - the same shape of dead content as a written line with no screen.
    const granted = new Set(
      SIDE_QUESTS.map((quest) => quest.reward.decor).filter(
        (id): id is string => typeof id === "string",
      ),
    );
    const earned = DECOR_ITEMS.filter((item) => item.earnedOnly);
    expect(earned.length).toBeGreaterThan(0);
    for (const item of earned) {
      expect(
        granted.has(item.id),
        `${item.id} is earned-only but no quest pays it out`,
      ).toBe(true);
      // And it must not also be priced for sale, or "earned" means nothing.
      expect(
        DECOR_ITEMS.filter((candidate) => !candidate.earnedOnly).some(
          (candidate) => candidate.id === item.id,
        ),
        `${item.id} is both earned-only and for sale`,
      ).toBe(false);
    }
  });

  it("never sends a story beat to a place that is not there", () => {
    // A `goto:` is the one place content moves the player by hand. The
    // controller quietly shrugs off a bad destination, which means a typo
    // silently ends a scene instead of failing: the reveal beat that walks
    // you into the yard would just... not. So check the destination exists,
    // that you can stand on it, and that the node it names is really on the
    // far side.
    const nodes = allDialogueNodes();
    const gotos = nodes.filter((ref) => ref.node.onComplete?.startsWith("goto:"));
    expect(gotos.length).toBeGreaterThan(0);

    for (const ref of gotos) {
      const [, mapId, rawX, rawY, nodeId] = ref.node.onComplete!.split(":");
      const map = MAPS[mapId ?? ""];
      expect(map, `${ref.mapId}:${ref.owner} walks to unknown map ${mapId}`).toBeDefined();
      const x = Number(rawX);
      const y = Number(rawY);
      expect(Number.isFinite(x) && Number.isFinite(y), `${ref.owner}: bad coords`).toBe(true);
      const tile = map!.tiles[y]?.[x];
      expect(
        tile !== undefined && isTilePassable(tile),
        `${ref.mapId}:${ref.owner} lands on ${tile ?? "nothing"} at ${mapId}:${x},${y}`,
      ).toBe(true);
      if (nodeId) {
        const landing = map!.npcs.find((npc) => npc.id === nodeId);
        expect(
          landing?.dialogue,
          `${ref.mapId}:${ref.owner} hands off to ${nodeId}, which has no dialogue on ${mapId}`,
        ).toBeTruthy();
      }
    }
  });

  it("never links a dialogue node to a name that is not there", () => {
    // `next` is resolved by hunting for an NPC with that id on the same map,
    // and a miss just ends the conversation. A renamed story node would cut a
    // scene in half with no error anywhere.
    for (const ref of allDialogueNodes()) {
      const map = MAPS[ref.mapId]!;
      const targets = [
        ...(ref.node.next ? [ref.node.next] : []),
        ...(ref.node.options ?? []).map((option) => option.next),
      ];
      for (const target of targets) {
        expect(
          map.npcs.some((npc) => npc.id === target),
          `${ref.mapId}: ${ref.owner} links to ${target}, which is not on this map`,
        ).toBe(true);
      }
    }
  });

  it("only reads flags that something actually sets", () => {
    // A condition on a flag nobody writes can never fire: the beat is written,
    // placed, and unreachable. This is exactly how the tutorial's reveal went
    // missing once, so it is checked at the source level now.
    const written = new Set([...flags, ...codeFlags()]);
    const read = new Set<string>();
    for (const file of [
      "src/renderer/renderer.ts",
      "src/renderer/world/quest.ts",
      "src/renderer/world/overworld-controller.ts",
      "src/renderer/world/side-quests.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:requires|flag|flags)[^\n]{0,12}flags\["([^"]+)"\]/g)) {
        read.add(match[1]!);
      }
      for (const match of source.matchAll(/flags\["([^"]+)"\]/g)) {
        read.add(match[1]!);
      }
    }
    expect(read.size).toBeGreaterThan(0);
    const orphans = [...read].filter((flag) => !written.has(flag));
    expect(orphans, `flags read but never set: ${orphans.join(", ")}`).toEqual([]);
  });

  it("asks for something a rancher can measure", () => {
    for (const quest of SIDE_QUESTS) {
      if (quest.objective.kind === "win-wild-on") {
        expect(MAPS[quest.objective.mapId], `${quest.id} counts wins on ${quest.objective.mapId}`).toBeDefined();
      }
      if (quest.objective.kind === "visit") {
        const wanted = quest.objective.mapId;
        expect(MAPS[wanted], `${quest.id} asks you to walk ${wanted}`).toBeDefined();
        // And something must lead there, or the errand is impossible.
        const entered = Object.values(MAPS).some((map) =>
          Object.values(map.transitions).some((transition) => transition.mapId === wanted),
        );
        const isTown = wanted === "starter_town";
        expect(entered || isTown, `${quest.id} asks for a map nothing leads to`).toBe(true);
      }
      expect(quest.objective.label.length).toBeGreaterThan(0);
      expect(quest.offer.length).toBeGreaterThan(20);
      expect(quest.reward.thanks.length).toBeGreaterThan(10);
    }
  });
});
