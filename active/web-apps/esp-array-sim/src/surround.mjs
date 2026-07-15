// Surround mapping: render a standard input (5.1) onto an *irregular* set of
// real speakers placed arbitrarily around the room.
//
// Each real speaker is treated as a directional source at angle θ_k (from the
// sweet-spot listener). Each virtual 5.1 channel has a canonical ITU-R BS.775
// azimuth. A virtual channel is panned onto the real speakers with a
// cosine-power law: g_k ∝ max(0, cos(Δθ))^p, then distance-compensated and
// normalized so the rendered channel keeps constant energy and the nearest
// speaker dominates when it lines up.
//
// This is a deliberate first approximation (a "vector-based" panner with a
// soft cosine kernel rather than hard Voronoi triangles), chosen because it
// degrades gracefully for sparse/random layouts where strict VBAP would leave
// channels silent. The cost/exposure is the same knob set the real firmware
// will need (exponent, distance law, LFE routing).

/** Degrees → radians. */
const D2R = Math.PI / 180;

/**
 * ITU-R BS.775-2 nominal 5.1 loudspeaker azimuths, measured from the front
 * centre line, positive = clockwise (listener facing front/+x). LFE is
 * non-directional and is folded into the nearest front pair by default.
 */
export const CHANNELS_5_1 = [
  { id: 'L', azimuthDeg: -30, lfe: false },
  { id: 'R', azimuthDeg: 30, lfe: false },
  { id: 'C', azimuthDeg: 0, lfe: false },
  { id: 'Ls', azimuthDeg: -110, lfe: false },
  { id: 'Rs', azimuthDeg: 110, lfe: false },
  { id: 'LFE', azimuthDeg: 0, lfe: true },
];

/** Unit direction vector of an azimuth (front = +x). */
export function azimuthToVec(deg) {
  const a = deg * D2R;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Angle of a vector expressed in the same convention (front = 0°, CW positive). */
export function vecToAzimuthDeg(v) {
  return (Math.atan2(v.y, v.x) / D2R) % 360;
}

/** Smallest signed angular difference a-b wrapped to (-180, 180]. */
export function angleDeltaDeg(a, b) {
  let d = (a - b + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * @typedef {Object} RealSpeaker what the surround mapper sees per physical node
 * @property {string} id node label
 * @property {{x:number,y:number}} pos metres in room coords
 */

/**
 * Precomputed geometry of the real speaker array from the sweet-spot listener.
 * @returns {{id:string, angleDeg:number, distanceM:number, u:{x:number,y:number}}[]}
 */
export function speakerGeometry(speakers, sweetSpot) {
  return speakers.map((s) => {
    const dx = s.pos.x - sweetSpot.x;
    const dy = s.pos.y - sweetSpot.y;
    const distanceM = Math.hypot(dx, dy) || 1e-6;
    const angleDeg = vecToAzimuthDeg({ x: dx / distanceM, y: dy / distanceM });
    return { id: s.id, angleDeg, distanceM, u: { x: dx / distanceM, y: dy / distanceM } };
  });
}

/**
 * Map every 5.1 channel onto the real speakers.
 *
 * @param {RealSpeaker[]} speakers actual nodes (after localization)
 * @param {{x:number,y:number}} sweetSpot listener position in room coords
 * @param {object} [opts]
 * @param {number} [opts.exponent] cosine-power exponent; higher = sharper
 * @param {number} [opts.distanceLaw] amplitude ∝ 1 / dist^distanceLaw (mono gain comp), 0 to disable
 * @param {'nearest'|'all'} [opts.lfeRouting] how LFE is distributed
 * @returns {{channel:string, mapping:{id:string,gain:number}[]}[]}
 */
export function mapSurround(speakers, sweetSpot, opts = {}) {
  const exponent = opts.exponent ?? 4;
  const distanceLaw = opts.distanceLaw ?? 1;
  const lfeRouting = opts.lfeRouting ?? 'nearest';
  const geom = speakerGeometry(speakers, sweetSpot);
  const result = [];
  for (const ch of CHANNELS_5_1) {
    if (ch.lfe && lfeRouting === 'nearest') {
      result.push({ channel: ch.id, mapping: lfeNearest(geom, distanceLaw) });
      continue;
    }
    const v = azimuthToVec(ch.azimuthDeg);
    const raw = geom.map((g) => {
      const cos = Math.max(0, g.u.x * v.x + g.u.y * v.y);
      const directional = Math.pow(cos, exponent);
      const distComp = Math.pow(g.distanceM, -distanceLaw);
      return { id: g.id, weight: directional * distComp, angleDelta: angleDeltaDeg(g.angleDeg, ch.azimuthDeg) };
    });
    const denom = raw.reduce((s, r) => s + r.weight, 0) || 1e-9;
    const mapping = raw.map((r) => ({ id: r.id, gain: r.weight / denom })).sort((p, q) => q.gain - p.gain);
    result.push({ channel: ch.id, mapping });
  }
  return result;
}

/** Route the LFE to the single nearest (omnidirectional) speaker. */
function lfeNearest(geom, distanceLaw) {
  // weight by distance only (LFE is non-directional); nearer = louder
  const raw = geom.map((g) => ({ id: g.id, weight: Math.pow(g.distanceM, -distanceLaw) }));
  const denom = raw.reduce((s, r) => s + r.weight, 0) || 1e-9;
  return raw.map((r) => ({ id: r.id, gain: r.weight / denom })).sort((p, q) => q.gain - p.gain);
}