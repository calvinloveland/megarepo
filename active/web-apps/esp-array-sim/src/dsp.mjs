// Acoustic DSP: the signal-processing block the ESP32 firmware will run on each
// capture to estimate a Time-of-Arrival, exposed here so the simulator can
// exercise the *real* estimator (matched filtering of a known linear-FM chirp)
// instead of only the closed-form delay the physics provides.
//
// Keeping this browser/node-pure means the same correlations the tests check are
// the ones the firmware will compute (modulo fixed-point tweaks), so we iterate
// the algorithm here before baking it onto the micro.

/**
 * Generate a linear-FM ("linear chirp") template, optionally Hann-windowed.
 *
 * @param {object} opts
 * @param {number} opts.durationSec
 * @param {number} opts.f0Hz        start frequency
 * @param {number} opts.f1Hz        end frequency
 * @param {number} opts.sampleRateHz
 * @param {boolean} [opts.window]   apply a Hann window (lowers correlation sidelobes)
 * @returns {Float64Array} real-valued samples in [-1, 1]
 */
export function linearChirp({ durationSec, f0Hz, f1Hz, sampleRateHz, window = true }) {
  const N = Math.round(durationSec * sampleRateHz);
  const out = new Float64Array(N);
  const T = durationSec;
  const k = (f1Hz - f0Hz) / T; // sweep rate Hz/s
  for (let i = 0; i < N; i++) {
    const t = i / sampleRateHz;
    // phase = 2π (f0 t + (k/2) t²)  ← integral of the instantaneous frequency
    const phase = 2 * Math.PI * (f0Hz * t + (k / 2) * t * t);
    let v = Math.cos(phase);
    if (window) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      v *= w;
    }
    out[i] = v;
  }
  return out;
}

/**
 * Full normalized matched-filter (cross-correlation) of `signal` against
 * `template`. Returns a Float64Array of length signal.length - template.length + 1
 * where entry j = Σ_i signal[j+i] * template[i]. "Normalized" means divided by
 * the template energy so the peak magnitude is comparable across templates.
 *
 * @param {Float64Array|number[]} signal
 * @param {Float64Array|number[]} template
 * @returns {Float64Array}
 */
export function matchedFilter(signal, template) {
  const L = signal.length - template.length + 1;
  if (L <= 0) throw new Error('signal shorter than template');
  const out = new Float64Array(L);
  let tmplEnergy = 0;
  for (let k = 0; k < template.length; k++) tmplEnergy += template[k] * template[k];
  if (tmplEnergy === 0) tmplEnergy = 1;
  for (let j = 0; j < L; j++) {
    let s = 0;
    for (let k = 0; k < template.length; k++) s += signal[j + k] * template[k];
    out[j] = s / tmplEnergy;
  }
  return out;
}

/**
 * Estimate the Time-of-Arrival of `template` inside `signal`.
 *
 * Two selection strategies (opts.mode):
 * - 'strongest' (default): the lag of the largest |correlation| peak. Simple, but
 *   a loud non-line-of-sight echo can win — the documented limitation.
 * - 'earliest': the earliest matched-filter peak whose magnitude is at least
 *   opts.peakThreshold × the global max. Rejects loud LATER echoes by trusting
 *   that the direct arrival is the first "strong enough" peak. local-maxima
 *   picking avoids the early-shoulder bias a naive threshold-crossing has.
 *
 * Sub-sample refinement: a parabola fit on the |correlation| samples around the
 * integer peak recovers the true (fractional) lag to a small fraction of a
 * sample, bringing single-mic TOA from ~few cm toward the sample-quantization
 * floor. Enabled by default; set opts.refine = false to keep integer lags.
 *
 * @param {Float64Array|number[]} signal
 * @param {Float64Array|number[]} template
 * @param {number} sampleRateHz
 * @param {{mode?:'strongest'|'earliest', peakThreshold?:number, refine?:boolean, minPeakSep?:number}} [opts]
 * @returns {{lagSamples:number, timeSec:number, peak:number, mode:string}}
 */
export function estimateTOA(signal, template, sampleRateHz, opts = {}) {
  const mode = opts.mode ?? 'strongest';
  const refine = opts.refine ?? true;
  const corr = matchedFilter(signal, template);
  if (mode === 'earliest') {
    let globalMax = 0;
    for (let j = 0; j < corr.length; j++) globalMax = Math.max(globalMax, Math.abs(corr[j]));
    const thr = (opts.peakThreshold ?? 0.5) * globalMax;
    // local maxima above threshold
    const maxima = [];
    for (let j = 1; j < corr.length - 1; j++) {
      const a = Math.abs(corr[j]);
      if (a >= thr && a >= Math.abs(corr[j - 1]) && a >= Math.abs(corr[j + 1])) maxima.push(j);
    }
    // cluster maxima within one chirp-length so a single broadened arrival
    // (multiple ripples of the windowed mainlobe) collapses to its strongest
    // sample; each cluster is one physical arrival.
    const minSep = Math.max(4, opts.minPeakSep ?? template.length);
    const clusters = [];
    for (const j of maxima) {
      const last = clusters[clusters.length - 1];
      if (last && j - last.lag <= minSep) {
        if (Math.abs(corr[j]) > Math.abs(corr[last.lag])) last.lag = j;
      } else {
        clusters.push({ lag: j });
      }
    }
    const idx = clusters.length ? clusters[0].lag : argmaxAbs(corr);
    const lag = refine ? refinePeak(corr, idx) : idx;
    return { lagSamples: lag, timeSec: lag / sampleRateHz, peak: corr[idx], mode };
  }
  const idx = argmaxAbs(corr);
  const lag = refine ? refinePeak(corr, idx) : idx;
  return { lagSamples: lag, timeSec: lag / sampleRateHz, peak: corr[idx], mode };
}

/** Parabolic interpolation of the |correlation| peak at integer index `idx`. */
function refinePeak(corr, idx) {
  if (idx <= 0 || idx >= corr.length - 1) return idx;
  const ym = Math.abs(corr[idx - 1]);
  const y0 = Math.abs(corr[idx]);
  const yp = Math.abs(corr[idx + 1]);
  const denom = ym - 2 * y0 + yp;
  if (Math.abs(denom) < 1e-12) return idx;
  const delta = 0.5 * (ym - yp) / denom;
  // clamp to the neighbouring samples — a sane parabola stays within ±1
  if (delta < -1 || delta > 1) return idx;
  return idx + delta;
}

function argmaxAbs(corr) {
  let bestIdx = 0;
  let best = -Infinity;
  for (let j = 0; j < corr.length; j++) {
    const a = Math.abs(corr[j]);
    if (a > best) {
      best = a;
      bestIdx = j;
    }
  }
  return bestIdx;
}

/** Place a template copy into a signal buffer starting at a fractional lag (linear interpolation). */
export function placeTemplate(signal, template, lagSamples, amplitude = 1) {
  const start = Math.floor(lagSamples);
  const frac = lagSamples - start;
  for (let k = 0; k < template.length; k++) {
    const j = start + k;
    if (j < 0 || j >= signal.length) continue;
    const s = template[k];
    const prev = k > 0 ? template[k - 1] : s;
    const v = prev + (s - prev) * (1 - frac); // shift by frac via interp between adjacent template samples
    signal[j] += amplitude * v;
  }
  return signal;
}