import { describe, it, expect } from "vitest";
import { validateMaterial } from "../../material_gen/validator";

describe("material validator", () => {
  it("rejects materials without tags", async () => {
    const ast = {
      type: "material",
      name: "bad",
      density: 1,
      color: [1, 2, 3],
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(false);
    expect(res.errors).toBeDefined();
  });

  it("accepts a tag-based material", async () => {
    const ast = {
      type: "material",
      name: "mist",
      tags: ["float"],
      density: 0.4,
      color: [180, 200, 220],
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(true);
  });
});
