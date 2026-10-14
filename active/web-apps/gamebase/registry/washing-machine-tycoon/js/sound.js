// sound.js — Procedural sound effects via Web Audio API
// ====================================================================
// No external audio files needed — generates sounds at runtime.

const SOUND = {
  _ctx: null,
  _masterGain: null,
  _ambienceNode: null,
  enabled: true,
  volume: 0.5,
};

// ---- Init AudioContext (must be called from user gesture) ----

SOUND.init = function() {
  if (SOUND._ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    SOUND._ctx = new AC();
    SOUND._masterGain = SOUND._ctx.createGain();
    SOUND._masterGain.gain.value = SOUND.volume;
    SOUND._masterGain.connect(SOUND._ctx.destination);
  } catch (e) {
    console.warn('🔇 Web Audio not available:', e.message);
    SOUND.enabled = false;
  }
};

// ---- Ensure context is resumed (browsers require user gesture) ----

SOUND.resume = function() {
  if (SOUND._ctx && SOUND._ctx.state === 'suspended') {
    SOUND._ctx.resume();
  }
};

// ---- Master volume ----

SOUND.setVolume = function(v) {
  SOUND.volume = Math.max(0, Math.min(1, v));
  if (SOUND._masterGain) {
    SOUND._masterGain.gain.value = SOUND.volume;
  }
};

// ---- Sound Generators ----

SOUND.play = function(type) {
  if (!SOUND.enabled || !SOUND._ctx) return;
  SOUND.resume();

  switch (type) {
    case 'chime':     SOUND._chime(); break;
    case 'warning':   SOUND._warning(); break;
    case 'critical':  SOUND._critical(); break;
    case 'success':   SOUND._success(); break;
    case 'click':     SOUND._click(); break;
    case 'ambience':  SOUND._startAmbience(); break;
  }
};

// ---- Notification chime (info events) ----

SOUND._chime = function() {
  const ctx = SOUND._ctx;
  const now = ctx.currentTime;

  // Two-tone chime: C5 → E5
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523, now);        // C5
  osc.frequency.setValueAtTime(659, now + 0.1);  // E5
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
  osc.connect(gain);
  gain.connect(SOUND._masterGain);
  osc.start(now);
  osc.stop(now + 0.3);
};

// ---- Warning sound (minor issues) ----

SOUND._warning = function() {
  const ctx = SOUND._ctx;
  const now = ctx.currentTime;

  // Descending tone: E4 → C4
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(330, now);        // E4
  osc.frequency.linearRampToValueAtTime(262, now + 0.25); // C4
  gain.gain.setValueAtTime(0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
  osc.connect(gain);
  gain.connect(SOUND._masterGain);
  osc.start(now);
  osc.stop(now + 0.35);
};

// ---- Critical alert (major failures) ----

SOUND._critical = function() {
  const ctx = SOUND._ctx;
  const now = ctx.currentTime;

  // Alarming rapid pulse
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    const t = now + i * 0.12;
    osc.frequency.setValueAtTime(880, t); // A5
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
    osc.connect(gain);
    gain.connect(SOUND._masterGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }
};

// ---- Success sound (good news) ----

SOUND._success = function() {
  const ctx = SOUND._ctx;
  const now = ctx.currentTime;

  // Rising arpeggio: C5 → E5 → G5 → C6
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const t = now + i * 0.1;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    osc.connect(gain);
    gain.connect(SOUND._masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  });
};

// ---- UI click ----

SOUND._click = function() {
  const ctx = SOUND._ctx;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, now);
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
  osc.connect(gain);
  gain.connect(SOUND._masterGain);
  osc.start(now);
  osc.stop(now + 0.05);
};

// ---- Factory Ambience ----

SOUND._ambienceOsc = null;
SOUND._ambienceGain = null;

SOUND._startAmbience = function() {
  if (SOUND._ambienceOsc) return; // already playing
  const ctx = SOUND._ctx;
  const now = ctx.currentTime;

  // Low hum — filtered noise-like tone
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(55, now); // A1

  // Subtle LFO for movement
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.setValueAtTime(0.5, now);
  lfoGain.gain.setValueAtTime(10, now);
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  lfo.start(now);

  gain.gain.setValueAtTime(0.03, now);
  gain.gain.linearRampToValueAtTime(0.04, now + 2);

  osc.connect(gain);
  gain.connect(SOUND._masterGain);
  osc.start(now);

  SOUND._ambienceOsc = osc;
  SOUND._ambienceGain = gain;
  SOUND._ambienceLFO = lfo;
};

SOUND.stopAmbience = function() {
  if (SOUND._ambienceOsc) {
    const now = SOUND._ctx.currentTime;
    SOUND._ambienceGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    setTimeout(() => {
      try { SOUND._ambienceOsc.stop(); } catch(e) {}
      try { SOUND._ambienceLFO.stop(); } catch(e) {}
      SOUND._ambienceOsc = null;
      SOUND._ambienceGain = null;
      SOUND._ambienceLFO = null;
    }, 600);
  }
};

// ---- Hook into simulation events ----
// Called from SIM.addEvent

SOUND.onEvent = function(level) {
  switch (level) {
    case 'info':     SOUND.play('chime'); break;
    case 'warning':  SOUND.play('warning'); break;
    case 'critical': SOUND.play('critical'); break;
  }
};
