// The evolution simulator's core promise: breeding makes the herd better.
//
// This exists because it silently stopped being true. The decoder mixes each
// part's parameters from a window of neighbouring DNA positions, and with a
// wide window a one-character mutation re-rolled nearly every part — so
// children were unrelated to their parents, selection had nothing to
// accumulate, and the herd's best score sat frozen for 25 generations while
// simply re-rolling random populations did better. Locality is the whole
// mechanism; these tests hold it in place.

import { describe, expect, it } from "vitest";
import {
  advanceRunState,
  createPreviewRunState,
  runEvolutionGeneration,
  seedGenealogy,
} from "../../src/core/population.js";
import { createEmptyRunState } from "../../src/shared/parity-contract.js";
import { decodeDnaV2, uniformAt } from "../../src/shared/dna-v2.js";

function mulberry(seed: string): () => number {
  let state = 0;
  for (const char of seed) {
    state = (state * 31 + char.charCodeAt(0)) % 4294967296;
  }
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generationBest(scores: number[]): number {
  return Math.max(...scores);
}

function runHerd(options: {
  generations: number;
  populationSize: number;
  mutationRate: number;
  terrain: string;
  seed: string;
}): number[] {
  const base = createEmptyRunState("evolution");
  const configured = {
    ...base,
    terrainName: options.terrain,
    config: {
      ...base.config,
      populationSize: options.populationSize,
      mutationRate: options.mutationRate,
    },
  };
  let state = createPreviewRunState(options.seed, configured, mulberry(options.seed));
  const trajectory: number[] = [];

  for (let generation = 0; generation < options.generations; generation += 1) {
    const result = runEvolutionGeneration(state, mulberry(`${options.seed}-${generation}`));
    trajectory.push(
      generationBest(result.evaluation.results.map((entry) => entry.score)),
    );
    state = advanceRunState(state, result);
  }

  return trajectory;
}

describe("breeding improves the herd", () => {
  it("climbs generation over generation", () => {
    const trajectory = runHerd({
      generations: 18,
      populationSize: 45,
      mutationRate: 0.3,
      terrain: "Flat",
      seed: "climb",
    });
    const early = trajectory[0]!;
    const late = generationBest(trajectory.slice(-5));

    // eslint-disable-next-line no-console
    console.log(
      `[evolution] best per generation: ${trajectory.map((score) => Math.round(score)).join(" ")}`,
    );

    // Selection has to accumulate: the herd must end up clearly better than
    // it started. (A frozen trajectory is what a non-local decoder produces.)
    expect(late).toBeGreaterThan(early * 1.15);
  }, 60_000);

  it("beats re-rolling random populations with the same budget", () => {
    // Like for like: the same number of evaluated cars, either bred or
    // freshly rolled. Each car is raced on its own, so scores are stable and
    // a herd's elite survives to be improved on.
    // Five seeds: the claim is about the method, not about one lucky run.
    const seeds = ["evo-a", "evo-b", "evo-c", "evo-d", "evo-e"];
    const generations = 12;
    const evolved: number[] = [];
    const random: number[] = [];

    for (const seed of seeds) {
      const trajectory = runHerd({
        generations,
        populationSize: 45,
        mutationRate: 0.3,
        terrain: "Flat",
        seed,
      });
      evolved.push(generationBest(trajectory.slice(-4)));

      let best = 0;
      for (let attempt = 0; attempt < generations; attempt += 1) {
        const rolled = runHerd({
          generations: 1,
          populationSize: 45,
          mutationRate: 0.3,
          terrain: "Flat",
          seed: `${seed}-random-${attempt}`,
        });
        best = Math.max(best, generationBest(rolled));
      }
      random.push(best);
    }

    const mean = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    // eslint-disable-next-line no-console
    console.log(
      `[evolution] bred mean=${Math.round(mean(evolved))} vs random mean=${Math.round(mean(random))}`,
    );

    // Breeding has to be worth more than luck. This is the property that was
    // silently false: the herd used to plateau below what random search found
    // in the same budget, because every car's score depended on its slot in
    // the shared race and mutations re-rolled whole cars.
    expect(mean(evolved)).toBeGreaterThan(mean(random) * 1.1);
  }, 60_000);

  it("reads every character of the genome", () => {
    // A fixed stride left the tail of a long genome unread: mutating those
    // characters changed nothing and a crossover cut there produced a clone.
    const base = "A3x9K2m7P4zQABCDEF";
    const fingerprint = (dna: string): string => {
      const decoded = decodeDnaV2(dna);
      return [
        ...decoded.rectParams.map((r) => (r ? r.width.toFixed(2) : "-")),
        ...decoded.wheelParams.map((w) => (w ? w.radius.toFixed(2) : "-")),
        decoded.powertrainModules.join(""),
        decoded.positions.map((position) => position.toFixed(2)).join(","),
      ].join("|");
    };

    const original = fingerprint(base);
    for (let position = 0; position < base.length; position += 1) {
      const replacement = base[position] === "z" ? "y" : "z";
      const mutated = `${base.slice(0, position)}${replacement}${base.slice(position + 1)}`;
      expect(fingerprint(mutated)).not.toBe(original);
    }
  });

  it("keeps a mutation near the part it touched", () => {
    const base = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const mutated = `${base.slice(0, 16)}z${base.slice(17)}`;

    // Neighbours move...
    expect(uniformAt(base, 2, 16)).not.toBe(uniformAt(mutated, 2, 16));
    expect(uniformAt(base, 2, 15)).not.toBe(uniformAt(mutated, 2, 15));
    // ...and parts two slots away do not.
    expect(uniformAt(base, 2, 18)).toBe(uniformAt(mutated, 2, 18));
    expect(uniformAt(base, 2, 3)).toBe(uniformAt(mutated, 2, 3));
  });

  it("changes only a few of a car's parameters per mutation", () => {
    const base = "A3x9K2m7P4zQ";
    const fingerprint = (dna: string): string => {
      const decoded = decodeDnaV2(dna);
      return [
        ...decoded.rectParams.map((r) => (r ? `${r.width.toFixed(1)}/${r.height.toFixed(1)}/${r.angleDeg.toFixed(1)}` : "-")),
        ...decoded.wheelParams.map((w) => (w ? `${w.radius.toFixed(1)}/${w.friction.toFixed(1)}` : "-")),
        decoded.powertrainModules.join(""),
      ].join("|");
    };
    const before = fingerprint(base).split("|");
    const after = fingerprint("A3x9K2m7P4zP").split("|");
    const changed = before.filter((value, index) => value !== after[index]).length;

    // A whole-car reshuffle changes everything; a breeding mutation should
    // touch a handful of slots at most.
    expect(changed).toBeLessThan(before.length);
    expect(changed).toBeLessThanOrEqual(Math.ceil(before.length / 2));
  });
});

describe("the genealogy a new herd starts with", () => {
  it("names every car with no parents", () => {
    const state = createPreviewRunState("gen", createEmptyRunState("gen"), () => 0.5);
    const genealogy = seedGenealogy(state.population);
    expect(Object.keys(genealogy).length).toBe(state.population.length);
    for (const [id, children] of Object.entries(genealogy)) {
      expect(children, `${id} starts with children`).toEqual([]);
      expect(state.population.some((entry) => entry.id === id)).toBe(true);
    }
  });
});
