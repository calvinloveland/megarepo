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
import { type RunStateSnapshot } from "../shared/parity-contract.js";

export function getRunStatePath(baseDirectory: string): string {
  return join(baseDirectory, "vroomon", "save-state.json");
}

export function getGenerationLogPath(
  baseDirectory: string,
  runId: string,
): string {
  return join(baseDirectory, "vroomon", "logs", `${runId}.jsonl`);
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
