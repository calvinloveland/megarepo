import { describe, expect, it } from "vitest";
import { buildLedger, titlesToDefend, untriedGrounds } from "../src/renderer/ledger.js";
import { feudBar, VENUE_BADGE, VENUE_ORDER } from "../src/renderer/circuit.js";

const entry = (terrainName: string, score: number, dna: string) => ({
  terrainName,
  dna,
  score,
  savedAt: "2026-09-15T12:00:00.000Z",
});

describe("the ledger", () => {
  it("has a row per circuit, in campaign order", () => {
    const rows = buildLedger({ records: [], feudTiers: {}, hallScores: [] });
    expect(rows.map((row) => row.venueMapId)).toEqual([...VENUE_ORDER]);
    for (const row of rows) {
      // Nothing run yet: the bar is still stated, so the goal is legible.
      expect(row.status).toBe("untried");
      expect(row.bar).toBe(feudBar(row.terrain, 1));
      expect(row.margin).toBe(-row.bar);
    }
  });

  it("compares your best against the bar you would face", () => {
    const rows = buildLedger({
      records: [entry("Grassland", 1200, "CHAMP"), entry("Sand", 400, "DUD")],
      feudTiers: { "Grassland Brand": 3, "Salt Road Brand": 2 },
      hallScores: [],
    });
    const grass = rows.find((row) => row.terrain === "Grassland")!;
    expect(grass.tier).toBe(3);
    expect(grass.bar).toBe(feudBar("Grassland", 3));
    expect(grass.best).toBe(1200);
    expect(grass.dna).toBe("CHAMP");
    expect(grass.margin).toBe(1200 - grass.bar);
    expect(grass.status).toBe(1200 >= grass.bar ? "clears" : "short");

    const sand = rows.find((row) => row.terrain === "Sand")!;
    expect(sand.best).toBe(400);
    expect(sand.status).toBe("short");
    expect(sand.margin).toBeLessThan(0);
  });

  it("counts a hall champion as a car you can still send, and names it", () => {
    const rows = buildLedger({
      records: [entry("Hills", 500, "LAPCAR")],
      feudTiers: {},
      hallScores: [{ terrainName: "Hills", score: 2000, dna: "HALLCHAMP" }],
    });
    const hills = rows.find((row) => row.terrain === "Hills")!;
    expect(hills.best).toBe(2000);
    expect(hills.status).toBe("clears");
    // An anonymous number is less use than a name you can look up.
    expect(hills.dna).toBe("HALLCHAMP");

    // With no DNA on the hall entry, the lap board's car is named instead.
    const anonymous = buildLedger({
      records: [entry("Hills", 500, "LAPCAR")],
      feudTiers: {},
      hallScores: [{ terrainName: "Hills", score: 2000 }],
    }).find((row) => row.terrain === "Hills")!;
    expect(anonymous.best).toBe(2000);
    expect(anonymous.dna).toBe("LAPCAR");
  });

  it("names the titles to defend and the ground never run", () => {
    const rows = buildLedger({
      records: [entry("Grassland", 100, "SLOW"), entry("Ice", 9000, "FLIER")],
      feudTiers: { "Grassland Brand": 5 },
      hallScores: [],
    });
    const short = titlesToDefend(rows).map((row) => row.terrain);
    expect(short).toContain("Grassland");
    expect(short).not.toContain("Ice");
    expect(untriedGrounds(rows).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps a swept circuit's higher bar visible", () => {
    const badge = VENUE_BADGE["gym_1"]!;
    const rows = buildLedger({
      records: [entry("Grassland", 1400, "CHAMP")],
      feudTiers: { [badge]: 2 },
      hallScores: [],
    });
    const grass = rows.find((row) => row.terrain === "Grassland")!;
    expect(grass.tier).toBe(2);
    expect(grass.bar).toBe(feudBar("Grassland", 2));
  });
});
