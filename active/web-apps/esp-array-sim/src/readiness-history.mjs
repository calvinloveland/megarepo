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

/** Plain-text export of the session-local readiness timeline. */
export function formatReadinessHistory(history = []) {
  if (!history.length) return 'ESP Array Simulator — Readiness history\n\n(no history)\n';
  const lines = ['ESP Array Simulator — Readiness history', ''];
  for (const entry of history) {
    lines.push(`[${entry.stamp}] ${entry.badge.label} — ${entry.source}`);
    for (const line of entry.lines) lines.push(`- ${line}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
