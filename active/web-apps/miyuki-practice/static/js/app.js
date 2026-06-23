/* === Miyuki Piano Practice App — Synthesia-style falling notes visualizer === */

(function () {
  'use strict';

  // ─── MIDI data ───────────────────────────────────────────────
  const midiData = JSON.parse(document.getElementById('midi-data').textContent);
  const track = midiData.tracks.length > 0
    ? midiData.tracks.reduce((a, b) => (a.notes.length >= b.notes.length ? a : b))
    : { notes: [] };

  const notes = track.notes.map(n => ({
    note: n.note,
    startTick: n.startTick,
    endTick: n.endTick,
    velocity: Math.max(0.2, n.velocity / 127),
  }));
  notes.sort((a, b) => a.startTick - b.startTick);

  const tpq = midiData.ticks_per_quarter;
  const baseBpm = midiData.bpm;
  const totalTicks = midiData.totalTicks || notes[notes.length - 1]?.endTick || 1;

  // ─── State ───────────────────────────────────────────────────
  let bpm = baseBpm;
  let isPlaying = false;
  let currentTick = 0;
  let animationId = null;
  let lastFrameTime = 0;
  let audioCtx = null;
  const keyEls = {};
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FIRST_NOTE = 21;   // A0
  const LAST_NOTE = 108;   // C8

  // Sliding window bounds for note filtering
  let windowStart = 0;   // index into notes[]
  let windowEnd = 0;

  // ─── DOM ─────────────────────────────────────────────────────
  const canvas = document.getElementById('visualizer-canvas');
  const ctx = canvas.getContext('2d');
  const pianoEl = document.getElementById('piano');
  const btnPlay = document.getElementById('btn-play');
  const btnRestart = document.getElementById('btn-restart');
  const tempoVal = document.getElementById('tempo-value');
  const tempoUp = document.getElementById('tempo-up');
  const tempoDown = document.getElementById('tempo-down');
  const slider = document.getElementById('progress-slider');
  const timeCur = document.getElementById('time-current');
  const timeTot = document.getElementById('time-total');
  const measureDisp = document.getElementById('measure-display');
  const infoDur = document.getElementById('info-duration');

  // ─── Helpers ─────────────────────────────────────────────────
  const tickToSec = t => t / tpq / (bpm / 60);
  const secToTick = s => s * tpq * (bpm / 60);

  function fmtTime(s) {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const noteName = n => NOTE_NAMES[n % 12] + Math.floor(n / 12) - 1;

  // ─── Audio ───────────────────────────────────────────────────
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playNote(note, vel) {
    ensureAudio();
    if (!audioCtx) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.detune.setValueAtTime(Math.random() * 4 - 2, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800 + vel * 3200, now);

    const vol = vel * 0.35;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 1.2);

    if (keyEls[note]) {
      keyEls[note].classList.add('pressed');
      setTimeout(() => {
        if (keyEls[note]) keyEls[note].classList.remove('pressed');
      }, 150);
    }
  }

  // ─── Piano keyboard ─────────────────────────────────────────
  function buildPiano() {
    pianoEl.innerHTML = '';
    const whiteKeys = [];
    const blackKeys = [];
    for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
      (NOTE_NAMES[n % 12].includes('#') ? blackKeys : whiteKeys).push(n);
    }

    // White keys
    whiteKeys.forEach(n => {
      const key = document.createElement('div');
      key.className = 'piano-key white';
      key.dataset.note = n;
      const lbl = document.createElement('span');
      lbl.className = 'key-label';
      if (n % 12 === 0) lbl.textContent = `C${Math.floor(n / 12) - 1}`;
      key.appendChild(lbl);
      pianoEl.appendChild(key);
      keyEls[n] = key;
      key.addEventListener('pointerdown', e => { e.preventDefault(); playNote(n, 0.8); });
    });

    // Black keys — position over gaps between white keys
    const ww = 100 / whiteKeys.length;
    const bw = ww * 0.62;
    blackKeys.forEach(n => {
      const leftIdx = whiteKeys.indexOf(n - 1);
      if (leftIdx === -1) return;
      const key = document.createElement('div');
      key.className = 'piano-key black';
      key.dataset.note = n;
      key.style.left = ((leftIdx + 1) * ww - bw / 2) + '%';
      key.style.width = bw + '%';
      pianoEl.appendChild(key);
      keyEls[n] = key;
      key.addEventListener('pointerdown', e => { e.preventDefault(); playNote(n, 0.8); });
    });
  }

  // ─── Canvas drawing ──────────────────────────────────────────
  function draw(cw, ch) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const pianoY = ch * 0.88;
    const noteSpan = LAST_NOTE - FIRST_NOTE;
    if (noteSpan <= 0) return;

    // Time window for visible notes
    const aheadMs = 2000;
    const behindMs = 80;
    const aheadTicks = secToTick(aheadMs / 1000);
    const behindTicks = secToTick(behindMs / 1000);
    const scrollTicks = aheadTicks + behindTicks;
    const scrollPx = pianoY * 0.92;
    const topY = pianoY - scrollPx;

    const visStart = currentTick - behindTicks;
    const visEnd = currentTick + aheadTicks;

    // ── Piano line ──
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, pianoY);
    ctx.lineTo(cw, pianoY);
    ctx.stroke();

    // ── Key separation guides ──
    for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
      const x = ((n - FIRST_NOTE) / noteSpan) * cw;
      const nx = ((n - FIRST_NOTE + 1) / noteSpan) * cw;
      if (NOTE_NAMES[n % 12].includes('#')) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x - (nx - x) * 0.2, pianoY, (nx - x) * 0.4, ch - pianoY);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.015)';
        ctx.fillRect(x, pianoY, nx - x, ch - pianoY);
      }
    }

    // ── Sounding notes (glow on piano line) ──
    // Use binary search to find notes sounding now
    const sounding = [];
    let si = windowStart;
    while (si < windowEnd && notes[si] && notes[si].startTick <= currentTick) {
      if (notes[si].endTick > currentTick) sounding.push(notes[si]);
      si++;
    }
    // Also check any note that started recently but may have ended
    // (the above loop only catches notes that started before currentTick)

    sounding.forEach(n => {
      const x = ((n.note - FIRST_NOTE) / noteSpan) * cw;
      const nw = cw / noteSpan * 0.85;
      const pulse = 0.5 + 0.3 * Math.sin(Date.now() / 180 + n.note);
      ctx.shadowColor = 'rgba(167, 139, 250, 0.5)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = `rgba(167, 139, 250, ${pulse})`;
      roundRect(ctx, x - nw / 2, pianoY - 6, nw, 12, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // ── Falling notes ──
    // Iterate through the visible window
    for (let i = windowStart; i < windowEnd; i++) {
      const n = notes[i];
      if (!n) continue;
      if (n.startTick > visEnd) break;
      if (n.startTick < visStart) continue;

      const progress = (n.startTick - visStart) / scrollTicks;
      if (progress < 0 || progress > 1) continue;

      const x = ((n.note - FIRST_NOTE) / noteSpan) * cw;
      const nw = cw / noteSpan * 0.85;
      const nh = 10 + n.velocity * 6;
      const y = topY + progress * scrollPx - nh / 2;

      const bright = 0.4 + n.velocity * 0.6;
      ctx.shadowColor = `rgba(167, 139, 250, ${0.15 * bright})`;
      ctx.shadowBlur = 6;
      ctx.fillStyle = `rgba(167, 139, 250, ${0.6 + n.velocity * 0.4})`;
      roundRect(ctx, x - nw / 2, y, nw, nh, 3);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.max(7, nh - 2)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName(n.note), x, y + nh / 2);
    }

    ctx.shadowBlur = 0;

    // ── Bottom key labels ──
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let n = FIRST_NOTE; n <= Math.min(FIRST_NOTE + 11, LAST_NOTE); n++) {
      if (NOTE_NAMES[n % 12].includes('#')) continue;
      const x = ((n - FIRST_NOTE) / noteSpan) * cw;
      ctx.fillText(noteName(n), x + (cw / noteSpan) / 2, pianoY + 18);
    }

    // ── Current time indicator ──
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '10px Inter, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtTime(tickToSec(currentTick)), 8, 8);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ─── Update sliding window ──────────────────────────────────
  function updateWindow() {
    const aheadTicks = secToTick(2500 / 1000);
    const behindTicks = secToTick(100 / 1000);
    const lo = currentTick - behindTicks;
    const hi = currentTick + aheadTicks;

    // Advance windowStart
    while (windowStart < notes.length && notes[windowStart] && notes[windowStart].endTick < lo) {
      windowStart++;
    }
    // Expand windowEnd
    while (windowEnd < notes.length && notes[windowEnd] && notes[windowEnd].startTick <= hi) {
      windowEnd++;
    }
  }

  // ─── Update loop ─────────────────────────────────────────────
  function loop(ts) {
    if (!isPlaying) return;

    const dt = lastFrameTime ? (ts - lastFrameTime) / 1000 : 0;
    lastFrameTime = ts;

    const tickAdv = secToTick(Math.min(dt, 0.1)); // cap dt to prevent jumps
    currentTick += tickAdv;

    if (currentTick >= totalTicks) {
      currentTick = totalTicks;
      stopPlayback();
      updateUI();
      const cw = canvas.clientWidth || 800, ch = canvas.clientHeight || 300;
      draw(cw, ch);
      return;
    }

    // Trigger notes starting in this frame
    // Check notes that start in [currentTick - tickAdv, currentTick]
    let idx = Math.max(0, windowStart - 2); // look back a bit
    while (idx < windowEnd) {
      const n = notes[idx];
      if (!n) { idx++; continue; }
      if (n.startTick > currentTick) break;
      if (n.startTick >= currentTick - tickAdv && n.startTick <= currentTick) {
        playNote(n.note, n.velocity);
      }
      idx++;
    }

    updateWindow();
    updateUI();
    const cw = canvas.clientWidth || 800, ch = canvas.clientHeight || 300;
    draw(cw, ch);
    animationId = requestAnimationFrame(loop);
  }

  function stopPlayback() {
    isPlaying = false;
    btnPlay.innerHTML = svgPlay();
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  // ─── UI updates ──────────────────────────────────────────────
  function updateUI() {
    if (totalTicks <= 0) return;
    const prog = clamp(currentTick / totalTicks, 0, 1);
    slider.value = Math.round(prog * 1000);
    timeCur.textContent = fmtTime(tickToSec(currentTick));
    timeTot.textContent = fmtTime(tickToSec(totalTicks));

    const beat = currentTick / tpq;
    const meas = Math.floor(beat / 4) + 1;
    const bi = Math.floor(beat % 4) + 1;
    measureDisp.textContent = `m. ${meas} · ♩ ${bi}`;
  }

  // ─── Controls ────────────────────────────────────────────────
  function svgPlay() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>`;
  }
  function svgPause() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
  }

  function togglePlay() {
    ensureAudio();
    if (isPlaying) {
      stopPlayback();
    } else {
      if (currentTick >= totalTicks) currentTick = 0;
      isPlaying = true;
      lastFrameTime = 0;
      btnPlay.innerHTML = svgPause();
      updateWindow();
      animationId = requestAnimationFrame(loop);
    }
  }

  function restart() {
    stopPlayback();
    currentTick = 0;
    windowStart = 0;
    windowEnd = 0;
    updateWindow();
    updateUI();
    const cw = canvas.clientWidth || 800, ch = canvas.clientHeight || 300;
    draw(cw, ch);
    measureDisp.textContent = '--';
    btnPlay.innerHTML = svgPlay();
  }

  // ─── Canvas resize ───────────────────────────────────────────
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      requestAnimationFrame(resize);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  // ─── Init ────────────────────────────────────────────────────
  function init() {
    buildPiano();
    resize();
    updateWindow();

    const dur = tickToSec(totalTicks);
    infoDur.textContent = fmtTime(dur) + (Number.isFinite(dur) ? ` (${Math.round(dur)}s)` : '');
    timeTot.textContent = fmtTime(dur);
    updateUI();

    const cw = canvas.clientWidth || 800, ch = canvas.clientHeight || 300;
    draw(cw, ch);

    // ── Events ──
    btnPlay.addEventListener('click', togglePlay);
    btnRestart.addEventListener('click', restart);

    tempoUp.addEventListener('click', () => {
      bpm = clamp(Math.round(bpm + 5), 20, 300);
      tempoVal.textContent = bpm;
    });
    tempoDown.addEventListener('click', () => {
      bpm = clamp(Math.round(bpm - 5), 20, 300);
      tempoVal.textContent = bpm;
    });

    slider.addEventListener('input', () => {
      if (isPlaying) stopPlayback();
      currentTick = (slider.value / 1000) * totalTicks;
      windowStart = 0;
      windowEnd = 0;
      updateWindow();
      updateUI();
      const cw2 = canvas.clientWidth || 800, ch2 = canvas.clientHeight || 300;
      draw(cw2, ch2);
    });

    window.addEventListener('resize', () => {
      resize();
      if (!isPlaying) {
        const cw2 = canvas.clientWidth || 800, ch2 = canvas.clientHeight || 300;
        draw(cw2, ch2);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'KeyR') { e.preventDefault(); restart(); }
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById('tab-' + btn.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    });

    // Mode toggle (placeholder)
    document.querySelectorAll('[id^="mode-"]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[id^="mode-"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // ─── Bootstrap ───────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
