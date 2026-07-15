import { formatAnalysisSnapshot } from './analysis-snapshot.mjs';
import { formatBundleReport } from './bundle-report.mjs';
import { formatReadinessHistory } from './readiness-history.mjs';

/**
 * Comprehensive offline-review artifact that concatenates the current analysis
 * snapshot, the selected bundle report, and the readiness history timeline.
 */
export function formatReportPackage({ url = '', notes = '', dashboard, bundle, reports = {}, history = [] } = {}) {
  return [
    '=== ANALYSIS SNAPSHOT ===',
    formatAnalysisSnapshot({ url, notes, dashboard, bundle, reports }).trimEnd(),
    '',
    '=== BUNDLE REPORT ===',
    bundle ? formatBundleReport(bundle, reports, notes).trimEnd() : '(no bundle selected)',
    '',
    '=== READINESS HISTORY ===',
    formatReadinessHistory(history).trimEnd(),
    '',
  ].join('\n');
}
