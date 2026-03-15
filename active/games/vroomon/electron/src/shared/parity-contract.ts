export type AppModeId = "menu" | "evolution" | "test-drive";
export type CapabilitySource = "python" | "godot";
export type CapabilityStatus = "required" | "planned";

export interface AppModeDefinition {
  id: AppModeId;
  label: string;
  description: string;
}

export interface TerrainPresetDefinition {
  name: string;
  friction: number;
  groundLength: number;
  groundHeight: number;
  obstacleCount: number;
  obstacleWidth?: number;
  obstacleHeightBase?: number;
  obstacleHeightStep?: number;
  colorGround?: string;
  colorObstacle?: string;
}

export interface CapabilityDefinition {
  id: string;
  title: string;
  description: string;
  status: CapabilityStatus;
  source: CapabilitySource;
}

export interface RunConfig {
  populationSize: number;
  dnaLength: number;
  retainRatio: number;
  mutationRate: number;
  raceDurationSeconds: number;
}

export interface PopulationEntry {
  id: string;
  dna: string;
  parents: string[];
  mutated: boolean;
  score: number;
}

export interface RunStateSnapshot {
  version: 1;
  mode: Extract<AppModeId, "evolution" | "test-drive">;
  terrainName: string;
  generation: number;
  wallet: number;
  config: RunConfig;
  population: PopulationEntry[];
}

export interface VroomonParityContract {
  appName: string;
  targetSourceBranch: string;
  summary: string;
  modes: AppModeDefinition[];
  terrains: TerrainPresetDefinition[];
  capabilities: CapabilityDefinition[];
  defaultRunConfig: RunConfig;
}

export const APP_MODES: AppModeDefinition[] = [
  {
    id: "menu",
    label: "Main Menu",
    description: "Entry screen for choosing evolution or test-drive mode.",
  },
  {
    id: "evolution",
    label: "Evolution Mode",
    description:
      "Run multi-car evolutionary races with stats, terrain switching, and save/load.",
  },
  {
    id: "test-drive",
    label: "Test Drive",
    description:
      "Preview a single generated car with instant reset and camera-follow behavior.",
  },
];

export const TERRAIN_PRESETS: TerrainPresetDefinition[] = [
  {
    name: "Grassland",
    friction: 1,
    groundLength: 5000,
    groundHeight: 400,
    obstacleCount: 5,
    obstacleWidth: 100,
    obstacleHeightBase: 50,
    obstacleHeightStep: 10,
    colorGround: "#664222",
    colorObstacle: "#a9a9a9",
  },
  {
    name: "Flat",
    friction: 1,
    groundLength: 5000,
    groundHeight: 400,
    obstacleCount: 0,
  },
];

export const DEFAULT_RUN_CONFIG: RunConfig = {
  populationSize: 100,
  dnaLength: 12,
  retainRatio: 0.5,
  mutationRate: 0.1,
  raceDurationSeconds: 15,
};

export const PARITY_CAPABILITIES: CapabilityDefinition[] = [
  {
    id: "dna-v2",
    title: "DNA v2 decoding",
    description:
      "Use the Godot branch's base62, locality-preserving DNA format as the canonical genome.",
    status: "required",
    source: "godot",
  },
  {
    id: "multi-car-racing",
    title: "Simultaneous racing",
    description:
      "Score populations as concurrent races rather than one-car-at-a-time playback.",
    status: "required",
    source: "godot",
  },
  {
    id: "terrain-presets",
    title: "Terrain presets",
    description:
      "Support named terrain profiles and generators, starting with Grassland and Flat.",
    status: "required",
    source: "godot",
  },
  {
    id: "lineage-tracking",
    title: "Lineage tracking",
    description:
      "Track IDs, parent links, mutation flags, and genealogy-friendly snapshots.",
    status: "required",
    source: "godot",
  },
  {
    id: "save-load",
    title: "Persistence",
    description:
      "Persist run config, terrain, generation progress, wallet, and population snapshots.",
    status: "required",
    source: "godot",
  },
  {
    id: "python-regression",
    title: "Python behavior baseline",
    description:
      "Keep the legacy Python implementation available as a regression baseline while porting.",
    status: "required",
    source: "python",
  },
];

export const VROOMON_PARITY_CONTRACT: VroomonParityContract = {
  appName: "vroomon",
  targetSourceBranch: "calvinloveland/vroomon:godot",
  summary:
    "The monorepo Electron rewrite targets the richer Godot branch feature set while preserving the Python prototype as a behavioral reference.",
  modes: APP_MODES,
  terrains: TERRAIN_PRESETS,
  capabilities: PARITY_CAPABILITIES,
  defaultRunConfig: DEFAULT_RUN_CONFIG,
};

export function getTerrainPreset(
  name: string,
): TerrainPresetDefinition | undefined {
  return TERRAIN_PRESETS.find((terrain) => terrain.name === name);
}

export function createEmptyRunState(
  mode: Extract<AppModeId, "evolution" | "test-drive">,
  terrainName = TERRAIN_PRESETS[0]!.name,
): RunStateSnapshot {
  return {
    version: 1,
    mode,
    terrainName,
    generation: 0,
    wallet: 0,
    config: { ...DEFAULT_RUN_CONFIG },
    population: [],
  };
}
