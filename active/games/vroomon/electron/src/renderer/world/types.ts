export type TileKind =
  | "grass"
  | "path"
  | "tree"
  | "building"
  | "door"
  | "vroomgrass"
  | "water"
  | "wall"
  | "counter"
  | "indoor-floor"
  | "tall-grass-edge"
  | "tree-trunk"
  | "rock"
  | "doormat";

export type EncounterKind = "wild" | "trainer" | "gym" | null;

export interface MapTransition {
  mapId: string;
  toX: number;
  toY: number;
  facing?: Direction;
}

export interface NpcDefinition {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Direction;
  sprite: string;
  dialogue: DialogueNode | null;
  encounterId?: string;
}

export interface DialogueNode {
  text: string;
  next?: string;
  options?: DialogueOption[];
  onComplete?: "wild" | "trainer" | "gym" | "vroomdex" | null;
  setFlag?: string;
}

export interface DialogueOption {
  label: string;
  next: string;
}

export interface Tilemap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  npcs: NpcDefinition[];
  music?: string;
  ambientColor: string;
  encounters: Record<string, { kind: EncounterKind; dna?: string; trainerName?: string }>;
  transitions: Record<string, MapTransition>;
}

export type Direction = "up" | "down" | "left" | "right";

export interface WorldState {
  currentMapId: string;
  playerX: number;
  playerY: number;
  playerFacing: Direction;
  badges: string[];
  vroomdex: string[];
  flags: Record<string, boolean>;
  dialogueQueue: DialogueNode[];
  activeNpc: string | null;
  currentEncounter: {
    kind: Exclude<EncounterKind, null>;
    dna?: string;
    trainerName?: string;
    returnMap: string;
  } | null;
  isMoving: boolean;
  movementTarget: { x: number; y: number } | null;
}

export interface PersistedWorldState {
  version: 1;
  currentMapId: string;
  playerX: number;
  playerY: number;
  playerFacing: Direction;
  badges: string[];
  vroomdex: string[];
  flags: Record<string, boolean>;
  lastSavedAt: string;
}

export const TILE_SIZE = 32;
export const PLAYER_MOVE_DURATION_MS = 140;

export const EMPTY_PERSISTED_WORLD: PersistedWorldState = {
  version: 1,
  currentMapId: "starter_town",
  playerX: 7,
  playerY: 7,
  playerFacing: "down",
  badges: [],
  vroomdex: [],
  flags: {},
  lastSavedAt: "",
};

export function serializeWorldState(world: WorldState): PersistedWorldState {
  return {
    version: 1,
    currentMapId: world.currentMapId,
    playerX: world.playerX,
    playerY: world.playerY,
    playerFacing: world.playerFacing,
    badges: [...world.badges],
    vroomdex: [...world.vroomdex],
    flags: { ...world.flags },
    lastSavedAt: new Date().toISOString(),
  };
}

function isValidPersistedWorld(value: unknown): value is PersistedWorldState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PersistedWorldState>;
  return (
    candidate.version === 1 &&
    typeof candidate.currentMapId === "string" &&
    typeof candidate.playerX === "number" &&
    typeof candidate.playerY === "number" &&
    typeof candidate.playerFacing === "string" &&
    Array.isArray(candidate.badges) &&
    Array.isArray(candidate.vroomdex) &&
    typeof candidate.flags === "object"
  );
}

export function parsePersistedWorld(
  serialized: string,
): PersistedWorldState | null {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return isValidPersistedWorld(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
