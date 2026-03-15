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
    };
  }
}

contextBridge.exposeInMainWorld("vroomon", api);
