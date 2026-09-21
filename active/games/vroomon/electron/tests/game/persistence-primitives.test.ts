import { describe, expect, it } from "vitest";
import {
  parseGenerationLogEntry,
  serializeGenerationLogEntry,
  type GenerationLogEntry,
} from "../../src/core/persistence.js";
import {
  base62Value,
  inverseNormalCdf,
  isBase62,
} from "../../src/shared/dna-v2.js";
import {
  getGenerationLogPath,
  getHallOfFamePath,
  getRunStatePath,
  getUpgradesPath,
  getWorldStatePath,
} from "../../src/main/file-store.js";

// Primitives that the modules above them are thoroughly tested against, but
// which no test had ever asserted on directly. Each of these is a contract with
// something outside the app - a saved file, an alphabet, a distribution - so a
// silent drift in one of them is a bug that shows up as data loss or a subtly
// wrong curve rather than as a failure.

describe("the saved generation log", () => {
  const entry: GenerationLogEntry = {
    runId: "run-1",
    generation: 7,
    terrainName: "Grassland",
    populationSize: 100,
    bestVehicleId: "preview-abc-00012",
    bestScore: 1234.5,
    meanScore: 401.25,
  };

  it("round-trips an entry without losing anything", () => {
    expect(parseGenerationLogEntry(serializeGenerationLogEntry(entry))).toEqual(entry);
  });

  it("keeps a null best, which is what a wiped generation looks like", () => {
    const empty: GenerationLogEntry = { ...entry, bestVehicleId: null, meanScore: null };
    const back = parseGenerationLogEntry(serializeGenerationLogEntry(empty));
    expect(back.bestVehicleId).toBeNull();
    expect(back.meanScore).toBeNull();
  });

  it("writes one line per entry, so a log stays appendable", () => {
    expect(serializeGenerationLogEntry(entry)).not.toContain("\n");
  });
});

describe("the DNA alphabet", () => {
  it("accepts exactly the base62 characters, one at a time", () => {
    for (const character of "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      expect(isBase62(character), `${character} should be base62`).toBe(true);
    }
    for (const bad of ["-", "!", " ", "aa", ""]) {
      expect(isBase62(bad), `${bad} should not be base62`).toBe(false);
    }
  });

  it("values the alphabet in order, and treats anything else as zero", () => {
    // The order is digits, then UPPERCASE, then lowercase - which I assumed
    // wrong when writing this and would have encoded into the test. Anybody
    // hand-typing a DNA string is relying on this exact sequence.
    expect(base62Value("0")).toBe(0);
    expect(base62Value("9")).toBe(9);
    expect(base62Value("A")).toBe(10);
    expect(base62Value("Z")).toBe(35);
    expect(base62Value("a")).toBe(36);
    expect(base62Value("z")).toBe(61);
    // A character outside the alphabet reads as zero rather than throwing:
    // decoding a hand-typed string should never crash the app.
    expect(base62Value("-")).toBe(0);
    expect(base62Value("")).toBe(0);
  });
});

describe("the rival's score curve", () => {
  it("is centred on zero and symmetric", () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 6);
    expect(inverseNormalCdf(0.9)).toBeCloseTo(-inverseNormalCdf(0.1), 4);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.96, 2);
  });

  it("rises with probability, and never returns infinity", () => {
    let previous = -Infinity;
    for (let p = 0.05; p < 0.96; p += 0.05) {
      const value = inverseNormalCdf(p);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    // The ends are clamped rather than exploding, so a rival score stays finite.
    expect(Number.isFinite(inverseNormalCdf(0))).toBe(true);
    expect(Number.isFinite(inverseNormalCdf(1))).toBe(true);
    expect(inverseNormalCdf(0)).toBeLessThan(-5);
    expect(inverseNormalCdf(1)).toBeGreaterThan(5);
  });
});

describe("where the app keeps its files", () => {
  it("puts every path inside one vroomon directory", () => {
    // These decide where a player's herd, world and records live. A path that
    // escaped the directory would write somewhere it does not belong.
    const base = "/tmp/userdata";
    for (const path of [
      getRunStatePath(base),
      // The log is per run, so it takes a run id.
      getGenerationLogPath(base, "run-1"),
      getHallOfFamePath(base),
      getUpgradesPath(base),
      getWorldStatePath(base),
    ]) {
      expect(path.startsWith("/tmp/userdata/vroomon/")).toBe(true);
      // The generation log is JSON Lines - one entry per line, which is what
      // makes it appendable - so it is .jsonl rather than .json.
      expect(path.endsWith(".json") || path.endsWith(".jsonl")).toBe(true);
    }
  });

  it("gives each file its own name", () => {
    const base = "/tmp/userdata";
    const paths = [
      getRunStatePath(base),
      getGenerationLogPath(base, "run-1"),
      getHallOfFamePath(base),
      getUpgradesPath(base),
      getWorldStatePath(base),
    ];
    expect(new Set(paths).size).toBe(paths.length);
    // Runs keep separate logs, so two runs do not overwrite each other.
    expect(getGenerationLogPath(base, "run-1")).not.toBe(
      getGenerationLogPath(base, "run-2"),
    );
  });
});
