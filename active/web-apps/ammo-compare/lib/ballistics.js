/**
 * Ballistics math shared by the UI and the tests.
 *
 * Everything here takes the stored load data (bullet weight in grains, muzzle
 * velocity in feet per second) and derives the numbers shown in the table, so
 * there is exactly one implementation of each formula.
 */

export const FT_LB_TO_JOULES = 1.3558179483314004;
export const FPS_TO_MPS = 0.3048;
export const GRAINS_TO_GRAMS = 0.06479891;
export const GRAINS_FPS_TO_LBF_S = 7000 * 32.174; // 225,218.34

/**
 * Muzzle energy in foot-pounds: E = m·v² / 2, with the constant folded in.
 * 450437 = 2 · 7000 (grains per pound) · 32.174 (ft/s²).
 *
 * @param {number} bulletGr bullet weight in grains
 * @param {number} velocityFps muzzle velocity in feet per second
 * @returns {number} muzzle energy in foot-pounds
 */
export function energyFtLb(bulletGr, velocityFps) {
  return (bulletGr * velocityFps * velocityFps) / 450437;
}

export function ftLbToJoules(ftLb) {
  return ftLb * FT_LB_TO_JOULES;
}

/**
 * Power factor is the shooting-sports momentum figure: grains × fps / 1000.
 * 125,000 (PF 125) is the common minor floor and 165,000 (PF 165) the major one.
 */
export function powerFactor(bulletGr, velocityFps) {
  return (bulletGr * velocityFps) / 1000;
}

/**
 * Momentum in pound-force seconds: the figure Wikipedia lists as "P" and a
 * direct physical basis for recoil and penetration potential.
 */
export function momentumLbfS(bulletGr, velocityFps) {
  return (bulletGr * velocityFps) / GRAINS_FPS_TO_LBF_S;
}

/** Derived numbers for one load, in both unit systems. */
export function derive(load) {
  const ftLb = energyFtLb(load.bulletGr, load.velocityFps);
  return {
    energyFtLb: ftLb,
    energyJoules: ftLbToJoules(ftLb),
    velocityMps: load.velocityFps * FPS_TO_MPS,
    bulletGrams: load.bulletGr * GRAINS_TO_GRAMS,
    powerFactor: powerFactor(load.bulletGr, load.velocityFps),
    momentumLbfS: momentumLbfS(load.bulletGr, load.velocityFps),
  };
}

/** Format helpers kept next to the math so units stay consistent. */
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const fmtEnergy = (n) => fmtInt(n);
export const fmtCost = (n) => `$${n.toFixed(2)}`;
