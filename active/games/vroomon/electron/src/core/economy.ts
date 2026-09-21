// Ranch economy: purchasable upgrades that bend the breeding loop.
// Data lives in the run state (runState.upgrades: upgradeId -> level), so
// persistence rides on the existing run-state save/load for both the web
// (localStorage) and desktop (file store) builds.

import type { RunConfig, RunStateSnapshot } from "../shared/parity-contract.js";

export type UpgradeId =
  | "pasture"      // population cap
  | "stalls"       // Hall of Fame slots
  | "grazing"      // retain ratio bonus
  | "velodrome"    // race duration
  | "grooming"     // mutation control
  | "pens"         // stud-line slots
  | "ledger";      // income boost

export type SupplyId = "calm" | "wild";

export interface SupplyDef {
  id: SupplyId;
  name: string;
  flavor: string;
  cost: number;
  effectLabel: string;
}

/** One-shot consumables bought in the RANCH store. */
export const SUPPLIES: SupplyDef[] = [
  {
    id: "calm",
    name: "Calm Tonic",
    flavor: "A spoon of the stills' quiet dram — the next generation keeps its genome true.",
    cost: 10,
    effectLabel: "next cycle: no mutation",
  },
  {
    id: "wild",
    name: "Wild Brome",
    flavor: "Feral fodder from beyond the fence — the next generation gambles on novelty.",
    cost: 8,
    effectLabel: "next cycle: +15% mutation",
  },
];

export function studLineCapacity(upgrades: Record<string, number> | undefined): number {
  return (upgrades?.pens ?? 0) * 2;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  flavor: string;
  maxLevel: number;
  baseCost: number; // cost of level 1; level N costs baseCost * N
  effectLabel: (nextLevel: number) => string;
}

export interface PurchaseResult {
  state: RunStateSnapshot;
  ok: boolean;
  reason?: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "pasture",
    name: "The Shrewed",
    flavor: "A fenceless run of the east meadow — room for a bigger herd.",
    maxLevel: 5,
    baseCost: 40,
    effectLabel: (l) => `+${l * 25} herd cap`,
  },
  {
    id: "stalls",
    name: "Gamesman Stalls",
    flavor: "Click-click racks for the Record Barn — more cars enshrined.",
    maxLevel: 5,
    baseCost: 90,
    effectLabel: (l) => `+${l * 10} Hall of Fame slots`,
  },
  {
    id: "grazing",
    name: "Hardwired & Placate",
    flavor: "A calm-field mix that keeps retiring stock in the herd.",
    maxLevel: 5,
    baseCost: 160,
    effectLabel: (l) => `+${l * 2}% retain`,
  },
  {
    id: "velodrome",
    name: "The Surcingle",
    flavor: "A weighted saddle-ring that extends race laps.",
    maxLevel: 5,
    baseCost: 320,
    effectLabel: (l) => `+${l * 2}s races`,
  },
  {
    id: "grooming",
    name: "The Pretence",
    flavor: "Brushing the herd before every treat — a steadier genome.",
    maxLevel: 5,
    baseCost: 640,
    effectLabel: (l) => `-${l}% mutation`,
  },
  {
    id: "pens",
    name: "The Split",
    flavor: "Wire in a separate pen-court — set aside a stud line that breeds its own blood.",
    maxLevel: 3,
    baseCost: 240,
    effectLabel: (l) => `+${l * 2} stud-line slots`,
  },
  {
    id: "ledger",
    name: "Atmometer Tack",
    flavor: "A patent water-gauge for the stills — prize money comes quicker.",
    maxLevel: 5,
    baseCost: 1200,
    effectLabel: (l) => `+${l * 10}% income`,
  },
];

export function upgradeLevel(state: RunStateSnapshot, id: UpgradeId): number {
  return state.upgrades?.[id] ?? 0;
}

export function upgradeCost(def: UpgradeDef, nextLevel: number): number {
  // Level N costs baseCost * N (so buying levels 1..L = baseCost * L*(L+1)/2).
  return Math.max(1, def.baseCost * nextLevel);
}

/**
 * Effective run config after upgrade modifiers.
 *
 * Applied when a NEW run or population is created, never baked back into the
 * stored config: the user-picked selects stay the base, so a purchased upgrade
 * cannot compound every time it is read.
 */
export function effectiveRunConfig(
  config: RunConfig,
  upgrades: Record<string, number> | undefined,
): RunConfig {
  const u = upgrades ?? {};
  return {
    ...config,
    populationSize: config.populationSize + (u.pasture ?? 0) * 25,
    retainRatio: Math.min(
      0.95,
      Math.max(0.1, config.retainRatio + (u.grazing ?? 0) * 0.02),
    ),
    mutationRate: Math.min(
      0.5,
      Math.max(0.01, config.mutationRate - (u.grooming ?? 0) * 0.01),
    ),
    raceDurationSeconds: config.raceDurationSeconds + (u.velodrome ?? 0) * 2,
  };
}

export function hallOfFameCapacity(upgrades: Record<string, number> | undefined): number {
  return 50 + (upgrades?.stalls ?? 0) * 10;
}

export function incomeMultiplier(upgrades: Record<string, number> | undefined): number {
  return 1 + (upgrades?.ledger ?? 0) * 0.1;
}

// (There was an `applyUpgrades` here, referenced exactly once - by its own
// definition - and it was a trap rather than dead weight: it returned a state
// with the upgrade modifiers baked into `config`, which is exactly the
// double-counting the rule below exists to prevent. Removed so nobody can
// reach for it. The rule it warned about lives on `effectiveRunConfig`.)

export function purchaseUpgrade(
  state: RunStateSnapshot,
  id: UpgradeId,
): PurchaseResult {
  const def = UPGRADES.find((candidate) => candidate.id === id);
  if (!def) {
    return { state, ok: false, reason: "Unknown upgrade." };
  }

  const current = upgradeLevel(state, id);
  if (current >= def.maxLevel) {
    return { state, ok: false, reason: `${def.name} is fully built.` };
  }

  const nextLevel = current + 1;
  const cost = upgradeCost(def, nextLevel);
  if (state.wallet < cost) {
    return { state, ok: false, reason: `Need ${cost} credits.` };
  }

  return {
    state: {
      ...state,
      wallet: state.wallet - cost,
      upgrades: { ...(state.upgrades ?? {}), [id]: nextLevel },
    },
    ok: true,
  };
}
