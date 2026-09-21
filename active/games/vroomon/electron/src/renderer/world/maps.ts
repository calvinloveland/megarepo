import type { TileKind, Tilemap } from "./types.js";

function row(...cells: TileKind[]): TileKind[] {
  return cells;
}

const STARTER_TOWN_TILES: TileKind[][] = [
  // Two gates in the north wall: the ranch doorstep at 8, and the lane up to
  // Marrow Orchard at 10.
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "doormat", "tree", "doormat", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "building", "door", "building", "path", "door", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "doormat", "path", "path", "doormat", "path", "path", "path", "path", "grass", "tree"),
  // The well head and two market stalls, drawn with tiles the world already
  // has (counters are walkable, so the square's paths stay open).
  row("tree", "grass", "path", "counter", "path", "counter", "counter", "path", "path", "counter", "counter", "path", "counter", "path", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "path", "doormat", "path", "path", "path", "path", "path", "path", "path", "path", "doormat", "path", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "grass", "grass", "grass", "tree", "tree", "tree", "tree", "tree", "grass", "grass", "grass", "grass", "tree", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const ROUTE_1_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "rock", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "grass", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "grass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const GYM_1_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  // The back room's door in the west wall, with a mat on the arena floor.
  row("door", "doormat", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall", "wall"),
];

const TILE_TO_X: Record<string, number> = {};

// The ranch is TWO spaces: a house you walk around inside, and the yard
// outside it. They are separate maps joined by the porch, so "indoors" is a
// place rather than a corner of one big picture.
const HOME_INTERIOR_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "bed", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall", "wall"),
];

const RANCH_YARD_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "doormat", "doormat", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tall-grass-edge", "tall-grass-edge", "tall-grass-edge", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tall-grass-edge", "tall-grass-edge", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tall-grass-edge", "tall-grass-edge", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "doormat", "doormat", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const MARROW_ORCHARD_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "path", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "fence", "fence", "fence", "fence", "fence", "grass", "grass", "grass", "grass", "path", "grass", "fence", "fence", "fence", "fence", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "water", "water", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "water", "water", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "rock", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "fence", "fence", "fence", "fence", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "doormat", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const LONG_HAUL_TILES: TileKind[][] = [
  row("rock", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "rock"),
  row("tree", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "tree"),
  row("tree", "path", "building", "building", "building", "path", "rock", "rock", "grass", "grass", "grass", "path", "building", "building", "building", "path", "rock", "tree"),
  row("tree", "path", "building", "door", "building", "path", "grass", "grass", "grass", "grass", "grass", "path", "building", "door", "building", "path", "grass", "tree"),
  row("tree", "path", "path", "doormat", "path", "path", "grass", "grass", "rock", "grass", "grass", "path", "path", "doormat", "path", "path", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "water", "water", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "water", "water", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "fence", "fence", "fence", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "fence", "fence", "fence", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "tree"),
  row("rock", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "rock"),
];

const COOKHOUSE_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "wall"),
  row("wall", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

const WORKSHOP_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "counter", "indoor-floor", "indoor-floor", "counter", "counter", "wall"),
  row("wall", "indoor-floor", "rock", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "rock", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

const SWITCHBACK_TILES: TileKind[][] = [
  row("rock", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "rock"),
  row("tree", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "path", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "path", "grass", "tree"),
  row("tree", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "tree"),
  row("tree", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "tree"),
  row("tree", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "tree"),
  row("rock", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "rock"),
];

const CUT_TILES: TileKind[][] = [
  row("rock", "rock", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "rock", "rock"),
  row("rock", "tree", "grass", "grass", "rock", "rock", "grass", "grass", "rock", "rock", "grass", "grass", "tree", "rock"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "path", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "path", "grass", "tree"),
  row("tree", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "tree"),
  row("tree", "grass", "path", "grass", "grass", "grass", "water", "water", "grass", "grass", "grass", "path", "grass", "tree"),
  row("tree", "grass", "path", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "path", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("rock", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "rock"),
];

const DEPOT_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  // The fuel shed: two bays and a door onto the depot road.
  row("tree", "building", "building", "building", "grass", "grass", "door", "path", "grass", "grass", "building", "building", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "doormat", "path", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "vroomgrass", "grass", "path", "path", "grass", "vroomgrass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "rock", "grass", "vroomgrass", "grass", "path", "path", "grass", "vroomgrass", "grass", "rock", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "path", "path", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "doormat", "doormat", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const SCHOOLHOUSE_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "wall"),
  row("wall", "indoor-floor", "counter", "counter", "counter", "indoor-floor", "indoor-floor", "counter", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

const TOWN_STORE_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "counter", "counter", "counter", "counter", "counter", "counter", "counter", "counter", "counter", "counter", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

const FREIGHT_OFFICE_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "counter", "counter", "counter", "counter", "indoor-floor", "indoor-floor", "counter", "counter", "counter", "counter", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

const FUEL_SHED_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "rock", "indoor-floor", "indoor-floor", "rock", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

const BACK_ROOM_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "counter", "counter", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "counter", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall"),
];

export const MAPS: Record<string, Tilemap> = {

  rustler_tack_room: {
    id: "rustler_tack_room",
    name: "The Tack Room",
    width: 12,
    height: 6,
    interior: true,
    tiles: BACK_ROOM_TILES,
    ambientColor: "#cdb488",
    npcs: [
      {
        id: "groom-millie",
        name: "Groom Millie",
        x: 7,
        y: 3,
        facing: "left",
        sprite: "villager",
        dialogue: {
          text: "I keep the Reds' tack and I know every strap of it. A champion isn't a fast car, it's a fast car that still finishes — and I've seen more of them ruined in the last hundred metres than in the first.",
          options: [
            { label: "What ruins them at the end?", next: "millie-end" },
            { label: "I'll bring you a finisher", next: "millie-job" },
            { label: "Thanks", next: "millie-thanks" },
          ],
        },
      },
      {
        id: "millie-end",
        name: "Groom Millie",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: {
          text: "A frame that folds, a wheel that stops getting drive. Read the blueprint before you race — the inspector prints the drive at every wheel, and it is never wrong.",
        },
      },
      {
        id: "millie-job",
        name: "Groom Millie",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: {
          text: "Twelve hundred on the flat and I'll tack it up myself. That's a finisher's number.",
          setFlag: "quest-tack-accepted",
        },
      },
      {
        id: "millie-thanks",
        name: "Groom Millie",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: { text: "Mind the straps on your way out. They're older than you." },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "gym_1", toX: 2, toY: 7, facing: "down" },
      "6,5": { mapId: "gym_1", toX: 2, toY: 7, facing: "down" },
    },
  },
  salt_post_weighbridge: {
    id: "salt_post_weighbridge",
    name: "The Weighbridge",
    width: 12,
    height: 6,
    interior: true,
    tiles: BACK_ROOM_TILES,
    ambientColor: "#cbb083",
    npcs: [
      {
        id: "weighmaster-tuck",
        name: "Weighmaster Tuck",
        x: 4,
        y: 3,
        facing: "right",
        sprite: "mechanic",
        dialogue: {
          text: "Everything that runs the Salt Road gets weighed here first. Freight, cars, excuses. The Stretch doesn't care what you meant to do — only what came off the scale.",
          options: [
            { label: "What's the Stretch like?", next: "tuck-stretch" },
            { label: "I'll weigh in with a race", next: "tuck-job" },
            { label: "Just reading the board", next: "tuck-board" },
          ],
        },
      },
      {
        id: "tuck-stretch",
        name: "Weighmaster Tuck",
        x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: {
          text: "Sand gives and takes. Light cars float over it, heavy cars dig in — and the wild out there is bred to both, so bring whichever your line does better.",
        },
      },
      {
        id: "tuck-job",
        name: "Weighmaster Tuck",
        x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: {
          text: "Two wild ones beaten on the Stretch and I'll sign your weight off. No signature, no freight rate.",
          setFlag: "quest-weigh-accepted",
        },
      },
      {
        id: "tuck-board",
        name: "Weighmaster Tuck",
        x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "The board's the truth. Everything else is a story about the board." },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "gym_2", toX: 2, toY: 7, facing: "down" },
      "6,5": { mapId: "gym_2", toX: 2, toY: 7, facing: "down" },
    },
  },

  salt_road_freight: {
    id: "salt_road_freight",
    name: "Salt Road Freight",
    width: 12,
    height: 6,
    interior: true,
    tiles: FREIGHT_OFFICE_TILES,
    ambientColor: "#c9b183",
    npcs: [
      {
        id: "clerk-nessa",
        name: "Clerk Nessa",
        x: 3,
        y: 3,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Every crate on this road goes through my ledger. I know what a herd is worth by the numbers, not by the noise — and I know when a line has stopped moving.",
          options: [
            { label: "What do the numbers say?", next: "nessa-numbers" },
            { label: "I'll turn a line over for you", next: "nessa-job" },
            { label: "Just looking", next: "nessa-look" },
          ],
        },
      },
      {
        id: "nessa-numbers",
        name: "Clerk Nessa",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: {
          text: "A herd that never turns over is capital sitting still. Ten generations and the road starts paying for itself — the carriers' owners know it, and so does the counter in town.",
        },
      },
      {
        id: "nessa-job",
        name: "Clerk Nessa",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: {
          text: "Ten generations on the bench. Show me a line that moves and I'll write you a rate for it.",
          setFlag: "quest-ledger-accepted",
        },
      },
      {
        id: "nessa-look",
        name: "Clerk Nessa",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: { text: "Everything on the shelves has a number. Nothing has a story." },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "route_2", toX: 4, toY: 2, facing: "down" },
      "6,5": { mapId: "route_2", toX: 4, toY: 2, facing: "down" },
    },
  },
  long_light_shed: {
    id: "long_light_shed",
    name: "The Fuel Shed",
    width: 12,
    height: 6,
    interior: true,
    tiles: FUEL_SHED_TILES,
    ambientColor: "#bcc7cf",
    npcs: [
      {
        id: "stoker-vane",
        name: "Stoker Vane",
        x: 5,
        y: 2,
        facing: "down",
        sprite: "mechanic",
        // The shed is only staffed after dark.
        hours: { from: 0.78, to: 0.12 },
        dialogue: {
          text: "I load the cans and I count what comes back. Nights are mine — the haulers sleep and the wild runs, so the depot's mine until morning.",
          options: [
            { label: "Why do the haulers sleep?", next: "vane-haulers" },
            { label: "I'll take the night shift", next: "vane-job" },
            { label: "Keep the lamp lit", next: "vane-lamp" },
          ],
        },
      },
      {
        id: "vane-haulers",
        name: "Stoker Vane",
        x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: {
          text: "Because nothing good happens on the ice after dark, and everything fast does. Same pack, colder air, and they run it better. Pell up the road will tell you the same.",
        },
      },
      {
        id: "vane-job",
        name: "Stoker Vane",
        x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: {
          text: "One off the ice, at night, and bring the can back full. That's the shift.",
          setFlag: "quest-shed-accepted",
        },
      },
      {
        id: "vane-lamp",
        name: "Stoker Vane",
        x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "It's always lit. That's the whole job." },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "long_light_depot", toX: 6, toY: 3, facing: "down" },
      "6,5": { mapId: "long_light_depot", toX: 6, toY: 3, facing: "down" },
    },
  },
  town_schoolhouse: {
    id: "town_schoolhouse",
    name: "The Schoolhouse",
    width: 12,
    height: 6,
    interior: true,
    tiles: SCHOOLHOUSE_TILES,
    ambientColor: "#c9b183",
    npcs: [
      {
        id: "professor-axle",
        name: "Professor Axle",
        x: 8,
        y: 3,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Welcome to the lab, kid! I'm Professor Axle. The Continent of Vroom is full of evolving vehicles. Here, take this starter DNA and a Hall of Fame key.",
          next: "professor-axle-2",
        },
      },
      {
        id: "professor-axle-2",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Head east on Route 1, walk through the Vroomgrass to capture wild DNA, and when you reach Rustler Pasture, choose your ranch: the Greensprouts' meadow or the Reds' summer circuit. Your Herd Book fills as you go.",
          options: [
            { label: "What is a Herd Book?", next: "vroomdex-explain" },
            { label: "How do I breed a champion?", next: "breed-champion-explain" },
            { label: "Got it, thanks!", next: "professor-farewell" },
          ],
        },
      },      {
        id: "vroomdex-explain",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Every vehicle you encounter leaves a DNA fingerprint in your Herd Book. Track the wheels, chassis, and powertrains you've seen. The data is precious — every specimen counts.",
          onComplete: "vroomdex",
        },
      },
      {
        id: "breed-champion-explain",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "It happens in the paddock, not on the road. Your starters sit on the breeding bench: run a generation and the fast ones rise, then save the best to the Record Barn. The Barn tests any car on any terrain, and the records board keeps every lap. A champion is just a name on that board.",
          onComplete: "vroomdex",
        },
      },
      {
        id: "professor-farewell",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: { text: "Race a champion, win a Brand, and outrun the road. The meadow's watching, kid.", setFlag: "met-axle" },
      },
      {
        id: "pup-tam",
        name: "Pup Tam",
        x: 2,
        y: 4,
        facing: "right",
        sprite: "villager",
        dialogue: {
          text: "Axle lets me sit in on the lessons if I sweep up. I know the important one already: the bench doesn't care how fast your car is, only how fast the next one is.",
          options: [
            { label: "What makes a car fast, then?", next: "tam-fast" },
            { label: "Why does the order matter?", next: "tam-order" },
            { label: "Seen anything worth seeing?", next: "tam-errand" },
          ],
        },
      },
      {
        id: "tam-fast",
        name: "Pup Tam",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Two paths, Axle says. Plates and wheels make the body — how much it weighs, how much tilt it drags around. Cylinders and shafts and gears make the power, and power only counts if it reaches a wheel. A fast car is a short heavy thing that pushes where it stands.",
        },
      },
      {
        id: "tam-order",
        name: "Pup Tam",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Because the chain runs one way! An engine behind a wheel can't turn it — that's the mistake everybody makes. Put the cylinder first, then the wheels it has to reach. Axle made me draw it forty times.",
        },
      },
      {
        id: "tam-errand",
        name: "Pup Tam",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "I've never been past the town gate. If you climb the Highland Mesa, come back and tell me what you can see from up there — I'll pay you out of my sweeping money.",
          setFlag: "quest-tam-errand-accepted",
        },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "starter_town", toX: 6, toY: 3, facing: "down" },
      "6,5": { mapId: "starter_town", toX: 6, toY: 3, facing: "down" },
    },
  },
  town_store: {
    id: "town_store",
    name: "The Supply Store",
    width: 12,
    height: 6,
    interior: true,
    tiles: TOWN_STORE_TILES,
    ambientColor: "#cdb488",
    npcs: [
      {
        id: "storekeep-bram",
        name: "Storekeep Bram",
        x: 5,
        y: 3,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Grain, gearset grease, and gossip — I sell all three. What I don't sell is a reason to stay in town: the roads out there are where a herd is made.",
          options: [
            { label: "What's worth walking to?", next: "bram-road" },
            { label: "I'll walk one for you", next: "bram-job" },
            { label: "Just browsing", next: "bram-browse" },
          ],
        },
      },
      {
        id: "bram-road",
        name: "Storekeep Bram",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Every road has a landmark now. A cable station up the Mesa face, a cutting in the quarry, the last depot before the ice. Walk to any of them and you'll come back with something to sell me.",
        },
      },
      {
        id: "bram-job",
        name: "Storekeep Bram",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "The switchback above the Mesa — walk it and tell me what the cable hand says about light cars. That's worth paying for.",
          setFlag: "quest-roadwalk-accepted",
        },
      },
      {
        id: "bram-browse",
        name: "Storekeep Bram",
        x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: { text: "Browse away. Everything here is heavier than it looks." },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "starter_town", toX: 9, toY: 3, facing: "down" },
      "6,5": { mapId: "starter_town", toX: 9, toY: 3, facing: "down" },
    },
  },

  mesa_switchback: {
    id: "mesa_switchback",
    name: "The Switchback",
    width: 14,
    height: 10,
    tiles: SWITCHBACK_TILES,
    ambientColor: "#c2b184",
    npcs: [
      {
        id: "cable-hand-juno",
        name: "Cable-hand Juno",
        x: 3,
        y: 6,
        facing: "right",
        sprite: "rider",
        dialogue: {
          text: "I run the cable car up the mesa face. Everything that climbs this road goes past me, and I can tell you: the Hills eat light cars. Bring me one that climbs and I'll sign the log for you.",
          options: [
            { label: "What does the Hills road want?", next: "juno-hills" },
            { label: "I'll bring you a climber", next: "juno-job" },
            { label: "Just looking", next: "juno-look" },
          ],
        },
      },
      {
        id: "juno-hills",
        name: "Cable-hand Juno",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Power past the obstacle, not into it. A car with its drive on the wheel that's still touching the ground clears the ridge; one with a folded frame digs in and stalls. The inspector prints the drive at every wheel — read it before you race uphill.",
        },
      },
      {
        id: "juno-job",
        name: "Cable-hand Juno",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Nine hundred on the Mesa and I'll log the climb. Your name and the height, side by side.",
          setFlag: "quest-switchback-accepted",
        },
      },
      {
        id: "juno-look",
        name: "Cable-hand Juno",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Then mind the cables. They hum when the car's coming down." },
      },
      {
        id: "signal-lorn",
        name: "Signal Lorn",
        x: 10,
        y: 7,
        facing: "left",
        sprite: "rider",
        // Out between dusk and dawn, like the other night watches.
        hours: { from: 0.78, to: 0.12 },
        dialogue: {
          text: "I mind the cable lamps. Every car that comes up this face at night gets counted twice - once going up and once for how it comes back down.",
          options: [
            { label: "What's different at night?", next: "lorn-night" },
            { label: "I'll run the face for you", next: "lorn-job" },
            { label: "Keep the lamps lit", next: "lorn-lamp" },
          ],
        },
      },
      { id: "lorn-night", name: "Signal Lorn", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "The lamps make a false summit out of nothing, and the wind comes down the gullies cold. Cars that grip do fine. Cars that don't, I log." } },
      { id: "lorn-job", name: "Signal Lorn", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Two of the Mesa's wild stock beaten on Mesa ground, past dark. I'll log it either way, but I'll pay for it.", setFlag: "quest-lamps-accepted" } },
      { id: "lorn-lamp", name: "Signal Lorn", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "They're lit. That's the whole watch." } },
      {
        id: "climber-tez",
        name: "Tez",
        x: 10,
        y: 3,
        facing: "left",
        sprite: "rival",
        dialogue: {
          text: "Everyone with a fast car comes up here to prove it climbs. Mine's geared short and it eats this road. Want to find out whose frame holds?",
          options: [
            { label: "Up the switchback", next: "tez-race" },
            { label: "Not today", next: "tez-pass" },
          ],
        },
      },
      {
        id: "tez-race",
        name: "Tez",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: { text: "First switchback, then the ridge. Go.", onComplete: "trainer", rivalDna: "Lhn4yi8zKRd2" },
      },
      {
        id: "tez-pass",
        name: "Tez",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: { text: "The ridge isn't going anywhere. Neither am I." },
      },
    ],
    encounters: {},
    transitions: {
      "6,8": { mapId: "hills_map", toX: 5, toY: 7, facing: "down" },
      "7,8": { mapId: "hills_map", toX: 6, toY: 7, facing: "down" },
    },
  },
  the_cut: {
    id: "the_cut",
    name: "The Cut",
    width: 14,
    height: 9,
    tiles: CUT_TILES,
    ambientColor: "#b8a98c",
    npcs: [
      {
        id: "powder-monkey-bex",
        name: "Powder Monkey Bex",
        x: 4,
        y: 4,
        facing: "right",
        sprite: "mechanic",
        dialogue: {
          text: "We blow the face, they haul the spoil, and every hauler breaks an axle on the way out. Want to know what survives this ground? Weight. Not power — weight, and a frame that doesn't fold when the front wheel drops.",
        },
      },
      {
        id: "night-powder-peg",
        name: "Night Powder Peg",
        x: 5,
        y: 6,
        facing: "left",
        sprite: "mechanic",
        // Out between dusk and dawn, like the other night watches.
        hours: { from: 0.78, to: 0.12 },
        dialogue: {
          text: "No blasting after dark - that's the rule and I'm the reason it exists. Now I just count what comes off the spoil heap and what gets left on it.",
          options: [
            { label: "What gets left on it?", next: "peg-left" },
            { label: "I'll take a night run", next: "peg-job" },
            { label: "Mind the fuse", next: "peg-fuse" },
          ],
        },
      },
      { id: "peg-left", name: "Night Powder Peg", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Folded frames, mostly. The rock doesn't care how fast you were going uphill. Bring one that holds and I'll write it in the book." } },
      { id: "peg-job", name: "Night Powder Peg", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Two wild ones beaten in the Quarry after dark. The spoil heap is quiet then and I'll hear you coming.", setFlag: "quest-nightcut-accepted" } },
      { id: "peg-fuse", name: "Night Powder Peg", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "There's no fuse lit at night. That's the whole point of me." } },
      {
        id: "face-boss-halg",
        name: "Face Boss Halg",
        x: 10,
        y: 4,
        facing: "left",
        sprite: "rider",
        dialogue: {
          text: "You're not on my crew. Good — then you're a racer, and racers bring me something to watch. A thousand on this rock and I'll buy you a night at the cookhouse.",
          options: [
            { label: "A thousand on the Quarry", next: "halg-job" },
            { label: "Tell me about this ground", next: "halg-ground" },
            { label: "Later", next: "halg-later" },
          ],
        },
      },
      {
        id: "halg-job",
        name: "Face Boss Halg",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "A thousand, on rock, in one run. No favours from the spoil heap.",
          setFlag: "quest-cut-accepted",
        },
      },
      {
        id: "halg-ground",
        name: "Face Boss Halg",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Rocks don't move, so you go over them. Long frame, drive on both axles, and enough weight at the back to keep the nose down.",
        },
      },
      {
        id: "halg-later",
        name: "Face Boss Halg",
        x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Then watch the blast, at least. Everyone watches the blast." },
      },
    ],
    encounters: {},
    transitions: {
      "6,7": { mapId: "rocky_map", toX: 5, toY: 7, facing: "down" },
      "7,7": { mapId: "rocky_map", toX: 6, toY: 7, facing: "down" },
    },
  },
  long_light_depot: {
    id: "long_light_depot",
    name: "The Long Light Depot",
    width: 14,
    height: 9,
    tiles: DEPOT_TILES,
    ambientColor: "#cdd8de",
    npcs: [
      {
        id: "depot-keeper-sable",
        name: "Depot Keeper Sable",
        x: 3,
        y: 5,
        facing: "right",
        sprite: "professor",
        dialogue: {
          text: "This is the last fuel and the last roof before the perimeter. Everything that comes off that ice stops here first — including your herd, if you're fool enough to race it out there.",
          options: [
            { label: "What's out on the ice?", next: "sable-ice" },
            { label: "I'll race it", next: "sable-job" },
            { label: "Need anything brought in?", next: "sable-storage" },
            { label: "Just sheltering", next: "sable-warm" },
          ],
        },
      },
      {
        id: "sable-ice",
        name: "Depot Keeper Sable",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Nothing, and it's fast. Ice has no grip, so a car that spins a wheel loses the run — the wild out there is bred patient and smooth. Beat one on that ground and you've beaten a specialist.",
        },
      },
      {
        id: "sable-job",
        name: "Depot Keeper Sable",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Eleven hundred on the Drift Perimeter. Bring me that and I'll load your carrier for the road home.",
          setFlag: "quest-depot-accepted",
        },
      },
      {
        id: "sable-storage",
        name: "Depot Keeper Sable",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Four wild ones off the ice, any four. The lamps run on what the drift gives up, and I am not fussy about how they look.",
          setFlag: "quest-cold-storage-accepted",
        },
      },
      // The Depot's working: the bowser the haulers fill from.
      {
        id: "depot-bowser",
        name: "The Fuel Bowser",
        x: 8,
        y: 5,
        facing: "right",
        sprite: "mechanic",
        dialogue: {
          text: "A tank on wheels, hand-pumped, half full. Somebody has scratched NO CREDIT into the paint and then, more recently, into smaller letters: please.",
        },
      },
      {
        id: "sable-warm",
        name: "Depot Keeper Sable",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: { text: "Warm up, then. The kettle's always on and the roads never are." },
      },
      {
        id: "hauler-wren",
        name: "Hauler Wren",
        x: 10,
        y: 5,
        facing: "left",
        sprite: "rider",
        dialogue: {
          text: "I haul ice-salvage down from the perimeter twice a week. Longest run on the island. My car's nothing clever — heavy frame, wide rear, drive on both axles — and it finishes every trip, which is more than the clever ones do.",
        },
      },
    ],
    encounters: {},
    transitions: {
      // The fuel shed's door, and the gate back to the ice.
      "6,2": { mapId: "long_light_shed", toX: 5, toY: 4, facing: "up" },
      "6,6": { mapId: "ice_map", toX: 5, toY: 7, facing: "down" },
      "7,6": { mapId: "ice_map", toX: 6, toY: 7, facing: "down" },
    },
  },

  long_haul_cookhouse: {
    id: "long_haul_cookhouse",
    name: "Ada's Cookhouse",
    width: 12,
    height: 6,
    interior: true,
    tiles: COOKHOUSE_TILES,
    ambientColor: "#c9a97a",
    npcs: [
      {
        id: "nim",
        name: "Pot-washer Nim",
        x: 2,
        y: 4,
        facing: "right",
        sprite: "villager",
        dialogue: {
          text: "Ada cooks, I wash, and the slow ones go back to the wild. She says the road can't feed a herd that can't run — so anything the bench cuts goes out the door with me.",
          options: [
            { label: "You let them go?", next: "nim-scraps" },
            { label: "How many do you turn out?", next: "nim-talk" },
            { label: "Good luck with the pans", next: "nim-bye" },
          ],
        },
      },
      {
        id: "nim-scraps",
        name: "Pot-washer Nim",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Three, out past the fence, where the clover runs. Do that and I'll get you a hot meal and a few credits out of the till.",
          setFlag: "quest-scraps-accepted",
        },
      },
      {
        id: "nim-talk",
        name: "Pot-washer Nim",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "As many as the bench culls. Slow stock eats the same as fast stock, and Ada counts her grain by the mile.",
        },
      },
      {
        id: "nim-bye",
        name: "Pot-washer Nim",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: { text: "It's the pans or the road. I took the pans." },
      },
      {
        id: "hauler-quill",
        name: "Hauler Quill",
        x: 9,
        y: 3,
        facing: "left",
        sprite: "rider",
        dialogue: {
          text: "I rest here between runs. Two things keep a hauler alive: a car that holds its frame at speed, and knowing what the ground does to it. There's an inspector on your carrier for the first, and the tall grass for the second.",
        },
      },
    ],
    encounters: {},
    transitions: {
      // Out the front to the road.
      "5,5": { mapId: "long_haul", toX: 3, toY: 5, facing: "down" },
      "6,5": { mapId: "long_haul", toX: 3, toY: 5, facing: "down" },
    },
  },
  long_haul_workshop: {
    id: "long_haul_workshop",
    name: "Raff's Workshop",
    width: 12,
    height: 6,
    interior: true,
    tiles: WORKSHOP_TILES,
    ambientColor: "#bda878",
    npcs: [
      {
        id: "apprentice-cogs",
        name: "Apprentice Cogs",
        x: 8,
        y: 4,
        facing: "left",
        sprite: "mechanic",
        dialogue: {
          text: "Raff lets me weld if I can say why a car runs. So: cylinders make power, shafts lose a little, gears split a share to their own wheel. Say it right and the bench is yours.",
          options: [
            { label: "Cylinders, shafts, gears", next: "cogs-right" },
            { label: "Show me something worth welding", next: "cogs-job" },
            { label: "Later", next: "cogs-later" },
          ],
        },
      },
      {
        id: "cogs-right",
        name: "Apprentice Cogs",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "That's it. Wheel with nothing upstream is along for the ride — the inspector prints the drive at every wheel, so you can see which. Fastest way to find a broken car.",
        },
      },
      {
        id: "cogs-job",
        name: "Apprentice Cogs",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Bring me eight hundred on the flat and I'll weld you a bracket for the carrier. A small thing, but mine.",
          setFlag: "quest-bracket-accepted",
        },
      },
      {
        id: "cogs-later",
        name: "Apprentice Cogs",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: { text: "The bench keeps. So does the welding." },
      },
    ],
    encounters: {},
    transitions: {
      "5,5": { mapId: "long_haul", toX: 13, toY: 5, facing: "down" },
      "6,5": { mapId: "long_haul", toX: 13, toY: 5, facing: "down" },
    },
  },

  long_haul: {
    id: "long_haul",
    name: "The Long Haul",
    width: 18,
    height: 13,
    tiles: LONG_HAUL_TILES,
    ambientColor: "#d0b47c",
    npcs: [
      {
        id: "watchman-pell",
        name: "Watchman Pell",
        x: 8,
        y: 9,
        facing: "left",
        sprite: "rider",
        // Only out between dusk and dawn.
        hours: { from: 0.78, to: 0.12 },
        dialogue: {
          text: "Nobody out here after dark but me and the wild. The wild's quicker at night, if you believe the haulers. I've watched it long enough to believe them.",
          options: [
            { label: "What's different at night?", next: "pell-night" },
            { label: "I'll work the dark", next: "pell-job" },
            { label: "Keep warm", next: "pell-warm" },
          ],
        },
      },
      {
        id: "pell-night",
        name: "Watchman Pell",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Same pack, same ground, and they run it better when it's cold. Bring a car that holds a line and the dark pays better than the day does.",
        },
      },
      {
        id: "pell-job",
        name: "Watchman Pell",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Two off the Stretch, after dark. I'll be here — I'm always here when it's dark.",
          setFlag: "quest-nightwatch-accepted",
        },
      },
      {
        id: "pell-warm",
        name: "Watchman Pell",
        x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Warm's a word for people with roofs. I've a lamp and a ledger." },
      },
      {
        id: "cook-ada",
        name: "Cook Ada",
        x: 3,
        y: 6,
        facing: "right",
        sprite: "villager",
        routine: {
          dawn: { x: 5, y: 4, facing: "down" },
          morning: { x: 3, y: 6, facing: "right" },
          afternoon: { x: 3, y: 6, facing: "right" },
          dusk: { x: 8, y: 5, facing: "left" },
          night: { x: 2, y: 5, facing: "right" },
        },
        greetings: {
          known: "Sit before you tell me anything. You've been out on the grass — I can smell it.",
          champion: "A Branded rider at my stove. Eat first, then talk.",
        },
        dialogue: {
          text: "Sit. Eat. The road's four hundred miles of sand either way and nothing on it but my stove. I hear everything that comes up this lane — including what your herd can do.",
          options: [
            { label: "What's the talk on the lane?", next: "ada-talk" },
            { label: "Feed the road?", next: "ada-feed" },
            { label: "Just passing", next: "ada-passing" },
          ],
        },
      },
      {
        id: "ada-talk",
        name: "Cook Ada",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "The wild off this lane is the fastest on the island, and the counter in town pays for what you catch. Neither means a thing if the thing can't hold together on sand.",
        },
      },
      {
        id: "ada-feed",
        name: "Cook Ada",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Bring me eleven hundred out on the Sandy Stretch and I'll believe the lane's worth cooking for.",
          setFlag: "quest-lane-accepted",
        },
      },
      {
        id: "ada-passing",
        name: "Cook Ada",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: { text: "Then take some bread for the road. No charge — I like the company." },
      },
      {
        id: "drover-holt",
        name: "Drover Holt",
        x: 13,
        y: 6,
        facing: "left",
        sprite: "rider",
        dialogue: {
          text: "I haul stock from the perimeter to the counters and back. Best money I ever made was a specimen somebody else caught — the counter buys what you can't use, and sells what you haven't seen.",
          options: [
            { label: "How do I get in on that?", next: "holt-trade" },
            { label: "I'll fill my own book", next: "holt-book" },
            { label: "Safe roads", next: "holt-safe" },
          ],
        },
      },
      {
        id: "holt-trade",
        name: "Drover Holt",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Carrier's counter — the trade page. Sell what you've caught, buy stock off ground you've walked. The shelf gets better as those packs breed up, so buy early or buy good.",
        },
      },
      {
        id: "holt-book",
        name: "Drover Holt",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Then fill it from more than one island. Four different grounds in that book of yours and I'll pay to see it.",
          setFlag: "quest-book-accepted",
        },
      },
      {
        id: "holt-safe",
        name: "Drover Holt",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "There's no such road. There's only a car that holds and a car that doesn't." },
      },
      {
        id: "stoker-raff",
        name: "Stoker Raff",
        x: 8,
        y: 3,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Six gearsets in a heap and one chassis worth keeping. You want to know why a car runs? Read its power path: cylinders make the power, shafts lose a little of it, gears hand a share to the wheel in their own slot. A wheel with nothing upstream is along for the ride — the inspector will show you exactly which.",
        },
      },
      {
        id: "rider-hook",
        name: "Hook",
        x: 11,
        y: 9,
        facing: "left",
        sprite: "rider",
        routine: {
          morning: { x: 11, y: 9, facing: "left" },
          afternoon: { x: 11, y: 9, facing: "left" },
          dusk: { x: 9, y: 10, facing: "up" },
          night: { x: 9, y: 10, facing: "up" },
        },
        greetings: {
          "after:win": "You beat me on my own road. Say that again and I'll want another go.",
          "after:loss": "Told you the Long Haul's quick. Come back when your line's grown up.",
        },
        dialogue: {
          text: "Everyone fast stops at Ada's. I'm the fastest that stays. My car's a Long Haul special — nothing off the shelf about it. Race me if you think your line's better than mine.",
          options: [
            { label: "Run it", next: "hook-race" },
            { label: "I'll pass", next: "hook-pass" },
          ],
        },
      },
      {
        id: "hook-race",
        name: "Hook",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Four hundred miles of sand and one for pride. Go.", onComplete: "trainer", rivalDna: "Lhn4yi8zKRd2" },
      },
      {
        id: "hook-pass",
        name: "Hook",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Wise. Come back when your herd's outgrown the paddock." },
      },
    ],
    encounters: {},
    transitions: {
      // West back down the Salt Road, east on toward the Highlands. The gates
      // sit one tile in from the tree border, because a transition on the
      // border can never be stepped on.
      // The cookhouse and the workshop stand behind their own doors.
      "3,4": { mapId: "long_haul_cookhouse", toX: 5, toY: 3, facing: "up" },
      "13,4": { mapId: "long_haul_workshop", toX: 5, toY: 3, facing: "up" },
      "1,5": { mapId: "route_2", toX: 19, toY: 5, facing: "left" },
      "1,6": { mapId: "route_2", toX: 19, toY: 6, facing: "left" },
      "16,5": { mapId: "hills_map", toX: 4, toY: 6, facing: "right" },
      "16,6": { mapId: "hills_map", toX: 4, toY: 7, facing: "right" },
    },
  },
  home_ranch: {
    id: "home_ranch",
    name: "The Shoddy Ranch House",
    width: 14,
    height: 5,
    interior: true,
    tiles: HOME_INTERIOR_TILES,
    ambientColor: "#c9a97a",
    npcs: [
      {
        id: "robby-kitchen",
        name: "Rancher Robby",
        x: 7,
        y: 3,
        facing: "left",
        sprite: "professor",
        dialogue: {
          text: "Welcome there, sleepyhead! Ready to start helping around the ranch?",
          options: [
            { label: "Of course — but I didn't see any cattle on the way in?", next: "robby-reveal-1" },
            { label: "For sure! How do I start?", next: "robby-reveal-1" },
          ],
        },
      },
      {
        id: "robby-reveal-1",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Cattle? Ha — nothing so tall on Speid.",
          next: "robby-reveal-2",
        },
      },
      {
        id: "robby-reveal-2",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "My whole herd is vroomon — beetle-sized, mouse-sized, wheeled and wild.",
          next: "robby-reveal-3",
        },
      },
      {
        id: "robby-reveal-3",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "He swings the pasture door wide — and the yard floods with glinting little racers, humming past your ankles.",
          next: "robby-reveal-4",
        },
      },
      {
        id: "robby-reveal-4",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "You stare after them. Wait — those aren't cattle at all. Come on, out to the yard.",
          onComplete: "goto:ranch_yard:7:2:robby-yard-1",
          setFlag: "tut-revealed",
        },
      },
    ],
    encounters: {},
    transitions: {
      // The porch: a doormat in the doorway, straight out to the yard.
      "6,4": { mapId: "ranch_yard", toX: 6, toY: 3, facing: "down" },
      "7,4": { mapId: "ranch_yard", toX: 7, toY: 3, facing: "down" },
    },
  },
  ranch_yard: {
    id: "ranch_yard",
    name: "The Ranch Yard",
    width: 14,
    height: 12,
    tiles: RANCH_YARD_TILES,
    ambientColor: "#a8c879",
    npcs: [
      {
        id: "robby-yard-1",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "This paddock is yours now — a shoddy ranch for a new hand, but ours.",
          next: "robby-yard-2",
        },
      },
      {
        id: "robby-yard-2",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "First lesson. See the tall grass on the left? Wild vroomon graze it. Here — take this one, she's slow but she runs.",
          next: "robby-yard-3",
        },
      },
      {
        id: "robby-yard-3",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Walk to its edge and stand the line. When it shakes, press Z — but a wild one only joins you if you can outrun it.",
          onComplete: "starter-vroomon",
        },
      },
      {
        id: "wild-grass",
        name: "Tall Grass",
        x: 3,
        y: 7,
        facing: "right",
        sprite: "sign",
        dialogue: { text: "The tall grass shivers — something's running under it.", onComplete: "wild" },
      },
      {
        id: "carrier-bench",
        name: "The Carrier Bench",
        x: 6,
        y: 9,
        facing: "left",
        sprite: "mechanic",
        dialogue: {
          text: "Your carrier sits on the bench, herd humming inside. Give it a crank and the paddock opens.",
          onComplete: "open-ranch",
        },
      },
      {
        id: "robby-caught-1",
        name: "Rancher Robby",
        x: 5,
        y: 9,
        facing: "left",
        sprite: "professor",
        dialogue: {
          text: "A wild one on your first morning! Its genome's in your Herd Book now.",
          next: "robby-caught-2",
        },
      },
      {
        id: "robby-caught-2",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "That's how we grow a ranch: catch the wild, breed the best, race your heart out. And here — a pocket carrier, microwave-sized, full of feed. It rides your hip everywhere; the herd rides inside it.",
          next: "robby-caught-3",
        },
      },
      {
        id: "robby-caught-3",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Breeding, now — on the carrier's bench you run a generation and the fastest rise. When the slow ones lag, let them go: the wild takes them back and repays their feed, so culling pays for the next run. Grain tops the bin up if it runs dry.",
          next: "robby-caught-4",
        },
      },
      {
        id: "robby-caught-4",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "See for yourself? The Barn button — bottom-right, 🏟 — holds your Herd Book and the Record Barn.",
          next: "robby-caught-5",
        },
      },
      {
        id: "robby-caught-5",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Alright, that's all for today! Why don't you go ahead and explore town with the rest of your day?",
          setFlag: "tut-done",
        },
      },
    ],
    encounters: {},
    transitions: {
      // Back inside, and out the garden gate to town.
      "6,1": { mapId: "home_ranch", toX: 6, toY: 3, facing: "up" },
      "7,1": { mapId: "home_ranch", toX: 7, toY: 3, facing: "up" },
      "7,10": { mapId: "starter_town", toX: 8, toY: 5, facing: "up" },
    },
  },

  marrow_orchard: {
    id: "marrow_orchard",
    name: "Marrow Orchard",
    width: 18,
    height: 14,
    tiles: MARROW_ORCHARD_TILES,
    ambientColor: "#9cc46a",
    npcs: [
      {
        id: "keeper-maren",
        name: "Orchard Keeper Maren",
        x: 2,
        y: 11,
        facing: "right",
        sprite: "professor",
        dialogue: {
          text: "Easy there — mind the clover, the whole orchard grazes on it. I keep the old Marrow line: same stock for nine seasons, and I can walk you back along every branch of it. Breeding is patience with a ledger.",
          options: [
            { label: "Show me the family lines", next: "maren-lines" },
            { label: "What would you pay for a champion?", next: "maren-cutting" },
            { label: "What grows out here?", next: "maren-clover" },
          ],
        },
      },
      {
        id: "maren-lines",
        name: "Orchard Keeper Maren",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Carrier's got a Heritage page — every car in your herd book, drawn back to the founders. Tap one and it traces the line it came down. You'll see where a spike came from, and where it went.",
        },
      },
      {
        id: "maren-cutting",
        name: "Orchard Keeper Maren",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Bring me a car that runs 900 on the flat and I'll cut you a Marrow scion — my own line, the good wood.",
          setFlag: "quest-cutting-accepted",
        },
      },
      {
        id: "maren-clover",
        name: "Orchard Keeper Maren",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Clover for the bees, windfall for the vroomon, and the vroomon for nothing at all. The wild here breeds quicker than the road's — nobody's out here telling them otherwise.",
        },
      },
      {
        id: "picker-sprout",
        name: "Sprout",
        x: 13,
        y: 4,
        facing: "left",
        sprite: "rival",
        routine: {
          morning: { x: 13, y: 4, facing: "left" },
          afternoon: { x: 13, y: 4, facing: "left" },
          dusk: { x: 8, y: 9, facing: "right" },
        },
        dialogue: {
          text: "You're the one off the shoddy ranch! I pick here summers and I race everything that comes up the lane. My car's nothing special — that's the point. Race me and see what yours is worth.",
          options: [
            { label: "Line it up", next: "sprout-race" },
            { label: "Not right now", next: "sprout-later" },
          ],
        },
      },
      {
        id: "sprout-race",
        name: "Sprout",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "Down the lane and past the pond. Ready?",
          onComplete: "trainer", rivalDna: "UoZzJLj1FOFC",
        },
      },
      {
        id: "sprout-later",
        name: "Sprout",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "Suit yourself. I'll be here, eating windfalls.",
        },
      },
      {
        id: "fitter-aubrey",
        name: "Fitter Aubrey",
        x: 6,
        y: 2,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Maren keeps me on to look at the stock. You can read a vroomon like a ledger, you know — plates for structure, wheels joined at their centres, then the power path running through them. Carrier's got an inspector for it: pick any car and read its blueprint part by part.",
        },
      },
      {
        id: "night-picker-sib",
        name: "Night-picker Sib",
        x: 4,
        y: 8,
        facing: "left",
        sprite: "villager",
        // Out between dusk and dawn, like the other night watches.
        hours: { from: 0.78, to: 0.12 },
        dialogue: {
          text: "I pick the late rows when the orchard's quiet. The wild stock comes down to the windfalls after dark, so I see more of it than anyone does by day.",
          options: [
            { label: "What do they do at night?", next: "sib-night" },
            { label: "I'll work the late rows", next: "sib-job" },
            { label: "Mind the shadows", next: "sib-shade" },
          ],
        },
      },
      { id: "sib-night", name: "Night-picker Sib", x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: { text: "Same pack, and they run the rows better. Hollis complains about the clover either way - I just pick around them." } },
      { id: "sib-job", name: "Night-picker Sib", x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: { text: "Beat one of the orchard's wild in the dark and I'll believe you've seen what I see.", setFlag: "quest-late-rows-accepted" } },
      { id: "sib-shade", name: "Night-picker Sib", x: 0, y: 0, facing: "down", sprite: "villager",
        dialogue: { text: "The shadows are mine. Everything else is Hollis's." } },
      {
        id: "beekeeper-hollis",
        name: "Beekeeper Hollis",
        x: 15,
        y: 10,
        facing: "left",
        sprite: "villager",
        dialogue: {
          text: "The hives are mine and the clover's theirs. Wild vroomon tear through this end of the orchard flatting the flowers, and my bees won't have it. Thin them out and I'll set you up with skeps.",
          options: [
            { label: "I'll thin the herd", next: "hollis-accept" },
            { label: "About your sister's hives", next: "hollis-run" },
            { label: "Ask someone else", next: "hollis-decline" },
          ],
        },
      },
      {
        id: "hollis-accept",
        name: "Beekeeper Hollis",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Six of them off this clover. Beat them in a race — I don't want them driven off, I want them gone properly.",
          setFlag: "quest-pollination-accepted",
        },
      },
      {
        id: "hollis-run",
        name: "Beekeeper Hollis",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "She keeps hives out on the Drift Perimeter, past the quarry. Walk it and I'll pay the toll myself.",
          setFlag: "quest-pollination-run-accepted",
        },
      },
      {
        id: "hollis-decline",
        name: "Beekeeper Hollis",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Then mind your ankles. They bite at the axle grease.",
        },
      },
    ],
    encounters: {},
    transitions: {
      // South down the lane to town, west along the hedge to Route 1. The
      // hedge gate sits in from the tree border so it can be stepped on.
      "10,12": { mapId: "starter_town", toX: 10, toY: 2, facing: "down" },
      "1,4": { mapId: "route_1", toX: 17, toY: 4, facing: "left" },
      "1,5": { mapId: "route_1", toX: 17, toY: 4, facing: "left" },
    },
  },
  starter_town: {
    id: "starter_town",
    name: "Starter Town",
    width: 16,
    height: 12,
    tiles: STARTER_TOWN_TILES,
    ambientColor: "#9bc16a",
    npcs: [
      {
        id: "wanda-first-buys",
        name: "Wrench Wanda",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Pasture first — more room, healthier herd. Stalls next, so the Barn holds more champions. And keep a Calm Tonic for the night before a long breeding run; it keeps the genome steady.",
        },
      },
      {
        id: "wanda-bye",
        name: "Wrench Wanda",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: { text: "The yard's always open. Bring credits, bring a car or two." },
      },
      {
        id: "fitter-ollan",
        name: "Fitter Ollan",
        x: 12,
        y: 7,
        facing: "up",
        sprite: "mechanic",
        dialogue: {
          text: "Ollan — I fit out yards. Meadow's the first thing people see and it's the last thing they spend on. Put three pieces out there and come back a customer.",
          options: [
            { label: "I'll dress the meadow", next: "ollan-errand" },
            { label: "What's worth placing?", next: "ollan-advice" },
            { label: "Later", next: "ollan-later" },
          ],
        },
      },
      {
        id: "ollan-errand",
        name: "Fitter Ollan",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Three pieces in the meadow. Bower, bed, pond, lanterns — your taste, not mine.",
          setFlag: "quest-fitters-accepted",
        },
      },
      {
        id: "ollan-advice",
        name: "Fitter Ollan",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Carrier's got a ranch shop: bower, wildflower bed, duck pond, lanterns, a wishing well if you're feeling grand. Purely looks, mind. Cars don't run faster under a lantern.",
        },
      },
      {
        id: "ollan-later",
        name: "Fitter Ollan",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: { text: "A bare yard waits as long as you like." },
      },
      {
        id: "wrangler-jess",
        name: "Wrangler Jess",
        x: 6,
        y: 6,
        facing: "up",
        sprite: "rival",
        // Morning in the square, afternoon on the gate road, dusk at the well.
        routine: {
          dawn: { x: 6, y: 8, facing: "up" },
          morning: { x: 6, y: 6, facing: "up" },
          afternoon: { x: 11, y: 5, facing: "left" },
          dusk: { x: 4, y: 9, facing: "left" },
          night: { x: 4, y: 9, facing: "left" },
        },
        greetings: {
          champion: "Well — the rider with a Brand and a champion in the barn. The board's got room for one more name.",
          known: "Back off the grass, I see. Bring me the count when you've got it.",
        },
        dialogue: {
          text: "You're the new hand off the shoddy ranch. Nobody wrangles vroomon without proving they can catch one — beat three of them in a race and I'll believe you.",
          options: [
            { label: "Three races. Easy.", next: "jess-muster" },
            { label: "I'll walk the Mesa road for you", next: "jess-freight" },
            { label: "Not today", next: "jess-brushoff" },
            { label: "Put my name on the board", next: "jess-board" },
          ],
        },
      },
      { id: "jess-board", name: "Wrangler Jess", x: 0, y: 0, facing: "down", sprite: "rival",
        dialogue: { text: "Eight wild ones raced. Do that and I'll chalk your name by the gate myself.", setFlag: "quest-board-accepted" } },
      {
        id: "jess-muster",
        name: "Wrangler Jess",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "Three wild vroomon beaten in honest races. Bring me the count, not the stories.",
          setFlag: "quest-muster-accepted",
        },
      },
      {
        id: "jess-freight",
        name: "Wrangler Jess",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "I've a crate that needs eyes on the Highlands road. Walk the mesa and the fee's yours.",
          setFlag: "quest-freight-accepted",
        },
      },
      {
        id: "jess-brushoff",
        name: "Wrangler Jess",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: { text: "Suit yourself. The grass will still be shaking when you're ready." },
      },
      {
        id: "meadow-elder",
        name: "Meadow Elder",
        x: 2,
        y: 9,
        facing: "right",
        sprite: "professor",
        dialogue: {
          text: "Welcome, wanderer. I keep the Greensprout herd at the meadow fence — slow-grown, sturdy, free in the grass. Run with us and the village grazes you through any winter.",
          options: [
            { label: "Join the Greensprouts", next: "elder-join-faction" },
            { label: "The Reds run faster", next: "elder-decline" },
                      { label: "Race the Rustlers to settle the feud", next: "elder-feud" },
],
        },
      },
      {
        id: "elder-join-faction",
        name: "Meadow Elder",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Then you're one of us. The meadow gate is yours — and the grass always grows back.",
          onComplete: "join-faction:greensprouts",
        },
      },
      {
        id: "elder-decline",
        name: "Meadow Elder",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "The summer circuit calls to many. The Roundup King keeps the west fence — go on, ride.",
        },
      },
      {
        id: "elder-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      {
        id: "shopkeeper",
        name: "Wrench Wanda",
        x: 11,
        y: 3,
        facing: "left",
        sprite: "mechanic",
        dialogue: {
          text: "First time in town? The Ranch fitters' yard is just east of me — wire in pasture for herd room, stalls for barn slots, and a one-shot tonic to calm a nervous breeding night. Every carrier runs on grain: breeding costs a feed a generation, and releasing the slow pays it back. Credits come from every lap the Barn pays out, so race often.",
          options: [
            { label: "What should I buy first?", next: "wanda-first-buys" },
            { label: "I'll be back", next: "wanda-bye" },
          ],
        },
      },
    ],
    encounters: {},
    transitions: {
      // The historical gate was "1,0" — a tree tile, so the town exit was
      // unreachable and the overworld was a dead end.
      "13,2": { mapId: "route_1", toX: 1, toY: 10, facing: "down" },
      "10,0": { mapId: "marrow_orchard", toX: 10, toY: 11, facing: "up" },
      // The doors in the north buildings: schoolhouse left, store right.
      "6,2": { mapId: "town_schoolhouse", toX: 5, toY: 4, facing: "up" },
      "9,2": { mapId: "town_store", toX: 5, toY: 4, facing: "up" },
      "8,0": { mapId: "ranch_yard", toX: 7, toY: 9, facing: "up" },
    },
  },
  route_1: {
    id: "route_1",
    name: "Route 1 — Grasslands Path",
    width: 20,
    height: 14,
    tiles: ROUTE_1_TILES,
    ambientColor: "#a8c879",
    npcs: [
      {
        id: "oxide-trader",
        name: "Oxide",
        x: 5,
        y: 3,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Oxide. I move stock up and down this road — genomes, grain, the odd gearset. Two things I pay for: samples off the wild, and a herd that actually turns over.",
          options: [
            { label: "I'll bring you samples", next: "oxide-samples" },
            { label: "My herd turns over plenty", next: "oxide-count" },
            { label: "Just passing", next: "oxide-passing" },
          ],
        },
      },
      {
        id: "oxide-samples",
        name: "Oxide",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Four Herd Book samples off the wild. Race them first — I don't buy anything you couldn't catch.",
          setFlag: "quest-samples-accepted",
        },
      },
      {
        id: "oxide-count",
        name: "Oxide",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Then prove it. Five generations on the bench and I'll know you're serious.",
          setFlag: "quest-count-accepted",
        },
      },
      {
        id: "oxide-passing",
        name: "Oxide",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Everyone's just passing until the feed runs dry. I'll be here.",
        },
      },
      {
        id: "rival-vicky",
        name: "Rider Vicky",
        x: 18,
        y: 6,
        facing: "left",
        sprite: "rider",
        encounterId: "vicky-race",
        dialogue: {
          text: "Oh, you're the new kid! I heard the Roundup King's Reds are the fastest herd on the plain. A race is simple: stand the line and let the machine take the road — one tap of Z and the timer runs. Test any car you've bred in Test Drive first; the flat is a good yardstick, and the records board logs every lap so you can race your own tailwind.",
          options: [
            { label: "Let's race!", next: "vicky-accept" },
            { label: "Maybe later", next: "vicky-decline" },
          ],
        },
      },
      {
        id: "vicky-accept",
        name: "Rider Vicky",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Three, two, one... go!", onComplete: "trainer", rivalDna: "RuAp2owjBaqK" },
      },
      {
        id: "vicky-decline",
        name: "Rider Vicky",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Bawk! Fine, I'll be here. Don't keep me waiting too long." },
      },
      {
        id: "roundup-sign",
        name: "Sign",
        // Beside the road, not in the treeline: at 19 it stood inside the
        // border trees, so nobody could stand and read it.
        x: 16,
        y: 5,
        facing: "left",
        sprite: "sign",
        dialogue: { text: "Rustler Pasture — Redline Rustlers' summer pasture. The Meadow Elder keeps the far gate in Starter Town." },
      },
    ],
    encounters: {},
    transitions: {
      // The walk back to town: the gate sits one tile in from the border, and
      // lands you beside the town gate rather than on it.
      "1,9": { mapId: "starter_town", toX: 12, toY: 2, facing: "up" },
      // (18,6) was originally the Salt Road gate, but Rider Vicky stands on
      // that tile and blocked it — the gate lives on (18,5) instead.
      "18,5": { mapId: "route_2", toX: 1, toY: 6, facing: "right" },
      // One tile each: two transitions on the same key meant the second
      // won and the Salt Road gate silently disappeared.
      "17,5": { mapId: "gym_1", toX: 6, toY: 8, facing: "up" },
    },
  },
  gym_1: {
    id: "gym_1",
    name: "Rustler Pasture",
    width: 14,
    height: 10,
    interior: true,
    tiles: GYM_1_TILES,
    ambientColor: "#caa672",
    npcs: [
      {
        id: "roundup-king",
        name: "Roundup King",
        x: 7,
        y: 4,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Welcome to Rustler Pasture. I'm the Roundup King — my Reds run the summer circuit. Cut the fastest calf, run it at the Roundup, and the circuit pays your keep.",
          options: [
            { label: "Run for the Reds", next: "king-join-faction" },
            { label: "The Greensprouts suit me", next: "king-decline" },
                      { label: "Race the Greensprouts to settle the feud", next: "king-feud" },
            { label: "Run the Grand Roundup", next: "grand-roundup" },
            { label: "What would three Brands buy me?", next: "king-brands" },
],
        },
      },
      { id: "king-brands", name: "Roundup King", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "Chalk washes off. Three Brands and we'll talk about the Roundup.", setFlag: "quest-brands-accepted" } },
      {
        id: "king-join-faction",
        name: "Roundup King",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Then it's settled — you run Red. First rule: the fast ones eat first.",
          onComplete: "join-faction:redlines",
        },
      },
      {
        id: "king-decline",
        name: "Roundup King",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Fair's fair. The Elder's meadow gate is back in town — mention my name and she'll fence you in.",
        },
      },
      {
        id: "king-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      {
        id: "grand-roundup",
        name: "Grand Roundup",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Five Brands and a champion's names in the Record Barn — then it's three laps against the whole road.", onComplete: "grand-roundup" },
      },
    ],
    encounters: {},
    transitions: {
      // The back room behind the west door.
      "1,7": { mapId: "rustler_tack_room", toX: 5, toY: 4, facing: "up" },
      "6,9": { mapId: "route_1", toX: 18, toY: 6 },
      "7,9": { mapId: "route_1", toX: 18, toY: 6 },
    },
  },
  route_2: {
    id: "route_2",
    name: "Route 2 — Sandy Stretch",
    width: 22,
    height: 14,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      // A freight bay on the north side of the road.
      row("tree", "vroomgrass", "vroomgrass", "building", "building", "door", "building", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "grass", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "grass", "path", "doormat", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "grass", "grass", "path", "path", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "rock", "grass", "path", "path", "grass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "path", "grass", "vroomgrass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "path", "grass", "rock", "grass", "vroomgrass", "grass", "vroomgrass", "vroomgrass", "grass", "vroomgrass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "grass", "rock", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "vroomgrass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "grass", "path", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "path", "grass", "grass", "vroomgrass", "tree"),
      row("tree", "grass", "grass", "grass", "path", "grass", "grass", "grass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "grass", "vroomgrass", "grass", "grass", "path", "vroomgrass", "vroomgrass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "grass", "path", "rock", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "vroomgrass", "vroomgrass", "grass", "vroomgrass", "path", "grass", "grass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#d2b67a",
    npcs: [
      {
        id: "rival-marcus",
        name: "Rider Marcus",
        x: 10,
        y: 5,
        facing: "left",
        sprite: "rider",
        encounterId: "marcus-race",
        dialogue: {
          text: "Sand's tricky. My car's got fat wheels for grip. You got fat wheels?",
          options: [
            { label: "Let's find out", next: "marcus-accept" },
            { label: "Maybe next time", next: "marcus-decline" },
          ],
        },
      },
      {
        id: "salt-gate-sign",
        name: "Sign",
        x: 19,
        y: 7,
        facing: "left",
        sprite: "sign",
        dialogue: { text: "Salt Road — dune lanes ahead. The Trail Boss holds the water rights; the Wreck Marshal owns the salvage pits." },
      },
      {
        id: "trail-boss",
        name: "Trail Boss of the Salt Road",
        x: 6,
        y: 12,
        facing: "left",
        sprite: "professor",
        dialogue: {
          text: "Salt Road Caravan. I'm the Trail Boss — we move water and fodder between the oases, together. Run with us and the road feeds you for life.",
          options: [
            { label: "Join the Salt Road Caravan", next: "trailboss-join-faction" },
            { label: "The wreck camps pay better", next: "trailboss-decline" },
                      { label: "Race the Wreckpickers to settle the feud", next: "trailboss-feud" },
],
        },
      },
      {
        id: "trailboss-join-faction",
        name: "Trail Boss of the Salt Road",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Then grab a water skin — the caravan moves at dusk, and the dunes keep what they're given.",
          onComplete: "join-faction:saltcaravan",
        },
      },
      {
        id: "trailboss-decline",
        name: "Trail Boss of the Salt Road",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "The Wreck Marshal keeps the salvage pits at the Salt Road Post. Watch your step over there.",
        },
      },
      {
        id: "trailboss-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      {
        id: "highland-herder",
        name: "Highland Herder",
        x: 2,
        y: 9,
        facing: "right",
        sprite: "rider",
        dialogue: {
          text: "The highlands run on two schools: the Guru of the Updrafts breeds windhunters for the updrafts, and the Guru of the Stone Path keeps burrowers in the vents. You'll choose your school when the mesa pass opens.",
        },
      },
      {
        id: "canyon-hauler",
        name: "Canyon Hauler",
        x: 2,
        y: 11,
        facing: "right",
        sprite: "rider",
        dialogue: {
          text: "Down in the canyon, the Lay Foreman runs the Stonecutters' safety boards while the Ringleader books the stunt crews. The contract renegotiation decides who owns the quarries.",
        },
      },
      {
        id: "frost-courier",
        name: "Frost Courier",
        x: 19,
        y: 9,
        facing: "left",
        sprite: "rider",
        dialogue: {
          text: "On the perimeter, the Keeper of the Long Light herds the oldest lineages under the aurora; the Frost Baron moves freight with no receipt. Pack for the cold whichever you answer to.",
        },
      },
      {
        id: "marcus-accept",
        name: "Rider Marcus",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Try to keep up!", onComplete: "trainer", rivalDna: "A9gpwYaIPmdg" },
      },
      {
        id: "marcus-decline",
        name: "Rider Marcus",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Whatever. Don't blame the sand when you get stuck." },
      },
      {
        id: "sand-sign",
        name: "Sign",
        // Beside the road, facing it. At 21 it stood inside the border trees,
        // where its warning could not be read by anyone walking the route.
        x: 18,
        y: 5,
        facing: "left",
        sprite: "sign",
        dialogue: {
          text: "Salt Road Post — the Wreck Marshal's fleet holds the water rights out here. Cut your teeth in the Grasslands first.",
        },
      },
    ],
    encounters: {},
    transitions: {
      "1,7": { mapId: "route_1", toX: 17, toY: 6 },
      // The freight bay's doorstep.
      "5,2": { mapId: "salt_road_freight", toX: 5, toY: 4, facing: "up" },
      "19,3": { mapId: "hills_map", toX: 2, toY: 6, facing: "right" },
      "20,5": { mapId: "long_haul", toX: 2, toY: 5, facing: "right" },
      "20,4": { mapId: "gym_2", toX: 6, toY: 8, facing: "up" },
    },
  },
  gym_2: {
    id: "gym_2",
    name: "Salt Road Post",
    width: 14,
    height: 10,
    interior: true,
    tiles: GYM_1_TILES,
    ambientColor: "#c2a670",
    npcs: [
      {
        id: "wreck-marshal",
        name: "Wreck Marshal",
        x: 7,
        y: 4,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Salt Road Post, and the camp's open. I'm the Wreck Marshal — my Wreckpickers dig salvage genes out of the dune wrecks. Pay's in salvage, and nobody asks where it came from.",
          options: [
            { label: "Join the Wreckpickers", next: "marshal-join-faction" },
            { label: "The caravan suits me", next: "marshal-decline" },
                      { label: "Race the Caravan to settle the feud", next: "marshal-feud" },
  { label: "About that wager on the Stretch", next: "wreck-wager" },
],
        },
      },
      { id: "wreck-wager", name: "Wreck Marshal", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Two wild vroomon beaten out on the Sandy Stretch. Do that and the road's yours to claim.", setFlag: "quest-salt-wager-accepted" } },
      {
        id: "marshal-join-faction",
        name: "Wreck Marshal",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Welcome to the salvage pits. First rule: what's buried here stays useful.",
          onComplete: "join-faction:wreckpickers",
        },
      },
      {
        id: "marshal-decline",
        name: "Wreck Marshal",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "The Trail Boss holds the water rights west of the post. Drive safe out there — the dunes don't care who pays you.",
        },
      },
      {
        id: "marshal-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
    ],
    encounters: {},
    transitions: {
      // The back room behind the west door.
      "1,7": { mapId: "salt_post_weighbridge", toX: 5, toY: 4, facing: "up" },
      "6,9": { mapId: "route_2", toX: 20, toY: 6 },
      "7,9": { mapId: "route_2", toX: 20, toY: 6 },
    },
  },

  hills_map: {
    id: "hills_map",
    name: "Highland Mesa",
    width: 16,
    height: 12,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "tree"),
      row("tree", "grass", "rock", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "vroomgrass", "grass", "grass", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "rock", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "rock", "grass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "vroomgrass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "vroomgrass", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "tree"),
      row("tree", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#a8d2a0",
    npcs: [
      { id: "guru-updrafts", name: "Guru of the Updrafts", x: 5, y: 6, facing: "right", sprite: "professor",
        dialogue: {
          text: "Highland Mesa, and the summit schools are open to you. I teach the light chassis — ride the updrafts, skim the vents. Join the Skimmers and learn the wind lines.",
          options: [
            { label: "Join the Summit Skimmers", next: "skimmers-join-faction" },
            { label: "The stone path calls", next: "skimmers-decline" },
                      { label: "Race the Miners to settle the feud", next: "skimmers-feud" },
  { label: "What do the thermals want?", next: "guru-thermals" },
],
        } },
      { id: "guru-thermals", name: "Guru of the Updrafts", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "Two of the Mesa's wild stock beaten on Mesa ground. The wind keeps the score.", setFlag: "quest-thermals-accepted" } },
      { id: "skimmers-join-faction", name: "Guru of the Updrafts", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "Light as the summit wind, you race now. First lesson: gravity is only a suggestion.", onComplete: "join-faction:skimmers" } },
      { id: "skimmers-decline", name: "Guru of the Updrafts", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "The Stone Path keeps its burrowers warm in the vents. The Guru of the Stone Path waits at the east ridge." } },
      {
        id: "skimmers-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "guru-stone", name: "Guru of the Stone Path", x: 12, y: 6, facing: "left", sprite: "gym-leader",
        dialogue: {
          text: "Below the mesa the vents hum. I breed low-slung burrowers that chew the big hills — steady pay, mineral rights, and a warm tunnel at night. Join the Miners.",
          options: [
            { label: "Join the Hill-Down Miners", next: "miners-join-faction" },
            { label: "The updrafts suit me", next: "miners-decline" },
                      { label: "Race the Skimmers to settle the feud", next: "miners-feud" },
],
        } },
      { id: "miners-join-faction", name: "Guru of the Stone Path", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "Then grab a lamp. First rule: the stone keeps what it gives.", onComplete: "join-faction:miners" } },
      { id: "miners-decline", name: "Guru of the Stone Path", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "The Summit school flies at the west gate. Tell the Guru of the Updrafts I sent you." } },
      {
        id: "miners-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      {
        id: "vent-keeper",
        name: "Vent Keeper",
        x: 8,
        y: 2,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "At dusk the mesa vents whistle. Some say the updrafts call their own — city folks just hear wind. I keep the vane on this ridge; it says more about the ground than any clock.",
          options: [
            { label: "What does the ground want?", next: "vent-wants" },
            { label: "I'll run the vents", next: "vent-job" },
            { label: "Which way is the wind?", next: "vent-wind" },
          ],
        },
      },
      {
        id: "vent-wants",
        name: "Vent Keeper",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "High ground, thin air. A car that wanders loses the line and never gets it back — four wheels planted, two of them pulling, that is the shape the Mesa likes.",
        },
      },
      {
        id: "vent-job",
        name: "Vent Keeper",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Twenty-six hundred on my Mesa and I will show you how the fast ones are laid out.",
          setFlag: "quest-vent-line-accepted",
        },
      },
      {
        id: "vent-wind",
        name: "Vent Keeper",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: {
          text: "Up the ridge and north, always. Race the switchback with it behind you and you will think your herd got faster overnight.",
        },
      },
      // A working you can walk up to: the vane the Keeper reads.
      {
        id: "mesa-vane",
        name: "The Ridge Vane",
        x: 10,
        y: 2,
        facing: "left",
        sprite: "sign",
        dialogue: {
          text: "A wind vane on a stone post, its tail worn bright. Someone has chalked the week's readings up the post: the Mesa keeps its own weather book.",
        },
      },
    ],
    encounters: {},
    transitions: {
      "1,6": { mapId: "route_2", toX: 18, toY: 4, facing: "left" },
      "14,6": { mapId: "rocky_map", toX: 2, toY: 6, facing: "right" },
      // The Switchback climbs off the Mesa.
      "5,6": { mapId: "mesa_switchback", toX: 6, toY: 7, facing: "down" },
    },
  },
  rocky_map: {
    id: "rocky_map",
    name: "Canyon Quarry",
    width: 16,
    height: 12,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "grass", "rock", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "rock", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "rock", "grass", "tree"),
      row("tree", "grass", "grass", "rock", "rock", "grass", "grass", "rock", "rock", "grass", "grass", "rock", "grass", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "rock", "tree"),
      row("tree", "grass", "rock", "path", "grass", "rock", "grass", "rock", "grass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "vroomgrass", "grass", "rock", "tree"),
      row("tree", "grass", "rock", "path", "rock", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "grass", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#9a9a96",
    npcs: [
      { id: "lay-foreman", name: "The Lay Foreman", x: 5, y: 6, facing: "right", sprite: "gym-leader",
        dialogue: {
          text: "The Canyon Quarry, and the Union keeps it safe — durable DNA, safety boards, and an hourly wage in credits. Join the Stonecutters and never worry about a busted axle again.",
          options: [
            { label: "Join the Stonecutters' Union", next: "union-join-faction" },
            { label: "I race for the stunts", next: "union-decline" },
                      { label: "Race the Runners to settle the feud", next: "union-feud" },
],
        } },
      { id: "union-join-faction", name: "The Lay Foreman", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "Welcome to the crew. First rule: the safety board signs off before any canyon run.", onComplete: "join-faction:union" } },
      { id: "union-decline", name: "The Lay Foreman", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "The Ringleader books crews at the east rim. Don't sign his waiver without reading it." } },
      {
        id: "union-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "canyon-ringleader", name: "The Ringleader", x: 12, y: 6, facing: "left", sprite: "rider",
        dialogue: {
          text: "Airtime, kid. I book the stunt crews — flare wheels, canyon leaps, and the bookmaker's odds. Run with the Runners and the canyon pays your bets.",
          options: [
            { label: "Join the Canyon Runners", next: "runners-join-faction" },
            { label: "The Union pays steady", next: "runners-decline" },
                      { label: "Race the Union to settle the feud", next: "runners-feud" },
  { label: "What's the work in the Quarry?", next: "canyon-shift" },
],
        } },
      { id: "canyon-shift", name: "The Ringleader", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Two wild ones beaten in the Quarry. Frames that hold, that's all I'm asking for.", setFlag: "quest-quarry-accepted" } },
      { id: "runners-join-faction", name: "The Ringleader", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "That's the spirit. First rule: land wheels-down, or don't come back.", onComplete: "join-faction:runners" } },
      { id: "runners-decline", name: "The Ringleader", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "The Lay Foreman signs the safe checks at the west gate. Safe is boring, but it pays." } },
      {
        id: "runners-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "assay-clerk", name: "Assay Clerk", x: 5, y: 9, facing: "up", sprite: "mechanic",
        dialogue: { text: "Every picked-over wreck pays double when the canyon's in boom. The Lay Foreman logs it all — the Ringleader doesn't." } },
    ],
    encounters: {},
    transitions: {
      "1,6": { mapId: "hills_map", toX: 13, toY: 6, facing: "left" },
      "14,6": { mapId: "ice_map", toX: 2, toY: 6, facing: "right" },
      // The Cut runs off the Quarry road.
      "5,6": { mapId: "the_cut", toX: 6, toY: 6, facing: "down" },
    },
  },
  ice_map: {
    id: "ice_map",
    name: "Drift Perimeter",
    width: 16,
    height: 12,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "grass", "grass", "grass", "rock", "grass", "tree"),
      row("tree", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "grass", "grass", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "vroomgrass", "path", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "tree"),
      row("tree", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#cfe4f0",
    npcs: [
      { id: "keeper-long-light", name: "Keeper of the Long Light", x: 5, y: 6, facing: "right", sprite: "professor",
        dialogue: {
          text: "The oldest lineages on the Drift Perimeter belong to us. Slow-bred, patient, sure-footed in the drift. Run with the Herdsmen and the aurora keeps your herd.",
          options: [
            { label: "Join the Aurora Herdsmen", next: "herdsmen-join-faction" },
            { label: "The freight lanes pay", next: "herdsmen-decline" },
                      { label: "Race the Syndicate to settle the feud", next: "herdsmen-feud" },
],
        } },
      { id: "herdsmen-join-faction", name: "Keeper of the Long Light", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "Then let the lights find you. First rule: never outrun your herd.", onComplete: "join-faction:herdsmen" } },
      { id: "herdsmen-decline", name: "Keeper of the Long Light", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "The Frost Baron runs the freight lanes along the rim. Ask no questions about the cargo." } },
      {
        id: "herdsmen-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "frost-baron", name: "The Frost Baron", x: 12, y: 6, facing: "left", sprite: "mechanic",
        dialogue: {
          text: "Ice-road freight, no receipt, no refusal. Run with the Syndicate and the lane pays in chits that spend anywhere. The cold doesn't care who you are — neither do I.",
          options: [
            { label: "Join the Drift Syndicate", next: "drift-join-faction" },
            { label: "The Herdsmen keep the lights", next: "drift-decline" },
                      { label: "Race the Herdsmen to settle the feud", next: "drift-feud" },
  { label: "What does the Watch need?", next: "baron-watch" },
],
        } },
      { id: "baron-watch", name: "The Frost Baron", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Two wild vroomon beaten on the ice. The cold breeds them patient, so it's no small ask.", setFlag: "quest-perimeter-accepted" } },
      { id: "drift-join-faction", name: "The Frost Baron", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Welcome to the lane. First rule: the freight goes through, whatever it is.", onComplete: "join-faction:drift-syndicate" } },
      { id: "drift-decline", name: "The Frost Baron", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Then find the Keeper of the Long Light. Slow herds, slow money, warm hearts." } },
      {
        id: "drift-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "lamp-lighter", name: "Lamp Lighter", x: 8, y: 3, facing: "down", sprite: "rider",
        dialogue: { text: "The long light never quite sets this far north. Mind you don't drift past the lamp line — the Baron's freight don't stop for nobody." } },
    ],
    encounters: {},
    transitions: {
      "1,6": { mapId: "rocky_map", toX: 13, toY: 6, facing: "left" },
      // The Long Light Depot is the last roof before the ice.
      "5,6": { mapId: "long_light_depot", toX: 6, toY: 5, facing: "down" },
    },
  },
};

Object.entries(MAPS).forEach(([id, map]) => {
  if (map.transitions[`${TILE_TO_X[id]},0`]) {
    return;
  }
});

export function getMap(mapId: string): Tilemap | undefined {
  return MAPS[mapId];
}

/**
 * Where a saved position actually belongs now.
 *
 * Maps change: the ranch was split into a house and a yard, so a save made
 * out in the old paddock points outside the house entirely. Rather than
 * dropping the player into the void (or inside a wall), find them somewhere
 * they can stand.
 */
export function safeSpawn(
  mapId: string,
  x: number,
  y: number,
): { mapId: string; x: number; y: number; relocated: boolean } {
  const map = getMap(mapId);
  if (!map) {
    const fallback = getMap("starter_town");
    return { mapId: "starter_town", x: 7, y: 7, relocated: true, ...(fallback ? {} : {}) };
  }

  const standable = (mx: number, my: number): boolean =>
    mx >= 0 &&
    my >= 0 &&
    mx < map.width &&
    my < map.height &&
    isTilePassable(map.tiles[my]?.[mx] ?? "tree");

  if (standable(x, y)) {
    return { mapId, x, y, relocated: false };
  }

  // A pre-split ranch save was out in the paddock: that is the yard now.
  if (mapId === "home_ranch" && (y >= map.height || y > 4)) {
    const yard = getMap("ranch_yard");
    if (yard && isTilePassable(yard.tiles[2]?.[7] ?? "tree")) {
      return { mapId: "ranch_yard", x: 7, y: 2, relocated: true };
    }
  }

  // Otherwise take the closest tile you can stand on.
  let best: { x: number; y: number; distance: number } | null = null;
  const clampX = Math.min(map.width - 1, Math.max(0, x));
  const clampY = Math.min(map.height - 1, Math.max(0, y));
  for (let my = 0; my < map.height; my += 1) {
    for (let mx = 0; mx < map.width; mx += 1) {
      if (!standable(mx, my)) {
        continue;
      }
      const distance = Math.abs(mx - clampX) + Math.abs(my - clampY);
      if (!best || distance < best.distance) {
        best = { x: mx, y: my, distance };
      }
    }
  }

  if (best) {
    return { mapId, x: best.x, y: best.y, relocated: true };
  }
  return { mapId, x: clampX, y: clampY, relocated: true };
}

export function isTilePassable(tile: TileKind): boolean {
  return (
    tile !== "bed" &&
    (tile === "path" ||
      tile === "grass" ||
      tile === "vroomgrass" ||
      tile === "indoor-floor" ||
      tile === "doormat" ||
      tile === "tall-grass-edge" ||
      tile === "counter" ||
      tile === "rock")
  );
}
