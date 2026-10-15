// sound.js — Watch Forge audible movement (browser only, optional)
// ================================================================
// Web Audio oscillator engine: a mechanical tick-tock at (a dialed-down
// version of) the champion's beat rate, plus a minute-repeater chime when
// the champion carries the complication. Toggleable from the Forge card.
// No audio assets — everything is synthesized.

'use strict';

(function (root) {
  let ctx = null;
  let enabled = false;
  let beatHz = 2;          // audible tick rate (Hz) — real beat rates are too fast
  let nextTick = 0;
  let chimeOn = false;     // repeater hammer arpeggio when present
  let chimeTimer = 0;
  const CHIME_HAMMER_RATE = 1.4; // taps per second while enabled

  const TICK_LO = 920, TICK_HI = 1240; // Hz of the two escapement clicks

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    return ctx;
  }

  function click(freq, when, dur = 0.012, gain = 0.10) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.01);
  }

  function chimeTap(when) {
    if (!ctx) return;
    // Two gongs, struck twice — a tiny cathedral.
    for (const f of [660, 845]) {
      click(f, when, 0.05, 0.055);
      click(f * 1.003, when + 0.06, 0.04, 0.04);
    }
    click(1250, when + 0.02, 0.02, 0.05);
  }

  // Called every RAF frame; schedules ahead of time.
  function update(nowSec) {
    if (!enabled || !ctx) return;
    if (nowSec < nextTick - 0.02) {
      // Still within the tick window — if chime is due, play it too.
      if (chimeOn && nowSec >= chimeTimer) { chimeTap(ctx.currentTime); chimeTimer = nowSec + 1 / CHIME_HAMMER_RATE; }
      return;
    }
    const t = ctx.currentTime + 0.05;
    click(TICK_LO, t, 0.012, 0.10);
    click(TICK_HI, t + (0.5 / beatHz), 0.012, 0.08);
    nextTick = nowSec + 1 / beatHz;
    if (chimeOn) { chimeTap(t + 0.08); chimeTimer = nowSec + 1 / CHIME_HAMMER_RATE; }
  }

  function setBeat(vph) {
    // 18,000–36,000 vph dialed down ×6000 into the audible 2.5–6 Hz range…
    // but cap at 3 Hz so it stays a pleasant tick, not a buzz.
    beatHz = Math.min(3, Math.max(1.5, vph / 18000 * 2.5));
  }

  function setEnabled(v) {
    enabled = v;
    if (v) {
      ensureCtx();
      if (ctx) { ctx.resume().catch(() => {}); }
      nextTick = 0; chimeTimer = 0;
      // Prime the audio clock so the first tick starts promptly.
      if (ctx) { update(performance.now() / 1000); }
    }
  }

  function setChime(v) { chimeOn = v; }

  const SOUND = { update, setEnabled, setBeat, setChime, isEnabled: () => enabled };
  root.WATCH_SOUND = SOUND;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {}));