import { describe, expect, it } from "vitest";
import {
  FACTIONS,
  factionsForBiome,
  findFaction,
  joinedFactionForBiome,
} from "../src/renderer/world/factions.js";

// The world's rival households: two per biome, joined by a dialogue flag and
// remembered in the save. The catalogue is content, so it gets the checks
// content gets everywhere - complete, distinct, and attached to a real place.

describe("the rival households", () => {
  it("gives every biome exactly two houses", () => {
    const byBiome = new Map<string, number>();
    for (const faction of FACTIONS) {
      byBiome.set(faction.biomeId, (byBiome.get(faction.biomeId) ?? 0) + 1);
    }
    expect(byBiome.size).toBeGreaterThanOrEqual(5);
    for (const [biomeId, count] of byBiome) {
      expect(count, `${biomeId} has ${count} houses`).toBe(2);
    }
  });

  it("has ids, houses and credos of its own", () => {
    const ids = new Set<string>();
    const houses = new Set<string>();
    for (const faction of FACTIONS) {
      expect(ids.has(faction.id), `duplicate faction id ${faction.id}`).toBe(false);
      ids.add(faction.id);
      expect(houses.has(faction.house), `duplicate house ${faction.house}`).toBe(false);
      houses.add(faction.house);
      expect(faction.house.length).toBeGreaterThan(4);
      // A house is introduced by somebody with a title and a reason to join.
      expect(faction.title.length).toBeGreaterThan(2);
      expect(faction.credo.length).toBeGreaterThan(20);
    }
  });

  it("names a biome the world actually has", () => {
    // biomeName is what the player sees, so it has to be one of the six
    // terrains the simulation knows rather than a private label.
    const terrains = new Set(["Grassland", "Flat", "Sand", "Hills", "Rocky", "Ice"]);
    for (const faction of FACTIONS) {
      expect(
        terrains.has(faction.biomeName),
        `${faction.house} claims biome ${faction.biomeName}`,
      ).toBe(true);
      expect(faction.biomeId).toBe(faction.biomeName.toLowerCase());
    }
  });

  it("looks a house up by id, and shrugs at anything else", () => {
    const first = FACTIONS[0]!;
    expect(findFaction(first.id)).toMatchObject({ id: first.id });
    expect(findFaction("nobody")).toBeNull();
    expect(findFaction(null)).toBeNull();
    expect(findFaction(undefined)).toBeNull();
  });

  it("reads a join out of the save's choices", () => {
    const first = FACTIONS[0]!;
    expect(joinedFactionForBiome({ [first.biomeId]: first.id }, first.biomeId)?.id).toBe(
      first.id,
    );
    // A biome you have not chosen in, or a house that no longer exists.
    expect(joinedFactionForBiome({}, first.biomeId)).toBeNull();
    expect(joinedFactionForBiome({ [first.biomeId]: "gone" }, first.biomeId)).toBeNull();
  });

  it("returns both houses for a biome, and none for a stranger", () => {
    const biome = FACTIONS[0]!.biomeId;
    const both = factionsForBiome(biome);
    expect(both.length).toBe(2);
    expect(both.every((faction) => faction.biomeId === biome)).toBe(true);
    expect(factionsForBiome("atlantis")).toEqual([]);
  });
});
