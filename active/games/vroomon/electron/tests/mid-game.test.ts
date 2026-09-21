import { describe, expect, it } from "vitest";
import {
  advanceRunState,
  createPreviewRunState,
  plantSeedDna,
  runEvolutionGeneration,
} from "../src/core/population.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";
import { advanceWildPack, scoreWildPack, seedWildPack } from "../src/core/wild.js";
import { feudBar } from "../src/renderer/circuit.js";

// The middle of the game, measured. Two questions: does the circuit's climb
// (x1.22 a tier) pace with what breeding can do, and is the last Brand earned
// or merely waited for?
//
// Everything here is scored on GRASSLAND, because the bars are. Note the trap
// that cost me an hour: starter_town's wild pack is scored on FLAT ground
// while gym_1 - the Grassland arena - is not. Comparing wild scores to herd
// scores across two terrains produces confident nonsense.
//
// Measured, hunting the yard pack for one animal each cycle and planting it:
//   T1@1  T2@5  T3@5  T4@27  T5@27   (herd ceiling 2700)
// And from a pack champion with NO further imports:
//   T1@1  T2@9  T3@15  T4@29  T5 never (ceiling 2046)

/** Deterministic noise, so the arc is the same arc every run. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS = [1, 2, 3, 4, 5].map((tier) => ({
  tier,
  bar: feudBar("Grassland", tier),
  at: -1,
}));

function note(best: number, tiers: typeof TIERS, generation: number): void {
  for (const entry of tiers) {
    if (entry.at < 0 && best >= entry.bar) {
      entry.at = generation;
    }
  }
}

const bestOf = (evaluated: Array<{ score: number }>): number =>
  Math.max(...evaluated.map((entry) => entry.score));

describe("the middle of the circuit", () => {
  it("climbs all five tiers while the player keeps hunting", () => {
    const random = mulberry(0x1a2b);
    let state = createPreviewRunState("mid", createEmptyRunState("mid"), random);
    let pack = seedWildPack("ranch_yard");

    for (let generation = 1; generation <= 35; generation += 1) {
      // What the counter and the grass can offer this cycle: the pack's
      // middle animal, which is what an encounter actually sends.
      const scored = scoreWildPack("ranch_yard", pack);
      const rep = scored.members[Math.floor(scored.members.length / 2)]!;
      state = { ...state, population: plantSeedDna(state.population, rep.dna) };

      const result = runEvolutionGeneration(state, random);
      state = advanceRunState(state, result);
      note(bestOf(result.evaluatedPopulation), TIERS, generation);
      pack = advanceWildPack("ranch_yard", pack, random).pack;
    }

    console.log("[mid] tiers:", TIERS.map((t) => `T${t.tier} ${t.bar}@${t.at}`).join("  "));
    // An engaged player never stalls: every Brand of the Grassland is
    // reachable from the home paddock's own pack, inside one sitting's worth
    // of generations.
    for (const entry of TIERS) {
      expect(entry.at, `tier ${entry.tier} (bar ${entry.bar}) never fell`).toBeGreaterThan(0);
      expect(entry.at, `tier ${entry.tier} took too long`).toBeLessThanOrEqual(35);
    }
    // The first two are immediate: this is what "a first sitting" means.
    expect(TIERS[0]!.at).toBeLessThanOrEqual(3);
    expect(TIERS[1]!.at).toBeLessThanOrEqual(10);
  }, 240_000);

  it("leaves the last Brand unattainable by breeding alone", () => {
    // From the best animal the home pack produces, with no further imports,
    // the herd climbs a long way - and stops short of the last bar. That is
    // the design: the final Brand is earned by staying in the grass, not by
    // waiting at the bench.
    const random = mulberry(0x9f31);
    let pack = seedWildPack("ranch_yard");
    for (let step = 0; step < 8; step += 1) {
      pack = advanceWildPack("ranch_yard", pack, random).pack;
    }
    const champion = scoreWildPack("ranch_yard", pack).members[0]!;

    let state = createPreviewRunState("end", createEmptyRunState("end"), random);
    state = { ...state, population: plantSeedDna(state.population, champion.dna) };
    const tiers = TIERS.map((tier) => ({ ...tier, at: -1 }));
    let ceiling = 0;
    for (let generation = 1; generation <= 30; generation += 1) {
      const result = runEvolutionGeneration(state, random);
      state = advanceRunState(state, result);
      ceiling = Math.max(ceiling, bestOf(result.evaluatedPopulation));
      note(ceiling, tiers, generation);
    }

    console.log(
      `[mid] champion ${Math.round(champion.score)} -> ceiling ${Math.round(ceiling)} | ` +
        tiers.map((t) => `T${t.tier}@${t.at}`).join(" "),
    );
    // A real climb, not a wall: the middle of the circuit is reachable.
    expect(tiers[2]!.at).toBeGreaterThan(0);
    // ...and the end of it is not, from here.
    expect(tiers[4]!.at).toBe(-1);
    expect(ceiling).toBeLessThan(feudBar("Grassland", 5));
  }, 240_000);
});
