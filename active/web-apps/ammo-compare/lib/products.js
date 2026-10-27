/**
 * The product layer: join product rows onto the cartridge they chamber, derive
 * the same ballistics the cartridge table derives, and validate the catalog.
 *
 * A product row is deliberately thin. It carries only what differs between two
 * boxes of the same cartridge; geometry, silhouette, designer, and legality come
 * from the cartridge it points at. That keeps the two layers from disagreeing:
 * fix a case length once and every product of that cartridge follows.
 */
import { AMMO } from '../data/ammo.js';
import { PRODUCTS, PRODUCT_SCHEMA_VERSION, PACKAGE_SIZES } from '../data/products.js';
import { derive } from './ballistics.js';
import { ballisticProfile } from './trajectory.js';
import { recoilProfile } from './recoil.js';
import { referenceFor } from '../data/dimensions.js';
import { inventorFor } from '../data/inventors.js';
import { restrictionsFor } from './legality.js';

export { PRODUCTS, PRODUCT_SCHEMA_VERSION, PACKAGE_SIZES };

/** Enrichment shared by cartridge rows and product rows. */
function enrich(load) {
  return {
    ...load,
    ...derive(load),
    ...ballisticProfile(load),
    ...recoilProfile(load),
  };
}

const CARTRIDGES = new Map(
  AMMO.map((load) => [
    load.id,
    {
      ...enrich(load),
      designer: inventorFor(load.id),
      reference: referenceFor(load.id),
      restrictions: restrictionsFor(load),
    },
  ]),
);

export function cartridgeFor(id) {
  return CARTRIDGES.get(id) ?? null;
}

/** Products grouped by cartridge id, in catalog order. */
export const PRODUCTS_BY_CARTRIDGE = PRODUCTS.reduce((groups, product) => {
  const list = groups.get(product.cartridge) ?? [];
  list.push(product);
  groups.set(product.cartridge, list);
  return groups;
}, new Map());

export function productsFor(cartridgeId) {
  return PRODUCTS_BY_CARTRIDGE.get(cartridgeId) ?? [];
}

/**
 * A product as a table row: the cartridge's geometry and metadata, the product's
 * identity, and ballistics derived from the product's own bullet weight and
 * velocity where it has one.
 *
 * `velocitySource: 'cartridge'` means the manufacturer's figure was not captured,
 * so the row borrows the cartridge's reference velocity. The UI labels those rows
 * rather than passing the number off as the product's own.
 */
export function productRow(product) {
  const cartridge = cartridgeFor(product.cartridge);
  if (!cartridge) return null;
  const velocityFps = product.velocityFps ?? cartridge.velocityFps;
  const velocitySource = product.velocityFps ? (product.velocitySource ?? 'manufacturer') : 'cartridge';
  const load = {
    ...cartridge,
    id: `product:${product.id}`,
    productId: product.id,
    name: product.line,
    brand: product.brand,
    sku: product.sku ?? null,
    bulletGr: product.bulletGr,
    bulletType: product.bulletType ?? null,
    packageRounds: product.packageRounds,
    pelletLabel: product.pelletLabel ?? null,
    velocityFps,
    velocitySource,
    cartridge,
    cartridgeId: cartridge.id,
    cartridgeName: cartridge.name,
    // A per-round price only exists when a listing was captured. The cartridge's
    // own rough estimate is deliberately not inherited: a product row is a claim
    // about a box, and an estimate is not a listing.
    pricePerRound:
      product.priceUsd != null && product.packageRounds
        ? product.priceUsd / product.packageRounds
        : null,
    costPerRound:
      product.priceUsd != null && product.packageRounds
        ? product.priceUsd / product.packageRounds
        : null,
  };
  return enrich(load);
}

/** Every product as a table row, in catalog order. */
export const PRODUCT_ROWS = PRODUCTS.map(productRow).filter(Boolean);

/** True while the checked-in catalog is the example fixture, not a real export. */
export const CATALOG_IS_FIXTURE = PRODUCTS.every((product) => product.source === 'fixture');

/** Catalog summary for the header and the docs. */
export const CATALOG_STATS = {
  products: PRODUCTS.length,
  cartridges: new Set(PRODUCTS.map((product) => product.cartridge)).size,
  brands: new Set(PRODUCTS.map((product) => product.brand)).size,
  priced: PRODUCTS.filter((product) => product.priceUsd != null).length,
  publishedVelocity: PRODUCTS.filter((product) => product.velocityFps != null).length,
};

/**
 * Validate the catalog. Returns a list of problems; empty means the catalog is
 * internally consistent. `tools/import-products.mjs` and the tests both use this,
 * so a bad import cannot reach the app.
 */
export function validateProducts(products = PRODUCTS) {
  const problems = [];
  const seen = new Set();
  for (const [index, product] of products.entries()) {
    const label = product.id ?? `#${index}`;
    if (!product.id || !/^[a-z0-9-]+$/.test(product.id)) {
      problems.push(`${label}: id must be a lowercase slug`);
    } else if (seen.has(product.id)) {
      problems.push(`${label}: duplicate id`);
    }
    seen.add(product.id);

    if (!product.cartridge || !CARTRIDGES.has(product.cartridge)) {
      problems.push(`${label}: cartridge ${product.cartridge} is not a load id`);
    }
    if (!product.brand) problems.push(`${label}: brand is required`);
    if (!product.line) problems.push(`${label}: line is required`);
    if (!(product.bulletGr > 0)) problems.push(`${label}: bulletGr must be positive`);
    if (!PACKAGE_SIZES.includes(product.packageRounds)) {
      problems.push(`${label}: packageRounds ${product.packageRounds} is not a standard box`);
    }
    if (product.velocityFps != null && !(product.velocityFps > 0)) {
      problems.push(`${label}: velocityFps must be positive when present`);
    }
    if (product.velocityFps != null && product.velocitySource !== 'manufacturer') {
      problems.push(`${label}: a published velocity needs velocitySource: 'manufacturer'`);
    }
    // The rule that matters most: a price is a claim about the market.
    if (product.priceUsd != null) {
      if (!(product.priceUsd > 0)) problems.push(`${label}: priceUsd must be positive`);
      if (!product.priceSource) problems.push(`${label}: a price needs priceSource`);
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(product.priceChecked ?? '')) {
        problems.push(`${label}: a price needs priceChecked as YYYY-MM or YYYY-MM-DD`);
      }
    }
    if (!product.source) problems.push(`${label}: source is required`);
    const cartridge = CARTRIDGES.get(product.cartridge);
    if (cartridge && product.bulletGr > cartridge.bulletGr * 4) {
      problems.push(`${label}: bulletGr ${product.bulletGr} is implausible for ${cartridge.name}`);
    }
  }
  return problems;
}
