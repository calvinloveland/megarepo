// Pure UI-state helpers so the browser can share reproducible simulator states
// via the URL without smearing parsing/clamping logic through app.js.

export const DEFAULT_UI_STATE = Object.freeze({
  nodeCount: 6,
  seed: 42,
  roomW: 6,
  roomH: 5,
  exponent: 4,
  distanceLaw: 1,
  captureMode: 'closed',
  distributedMatched: false,
  reflCoef: 0.5,
  meshLoss: 0,
  avgShots: 1,
  earliestPeak: false,
  clockSkew: false,
  robust: false,
  showTruth: true,
  captureSweep: true,
});

export const PRESETS = Object.freeze([
  {
    id: 'dry-matched',
    label: 'Dry room · matched DSP',
    state: {
      ...DEFAULT_UI_STATE,
      captureMode: 'matched',
      reflCoef: 0,
      nodeCount: 6,
      seed: 42,
    },
  },
  {
    id: 'living-room-hard',
    label: 'Living room · hard reverb (hardened)',
    state: {
      ...DEFAULT_UI_STATE,
      nodeCount: 8,
      roomW: 8,
      roomH: 6,
      captureMode: 'matched',
      reflCoef: 0.8,
      earliestPeak: true,
      robust: true,
    },
  },
  {
    id: 'distributed-lossy',
    label: 'Distributed mesh · 30% packet loss',
    state: {
      ...DEFAULT_UI_STATE,
      nodeCount: 8,
      roomW: 8,
      roomH: 6,
      captureMode: 'distributed',
      meshLoss: 0.3,
      robust: true,
    },
  },
  {
    id: 'averaged-skew',
    label: 'Clock skew + shot averaging',
    state: {
      ...DEFAULT_UI_STATE,
      captureMode: 'matched',
      reflCoef: 0.3,
      avgShots: 5,
      clockSkew: true,
      earliestPeak: true,
    },
  },
]);

const CAPTURE_MODES = new Set(['closed', 'matched', 'distributed']);

function clampInt(v, lo, hi, d) {
  v = Number.parseInt(v, 10);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, Math.min(hi, v));
}
function clampNum(v, lo, hi, d) {
  v = Number.parseFloat(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, Math.min(hi, v));
}
function clampMin(v, lo, d) {
  v = Number.parseFloat(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, v);
}
function toBool(v, d = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
  }
  return d;
}

/** Clamp/normalize a partial UI state into a valid full one. */
export function sanitizeUiState(input = {}) {
  const base = { ...DEFAULT_UI_STATE, ...input };
  return {
    nodeCount: clampInt(base.nodeCount, 4, 12, DEFAULT_UI_STATE.nodeCount),
    seed: Number.parseInt(base.seed, 10) || 0,
    roomW: clampMin(base.roomW, 3, DEFAULT_UI_STATE.roomW),
    roomH: clampMin(base.roomH, 3, DEFAULT_UI_STATE.roomH),
    exponent: clampInt(base.exponent, 1, 12, DEFAULT_UI_STATE.exponent),
    distanceLaw: clampMin(base.distanceLaw, 0, DEFAULT_UI_STATE.distanceLaw),
    captureMode: CAPTURE_MODES.has(base.captureMode) ? base.captureMode : DEFAULT_UI_STATE.captureMode,
    distributedMatched: toBool(base.distributedMatched, DEFAULT_UI_STATE.distributedMatched),
    reflCoef: clampNum(base.reflCoef, 0, 1, DEFAULT_UI_STATE.reflCoef),
    meshLoss: clampNum(base.meshLoss, 0, 1, DEFAULT_UI_STATE.meshLoss),
    avgShots: clampInt(base.avgShots, 1, 32, DEFAULT_UI_STATE.avgShots),
    earliestPeak: toBool(base.earliestPeak, DEFAULT_UI_STATE.earliestPeak),
    clockSkew: toBool(base.clockSkew, DEFAULT_UI_STATE.clockSkew),
    robust: toBool(base.robust, DEFAULT_UI_STATE.robust),
    showTruth: toBool(base.showTruth, DEFAULT_UI_STATE.showTruth),
    captureSweep: toBool(base.captureSweep, DEFAULT_UI_STATE.captureSweep),
  };
}

/** Compact URL fragment serialization. */
export function serializeUiState(input = {}) {
  const s = sanitizeUiState(input);
  const params = new URLSearchParams();
  params.set('n', String(s.nodeCount));
  params.set('seed', String(s.seed));
  params.set('w', String(s.roomW));
  params.set('h', String(s.roomH));
  params.set('exp', String(s.exponent));
  params.set('law', String(s.distanceLaw));
  params.set('mode', s.captureMode);
  if (s.distributedMatched) params.set('dmatch', '1');
  params.set('refl', String(s.reflCoef));
  params.set('loss', String(s.meshLoss));
  params.set('shots', String(s.avgShots));
  if (s.earliestPeak) params.set('ep', '1');
  if (s.clockSkew) params.set('skew', '1');
  if (s.robust) params.set('robust', '1');
  if (!s.showTruth) params.set('truth', '0');
  if (!s.captureSweep) params.set('anim', '0');
  return params.toString();
}

/** Parse a #fragment or ?query string into a clamped UI state. */
export function parseUiStateUrl(fragment = '') {
  const raw = String(fragment || '').replace(/^[#?]/, '');
  if (!raw) return { ...DEFAULT_UI_STATE };
  const p = new URLSearchParams(raw);
  return sanitizeUiState({
    nodeCount: p.get('n'),
    seed: p.get('seed'),
    roomW: p.get('w'),
    roomH: p.get('h'),
    exponent: p.get('exp'),
    distanceLaw: p.get('law'),
    captureMode: p.get('mode'),
    distributedMatched: p.get('dmatch'),
    reflCoef: p.get('refl'),
    meshLoss: p.get('loss'),
    avgShots: p.get('shots'),
    earliestPeak: p.get('ep'),
    clockSkew: p.get('skew'),
    robust: p.get('robust'),
    showTruth: p.get('truth') == null ? DEFAULT_UI_STATE.showTruth : p.get('truth'),
    captureSweep: p.get('anim') == null ? DEFAULT_UI_STATE.captureSweep : p.get('anim'),
  });
}

/** Exact-match preset id for a full state, else 'custom'. */
export function matchingPresetId(input = {}) {
  const s = sanitizeUiState(input);
  for (const preset of PRESETS) {
    const p = sanitizeUiState(preset.state);
    let same = true;
    for (const k of Object.keys(DEFAULT_UI_STATE)) {
      if (s[k] !== p[k]) { same = false; break; }
    }
    if (same) return preset.id;
  }
  return 'custom';
}

export function presetState(id) {
  const preset = PRESETS.find((p) => p.id === id);
  return preset ? sanitizeUiState(preset.state) : { ...DEFAULT_UI_STATE };
}
