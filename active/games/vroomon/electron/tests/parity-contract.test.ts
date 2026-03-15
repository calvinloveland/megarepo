import { describe, expect, it } from "vitest";

import {
  APP_MODES,
  DEFAULT_RUN_CONFIG,
  PARITY_CAPABILITIES,
  TERRAIN_PRESETS,
  VROOMON_PARITY_CONTRACT,
  createEmptyRunState,
  getTerrainPreset,
} from "../src/shared/parity-contract.js";

describe("parity contract", () => {
  it("freezes the required app modes from the Godot target", () => {
    expect(APP_MODES.map((mode) => mode.id)).toEqual([
      "menu",
      "evolution",
      "test-drive",
    ]);
  });

  it("includes the terrain presets already present in the Godot branch", () => {
    expect(TERRAIN_PRESETS.map((terrain) => terrain.name)).toEqual([
      "Grassland",
      "Flat",
    ]);
    expect(getTerrainPreset("Grassland")).toMatchObject({
      obstacleCount: 5,
      groundHeight: 400,
    });
  });

  it("marks the core parity capabilities as required", () => {
    expect(PARITY_CAPABILITIES.every((capability) => capability.status === "required")).toBe(
      true,
    );
    expect(VROOMON_PARITY_CONTRACT.capabilities).toHaveLength(
      PARITY_CAPABILITIES.length,
    );
  });

  it("creates an empty persisted run state with the default config", () => {
    expect(createEmptyRunState("evolution")).toEqual({
      version: 1,
      runId: "run",
      mode: "evolution",
      terrainName: "Grassland",
      generation: 0,
      wallet: 0,
      config: DEFAULT_RUN_CONFIG,
      population: [],
      genealogy: {},
    });
  });
});
