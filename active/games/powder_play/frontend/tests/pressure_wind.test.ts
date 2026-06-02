import { describe, expect, it } from "vitest";
import {
  applyPressureWind,
  pressureGradientAt,
  simulatePressureField,
} from "../../sim/pressure_wind";

describe("pressure-driven wind", () => {
  it("keeps ambient air at stable pressure when the board starts full of air", () => {
    const width = 4;
    const height = 4;
    const air = 1;
    const grid = new Uint16Array(width * height).fill(air);
    let pressure = new Float32Array(width * height);
    const densityById = new Map<number, number>([[air, 0.05]]);
    const tagsById = new Map<number, string[]>([[air, ["gas", "ambient"]]]);

    for (let i = 0; i < 5; i++) {
      pressure = simulatePressureField({
        width,
        height,
        grid,
        pressure,
        densityById,
        tagsById,
      });
    }

    const unique = new Set(Array.from(pressure).map((p) => Number(p.toFixed(6))));
    expect(unique.size).toBe(1);
    expect(unique.has(0)).toBe(true);
  });

  it("diffuses pressure into neighboring empty cells", () => {
    const width = 3;
    const height = 1;
    const grid = new Uint16Array(width * height);
    const pressure = new Float32Array([0, 1, 0]);

    const next = simulatePressureField({
      width,
      height,
      grid,
      pressure,
      densityById: new Map(),
      tagsById: new Map(),
    });

    expect(next[0]).toBeGreaterThan(0);
    expect(next[2]).toBeGreaterThan(0);
    expect(next[1]).toBeLessThan(1);
  });

  it("computes wind from high pressure toward low pressure", () => {
    const width = 3;
    const height = 3;
    const pressure = new Float32Array([
      0, 0, 0,
      2, 1, 0,
      0, 0, 0,
    ]);

    const gradient = pressureGradientAt(pressure, width, height, 1, 1);
    expect(gradient.dx).toBeGreaterThan(0);
    expect(gradient.magnitude).toBeGreaterThan(0);
  });

  it("pushes light material along the pressure gradient", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const pressure = new Float32Array([
      0, 0, 0,
      2, 1, 0,
      0, 0, 0,
    ]);
    const reacted = new Uint8Array(width * height);
    const densityById = new Map<number, number>([[1, 0.4]]);
    const tagsById = new Map<number, string[]>([[1, ["solid"]]]);

    grid[1 + width] = 1;

    applyPressureWind({
      width,
      height,
      grid,
      nextGrid,
      pressure,
      densityById,
      tagsById,
      reacted,
    });

    expect(nextGrid[2 + width]).toBe(1);
    expect(reacted[1 + width]).toBe(1);
  });

  it("does not push dense material with the same gradient", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const pressure = new Float32Array([
      0, 0, 0,
      2, 1, 0,
      0, 0, 0,
    ]);
    const reacted = new Uint8Array(width * height);
    const densityById = new Map<number, number>([[1, 2.0]]);
    const tagsById = new Map<number, string[]>([[1, ["solid"]]]);

    grid[1 + width] = 1;

    applyPressureWind({
      width,
      height,
      grid,
      nextGrid,
      pressure,
      densityById,
      tagsById,
      reacted,
    });

    expect(nextGrid[2 + width]).toBe(0);
    expect(reacted[1 + width]).toBe(0);
  });
});
