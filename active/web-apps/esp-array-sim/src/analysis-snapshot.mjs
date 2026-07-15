import { formatBundleReport } from './bundle-report.mjs';

/**
 * Combined handoff artifact for future firmware work: current share URL,
 * scenario notes, dashboard readiness, and the selected bundle's reports.
 */
export function formatAnalysisSnapshot({ url = '', notes = '', dashboard, bundle, reports = {} } = {}) {
  const lines = ['ESP Array Simulator — Analysis snapshot', ''];
  if (url) lines.push(`share url: ${url}`);
  if (notes?.trim()) lines.push(`scenario notes: ${notes.trim()}`);
  if (dashboard) {
    lines.push(`readiness: ${dashboard.badge.label}`);
    for (const line of dashboard.lines) lines.push(`- ${line.text}`);
  }
  lines.push('');
  if (bundle) lines.push(formatBundleReport(bundle, reports, notes));
  return lines.join('\n').trimEnd() + '\n';
}
