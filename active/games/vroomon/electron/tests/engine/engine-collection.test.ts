import { describe, expect, it } from "vitest";

import {
  Collection,
  breedSpecimens,
  createCharacterCodec,
  createFoundingPopulation,
  createSpecimen,
  evolveOnce,
  nextSpecimenId,
} from "../../src/engine/collection.js";
import { createRng } from "../../src/engine/rng.js";

const codec = createCharacterCodec("ab");

describe("genome codec", () => {
  it("crosses, mutates and validates over a fixed alphabet", () => {
    const rng = createRng("codec");
    const mother = "aaaa";
    const father = "bbbb";
    const child = codec.crossover(mother, father, rng);
    expect(child).toHaveLength(4);
    expect(codec.validate(child)).toBe(true);
    expect(child).not.toBe("aaaa");
    expect(child).not.toBe("bbbb");

    // With a rate of 1 every gene is replaced; with 0 none is.
    expect(codec.mutate("aaaa", createRng("burn"), 1)).not.toBe("aaaa");
    expect(codec.mutate("abab", createRng("still"), 0)).toBe("abab");
    expect(codec.validate("abc")).toBe(false);
    expect(codec.validate("")).toBe(false);
    expect(codec.random(createRng("rand"), 6)).toHaveLength(6);
  });

  it("refuses an alphabet with nothing to choose from", () => {
    expect(() => createCharacterCodec("a")).toThrow(/two characters/);
  });
});

describe("specimens", () => {
  it("defaults its provenance and copies its tags", () => {
    const tags = ["founder"];
    const specimen = createSpecimen({ id: "s-1", genome: "abab", tags });
    expect(specimen.generation).toBe(0);
    expect(specimen.origin).toBe("caught");
    expect(specimen.parents).toBeNull();
    expect(specimen.caughtAt).toMatch(/^\d{4}-/);
    tags.push("mutated");
    expect(specimen.tags).toEqual(["founder"]);
    expect(nextSpecimenId("spec", createRng("id"))).toMatch(/^spec-[0-9a-f]{6}$/);
  });

  it("breeds a child with both parents named and a higher generation", () => {
    const mother = createSpecimen({ id: "m", genome: "aaaa", generation: 2 });
    const father = createSpecimen({ id: "f", genome: "bbbb", generation: 4 });
    const child = breedSpecimens(mother, father, {
      codec,
      rng: createRng("breed"),
      mutationRate: 0,
      idPrefix: "calf",
      now: () => new Date("2026-09-15T00:00:00Z"),
    });
    expect(child.parents).toEqual(["m", "f"]);
    expect(child.generation).toBe(5);
    expect(child.origin).toBe("bred");
    expect(child.caughtAt).toBe("2026-09-15T00:00:00.000Z");
    expect(codec.validate(child.genome)).toBe(true);
  });
});

describe("collection", () => {
  it("bounds itself and refuses duplicates by id", () => {
    const herd = new Collection(2);
    const first = createSpecimen({ id: "a", genome: "aa" });
    const second = createSpecimen({ id: "b", genome: "bb" });
    expect(herd.add(first)).toEqual({ ok: true, specimen: first });
    expect(herd.add(first)).toEqual({ ok: false, reason: "duplicate" });
    expect(herd.add(second).ok).toBe(true);
    expect(herd.isFull).toBe(true);
    expect(herd.add(createSpecimen({ id: "c", genome: "cc" }))).toEqual({ ok: false, reason: "full" });
    expect(herd.size).toBe(2);
    expect(herd.remove("a")).toBe(true);
    expect(herd.remove("a")).toBe(false);
    expect(herd.has("b")).toBe(true);
    expect(herd.get("b")?.genome).toBe("bb");
    expect(() => new Collection(0)).toThrow(/at least one/);
  });

  it("names the best specimen and traces descendants", () => {
    const herd = new Collection(10);
    herd.add(createSpecimen({ id: "gm", genome: "aaab", generation: 0 }));
    herd.add(createSpecimen({ id: "mum", genome: "aaaa", generation: 1, parents: ["gm", "unknown"] }));
    herd.add(createSpecimen({ id: "kid", genome: "aabb", generation: 2, parents: ["mum", "x"] }));
    herd.add(createSpecimen({ id: "weak", genome: "bbbb", generation: 1 }));
    const scored = (genome: string): number => [...genome].filter((gene) => gene === "a").length;
    expect(herd.best((specimen) => scored(specimen.genome))?.id).toBe("mum");
    expect(herd.descendantsOf("gm").map((specimen) => specimen.id)).toEqual(["mum", "kid"]);
    expect(herd.recent()).toHaveLength(4);
  });

  it("restores from a snapshot without exceeding capacity", () => {
    const herd = new Collection(2);
    herd.restore([
      createSpecimen({ id: "a", genome: "aa" }),
      createSpecimen({ id: "b", genome: "bb" }),
      createSpecimen({ id: "c", genome: "cc" }),
    ]);
    expect(herd.list().map((specimen) => specimen.id)).toEqual(["a", "b"]);
    herd.restore([]);
    expect(herd.size).toBe(0);
  });
});

describe("evolution", () => {
  it("improves a population under selection and keeps the elite", () => {
    const rng = createRng("evolve");
    const score = (genome: string): number => [...genome].filter((gene) => gene === "a").length;
    let population = createFoundingPopulation(24, 12, codec, rng);
    const firstBest = Math.max(...population.map(score));
    let lastBest = firstBest;
    for (let generation = 0; generation < 40; generation += 1) {
      const result = evolveOnce(population, score, { codec, rng, eliteCount: 2, mutationRate: 0.08 });
      expect(result.genomes).toHaveLength(24);
      expect(result.scores).toHaveLength(24);
      expect(result.average).toBeGreaterThanOrEqual(0);
      lastBest = result.best.score;
      population = result.genomes;
    }
    expect(lastBest).toBeGreaterThan(firstBest);
    expect(() => evolveOnce([], score, { codec, rng })).toThrow(/population/);
    expect(() => createFoundingPopulation(0, 4, codec)).toThrow(/positive/);
  });
});
