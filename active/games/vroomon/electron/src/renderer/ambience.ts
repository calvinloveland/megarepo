// A soft looping pad that breathes under the event sfx, synthesized live
// (no assets) and keyed to the biome you're standing in. It deliberately
// shares no resources with the one-shot sfx cues in audio.ts: those own
// and close a context per cue; this engine keeps one context for the
// whole session and only starts after a user gesture unlocks audio.

export type AmbienceScene =
  | "menu"
  | "meadow"
  | "dunes"
  | "upland"
  | "quarry"
  | "drift"
  | "trackside";

interface SceneProfile {
  /** Root frequency, Hz. */
  root: number;
  /** Harmonic partials, listed as multipliers of the root. */
  partials: number[];
  /** Master pad level (0..1; the engine scales it against the volume). */
  gain: number;
}

const PROFILES: Record<AmbienceScene, SceneProfile> = {
  menu: { root: 110, partials: [1, 1.5, 2.01], gain: 0.16 },
  meadow: { root: 130.81, partials: [1, 1.5, 2.01, 2.98], gain: 0.34 },
  dunes: { root: 98, partials: [1, 1.5, 2.02], gain: 0.3 },
  upland: { root: 174.61, partials: [1, 1.26, 2.01], gain: 0.26 },
  quarry: { root: 87.31, partials: [1, 1.5, 2.04], gain: 0.3 },
  drift: { root: 220, partials: [1, 1.01, 2, 2.99], gain: 0.22 },
  trackside: { root: 146.83, partials: [1, 2.01, 3.01], gain: 0.2 },
};

export type AmbienceVolume = 0 | 1 | 2; // off / low / med

export interface AmbienceSettings {
  enabled: boolean;
  volume: AmbienceVolume;
}

const SETTINGS_KEY = "vroomon:ambience";
const DEFAULT_SETTINGS: AmbienceSettings = { enabled: true, volume: 2 };

export function loadAmbienceSettings(): AmbienceSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<AmbienceSettings>;
    return {
      enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
      volume: parsed.volume === 0 || parsed.volume === 1 || parsed.volume === 2
        ? parsed.volume
        : DEFAULT_SETTINGS.volume,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAmbienceSettings(settings: AmbienceSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the pad simply keeps its current level.
  }
}

/** Scale per volume step while keeping the pad audible but quiet. */
function volumeScalar(volume: AmbienceVolume): number {
  return volume === 0 ? 0 : volume === 1 ? 0.5 : 1;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private voices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private settings: AmbienceSettings = loadAmbienceSettings();
  private masterVolume = 1;
  private sceneRequested: AmbienceScene | null = null;
  private scene: AmbienceScene | null = null;

  /** Call from the first user gesture — browsers gate audio on it. */
  unlock(): void {
    if (this.ctx) {
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        return;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.lowpass = this.ctx.createBiquadFilter();
      this.lowpass.type = "lowpass";
      this.lowpass.frequency.value = 720;
      this.lowpass.Q.value = 0.4;
      this.master.connect(this.lowpass);
      this.lowpass.connect(this.ctx.destination);
      this.applyLevel();
      if (this.ctx.state === "suspended") {
        void this.ctx.resume().catch(() => undefined);
      }
    } catch {
      this.ctx = null;
      return;
    }
    if (this.sceneRequested) {
      this.setScene(this.sceneRequested);
    }
  }

  setScene(scene: AmbienceScene): void {
    this.sceneRequested = scene;
    if (!this.ctx || !this.master) {
      return;
    }
    if (this.scene === scene) {
      return;
    }
    this.scene = scene;
    const profile = PROFILES[scene];
    const now = this.ctx.currentTime;
    // Crossfade out the old voices.
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0.0001, now + 0.6);
    }
    const oldVoices = this.voices;
    setTimeout(() => {
      for (const voice of oldVoices) {
        try {
          voice.osc.stop();
          voice.osc.disconnect();
          voice.gain.disconnect();
        } catch {
          // already stopped
        }
      }
    }, 900);

    this.voices = profile.partials.map((multiplier, index) => {
      const osc = this.ctx!.createOscillator();
      osc.type = index === 0 ? "sine" : "triangle";
      osc.frequency.value = profile.root * multiplier;
      osc.detune.value = index === 0 ? 0 : (index % 2 === 0 ? 3 : -3);
      const gain = this.ctx!.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(profile.gain / profile.partials.length, now + 1.2);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(now);
      return { osc, gain };
    });

    // Slow breathing LFO on the pad master.
    if (this.lfo) {
      try {
        this.lfo.stop();
        this.lfo.disconnect();
      } catch {
        // no-op
      }
    }
    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.value = 0.09;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 0.05;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.master.gain);
    this.lfo.start(now);
  }

  setSettings(settings: AmbienceSettings): void {
    this.settings = settings;
    saveAmbienceSettings(settings);
    this.applyLevel();
    if (settings.enabled && settings.volume > 0) {
      if (this.sceneRequested && this.scene !== this.sceneRequested) {
        this.setScene(this.sceneRequested);
      }
    }
  }

  getSettings(): AmbienceSettings {
    return { ...this.settings };
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, volume));
    this.applyLevel();
  }

  private applyLevel(): void {
    if (this.master) {
      const level = this.settings.enabled && this.settings.volume > 0
        ? volumeScalar(this.settings.volume) * 0.045 * this.masterVolume
        : 0;
      this.master.gain.setTargetAtTime(level, this.ctx?.currentTime ?? 0, 0.4);
    }
  }
}
