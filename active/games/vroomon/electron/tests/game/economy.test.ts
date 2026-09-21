import { describe, expect, it } from "vitest";
import { createEmptyRunState } from "../../src/shared/parity-contract.js";
import { createPreviewRunState } from "../../src/core/population.js";
import {
  effectiveRunConfig,
  hallOfFameCapacity,
  incomeMultiplier,
  purchaseUpgrade,
  SUPPLIES,
  studLineCapacity,
  upgradeCost,
  upgradeLevel,
  UPGRADES,
} from "../../src/core/economy.js";

describe("ranch economy", () => {
  it("defines seven actionable upgrades", () => {
    expect(UPGRADES).toHaveLength(7);
    for (const def of UPGRADES) {
      expect(def.maxLevel).toBeGreaterThan(0);
      expect(def.effectLabel(1).length).toBeGreaterThan(0);
    }
  });

  it("offers two one-shot supplements and gates stud-line slots behind the Split", () => {
    expect(SUPPLIES.map((s) => s.id)).toEqual(["calm", "wild"]);
    expect(studLineCapacity(undefined)).toBe(0);
    expect(studLineCapacity({ pens: 0 })).toBe(0);
    expect(studLineCapacity({ pens: 1 })).toBe(2);
    expect(studLineCapacity({ pens: 3 })).toBe(6);
  });

  it("scales tier costs by level", () => {
    const pasture = UPGRADES.find((u) => u.id === "pasture")!;
    expect(upgradeCost(pasture, 1)).toBe(40);
    expect(upgradeCost(pasture, 2)).toBe(80);
    expect(upgradeCost(pasture, 5)).toBe(200);
  });

  it("rejects purchases the wallet can't afford", () => {
    let state = createEmptyRunState("evolution");
    const result = purchaseUpgrade(state, "pasture");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Need 40 credits");
  });

  it("buys an upgrade, debits the wallet, and normalizes the config", () => {
    let state = { ...createEmptyRunState("evolution"), wallet: 100 };
    const result = purchaseUpgrade(state, "pasture");
    expect(result.ok).toBe(true);
    expect(result.state.wallet).toBe(60);
    expect(upgradeLevel(result.state, "pasture")).toBe(1);
    // The stored config stays user-based; the boost lands when a fresh run
    // is created (createPreviewRunState applies effectiveRunConfig).
    expect(result.state.config.populationSize).toBe(100); // base config not baked
    const fresh = createPreviewRunState("ranch-test", result.state);
    expect(fresh.config.populationSize).toBe(100);
    expect(fresh.population.length).toBe(125); // herd sized by the upgrade
    state = result.state;

    // A second tier costs more (80) and stacks — give the wallet headroom.
    state = { ...state, wallet: 200 };
    const again = purchaseUpgrade(state, "pasture");
    expect(again.ok).toBe(true);
    expect(again.state.wallet).toBe(120); // 200 - 80
    expect(upgradeLevel(again.state, "pasture")).toBe(2);
    expect(effectiveRunConfig(again.state.config, again.state.upgrades).populationSize).toBe(150);
  });

  it("caps upgrades at max level", () => {
    let state = { ...createEmptyRunState("evolution"), wallet: 10_000 };
    for (let i = 0; i < 5; i += 1) {
      const result = purchaseUpgrade(state, "pasture");
      expect(result.ok).toBe(true);
      state = result.state;
    }
    const over = purchaseUpgrade(state, "pasture");
    expect(over.ok).toBe(false);
    expect(over.reason).toContain("fully built");
  });

  it("applies retain/mutation/race-duration modifiers to the config", () => {
    const state = {
      ...createEmptyRunState("evolution"),
      wallet: 10_000,
      upgrades: { grazing: 2, grooming: 1, velodrome: 3 },
    };
    const cfg = effectiveRunConfig(state.config, state.upgrades);
    expect(cfg.retainRatio).toBeCloseTo(0.54); // 0.5 + 2 * 0.02
    expect(cfg.mutationRate).toBeCloseTo(0.09); // 0.1 - 1 * 0.01
    expect(cfg.raceDurationSeconds).toBe(15 + 6);
  });

  it("scales HOF capacity and income", () => {
    expect(hallOfFameCapacity({ stalls: 2 })).toBe(70);
    expect(hallOfFameCapacity(undefined)).toBe(50);
    expect(incomeMultiplier({ ledger: 3 })).toBeCloseTo(1.3);
    expect(incomeMultiplier(undefined)).toBe(1);
  });
});
