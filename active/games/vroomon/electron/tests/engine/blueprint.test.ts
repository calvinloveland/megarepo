import { describe, expect, it } from "vitest";
import { decodeDnaV2 } from "../../src/shared/dna-v2.js";
import { describeVehicle } from "../../src/shared/blueprint.js";

describe("vehicle blueprint", () => {
  it("names the two paths", () => {
    const decoded = decodeDnaV2("fq4j7dJgZAic");
    const blueprint = describeVehicle(decoded);
    expect(blueprint.structure).toMatch(/plates? · .*wheels?/);
    expect(blueprint.power).toMatch(/engines? · .*shafts? · .*gears?/);
    // The two paths are the same length, one entry per chain module.
    expect(blueprint.plates + blueprint.wheels).toBe(decoded.modules.length);
  });

  it("reports how much drive each wheel actually gets", () => {
    const blueprint = describeVehicle(decodeDnaV2("fq4j7dJgZAic"));
    expect(blueprint.driven.length).toBeGreaterThan(0);
    expect(blueprint.driven[0]!.power).toBeGreaterThan(1);
    expect(blueprint.deadWheels).toBe(blueprint.wheels - blueprint.driven.length);
    expect(blueprint.verdict.length).toBeGreaterThan(0);
  });

  it("explains the failure modes in words", () => {
    const shapes = ["aaaaaaaaaaaa", "000000000000", "Zz9K2m7P4zQ", "3F3AIOPcZFN"];
    for (const dna of shapes) {
      const blueprint = describeVehicle(decodeDnaV2(dna));
      expect(Number.isFinite(blueprint.plates)).toBe(true);
      expect(blueprint.verdict).not.toBe("");
      expect(blueprint.deadWheels).toBeGreaterThanOrEqual(0);
    }
  });

  it("spots a body with no wheels", () => {
    // find an all-plate DNA by search
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let found = "";
    for (let i = 0; i < 3000 && !found; i += 1) {
      const dna = Array.from({ length: 4 }, () => "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[Math.floor(rand() * 62)]).join("");
      if (!decodeDnaV2(dna).modules.includes("W")) found = dna;
    }
    expect(found).not.toBe("");
    expect(describeVehicle(decodeDnaV2(found)).verdict).toContain("can't roll");
  });
});
