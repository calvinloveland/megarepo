// Cosmetic ranch decor — pure decoration, no gameplay effects.
// Purchases show up as little scenes on the overworld canvas (Starter Town's
// meadow by default, plus one extra spot per biome). The renderer draws the
// emoji at the tile's center, scaled up with a grounding shadow.

export interface DecorItem {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  flavor: string;
  anchor: { x: number; y: number };
  /** Extra meadow spots by mapId (the anchor always shows in Starter Town). */
  spots?: Record<string, { x: number; y: number }>;
}

export const DECOR_ITEMS: DecorItem[] = [
  {
    id: "sunflower-bower",
    name: "Sunflower Bower",
    emoji: "🌻",
    cost: 10,
    flavor: "A ring of tall suns the calves nap under.",
    anchor: { x: 1, y: 8 },
    spots: { route_1: { x: 4, y: 9 } },
  },
  {
    id: "wildflower-bed",
    name: "Wildflower Bed",
    emoji: "🌷",
    cost: 14,
    flavor: "Tulips in meadow colors — pretty as a postcard.",
    anchor: { x: 1, y: 9 },
    spots: { route_2: { x: 8, y: 12 } },
  },
  {
    id: "duck-pond",
    name: "Duck Pond",
    emoji: "🦆",
    cost: 18,
    flavor: "Two ducks, one tin bathtub, zero fuss.",
    anchor: { x: 1, y: 10 },
    spots: { hills_map: { x: 7, y: 3 } },
  },
  {
    id: "bee-skeps",
    name: "Bee Skeps",
    emoji: "🐝",
    cost: 20,
    flavor: "Straw hives that hum near the fence posts.",
    anchor: { x: 2, y: 8 },
    spots: { rocky_map: { x: 9, y: 2 } },
  },
  {
    id: "hay-hamper",
    name: "Hay Hamper",
    emoji: "🧺",
    cost: 26,
    flavor: "A lunch hamper that the hooves never touch.",
    anchor: { x: 2, y: 10 },
    spots: { ice_map: { x: 5, y: 2 } },
  },
  {
    id: "shade-spindle",
    name: "Shade Spindle",
    emoji: "🌳",
    cost: 22,
    flavor: "A lonely tree that leans with the mesa winds.",
    anchor: { x: 2, y: 7 },
  },
  {
    id: "wishing-well",
    name: "Wishing Well",
    emoji: "⛲",
    cost: 30,
    flavor: "Toss a credit in — the wells are honest.",
    anchor: { x: 3, y: 10 },
  },
  {
    id: "weather-pennant",
    name: "Weather Pennant",
    emoji: "🎏",
    cost: 34,
    flavor: "A bright line that tells the updraft from the down.",
    anchor: { x: 4, y: 10 },
  },
  {
    id: "salt-road-marker",
    name: "Salt Road Marker",
    emoji: "🪧",
    cost: 16,
    flavor: "A spare post that still points every way at once.",
    anchor: { x: 5, y: 10 },
    spots: { route_2: { x: 13, y: 8 } },
  },
  {
    id: "meadow-lanterns",
    name: "Meadow Lanterns",
    emoji: "🏮",
    cost: 28,
    flavor: "Glassed candle-rings strung low for the dusk herd.",
    anchor: { x: 6, y: 10 },
    spots: { ice_map: { x: 11, y: 3 } },
  },
  {
    id: "roundup-bell",
    name: "Roundup Bell",
    emoji: "🔔",
    cost: 38,
    flavor: "One honest ring when the road opens for a champ.",
    anchor: { x: 3, y: 11 },
    spots: { gym_1: { x: 11, y: 7 } },
  },
  {
    id: "trellis-arch",
    name: "Trellis Arch",
    emoji: "🌺",
    cost: 24,
    flavor: "A rusty frame the highland vines win every summer.",
    anchor: { x: 3, y: 9 },
    spots: { hills_map: { x: 4, y: 9 } },
  },
];

export function findDecor(id: string): DecorItem | null {
  return DECOR_ITEMS.find((item) => item.id === id) ?? null;
}