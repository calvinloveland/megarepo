import { describe, expect, it } from "vitest";
import { describeVehicle } from "../src/shared/blueprint.js";
import { decodeDnaV2 } from "../src/shared/dna-v2.js";
import {
  advanceWildPack,
  seedWildPack,
  scoreWildPack,
  wildPackAt,
  wildTerrainFor,
  WILD_PACK_SIZE,
} from "../src/core/wild.js";
import { DAY_LENGTH_MS, dayTint, isNight } from "../src/renderer/world/ambience-layer.js";

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

describe("the wild at night", () => {
  it("turns the pack over more in the dark", () => {
    // The watchman says the same animals run the ground better after dark.
    // That is true because a night meeting costs the pack two generations.
    const pack = seedWildPack("ranch_yard");
    const day = advanceWildPack("ranch_yard", pack, mulberry("night-a"), undefined, 1);
    const night = advanceWildPack("ranch_yard", pack, mulberry("night-a"), undefined, 2);

    const dayChampion = scoreWildPack("ranch_yard", day.pack).champion.score;
    const nightChampion = scoreWildPack("ranch_yard", night.pack).champion.score;
    expect(nightChampion).toBeGreaterThanOrEqual(dayChampion);
    // Two steps is not one: the packs differ.
    expect(night.pack).not.toEqual(day.pack);
  });

  it("agrees with the clock about when night is", () => {
    const day = dayTint(DAY_LENGTH_MS * 0.25);
    const dark = dayTint(DAY_LENGTH_MS * 0.9);
    expect(isNight(DAY_LENGTH_MS * 0.25)).toBe(false);
    expect(isNight(DAY_LENGTH_MS * 0.9)).toBe(true);
    expect(day.label).toBe("morning");
    expect(dark.label).toBe("night");
  });
});

describe("the wild keeps more than one build", () => {
  it("never collapses to a single shape of car", () => {
    // The circuit asks for shapes from tier II on, so a pack that converged on
    // one build would make one rung answerable by hunting and the next by
    // nothing. Selection here is on time alone - the spread survives because
    // immigrants and mutation keep putting new builds back in.
    const random = mulberry("wild-shapes");
    let pack = seedWildPack("ranch_yard");
    for (let generation = 0; generation < 20; generation += 1) {
      const shapes = new Set(
        pack.map((dna) => describeVehicle(decodeDnaV2(dna)).driven.length),
      );
      expect(
        shapes.size,
        `generation ${generation}: the whole pack drives ${[...shapes].join("/")} wheels`,
      ).toBeGreaterThan(1);
      pack = advanceWildPack("ranch_yard", pack, random).pack;
    }
  });

  it("offers the early tiers' shapes from the founding pack onward", () => {
    // Tier II wants two driven wheels; a founder pack holds animals that
    // manage it, so a player who hunts deliberately is not locked out of the
    // ladder before they have bred anything.
    const founders = seedWildPack("ranch_yard").map(
      (dna) => describeVehicle(decodeDnaV2(dna)).driven.length,
    );
    expect(founders.filter((driven) => driven >= 2).length).toBeGreaterThan(0);
    // ...and it is not a freebie either: some of them cannot drive at all.
    expect(founders.filter((driven) => driven < 2).length).toBeGreaterThan(0);
  });
});
