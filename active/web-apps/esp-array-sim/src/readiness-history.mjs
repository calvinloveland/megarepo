/** Build one session-local readiness history entry from a dashboard summary. */
export function makeReadinessHistoryEntry(source, summary, stamp = '') {
  return {
    source,
    stamp,
    badge: summary.badge,
    lines: summary.lines.map((line) => line.text),
  };
}

/** Newest-first bounded history list. */
export function pushReadinessHistory(history, entry, limit = 12) {
  return [entry, ...history].slice(0, limit);
}
