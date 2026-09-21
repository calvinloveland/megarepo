// Ambient life: the motes, pollen and weather that make a still map feel like
// a place rather than a picture.
//
// Pure functions of (map, tick, size) — no state, no randomness at draw time —
// so the same frame always looks the same, the layer is cheap, and the whole
// thing is testable without a canvas. Each biome gets its own weather: pollen
// over the grass, dust off the sand, snow on the perimeter, ash and grit in
// the quarry.

export interface Mote {
  x: number;
  y: number;
  size: number;
  alpha: number;
  /** Which glyph-ish shape to draw: a drop of pollen, a flake, a grain. */
  kind: "pollen" | "dust" | "snow" | "grit" | "petal";
}

const BIOME_WEATHER: Record<string, Mote["kind"]> = {
  starter_town: "pollen",
  ranch_yard: "pollen",
  marrow_orchard: "petal",
  route_1: "pollen",
  gym_1: "dust",
  route_2: "dust",
  gym_2: "dust",
  hills_map: "dust",
  rocky_map: "grit",
  ice_map: "snow",
  home_ranch: "dust",
};

export function weatherFor(mapId: string): Mote["kind"] {
  return BIOME_WEATHER[mapId] ?? "pollen";
}

/** Interiors see the dust in the air; outdoors the weather of the biome. */
export function weatherForMap(mapId: string, interior: boolean): Mote["kind"] {
  return interior ? "dust" : weatherFor(mapId);
}

function hash(n: number): number {
  let value = (n | 0) + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * Motes for one frame. Positions drift on their own vector and wrap around
 * the window, so a mote leaving the right edge comes back on the left.
 */
export function ambientMotes(
  mapId: string,
  timeMs: number,
  view: { minX: number; minY: number; width: number; height: number },
  count = 18,
  interior = false,
): Mote[] {
  const kind = weatherForMap(mapId, interior);
  const motes: Mote[] = [];
  const spanX = Math.max(1, view.width);
  const spanY = Math.max(1, view.height);
  // Everything below is in SECONDS. The renderer hands us `performance.now()`,
  // and the first version treated milliseconds as if they were ticks: the
  // weather zipped past and the day cycled every five seconds.
  const seconds = timeMs / 1000;

  for (let index = 0; index < count; index += 1) {
    const seed = index * 977;
    // Each mote has its own slow drift and wobble, both from its seed.
    const driftX = (hash(seed + 1) - 0.5) * 2.2;
    const driftY = (hash(seed + 2) - 0.5) * 1.2;
    const wobble = Math.sin(seconds / (2.8 + hash(seed + 3) * 4) + seed) * (4 + hash(seed + 4) * 6);
    const speed = 0.35 + hash(seed + 5) * 0.9;

    const rawX = hash(seed + 6) * spanX + driftX * seconds * 14 * speed + wobble;
    const rawY = hash(seed + 7) * spanY + driftY * seconds * 14 * speed * 0.6 + wobble * 0.4;
    const wrappedX = ((rawX % spanX) + spanX) % spanX;
    const wrappedY = ((rawY % spanY) + spanY) % spanY;
    const pulse = 0.55 + 0.45 * Math.sin(seconds / 3.4 + seed * 1.7);

    motes.push({
      x: view.minX + wrappedX,
      y: view.minY + wrappedY,
      size: kind === "snow" ? 1.6 + hash(seed + 8) * 1.6 : 0.9 + hash(seed + 8) * 1.4,
      alpha: (kind === "snow" ? 0.5 : 0.34) * pulse,
      kind,
    });
  }

  return motes;
}

/** Ripple phase for a water tile: a slow swell, not a strobe. */
export function waterPhase(timeMs: number, tileX: number, tileY: number): number {
  const seconds = timeMs / 1000;
  return (seconds / 2.6 + (tileX * 0.7 + tileY * 1.3)) % (Math.PI * 2);
}


// ---- Time of day -----------------------------------------------------------
// A slow cycle so the world is not frozen at noon. Kept dim on purpose: the
// tint sits over everything, and a heavy hand makes the map unreadable.

/** One full day, in milliseconds (the renderer's clock is `performance.now()`). */
export const DAY_LENGTH_MS = 240_000;

export interface DayTint {
  /** 0 = dawn, 0.25 = morning, 0.5 = afternoon, 0.75 = dusk, then night. */
  phase: number;
  label: "dawn" | "morning" | "afternoon" | "dusk" | "night";
  /** An overlay colour and how strongly to lay it over the map. */
  color: string;
  alpha: number;
}

export function dayPhase(timeMs: number): number {
  return (((timeMs % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
}

export function dayTint(timeMs: number): DayTint {
  const phase = dayPhase(timeMs);
  if (phase < 0.12) {
    return { phase, label: "dawn", color: "#ffd9a8", alpha: 0.10 };
  }
  if (phase < 0.38) {
    return { phase, label: "morning", color: "#fff3c9", alpha: 0.05 };
  }
  if (phase < 0.6) {
    return { phase, label: "afternoon", color: "#ffe9b0", alpha: 0.03 };
  }
  if (phase < 0.78) {
    return { phase, label: "dusk", color: "#ff9d6b", alpha: 0.13 };
  }
  return { phase, label: "night", color: "#2b3f78", alpha: 0.20 };
}

// ---- Footsteps -------------------------------------------------------------
// The ground remembers a few paces: small puffs that fade where the rancher
// (or anyone else) put a foot down.

export interface Track {
  x: number;
  y: number;
  /** When the step was taken (`performance.now()`). */
  at: number;
}

export interface Puff {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/** Dust for the steps taken recently, floored at tile centres. */
export function footstepPuffs(
  tracks: Track[],
  timeMs: number,
  options: { lifeMs?: number; count?: number; tileSize?: number } = {},
): Puff[] {
  const life = options.lifeMs ?? 340;
  const count = options.count ?? 6;
  const tileSize = options.tileSize ?? 32;
  const puffs: Puff[] = [];

  for (const track of tracks.slice(-count)) {
    const age = timeMs - track.at;
    if (age < 0 || age > life) {
      continue;
    }
    const fade = 1 - age / life;
    puffs.push({
      x: track.x * tileSize + tileSize / 2,
      y: track.y * tileSize + tileSize - 4,
      radius: 3 + (1 - fade) * 4,
      alpha: 0.22 * fade,
    });
  }

  return puffs;
}


// ---- Room light ------------------------------------------------------------
// Indoors there is a lamp somewhere and it should read as one: a warm pool
// that breathes, so a room is lit rather than merely drawn.

export interface LampGlow {
  /** Where the pool sits, in map pixels. */
  x: number;
  y: number;
  radius: number;
  /** 0..1, already pulsed. */
  intensity: number;
}

/** A lamp's pool for a room of this size, breathing slowly. */
export function lampGlow(
  timeMs: number,
  map: { width: number; height: number },
  options: { radius?: number; intensity?: number } = {},
): LampGlow {
  const seconds = timeMs / 1000;
  const baseRadius = options.radius ?? Math.max(map.width, map.height) * 22;
  const pulse = 0.88 + 0.12 * Math.sin(seconds / 2.1);
  return {
    x: (map.width / 2) * 32,
    y: (map.height / 2) * 32,
    radius: baseRadius * pulse,
    intensity: (options.intensity ?? 0.22) * pulse,
  };
}


/** Is it the dark hours? One definition, so the watchman's shift and the
 * wild's behaviour agree with the clock. */
export function isNight(timeMs: number): boolean {
  return dayTint(timeMs).label === "night";
}

// ---- Lit windows -----------------------------------------------------------
// At night the buildings should look occupied. Each window (a door or building
// tile) gets a small warm rectangle whose brightness follows the same clock as
// the daylight.

/** How lit a window is right now: 0 by day, up to 1 in the dark hours. */
export function windowLight(timeMs: number): number {
  const phase = dayPhase(timeMs);
  // Lights come on through dusk and go out after dawn.
  if (phase < 0.72) {
    return 0;
  }
  if (phase < 0.8) {
    return (phase - 0.72) / 0.08;
  }
  if (phase <= 0.96) {
    return 1;
  }
  return Math.max(0, (1.06 - phase) / 0.1);
}
