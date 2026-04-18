'use client';

import { useEffect, useMemo, useState } from 'react';

import { artworkJournalStorageKey, parseArtworkJournalState, serializeArtworkJournalState, updateArtworkJournalState, type ArtworkJournalEntry } from '@/src/lib/artwork-journal';

type ArtworkQuickActionsProps = {
  artworkSlug: string;
  artworkTitle: string;
};

type ArtworkQuickActionStatus = {
  tone: 'success' | 'error';
  text: string;
};

function summaryFor(entry: ArtworkJournalEntry | null) {
  return entry?.note ? 'Private note saved' : '';
}

function loadJournalState() {
  return parseArtworkJournalState(window.localStorage.getItem(artworkJournalStorageKey));
}

function persistJournalState(state: Record<string, ArtworkJournalEntry>) {
  if (Object.keys(state).length === 0) {
    window.localStorage.removeItem(artworkJournalStorageKey);
    return;
  }

  window.localStorage.setItem(artworkJournalStorageKey, serializeArtworkJournalState(state));
}

export function ArtworkQuickActions({ artworkSlug, artworkTitle }: ArtworkQuickActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [entry, setEntry] = useState<ArtworkJournalEntry | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [status, setStatus] = useState<ArtworkQuickActionStatus | null>(null);

  useEffect(() => {
    try {
      const savedEntry = loadJournalState()[artworkSlug] ?? null;
      setEntry(savedEntry);
      setNoteDraft(savedEntry?.note ?? '');
    } catch {
      setStatus({
        tone: 'error',
        text: 'This browser blocked local saves, so favorites and notes are unavailable here.'
      });
    }
  }, [artworkSlug]);

  const summary = useMemo(() => summaryFor(entry), [entry]);

  function commitEntry(nextEntry: Partial<ArtworkJournalEntry> | null | undefined, message: string) {
    try {
      const timestamp = new Date().toISOString();
      const nextState = updateArtworkJournalState(loadJournalState(), artworkSlug, nextEntry, timestamp);
      persistJournalState(nextState);

      const savedEntry = nextState[artworkSlug] ?? null;
      setEntry(savedEntry);
      setNoteDraft(savedEntry?.note ?? '');
      setStatus({
        tone: 'success',
        text: message
      });
    } catch {
      setStatus({
        tone: 'error',
        text: 'Vernissage could not save that update locally on this device.'
      });
    }
  }

  const hasSavedNote = Boolean(entry?.note);
  const hasDraftNote = Boolean(noteDraft.trim());

  return (
    <section className="artwork-quick-actions" aria-label="Artwork quick actions">
      <div className="artwork-quick-actions__header">
        <button
          type="button"
          className={`artwork-quick-actions__toggle${summary ? ' is-active' : ''}`}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="artwork-quick-actions__plus" aria-hidden="true">
            +
          </span>
          <span>{summary ? 'Saved piece' : 'Save this piece'}</span>
        </button>
        {summary ? <p className="meta-note artwork-quick-actions__summary">{summary}</p> : null}
      </div>

      {isOpen ? (
        <div className="artwork-quick-actions__panel">
          <p className="eyebrow">Personal notebook</p>
          <h2>Keep a private note</h2>
          <p className="artwork-quick-actions__copy">
            Jot a private note that stays on this device for now. Public favorite artworks now live on
            member pages instead of inside browser-only quick saves.
          </p>

          <form
            className="artwork-quick-actions__form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmedNote = noteDraft.trim();
              commitEntry(
                {
                  note: trimmedNote
                },
                trimmedNote
                  ? `Your note for ${artworkTitle} was saved on this device.`
                  : `Your saved note for ${artworkTitle} was cleared.`
              );
            }}
          >
            <label className="ornate-field">
              <span className="ornate-field__label">Jot a note</span>
              <textarea
                className="ornate-field__control ornate-field__control--textarea artwork-quick-actions__textarea"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="What detail, color shift, or mood keeps returning to you?"
              />
              <span className="ornate-field__hint">Private to this browser for now.</span>
            </label>
            <div className="button-row">
              <button type="submit" className="enamel-button enamel-button--primary">
                {hasSavedNote || hasDraftNote ? 'Save note' : 'Add note'}
              </button>
              {(hasSavedNote || hasDraftNote) ? (
                <button
                  type="button"
                  className="enamel-button enamel-button--secondary"
                  onClick={() =>
                    commitEntry(
                      {
                        note: ''
                      },
                      `Your saved note for ${artworkTitle} was cleared.`
                    )
                  }
                >
                  Clear note
                </button>
              ) : null}
            </div>
          </form>

          {status ? (
            <p className={`artwork-quick-actions__status artwork-quick-actions__status--${status.tone}`}>
              {status.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
