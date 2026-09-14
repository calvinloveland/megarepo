// Tiny WebAudio synth — no assets. All cues fail silently when audio is
// unavailable (headless tests, autoplay policies), and each cue owns and
// closes its own context to avoid leaky accumulators.

type ToneOpts = {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  detune?: number;
};

function playTone({ frequency, duration, type = "sine", gain = 0.08, attack = 0.01, detune = 0 }: ToneOpts): void {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return;
  }
  const ctx = new Ctor();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.detune.value = detune;
  osc.connect(g);
  g.connect(ctx.destination);
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration + 0.05);
  osc.onended = () => void ctx.close().catch(() => undefined);
}

function scheduleTone(t: number, opts: ToneOpts): void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.frequency, ctx.currentTime + t);
  osc.connect(g);
  g.connect(ctx.destination);
  const start = ctx.currentTime + t;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.08, start + (opts.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  osc.start(start);
  osc.stop(start + opts.duration + 0.05);
  osc.onended = () => void ctx.close().catch(() => undefined);
}

export const sfx = {
  coin(): void {
    playTone({ frequency: 660, duration: 0.18, type: "triangle", gain: 0.12 });
    playTone({ frequency: 1320, duration: 0.16, type: "triangle", gain: 0.1, attack: 0.02 });
  },
  deny(): void {
    playTone({ frequency: 170, duration: 0.13, type: "square", gain: 0.06 });
  },
  click(): void {
    playTone({ frequency: 880, duration: 0.05, type: "square", gain: 0.03 });
  },
  /** 3-2-1-GO countdown for races. */
  countdown(): void {
    playTone({ frequency: 392, duration: 0.09, type: "square", gain: 0.05 });
    scheduleTone(0.28, { frequency: 392, duration: 0.09, type: "square", gain: 0.05 });
    scheduleTone(0.56, { frequency: 392, duration: 0.09, type: "square", gain: 0.05 });
    scheduleTone(0.84, { frequency: 784, duration: 0.22, type: "sawtooth", gain: 0.09 });
  },
  /** Rising major chord — a win. */
  win(): void {
    scheduleTone(0, { frequency: 523.25, duration: 0.35, type: "triangle", gain: 0.06 });
    scheduleTone(0, { frequency: 659.25, duration: 0.35, type: "triangle", gain: 0.06 });
    scheduleTone(0, { frequency: 783.99, duration: 0.35, type: "triangle", gain: 0.06 });
  },
  /** Low horn — a defeat / quiet result. */
  place(): void {
    playTone({ frequency: 246.94, duration: 0.3, type: "triangle", gain: 0.05 });
    scheduleTone(0.22, { frequency: 220, duration: 0.35, type: "triangle", gain: 0.05 });
  },
  /** Grand finale flurry. */
  fanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      scheduleTone(i * 0.12, { frequency: f, duration: 0.5, type: "triangle", gain: 0.07 });
      scheduleTone(i * 0.12, { frequency: f * 1.005, duration: 0.5, type: "sawtooth", gain: 0.015 });
    });
  },
};
