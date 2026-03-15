import { contextBridge, ipcRenderer } from "electron";

import {
  cleanDna,
  createRandomDna,
  decodeDnaV2,
  type DecodedDnaV2,
} from "./shared/dna-v2.js";
import {
  createEmptyRunState,
  getTerrainPreset,
  VROOMON_PARITY_CONTRACT,
  type RunStateSnapshot,
  type TerrainPresetDefinition,
  type VroomonParityContract,
} from "./shared/parity-contract.js";
import {
  advanceRunState,
  evaluatePopulation,
  computeScoreStats,
  createPreviewRunState,
  previewEvolutionStep,
  runEvolutionGeneration,
  type EvolutionPreview,
  type GenerationResult,
  type PopulationEvaluation,
  type ScoreStats,
} from "./core/population.js";
import {
  createGenerationLogEntry,
  type GenerationLogEntry,
} from "./core/persistence.js";
import {
  createMatterVehicle,
  simulatePopulationRace,
  stepMatterVehicle,
  type VehicleSnapshot,
  type RaceVehicleSnapshot,
} from "./simulation/matter-simulation.js";

const api = {
  cleanDna,
  createRandomDna,
  decodeDnaV2,
  getParityContract: (): VroomonParityContract => VROOMON_PARITY_CONTRACT,
  getTerrainPreset: (name: string): TerrainPresetDefinition | undefined =>
    getTerrainPreset(name),
  createEmptyRunState: (
    mode: "evolution" | "test-drive",
  ): RunStateSnapshot => createEmptyRunState(mode),
  createPreviewRunState: (runId: string): RunStateSnapshot =>
    createPreviewRunState(runId, createEmptyRunState("evolution")),
  computeScoreStats: (scores: number[]): ScoreStats | undefined =>
    computeScoreStats(scores),
  evaluatePopulation: (state: RunStateSnapshot): PopulationEvaluation =>
    evaluatePopulation(state.population, state.terrainName),
  runEvolutionGeneration: (state: RunStateSnapshot): GenerationResult =>
    runEvolutionGeneration(state),
  advanceRunState: (
    state: RunStateSnapshot,
    generationResult: GenerationResult,
  ): RunStateSnapshot => advanceRunState(state, generationResult),
  createGenerationLogEntry: (
    state: RunStateSnapshot,
    generationResult: GenerationResult,
  ): GenerationLogEntry => createGenerationLogEntry(state, generationResult),
  previewEvolutionStep: (state: RunStateSnapshot): EvolutionPreview =>
    previewEvolutionStep(
      state.population,
      state.config.retainRatio,
      state.config.mutationRate,
      state.runId,
      state.genealogy,
    ),
  previewPhysicsSnapshot: (
    dna: string,
    terrainName: string,
    stepCount = 120,
  ): VehicleSnapshot =>
    stepMatterVehicle(createMatterVehicle(dna, terrainName), stepCount),
  previewPopulationRace: (
    state: RunStateSnapshot,
    stepCount = 180,
  ): RaceVehicleSnapshot[] =>
    simulatePopulationRace(
      state.population.map((entry) => ({ id: entry.id, dna: entry.dna })),
      state.terrainName,
      { stepCount },
    ),
  saveRunState: (state: RunStateSnapshot): Promise<string> =>
    ipcRenderer.invoke("vroomon:save-run-state", state),
  loadRunState: (): Promise<RunStateSnapshot | null> =>
    ipcRenderer.invoke("vroomon:load-run-state"),
  appendGenerationLog: (entry: GenerationLogEntry): Promise<string> =>
    ipcRenderer.invoke("vroomon:append-generation-log", entry),
  loadGenerationLog: (runId: string): Promise<GenerationLogEntry[]> =>
    ipcRenderer.invoke("vroomon:load-generation-log", runId),
};

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
      getParityContract: () => VroomonParityContract;
      getTerrainPreset: (name: string) => TerrainPresetDefinition | undefined;
      createEmptyRunState: (mode: "evolution" | "test-drive") => RunStateSnapshot;
      createPreviewRunState: (runId: string) => RunStateSnapshot;
      computeScoreStats: (scores: number[]) => ScoreStats | undefined;
      evaluatePopulation: (state: RunStateSnapshot) => PopulationEvaluation;
      runEvolutionGeneration: (state: RunStateSnapshot) => GenerationResult;
      advanceRunState: (
        state: RunStateSnapshot,
        generationResult: GenerationResult,
      ) => RunStateSnapshot;
      createGenerationLogEntry: (
        state: RunStateSnapshot,
        generationResult: GenerationResult,
      ) => GenerationLogEntry;
      previewEvolutionStep: (state: RunStateSnapshot) => EvolutionPreview;
      previewPhysicsSnapshot: (
        dna: string,
        terrainName: string,
        stepCount?: number,
      ) => VehicleSnapshot;
      previewPopulationRace: (
        state: RunStateSnapshot,
        stepCount?: number,
      ) => RaceVehicleSnapshot[];
      saveRunState: (state: RunStateSnapshot) => Promise<string>;
      loadRunState: () => Promise<RunStateSnapshot | null>;
      appendGenerationLog: (entry: GenerationLogEntry) => Promise<string>;
      loadGenerationLog: (runId: string) => Promise<GenerationLogEntry[]>;
    };
  }
}

contextBridge.exposeInMainWorld("vroomon", api);
