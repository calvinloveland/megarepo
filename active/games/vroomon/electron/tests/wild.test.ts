import { describe, expect, it } from "vitest";
import {
  advanceWildPack,
  seedWildPack,
  scoreWildPack,
  wildPackAt,
  wildTerrainFor,
  WILD_PACK_SIZE,
} from "../src/core/wild.js";

function mulberry(seed: string): () => number {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) % 4294967296;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the wild", () => {
  it("founds a deterministic pack per biome", () => {
    expect(seedWildPack("ranch_yard")).toEqual(seedWildPack("ranch_yard"));
    expect(seedWildPack("ranch_yard")).not.toEqual(seedWildPack("ice_map"));
    expect(seedWildPack("ranch_yard")).toHaveLength(WILD_PACK_SIZE);
  });

  it("selects on the ground the pack lives on", () => {
    expect(wildTerrainFor("ice_map")).toBe("Ice");
    expect(wildTerrainFor("route_2")).toBe("Sand");
    expect(wildTerrainFor("ranch_yard")).toBe("Grassland");
    expect(wildTerrainFor("nowhere")).toBe("Grassland");
    expect(scoreWildPack("ice_map", seedWildPack("ice_map")).terrain).toBe("Ice");
  });

  it("gets faster as it turns over with nobody in charge", () => {
    // Natural selection, no rancher: the pack's champion should improve over
    // a run of generations, exactly as a tended herd does.
    let pack = seedWildPack("ranch_yard");
    const random = mulberry("wild-evolve");
    const champions: number[] = [];

    for (let generation = 0; generation < 10; generation += 1) {
      const step = advanceWildPack("ranch_yard", pack, random);
      pack = step.pack;
      champions.push(step.champion.score);
    }

    const early = Math.max(...champions.slice(0, 2));
    const late = Math.max(...champions.slice(-3));
    // eslint-disable-next-line no-console
    console.log(
      `[wild] champions: ${champions.map((score) => Math.round(score)).join(" ")}`,
    );
    expect(late).toBeGreaterThan(early);
  });

  it("sends a middling animal out, not the alpha", () => {
    // Meeting the champion every time made the wild a wall, and made the
    // tutorial's first catch unwinnable: Robby's loaner (~460px) is slower
    // than a selected pack's best. A specimen of the ground is what turns up.
    const founder = scoreWildPack("ranch_yard", seedWildPack("ranch_yard"));
    expect(founder.representative.score).toBeLessThan(founder.champion.score);
    expect(founder.representative.score).toBeLessThan(300);

    // It still rises with the pack, which is the arms race that matters.
    let pack = seedWildPack("ranch_yard");
    const random = mulberry("specimen");
    for (let generation = 0; generation < 8; generation += 1) {
      pack = advanceWildPack("ranch_yard", pack, random).pack;
    }
    const later = scoreWildPack("ranch_yard", pack);
    expect(later.representative.score).toBeGreaterThan(
      founder.representative.score * 2,
    );
  });

  it("keeps wanderers coming so the pack never converges", () => {
    let pack = seedWildPack("route_1");
    const random = mulberry("wander");
    for (let generation = 0; generation < 6; generation += 1) {
      pack = advanceWildPack("route_1", pack, random).pack;
    }
    // Still a full pack of distinct animals, not one clone.
    expect(pack).toHaveLength(WILD_PACK_SIZE);
    expect(new Set(pack).size).toBeGreaterThan(WILD_PACK_SIZE / 2);
  });

  it("can be evolved forward from a saved pack", () => {
    const pack = seedWildPack("hills_map");
    const atZero = wildPackAt("hills_map", 0, pack);
    const atFive = wildPackAt("hills_map", 5, pack);
    expect(atZero.members).toHaveLength(WILD_PACK_SIZE);
    expect(atFive.members).toHaveLength(WILD_PACK_SIZE);
    expect(atFive.terrain).toBe("Hills");
  });
});
