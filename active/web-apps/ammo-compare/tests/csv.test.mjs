/**
 * CSV export checks. The export has to say the same thing the table says, so the
 * tests work on the same enriched rows the app builds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { derive } from '../lib/ballistics.js';
import { ballisticProfile } from '../lib/trajectory.js';
import { recoilProfile } from '../lib/recoil.js';
import { PRODUCTS, productRow } from '../lib/products.js';
import {
  CARTRIDGE_COLUMNS,
  PRODUCT_COLUMNS,
  cartridgeCsv,
  csvCell,
  csvFilename,
  productCsv,
  toCsv,
} from '../lib/csv.js';

const ROWS = AMMO.map((load) => ({
  ...load,
  ...derive(load),
  ...ballisticProfile(load),
  ...recoilProfile(load),
}));
const PRODUCT_ROWS = PRODUCTS.map(productRow);
const lines = (csv) => csv.split('\n');

/** Minimal RFC 4180 reader, so a quoted comma is one cell and not two. */
function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quoted) {
      if (character === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      cells.push(cell);
      cell = '';
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

test('cells are quoted only when they need to be', () => {
  assert.equal(csvCell('9mm Luger'), '9mm Luger');
  assert.equal(csvCell('00 buckshot, 9 pellets'), '"00 buckshot, 9 pellets"');
  assert.equal(csvCell('He said "no"'), '"He said ""no"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('headers carry their unit so a spreadsheet explains itself', () => {
  const imperial = lines(cartridgeCsv(ROWS.slice(0, 1), 'imperial'))[0];
  const metric = lines(cartridgeCsv(ROWS.slice(0, 1), 'metric'))[0];
  assert.match(imperial, /Energy \(ft·lb\)/);
  assert.match(imperial, /Velocity \(fps\)/);
  assert.match(metric, /Energy \(J\)/);
  assert.match(metric, /Velocity \(m\/s\)/);
  assert.match(imperial, /Cartridge,Category,Nation,Introduced,Designer/);
});

test('every cartridge becomes one row with the same column count', () => {
  const csv = cartridgeCsv(ROWS, 'imperial');
  const [header, ...body] = lines(csv);
  assert.equal(body.length, ROWS.length);
  const columns = parseCsvLine(header).length;
  for (const line of body) {
    assert.equal(parseCsvLine(line).length, columns, `ragged row: ${line}`);
  }
  assert.equal(columns, CARTRIDGE_COLUMNS.length);
});

test('metric cells convert rather than relabel', () => {
  const nine = ROWS.find((row) => row.id === '9mm');
  const imperial = parseCsvLine(lines(toCsv([nine], CARTRIDGE_COLUMNS, 'imperial'))[1]);
  const metric = parseCsvLine(lines(toCsv([nine], CARTRIDGE_COLUMNS, 'metric'))[1]);
  const column = (label) => CARTRIDGE_COLUMNS.findIndex((entry) => entry.label === label);
  assert.equal(imperial[column('Velocity')], '1150');
  assert.equal(metric[column('Velocity')], '351');
  assert.equal(imperial[column('Energy')], '364');
  assert.equal(metric[column('Energy')], '494');
  // Grams and joules for the same load, not the imperial numbers relabelled.
  assert.equal(imperial[column('Bullet')], '124');
  assert.equal(metric[column('Bullet')], '8.04');
});

test('a missing price is an empty cell, not a zero', () => {
  const unpriced = ROWS.find((row) => row.costPerRound == null);
  const csv = cartridgeCsv([unpriced], 'imperial');
  const cells = parseCsvLine(lines(csv)[1]);
  const index = CARTRIDGE_COLUMNS.findIndex((column) => column.label === 'Cost per round');
  assert.equal(cells[index], '');
});

test('products export their own columns, including provenance', () => {
  const csv = productCsv(PRODUCT_ROWS, 'imperial');
  const [header, ...body] = lines(csv);
  assert.match(header, /Brand,Line,SKU,Cartridge/);
  assert.match(header, /Price per round \(USD\),Price source,Price checked,Source/);
  assert.equal(body.length, PRODUCT_ROWS.length);
  assert.equal(parseCsvLine(header).length, PRODUCT_COLUMNS.length);
  // A fixture row has no price, so those cells stay empty and the source shows.
  const first = body[0];
  assert.match(first, /fixture$/);
  const cells = parseCsvLine(first);
  const price = PRODUCT_COLUMNS.findIndex((column) => column.label === 'Price per round');
  assert.equal(cells[price], '');
});

test('the filename names the view and the units', () => {
  assert.equal(csvFilename('cartridges', 'imperial'), 'ammo-compare-cartridges-imperial.csv');
  assert.equal(csvFilename('products', 'metric'), 'ammo-compare-products-metric.csv');
});

test('a row containing a comma survives the round trip', () => {
  const shotgun = PRODUCT_ROWS.find((row) => row.bulletType?.includes(','));
  assert.ok(shotgun, 'expected a product with a comma in its bullet type');
  const csv = productCsv([shotgun], 'imperial');
  const line = lines(csv)[1];
  assert.match(line, /"00 buckshot, 9 pellets"/);
});
