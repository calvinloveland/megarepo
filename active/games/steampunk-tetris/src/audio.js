/*
 * Web Audio only — no asset files, no network (PROTOCOL.md / AGENTS.md forbid
 * both). Everything is synthesised from oscillators and noise buffers, so the
 * game stays a handful of text files.
 *
 * The AudioContext is created lazily on the first user gesture because browsers
 * block audio until then. When audio is unavailable every call is a no-op.
 */

export class SteamAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuffer = null;
    this.drone = null;
    this.heat = 0;
  }

  /** Safe to call from any event handler; only builds the graph once. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise();
      this.buildDrone();
    } catch (err) {
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
  }

  /**
   * Boiler drone: two detuned saws through a lowpass, plus a rumble of filtered
   * noise. Silent at pressure 0 and louder, higher and rougher as the level
   * climbs, so the room gets more tense as the stack gets taller.
   */
  buildDrone() {
    const ctx = this.ctx;
    this.drone = { gain: ctx.createGain(), oscs: [], filter: ctx.createBiquadFilter(), noise: null, noiseGain: null };
    this.drone.gain.gain.value = 0;
    this.drone.filter.type = 'lowpass';
    this.drone.filter.frequency.value = 300;
    this.drone.filter.Q.value = 6;
    for (const detune of [-7, 0, 9]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      osc.detune.value = detune;
      osc.connect(this.drone.filter);
      osc.start();
      this.drone.oscs.push(osc);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseGain);
    noiseGain.connect(this.drone.filter);
    this.drone.filter.connect(this.drone.gain);
    this.drone.gain.connect(this.master);
    noise.start();
    this.drone.noise = noise;
    this.drone.noiseGain = noiseGain;
  }

  /** heat: 0 (idle) .. 1 (blowing the doors off). */
  setHeat(heat) {
    this.heat = Math.max(0, Math.min(1, heat || 0));
    if (!this.ready || !this.drone) return;
    const t = this.ctx.currentTime;
    const h = this.heat;
    this.drone.gain.gain.setTargetAtTime(h * h * 0.2, t, 0.5);
    this.drone.noiseGain.gain.setTargetAtTime(h * 0.06, t, 0.5);
    this.drone.filter.frequency.setTargetAtTime(240 + h * 1500, t, 0.5);
    const base = 55 * (1 + h * 0.55);
    for (const osc of this.drone.oscs) osc.frequency.setTargetAtTime(base, t, 0.5);
  }

  /** A pressure-relief burst: the loudest thing in the game. */
  pressureBurst(strength = 1) {
    this.hiss({ dur: 1.1 * strength, gain: 0.4 * strength, from: 2200, to: 240 });
    this.tone({ freq: 220, dur: 0.9 * strength, type: 'sawtooth', gain: 0.16, slideTo: 44 });
    this.tone({ freq: 110, dur: 1.2 * strength, type: 'sine', gain: 0.2, slideTo: 33 });
  }

  makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  get ready() {
    return !!this.ctx && this.enabled;
  }

  tone({ freq = 440, dur = 0.08, type = 'square', gain = 0.12, slideTo = null, delay = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  hiss({ dur = 0.35, gain = 0.22, from = 900, to = 2400, delay = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  move() { this.tone({ freq: 210, dur: 0.035, type: 'square', gain: 0.05 }); }
  rotate() {
    this.tone({ freq: 320, dur: 0.03, type: 'square', gain: 0.05 });
    this.tone({ freq: 480, dur: 0.04, type: 'square', gain: 0.04, delay: 0.03 });
  }
  softDrop() { this.tone({ freq: 150, dur: 0.025, type: 'triangle', gain: 0.05 }); }
  hold() { this.tone({ freq: 260, dur: 0.09, type: 'sawtooth', gain: 0.07, slideTo: 420 }); }

  /** A anvil thud: low sine plus a short metallic noise burst. */
  lock() {
    this.tone({ freq: 120, dur: 0.12, type: 'sine', gain: 0.16, slideTo: 58 });
    this.hiss({ dur: 0.09, gain: 0.1, from: 1800, to: 400 });
  }

  hardDrop() {
    this.tone({ freq: 160, dur: 0.1, type: 'square', gain: 0.1, slideTo: 70 });
    this.hiss({ dur: 0.14, gain: 0.14, from: 2600, to: 600 });
  }

  clear(lines) {
    if (lines >= 4) {
      this.tone({ freq: 261, dur: 0.5, type: 'triangle', gain: 0.16 });
      this.tone({ freq: 392, dur: 0.5, type: 'triangle', gain: 0.14, delay: 0.04 });
      this.tone({ freq: 523, dur: 0.6, type: 'triangle', gain: 0.13, delay: 0.08 });
      this.tone({ freq: 784, dur: 0.7, type: 'sine', gain: 0.1, delay: 0.12 });
      this.tone({ freq: 90, dur: 0.5, type: 'sine', gain: 0.2, slideTo: 45 });
      this.hiss({ dur: 0.75, gain: 0.3, from: 700, to: 3200 });
      return;
    }
    const base = [0, 330, 262, 196][lines] || 330;
    for (let i = 0; i < lines; i++) {
      this.tone({ freq: base * (1 + i * 0.25), dur: 0.22, type: 'triangle', gain: 0.12, delay: i * 0.03 });
    }
    this.hiss({ dur: 0.22 + lines * 0.06, gain: 0.14, from: 900, to: 2200 });
  }

  gameOver() {
    this.tone({ freq: 220, dur: 1.1, type: 'sawtooth', gain: 0.14, slideTo: 55 });
    this.hiss({ dur: 1.2, gain: 0.18, from: 1600, to: 200 });
  }

  levelUp() {
    this.tone({ freq: 523, dur: 0.12, type: 'square', gain: 0.1 });
    this.tone({ freq: 784, dur: 0.18, type: 'square', gain: 0.09, delay: 0.1 });
  }
}
