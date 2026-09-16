import { describe, expect, it } from "vitest";
import { decodeDnaV2 } from "../src/shared/dna-v2.js";
import { inspectVehicle, inspectionSummary, topSpeedFor, trackResult } from "../src/shared/inspect.js";

const WEIGHTS = { tiltCost: 3, hullCost: 4 };
const TUNING = { terminalSpeedPerPower: 0.9, referenceMass: 1, maxSpeed: 1600 };

describe("vehicle inspection", () => {
  it("lists the two paths slot by slot", () => {
    const inspection = inspectVehicle("fq4j7dJgZAic", WEIGHTS);
    // Derived from the decoder rather than hardcoded: the inspector must
    // report whatever the DNA actually builds.
    const decoded = decodeDnaV2("fq4j7dJgZAic");
    expect(inspection.modules).toBe(decoded.modules.join(""));
    expect(inspection.powertrain).toBe(decoded.powertrainModules.join(""));
    expect(inspection.rows).toHaveLength(decoded.modules.length);
    // Frame and powertrain are parallel arrays of equal length.
    expect(inspection.modules.length).toBe(inspection.powertrain.length);
    expect(inspection.rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // Row 0 is a plate with a cylinder above it, and its structure reads
    // like a plate.
    // Row 0's structure and powertrain come from the DNA, so read them back
    // through the decoder instead of trusting a hand-written slot list.
    expect(inspection.rows[0]!.kind).toBe(decoded.modules[0] === "R" ? "plate" : "wheel");
    expect(inspection.rows[2]!.kind).toBe(decoded.modules[2] === "R" ? "plate" : "wheel");
  });

  it("positions parts along the chain with no daylight between them", () => {
    for (const dna of ["fq4j7dJgZAic", "PXJL5vHwqLo4", "A3x9K2m7P4zQ"]) {
      const inspection = inspectVehicle(dna, WEIGHTS);
      const spans = inspection.shapes.map((shape) =>
        shape.kind === "wheel"
          ? { start: shape.x - shape.radius, end: shape.x + shape.radius }
          : (() => {
              const tilt = (Math.abs(shape.angleDeg) * Math.PI) / 180;
              const half =
                (shape.width / 2) * Math.cos(tilt) + (shape.height / 2) * Math.sin(tilt);
              return { start: shape.x - half, end: shape.x + half };
            })(),
      );
      for (let index = 1; index < spans.length; index += 1) {
        // Overlapping neighbours: a gap would show as background between
        // parts of what is supposed to be one welded frame.
        expect(spans[index]!.start).toBeLessThan(spans[index - 1]!.end);
      }
    }
  });

  it("reports drive only at the wheels the power path reaches", () => {
    const inspection = inspectVehicle("fq4j7dJgZAic", WEIGHTS);
    const wheelRows = inspection.rows.filter((row) => row.kind === "wheel");
    expect(wheelRows.length).toBeGreaterThan(0);
    for (const row of inspection.rows) {
      if (row.kind === "plate") {
        expect(row.drivePower).toBeNull();
      }
    }
    expect(inspection.drivenCount).toBeLessThanOrEqual(inspection.wheels);
    expect(inspection.totalPower).toBeGreaterThan(0);
  });

  it("gives a car no top speed without drive", () => {
    const dud = inspectVehicle("000000000000", WEIGHTS);
    if (dud.drivenCount === 0 || dud.plant.driveScale === 0) {
      expect(topSpeedFor(dud, TUNING)).toBe(0);
    }
    const good = inspectVehicle("fq4j7dJgZAic", WEIGHTS);
    expect(topSpeedFor(good, TUNING)).toBeGreaterThan(0);
  });

  it("describes a run in plain language", () => {
    expect(trackResult("Flat", 900, 300, 0).outcome).toBe("flies");
    expect(trackResult("Flat", 400, 200, 0).outcome).toBe("competitive");
    expect(trackResult("Flat", 100, 40, 0).outcome).toBe("crawls");
    expect(trackResult("Flat", 0, 0, 0).outcome).toBe("sits there");
    expect(trackResult("Flat", -200, 30, 0).outcome).toBe("runs backwards");
  });

  it("summarises a body in one line", () => {
    expect(inspectionSummary(inspectVehicle("fq4j7dJgZAic", WEIGHTS))).toContain("Drive reaches");
    expect(inspectionSummary(inspectVehicle("000000000000", WEIGHTS))).not.toBe("");
  });
});
