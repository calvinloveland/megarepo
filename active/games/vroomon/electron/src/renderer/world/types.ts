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
  | "doormat"
  | "bed";

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
  onComplete?:
    | "wild"
    | "trainer"
    | "gym"
    | "vroomdex"
    | "grand-roundup"
    | "open-ranch"
    | "starter-vroomon"
    /** Walk the story into another space: `goto:<mapId>:<x>:<y>`. */
    | `goto:${string}`
    | `join-faction:${string}`
    | null;
  setFlag?: string;
}

export interface DialogueOption {
  label: string;
  next: string;
}

export interface Tilemap {
  id: string;
  /** Indoors: rendered against a dark room, not the deep forest outside. */
  interior?: boolean;
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
  /** biomeId -> factionId, one chosen household per biome. */
  factionChoices: Record<string, string>;
  /** Owned cosmetic decor ids (parked in Starter Town's meadow). */
  decor: string[];
  /** Rancher identity (optional; '' = the un-named new hand). */
  rancherName: string;
  rancherCap: "navy" | "rust" | "green";
  vroomdex: string[];
  /** arena mapId -> the circuit tier you're up against there (1 = first). */
  feudTiers: Record<string, number>;
  /**
   * Whether the rancher is out looking for wild vroomon. Off means the tall
   * grass is just grass: no encounter rolls, no races on the way across your
   * own paddock.
   */
  hunting: boolean;
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
  /** Worldbuild iteration stamp (2 = banner garlands + extended decor).
   * Old saves without it read as version 1 — always tolerated on load. */
  worldVersion?: number;
  currentMapId: string;
  playerX: number;
  playerY: number;
  playerFacing: Direction;
  badges: string[];
  factionChoices: Record<string, string>;
  decor: string[];
  rancherName: string;
  rancherCap: "navy" | "rust" | "green";
  vroomdex: string[];
  /** Circuit tiers per arena (optional for old saves). */
  feudTiers?: Record<string, number>;
  /** Optional for old saves: an absent flag means "hunting". */
  hunting?: boolean;
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
  factionChoices: {},
  decor: [],
  rancherName: "",
  rancherCap: "navy",
  vroomdex: [],
  feudTiers: {},
  hunting: true,
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
    factionChoices: { ...world.factionChoices },
    decor: [...world.decor],
    rancherName: world.rancherName,
    rancherCap: world.rancherCap,
    vroomdex: [...world.vroomdex],
    feudTiers: { ...world.feudTiers },
    hunting: world.hunting,
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
    (candidate.decor === undefined || Array.isArray(candidate.decor)) &&
    (candidate.factionChoices === undefined ||
      (typeof candidate.factionChoices === "object" && candidate.factionChoices !== null)) &&
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
