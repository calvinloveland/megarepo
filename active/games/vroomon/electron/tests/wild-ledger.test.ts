import { describe, expect, it } from "vitest";
import {
  describeWildGround,
  wildGroundRows,
  wildSendByTerrain,
  tierWalkHint,
  wildSendNote,
  type PackReading,
} from "../src/renderer/wild-ledger.js";

const reading = (generation: number, median: number, champion: number): PackReading => ({
  generation,
  median,
  champion,
});

describe("what the player knows about each hunting ground", () => {
  it("lists only grounds it has met, richest first", () => {
    const rows = wildGroundRows(
      { ice_map: 4, ranch_yard: 9, hills_map: 0 },
      {
        ice_map: reading(4, 640, 1622),
        ranch_yard: reading(9, 450, 1001),
      },
    );
    expect(rows.map((row) => row.mapId)).toEqual(["ice_map", "ranch_yard", "hills_map"]);
    expect(rows[0]).toMatchObject({ terrain: "Ice", median: 640, champion: 1622 });
    // A ground with a generation but no reading still lists, without numbers.
    expect(rows[2]).toMatchObject({ terrain: "Hills", median: 0, generation: 0 });
  });

  it("says what a ground is and what it would send", () => {
    const [row] = wildGroundRows({ ice_map: 12 }, { ice_map: reading(12, 640, 1622) });
    const line = describeWildGround(row!);
    expect(line).toContain("Ice — Drift Perimeter");
    expect(line).toContain("wild gen 12");
    expect(line).toContain("sends 640");
    expect(line).toContain("best 1622");
  });

  it("reads an unmet ground as unmet, not as zero", () => {
    const [row] = wildGroundRows({ hills_map: 0 }, {});
    expect(describeWildGround(row!)).toContain("unmet");
    expect(describeWildGround(row!)).not.toContain("sends 0");
  });

  it("ignores map ids that no longer exist", () => {
    const rows = wildGroundRows({ demolished: 3 }, {});
    expect(rows).toEqual([]);
  });
});

describe("the wild's numbers next to the player's own", () => {
  it("takes the best send per terrain, from the grounds actually met", () => {
    const rows = wildGroundRows(
      { ice_map: 4, long_light_depot: 2, ranch_yard: 9 },
      {
        ice_map: reading(4, 640, 1622),
        long_light_depot: reading(2, 810, 900),
        ranch_yard: reading(9, 450, 1001),
      },
    );
    const sends = wildSendByTerrain(rows);
    // Two grounds carry ice; the stronger one speaks for the terrain.
    expect(sends.Ice).toBe(810);
    expect(sends.Grassland).toBe(450);
    // A terrain nobody has hunted says nothing at all.
    expect(sends.Hills).toBeUndefined();
  });

  it("says it in one clause, or says nothing", () => {
    expect(wildSendNote("Ice", { Ice: 810 })).toBe(" · wild sends 810");
    expect(wildSendNote("Hills", { Ice: 810 })).toBe("");
    expect(wildSendNote("Ice", { Ice: 0 })).toBe("");
  });
});

describe("which ground is worth a walk", () => {
  const rows = wildGroundRows(
    { ice_map: 12, long_light_depot: 4, ranch_yard: 9 },
    {
      ice_map: reading(12, 1622, 2000),
      long_light_depot: reading(4, 640, 900),
      ranch_yard: reading(9, 450, 1001),
    },
  );

  it("names the ground that clears the bar in front of you", () => {
    const hint = tierWalkHint(rows, { terrain: "Ice", tier: 2, bar: 1220 });
    expect(hint.best?.mapId).toBe("ice_map");
    expect(hint.text).toContain("Drift Perimeter sends 1622");
    expect(hint.text).toContain("clears Ice II (1220)");
    expect(hint.text).toContain("Worth the walk");
  });

  it("says when nothing met is enough, and what the best is", () => {
    const hint = tierWalkHint(rows, { terrain: "Ice", tier: 5, bar: 2400 });
    expect(hint.text).toContain("Nothing met sends 2400");
    expect(hint.text).toContain("Drift Perimeter at 1622");
  });

  it("says when no pack on that ground has been met at all", () => {
    const hint = tierWalkHint(rows, { terrain: "Hills", tier: 1, bar: 1150 });
    expect(hint.best).toBeNull();
    expect(hint.text).toContain("No pack met on Hills yet");
  });

  it("takes the strongest ground when two carry the same terrain", () => {
    // Both ice grounds are met; the stronger one speaks for the terrain.
    const hint = tierWalkHint(rows, { terrain: "Ice", tier: 1, bar: 1000 });
    expect(hint.best?.mapId).toBe("ice_map");
  });
});
