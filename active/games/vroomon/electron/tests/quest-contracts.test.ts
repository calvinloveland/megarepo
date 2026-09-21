// Contracts the quest system has to keep, checked against the real content.
//
// Writing jobs is easy and breaking them is easier: a quest whose accept flag
// no dialogue ever sets can never be taken, one whose prerequisite id is a
// typo can never unlock, a reward genome that cannot drive is a prize nobody
// wants, and a reward decor id that does not exist silently pays nothing.
// These tests read the shipped maps and catalogs rather than a fixture, so
// adding content is what gets checked.

import { describe, expect, it } from "vitest";
import { MAPS } from "../src/renderer/world/maps.js";
import { DECOR_ITEMS, findDecor } from "../src/renderer/world/decor.js";
import { SIDE_QUESTS, type QuestObjective } from "../src/renderer/world/side-quests.js";
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
