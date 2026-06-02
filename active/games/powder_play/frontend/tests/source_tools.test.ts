import { describe, expect, it } from "vitest";
import { buildSourceToolMaterial, sourceToolName } from "../src/ui/source_tools";

describe("source tool materials", () => {
  it("builds a visible source block configured to emit the selected material", () => {
    const source = buildSourceToolMaterial({
      name: "Sand",
      color: [200, 180, 120],
      tags: ["solid"],
    });

    expect(sourceToolName("Sand")).toBe("Sand Source");
    expect(source).toMatchObject({
      type: "material",
      name: "Sand Source",
      tags: ["source"],
      emits: "Sand",
      density: 10,
    });
  });

  it("does not create source blocks for source/drain materials", () => {
    expect(buildSourceToolMaterial({ name: "Drain", tags: ["drain"] })).toBeNull();
    expect(buildSourceToolMaterial({ name: "Source", tags: ["source"] })).toBeNull();
  });
});
