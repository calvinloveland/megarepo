import { describe, expect, it } from "vitest";
import { bestRecord, proposeRecord } from "../../src/renderer/records.js";
import { EMPTY_RECORDS_BOARD } from "../../src/shared/parity-contract.js";

describe("test-drive records board", () => {
  it("starts empty", () => {
    expect(bestRecord(EMPTY_RECORDS_BOARD, "Grassland")).toBeNull();
  });

  it("records a first lap per terrain", () => {
    const { board, improved } = proposeRecord(
      EMPTY_RECORDS_BOARD,
      "Grassland",
      "AAA",
      1200,
      "2026-01-01T00:00:00.000Z",
    );
    expect(improved).toBe(true);
    expect(bestRecord(board, "Grassland")?.score).toBe(1200);
    expect(board.entries).toHaveLength(1);
  });

  it("keeps the best lap per terrain and updates on improvement", () => {
    const first = proposeRecord(EMPTY_RECORDS_BOARD, "Flat", "AAA", 900, "t1").board;
    const noop = proposeRecord(first, "Flat", "BBB", 800, "t2");
    expect(noop.improved).toBe(false);
    expect(bestRecord(noop.board, "Flat")?.dna).toBe("AAA");

    const better = proposeRecord(noop.board, "Flat", "CCC", 1400, "t3");
    expect(better.improved).toBe(true);
    expect(bestRecord(better.board, "Flat")).toMatchObject({ dna: "CCC", score: 1400 });
    expect(better.board.entries).toHaveLength(1);
  });

  it("sorts multiple terrains by score", () => {
    const a = proposeRecord(EMPTY_RECORDS_BOARD, "Hills", "H1", 800, "t1").board;
    const b = proposeRecord(a, "Flat", "F1", 1500, "t2").board;
    expect(b.entries.map((entry) => entry.terrainName)).toEqual(["Flat", "Hills"]);
  });
});
