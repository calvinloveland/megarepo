/**
 * Simple exterior-ballistics model shared by the table and the tests.
 *
 * Real trajectory tables come from a velocity-decay curve measured for a
 * specific bullet. We only know the bullet weight, diameter, muzzle velocity,
 * and (for some rows) a published G1 ballistic coefficient, so this module
 * uses a deliberately small model:
 *
 *   v(x) = v0 · exp(-k·x),   k = 0.000438 · BC^-0.53
 *
 * The constant is fitted to published G1 tables for common bullets, which
 * keeps the estimate within a few percent of a real table at the ranges a
 * comparison table cares about. Rows with a published BC use that value;
 * the rest get a BC estimated from sectional density and bullet shape. Every
 * number produced here is labelled as an estimate in the UI.
 */

import { energyFtLb, FT_LB_TO_JOULES } from './ballistics.js';

export const YD_TO_M = 0.9144;
export const IN_TO_CM = 2.54;
export const GRAVITY_IN_S2 = 386.0886;

/** Sectional density in lb/in². */
export function sectionalDensity(bulletGr, diameterIn) {
  return bulletGr / 7000 / (diameterIn * diameterIn);
}

/** A shot charge is many projectiles, so a single trajectory does not apply. */
export function isShotLoad(load) {
  const label = load.pelletLabel ?? '';
  return /shot|buck|pellet/i.test(label) && !/slug/i.test(label);
}

export function isSlugLoad(load) {
  return /slug/i.test(load.pelletLabel ?? load.name ?? '');
}

/**
 * Form factor (G1) by bullet shape. These are broad categories, not measured
 * values: spitzer rifle bullets have the least drag per unit sectional
 * density, round-nose handgun bullets the most.
 */
function formFactor(load) {
  if (load.category === 'shotgun') return 1.25;
  if (load.category === 'pistol' || load.category === 'rimfire') return 0.95;
  return load.velocityFps >= 2400 ? 0.58 : 0.78;
}

/**
 * Ballistic coefficient for a load. Published values win; otherwise derive a
 * G1 estimate from sectional density. The result carries its provenance so the
 * UI can mark estimates instead of presenting them as measured data.
 *
 * @returns {{ value: number, source: 'published' | 'estimated' }}
 */
export function ballisticCoefficient(load) {
  if (Number.isFinite(load.bc) && load.bc > 0) {
    return { value: load.bc, source: 'published' };
  }
  const sd = sectionalDensity(load.bulletGr, load.diameterIn);
  const value = Math.min(1.2, Math.max(0.03, sd / formFactor(load)));
  return { value, source: 'estimated' };
}

/** Exponential decay constant per yard for a G1 ballistic coefficient. */
export function dragDecay(bc) {
  return Math.min(0.0035, Math.max(0.00025, 0.000438 * Math.pow(bc, -0.53)));
}

/** Velocity at a distance, in feet per second. */
export function velocityAt(load, distanceYd, bc = ballisticCoefficient(load).value) {
  return load.velocityFps * Math.exp(-dragDecay(bc) * distanceYd);
}

/** Time of flight in seconds for the exponential velocity model. */
export function timeOfFlight(load, distanceYd, bc = ballisticCoefficient(load).value) {
  const k = dragDecay(bc);
  return (3 * (Math.exp(k * distanceYd) - 1)) / (load.velocityFps * k);
}

/**
 * Sight height and zero distance per class. Pistols and rimfires are usually
 * zeroed closer than rifles, and their sights sit lower.
 */
export function sightGeometry(load) {
  if (load.category === 'pistol' || load.category === 'rimfire') {
    return { heightIn: 1.0, zeroYd: 50 };
  }
  return { heightIn: 1.5, zeroYd: 100 };
}

/**
 * One row of a trajectory table: retained velocity and energy, time of flight,
 * and drop relative to the line of sight with the class-appropriate zero.
 */
export function trajectoryAt(load, distanceYd, bcInfo = ballisticCoefficient(load)) {
  const { heightIn, zeroYd } = sightGeometry(load);
  const zeroTime = timeOfFlight(load, zeroYd, bcInfo.value);
  const sightRise = heightIn + 0.5 * GRAVITY_IN_S2 * zeroTime * zeroTime;
  const velocityFps = velocityAt(load, distanceYd, bcInfo.value);
  const timeS = timeOfFlight(load, distanceYd, bcInfo.value);
  const dropIn =
    sightRise * (distanceYd / zeroYd) -
    heightIn -
    0.5 * GRAVITY_IN_S2 * timeS * timeS;
  return {
    distanceYd,
    velocityFps,
    energyFtLb: energyFtLb(load.bulletGr, velocityFps),
    energyJoules: energyFtLb(load.bulletGr, velocityFps) * FT_LB_TO_JOULES,
    timeS,
    dropIn,
  };
}

/**
 * Energy floor for a useful hit, by role. The floor is capped at 75% of the
 * muzzle energy so a weak legacy cartridge still gets a finite range instead
 * of zero, and caps keep the result in the range people actually shoot.
 */
function energyFloor(load) {
  if (load.category === 'shotgun') return null;
  let floor;
  if (load.category === 'rimfire') floor = 75;
  else if (load.category === 'pistol') floor = 300;
  else if (/varmint|small game|pest|predator/i.test(load.use)) floor = 250;
  else floor = 1000;
  return Math.min(floor, energyFtLb(load.bulletGr, load.velocityFps) * 0.75);
}

/**
 * Estimated effective range: the farthest 25-yard step at which the load
 * still carries the role's energy floor. Shot shells are pattern-limited, so
 * they use a fixed range instead; slugs get a slug-gun range.
 */
export function effectiveRangeYd(load) {
  if (load.category === 'shotgun') {
    if (isSlugLoad(load)) return /sabot/i.test(load.pelletLabel ?? load.name) ? 150 : 100;
    return 40;
  }

  const floor = energyFloor(load);
  const bc = ballisticCoefficient(load).value;
  let range = 25;
  for (let x = 25; x <= 2500; x += 25) {
    if (energyFtLb(load.bulletGr, velocityAt(load, x, bc)) < floor) break;
    range = x;
  }

  if (load.category === 'pistol') return Math.min(range, 150);
  if (load.category === 'rimfire') return Math.min(range, 200);
  if (/anti-materiel/i.test(load.use)) return Math.min(range, 2000);
  if (/varmint|small game|pest|predator/i.test(load.use)) return Math.min(range, 600);
  return range;
}

/**
 * Distances sampled in the expanded row. Short-range cartridges get 25- or
 * 50-yard steps; rifles get a 100-yard row early (the range most people zero
 * at) and then coarser steps so the table stays compact.
 */
function sampleDistances(maxYd) {
  const ranges = [];
  const step = maxYd <= 100 ? 25 : maxYd <= 200 ? 50 : maxYd <= 600 ? 100 : maxYd <= 1000 ? 200 : maxYd <= 1500 ? 250 : 500;
  for (let x = 0; x <= maxYd; x += step) ranges.push(x);
  if (maxYd > 200) {
    // Make sure the usual 100/200-yard sight-in points are present when the
    // step is coarse, without duplicating an existing multiple.
    for (const milestone of [100, 200]) {
      if (!ranges.includes(milestone)) ranges.push(milestone);
    }
    ranges.sort((a, b) => a - b);
  }
  if (ranges[ranges.length - 1] !== maxYd) ranges.push(maxYd);
  return ranges;
}

/**
 * Sampled trajectory for the expanded row. Returns null for shot charges,
 * where a single-projectile trajectory would be misleading.
 *
 * @returns {Array<ReturnType<typeof trajectoryAt>> | null}
 */
export function trajectoryTable(load) {
  if (isShotLoad(load)) return null;
  const maxYd = effectiveRangeYd(load);
  const bcInfo = ballisticCoefficient(load);
  return sampleDistances(maxYd).map((x) => trajectoryAt(load, x, bcInfo));
}

/** Everything the UI needs about one load's exterior ballistics. */
export function ballisticProfile(load) {
  const bc = ballisticCoefficient(load);
  const { heightIn, zeroYd } = sightGeometry(load);
  return {
    bcValue: bc.value,
    bcSource: bc.source,
    sightHeightIn: heightIn,
    zeroYd,
    effectiveRangeYd: effectiveRangeYd(load),
    trajectory: trajectoryTable(load),
  };
}
