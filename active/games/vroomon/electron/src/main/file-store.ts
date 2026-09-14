import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  parseGenerationLogEntry,
  parseRunState,
  serializeGenerationLogEntry,
  serializeRunState,
  type GenerationLogEntry,
} from "../core/persistence.js";
import {
  EMPTY_HALL_OF_FAME,
  EMPTY_RECORDS_BOARD,
  type HallOfFame,
  type HallOfFameEntry,
  type RecordEntry,
  type RecordsBoard,
  type RunStateSnapshot,
} from "../shared/parity-contract.js";
import {
  EMPTY_PERSISTED_WORLD,
  parsePersistedWorld,
  type PersistedWorldState,
} from "../renderer/world/types.js";

export function getRunStatePath(baseDirectory: string): string {
  return join(baseDirectory, "vroomon", "save-state.json");
}

export function getGenerationLogPath(
  baseDirectory: string,
  runId: string,
): string {
  return join(baseDirectory, "vroomon", "logs", `${runId}.jsonl`);
}

export function getHallOfFamePath(baseDirectory: string): string {
  return join(baseDirectory, "vroomon", "hall-of-fame.json");
}

export function getWorldStatePath(baseDirectory: string): string {
  return join(baseDirectory, "vroomon", "world-state.json");
}

export function getUpgradesPath(baseDirectory: string): string {
  return join(baseDirectory, "vroomon", "upgrades.json");
}

export async function saveUpgradesToDisk(
  baseDirectory: string,
  upgrades: Record<string, number>,
): Promise<string> {
  const targetPath = getUpgradesPath(baseDirectory);
  await mkdir(join(baseDirectory, "vroomon"), { recursive: true });
  await writeFile(targetPath, JSON.stringify(upgrades, null, 2), "utf8");
  return targetPath;
}

export async function loadUpgradesFromDisk(
  baseDirectory: string,
): Promise<Record<string, number> | null> {
  const targetPath = getUpgradesPath(baseDirectory);
  if (!existsSync(targetPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(targetPath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveRunStateToDisk(
  baseDirectory: string,
  state: RunStateSnapshot,
): Promise<string> {
  const targetPath = getRunStatePath(baseDirectory);
  await mkdir(join(baseDirectory, "vroomon"), { recursive: true });
  await writeFile(targetPath, serializeRunState(state), "utf8");
  return targetPath;
}

export async function loadRunStateFromDisk(
  baseDirectory: string,
): Promise<RunStateSnapshot | null> {
  const targetPath = getRunStatePath(baseDirectory);

  if (!existsSync(targetPath)) {
    return null;
  }

  const serializedState = await readFile(targetPath, "utf8");
  return parseRunState(serializedState);
}

export async function appendGenerationLogToDisk(
  baseDirectory: string,
  entry: GenerationLogEntry,
): Promise<string> {
  const targetPath = getGenerationLogPath(baseDirectory, entry.runId);
  await mkdir(join(baseDirectory, "vroomon", "logs"), { recursive: true });
  await appendFile(
    targetPath,
    `${serializeGenerationLogEntry(entry)}\n`,
    "utf8",
  );
  return targetPath;
}

export async function loadGenerationLogFromDisk(
  baseDirectory: string,
  runId: string,
): Promise<GenerationLogEntry[]> {
  const targetPath = getGenerationLogPath(baseDirectory, runId);

  if (!existsSync(targetPath)) {
    return [];
  }

  const serializedEntries = await readFile(targetPath, "utf8");
  return serializedEntries
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseGenerationLogEntry(line));
}

function parseHallOfFame(serialized: string): HallOfFame {
  const parsed = JSON.parse(serialized) as Partial<HallOfFame>;

  if (parsed.version !== 1) {
    throw new Error("Unsupported hall-of-fame version.");
  }

  if (!Array.isArray(parsed.entries)) {
    throw new Error("Hall of fame entries must be an array.");
  }

  return parsed as HallOfFame;
}

function serializeHallOfFame(hall: HallOfFame): string {
  return JSON.stringify(hall, null, 2);
}

function isValidHallEntry(entry: unknown): entry is HallOfFameEntry {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Partial<HallOfFameEntry>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.dna === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.score === "number" &&
    typeof candidate.terrainName === "string" &&
    typeof candidate.generation === "number" &&
    typeof candidate.savedAt === "string" &&
    typeof candidate.notes === "string"
  );
}

export async function loadHallOfFameFromDisk(
  baseDirectory: string,
): Promise<HallOfFame> {
  const targetPath = getHallOfFamePath(baseDirectory);

  if (!existsSync(targetPath)) {
    return { ...EMPTY_HALL_OF_FAME };
  }

  try {
    const serialized = await readFile(targetPath, "utf8");
    const parsed = parseHallOfFame(serialized);
    return {
      version: 1,
      entries: parsed.entries.filter(isValidHallEntry),
    };
  } catch {
    return { ...EMPTY_HALL_OF_FAME };
  }
}

export async function saveHallOfFameToDisk(
  baseDirectory: string,
  hall: HallOfFame,
): Promise<string> {
  const targetPath = getHallOfFamePath(baseDirectory);
  await mkdir(join(baseDirectory, "vroomon"), { recursive: true });
  const sanitized: HallOfFame = {
    version: 1,
    entries: hall.entries.filter(isValidHallEntry),
  };
  await writeFile(targetPath, serializeHallOfFame(sanitized), "utf8");
  return targetPath;
}

const RECORDS_FILE_NAME = "records.json";

function recordsPath(baseDirectory: string): string {
  return join(baseDirectory, "vroomon", RECORDS_FILE_NAME);
}

function serializeRecords(board: RecordsBoard): string {
  return JSON.stringify(board, null, 2);
}

function parseRecords(serialized: string): RecordsBoard {
  const parsed = JSON.parse(serialized) as Partial<RecordsBoard>;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    return { ...EMPTY_RECORDS_BOARD };
  }
  return {
    version: 1,
    entries: (parsed.entries as Array<Partial<RecordEntry>>).filter(isValidRecordEntry),
  };
}

function isValidRecordEntry(candidate: unknown): candidate is RecordEntry {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const record = candidate as Partial<RecordEntry>;
  return (
    typeof record.terrainName === "string" &&
    typeof record.dna === "string" &&
    typeof record.score === "number" &&
    typeof record.savedAt === "string"
  );
}

export async function loadRecordsFromDisk(
  baseDirectory: string,
): Promise<RecordsBoard> {
  const targetPath = recordsPath(baseDirectory);

  if (!existsSync(targetPath)) {
    return { ...EMPTY_RECORDS_BOARD };
  }

  try {
    const serialized = await readFile(targetPath, "utf8");
    const parsed = parseRecords(serialized);
    return { version: 1, entries: parsed.entries.filter(isValidRecordEntry) };
  } catch {
    return { ...EMPTY_RECORDS_BOARD };
  }
}

export async function saveRecordsToDisk(
  baseDirectory: string,
  board: RecordsBoard,
): Promise<string> {
  const targetPath = recordsPath(baseDirectory);
  await mkdir(join(baseDirectory, "vroomon"), { recursive: true });
  const sanitized: RecordsBoard = {
    version: 1,
    entries: board.entries.filter(isValidRecordEntry),
  };
  await writeFile(targetPath, serializeRecords(sanitized), "utf8");
  return targetPath;
}

function isValidPersistedWorldShape(value: unknown): value is PersistedWorldState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PersistedWorldState>;
  return (
    candidate.version === 1 &&
    typeof candidate.currentMapId === "string" &&
    typeof candidate.playerX === "number" &&
    typeof candidate.playerY === "number" &&
    (candidate.playerFacing === "up" ||
      candidate.playerFacing === "down" ||
      candidate.playerFacing === "left" ||
      candidate.playerFacing === "right") &&
    Array.isArray(candidate.badges) &&
    Array.isArray(candidate.vroomdex) &&
    typeof candidate.flags === "object"
  );
}

function sanitizePersistedWorld(
  world: PersistedWorldState,
): PersistedWorldState {
  return {
    version: 1,
    currentMapId: world.currentMapId,
    playerX: world.playerX,
    playerY: world.playerY,
    playerFacing: world.playerFacing,
    badges: world.badges.filter((badge) => typeof badge === "string").slice(0, 16),
    factionChoices: { ...world.factionChoices },
    decor: Array.isArray(world.decor)
      ? world.decor.filter((id) => typeof id === "string").slice(0, 32)
      : [],
    rancherName: typeof world.rancherName === "string" ? world.rancherName.slice(0, 24) : "",
    rancherCap: world.rancherCap === "rust" || world.rancherCap === "green"
      ? world.rancherCap
      : "navy",
    vroomdex: world.vroomdex.filter((dna) => typeof dna === "string").slice(-200),
    flags: Object.fromEntries(
      Object.entries(world.flags).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    ),
    lastSavedAt: typeof world.lastSavedAt === "string" ? world.lastSavedAt : new Date().toISOString(),
  };
}

export async function loadWorldStateFromDisk(
  baseDirectory: string,
): Promise<PersistedWorldState> {
  const targetPath = getWorldStatePath(baseDirectory);

  if (!existsSync(targetPath)) {
    return { ...EMPTY_PERSISTED_WORLD };
  }

  try {
    const serialized = await readFile(targetPath, "utf8");
    const parsed = parsePersistedWorld(serialized);
    if (parsed && isValidPersistedWorldShape(parsed)) {
      return sanitizePersistedWorld(parsed);
    }
    return { ...EMPTY_PERSISTED_WORLD };
  } catch {
    return { ...EMPTY_PERSISTED_WORLD };
  }
}

export async function saveWorldStateToDisk(
  baseDirectory: string,
  world: PersistedWorldState,
): Promise<string> {
  const targetPath = getWorldStatePath(baseDirectory);
  await mkdir(join(baseDirectory, "vroomon"), { recursive: true });
  const sanitized = sanitizePersistedWorld(world);
  await writeFile(targetPath, JSON.stringify(sanitized, null, 2), "utf8");
  return targetPath;
}
