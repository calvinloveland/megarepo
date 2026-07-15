// Rectangular-room acoustics helpers: image-source reflection paths and a
// simple axis-aligned-occluder line-of-sight test. These feed the captured-
// waveform model so the matched-filter TOA estimator (dsp.mjs) has realistic
// direct + echo arrivals to contend with — the whole point of "iterate without
// hardware".

import { distance, SPEED_OF_SOUND } from './acoustics.mjs';

/**
 * @typedef {{x:number,y:number}} Vec2
 * @typedef {{minX:number,minY:number,maxX:number,maxY:number}} Rect
 */

/**
 * Enumerate image sources of an emitter in a rectangular room.
 * Order 1 = the 4 wall-mirrors; order 2 adds 8 more (two-bounce mirrors).
 * The image-source method gives the correct reflection path *length*; we filter
 * to images whose path is longer than the direct so we never emit an unphysical
 * arrival earlier than the direct path.
 *
 * @param {Vec2} emitter
 * @param {{width:number,height:number}} room
 * @returns {{pos:Vec2, order:number, wall:string}[]}
 */
export function imageSources(emitter, room, maxOrder = 1) {
  const W = room.width, H = room.height;
  const out = [];
  // order 1: mirror each axis against each boundary
  const xs = [emitter.x, -emitter.x, 2 * W - emitter.x];
  const ys = [emitter.y, -emitter.y, 2 * H - emitter.y];
  const seen = new Set();
  function add(pos, order, wall) {
    const key = `${pos.x.toFixed(4)},${pos.y.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ pos, order, wall });
  }
  // order 1
  add({ x: -emitter.x, y: emitter.y }, 1, 'left');
  add({ x: 2 * W - emitter.x, y: emitter.y }, 1, 'right');
  add({ x: emitter.x, y: -emitter.y }, 1, 'bottom');
  add({ x: emitter.x, y: 2 * H - emitter.y }, 1, 'top');
  if (maxOrder >= 2) {
    for (const x of xs) for (const y of ys) {
      if (Math.abs(x - emitter.x) < 1e-9 && Math.abs(y - emitter.y) < 1e-9) continue;
      const order = (Math.abs(x - emitter.x) > 1e-9 ? 1 : 0) + (Math.abs(y - emitter.y) > 1e-9 ? 1 : 0);
      if (order === 2) add({ x, y }, 2, 'corner');
    }
  }
  return out;
}

/**
 * Direct + all echo arrivals for one (emitter, listener) pair.
 * Amplitudes are linear, normalized so the *direct* path is 1.0 and each echo is
 *   a_echo = reflCoef^order * (d_direct / d_echo)
 * (spherical spreading + a wall reflection coefficient per bounce). Echoes with
 * path no longer than the direct are dropped.
 *
 * @returns {{delaySec:number, amplitude:number, kind:'direct'|'echo', order:number}[]}
 */
export function arrivalPaths(emitter, listener, room, reflCoef, maxOrder = 1, c = SPEED_OF_SOUND) {
  const dDirect = distance(emitter, listener) || 1e-9;
  const paths = [
    { delaySec: dDirect / c, amplitude: 1, kind: 'direct', order: 0 },
  ];
  for (const img of imageSources(emitter, room, maxOrder)) {
    const d = distance(img.pos, listener);
    if (d <= dDirect + 1e-9) continue; // echoes arrive strictly after the direct
    const amp = Math.pow(reflCoef, img.order) * (dDirect / d);
    paths.push({ delaySec: d / c, amplitude: amp, kind: 'echo', order: img.order });
  }
  return paths;
}

/**
 * Does the segment a→b intersect the axis-aligned occluder rectangle (open interior)?
 * Used to mark a (emitter, listener) pair non-line-of-sight so the *direct* arrival
 * is omitted and the first thing the estimator sees is a reflection.
 *
 * @param {Vec2} a
 * @param {Vec2} b
 * @param {Rect} r
 * @returns {boolean}
 */
export function segmentHitsRect(a, b, r) {
  // Liang–Barsky parametric clip against an AABB; hit if the surviving t-range is non-empty
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const checks = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false; // segment parallel and outside
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1; // intersect over a positive-length interval (open)
}