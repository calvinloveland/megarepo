/**
 * Product instances: the boxes actually on a shelf.
 *
 * `data/ammo.js` answers "what is this cartridge?". This file answers "which
 * specific loading of it can I buy?", one row per real product line. A product
 * points at a cartridge (`cartridge`), and everything geometric — bullet
 * diameter, case length, silhouette, designer, legality — is inherited from that
 * row. What a product adds is what differs between two boxes of the same
 * cartridge: brand, product line, bullet construction, box size, and price.
 *
 * ## Sourcing rules
 *
 * These are stricter than the cartridge table, because a product row claims
 * something is *for sale*:
 *
 * - `source` is required. It names where the row came from and when it was read.
 *   A manufacturer's published spec sheet and a retailer listing are both fine;
 *   "I remember this one" is not.
 * - `priceUsd` is optional and must never be guessed. When it is present,
 *   `priceSource` and `priceChecked` are required too, so a stale price can be
 *   found and re-read. A product with no price shows a dash and says so.
 * - `velocityFps` is optional. Where the manufacturer publishes it, use it and
 *   set `velocitySource: 'manufacturer'`. Where it is not captured, leave it out
 *   and the row falls back to the cartridge's reference velocity, labelled
 *   `velocitySource: 'cartridge'` — an approximation, shown as such.
 * - `packageRounds` is the box size the price refers to. Prices are stored per
 *   round so two boxes of different sizes compare.
 *
 * ## The checked-in rows are a fixture
 *
 * Every row below carries `source: 'fixture'` and the app shows an "example
 * catalog" notice while that is true. They exist to exercise the schema, the
 * importer, and the view — they are **not** a claim about current prices or
 * availability, and they should be replaced by a real export:
 *
 *   node tools/import-products.mjs catalog.csv --check
 *   node tools/import-products.mjs catalog.csv
 *
 * `tools/import-products.mjs` validates, derives, and writes this file.
 */

export const PRODUCT_SCHEMA_VERSION = 1;

/** Box sizes a price may refer to, so per-round maths stays honest. */
export const PACKAGE_SIZES = [20, 25, 50, 100, 200, 250, 500, 1000];

export const PRODUCTS = [
  {
    id: 'fixture-9mm-hst-124',
    cartridge: '9mm',
    brand: 'Federal',
    line: 'Premium Personal Defense HST',
    sku: 'P9HST1',
    bulletGr: 124,
    bulletType: 'Jacketed hollow point',
    packageRounds: 20,
    velocityFps: 1150,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-9mm-golddot-124',
    cartridge: '9mm',
    brand: 'Speer',
    line: 'Gold Dot Personal Protection',
    sku: '23618',
    bulletGr: 124,
    bulletType: 'Bonded jacketed hollow point',
    packageRounds: 20,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-9mm-critical-defense-115',
    cartridge: '9mm',
    brand: 'Hornady',
    line: 'Critical Defense',
    sku: '90250',
    bulletGr: 115,
    bulletType: 'FlexTip expanding',
    packageRounds: 25,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-9mm-pmc-bronze-115',
    cartridge: '9mm',
    brand: 'PMC',
    line: 'Bronze',
    sku: '9A',
    bulletGr: 115,
    bulletType: 'Full metal jacket',
    packageRounds: 50,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-380-hst-90',
    cartridge: '380acp',
    brand: 'Federal',
    line: 'Premium Personal Defense HST',
    bulletGr: 99,
    bulletType: 'Jacketed hollow point',
    packageRounds: 20,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-380-fmj-95',
    cartridge: '380acp',
    brand: 'Fiocchi',
    line: 'Range Dynamics',
    bulletGr: 95,
    bulletType: 'Full metal jacket',
    packageRounds: 50,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-45acp-golddot-230',
    cartridge: '45acp',
    brand: 'Speer',
    line: 'Gold Dot Personal Protection',
    sku: '23966',
    bulletGr: 230,
    bulletType: 'Bonded jacketed hollow point',
    packageRounds: 20,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-45acp-fmj-230',
    cartridge: '45acp',
    brand: 'Winchester',
    line: 'USA White Box',
    sku: 'USA45AVP',
    bulletGr: 230,
    bulletType: 'Full metal jacket',
    packageRounds: 100,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-223-xtac-55',
    cartridge: '223',
    brand: 'PMC',
    line: 'XTAC',
    sku: '223A',
    bulletGr: 55,
    bulletType: 'Full metal jacket boat tail',
    packageRounds: 20,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-223-gold-medal-77',
    cartridge: '223',
    brand: 'Federal',
    line: 'Gold Medal Match',
    sku: 'GM223M',
    bulletGr: 77,
    bulletType: 'Open tip match',
    packageRounds: 20,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-308-gold-medal-168',
    cartridge: '308',
    brand: 'Federal',
    line: 'Gold Medal Match',
    sku: 'GM308M',
    bulletGr: 168,
    bulletType: 'Open tip match',
    packageRounds: 20,
    velocitySource: 'cartridge',
    source: 'fixture',
  },
  {
    id: 'fixture-12ga-00buck-9pellet',
    cartridge: '12ga-buck',
    brand: 'Federal',
    line: 'Power-Shok',
    bulletGr: 9 * 54,
    bulletType: '00 buckshot, 9 pellets',
    packageRounds: 5,
    pelletLabel: '9 pellets of 00 buck',
    velocitySource: 'cartridge',
    source: 'fixture',
  },
];
