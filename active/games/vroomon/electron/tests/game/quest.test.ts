import { describe, expect, it } from "vitest";
import { questFor } from "../../src/renderer/world/quest.js";

const world = (over: Partial<Parameters<typeof questFor>[0]> = {}) => ({
  badges: [],
  factionChoices: {},
  flags: {},
  ...over,
});

describe("overworld quest director", () => {
  it("walks the ranch tutorial from the kitchen to the garden gate", () => {
    const atRanch = (flags: Record<string, boolean>) =>
      questFor({ badges: [], factionChoices: {}, flags, currentMapId: "ranch_yard" });
    expect(atRanch({}).main).toContain("kitchen");
    expect(atRanch({ "tut-revealed": true }).main).toContain("tall grass");
    // ...unless the hunt is switched off, when the grass can't shake at all.
    expect(
      questFor({
        badges: [],
        factionChoices: {},
        flags: { "tut-revealed": true },
        currentMapId: "ranch_yard",
        hunting: false,
      }).hint,
    ).toContain("Press H");
    expect(atRanch({ "tut-revealed": true, "tut-caught": true }).main).toContain("Herd Book");
    expect(
      atRanch({ "tut-revealed": true, "tut-caught": true, "tut-done": true }).main,
    ).toContain("garden gate");
    // The house and the yard are both "at the ranch".
    expect(
      questFor({ badges: [], factionChoices: {}, flags: {}, currentMapId: "home_ranch" }).main,
    ).toContain("kitchen");
  });

  it("points at Professor Axle until he is met", () => {
    const q = questFor(world());
    expect(q.main).toContain("Professor Axle");
  });

  it("directs the player through the Brands in biome order", () => {
    const q1 = questFor(world({ flags: { "met-axle": true } }));
    expect(q1.main).toContain("Rustler Pasture");
    expect(q1.main).toContain("Roundup King");

    const q2 = questFor(world({
      flags: { "met-axle": true },
      badges: ["Grassland Brand"],
    }));
    expect(q2.main).toContain("Salt Road Post");

    const q3 = questFor(world({
      flags: { "met-axle": true },
      badges: ["Grassland Brand", "Salt Road Brand", "Highland Brand", "Canyon Brand"],
      factionChoices: { hills: "skimmers" },
    }));
    expect(q3.main).toContain("Drift Perimeter");
  });

  it("hints to join a house when the biome has none chosen", () => {
    const q = questFor(world({ flags: { "met-axle": true } }));
    expect(q.hint).toContain("choose your house");
  });

  it("points to the Grand Roundup once all five Brands are earned", () => {
    const q = questFor(world({
      flags: { "met-axle": true },
      badges: ["Grassland Brand", "Salt Road Brand", "Highland Brand", "Canyon Brand", "Perimeter Brand"],
    }));
    expect(q.main).toContain("Grand Roundup");
  });

  it("celebrates once the Roundup is done", () => {
    const q = questFor(world({
      flags: { "met-axle": true, "grand-roundup": true },
      badges: ["Grassland Brand", "Salt Road Brand", "Highland Brand", "Canyon Brand", "Perimeter Brand"],
    }));
    expect(q.main).toContain("Record Barn");
  });
});
