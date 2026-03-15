import { contextBridge } from "electron";

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
  computeScoreStats,
  createPreviewRunState,
  previewEvolutionStep,
  type EvolutionPreview,
  type ScoreStats,
} from "./core/population.js";

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
  previewEvolutionStep: (state: RunStateSnapshot): EvolutionPreview =>
    previewEvolutionStep(
      state.population,
      state.config.retainRatio,
      state.config.mutationRate,
      "preview",
    ),
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
      previewEvolutionStep: (state: RunStateSnapshot) => EvolutionPreview;
    };
  }
}

contextBridge.exposeInMainWorld("vroomon", api);
