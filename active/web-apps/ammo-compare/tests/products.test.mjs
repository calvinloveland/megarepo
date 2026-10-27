/**
 * Product-catalog checks.
 *
 * The product layer makes claims about things for sale, so it has stricter rules
 * than the cartridge table: every row says where it came from, and a price
 * cannot exist without a source and a date. These tests hold the checked-in
 * catalog and the importer to those rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AMMO } from '../data/ammo.js';
import {
  CATALOG_IS_FIXTURE,
  CATALOG_STATS,
  PACKAGE_SIZES,
  PRODUCTS,
  PRODUCT_ROWS,
  productRow,
  productsFor,
  validateProducts,
} from '../lib/products.js';

const cartridgeIds = new Set(AMMO.map((load) => load.id));
const byId = new Map(PRODUCTS.map((product) => [product.id, product]));

test('the checked-in catalog is internally consistent', () => {
  assert.deepEqual(validateProducts(), []);
  assert.ok(PRODUCTS.length > 0, 'expected a catalog');
  for (const product of PRODUCTS) {
    assert.ok(cartridgeIds.has(product.cartridge), `${product.id} points at a missing cartridge`);
    assert.match(product.id, /^[a-z0-9-]+$/, `${product.id} is not a slug`);
    assert.ok(PACKAGE_SIZES.includes(product.packageRounds), `${product.id} box size`);
  }
});

test('a product never invents a price or a velocity', () => {
  for (const product of PRODUCTS) {
    if (product.priceUsd != null) {
      assert.ok(product.priceSource, `${product.id} has a price without a source`);
      assert.match(product.priceChecked ?? '', /^\d{4}-\d{2}/, `${product.id} price needs a date`);
    }
    if (product.velocityFps != null) {
      assert.equal(
        product.velocitySource,
        'manufacturer',
        `${product.id} claims a published velocity without saying so`,
      );
    }
  }
  // The checked-in rows are an example fixture, and they must not pretend to be
  // a market survey: no prices at all until a real export is imported.
  assert.equal(CATALOG_IS_FIXTURE, true, 'fixture catalog should be labelled');
  assert.equal(CATALOG_STATS.priced, 0, 'the fixture must not carry invented prices');
});

test('catalog statistics match the rows', () => {
  assert.equal(CATALOG_STATS.products, PRODUCTS.length);
  assert.equal(CATALOG_STATS.cartridges, new Set(PRODUCTS.map((p) => p.cartridge)).size);
  assert.equal(CATALOG_STATS.brands, new Set(PRODUCTS.map((p) => p.brand)).size);
  assert.equal(CATALOG_STATS.publishedVelocity, PRODUCTS.filter((p) => p.velocityFps != null).length);
  assert.equal(PRODUCT_ROWS.length, PRODUCTS.length, 'every product should resolve to a row');
});

test('a product row inherits the cartridge it chambers', () => {
  const row = productRow(byId.get('fixture-9mm-hst-124'));
  const cartridge = AMMO.find((load) => load.id === '9mm');
  assert.equal(row.cartridgeName, cartridge.name);
  assert.equal(row.category, cartridge.category);
  assert.equal(row.diameterIn, cartridge.diameterIn);
  assert.equal(row.caseLengthMm, cartridge.caseLengthMm);
  assert.equal(row.designer.name, 'Georg Luger');
  // Geometry-derived drawing inputs are present, so the silhouette works.
  assert.ok(row.diameterIn > 0 && row.bulletGr > 0);
  assert.ok(Array.isArray(row.restrictions), 'restrictions are inherited too');
});

test('ballistics come from the product where it has its own numbers', () => {
  const inherited = productRow(byId.get('fixture-9mm-hst-124'));
  assert.equal(inherited.velocitySource, 'cartridge');
  assert.equal(inherited.velocityFps, AMMO.find((load) => load.id === '9mm').velocityFps);

  const published = productRow({
    id: 'test-9mm-hot',
    cartridge: '9mm',
    brand: 'Test',
    line: 'Hot load',
    bulletGr: 124,
    packageRounds: 20,
    velocityFps: 1300,
    source: 'test',
  });
  assert.equal(published.velocitySource, 'manufacturer');
  assert.ok(published.energyFtLb > inherited.energyFtLb, 'faster load should carry more energy');
  assert.ok(published.recoilFtLb > inherited.recoilFtLb, 'and kick harder');
});

test('price is per round, and only when a listing was captured', () => {
  const unpriced = productRow(byId.get('fixture-9mm-hst-124'));
  assert.equal(unpriced.pricePerRound, null);
  assert.equal(unpriced.costPerRound, null, 'the cartridge estimate must not leak into a product');

  const priced = productRow({
    id: 'test-9mm-priced',
    cartridge: '9mm',
    brand: 'Test',
    line: 'Priced box',
    bulletGr: 115,
    packageRounds: 50,
    priceUsd: 20,
    priceSource: 'test export',
    priceChecked: '2026-10',
    source: 'test',
  });
  assert.equal(priced.pricePerRound, 0.4);
  assert.equal(priced.costPerRound, 0.4);
});

test('products are grouped by cartridge for the cartridge view', () => {
  const nine = productsFor('9mm');
  assert.ok(nine.length >= 3, 'the fixture should show several 9mm products');
  assert.ok(nine.every((product) => product.cartridge === '9mm'));
  assert.deepEqual(productsFor('not-a-cartridge'), []);
});

test('the importer rejects a catalog that breaks the sourcing rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ammo-products-'));
  const bad = join(dir, 'bad.csv');
  writeFileSync(
    bad,
    'id,cartridge,brand,line,bulletGr,packageRounds,priceUsd,source\n' +
      'bad-1,9mm,Test,Price with no source,124,20,22.5,fixture\n',
  );
  let failed = false;
  try {
    execFileSync(process.execPath, ['tools/import-products.mjs', bad, '--dry-run'], {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: 'pipe',
    });
  } catch (error) {
    failed = true;
    assert.match(String(error.stderr), /a price needs priceSource/);
  }
  assert.ok(failed, 'a price without a source must be rejected');
});

test('the importer accepts a well-formed export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ammo-products-'));
  const good = join(dir, 'good.csv');
  writeFileSync(
    good,
    'id,cartridge,brand,line,sku,bulletGr,packageRounds,priceUsd,priceSource,priceChecked,source\n' +
      'good-1,9mm,Test,Sample box,SKU1,124,50,22.5,"sample export",2026-10,fixture\n',
  );
  const output = execFileSync(
    process.execPath,
    ['tools/import-products.mjs', good, '--dry-run'],
    { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: 'pipe' },
  );
  assert.equal(output, '');
});

test('a catalog round-trips through the importer unchanged', () => {
  // Export the checked-in catalog, then ask the importer whether its own output
  // matches the file. This is the drift guard for the product layer.
  const dir = mkdtempSync(join(tmpdir(), 'ammo-products-'));
  const exportPath = join(dir, 'catalog.json');
  writeFileSync(exportPath, JSON.stringify({ products: PRODUCTS }, null, 2));
  const root = new URL('..', import.meta.url).pathname;
  const check = execFileSync(
    process.execPath,
    ['tools/import-products.mjs', exportPath, '--check'],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  );
  assert.equal(check, '');
});
