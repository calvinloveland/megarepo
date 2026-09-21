import { describe, expect, it } from "vitest";
import { fittedCanvasSize } from "../src/renderer/ui/canvas-host.js";

describe("fitting a canvas to its box", () => {
  it("uses the box's width and the designed aspect", () => {
    // The Heritage tree was authored at 1200x620 (1.935:1).
    const fit = fittedCanvasSize({ displayWidth: 948, aspect: 1200 / 620 });
    expect(fit).toEqual({ width: 948, height: 490 });
  });

  it("honours the stylesheet's height clamp, so CSS cannot squash it", () => {
    // 62vh of a 768px window is 476px, and the natural height is 490.
    const fit = fittedCanvasSize({
      displayWidth: 948,
      displayHeight: 476,
      aspect: 1200 / 620,
    });
    expect(fit).toEqual({ width: 948, height: 476 });
  });

  it("keeps a floor and a ceiling", () => {
    expect(fittedCanvasSize({ displayWidth: 200, aspect: 2 })!.width).toBe(320);
    expect(fittedCanvasSize({ displayWidth: 5000, aspect: 2 })!.width).toBe(1600);
    // A caller can move them: the floor raises a small box, and never lowers
    // a large one.
    expect(fittedCanvasSize({ displayWidth: 50, aspect: 2, min: 100 })!.width).toBe(100);
    expect(fittedCanvasSize({ displayWidth: 900, aspect: 2, min: 100 })!.width).toBe(900);
  });

  it("says nothing when there is no box to fit", () => {
    expect(fittedCanvasSize({ displayWidth: 0, aspect: 2 })).toBeNull();
    expect(fittedCanvasSize({ displayWidth: Number.NaN, aspect: 2 })).toBeNull();
    expect(fittedCanvasSize({ displayWidth: 500, aspect: 0 })).toBeNull();
  });

  it("never returns a zero height", () => {
    const fit = fittedCanvasSize({ displayWidth: 500, aspect: 100, displayHeight: 1 });
    expect(fit!.height).toBeGreaterThanOrEqual(1);
  });
});
