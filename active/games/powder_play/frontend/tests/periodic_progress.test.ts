import { describe, expect, it } from "vitest";
import {
  buildPeriodicCells,
  getHeaviestDiscoveredAtomic,
} from "../src/ui/periodic_progress";

describe("periodic progression view", () => {
  it("shows only elements up to the heaviest discovered atomic number", () => {
    const discovered = new Set<number>([26]);
    const cells = buildPeriodicCells(discovered);

    expect(getHeaviestDiscoveredAtomic(discovered)).toBe(26);
    expect(cells.length).toBe(26);
    expect(cells.some((cell) => cell.atomicNumber > 26)).toBe(false);
  });

  it("reveals discovered elements and hides lighter undiscovered ones as question marks", () => {
    const discovered = new Set<number>([8, 26]);
    const cells = buildPeriodicCells(discovered);
    const oxygen = cells.find((cell) => cell.atomicNumber === 8);
    const hydrogen = cells.find((cell) => cell.atomicNumber === 1);
    const iron = cells.find((cell) => cell.atomicNumber === 26);

    expect(oxygen?.state).toBe("discovered");
    expect(iron?.state).toBe("discovered");
    expect(hydrogen?.state).toBe("unknown");
  });
});
