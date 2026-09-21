import { describe, expect, it } from "vitest";
import { portraitSvgFor } from "../../src/renderer/portraits.js";

describe("dialogue portraits", () => {
  it("renders known hosts with distinct busts", () => {
    const axle = portraitSvgFor("professor-axle", "Professor Axle");
    expect(axle).toContain("<svg");
    expect(axle).toContain("aria-label=\"Portrait of Professor Axle\"");
    const king = portraitSvgFor("roundup-king", "The Roundup King");
    expect(king).not.toBe(axle);
  });

  it("falls back to a generic rancher for unknown NPCs", () => {
    const unknown = portraitSvgFor("some-random-host", "Someone");
    expect(unknown).toContain("<svg");
    expect(portraitSvgFor("another", "X")).toBe(unknown); // cached generic
  });

  it("gives the narrator a quill bust", () => {
    expect(portraitSvgFor(null, "Narrator")).toContain("✎");
  });
});
