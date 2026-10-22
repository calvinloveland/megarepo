/**
 * Cartridge silhouettes, drawn from the stored load data.
 *
 * There is no per-cartridge artwork: each profile is derived from the case
 * length, bullet diameter, and bullet weight, using mass and lead density to
 * estimate how long the projectile is. That keeps 295 drawings consistent with
 * the numbers in the row, and means a corrected dimension fixes its silhouette.
 *
 * These are schematics, not engineering drawings. Case base diameter and bullet
 * ogive are approximated (the source table does not publish base diameter).
 * Sizes use a compressed scale (length^0.55) so a 2 mm Kolibri stays visible next
 * to a 14.5×114mm; aspect ratios are preserved, absolute size is not.
 */
import { GRAINS_TO_GRAMS } from './ballistics.js';

const LEAD_DENSITY_G_MM3 = 0.01134;
/** Width of the shared coordinate space; every silhouette lives in this box. */
const VIEW_WIDTH = 160;
/** < 1 compresses the size range; 0 would make every drawing the same length. */
const SCALE_EXPONENT = 0.55;

/** Fallbacks for rows whose name and metadata do not pin a dimension down. */
const CATEGORY_DEFAULTS = {
  rimfire: { bulletMm: 5.7, caseMm: 15 },
  pistol: { bulletMm: 9.0, caseMm: 21 },
  rifle: { bulletMm: 7.8, caseMm: 51 },
  shotgun: { bulletMm: 18.5, caseMm: 70 },
};

/** Shape factor: how fully the bullet fills its bounding cylinder. */
const BULLET_FILL = { rimfire: 0.78, pistol: 0.78, rifle: 0.62, shotgun: 0.7 };

function fromName(name) {
  const match = String(name).match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const bulletMm = Number(match[1]);
  const caseMm = Number(match[2]);
  if (!(bulletMm > 1 && bulletMm < 32 && caseMm > 4 && caseMm < 130)) return null;
  return { bulletMm, caseMm };
}

function bulletDiameterMm(load) {
  if (load.diameterIn > 0) return load.diameterIn * 25.4;
  const parsed = fromName(load.name);
  return parsed?.bulletMm ?? (CATEGORY_DEFAULTS[load.category] ?? CATEGORY_DEFAULTS.rifle).bulletMm;
}

function caseLengthMm(load) {
  if (load.caseLengthMm > 0) return load.caseLengthMm;
  const parsed = fromName(load.name);
  return parsed?.caseMm ?? (CATEGORY_DEFAULTS[load.category] ?? CATEGORY_DEFAULTS.rifle).caseMm;
}

/**
 * Necked-down rifle cartridges have a much wider base than bullet. The source
 * data has no base diameter, so infer "bottleneck" from the case proportions
 * and velocity, which separates .223/7.62×39 from .45-70/.450 Bushmaster.
 */
function isBottleneck(load, bulletMm, caseMm) {
  return (
    load.category === 'rifle' &&
    load.velocityFps >= 2000 &&
    caseMm / bulletMm >= 3.2 &&
    bulletMm < 9.2
  );
}

function isRimmed(load) {
  return /(rimmed|\bR\b|R$|Rimfire)/i.test(load.name) || load.category === 'rimfire';
}

/**
 * Approximate profile geometry in millimetres. Exported so tests can assert the
 * drawing tracks the data without parsing path strings.
 */
export function cartridgeGeometry(load) {
  const category = load.category in CATEGORY_DEFAULTS ? load.category : 'rifle';
  const bulletMm = bulletDiameterMm(load);
  const caseMm = caseLengthMm(load);
  const bottleneck = isBottleneck(load, bulletMm, caseMm);

  const baseMm = bottleneck
    ? Math.max(bulletMm * 1.55, bulletMm + 2)
    : bulletMm + (category === 'rimfire' ? 0.2 : category === 'shotgun' ? 1.6 : 1.0);

  const rimMm = baseMm + (isRimmed(load) ? 1.0 : 0.5);
  const rimThickness = Math.max(0.9, baseMm * 0.06);
  const groove = 0.8;
  const bodyRadius = baseMm / 2;
  const grooveRadius = Math.max(bodyRadius - 0.35, 0.5);
  const neckRadius = bottleneck ? (bulletMm + 0.25) / 2 : bodyRadius;
  const shoulderLength = bottleneck ? Math.max(caseMm * 0.1, 1.6) : 0;
  const neckLength = bottleneck ? Math.max(bulletMm * 0.8, 3) : 0;
  const shoulderX = caseMm - neckLength - shoulderLength;

  // Bullet length from its mass: a cylinder of lead of the same volume,
  // stretched by the shape factor because an ogive fills less of its box.
  const massG = load.bulletGr * GRAINS_TO_GRAMS;
  const areaMm2 = Math.PI * (bulletMm / 2) ** 2;
  const fill = BULLET_FILL[category] ?? BULLET_FILL.rifle;
  const bulletLength = Math.min((massG / LEAD_DENSITY_G_MM3) / (areaMm2 * fill), caseMm * 1.4);

  // Shotgun shells contain their payload: nothing protrudes from the hull.
  const exposed = category === 'shotgun' ? 0 : bulletLength * 0.85;
  const totalLength = caseMm + exposed;
  const maxRadius = Math.max(rimMm / 2, bodyRadius, bulletMm / 2) + 0.2;

  return {
    category,
    bulletMm,
    caseMm,
    bottleneck,
    baseMm,
    rimMm,
    rimThickness,
    groove,
    bodyRadius,
    grooveRadius,
    neckRadius,
    shoulderLength,
    neckLength,
    shoulderX,
    bulletLength,
    exposed,
    totalLength,
    maxRadius,
  };
}

/** Compressed but proportion-preserving scale for one cartridge. */
function scaleFor(totalLength, maxLength) {
  if (!(maxLength > 0) || !(totalLength > 0)) return 1;
  const drawn = VIEW_WIDTH * (totalLength / maxLength) ** SCALE_EXPONENT;
  return drawn / totalLength;
}

/** Shared bounds so every silhouette is drawn in the same coordinate box. */
export function cartridgeExtents(loads) {
  const geometries = loads.map(cartridgeGeometry);
  const maxLength = Math.max(...geometries.map((g) => g.totalLength));
  let radius = 0;
  for (const g of geometries) {
    radius = Math.max(radius, g.maxRadius * scaleFor(g.totalLength, maxLength));
  }
  return { length: VIEW_WIDTH, maxLength, radius };
}

const num = (n) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);

function casePath(g) {
  const {
    rimThickness, groove, bodyRadius, grooveRadius, neckRadius,
    shoulderX, shoulderLength, caseMm,
  } = g;
  const x1 = rimThickness;
  const x2 = rimThickness + groove;
  const x3 = shoulderX;
  const x4 = shoulderX + shoulderLength;
  return [
    `M${num(x1)},${num(-g.rimMm / 2)}`,
    `L${num(x1)},${num(-grooveRadius)}`,
    `L${num(x2)},${num(-grooveRadius)}`,
    `L${num(x2)},${num(-bodyRadius)}`,
    `L${num(x3)},${num(-bodyRadius)}`,
    `L${num(x4)},${num(-neckRadius)}`,
    `L${num(caseMm)},${num(-neckRadius)}`,
    `L${num(caseMm)},${num(neckRadius)}`,
    `L${num(x4)},${num(neckRadius)}`,
    `L${num(x3)},${num(bodyRadius)}`,
    `L${num(x2)},${num(bodyRadius)}`,
    `L${num(x2)},${num(grooveRadius)}`,
    `L${num(x1)},${num(grooveRadius)}`,
    `L${num(x1)},${num(g.rimMm / 2)}`,
    'Z',
  ].join(' ');
}

function bulletPath(g) {
  const r = g.bulletMm / 2;
  const seat = Math.min(3, g.caseMm * 0.12);
  const x0 = g.caseMm - seat;
  const mouth = g.caseMm;
  const tip = mouth + g.exposed;
  const e = g.exposed;
  const roundNose = g.category === 'pistol' || g.category === 'rimfire';

  if (roundNose) {
    const cap = Math.min(r, e);
    const shoulder = tip - cap;
    return [
      `M${num(x0)},${num(-r)}`,
      `L${num(shoulder)},${num(-r)}`,
      `A${num(r)},${num(r)} 0 0 1 ${num(tip)},0`,
      `A${num(r)},${num(r)} 0 0 1 ${num(shoulder)},${num(r)}`,
      `L${num(x0)},${num(r)}`,
      'Z',
    ].join(' ');
  }

  // Spitzer ogive: straight bearing surface, then a long curve to the tip.
  const ogive = Math.max(mouth, tip - e * 0.58);
  return [
    `M${num(x0)},${num(-r)}`,
    `L${num(ogive)},${num(-r)}`,
    `C${num(ogive + e * 0.3)},${num(-r)} ${num(tip - e * 0.1)},${num(-r * 0.74)} ${num(tip)},0`,
    `C${num(tip - e * 0.1)},${num(r * 0.74)} ${num(ogive + e * 0.3)},${num(r)} ${num(ogive)},${num(r)}`,
    `L${num(x0)},${num(r)}`,
    'Z',
  ].join(' ');
}

function hullMarkup(g) {
  const r = g.bulletMm / 2;
  const head = Math.min(8, g.caseMm * 0.18);
  const crimp = Math.min(3, g.caseMm * 0.09);
  const hull = [
    `M0,${num(-r)}`,
    `L${num(g.caseMm - crimp)},${num(-r)}`,
    `Q${num(g.caseMm)},${num(-r * 0.9)} ${num(g.caseMm)},0`,
    `Q${num(g.caseMm)},${num(r * 0.9)} ${num(g.caseMm - crimp)},${num(r)}`,
    'L0,' + num(r),
    'Z',
  ].join(' ');
  return `
    <path class="cart-hull" d="${hull}"/>
    <rect class="cart-head" x="0" y="${num(-r - 0.4)}" width="${num(head)}" height="${num(r * 2 + 0.8)}" rx="0.3"/>`;
}

/**
 * One inline SVG. `extents` comes from `cartridgeExtents` over the whole
 * dataset, so every drawing shares one coordinate box.
 */
export function cartridgeSvg(load, extents) {
  const g = cartridgeGeometry(load);
  const pad = 0.8;
  const width = extents.length + pad + 2.6;
  const height = extents.radius * 2 + pad * 2;
  const centerY = pad + extents.radius;
  const scale = scaleFor(g.totalLength, extents.maxLength ?? extents.length);

  const body =
    g.category === 'shotgun'
      ? hullMarkup(g)
      : `
    <path class="cart-bullet" d="${bulletPath(g)}"/>
    <rect class="cart-rim" x="0" y="${num(-g.rimMm / 2)}" width="${num(g.rimThickness)}" height="${num(g.rimMm)}" rx="0.25"/>
    <path class="cart-case" d="${casePath(g)}"/>`;

  return `<svg class="cart" viewBox="0 0 ${num(width)} ${num(height)}" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false"><g transform="translate(${num(pad)} ${num(centerY)}) scale(${num(scale)})">${body}
    </g></svg>`;
}
