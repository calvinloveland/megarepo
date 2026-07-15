// Physical acoustics constants and helpers shared across the simulator.
//
// All distances are in metres, times in seconds. The simulator models a
// 2D room (ceiling/floor ignored — propagation is planar), which is enough
// to develop the self-localization and surround-mapping algorithms before
// we move to real ESP32 hardware.

/** Speed of sound in air at ~20°C, in metres/second. */
export const SPEED_OF_SOUND = 343; // m/s

/** Intra-device self-audio path: speaker→its own mic, in metres. */
export const SELF_PATH = 0.02; // m — toy value; real ESP32 boxes ≈ a few cm

/**
 * One-way propagation delay between two points.
 * @param {number} distanceM
 * @param {number} [c]
 * @returns {number} seconds
 */
export function propagationDelay(distanceM, c = SPEED_OF_SOUND) {
  return distanceM / c;
}

/** Euclidean distance between two 2D points. */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Free-field spherical spreading attenuation (linear amplitude ratio).
 * @param {number} distanceM
 * @param {number} [refDistanceM] reference at 1 m by default
 * @returns {number} amplitude multiplier (1.0 at refDistanceM)
 */
export function freeFieldGain(distanceM, refDistanceM = 1) {
  if (distanceM <= 0) return 1;
  return refDistanceM / distanceM;
}

/** Gaussian noise sample, Box–Muller (polar form). Deterministic when a seeded RNG is supplied. */
export function gaussianNoise(rng, sigma) {
  if (sigma === 0) return 0;
  let u1, u2, s;
  do {
    u1 = rng() * 2 - 1;
    u2 = rng() * 2 - 1;
    s = u1 * u1 + u2 * u2;
  } while (s === 0 || s >= 1); // reject outside the unit disk
  const f = Math.sqrt((-2 * Math.log(s)) / s);
  return sigma * u1 * f;
}

/**
 * Convert a listener-clock arrival time back to an equivalent extra distance
 * (the TOA ambiguity floor from clock noise), useful for debugging.
 */
export function timeToDistance(seconds, c = SPEED_OF_SOUND) {
  return seconds * c;
}