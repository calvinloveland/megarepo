// Export/import of world + run state as printable strings (base64 JSON),
// so progress can travel between browsers, machines, and saves.

import type { RunStateSnapshot } from "../shared/parity-contract.js";
import type { PersistedWorldState } from "./world/types.js";

function toBase64(text: string): string {
  if (typeof btoa === "function") {
    return btoa(text);
  }
  return Buffer.from(text, "utf8").toString("base64");
}

function fromBase64(text: string): string {
  if (typeof atob === "function") {
    return atob(text);
  }
  return Buffer.from(text, "base64").toString("utf8");
}

export function encodeWorld(world: PersistedWorldState): string {
  return toBase64(JSON.stringify(world));
}

export function decodeWorld(text: string): PersistedWorldState | null {
  try {
    const parsed = JSON.parse(fromBase64(text.trim())) as Partial<PersistedWorldState>;
    if (
      parsed.version !== 1 ||
      typeof parsed.currentMapId !== "string" ||
      !Array.isArray(parsed.badges) ||
      !Array.isArray(parsed.vroomdex) ||
      typeof parsed.flags !== "object" ||
      parsed.flags === null
    ) {
      return null;
    }
    return parsed as unknown as PersistedWorldState;
  } catch {
    return null;
  }
}

export function encodeRun(state: RunStateSnapshot): string {
  return toBase64(JSON.stringify(state));
}

export function decodeRun(text: string): RunStateSnapshot | null {
  try {
    const parsed = JSON.parse(fromBase64(text.trim())) as Partial<RunStateSnapshot>;
    if (
      parsed.version !== 1 ||
      (parsed.mode !== "evolution" && parsed.mode !== "test-drive") ||
      !Array.isArray(parsed.population)
    ) {
      return null;
    }
    return parsed as unknown as RunStateSnapshot;
  } catch {
    return null;
  }
}
