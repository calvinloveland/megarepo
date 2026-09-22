/**
 * Versioned saves.
 *
 * A save is an envelope plus whatever the game wants to remember. The registry
 * owns the current version and a chain of migrations, so an old save is walked
 * forward one version at a time instead of being rejected — and a save from a
 * *newer* build is refused rather than half-read.
 */

export interface SaveEnvelope {
  version: number;
  savedAt: string;
  data: unknown;
}

export interface SaveRegistry {
  readonly version: number;
  /** `migrations[from]` upgrades a save at `from` to `from + 1`. */
  readonly migrations: Readonly<Record<number, (data: unknown) => unknown>>;
}

export function createSaveRegistry(
  version: number,
  migrations: Record<number, (data: unknown) => unknown> = {},
): SaveRegistry {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`a save registry version must be a positive integer, got ${version}`);
  }
  for (const from of Object.keys(migrations).map(Number)) {
    if (!Number.isInteger(from) || from < 1 || from >= version) {
      throw new Error(`migration from version ${from} is outside 1..${version - 1}`);
    }
  }
  return { version, migrations };
}

export function encodeSave(data: unknown, registry: SaveRegistry, now: Date = new Date()): string {
  const envelope: SaveEnvelope = {
    version: registry.version,
    savedAt: now.toISOString(),
    data,
  };
  return JSON.stringify(envelope);
}

export interface DecodedSave {
  data: unknown;
  version: number;
  savedAt: string;
  /** How many migrations were applied, for a "your save was upgraded" note. */
  migratedFrom: number | null;
}

export function decodeSave(text: string, registry: SaveRegistry): DecodedSave | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const envelope = parsed as Partial<SaveEnvelope>;
  if (typeof envelope.version !== "number" || !Number.isInteger(envelope.version)) {
    return null;
  }
  if (envelope.version < 1 || envelope.version > registry.version) {
    return null;
  }
  const migratedFrom = envelope.version === registry.version ? null : envelope.version;
  let version = envelope.version;
  let data = envelope.data;
  while (version < registry.version) {
    const migrate = registry.migrations[version];
    if (!migrate) {
      return null;
    }
    data = migrate(data);
    version += 1;
  }
  return {
    data,
    version,
    savedAt: typeof envelope.savedAt === "string" ? envelope.savedAt : "",
    migratedFrom,
  };
}
