import { describe, expect, it } from "vitest";
import {
  ACCESSORY_KEYS,
  ACCESSORY_ROWS,
  ART_COLUMNS,
  BODY_DOWN,
  BODY_LEFT,
  BODY_UP,
  FIGURE_KEYS,
  HEAD_KEYS,
  HEAD_ROWS,
  OUTFIT_KEYS,
  OUTFIT_ROWS,
  PERSON_ROWS,
} from "../../src/renderer/world/sprite-art.js";

// The people are hand-authored art tables. Nothing about a typo in one of
// them is visible in a unit test — but a row that is a cell short, or a cell
// that names a colour the drawing code does not know, leaves a hole in a face,
// and a hole in a face is very hard to find by eye in a 32px sprite.

const BLANK = ". ";

function widths(rows: readonly string[]): number[] {
  return rows.map((row) => row.length);
}

describe("the character art tables", () => {
  it("are all exactly one tile wide", () => {
    for (const [name, rows] of Object.entries({
      BODY_DOWN,
      BODY_UP,
      BODY_LEFT,
      HEAD_ROWS,
      OUTFIT_ROWS,
      ...ACCESSORY_ROWS,
    })) {
      expect(new Set(widths(rows)), `${name} row widths`).toEqual(new Set([ART_COLUMNS]));
    }
  });

  it("are no taller than one person", () => {
    // Full figures are exactly one grid tall; the component layers are bands
    // of that grid, so they are shorter on purpose.
    for (const rows of [BODY_DOWN, BODY_UP, BODY_LEFT]) {
      expect(rows.length).toBe(PERSON_ROWS);
    }
    for (const [name, rows] of Object.entries({ HEAD_ROWS, OUTFIT_ROWS, ...ACCESSORY_ROWS })) {
      expect(rows.length, `${name} height`).toBeLessThanOrEqual(PERSON_ROWS);
    }
  });

  it("only use palette keys the drawing code knows", () => {
    const check = (name: string, rows: readonly string[], allowed: string): void => {
      const used = new Set<string>();
      for (const row of rows) {
        for (const cell of row) {
          if (!BLANK.includes(cell)) {
            used.add(cell);
          }
        }
      }
      for (const cell of used) {
        expect(allowed.includes(cell), `${name} uses unknown key "${cell}"`).toBe(true);
      }
    };
    check("BODY_DOWN", BODY_DOWN, FIGURE_KEYS);
    check("BODY_UP", BODY_UP, FIGURE_KEYS);
    check("BODY_LEFT", BODY_LEFT, FIGURE_KEYS);
    check("HEAD", HEAD_ROWS, HEAD_KEYS);
    check("OUTFIT", OUTFIT_ROWS, OUTFIT_KEYS);
    for (const [id, rows] of Object.entries(ACCESSORY_ROWS)) {
      check(id, rows, ACCESSORY_KEYS[id] ?? "");
    }
  });

  it("keeps every layer inside its band", () => {
    // Head, outfit and accessory each own a band of rows so any combination
    // composes to the same figure; an accessory that drifts into the torso
    // band would draw a hat across a belt.
    const firstFilled = (rows: readonly string[]): number =>
      rows.findIndex((row) => [...row].some((cell) => !BLANK.includes(cell)));
    const lastFilled = (rows: readonly string[]): number => {
      for (let y = rows.length - 1; y >= 0; y -= 1) {
        if ([...rows[y]!].some((cell) => !BLANK.includes(cell))) {
          return y;
        }
      }
      return -1;
    };
    const headStart = firstFilled(HEAD_ROWS);
    const headEnd = lastFilled(HEAD_ROWS);
    const outfitStart = firstFilled(OUTFIT_ROWS);
    expect(headStart).toBeGreaterThanOrEqual(0);
    expect(headEnd).toBeLessThan(outfitStart);
    // Below the collar an accessory may only be something held at the body's
    // edge (the wrench, the sign board). Decoration across the chest is what a
    // component seam looks like, and it is never what was meant.
    for (const [id, rows] of Object.entries(ACCESSORY_ROWS)) {
      rows.forEach((row, y) => {
        if (y < outfitStart) {
          return;
        }
        [...row].forEach((cell, x) => {
          if (!BLANK.includes(cell)) {
            expect(x, `${id} paints across the chest at row ${y}`).toBeGreaterThanOrEqual(10);
          }
        });
      });
    }
  });

  it("faces the way it says it faces", () => {
    // The down view shows two eyes; the up view shows none (the back of a
    // head); the profile shows one. That is the whole readability trick of a
    // top-down sprite and it is worth asserting.
    const count = (rows: readonly string[], cell: string): number =>
      rows.join("").split("").filter((candidate) => candidate === cell).length;
    expect(count(BODY_DOWN, "E")).toBe(2);
    expect(count(BODY_UP, "E")).toBe(0);
    expect(count(BODY_LEFT, "E")).toBe(2);
    // Same figure height in every direction.
    expect(BODY_DOWN.length).toBe(BODY_UP.length);
    expect(BODY_DOWN.length).toBe(BODY_LEFT.length);
  });
});
