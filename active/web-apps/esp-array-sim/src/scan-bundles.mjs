export const SCAN_BUNDLES = Object.freeze([
  {
    id: 'quick',
    label: 'Quick characterize',
    analyses: ['compare', 'sizing', 'noise'],
  },
  {
    id: 'full',
    label: 'Full characterize',
    analyses: ['compare', 'sizing', 'bench', 'noise', 'nodeScan'],
  },
]);

export function getScanBundle(id) {
  return SCAN_BUNDLES.find((b) => b.id === id) ?? SCAN_BUNDLES[0];
}
