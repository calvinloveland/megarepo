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
  tick: number,
  view: { minX: number; minY: number; width: number; height: number },
  count = 18,
  interior = false,
): Mote[] {
  const kind = weatherForMap(mapId, interior);
  const motes: Mote[] = [];
  const spanX = Math.max(1, view.width);
  const spanY = Math.max(1, view.height);

  for (let index = 0; index < count; index += 1) {
    const seed = index * 977;
    // Each mote has its own slow drift and wobble, both from its seed.
    const driftX = (hash(seed + 1) - 0.5) * 2.2;
    const driftY = (hash(seed + 2) - 0.5) * 1.2;
    const wobble = Math.sin(tick / (28 + hash(seed + 3) * 40) + seed) * (4 + hash(seed + 4) * 6);
    const speed = 0.35 + hash(seed + 5) * 0.9;

    const rawX = hash(seed + 6) * spanX + driftX * tick * speed + wobble;
    const rawY = hash(seed + 7) * spanY + driftY * tick * speed * 0.6 + wobble * 0.4;
    const wrappedX = ((rawX % spanX) + spanX) % spanX;
    const wrappedY = ((rawY % spanY) + spanY) % spanY;
    const pulse = 0.55 + 0.45 * Math.sin(tick / 34 + seed * 1.7);

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

/** Ripple phase for a water tile, so the pond moves instead of sitting still. */
export function waterPhase(tick: number, tileX: number, tileY: number): number {
  return (tick / 26 + (tileX * 0.7 + tileY * 1.3)) % (Math.PI * 2);
}
