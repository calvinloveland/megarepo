// First-visit onboarding flags, persisted so explainer banners only show
// once per mode. Pure + unit-testable (window-free where possible).

const TIPS_KEY = "vroomon:tips";

export type TipKey = "evolution" | "test-drive";

export function shouldShowTip(key: TipKey, storage: Storage | null = null): boolean {
  const seen = readSeen(storage);
  return !seen.includes(key);
}

export function markTipSeen(key: TipKey, storage: Storage | null = null): void {
  const seen = readSeen(storage);
  if (seen.includes(key)) {
    return;
  }
  writeSeen([...seen, key], storage);
}

function readSeen(storage: Storage | null): TipKey[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(TIPS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is TipKey =>
          entry === "evolution" || entry === "test-drive",
        )
      : [];
  } catch {
    return [];
  }
}

function writeSeen(keys: TipKey[], storage: Storage | null): void {
  try {
    (storage ?? window.localStorage).setItem(TIPS_KEY, JSON.stringify(keys));
  } catch {
    // session-only
  }
}
