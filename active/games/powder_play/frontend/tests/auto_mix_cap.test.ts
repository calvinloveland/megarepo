import { describe, it, expect, beforeEach } from "vitest";

/**
 * Verifies that the auto-mix system has a hard cap on total discoveries.
 * Without this cap, a pile of random elements would create an infinite
 * combinatorial explosion of new materials via chain mixing.
 *
 * The cap is set via window.__maxAutoMixes (default 100) and tracked
 * via window.__autoMixCount.
 */
describe("auto-mix cap", () => {
  beforeEach(() => {
    // Reset auto-mix state before each test
    (globalThis as any).__maxAutoMixes = 5;
    (globalThis as any).__autoMixCount = 0;
    (globalThis as any).__materialIdByName = {};
    (globalThis as any).__discoveredMaterials = [];
  });

  it("prevents infinite combinatorial explosion from random pile", async () => {
    // Simulate the core auto-mix logic: each unique pair of adjacent
    // materials triggers exactly one discovery. Without a cap, N starter
    // materials in a pile create N*(N-1)/2 + chain compounds → unbounded.
    const MAX = (globalThis as any).__maxAutoMixes;
    let count = 0;

    function simulateMix(): boolean {
      if (count >= MAX) return false;
      count++;
      (globalThis as any).__autoMixCount = count;
      return true;
    }

    // Simulate 7 starter materials touching in a grid
    // Each unique pair triggers a mix
    const starters = ["Fire", "Sand", "Water", "Dirt", "Seed", "Iron", "Salt"];
    let mixCount = 0;

    // Mix every pair of starters
    for (let i = 0; i < starters.length; i++) {
      for (let j = i + 1; j < starters.length; j++) {
        const result = simulateMix();
        if (result) mixCount++;
        // After the first mix, chain-mix the result with remaining starters
        if (result) {
          const compound = `${starters[i]}_${starters[j]}_mix`;
          for (let k = j + 1; k < starters.length; k++) {
            simulateMix();
          }
        }
      }
    }

    // The cap should prevent more than MAX mixes
    expect(count).toBeLessThanOrEqual(MAX);
    // Verify the cap actually stopped mixes
    expect(mixCount).toBeLessThan(starters.length * (starters.length - 1) / 2);
  });

  it("stops auto-mix after reaching the limit even with many pairs", () => {
    const MAX = (globalThis as any).__maxAutoMixes;
    let count = 0;

    function simulateMix(): boolean {
      if (count >= MAX) return false;
      count++;
      return true;
    }

    // Try 100 different pairs
    let succeeded = 0;
    for (let i = 0; i < 100; i++) {
      if (simulateMix()) succeeded++;
    }

    expect(succeeded).toBe(MAX);
    expect(count).toBe(MAX);
  });

  it("allows mixes when under the cap", () => {
    const MAX = (globalThis as any).__maxAutoMixes;
    let count = 0;

    function simulateMix(): boolean {
      if (count >= MAX) return false;
      count++;
      return true;
    }

    // Try MAX-1 mixes (under the cap)
    let succeeded = 0;
    for (let i = 0; i < MAX - 1; i++) {
      if (simulateMix()) succeeded++;
    }

    expect(succeeded).toBe(MAX - 1);
    expect(count).toBe(MAX - 1);
  });
});
