/**
 * Physical constants and unit conversions.
 *
 * Stored cartridge values use the units shooters actually quote: grains for
 * bullet mass, feet per second for velocity, inches for geometry, and psi for
 * pressure. Everything shown in metric is converted here, never transcribed, so
 * there is exactly one place a conversion factor can live.
 */

export const GRAINS_PER_POUND = 7000;
export const STANDARD_GRAVITY = 32.1740486;

export const GRAINS_TO_GRAMS = 0.06479891;
export const GRAMS_TO_GRAINS = 1 / GRAINS_TO_GRAMS;
export const FPS_TO_MPS = 0.3048;
export const MPS_TO_FPS = 1 / FPS_TO_MPS;
export const INCHES_TO_MM = 25.4;
export const MM_TO_INCHES = 1 / INCHES_TO_MM;
export const FT_LB_TO_JOULES = 1.3558179483314004;
export const JOULES_TO_FT_LB = 1 / FT_LB_TO_JOULES;
export const PSI_TO_MPA = 0.006894757293168361;
export const MPA_TO_PSI = 1 / PSI_TO_MPA;
export const POUNDS_TO_KG = 0.45359237;
export const KG_TO_POUNDS = 1 / POUNDS_TO_KG;

/**
 * The constant in E(ft·lb) = gr · fps² / 450437.
 * 450437 = 2 · 7000 · 32.174, folding grains-per-pound and gravity into one
 * divisor so the stored inputs can stay in their natural units.
 */
export const ENERGY_DIVISOR = 2 * GRAINS_PER_POUND * STANDARD_GRAVITY;

/** Muzzle energy in foot-pounds from grains and feet per second. */
export function energyFtLb(bulletGr, velocityFps) {
  return (bulletGr * velocityFps * velocityFps) / ENERGY_DIVISOR;
}

/** Momentum figure used by action shooting: grains × fps / 1000. */
export function powerFactor(bulletGr, velocityFps) {
  return (bulletGr * velocityFps) / 1000;
}

/** Sectional density: mass in pounds divided by the square of bore diameter. */
export function sectionalDensity(bulletGr, bulletDiaIn) {
  return bulletGr / GRAINS_PER_POUND / (bulletDiaIn * bulletDiaIn);
}

/** Decimal places per unit system, used by the table and the CSV export. */
export const DIGITS = {
  mass: { imperial: 0, metric: 2 },
  velocity: { imperial: 0, metric: 1 },
  length: { imperial: 3, metric: 2 },
  energy: { imperial: 0, metric: 0 },
  pressure: { imperial: 0, metric: 1 },
  index: { imperial: 3, metric: 3 },
  money: { imperial: 2, metric: 2 },
  integer: { imperial: 0, metric: 0 },
};

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const fmtFixed = (n, digits) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtCost = (n) => `$${Number(n).toFixed(2)}`;
