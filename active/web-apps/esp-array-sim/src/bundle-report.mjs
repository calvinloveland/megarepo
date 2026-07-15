const TITLES = Object.freeze({
  compare: 'Mode comparison',
  sizing: 'Hardware sizing',
  bench: 'Calibration latency',
  noise: 'Noise sensitivity',
  nodeScan: 'Node-count sensitivity',
});

/**
 * Build one combined plain-text artifact from the currently-populated analysis
 * reports for a selected bundle. Missing sections are noted explicitly rather
 * than silently skipped so the export is self-describing.
 *
 * @param {{id:string,label:string,analyses:string[]}} bundle
 * @param {{compare?:string,sizing?:string,bench?:string,noise?:string,nodeScan?:string}} reports
 * @returns {string}
 */
export function formatBundleReport(bundle, reports = {}) {
  const lines = [
    `ESP Array Simulator — ${bundle.label}`,
    `bundle id: ${bundle.id}`,
    '',
  ];
  for (const key of bundle.analyses) {
    lines.push(`## ${TITLES[key] ?? key}`);
    lines.push(reports[key] || '(not run)');
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
