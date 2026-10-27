/**
 * CSV export.
 *
 * The export is built from the same enriched rows the table renders, and from
 * the same unit system the reader has selected, so the download cannot disagree
 * with what is on screen. Headers carry their unit — `Energy (ft·lb)` — because a
 * spreadsheet has no column picker to explain itself.
 *
 * Two shapes: one row per cartridge, or one row per product line. Missing values
 * are empty cells, never a zero: an unpriced box and a free one are different
 * claims.
 */
import { YD_TO_M } from './trajectory.js';

/** RFC 4180 quoting: quote when the value contains a comma, quote, or newline. */
export function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialise rows with a column definition list.
 * A column is `{ label, unit, value }`, where `unit` is a per-system pair or a
 * single string and `value` reads the enriched row.
 */
export function toCsv(rows, columns, units = 'imperial') {
  const header = columns.map((column) => {
    const unit = typeof column.unit === 'string' ? column.unit : column.unit?.[units];
    return unit ? `${column.label} (${unit})` : column.label;
  });
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row, units))).join(','));
  }
  return lines.join('\n');
}

// A missing or non-finite value is an empty cell, never "NaN" in a spreadsheet.
const round = (value, digits) =>
  value == null || !Number.isFinite(value) ? '' : Number(value).toFixed(digits);
const int = (value) => (value == null || !Number.isFinite(value) ? '' : Math.round(value));

/** Columns for the cartridge view: what the table shows, plus the history. */
export const CARTRIDGE_COLUMNS = [
  { label: 'Cartridge', value: (row) => row.name },
  { label: 'Category', value: (row) => row.category },
  { label: 'Nation', value: (row) => row.nation },
  { label: 'Introduced', value: (row) => row.introduced },
  { label: 'Designer', value: (row) => row.designer?.name },
  {
    label: 'Bullet',
    unit: { imperial: 'gr', metric: 'g' },
    value: (row, units) =>
      units === 'metric' ? round(row.bulletGrams, 2) : int(row.bulletGr),
  },
  {
    label: 'Velocity',
    unit: { imperial: 'fps', metric: 'm/s' },
    value: (row, units) =>
      units === 'metric' ? int(row.velocityMps) : int(row.velocityFps),
  },
  {
    label: 'Energy',
    unit: { imperial: 'ft·lb', metric: 'J' },
    value: (row, units) =>
      units === 'metric' ? int(row.energyJoules) : int(row.energyFtLb),
  },
  {
    label: 'Effective range',
    unit: { imperial: 'yd', metric: 'm' },
    value: (row, units) =>
      int(units === 'metric' ? row.effectiveRangeYd * YD_TO_M : row.effectiveRangeYd),
  },
  {
    label: 'Power factor',
    unit: { imperial: 'gr·fps/1000', metric: 'kg·m/s' },
    value: (row, units) =>
      units === 'metric'
        ? round((row.bulletGrams / 1000) * row.velocityMps, 2)
        : int(row.powerFactor),
  },
  {
    label: 'Recoil',
    unit: { imperial: 'ft·lb', metric: 'J' },
    value: (row, units) =>
      units === 'metric' ? round(row.recoilJoules, 1) : round(row.recoilFtLb, 2),
  },
  { label: 'Cost per round', unit: 'USD', value: (row) => round(row.costPerRound, 2) },
  { label: 'Typical use', value: (row) => row.use },
  { label: 'Listings', value: (row) => row.listingCount ?? '' },
];

/** Columns for the product view: the box, its price, and where it came from. */
export const PRODUCT_COLUMNS = [
  { label: 'Brand', value: (row) => row.brand },
  { label: 'Line', value: (row) => row.line },
  { label: 'SKU', value: (row) => row.sku },
  { label: 'Cartridge', value: (row) => row.cartridgeName },
  {
    label: 'Bullet',
    unit: { imperial: 'gr', metric: 'g' },
    value: (row, units) =>
      units === 'metric' ? round(row.bulletGrams, 2) : int(row.bulletGr),
  },
  { label: 'Bullet type', value: (row) => row.bulletType },
  { label: 'Box rounds', value: (row) => row.packageRounds },
  {
    label: 'Velocity',
    unit: { imperial: 'fps', metric: 'm/s' },
    value: (row, units) =>
      units === 'metric' ? int(row.velocityMps) : int(row.velocityFps),
  },
  { label: 'Velocity source', value: (row) => row.velocitySource },
  {
    label: 'Energy',
    unit: { imperial: 'ft·lb', metric: 'J' },
    value: (row, units) =>
      units === 'metric' ? int(row.energyJoules) : int(row.energyFtLb),
  },
  {
    label: 'Recoil',
    unit: { imperial: 'ft·lb', metric: 'J' },
    value: (row, units) =>
      units === 'metric' ? round(row.recoilJoules, 1) : round(row.recoilFtLb, 2),
  },
  { label: 'Price per round', unit: 'USD', value: (row) => round(row.pricePerRound, 4) },
  { label: 'Price source', value: (row) => row.priceSource },
  { label: 'Price checked', value: (row) => row.priceChecked },
  { label: 'Source', value: (row) => row.productSource },
];

export function cartridgeCsv(rows, units) {
  return toCsv(rows, CARTRIDGE_COLUMNS, units);
}

export function productCsv(rows, units) {
  return toCsv(rows, PRODUCT_COLUMNS, units);
}

export function csvFilename(view, units) {
  return `ammo-compare-${view}-${units}.csv`;
}
