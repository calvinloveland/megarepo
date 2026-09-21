import { describe, expect, it } from "vitest";
import {
  describeWildGround,
  wildGroundRows,
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
