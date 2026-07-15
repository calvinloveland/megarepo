// ESP Speaker Array Simulator — UI controller + canvas renderer.
// Imports the SAME pure ESM modules the unit tests exercise, so the browser and
// the test suite never diverge (one source of truth for the physics/solver).
import { runScenario } from './src/scenario.mjs';
import { CHANNELS_5_1, azimuthToVec } from './src/surround.mjs';
import { SPEED_OF_SOUND } from './src/acoustics.mjs';
import { renderChannelAtSweetSpot, renderPeakConcentration, channelSeparation } from './src/render.mjs';
import { linearChirp } from './src/dsp.mjs';
import { runSweep, formatSweep, minNodesFor, formatMinNodes } from './src/sweep.mjs';
import { runBench, formatBench } from './src/bench.mjs';
import {
  PRESETS,
  sanitizeUiState,
  serializeUiState,
  parseUiStateUrl,
  matchingPresetId,
  presetState,
} from './src/ui-state.mjs';

const canvas = document.getElementById('room');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const reportEl = document.getElementById('report');
const mappingEl = document.getElementById('mapping');
const channelStatusEl = document.getElementById('channelStatus');
const sizingReportEl = document.getElementById('sizingReport');
const benchReportEl = document.getElementById('benchReport');

const ui = {
  preset: document.getElementById('preset'),
  copyLink: document.getElementById('copyLink'),
  nodeCount: document.getElementById('nodeCount'),
  seed: document.getElementById('seed'),
  roomW: document.getElementById('roomW'),
  roomH: document.getElementById('roomH'),
  exponent: document.getElementById('exponent'),
  distanceLaw: document.getElementById('distanceLaw'),
  captureMode: document.getElementById('captureMode'),
  reflCoef: document.getElementById('reflCoef'),
  meshLoss: document.getElementById('meshLoss'),
  avgShots: document.getElementById('avgShots'),
  earliestPeak: document.getElementById('earliestPeak'),
  clockSkew: document.getElementById('clockSkew'),
  robust: document.getElementById('robust'),
  showTruth: document.getElementById('showTruth'),
  captureSweep: document.getElementById('captureSweep'),
  run: document.getElementById('run'),
  reseed: document.getElementById('reseed'),
  playChannel: document.getElementById('playChannel'),
  stopChannel: document.getElementById('stopChannel'),
  sizingTargetCm: document.getElementById('sizingTargetCm'),
  sizingTrials: document.getElementById('sizingTrials'),
  runSizing: document.getElementById('runSizing'),
  benchRepeats: document.getElementById('benchRepeats'),
  runBench: document.getElementById('runBench'),
};

// Colours keyed by channel id for the on-canvas glow + mapping bars.
const CH_COLORS = {
  L: '#58a6ff', R: '#56d364', C: '#f0883e', Ls: '#bc8cff', Rs: '#ff7b72', LFE: '#d29922',
};

const state = {
  scenario: null,        // latest runScenario result
  ppm: 0,                // pixels per metre (set each draw)
  offset: { x: 0, y: 0 },
  activeChannel: null,   // id of the channel currently "playing"
  channelTimer: null,
  // calibration animation
  anim: null,            // {events, idx, t0, ringStopAt}
  raf: null,
};

function readUiState() {
  return sanitizeUiState({
    nodeCount: ui.nodeCount.value,
    seed: ui.seed.value,
    roomW: ui.roomW.value,
    roomH: ui.roomH.value,
    exponent: ui.exponent.value,
    distanceLaw: ui.distanceLaw.value,
    captureMode: ui.captureMode.value,
    reflCoef: ui.reflCoef.value,
    meshLoss: ui.meshLoss.value,
    avgShots: ui.avgShots.value,
    earliestPeak: ui.earliestPeak.checked,
    clockSkew: ui.clockSkew.checked,
    robust: ui.robust.checked,
    showTruth: ui.showTruth.checked,
    captureSweep: ui.captureSweep.checked,
  });
}

function applyUiState(s) {
  const v = sanitizeUiState(s);
  ui.nodeCount.value = v.nodeCount;
  ui.seed.value = v.seed;
  ui.roomW.value = v.roomW;
  ui.roomH.value = v.roomH;
  ui.exponent.value = v.exponent;
  ui.distanceLaw.value = v.distanceLaw;
  ui.captureMode.value = v.captureMode;
  ui.reflCoef.value = v.reflCoef;
  ui.meshLoss.value = v.meshLoss;
  ui.avgShots.value = v.avgShots;
  ui.earliestPeak.checked = v.earliestPeak;
  ui.clockSkew.checked = v.clockSkew;
  ui.robust.checked = v.robust;
  ui.showTruth.checked = v.showTruth;
  ui.captureSweep.checked = v.captureSweep;
  ui.preset.value = matchingPresetId(v);
}

function syncUrlFromUi() {
  const s = readUiState();
  ui.preset.value = matchingPresetId(s);
  history.replaceState(null, '', `#${serializeUiState(s)}`);
}

function readConfig() {
  const s = readUiState();
  return {
    nodeCount: s.nodeCount,
    seed: s.seed,
    room: { width: s.roomW, height: s.roomH },
    exponent: s.exponent,
    distanceLaw: s.distanceLaw,
    captureMode: s.captureMode,
    reflCoef: s.reflCoef,
    meshLoss: s.meshLoss,
    avgShots: s.avgShots,
    earliestPeak: s.earliestPeak,
    clockSkew: s.clockSkew,
    robust: s.robust ? 5e-5 : 0,
  };
}

// --- run / report ----------------------------------------------------------

function runIt() {
  statusEl.textContent = 'Running localization…';
  // Yield to the browser so the status paints before the blocking solver.
  requestAnimationFrame(() => {
    const t0 = performance.now();
    const cfg = readConfig();
    syncUrlFromUi();
    state.scenario = runScenario(cfg);
    const ms = performance.now() - t0;
    stopChannel();
    renderReport(ms, cfg.captureMode);
    renderMapping();
    if (state.raf) cancelAnimationFrame(state.raf);
    if (ui.captureSweep.checked && state.scenario) startCaptureAnim();
    else { state.anim = null; draw(); }
    statusEl.textContent = `Done in ${ms.toFixed(0)} ms · ${state.scenario.solution.starts} LM restarts · ${state.scenario.solution.iterations} iters`;
  });
}

function renderReport(ms, mode) {
  const s = state.scenario;
  const errCm = (s.alignErrorM * 100).toFixed(2);
  const ok = s.alignErrorM < (mode === 'matched' ? 0.08 : 0.05);
  const resid = s.solution.costs.at(-1);
  const offsetRms = rmsError(s.clockOffsetsTrue, s.clockOffsetsEst);
  const comp = s.compensation || [];
  const delays = comp.map((c) => c.delaySec);
  const spreadMs = comp.length ? (Math.max(...delays) - Math.min(...delays)) * 1000 : 0;
  const compLine = comp.length
    ? `time-align: max delay spread ${spreadMs.toFixed(2)} ms, gain ${Math.min(...comp.map((c) => c.gainLinear)).toFixed(2)}–${Math.max(...comp.map((c) => c.gainLinear)).toFixed(2)}`
    : '';
  const capLine = mode === 'matched'
    ? `capture: <b>matched-filter</b> (real DSP · wall refl. coef ${(cfgReflCoef()).toFixed(2)})`
    : mode === 'distributed'
      ? `capture: <b>distributed mesh</b> (${s.meshMessages} msgs delivered${s.meshLost ? `, ${s.meshLost} lost` : ' · no loss'})`
      : `capture: <b>closed-form</b> (perfect direct-path TOA)`;
  reportEl.innerHTML = `
    <div>nodes: <b>${s.nodes.length}</b> · room: ${s.room.width}×${s.room.height} m</div>
    <div>alignment error: <span class="${ok ? 'ok' : 'bad'}">${errCm} cm</span> ${s.transform.mirror ? '(mirror-reflected to truth)' : ''}</div>
    <div>${capLine}</div>
    ${compLine ? `<div>${compLine}</div>` : ''}
    <div>residual cost: ${resid.toExponential(2)} s²</div>
    <div>solver: ${s.solution.converged ? 'converged' : 'hit iteration cap'} · ${s.solution.iterations} LM iters from ${s.solution.starts} starts ${s.observations[0]?.shots ? `(median of ${s.observations[0].shots.length} shots)` : ''}</div>
    <div>clock-offset est. RMS: ${(offsetRms * 1e6).toFixed(1)} µs (truth offset ±0.1 ms after WiFi sync)</div>
    ${s.withSkew ? `<div>clock-skew est. RMS: ${(rmsError(s.clockSkewsTrue, s.clockSkewsEst) * 1e6).toFixed(1)} ppm (truth ±50 ppm)</div>` : ''}
    <div>speed of sound: ${SPEED_OF_SOUND} m/s · ${s.observations.length} acoustic observations</div>
  `;
}

function cfgReflCoef() { return parseFloat(ui.reflCoef.value) ?? 0.5; }

function runSizing() {
  statusEl.textContent = 'Running hardware-sizing sweep…';
  requestAnimationFrame(() => {
    const cfg = readConfig();
    const targetM = Math.max(0.01, (parseFloat(ui.sizingTargetCm.value) || 5) / 100);
    const trials = Math.max(2, parseInt(ui.sizingTrials.value, 10) || 6);
    const cells = runSweep({
      nodeCounts: [4, 6, 8, 10, 12],
      captureModes: [cfg.captureMode],
      reflCoefs: [cfg.reflCoef],
      trials,
      roomW: cfg.room.width,
      roomH: cfg.room.height,
      extra: {
        earliestPeak: cfg.earliestPeak,
        clockSkew: cfg.clockSkew,
        robust: cfg.robust,
        meshLoss: cfg.meshLoss,
        avgShots: cfg.avgShots,
      },
    });
    const recs = minNodesFor(cells, targetM);
    sizingReportEl.textContent = `${formatSweep(cells)}\n\n${formatMinNodes(recs, targetM)}`;
    const rec = recs[0];
    statusEl.textContent = rec?.minNodes == null
      ? `Sizing done: infeasible in 4–12 nodes for ≤${(targetM * 100).toFixed(0)} cm worst-case.`
      : `Sizing done: need at least ${rec.minNodes} nodes for ≤${(targetM * 100).toFixed(0)} cm worst-case.`;
  });
}

function runBenchUi() {
  statusEl.textContent = 'Running calibration benchmark…';
  requestAnimationFrame(() => {
    const cfg = readConfig();
    const repeats = Math.max(1, parseInt(ui.benchRepeats.value, 10) || 3);
    const points = runBench({
      nodeCounts: [4, 6, 8, 10, 12],
      repeats,
      roomW: cfg.room.width,
      roomH: cfg.room.height,
      scenarioOpts: {
        captureMode: cfg.captureMode,
        reflCoef: cfg.reflCoef,
        noiseSigma: cfg.captureMode === 'matched' ? 0.05 : undefined,
        earliestPeak: cfg.earliestPeak,
        clockSkew: cfg.clockSkew,
        robust: cfg.robust,
        meshLoss: cfg.meshLoss,
        avgShots: cfg.avgShots,
        starts: 8,
      },
    });
    benchReportEl.textContent = formatBench(points);
    const worst = Math.max(...points.map((p) => p.worstMs));
    statusEl.textContent = `Benchmark done: worst calibration solve ${worst.toFixed(0)} ms.`;
  });
}

function renderMapping() {
  const s = state.scenario;
  if (!s) return;
  const rows = s.surround.map((c) => {
    const bars = c.mapping
      .filter((m) => m.gain > 0.01)
      .map((m) => {
        const pct = (m.gain * 100).toFixed(0);
        const loud = m.gain > 0.3;
        return `<span class="bar ${loud ? 'loud' : ''}">${m.id} <span class="g">${pct}%</span></span>`;
      })
      .join('');
    const sep = state.scenario ? channelSeparation(state.scenario, c.channel) : null;
    const sepStr = sep && c.channel !== 'LFE'
      ? ` <span class="g" title="observed vs intended arrival azimuth">${sep.observedAzDeg.toFixed(0)}° (Δ${sep.errorDeg.toFixed(0)}°)</span>`
      : '';
    return `<div class="ch-row"><div class="ch-name" style="color:${CH_COLORS[c.channel]}">${c.channel}</div><div class="bars">${bars}${sepStr}</div></div>`;
  }).join('');
  mappingEl.innerHTML = rows;
}

function rmsError(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

// --- canvas drawing ---------------------------------------------------------

function recalcTransform() {
  const room = state.scenario.room;
  const pad = 28;
  const w = canvas.width - 2 * pad, h = canvas.height - 2 * pad;
  state.ppm = Math.min(w / room.width, h / room.height);
  state.offset.x = (canvas.width - room.width * state.ppm) / 2;
  state.offset.y = (canvas.height - room.height * state.ppm) / 2;
}
function toPx(p) { return { x: state.offset.x + p.x * state.ppm, y: state.offset.y + p.y * state.ppm }; }

function draw() {
  if (!state.scenario) return;
  recalcTransform();
  const s = state.scenario;
  const room = s.room;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 5.1 reference fan from the sweet spot (virtual source directions), faint by default
  const sweetPx = toPx(s.sweetSpot);
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (const ch of CHANNELS_5_1) {
    if (ch.id === 'LFE') continue;
    const v = azimuthToVec(ch.azimuthDeg);
    const len = Math.max(room.width, room.height) * state.ppm;
    ctx.beginPath();
    ctx.moveTo(sweetPx.x, sweetPx.y);
    ctx.lineTo(sweetPx.x + v.x * len, sweetPx.y + v.y * len);
    ctx.strokeStyle = CH_COLORS[ch.id];
    ctx.lineWidth = ch.id === state.activeChannel ? 4 : 1.5;
    ctx.globalAlpha = ch.id === state.activeChannel ? 0.5 : 0.18;
    ctx.stroke();
  }
  ctx.restore();

  // room rectangle
  ctx.strokeStyle = '#30363d'; ctx.lineWidth = 2;
  ctx.strokeRect(state.offset.x, state.offset.y, room.width * state.ppm, room.height * state.ppm);
  ctx.fillStyle = '#8b949e'; ctx.font = '11px ui-monospace';
  ctx.fillText(`${room.width} m`, state.offset.x + 4, state.offset.y - 6);
  ctx.save(); ctx.translate(state.offset.x - 6, state.offset.y + 4); ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${room.height} m`, 0, 0); ctx.restore();

  // capture-sweep ripples (animated)
  if (state.anim) drawRipples();

  // true positions (debug overlay)
  if (ui.showTruth.checked) {
    for (let i = 0; i < s.truth.length; i++) {
      const p = toPx(s.truth[i]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#f85149';
      ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#f85149'; ctx.font = '10px ui-monospace';
      ctx.fillText(s.nodes[i].label, p.x + 8, p.y - 6);
    }
  }

  // solved speakers (what the system reports)
  for (let i = 0; i < s.aligned.length; i++) {
    const p = toPx(s.aligned[i]);
    const glow = activeSpeakerGain(s.nodes[i].label);
    let glowOuter = glow > 0.3;
    ctx.save();
    if (glowOuter) {
      ctx.shadowColor = state.activeChannel ? CH_COLORS[state.activeChannel] : '#58a6ff';
      ctx.shadowBlur = 18 * glow;
    }
    // speaker body
    ctx.fillStyle = '#58a6ff';
    ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    // inner mic dot
    ctx.fillStyle = '#0d1117';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#58a6ff'; ctx.font = '10px ui-monospace';
    ctx.fillText(s.nodes[i].label, p.x + 10, p.y + 3);
    ctx.restore();
  }

  // sweet spot marker
  ctx.beginPath(); ctx.arc(sweetPx.x, sweetPx.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#d29922'; ctx.fill();
  ctx.fillStyle = '#d29922'; ctx.font = '11px ui-monospace';
  ctx.fillText('sweet spot', sweetPx.x + 10, sweetPx.y - 8);
}

function activeSpeakerGain(label) {
  if (!state.scenario) return 0;
  if (state.activeChannel == null) return 0;
  let total = 0;
  for (const c of state.scenario.surround) {
    if (c.channel !== state.activeChannel) continue;
    for (const m of c.mapping) if (m.id === label) total += m.gain;
  }
  return Math.min(total, 1);
}

// --- calibration animation --------------------------------------------------

function startCaptureAnim() {
  let anim;
  const schedule = state.scenario.schedule;
  const obs = state.scenario.observations;
  // Slow the wave propagation way down so a human can see it (sound crosses a
  // 5 m room in ~15 ms in reality).
  const TIME_DILATION = 1 / 300;
  anim = { schedule, obs, idx: 0, ppm: state.ppm, startTime: performance.now(), gapSec: 0.3, TIME_DILATION };
  state.anim = anim;
  loop();
}

function loop() {
  if (!state.anim) return;
  const now = performance.now();
  const elapsed = (now - state.anim.startTime) / 1000; // real seconds
  // current emission wraps after gap*TIME_DILATION + longest room traversal
  const room = state.scenario.room;
  const diag = Math.hypot(room.width, room.height) / SPEED_OF_SOUND; // seconds (real)
  const dur = (state.anim.gapSec + diag) * state.anim.TIME_DILATION;
  state.anim.idx = Math.floor(elapsed / dur);
  if (state.anim.idx >= state.anim.schedule.length) {
    state.anim = null;
    draw();
    return;
  }
  draw();
  state.raf = requestAnimationFrame(loop);
}

function drawRipples() {
  const a = state.anim;
  const now = performance.now();
  const elapsed = (now - a.startTime) / 1000;
  const room = state.scenario.room;
  const diag = Math.hypot(room.width, room.height) / SPEED_OF_SOUND;
  const dur = (a.gapSec + diag) * a.TIME_DILATION;
  const local = (elapsed % dur) - a.gapSec * a.TIME_DILATION; // <0 during emit gap
  const emitterId = state.scenario.schedule[a.idx].emitterId;
  const ep = state.scenario.aligned[emitterId];
  const epPx = toPx(ep);
  // emitter flash
  const flash = Math.max(0, 1 - Math.abs(local) * 8);
  if (flash > 0) {
    ctx.beginPath(); ctx.arc(epPx.x, epPx.y, 12 + flash * 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(63,185,80,${flash})`; ctx.lineWidth = 3; ctx.stroke();
  }
  if (local > 0) {
    // ring radius in metres = speed * local_real_time (undilated)
    const realLocal = local / a.TIME_DILATION;
    const rm = SPEED_OF_SOUND * realLocal;
    const rpx = rm * state.ppm;
    ctx.beginPath(); ctx.arc(epPx.x, epPx.y, rpx, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(63,185,80,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    // mark listeners (and echoes, in matched-filter mode) as each wavefront passes
    for (const o of state.scenario.observations) {
      if (o.emitterId !== emitterId || o.listenerId === emitterId) continue;
      const lp = toPx(state.scenario.aligned[o.listenerId]);
      // direct arrival
      if (Math.abs(rm - o.distanceM) < 0.08) {
        ctx.beginPath(); ctx.arc(lp.x, lp.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(88,166,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      }
      // echo arrivals (image-source reflections), drawn from the emitter ring radius
      if (o.arrivalPaths) {
        for (const ap of o.arrivalPaths) {
          if (ap.kind !== 'echo') continue;
          const echoM = ap.delaySec * SPEED_OF_SOUND;
          if (Math.abs(rm - echoM) < 0.08) {
            ctx.beginPath(); ctx.arc(lp.x, lp.y, 16, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(210,153,34,${0.4 + ap.amplitude})`; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
      }
    }
  }
}

// --- channel "play" (visual only, no audio output) -------------------------

const TONE = linearChirp({ durationSec: 0.003, f0Hz: 1000, f1Hz: 3000, sampleRateHz: 48000 });

function concentrationFor(channelId, apply) {
  if (!state.scenario) return null;
  const ch = state.scenario.surround.find((c) => c.channel === channelId);
  if (!ch) return null;
  const { signal } = renderChannelAtSweetSpot(
    TONE, ch, state.scenario.compensation, state.scenario.sweetSpot, 48000, { applyCompensation: apply },
  );
  return renderPeakConcentration(signal);
}

function playChannel() {
  stopChannel();
  const order = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'];
  let i = 0;
  const tick = () => {
    state.activeChannel = order[i % order.length];
    const comp = concentrationFor(state.activeChannel, true);
    const uncomp = concentrationFor(state.activeChannel, false);
    channelStatusEl.textContent =
      `Playing virtual channel ${state.activeChannel} — ` +
      `wavefront concentration: compensated ${(comp ?? 0).toFixed(3)} vs uncompensated ${(uncomp ?? 0).toFixed(3)}`;
    draw();
    i++;
    state.channelTimer = setTimeout(tick, 1100);
  };
  tick();
  ui.playChannel.disabled = true;
  ui.stopChannel.disabled = false;
}
function stopChannel() {
  if (state.channelTimer) clearTimeout(state.channelTimer);
  state.channelTimer = null;
  state.activeChannel = null;
  ui.playChannel.disabled = false;
  ui.stopChannel.disabled = true;
  channelStatusEl.textContent = '';
}

// --- wiring ----------------------------------------------------------------

for (const p of PRESETS) {
  const opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.label;
  ui.preset.append(opt);
}

ui.run.addEventListener('click', runIt);
ui.reseed.addEventListener('click', () => { ui.seed.value = (Math.random() * 1e9) | 0; runIt(); });
ui.playChannel.addEventListener('click', playChannel);
ui.stopChannel.addEventListener('click', stopChannel);
ui.runSizing.addEventListener('click', runSizing);
ui.runBench.addEventListener('click', runBenchUi);
ui.copyLink.addEventListener('click', async () => {
  syncUrlFromUi();
  const url = window.location.href;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      statusEl.textContent = 'Share link copied to clipboard.';
    } else {
      statusEl.textContent = url;
    }
  } catch {
    statusEl.textContent = url;
  }
});
ui.preset.addEventListener('change', () => {
  if (ui.preset.value === 'custom') return;
  applyUiState(presetState(ui.preset.value));
  runIt();
});
ui.showTruth.addEventListener('change', () => { syncUrlFromUi(); draw(); });
ui.captureSweep.addEventListener('change', syncUrlFromUi);
[ui.nodeCount, ui.seed, ui.roomW, ui.roomH, ui.exponent, ui.distanceLaw, ui.captureMode, ui.reflCoef, ui.meshLoss, ui.avgShots].forEach((el) =>
  el.addEventListener('change', () => { syncUrlFromUi(); draw(); }));
ui.earliestPeak.addEventListener('change', syncUrlFromUi);
ui.clockSkew.addEventListener('change', syncUrlFromUi);
ui.robust.addEventListener('change', syncUrlFromUi);

const initialUiState = parseUiStateUrl(window.location.hash);
applyUiState(initialUiState);

// Expose state for Playwright/inspection (per repo convention for vanilla-JS UIs).
window.espArraySim = { state, runIt, runSizing, runBenchUi, readConfig, readUiState, applyUiState, playChannel, stopChannel };

// First paint.
runIt();