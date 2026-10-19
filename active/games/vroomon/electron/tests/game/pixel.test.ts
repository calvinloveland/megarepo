import { describe, expect, it } from "vitest";
import {
  ART_COLUMNS,
  artPixel,
  drawArtOutline,
  drawArtRows,
  hashUnit,
  mixHex,
  type PixelCanvas,
} from "../../src/renderer/world/pixel.js";

// A recording stand-in for a 2d context: every fill is captured as a rectangle
// and its colour, which is all the pixel helpers ever do.
interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function recorder(): { ctx: PixelCanvas; fills: Fill[] } {
  const fills: Fill[] = [];
  const ctx: PixelCanvas = {
    fillStyle: "#000000",
    fillRect(x, y, w, h) {
      fills.push({ x, y, w, h, color: String(ctx.fillStyle) });
    },
  };
  return { ctx, fills };
}

describe("pixel art primitives", () => {
  it("puts an art pixel on a whole screen pixel", () => {
    // 32px tiles are the design size and 96px is the export size: both divide
    // by the 16-cell grid, which is what keeps a scaled sprite crisp.
    expect(artPixel(32)).toBe(2);
    expect(artPixel(96)).toBe(6);
    expect(artPixel(48)).toBe(3);
    expect(ART_COLUMNS).toBe(16);
  });

  it("hashes a tile coordinate to the same value every time", () => {
    expect(hashUnit(3, 7)).toBe(hashUnit(3, 7));
    expect(hashUnit(3, 7, 5)).toBe(hashUnit(3, 7, 5));
    // Different cells and different salts give different noise, or every tile
    // in a field would be decorated identically.
    const values = new Set<string>();
    for (let x = 0; x < 8; x += 1) {
      for (let y = 0; y < 8; y += 1) {
        const value = hashUnit(x, y);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        values.add(value.toFixed(6));
      }
    }
    expect(values.size).toBe(64);
  });

  it("draws one rectangle per coloured cell and skips blanks", () => {
    const { ctx, fills } = recorder();
    drawArtRows(ctx, ["A.A", "AAA"], { A: "#ff0000" }, 10, 20, 2);
    expect(fills).toHaveLength(5);
    expect(fills[0]).toMatchObject({ x: 10, y: 20, w: 2, h: 2, color: "#ff0000" });
    expect(fills[1]).toMatchObject({ x: 14, y: 20 });
    expect(fills[2]).toMatchObject({ x: 10, y: 22 });
  });

  it("leaves a cell transparent when the palette has no colour for it", () => {
    // A typo in an art row should leave a hole, not throw in the middle of a
    // frame — a missing colour must never take the overworld down.
    const { ctx, fills } = recorder();
    drawArtRows(ctx, ["AZ"], { A: "#111111" }, 0, 0, 1);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.color).toBe("#111111");
  });

  it("outlines the silhouette without rounding its corners off", () => {
    const { ctx, fills } = recorder();
    drawArtOutline(ctx, ["..", ".A"], "#000000", 0, 0, 1);
    // The one filled cell is bottom-right; its two orthogonal neighbours and
    // the grid's edge cells get the keyline — but the diagonal (0,0) does not,
    // which is what keeps a sprite angular instead of bubbly.
    expect(fills).toEqual([
      { x: 1, y: 0, w: 1, h: 1, color: "#000000" },
      { x: 0, y: 1, w: 1, h: 1, color: "#000000" },
    ]);
  });

  it("mixes two colours into a ramp tone", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
