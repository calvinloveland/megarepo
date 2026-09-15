import { describe, expect, it } from "vitest";
import { markTipSeen, shouldShowTip } from "../src/renderer/tips.js";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("first-visit onboarding flags", () => {
  it("shows a tip until it is marked seen", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    expect(shouldShowTip("evolution", storage)).toBe(true);
    markTipSeen("evolution", storage);
    expect(shouldShowTip("evolution", storage)).toBe(false);
    expect(shouldShowTip("test-drive", storage)).toBe(true);
  });

  it("ignores corrupted storage", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storage.setItem("vroomon:tips", "{not-an-array}");
    expect(shouldShowTip("evolution", storage)).toBe(true);
  });
});
