import { describe, expect, it } from "vitest";
import {
  decodeDnaV2,
  wheelDriveForIndex,
  type DecodedDnaV2,
  type PowertrainParams,
} from "../../src/shared/dna-v2.js";

const params = (over: Partial<PowertrainParams> = {}): PowertrainParams => ({
  gearRatio: 1,
  efficiency: 0.9,
  power: 100,
  wheelProportion: 0.5,
  outputRatio: 1,
  ...over,
});

const rig = (
  kinds: Array<"C" | "D" | "G">,
  overrides: PowertrainParams[] = [],
): DecodedDnaV2 =>
  ({
    dna: "test",
    modules: kinds.map(() => "W"),
    powertrainModules: kinds,
    positions: kinds.map((_, index) => 50 + index * 40),
    rectParams: kinds.map(() => null),
    wheelParams: kinds.map(() => ({ radius: 18, friction: 1, motorPower: 0 })),
    powertrainParams: kinds.map((_, index) => params(overrides[index])),
    connectors: [],
    globals: {
      comShift: 0,
      dampingLinear: 0.1,
      dampingAngular: 0.1,
      temperature: 0,
    },
  }) as DecodedDnaV2;

describe("the power path", () => {
  it("gives nothing to a wheel with no cylinder upstream", () => {
    // wheel, wheel, wheel — no structure and no engine: it goes nowhere.
    expect(wheelDriveForIndex(rig(["D", "D", "D"]), 0).power).toBe(0);
    expect(wheelDriveForIndex(rig(["D", "D", "D"]), 2).power).toBe(0);
  });

  it("drives a wheel that follows a cylinder", () => {
    // engine then wheel: simple, and it works.
    expect(wheelDriveForIndex(rig(["C", "D"]), 1).power).toBeCloseTo(100 * 0.9, 5);
  });

  it("does not drive a wheel that comes before the engine", () => {
    // the order matters: an engine later in the chain powers nothing behind it
    expect(wheelDriveForIndex(rig(["D", "C"]), 0).power).toBe(0);
    // but it powers the part after it
    expect(wheelDriveForIndex(rig(["D", "C"]), 1).power).toBeCloseTo(100, 5);
  });

  it("loses power through every drive shaft", () => {
    const lossy = wheelDriveForIndex(rig(["C", "D", "D"]), 2).power;
    expect(lossy).toBeCloseTo(100 * 0.9 * 0.9, 5);
    expect(lossy).toBeLessThan(100);
  });

  it("hands a gear set's share to its own wheel and passes the rest on", () => {
    // engine, then a gear set in the wheel's slot: half goes to that wheel,
    // the remainder carries down the shaft scaled by the output ratio.
    expect(wheelDriveForIndex(rig(["C", "G"]), 1).power).toBeCloseTo(50, 5);
    expect(wheelDriveForIndex(rig(["C", "G", "D"]), 2).power).toBeCloseTo(
      50 * 0.9,
      5,
    );
  });

  it("splits nothing when the gear set sits before the engine", () => {
    // A gear set with no cylinder upstream has no power to share: the whole
    // rig is inert.
    expect(wheelDriveForIndex(rig(["G", "C"]), 0).power).toBeCloseTo(0, 5);
  });

  it("keeps every real decoded car's drive finite and non-negative", () => {
    for (const dna of ["A3x9K2m7P4zQ", "aaaaaaaaaaaa", "3F3AIOPcZFN", "Zz9"]) {
      const decoded = decodeDnaV2(dna);
      decoded.modules.forEach((module, index) => {
        const drive = wheelDriveForIndex(decoded, index);
        expect(Number.isFinite(drive.power)).toBe(true);
        expect(drive.power).toBeGreaterThanOrEqual(0);
        if (module === "W") {
          expect(Number.isFinite(drive.torque)).toBe(true);
        }
      });
    }
  });
});
