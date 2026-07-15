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
 * Estimate the Time-of-Arrival of `template` inside `signal` as the lag of the
 * strongest matched-filter peak. Argmax-of-|correlation|; for a free-field
 * capture the direct path is both earliest and (usually) loudest, so it wins.
 *
 * Sub-sample refinement is deferred (parabolic interpolation around the peak).
 *
 * @returns {{lagSamples:number, timeSec:number, peak:number}}
 */
export function estimateTOA(signal, template, sampleRateHz) {
  const corr = matchedFilter(signal, template);
  let bestIdx = 0;
  let best = -Infinity;
  for (let j = 0; j < corr.length; j++) {
    const a = Math.abs(corr[j]);
    if (a > best) {
      best = a;
      bestIdx = j;
    }
  }
  return { lagSamples: bestIdx, timeSec: bestIdx / sampleRateHz, peak: corr[bestIdx] };
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