import { describe, expect, it } from "vitest";
import {
  ageLabel,
  dexSummary,
  pruneSpecimenMeta,
  recordSpecimen,
  specimenEntries,
  type SpecimenMeta,
} from "../../src/renderer/world/specimens.js";

function meta(overrides: Partial<SpecimenMeta> = {}): SpecimenMeta {
  return {
    mapId: "ranch_yard",
    score: 300,
    caughtAt: "2026-09-15T12:00:00.000Z",
    origin: "caught",
    ...overrides,
  };
}

describe("specimen provenance", () => {
  it("records where a specimen came from", () => {
    const next = recordSpecimen({}, "abc", meta(), ["abc"]);
    expect(next.abc).toEqual(meta());
  });

  it("keeps notes only for genomes the herd book still holds", () => {
    const notes = { a: meta(), b: meta({ mapId: "ice_map" }), gone: meta() };
    expect(Object.keys(pruneSpecimenMeta(notes, ["a", "b"])).sort()).toEqual(["a", "b"]);
    expect(pruneSpecimenMeta(notes, [])).toEqual({});
  });

  it("drops the note when its genome ages out of the book", () => {
    // The dex caps at 200; recording into a full book must not keep stale
    // notes for specimens that were pushed out.
    const notes = recordSpecimen({}, "new", meta(), []);
    expect(Object.keys(notes)).toEqual(["new"]);
    const pruned = pruneSpecimenMeta(notes, ["other"]);
    expect(pruned).toEqual({});
  });

  it("lists newest first and reads the collection", () => {
    const dex = ["first", "second", "third"];
    const notes = {
      first: meta({ mapId: "ranch_yard", score: 120 }),
      second: meta({ mapId: "ice_map", score: 880 }),
      // third was never noted (a save from before provenance existed)
    };
    const entries = specimenEntries(dex, notes);
    expect(entries.map((entry) => entry.dna)).toEqual(["third", "second", "first"]);

    const summary = dexSummary(entries);
    expect(summary.total).toBe(3);
    expect(summary.biomes).toBe(2);
    expect(summary.unrecorded).toBe(1);
    expect(summary.best).toEqual({ dna: "second", score: 880 });
  });

  it("says nothing rather than nonsense for an empty or unrecorded book", () => {
    expect(dexSummary([])).toEqual({ total: 0, biomes: 0, best: null, unrecorded: 0 });
    expect(dexSummary([{ dna: "x", meta: null }]).best).toBeNull();
  });

  it("reads ages in words", () => {
    const now = "2026-09-15T12:00:00.000Z";
    expect(ageLabel("2026-09-15T12:00:00.000Z", now)).toBe("just now");
    expect(ageLabel("2026-09-15T11:30:00.000Z", now)).toBe("30 min ago");
    expect(ageLabel("2026-09-15T09:00:00.000Z", now)).toBe("3h ago");
    expect(ageLabel("2026-09-14T11:00:00.000Z", now)).toBe("yesterday");
    expect(ageLabel("2026-09-11T12:00:00.000Z", now)).toBe("4 days ago");
    expect(ageLabel("not a date", now)).toBe("unrecorded");
  });
});
