// Consolidated player settings: master volume + the ambience pad level.
// Persisted to localStorage (works in the Electron shell too — its
// localStorage lives in userData). The old `vroomon:ambience` key merges
// in as the legacy source for ambience levels.

export interface Settings {
  /** 0..1 master gain applied to every cue and the ambience pad. */
  masterVolume: number;
  ambienceEnabled: boolean;
  /** 0 = off, 1 = low, 2 = med. */
  ambienceVolume: 0 | 1 | 2;
}

const SETTINGS_KEY = "vroomon:settings";
const LEGACY_AMBIENCE_KEY = "vroomon:ambience";

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  ambienceEnabled: true,
  ambienceVolume: 2,
};

function isValidVolume(value: unknown): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

export function normalizeSettings(partial: Partial<Settings> | null | undefined): Settings {
  const masterVolume =
    typeof partial?.masterVolume === "number" &&
    Number.isFinite(partial.masterVolume)
      ? Math.min(1, Math.max(0, partial.masterVolume))
      : DEFAULT_SETTINGS.masterVolume;
  const ambienceVolume =
    partial && isValidVolume(partial.ambienceVolume)
      ? partial.ambienceVolume
      : DEFAULT_SETTINGS.ambienceVolume;
  return {
    masterVolume,
    ambienceEnabled: partial?.ambienceEnabled ?? DEFAULT_SETTINGS.ambienceEnabled,
    ambienceVolume,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return normalizeSettings(JSON.parse(raw) as Partial<Settings>);
    }
    // Legacy ambience-only key -> migrate once.
    const legacyRaw = window.localStorage.getItem(LEGACY_AMBIENCE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { enabled?: boolean; volume?: number };
      return normalizeSettings({
        ...DEFAULT_SETTINGS,
        ambienceEnabled: legacy.enabled ?? DEFAULT_SETTINGS.ambienceEnabled,
        ambienceVolume: isValidVolume(legacy.volume)
          ? legacy.volume
          : DEFAULT_SETTINGS.ambienceVolume,
      });
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — settings apply for the session only.
  }
}
