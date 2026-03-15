import { type RunStateSnapshot } from "../shared/parity-contract.js";

export function serializeRunState(state: RunStateSnapshot): string {
  return JSON.stringify(state, null, 2);
}

export function parseRunState(serializedState: string): RunStateSnapshot {
  const parsed = JSON.parse(serializedState) as Partial<RunStateSnapshot>;

  if (parsed.version !== 1) {
    throw new Error("Unsupported run-state version.");
  }

  if (parsed.mode !== "evolution" && parsed.mode !== "test-drive") {
    throw new Error("Run state is missing a supported mode.");
  }

  if (!Array.isArray(parsed.population)) {
    throw new Error("Run state population must be an array.");
  }

  return parsed as RunStateSnapshot;
}
