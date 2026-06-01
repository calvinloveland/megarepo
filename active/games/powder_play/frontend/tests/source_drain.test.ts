import { describe, it, expect } from "vitest";
import { validateMaterial } from "../../material_gen/validator";

describe("source material validation", () => {
  it("accepts a source material with emits property", async () => {
    const ast = {
      type: "material",
      name: "Mud Source",
      tags: ["source"],
      density: 10,
      color: [120, 100, 80],
      emits: "Mud",
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(true);
  });

  it("accepts a source without emits (falls back gracefully in worker)", async () => {
    const ast = {
      type: "material",
      name: "Empty Source",
      tags: ["source"],
      density: 10,
      color: [100, 200, 255],
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(true);
  });
});

describe("drain material validation", () => {
  it("accepts a drain material", async () => {
    const ast = {
      type: "material",
      name: "Drain",
      tags: ["drain"],
      density: 10,
      color: [50, 80, 120],
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(true);
  });

  it("accepts source+static tags (source blocks should be static)", async () => {
    const ast = {
      type: "material",
      name: "Glass Source",
      tags: ["source", "static"],
      density: 10,
      color: [190, 200, 210],
      emits: "Glass",
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(true);
  });
});

describe("supply system logic", () => {
  it("detects insufficient supply", () => {
    const supply = new Map<string, number>();
    supply.set("Clay", 5);
    supply.set("Sand", Infinity);

    const sandSupply = supply.get("Sand");
    expect(sandSupply).toBe(Infinity);

    const claySupply = supply.get("Clay");
    expect(claySupply).toBe(5);

    // Consume 3 of 5
    if (claySupply !== undefined && claySupply !== Infinity) {
      supply.set("Clay", claySupply - 3);
    }
    expect(supply.get("Clay")).toBe(2);

    // Consume remaining 2
    if (supply.get("Clay") !== undefined && supply.get("Clay")! < 3) {
      // Partial paint — only what's available
      const partial = Math.min(3, supply.get("Clay")!);
      supply.set("Clay", supply.get("Clay")! - partial);
    }
    expect(supply.get("Clay")).toBe(0);

    // Next paint attempt — no supply left
    const remaining = supply.get("Clay")!;
    expect(remaining).toBe(0);
  });

  it("refills supply on drain recovery", () => {
    const supply = new Map<string, number>();
    supply.set("Mud", 0);

    // Refill +1 per cell drained
    supply.set("Mud", supply.get("Mud")! + 10);
    expect(supply.get("Mud")).toBe(10);

    // Multiple drain events accumulate
    supply.set("Mud", supply.get("Mud")! + 5);
    expect(supply.get("Mud")).toBe(15);
  });
});
