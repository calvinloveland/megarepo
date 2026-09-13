// Cosmetic ranch decor — pure decoration, no gameplay effects.
// Purchases show up as little scenes in Starter Town's meadow (drawn on the
// overworld canvas). Anchors are juicy, passable meadow tiles near the
// Meadow Elder; the renderer draws the emoji at the tile's center.
export interface DecorItem {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  flavor: string;
  anchor: { x: number; y: number };
}

export const DECOR_ITEMS: DecorItem[] = [
  { id: "sunflower-bower", name: "Sunflower Bower", emoji: "🌻", cost: 10, flavor: "A ring of tall suns the calves nap under.",
    anchor: { x: 1, y: 8 } },
  { id: "wildflower-bed", name: "Wildflower Bed", emoji: "🌷", cost: 14, flavor: "Tulips in meadow colors — pretty as a postcard.",
    anchor: { x: 1, y: 9 } },
  { id: "duck-pond", name: "Duck Pond", emoji: "🦆", cost: 18, flavor: "Two ducks, one tin bathtub, zero fuss.",
    anchor: { x: 1, y: 10 } },
  { id: "bee-skeps", name: "Bee Skeps", emoji: "🐝", cost: 20, flavor: "Straw hives that hum near the fence posts.",
    anchor: { x: 2, y: 8 } },
  { id: "hay-hamper", name: "Hay Hamper", emoji: "🧺", cost: 26, flavor: "A lunch hamper that the hooves never touch.",
    anchor: { x: 2, y: 10 } },
  { id: "shade-spindle", name: "Shade Spindle", emoji: "🌳", cost: 22, flavor: "A lonely tree that leans with the mesa winds.",
    anchor: { x: 2, y: 7 } },
  { id: "wishing-well", name: "Wishing Well", emoji: "⛲", cost: 30, flavor: "Toss a credit in — the wells are honest.",
    anchor: { x: 3, y: 10 } },
  { id: "weather-pennant", name: "Weather Pennant", emoji: "🎏", cost: 34, flavor: "A bright line that tells the updraft from the down.",
    anchor: { x: 4, y: 10 } },
];

export function findDecor(id: string): DecorItem | null {
  return DECOR_ITEMS.find((item) => item.id === id) ?? null;
}
