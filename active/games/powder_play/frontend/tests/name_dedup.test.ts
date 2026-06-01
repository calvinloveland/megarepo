import { describe, it, expect } from "vitest";

/**
 * Tests for the name dedup logic used in mix generation.
 * The game retries with a hint when the LLM generates a name
 * that already exists (case-insensitive).
 */
describe("name dedup logic", () => {
  function materialNameExists(name: string, existingNames: string[]): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return existingNames.some((n) => n.toLowerCase() === lower);
  }

  it("detects exact duplicate", () => {
    const existing = ["Mud", "Glass", "Steam"];
    expect(materialNameExists("Mud", existing)).toBe(true);
    expect(materialNameExists("Glass", existing)).toBe(true);
  });

  it("detects case-insensitive duplicate", () => {
    const existing = ["Mud", "Glass", "Steam"];
    expect(materialNameExists("mud", existing)).toBe(true);
    expect(materialNameExists("MUD", existing)).toBe(true);
    expect(materialNameExists("glass", existing)).toBe(true);
    expect(materialNameExists("STEAM", existing)).toBe(true);
  });

  it("allows unique names", () => {
    const existing = ["Mud", "Glass", "Steam"];
    expect(materialNameExists("Clay", existing)).toBe(false);
    expect(materialNameExists("Rust", existing)).toBe(false);
    expect(materialNameExists("Brine", existing)).toBe(false);
  });

  it("detects starter material collision", () => {
    // "Salt" is a starter — can't discover another "Salt"
    const existing = ["Salt", "Fire", "Water"];
    expect(materialNameExists("Salt", existing)).toBe(true);
    // A retry would need to suggest something different
  });

  it("rejects empty name", () => {
    const existing = ["Mud", "Glass"];
    expect(materialNameExists("", existing)).toBe(false);
  });
});
