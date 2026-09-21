import { describe, expect, it } from "vitest";
import {
  autoRunVerdict,
  improvementRatio,
  isOutlier,
} from "../../src/renderer/evolution-lab.js";

describe("evolution lab decisions", () => {
  it("treats the first real result as an outlier", () => {
    expect(isOutlier(0, 900)).toBe(true);
    expect(isOutlier(Number.NaN, 900)).toBe(true);
    expect(isOutlier(900, 0)).toBe(false);
  });

  it("only celebrates jumps past the threshold", () => {
    expect(isOutlier(1000, 1010)).toBe(false); // +1%
    expect(isOutlier(1000, 1020)).toBe(true); // +2%
    expect(isOutlier(1000, 1600)).toBe(true); // a real find
    expect(isOutlier(1000, 900)).toBe(false); // regression
  });

  it("honours a custom threshold", () => {
    expect(isOutlier(1000, 1005, 0.005)).toBe(true);
    expect(isOutlier(1000, 1005, 0.05)).toBe(false);
  });

  it("reports improvement as a fraction", () => {
    expect(improvementRatio(1000, 1070)).toBeCloseTo(0.07, 5);
    expect(improvementRatio(0, 500)).toBe(0);
  });

  it("stops an auto-run when the carrier runs dry", () => {
    expect(
      autoRunVerdict({ feed: 0, dryStreak: 0, plateauLimit: 5, stopAtPlateau: true }),
    ).toBe("out-of-feed");
  });

  it("stops at a plateau only when asked", () => {
    const base = { feed: 4, dryStreak: 9, plateauLimit: 5 };
    expect(autoRunVerdict({ ...base, stopAtPlateau: true })).toBe("plateau");
    expect(autoRunVerdict({ ...base, stopAtPlateau: false })).toBe("continue");
  });

  it("keeps running while the herd is still improving", () => {
    expect(
      autoRunVerdict({ feed: 3, dryStreak: 0, plateauLimit: 5, stopAtPlateau: true }),
    ).toBe("continue");
  });
});
