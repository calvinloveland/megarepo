// Weather, on the same clock as everything else.
//
// The catch: this is an evolution simulator, and a fitness that drifts with
// the wall clock is a bug, not a feature. The lab, the heritage tree, the
// circuit and the player's test drives always run CLEAR, so a breed line and a
// feud bar mean the same thing every time. Weather applies where a race is
// already a one-off: the wild encounter you are standing in.
//
// What it changes is not just "everyone is slower". A shower cuts the grip a
// wheel can put down, which costs a car that spins its drive away and barely
// touches one with drive on every wheel that is touching the ground — so the
// same two cars can swap places depending on the sky.

import { slotForPhase } from "./routines.js";

export type WeatherKind = "clear" | "shower" | "gale" | "mist";

export interface Weather {
  kind: WeatherKind;
  label: string;
  /**
   * Multiplier on how much grip a wheel puts down. 1 = dry. Below 1 the
   * drive has to be delivered through wheels that are actually loaded.
   */
  grip: number;
  /** Multiplier on drive authority: wind and water cost you top speed. */
  drive: number;
  /** One line for the race card. */
  note: string;
}

const TABLE: Record<WeatherKind, Weather> = {
  clear: {
    kind: "clear",
    label: "clear",
    grip: 1,
    drive: 1,
    note: "Dry ground and a long view.",
  },
  shower: {
    kind: "shower",
    label: "shower",
    grip: 0.72,
    drive: 0.94,
    note: "Wet grass: grip is what you brought, not what you asked for.",
  },
  gale: {
    kind: "gale",
    label: "gale",
    grip: 0.92,
    drive: 0.82,
    note: "A crosswind off the ridge — power counts for less up here.",
  },
  mist: {
    kind: "mist",
    label: "mist",
    grip: 0.88,
    drive: 0.97,
    note: "Thin mist: the ground reads the same, the driver doesn't.",
  },
};

/** One weather, by name — used wherever a caller wants to pin it. */
export function weatherOf(kind: WeatherKind): Weather {
  return TABLE[kind];
}

/**
 * The sky right now: weather follows the hour, using the same day slots the
 * shifts and the day tint use (dawn, morning, afternoon, dusk, night). Mornings
 * clear, afternoons wet, gales at dusk, mist by night — so a shower is
 * something you can wait out rather than a dice roll per race.
 */
export function weatherAt(timeMs: number, phase: number): Weather {
  void timeMs;
  const slot = slotForPhase(phase);
  const kind: WeatherKind =
    slot === "dawn"
      ? "clear"
      : slot === "morning"
        ? "clear"
        : slot === "afternoon"
          ? "shower"
          : slot === "dusk"
            ? "gale"
            : "mist";
  return TABLE[kind];
}

/** Does this weather change the grip a car can use? */
export function isWet(weather: Weather): boolean {
  return weather.grip < 1;
}


/**
 * How much harder the circuit is in this sky, as a multiplier on its bar.
 *
 * This is the *only* way weather touches the campaign, and it is deliberately
 * lopsided: the bar is the ground's demand, so bad weather raises it, while a
 * champion's recorded score was set in clear conditions and does not move. A
 * shower can therefore turn a win into "short by sixty" — a defence modifier
 * rather than a fitness change, which is what keeps the lab, the ledger and
 * every measurement reproducible.
 */
export function weatherDefence(weather: Weather): number {
  switch (weather.kind) {
    case "clear":
      return 1;
    case "shower":
      return 1.12;
    case "gale":
      return 1.07;
    case "mist":
      return 1.03;
    default:
      return 1;
  }
}


/**
 * The sky over an encounter. Robby's first lesson waits for a clear spell:
 * a tutorial catch that can be rained off teaches the wrong thing (and the
 * player has exactly one car and no way to know why they lost).
 */
export function encounterWeather(options: {
  timeMs: number;
  phase: number;
  tutorial?: boolean;
}): Weather {
  if (options.tutorial) {
    return TABLE.clear;
  }
  return weatherAt(options.timeMs, options.phase);
}
