import { type GenerationResult } from "./population.js";
import { type RunStateSnapshot } from "../shared/parity-contract.js";

export interface GenerationLogEntry {
  runId: string;
  generation: number;
  terrainName: string;
  populationSize: number;
  bestVehicleId: string | null;
  bestScore: number;
  meanScore: number | null;
}

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

export function createGenerationLogEntry(
  state: RunStateSnapshot,
  generationResult: GenerationResult,
): GenerationLogEntry {
  const rankedResults = [...generationResult.evaluation.results].sort(
    (left, right) => right.score - left.score,
  );
  const bestResult = rankedResults[0];

  return {
    runId: state.runId,
    generation: state.generation + 1,
    terrainName: state.terrainName,
    populationSize: generationResult.evaluatedPopulation.length,
    bestVehicleId: bestResult?.id ?? null,
    bestScore: bestResult?.score ?? 0,
    meanScore: generationResult.evaluation.stats?.mean ?? null,
  };
}

export function serializeGenerationLogEntry(entry: GenerationLogEntry): string {
  return JSON.stringify(entry);
}

export function parseGenerationLogEntry(
  serializedEntry: string,
): GenerationLogEntry {
  return JSON.parse(serializedEntry) as GenerationLogEntry;
}
