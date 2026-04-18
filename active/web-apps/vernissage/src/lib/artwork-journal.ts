export const artworkJournalStorageKey = 'vernissage.artwork-journal';

export type ArtworkJournalEntry = {
  note: string;
  updatedAt: string;
};

export type ArtworkJournalState = Record<string, ArtworkJournalEntry>;

export function normalizeArtworkJournalEntry(
  entry: Partial<ArtworkJournalEntry> | null | undefined,
  fallbackTimestamp: string
) {
  const note = typeof entry?.note === 'string' ? entry.note.trim() : '';
  const updatedAt =
    typeof entry?.updatedAt === 'string' && entry.updatedAt.trim()
      ? entry.updatedAt
      : fallbackTimestamp;

  if (!note) {
    return null;
  }

  return {
    note,
    updatedAt
  } satisfies ArtworkJournalEntry;
}

export function parseArtworkJournalState(serialized: string | null | undefined) {
  if (!serialized) {
    return {} satisfies ArtworkJournalState;
  }

  try {
    const parsed = JSON.parse(serialized) as Record<string, Partial<ArtworkJournalEntry>>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} satisfies ArtworkJournalState;
    }

    return Object.entries(parsed).reduce<ArtworkJournalState>((state, [artworkSlug, entry]) => {
      const normalized = normalizeArtworkJournalEntry(entry, '');
      if (normalized) {
        state[artworkSlug] = normalized;
      }
      return state;
    }, {});
  } catch {
    return {} satisfies ArtworkJournalState;
  }
}

export function serializeArtworkJournalState(state: ArtworkJournalState) {
  return JSON.stringify(state);
}

export function updateArtworkJournalState(
  state: ArtworkJournalState,
  artworkSlug: string,
  entry: Partial<ArtworkJournalEntry> | null | undefined,
  fallbackTimestamp: string
) {
  const nextState = { ...state };
  const normalized = normalizeArtworkJournalEntry(entry, fallbackTimestamp);

  if (normalized) {
    nextState[artworkSlug] = normalized;
    return nextState;
  }

  delete nextState[artworkSlug];
  return nextState;
}
