import { describe, expect, it } from "vitest";
import {
  advanceRunState,
  createPreviewRunState,
  evaluatePopulation,
  plantSeedDna,
  runEvolutionGeneration,
} from "../src/core/population.js";
import { scoreWildPack, seedWildPack } from "../src/core/wild.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";
import { feudBar } from "../src/renderer/circuit.js";

// The early game, measured from a fresh save, and the shape of the ladder.
//
// Two different questions live here, and conflating them cost me a wrong
// claim in the docs once already:
//
//   1. What does ROBBY'S LOANER become? It crosses the tier I bar at
//      generation 2 (463 -> 1118) and plateaus near 1205, just under tier
//      II's 1220. That is the gift's own line, and it is what the first
//      test below tracks.
//   2. What can a RANDOM herd do? This is the one that decides whether the
//      bars mean anything. Measured over 500 freshly generated cars on
//      Grassland: median 147, p90 483, and exactly 2% ever reach 1000 - with
//      0% reaching tier II. So tier I is a first-sitting formality (the best
//      of a new herd already clears it), and the ladder starts asking real
//      questions at tier II.

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

const STARTER = "vcG5pzmORWqC";

describe("the ladder a new rancher climbs", () => {
  it("starts above what a random herd can do, from tier II on", () => {
    // If fresh random cars could clear the early bars, the circuit would be a
    // formality and the Record Barn would be the whole game. This is the
    // measurement that says otherwise - and the reason the second Brand is
    // the one that teaches breeding.
    const scores: number[] = [];
    for (const seed of [11, 22, 33, 44]) {
      const random = mulberry(seed);
      const state = createPreviewRunState(`dist-${seed}`, createEmptyRunState(`dist-${seed}`), random);
      const evaluation = evaluatePopulation(state.population, "Grassland");
      scores.push(...evaluation.results.map((result) => result.score));
    }
    scores.sort((left, right) => left - right);
    const at = (share: number): number => scores[Math.floor(scores.length * share)]!;
    const shareAbove = (bar: number): number =>
      scores.filter((score) => score >= bar).length / scores.length;

    console.log(
      `[early] random herd: n=${scores.length} median ${Math.round(at(0.5))} ` +
        `p90 ${Math.round(at(0.9))} max ${Math.round(scores[scores.length - 1]!)}`,
    );
    // A random herd is weak: the middle car barely moves.
    expect(at(0.5)).toBeLessThan(400);
    expect(at(0.9)).toBeLessThan(1000);
    // Tier I is a formality for the best of a fresh herd...
    expect(shareAbove(feudBar("Grassland", 1))).toBeLessThan(0.05);
    // ...and tier II is out of reach of luck entirely.
    expect(shareAbove(feudBar("Grassland", 2))).toBe(0);
  }, 180_000);

  it("takes Robby's loaner two generations to reach tier I", () => {
    const random = mulberry(0x5eed);
    const base = createEmptyRunState("first-sitting");
    let state = createPreviewRunState("first-sitting", base, random);
    // What Robby lends you, planted as the top seed of the fresh herd.
    state = { ...state, population: plantSeedDna(state.population, STARTER) };

    const bar = feudBar("Grassland", 1);
    // Slot 0 is the planted loaner: the evaluated array is in input order,
    // and `advanceRunState` keeps the best at the front, so this tracks the
    // GIFT'S OWN LINE rather than the herd's best (separate question,
    // separate test above).
    const best: number[] = [];
    let crossed = -1;
    for (let generation = 1; generation <= 20; generation += 1) {
      const result = runEvolutionGeneration(state, random);
      state = advanceRunState(state, result);
      const loanerLine = result.evaluatedPopulation[0]!.score;
      best.push(loanerLine);
      if (crossed < 0 && loanerLine >= bar) {
        crossed = generation;
      }
    }
    console.log(
      `[early] bar ${bar} | best/gen ${best.map((n) => Math.round(n)).join(" ")} | crossed at gen ${crossed}`,
    );

    // The loaner alone does not clear it: the bar is about breeding, not
    // about the gift.
    expect(best[0]).toBeLessThan(bar);
    // ...but a first sitting gets there, with room to spare.
    expect(crossed).toBeGreaterThan(1);
    expect(crossed).toBeLessThanOrEqual(3);
  }, 120_000);

  it("never lets scoring a generation become the bottleneck", () => {
    // This measures the SCORING model, not the player's wait: the bench races
    // the herd through the same headless evaluation, and the on-screen race is
    // a playback of the result. The ranch upgrades change the herd size, so
    // the guarantee is that the arithmetic never becomes the slow part.
    const random = mulberry(0x5eed);
    let state = createPreviewRunState("timed", createEmptyRunState("timed"), random);
    state = { ...state, population: plantSeedDna(state.population, STARTER) };
    const started = Date.now();
    for (let generation = 1; generation <= 3; generation += 1) {
      state = advanceRunState(state, runEvolutionGeneration(state, random));
    }
    const perGeneration = (Date.now() - started) / 3 / 1000;
    console.log(`[early] ${perGeneration.toFixed(3)}s to score a generation`);
    // Generous: CI machines are slow, and the point is the order of magnitude.
    expect(perGeneration).toBeLessThan(5);
  }, 180_000);

  it("leaves the second Brand for better stock", () => {
    // Tier II sits just above what the loaner's line plateaus at. This is the
    // hinge of the whole circuit: the first trophy is a lesson, the second is
    // a reason to go and find genetics that are not already in the barn.
    const random = mulberry(0x5eed);
    let state = createPreviewRunState("first-sitting", createEmptyRunState("first-sitting"), random);
    state = { ...state, population: plantSeedDna(state.population, STARTER) };
    for (let generation = 1; generation <= 12; generation += 1) {
      state = advanceRunState(state, runEvolutionGeneration(state, random));
    }
    const plateau = Math.max(...state.population.map((entry) => entry.score));
    const tierTwo = feudBar("Grassland", 2);
    expect(plateau).toBeLessThan(tierTwo);
    // Nor is it a gulf: one good import closes it.
    expect(tierTwo - plateau).toBeLessThan(plateau * 0.15);
  }, 120_000);
});

describe("the loaner is pitched between the wild's average and its best", () => {
  it("wins the first catch, and leaves something to hunt for", () => {
    // The tutorial's balance in one measurement. The loaner has to beat the
    // yard's middle animal comfortably, or the first catch — the game's first
    // real test — is a coin flip. It also has to LOSE to the yard's best, or
    // there is nothing out in the grass worth walking to. And the gap should
    // be small: a starter that is far behind the local wild reads as a
    // punishment rather than a gift.
    //
    // Note what this is sensitive to, because it is narrower than it looks:
    // founder packs are seeded deterministically, so raising the wild's
    // mutation rate does NOT move these numbers. What moves them is the
    // loaner's DNA, the sim's scoring, the pack size and the founding seed —
    // which is exactly the set of things that can break the first morning.
    const pack = scoreWildPack("ranch_yard", seedWildPack("ranch_yard"));
    const scores = pack.members.map((member) => member.score).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)]!;
    const champion = scores[scores.length - 1]!;
    const loaner = evaluatePopulation(
      [{ id: "loaner", dna: "vcG5pzmORWqC", parents: [], mutated: false, score: 0 }],
      "Grassland",
    ).results[0]!.score;

    console.log(
      `[early] yard pack: median ${Math.round(median)} champion ${Math.round(champion)} ` +
        `| loaner ${Math.round(loaner)} (${(((champion - loaner) / loaner) * 100).toFixed(0)}% short of the champion)`,
    );
    // Comfortably better than the middle of the pack: the catch is winnable.
    expect(loaner).toBeGreaterThan(median * 2);
    // Behind the ground's best: there is a reason to go and look.
    expect(loaner).toBeLessThan(champion);
    // But close behind: 3% at the time of writing, and not more than a fifth.
    expect(champion - loaner).toBeLessThan(loaner * 0.2);
  }, 60_000);
});
