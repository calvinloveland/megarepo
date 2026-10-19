// Overworld art.
//
// Everything here is drawn on a 16-column pixel grid (see `pixel.ts`) so the
// result is real pixel art rather than canvas shapes: two screen pixels per
// art pixel at the 32px tile size, six in the 96px exports. Tiles are
// procedural (they sit in a field and need texture, not a picture), while
// people are authored as character grids — the way an RPG spritesheet is
// authored — because a figure made of rectangles never stops looking like one.
import type { Direction, TileKind } from "./types.js";
import { MAPS } from "./maps.js";
import { SPRITE_PALETTE as PAL, houseAccentForNpc } from "./sprites-palette.js";
import {
  ACCESSORY_ROWS,
  BODY_DOWN,
  BODY_LEFT,
  BODY_UP,
  HEAD_ROWS,
  OUTFIT_ROWS,
  PERSON_ROWS,
} from "./sprite-art.js";
import {
  artPixel,
  drawArtOutline,
  drawArtRows,
  hashUnit,
  mixHex,
  type ArtPalette,
  type PixelCanvas,
} from "./pixel.js";

/** The keyline every sprite shares: nearly black, warm, and never pure black. */
const KEYLINE = "#1b1109";

const WALL_KINDS = new Set<TileKind>(["wall", "building", "tree-trunk"]);

// ---- Ground ----
// A ground tile must read as one sample of a field, never as a square: the
// fill runs edge to edge with no border, and all texture is sparse and
// irregular. (The old renderer shaded every tile's right and bottom edge,
// which stacked into a visible grid across the whole map — the first thing
// that made the world look like a spreadsheet.)

interface Ramp {
  base: string;
  light: string;
  dark: string;
  detail: string;
}

const RAMPS: Partial<Record<TileKind, Ramp>> = {
  grass: { base: "#6da53f", light: "#7cb84a", dark: "#54892f", detail: "#43721f" },
  "tall-grass-edge": { base: "#5f9a3a", light: "#71ad46", dark: "#47792a", detail: "#35601c" },
  vroomgrass: { base: "#4c8a34", light: "#5d9c40", dark: "#3a7026", detail: "#2c5a1b" },
  path: { base: "#c8ab77", light: "#d8c091", dark: "#ae9060", detail: "#8f7448" },
  "indoor-floor": { base: "#a9855a", light: "#b28d61", dark: "#9b7950", detail: "#8b6c46" },
  water: { base: "#2e6ca6", light: "#3d81bd", dark: "#255a8c", detail: "#79b3dd" },
  doormat: { base: "#9c6234", light: "#ac7040", dark: "#7d4c26", detail: "#6a3f1e" },
  rock: { base: "#8a8a8a", light: "#a5a5a5", dark: "#6a6a6a", detail: "#4f4f4f" },
  tree: { base: "#2f6b3a", light: "#3d8349", dark: "#23532c", detail: "#163a1e" },
  bed: { base: "#8a6440", light: "#9d7550", dark: "#6f4e30", detail: "#4a2f18" },
  counter: { base: "#8a5a30", light: "#a96f3c", dark: "#5d3a1c", detail: "#3d2410" },
  fence: { base: "#7d6040", light: "#a28055", dark: "#5e452b", detail: "#4a3520" },
  door: { base: "#8c5a2e", light: "#9d6a38", dark: "#5e3a1c", detail: "#3a2210" },
};

function ramp(tile: TileKind): Ramp {
  return RAMPS[tile] ?? { base: "#888888", light: "#999999", dark: "#777777", detail: "#555555" };
}

export function drawTile(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tick: number,
  tx = 0,
  ty = 0,
): void {
  if (WALL_KINDS.has(tile)) {
    drawWallBase(ctx, tile, px, py, size, tx, ty);
    drawWallBrick(ctx, tile, px, py, size, tx, ty);
    return;
  }
  drawGroundBase(ctx, tile, px, py, size, tx, ty);
  drawGroundDetail(ctx, tile, px, py, size, tick, tx, ty);
}

function drawGroundBase(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tx: number,
  ty: number,
): void {
  const p = artPixel(size);
  const colors = ramp(tile);
  ctx.fillStyle = colors.base;
  ctx.fillRect(px, py, size, size);

  if (tile === "indoor-floor") {
    drawPlankFloor(ctx, colors, px, py, size, p, tx, ty);
    return;
  }
  if (tile === "water") {
    drawWaterBase(ctx, colors, px, py, size, p, tx, ty);
    return;
  }
  if (tile === "rock") {
    drawBoulder(ctx, colors, px, py, size, p, tx, ty);
    return;
  }
  if (tile === "tree") {
    drawCanopy(ctx, colors, px, py, size, p, tx, ty);
    return;
  }

  // Sparse two-tone speckle. Positions come from the tile coordinate, so a
  // field is textured cell by cell instead of stamping one identical square.
  const speckles = tile === "path" ? 9 : 7;
  for (let i = 0; i < speckles; i += 1) {
    const hx = hashUnit(tx * 7 + i, ty * 13 + i * 3, 11);
    const hy = hashUnit(tx * 13 + i * 5, ty * 7 + i, 29);
    const x = Math.floor(hx * 16) * p;
    const y = Math.floor(hy * 16) * p;
    ctx.fillStyle = hx > 0.55 ? colors.light : colors.dark;
    ctx.fillRect(px + x, py + y, p, p);
  }

  if (tile === "grass" || tile === "tall-grass-edge" || tile === "vroomgrass") {
    drawBlades(ctx, colors, px, py, size, p, tile, tx, ty);
  }
  if (tile === "path") {
    drawPebbles(ctx, colors, px, py, size, p, tx, ty);
  }
  if (tile === "doormat") {
    drawMat(ctx, px, py, size, p);
  }
}

function drawBlades(
  ctx: PixelCanvas,
  colors: Ramp,
  px: number,
  py: number,
  size: number,
  p: number,
  tile: TileKind,
  tx: number,
  ty: number,
): void {
  // Density is what tells the three grasses apart at a glance: the paddock is
  // sparse tufts, the fringe is a fringe, and the wild grass is a thick stand
  // you can see from across the map. A wild patch that looks like mown grass
  // is a gameplay bug wearing a palette.
  const dense = tile === "vroomgrass";
  const fringe = tile === "tall-grass-edge";
  const tufts = dense ? 9 : fringe ? 7 : 4;
  const maxHeight = dense ? 7 : fringe ? 5 : 3;
  for (let i = 0; i < tufts; i += 1) {
    const hx = hashUnit(tx * 3 + i, ty * 5 + i * 7, 41);
    const hy = hashUnit(tx * 11 + i * 3, ty * 3 + i, 53);
    const x = Math.floor(hx * 15);
    const y = 2 + Math.floor(hy * (16 - maxHeight));
    const height = maxHeight - Math.floor(hy * 2);
    // Stem, one pixel wide, plus a leaning tip: three pixels of blade reads
    // as grass; a straight bar reads as a picket.
    ctx.fillStyle = colors.detail;
    ctx.fillRect(px + x * p, py + (y + 1) * p, p, height * p);
    ctx.fillStyle = colors.dark;
    ctx.fillRect(px + (x + (hx > 0.5 ? 1 : -1)) * p, py + y * p, p, 2 * p);
    if (dense && i % 3 === 0) {
      // Seed heads: the wild grass carries gold, so it is legible from a
      // distance even in a still frame.
      ctx.fillStyle = PAL.accent.gold;
      ctx.fillRect(px + (x + (hx > 0.5 ? 1 : -1)) * p, py + (y - 1) * p, p, p);
    }
  }
  void size;
}

function drawPebbles(
  ctx: PixelCanvas,
  colors: Ramp,
  px: number,
  py: number,
  size: number,
  p: number,
  tx: number,
  ty: number,
): void {
  for (let i = 0; i < 4; i += 1) {
    const hx = hashUnit(tx + i * 17, ty + i * 5, 67);
    const hy = hashUnit(tx + i * 5, ty + i * 23, 71);
    const x = Math.floor(hx * 13);
    const y = Math.floor(hy * 13);
    ctx.fillStyle = colors.detail;
    ctx.fillRect(px + x * p, py + y * p, 2 * p, p);
    ctx.fillStyle = colors.light;
    ctx.fillRect(px + x * p, py + y * p, p, p);
  }
  void size;
}

function drawPlankFloor(
  ctx: PixelCanvas,
  colors: Ramp,
  px: number,
  py: number,
  size: number,
  p: number,
  tx: number,
  ty: number,
): void {
  // Boards run across the room with no end joints: a staggered joint every
  // few pixels turns a floor into brickwork, which is what it kept looking
  // like. Grain does the work instead, and the seams stay a shade apart.
  const boards = 4;
  const boardH = 16 / boards;
  ctx.fillStyle = colors.base;
  ctx.fillRect(px, py, size, size);
  for (let row = 0; row < boards; row += 1) {
    const y = py + row * boardH * p;
    if (row % 2 === 1) {
      ctx.fillStyle = colors.light;
      ctx.fillRect(px, y, size, boardH * p);
    }
    const seed = hashUnit(tx + row * 3, ty + row, 211);
    const seed2 = hashUnit(tx + row, ty + row * 5, 241);
    // Grain: two soft strokes per board at hashed positions and lengths.
    ctx.fillStyle = colors.detail;
    ctx.fillRect(px + Math.floor(seed * 11) * p, y + p, (2 + Math.floor(seed2 * 4)) * p, p);
    ctx.fillRect(px + Math.floor(seed2 * 12) * p, y + 2 * p, (2 + Math.floor(seed * 3)) * p, p);
    if (seed > 0.72) {
      // A knot, on some boards only.
      ctx.fillRect(px + Math.floor(seed2 * 13) * p, y + p + p, p, p);
    }
    // Seam: one pixel of shade at the foot of the board.
    ctx.fillStyle = colors.dark;
    ctx.fillRect(px, y + boardH * p - p, size, p);
  }
}

function drawWaterBase(
  ctx: PixelCanvas,
  colors: Ramp,
  px: number,
  py: number,
  size: number,
  p: number,
  tx: number,
  ty: number,
): void {
  // Depth: a couple of darker cells, then static ripple bands. The animated
  // glints are drawn per frame by the renderer, not baked in here.
  for (let i = 0; i < 6; i += 1) {
    const hx = hashUnit(tx + i * 9, ty + i * 3, 17);
    const hy = hashUnit(tx + i * 3, ty + i * 11, 19);
    ctx.fillStyle = hx > 0.5 ? colors.light : colors.dark;
    ctx.fillRect(px + Math.floor(hx * 15) * p, py + Math.floor(hy * 15) * p, 2 * p, p);
  }
  ctx.fillStyle = colors.light;
  ctx.fillRect(px + 2 * p, py + 5 * p, 5 * p, p);
  ctx.fillRect(px + 9 * p, py + 10 * p, 4 * p, p);
}

function drawCanopy(
  ctx: PixelCanvas,
  colors: Ramp,
  px: number,
  py: number,
  size: number,
  p: number,
  tx: number,
  ty: number,
): void {
  // A treeline, not a row of triangles: overlapping leaf clusters at three
  // tones, darkest at the foot, so a border of trees reads as one mass of
  // foliage with light falling on it.
  ctx.fillStyle = colors.base;
  ctx.fillRect(px, py, size, size);
  const clusters = 5;
  for (let i = 0; i < clusters; i += 1) {
    const hx = hashUnit(tx * 5 + i, ty * 3 + i * 7, 131);
    const hy = hashUnit(tx * 3 + i * 7, ty * 5 + i, 137);
    const cx = 1 + Math.floor(hx * 12);
    const cy = 1 + Math.floor(hy * 11);
    const radius = 2 + Math.floor(hx * 2);
    ctx.fillStyle = i % 2 === 0 ? colors.light : colors.dark;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius + 1) {
          continue;
        }
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x > 15 || y < 0 || y > 15) {
          continue;
        }
        ctx.fillRect(px + x * p, py + y * p, p, p);
      }
    }
  }
  // Leaf specks catch the light; the very top of the canopy is washed lighter
  // so a forest edge has a direction.
  for (let i = 0; i < 7; i += 1) {
    const hx = hashUnit(tx + i * 11, ty + i * 3, 149);
    const hy = hashUnit(tx + i * 3, ty + i * 11, 151);
    ctx.fillStyle = hx > 0.5 ? mixHex(colors.light, "#ffffff", 0.15) : colors.detail;
    ctx.fillRect(px + Math.floor(hx * 15) * p, py + Math.floor(hy * 15) * p, p, p);
  }
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(px, py + size - 2 * p, size, 2 * p);
  void size;
}

function drawBoulder(
  ctx: PixelCanvas,
  colors: Ramp,
  px: number,
  py: number,
  size: number,
  p: number,
  tx: number,
  ty: number,
): void {
  // A broken outcrop: angular facets in three tones, rooted in the cell with a
  // dark rim. A round grey blob with a slot reads as a coin, which is exactly
  // what it looked like before.
  const rows = [
    "................",
    "................",
    "...######.......",
    "..##########....",
    ".#############..",
    ".##############.",
    "#####+++++######",
    "####+++#+++#####",
    "####++###++++###",
    "#####++++++#####",
    ".#############..",
    "..###########...",
    "...#########....",
    "....#######.....",
    ".....#####......",
    "................",
  ];
  const offset = Math.floor(hashUnit(tx, ty, 23) * 2);
  const palette: ArtPalette = {
    "#": colors.base,
    "+": colors.light,
    "-": colors.dark,
  };
  // Shadow the rock casts on its own cell.
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.fillRect(px + (1 + offset) * p, py + 13 * p, 13 * p, 2 * p);
  drawArtOutline(ctx, rows, "#2a2620", px - offset * p, py, p);
  drawArtRows(ctx, rows, palette, px - offset * p, py, p);
  // Cracks, so a field of rocks is not a field of identical boulders.
  ctx.fillStyle = colors.detail;
  const cx = 5 + Math.floor(hashUnit(tx, ty, 31) * 5);
  ctx.fillRect(px + cx * p, py + 6 * p, p, 3 * p);
  ctx.fillRect(px + (cx + 1) * p, py + 8 * p, 2 * p, p);
  ctx.fillStyle = colors.dark;
  ctx.fillRect(px + (cx + 3) * p, py + 10 * p, p, 2 * p);
}

function drawMat(
  ctx: PixelCanvas,
  px: number,
  py: number,
  size: number,
  p: number,
): void {
  // A dressed stone threshold: the one thing that reads as "this is the way
  // through" both at a town gate and inside a house. Every woven-mat version
  // read as a wooden crate or a patch of brickwork sitting on the path,
  // because a rectangle of a different colour in the middle of the ground is a
  // box, whatever texture is on it.
  const stone = { base: "#8f8b80", light: "#a5a196", dark: "#726f66", seam: "#5c5a52" };
  ctx.fillStyle = stone.base;
  ctx.fillRect(px, py, size, size);
  // Two courses, offset, with a chiselled seam.
  ctx.fillStyle = stone.light;
  ctx.fillRect(px, py + p, size, 6 * p);
  ctx.fillRect(px, py + 8 * p, size, 6 * p);
  ctx.fillStyle = stone.dark;
  ctx.fillRect(px, py + 7 * p, size, p);
  ctx.fillRect(px, py + 14 * p, size, p);
  ctx.fillStyle = stone.seam;
  ctx.fillRect(px + (5 * p), py, p, 7 * p);
  ctx.fillRect(px + (11 * p), py + 8 * p, p, 7 * p);
  // Wear: a couple of chips, and a shadow at the edges so it sits in the
  // ground rather than on it.
  ctx.fillStyle = stone.dark;
  ctx.fillRect(px + 3 * p, py + 3 * p, 2 * p, p);
  ctx.fillRect(px + 9 * p, py + 10 * p, p, p);
  ctx.fillStyle = "rgba(20, 14, 8, 0.22)";
  ctx.fillRect(px, py, size, p);
  ctx.fillRect(px, py + size - p, size, p);
}

/**
 * Props that stand up out of their tile.
 *
 * A counter, a bed and a fence drawn flat inside one 32px cell all read as
 * things lying on the floor — which is exactly the criticism they earned. They
 * are drawn in their own pass, 1.25 tiles tall and anchored to the tile's
 * floor, so they overlap the tile above and cast their own shadow. The pass
 * runs top row to bottom row, so a nearer prop always covers a farther one.
 */
export const TALL_PROP_TILES = new Set<TileKind>(["fence", "counter", "bed"]);

/** Height of a tall prop in art rows (the tile is 16). */
export const TALL_PROP_ROWS = 20;

const FENCE_ROWS: readonly string[] = [
  "................",
  "................",
  "................",
  ".......PPP......",
  ".......PpP......",
  "RRRRRRRPpPRRRRRR",
  "RrrrrrrPpPrrrrrR",
  "RRRRRRRPpPRRRRRR",
  ".......PpP......",
  ".......PpP......",
  "RRRRRRRPpPRRRRRR",
  "RrrrrrrPpPrrrrrR",
  "RRRRRRRPpPRRRRRR",
  ".......PpP......",
  ".......PpP......",
  ".......PpP......",
  ".......PpP......",
  "......PPPP......",
  "................",
  "................",
];

const COUNTER_ROWS: readonly string[] = [
  "................",
  "................",
  "................",
  "TTTTTTTTTTTTTTTT",
  "TttttttttttttttT",
  "tttttttttttttttt",
  "tttttttttttttttt",
  "tttttttttttttttt",
  "LLLLLLLLLLLLLLLL",
  "FFFFFFFFFFFFFFFF",
  "FFfdFFfdFFfdFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFfdFFfdFFfdFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "SSSSSSSSSSSSSSSS",
  "................",
  "................",
];

const BED_ROWS: readonly string[] = [
  "................",
  "HHHHHHHHHHHHHHHH",
  "HhhhhhhhhhhhhhhH",
  "HhhhhhhhhhhhhhhH",
  "HhhhhhhhhhhhhhhH",
  "HWWWWWWWWWWWWWWH",
  "HWWWWWWWWWWWWWWH",
  "HBBBBBBBBBBBBBBH",
  "HBBBBBBBBBBBBBBH",
  "HBBBBBBBBBBBBBBH",
  "HBBBBBBBBBBBBBBH",
  "HBBBBBBBBBBBBBBH",
  "HBBBBBBBBBBBBBBH",
  "HBBBBBBBBBBBBBBH",
  "HhhhhhhhhhhhhhhH",
  "HhhhhhhhhhhhhhhH",
  "HhhhhhhhhhhhhhhH",
  "HHHHHHHHHHHHHHHH",
  "................",
  "................",
];

/**
 * Draw one tall prop. `px,py` is the tile's top-left, so the prop's extra rows
 * hang above the tile, over whatever is there.
 */
export function drawTallProp(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  neighbours: { west: boolean; east: boolean } = { west: true, east: true },
): void {
  const p = artPixel(size);
  const originY = py + size - TALL_PROP_ROWS * p;
  if (tile === "fence") {
    const palette: ArtPalette = {
      P: "#8a6a44",
      p: "#6b5033",
      R: "#a28055",
      r: "#7d6040",
    };
    drawArtOutline(ctx, FENCE_ROWS, KEYLINE, px, originY, p);
    drawArtRows(ctx, FENCE_ROWS, palette, px, originY, p);
    // Sawed-off ends are what made a fence run look like floating fragments:
    // a run that stops gets an end post, and the rails stop with it.
    const endPost = (x: number): void => {
      ctx.fillStyle = KEYLINE;
      ctx.fillRect(px + x * p, originY + 3 * p, 3 * p, 15 * p);
      ctx.fillStyle = "#8a6a44";
      ctx.fillRect(px + x * p, originY + 4 * p, 2 * p, 13 * p);
      ctx.fillStyle = "#6b5033";
      ctx.fillRect(px + x * p, originY + 4 * p, p, 13 * p);
    };
    if (!neighbours.west) {
      // Cut the rails at the run's end so they do not hang in the air.
      ctx.fillStyle = "rgba(20, 14, 8, 0.55)";
      ctx.fillRect(px, originY + 5 * p, 2 * p, 3 * p);
      ctx.fillRect(px, originY + 10 * p, 2 * p, 3 * p);
      endPost(1);
    }
    if (!neighbours.east) {
      ctx.fillStyle = "rgba(20, 14, 8, 0.55)";
      ctx.fillRect(px + 14 * p, originY + 5 * p, 2 * p, 3 * p);
      ctx.fillRect(px + 14 * p, originY + 10 * p, 2 * p, 3 * p);
      endPost(13);
    }
    return;
  }
  if (tile === "counter") {
    const palette: ArtPalette = {
      T: "#c48d52",
      t: "#b07c46",
      L: "#96602f",
      F: "#7d5128",
      f: "#8f5f30",
      d: "#5d3a1c",
      S: "rgba(0, 0, 0, 0.28)",
    };
    drawArtOutline(ctx, COUNTER_ROWS, KEYLINE, px, originY, p);
    drawArtRows(ctx, COUNTER_ROWS, palette, px, originY, p);
    return;
  }
  // Bed.
  const palette: ArtPalette = {
    H: "#4a2f18",
    h: "#8a6440",
    W: "#efe4cc",
    B: "#cf3a3a",
  };
  drawArtOutline(ctx, BED_ROWS, KEYLINE, px, originY, p);
  drawArtRows(ctx, BED_ROWS, palette, px, originY, p);
}

/**
 * The ragged join between two grounds.
 *
 * Two ground types meeting at a tile edge is a straight line, and a straight
 * line across a field reads as a bucket fill. This stipples the neighbour's
 * colour into this tile along the shared edge, fading with depth, so grass
 * creeps onto a path and a path crumbles into grass. Deterministic from the
 * tile coordinate; a dozen rectangles per shared edge, once, at bake time.
 */
const TRANSITION_GROUNDS = new Set<TileKind>([
  "grass",
  "tall-grass-edge",
  "vroomgrass",
  "path",
  "water",
]);

export function drawGroundTransition(
  ctx: PixelCanvas,
  tile: TileKind,
  neighbour: TileKind,
  edge: "north" | "south" | "east" | "west",
  px: number,
  py: number,
  size: number,
  tx: number,
  ty: number,
): void {
  if (tile === neighbour) {
    return;
  }
  if (WALL_KINDS.has(tile) || WALL_KINDS.has(neighbour) || tile === "tree" || neighbour === "tree") {
    return;
  }
  // Grounds only. Props and furniture do not bleed into the ground they stand
  // on — a boulder ringed with grey confetti is the noise this function
  // exists to avoid, not an example of it.
  if (!TRANSITION_GROUNDS.has(tile) || !TRANSITION_GROUNDS.has(neighbour)) {
    return;
  }
  const p = artPixel(size);
  const colors = ramp(neighbour);
  const salt = { north: 307, south: 311, east: 313, west: 317 }[edge];
  const water = neighbour === "water" || tile === "water";
  // A shoreline is drawn dense and dark; everything else is sparse.
  const threshold = water ? 0.1 : 0.26;
  for (let along = 0; along < 16; along += 1) {
    const hx = hashUnit(tx * 13 + along * 7, ty * 11 + along * 3, salt);
    if (hx < threshold) {
      continue;
    }
    // Deeper marks are rarer: a fringe, not a gradient wash.
    const depth = 1 + Math.floor(hx * hx * (water ? 3 : 3));
    let x = along;
    let y = 0;
    if (edge === "north") {
      y = depth - 1;
    } else if (edge === "south") {
      y = 15 - (depth - 1);
    } else if (edge === "west") {
      x = depth - 1;
      y = along;
    } else {
      x = 15 - (depth - 1);
      y = along;
    }
    ctx.fillStyle = water
      ? hx > 0.55
        ? "rgba(24, 34, 20, 0.5)"
        : "rgba(226, 214, 176, 0.35)"
      : hx > 0.62
        ? colors.base
        : colors.detail;
    ctx.fillRect(px + x * p, py + y * p, p, p);
    // Occasionally a second cell inward, so the join has a fringe rather than
    // a dotted line.
    if (hx > 0.86) {
      const bx = edge === "west" ? x + 1 : edge === "east" ? x - 1 : x;
      const by = edge === "north" ? y + 1 : edge === "south" ? y - 1 : y;
      ctx.fillRect(px + bx * p, py + by * p, p, p);
    }
  }
}

/**
 * Per-cell ground detail, drawn on top of whichever layer produced the tile
 * (PNG or code). The tile image is one picture; a field is many cells, and a
 * field of one picture repeated is a checkerboard. This is the difference, and
 * it costs a handful of rectangles per tile — the layer is baked once.
 */
export function drawGroundScatter(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tx: number,
  ty: number,
): void {
  if (
    WALL_KINDS.has(tile) ||
    tile === "bed" ||
    tile === "counter" ||
    tile === "door" ||
    tile === "doormat"
  ) {
    return;
  }
  const p = artPixel(size);
  const colors = ramp(tile);
  if (tile === "tree") {
    // Leaf clumps that drift a little between cells so a treeline has a grain.
    for (let i = 0; i < 3; i += 1) {
      const hx = hashUnit(tx * 3 + i * 9, ty * 7 + i, 173);
      const hy = hashUnit(tx * 11 + i, ty * 5 + i * 3, 179);
      ctx.fillStyle = hx > 0.5 ? mixHex(colors.light, "#ffffff", 0.12) : colors.detail;
      ctx.fillRect(px + Math.floor(hx * 15) * p, py + Math.floor(hy * 15) * p, p, p);
    }
    return;
  }
  if (tile === "water") {
    ctx.fillStyle = colors.detail;
    const hx = hashUnit(tx, ty, 181);
    ctx.fillRect(px + Math.floor(hx * 12) * p, py + Math.floor(hx * 12) * p, 2 * p, p);
    return;
  }
  if (tile === "rock") {
    return;
  }
  // Grass, path and floor: a couple of marks that differ cell to cell, tuned
  // down so they read as ground rather than as debris.
  for (let i = 0; i < 2; i += 1) {
    const hx = hashUnit(tx * 5 + i, ty * 9 + i * 3, 191);
    const hy = hashUnit(tx * 9 + i * 3, ty * 5 + i, 193);
    ctx.fillStyle = hx > 0.5 ? colors.light : colors.dark;
    ctx.fillRect(px + Math.floor(hx * 15) * p, py + Math.floor(hy * 15) * p, p, p);
  }
}

function drawGroundDetail(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tick: number,
  tx: number,
  ty: number,
): void {
  const p = artPixel(size);

  if (tile === "bed") {
    drawBed(ctx, px, py, size, p);
    return;
  }
  if (tile === "counter") {
    drawCounter(ctx, px, py, size, p, tx, ty);
    return;
  }
  if (tile === "fence") {
    drawFence(ctx, px, py, size, p);
    return;
  }
  if (tile === "door") {
    drawDoor(ctx, px, py, size, p);
    return;
  }
  if (tile === "water") {
    // The baked layer holds still; the renderer animates the glints over it.
    void tick;
    return;
  }
  if (tile === "vroomgrass") {
    // Slow wind in the seed heads. Baked at phase 0 so the tile layer never
    // shimmers when the map scrolls.
    void tick;
    return;
  }
  if (tile === "tall-grass-edge") {
    ctx.fillStyle = "rgba(38, 78, 26, 0.55)";
    for (let i = 0; i < 3; i += 1) {
      const x = 1 + Math.floor(hashUnit(tx + i, ty + i * 3, 83) * 13);
      const y = 12 + Math.floor(hashUnit(tx + i * 5, ty + i, 89) * 3);
      ctx.fillRect(px + x * p, py + y * p, p, 2 * p);
    }
  }
}

function drawBed(
  ctx: PixelCanvas,
  px: number,
  py: number,
  size: number,
  p: number,
): void {
  // Headboard at the top, pillow, blanket with a turned-down sheet.
  ctx.fillStyle = "#4a2f18";
  ctx.fillRect(px + 1 * p, py + 2 * p, 14 * p, 13 * p);
  ctx.fillStyle = "#8a6440";
  ctx.fillRect(px + 2 * p, py + 3 * p, 12 * p, 11 * p);
  ctx.fillStyle = "#efe4cc";
  ctx.fillRect(px + 3 * p, py + 4 * p, 10 * p, 3 * p);
  ctx.fillStyle = "#cf3a3a";
  ctx.fillRect(px + 3 * p, py + 7 * p, 10 * p, 6 * p);
  ctx.fillStyle = "#a82727";
  for (let y = 8; y < 13; y += 2) {
    ctx.fillRect(px + 3 * p, py + y * p, 10 * p, p);
  }
  ctx.fillStyle = "#e8dcc4";
  ctx.fillRect(px + 3 * p, py + 7 * p, 10 * p, p);
  ctx.fillStyle = "#3a2410";
  ctx.fillRect(px + 1 * p, py + 2 * p, 14 * p, p);
  ctx.fillRect(px + 1 * p, py + 14 * p, 14 * p, p);
}

function drawCounter(
  ctx: PixelCanvas,
  px: number,
  py: number,
  size: number,
  p: number,
  tx: number,
  ty: number,
): void {
  // A worktop, not a cabinet: a continuous surface with grain, so a block of
  // counter tiles reads as one table instead of a stack of shelves.
  ctx.fillStyle = "#9a6a3a";
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = "#b07c46";
  ctx.fillRect(px, py, size, 14 * p);
  ctx.fillStyle = "#c48d52";
  ctx.fillRect(px, py + p, size, 3 * p);
  // Grain runs along the counter.
  ctx.fillStyle = "#8a5c30";
  for (let i = 0; i < 3; i += 1) {
    const hx = hashUnit(tx + i * 3, ty + i, 227);
    const hy = hashUnit(tx + i, ty + i * 5, 229);
    ctx.fillRect(px + Math.floor(hx * 10) * p, py + (2 + Math.floor(hy * 9)) * p, 5 * p, p);
  }
  // A knife scar or two.
  ctx.fillStyle = "#6e4623";
  const scar = Math.floor(hashUnit(tx, ty, 233) * 12);
  ctx.fillRect(px + scar * p, py + 6 * p, 3 * p, p);
  // Front lip: one row, so tiles above it still read as surface.
  ctx.fillStyle = "#6b4522";
  ctx.fillRect(px, py + 14 * p, size, 2 * p);
  ctx.fillStyle = "#4d3016";
  ctx.fillRect(px, py + 15 * p, size, p);
}

function drawFence(
  ctx: PixelCanvas,
  px: number,
  py: number,
  size: number,
  p: number,
): void {
  // Two rails behind a post, with a cast shadow so a fence row has weight.
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(px + 2 * p, py + 14 * p, 13 * p, 2 * p);
  ctx.fillStyle = "#7d6040";
  ctx.fillRect(px + 1 * p, py + 5 * p, 14 * p, 2 * p);
  ctx.fillRect(px + 1 * p, py + 10 * p, 14 * p, 2 * p);
  ctx.fillStyle = "#a28055";
  ctx.fillRect(px + 1 * p, py + 5 * p, 14 * p, p);
  ctx.fillRect(px + 1 * p, py + 10 * p, 14 * p, p);
  ctx.fillStyle = "#5e452b";
  ctx.fillRect(px + 6 * p, py + 3 * p, 4 * p, 12 * p);
  ctx.fillStyle = "#8a6a44";
  ctx.fillRect(px + 6 * p, py + 3 * p, 3 * p, 12 * p);
  ctx.fillStyle = "#4a3520";
  ctx.fillRect(px + 6 * p, py + 3 * p, 4 * p, p);
}

function drawDoor(
  ctx: PixelCanvas,
  px: number,
  py: number,
  size: number,
  p: number,
): void {
  // A doorway set into a wall: dark reveal, a lintel over it, a planked door
  // with a middle rail and a brass knob. As a single tile between two wall
  // tiles it has to read as an opening, not as a crate.
  ctx.fillStyle = "#2a1b0e";
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = "#6d4522";
  ctx.fillRect(px + 2 * p, py + 3 * p, 12 * p, 13 * p);
  // Planks.
  ctx.fillStyle = "#855730";
  for (let x = 3; x < 14; x += 3) {
    ctx.fillRect(px + x * p, py + 3 * p, 2 * p, 13 * p);
  }
  ctx.fillStyle = "#4f3116";
  for (let x = 5; x < 14; x += 3) {
    ctx.fillRect(px + x * p, py + 3 * p, p, 13 * p);
  }
  // Middle rail and knob.
  ctx.fillStyle = "#8c5a2e";
  ctx.fillRect(px + 2 * p, py + 9 * p, 12 * p, 2 * p);
  ctx.fillStyle = "#4f3116";
  ctx.fillRect(px + 2 * p, py + 11 * p, 12 * p, p);
  ctx.fillStyle = PAL.accent.gold;
  ctx.fillRect(px + 11 * p, py + 8 * p, 2 * p, 2 * p);
  // Lintel: the stone/wood header that makes a door look built in.
  ctx.fillStyle = "#3a2716";
  ctx.fillRect(px, py + p, size, 2 * p);
  ctx.fillStyle = "#7a5730";
  ctx.fillRect(px, py + p, size, p);
  // Threshold shadow.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(px, py + size - p, size, p);
}
// ---- Walls ----
// Walls are the one tile that has to know it is standing up: a lit coping
// along the top, a face below it, a skirting shadow at the foot. Drawn the
// other way (a flat repeating pattern) a wall reads as wallpaper on the floor.

const WALL_PALETTES: Record<string, { brick: string; mortar: string; trim: string; top: string }> = {
  wall: { brick: "#5a3d27", mortar: "#33210f", trim: "#8f6b46", top: "#a37c52" },
  building: { brick: "#cbb488", mortar: "#8d7550", trim: "#5c4630", top: "#e0cda6" },
  "tree-trunk": { brick: "#4a2f18", mortar: "#2a1a0c", trim: "#6a4a2a", top: "#7d5730" },
};

function drawWallBase(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tx = 0,
  ty = 0,
): void {
  const p = artPixel(size);
  const colors = WALL_PALETTES[tile] ?? WALL_PALETTES.wall!;
  ctx.fillStyle = colors.mortar;
  ctx.fillRect(px, py, size, size);
  // Face tone.
  ctx.fillStyle = colors.brick;
  ctx.fillRect(px, py + 3 * p, size, size - 4 * p);
  if (tile === "building") {
    // Plaster: a warm wash with faint vertical streaks, no mortar lines.
    ctx.fillStyle = mixHex(colors.brick, colors.top, 0.35);
    ctx.fillRect(px, py + 3 * p, size, size - 4 * p);
    ctx.fillStyle = colors.mortar;
    for (let i = 0; i < 3; i += 1) {
      const x = Math.floor(hashUnit(tx + i, ty, 101) * 15);
      ctx.fillRect(px + x * p, py + (4 + i * 4) * p, p, 3 * p);
    }
  }
}

function drawWallBrick(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
  tx = 0,
  ty = 0,
): void {
  const p = artPixel(size);
  const colors = WALL_PALETTES[tile] ?? WALL_PALETTES.wall!;
  if (tile === "building") {
    // Half-timbering: one post per tile, so a run of them reads as a frame.
    ctx.fillStyle = colors.trim;
    ctx.fillRect(px + 1 * p, py + 3 * p, 2 * p, size - 4 * p);
    ctx.fillRect(px + 13 * p, py + 3 * p, p, size - 4 * p);
    ctx.fillStyle = mixHex(colors.trim, "#000000", 0.25);
    ctx.fillRect(px + 1 * p, py + 3 * p, p, size - 4 * p);
    // Nail heads.
    ctx.fillStyle = "#4a3520";
    ctx.fillRect(px + 1 * p, py + 5 * p, p, p);
    ctx.fillRect(px + 1 * p, py + 12 * p, p, p);
    // Window: dark pane with a lit sill, matched by the night-light overlay.
    ctx.fillStyle = "#3a2c1e";
    ctx.fillRect(px + 5 * p, py + 5 * p, 7 * p, 6 * p);
    ctx.fillStyle = "#6f97b8";
    ctx.fillRect(px + 6 * p, py + 6 * p, 5 * p, 4 * p);
    ctx.fillStyle = "#9cc4dd";
    ctx.fillRect(px + 6 * p, py + 6 * p, 2 * p, 2 * p);
    ctx.fillStyle = "#3a2c1e";
    ctx.fillRect(px + 8 * p, py + 6 * p, p, 4 * p);
    ctx.fillRect(px + 6 * p, py + 7 * p, 5 * p, p);
    ctx.fillStyle = colors.trim;
    ctx.fillRect(px + 4 * p, py + 11 * p, 9 * p, p);
    void tx;
    void ty;
    return;
  }

  // Brick courses: 8-wide bricks on a 4-row pitch, half-bricks at the edges,
  // every row offset by two so the courses interlock. Nothing is drawn past
  // the tile — an overflowing brick paints a stripe across its neighbour.
  for (let row = 0; row < 4; row += 1) {
    const y = py + (3 + row * 4) * p;
    const offset = row % 2 === 0 ? 0 : 2;
    for (let brick = -8; brick < 16; brick += 8) {
      const x0 = Math.max(0, brick + offset);
      const x1 = Math.min(16, brick + offset + 7);
      const w = x1 - x0;
      if (w <= 0) {
        continue;
      }
      ctx.fillStyle = colors.brick;
      ctx.fillRect(px + x0 * p, y, w * p, 3 * p);
      ctx.fillStyle = mixHex(colors.brick, colors.trim, 0.22);
      ctx.fillRect(px + x0 * p, y, w * p, p);
    }
  }
  void size;
}

/**
 * The lit top face of a wall run. Drawn by the tile layer only where a wall has
 * no wall above it — a coping line on every wall tile turns a side wall into a
 * column of shelves, which is what a per-tile "wall" always looks like.
 */
export function drawWallTrim(
  ctx: PixelCanvas,
  tile: TileKind,
  px: number,
  py: number,
  size: number,
): void {
  const p = artPixel(size);
  const colors = WALL_PALETTES[tile] ?? WALL_PALETTES.wall!;
  ctx.fillStyle = colors.top;
  ctx.fillRect(px, py, size, 2 * p);
  ctx.fillStyle = mixHex(colors.top, "#ffffff", 0.18);
  ctx.fillRect(px, py, size, p);
}

/**
 * Eaves for the top edge of a house front. A `building` tile is a wall with a
 * window in it; a row of them with nothing above reads as a stack of crates
 * until something says "roof". Drawn by the tile layer only where a building
 * has no building above it, for the same reason as the wall coping.
 */
export function drawBuildingEaves(
  ctx: PixelCanvas,
  px: number,
  py: number,
  size: number,
): void {
  const p = artPixel(size);
  // Shingle course, lit on top, with a shadow falling onto the plaster.
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(px, py, size, 5 * p);
  ctx.fillStyle = "#8f4030";
  ctx.fillRect(px, py + p, size, 3 * p);
  ctx.fillStyle = "#b05a44";
  ctx.fillRect(px, py + p, size, p);
  for (let x = 0; x < 16; x += 4) {
    ctx.fillStyle = "#6d2f24";
    ctx.fillRect(px + x * p, py + 2 * p, p, 2 * p);
  }
  ctx.fillStyle = "rgba(12, 8, 4, 0.35)";
  ctx.fillRect(px, py + 5 * p, size, p);
}

/**
 * Contact shadow cast onto the ground below a wall. Without it a wall and a
 * floor meet in a hard line and the scene flattens into a diagram; with it the
 * wall stands up. `depth` of 0 is no shadow (a wall with a wall below it).
 */
export function drawWallShadow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  depth: number,
): void {
  if (depth <= 0) {
    return;
  }
  const gradient = ctx.createLinearGradient(px, py, px, py + depth);
  gradient.addColorStop(0, "rgba(12, 8, 4, 0.42)");
  gradient.addColorStop(1, "rgba(12, 8, 4, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(px, py, size, depth);
}

// ---- People ----
// A person is a 16-wide, 24-tall art grid drawn at 1.5 tiles of height: the
// classic top-down-RPG proportion, where the head is roughly a third of the
// figure and there is room for a neck, a belt and two separate legs. The grid
// is anchored to the tile's floor, not its top, so feet stand where the tile
// says they stand.
//
// Head, torso and accessory each own a fixed band (rows 2-12, 13-23, 0-8) so
// every outfit composes to exactly the same height — a taller hat must not
// push a villager's boots through the grass.

/** Drawn height in tile units: 24 rows at `size / 16` pixels each. */
export const PERSON_HEIGHT_TILES = PERSON_ROWS / 16;

const SKIN = { base: "#f2c79a", shade: "#d9a878", light: "#ffe3bd" };
const HAIR = { base: "#4a3222", light: "#6d4c33" };
const BOOT = "#3b2a1e";

interface FigureColors {
  body: string;
  bodyDark: string;
  trim: string;
  pants: string;
  pantsDark: string;
  cap: string;
  capDark: string;
}

function figurePalette(colors: FigureColors): ArtPalette {
  return {
    S: SKIN.base,
    s: SKIN.shade,
    H: HAIR.base,
    h: HAIR.light,
    E: PAL.ink.eyes,
    M: "#8f5a44",
    C: colors.cap,
    c: colors.capDark,
    B: colors.body,
    b: colors.bodyDark,
    T: colors.trim,
    P: colors.pants,
    p: colors.pantsDark,
    F: BOOT,
  };
}

/** Where a person's art starts relative to the tile's top-left corner: the
 * figure is 1.5 tiles tall and stands on the tile's floor. */
function personOriginY(py: number, size: number): number {
  return py + size - PERSON_ROWS * (size / 16);
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  facing: Direction,
  step: number,
  capColor: string = PAL.cap.navy,
): void {
  const p = artPixel(size);
  const palette = figurePalette({
    body: PAL.body.navy,
    bodyDark: mixHex(PAL.body.navy, "#000000", 0.3),
    trim: "#e8e2d0",
    pants: "#3a4a63",
    pantsDark: "#2c3a50",
    cap: capColor,
    capDark: mixHex(capColor, "#000000", 0.32),
  });
  // Two-frame stride driven by the millisecond clock the renderer already
  // passes. `round` snaps the feet to the grid: a boot between pixels is a
  // smear, not a step.
  const stride = Math.round(Math.sin(step / 90));
  drawFigure(ctx, px, py, p, facing, palette, stride);
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  p: number,
  facing: Direction,
  palette: ArtPalette,
  stride: number,
): void {
  const rows = facing === "up" ? BODY_UP : facing === "down" ? BODY_DOWN : BODY_LEFT;
  const oy = personOriginY(py, 16 * p);
  ctx.save();
  if (facing === "right") {
    // Mirrored around the tile centre, still on whole pixels.
    ctx.translate(px + 16 * p, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(px, 0);
  }
  drawArtOutline(ctx, rows, KEYLINE, 0, oy, p);
  drawArtRows(ctx, rows, palette, 0, oy, p);
  drawBoots(ctx, 0, oy, p, facing, palette, stride);
  ctx.restore();
}

function drawBoots(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  p: number,
  facing: Direction,
  palette: ArtPalette,
  stride: number,
): void {
  // The last two rows of the grid are always a foot that has moved: the side
  // view steps one boot forward and one back, the front view widens its
  // stance and lifts a heel.
  const boot = palette.F ?? BOOT;
  const clear = (x: number, y: number, w: number, h: number): void => {
    ctx.clearRect(ox + x * p, oy + y * p, w * p, h * p);
  };
  clear(2, 22, 12, 2);
  if (facing === "left" || facing === "right") {
    const front = 2 + stride;
    const back = 8 - stride;
    ctx.fillStyle = KEYLINE;
    ctx.fillRect(ox + (front - 1) * p, oy + 22 * p, 7 * p, 2 * p);
    ctx.fillRect(ox + (back - 1) * p, oy + 22 * p, 7 * p, 2 * p);
    ctx.fillStyle = boot;
    ctx.fillRect(ox + front * p, oy + 22 * p, 5 * p, p);
    ctx.fillRect(ox + back * p, oy + 22 * p, 5 * p, p);
    ctx.fillStyle = mixHex(boot, "#000000", 0.35);
    ctx.fillRect(ox + front * p, oy + 23 * p, 5 * p, p);
    ctx.fillRect(ox + back * p, oy + 23 * p, 5 * p, p);
    return;
  }
  const spread = stride === 0 ? 0 : 1;
  ctx.fillStyle = KEYLINE;
  ctx.fillRect(ox + (3 - spread) * p, oy + 22 * p, 10 * p, 2 * p);
  ctx.fillStyle = boot;
  ctx.fillRect(ox + (4 - spread) * p, oy + 22 * p, 3 * p, 2 * p);
  ctx.fillRect(ox + (9 + spread) * p, oy + 22 * p, 3 * p, 2 * p);
  ctx.fillStyle = mixHex(boot, "#000000", 0.35);
  ctx.fillRect(ox + (4 - spread) * p, oy + 23 * p, 3 * p, p);
  ctx.fillRect(ox + (9 + spread) * p, oy + 23 * p, 3 * p, p);
}

/**
 * A vroomon that will not move. Two plates on the ground, one wheel still
 * pinned, one rolled clear of the chassis — because the failure this prop
 * illustrates is about the ORDER of the parts, and a car missing a wheel would
 * be a different lesson.
 */
export function drawWreck(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
): void {
  const p = artPixel(size);
  const rows = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "..MMMMM.........",
    "..MMMMMM..RR....",
    "..MMMMMMM.RR....",
    "..WW..MMMM.......",
    "..WW..MMMM.MM...",
    "......MMM..MM...",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];
  const palette: ArtPalette = {
    M: PAL.body.steel,
    R: PAL.body.maroon,
    W: PAL.ink.feet,
  };
  ctx.save();
  ctx.translate(px, py);
  drawArtOutline(ctx, rows, KEYLINE, 0, 0, p);
  drawArtRows(ctx, rows, palette, 0, 0, p);
  ctx.restore();
}

// ---- NPC components ----
// Three independently exportable layers (head, outfit, accessory) share one
// grid and one anchor so they compose into a person. Swapping the outfit PNG
// re-dresses every villager wearing it; swapping the head PNG changes a whole
// family of faces.

export type HeadId = "light" | "mid" | "dark" | "pale";
export type OutfitId = "labcoat" | "mechanic" | "rider" | "leader" | "worker" | "plain";
export type AccessoryId =
  | "flatcap-glasses"
  | "beanie-wrench"
  | "bandana-ponytail"
  | "stetson"
  | "sign-post"
  | "none";

interface NpcParts {
  head: HeadId;
  outfit: OutfitId;
  accessory: AccessoryId;
}

const HEAD_SKINS: Record<HeadId, string> = {
  light: PAL.skin.light,
  mid: PAL.skin.mid,
  dark: PAL.skin.dark,
  pale: "#f0dfc4",
};

const OUTFIT_COLORS: Record<OutfitId, { main: string; trim: string; pants: string }> = {
  labcoat: { main: "#e8e6df", trim: "#b7b2a6", pants: "#6a6f7a" },
  mechanic: { main: PAL.body.maroon, trim: "#5a3e2e", pants: "#43352c" },
  rider: { main: PAL.body.green, trim: "#2a6b4f", pants: "#3b5a48" },
  leader: { main: PAL.body.charcoal, trim: PAL.accent.gold, pants: "#2b2b2b" },
  worker: { main: "#7d6a52", trim: "#5a4a38", pants: "#4c4034" },
  plain: { main: PAL.body.gray, trim: "#4a4a55", pants: "#3c3c44" },
};

const NPC_PARTS: Record<string, NpcParts> = {
  professor: { head: "light", outfit: "labcoat", accessory: "flatcap-glasses" },
  mechanic: { head: "mid", outfit: "mechanic", accessory: "beanie-wrench" },
  rider: { head: "light", outfit: "rider", accessory: "bandana-ponytail" },
  "gym-leader": { head: "mid", outfit: "leader", accessory: "stetson" },
  sign: { head: "dark", outfit: "worker", accessory: "sign-post" },
  default: { head: "light", outfit: "plain", accessory: "none" },
};

// Head band: rows 2..12. Hair wraps the face; the crown catches the light.
function headPalette(head: HeadId): ArtPalette {
  return {
    S: HEAD_SKINS[head],
    s: mixHex(HEAD_SKINS[head], "#000000", 0.22),
    H: head === "dark" ? "#241a12" : HAIR.base,
    h: head === "dark" ? "#3a2a1c" : HAIR.light,
    E: PAL.ink.eyes,
    M: "#8f5a44",
  };
}

function drawHeadLayer(
  ctx: CanvasRenderingContext2D,
  head: HeadId,
  px: number,
  py: number,
  size: number,
): void {
  const p = artPixel(size);
  const oy = personOriginY(py, size);
  drawArtOutline(ctx, HEAD_ROWS, KEYLINE, px, oy, p);
  drawArtRows(ctx, HEAD_ROWS, headPalette(head), px, oy, p);
}

// Outfit band: rows 13..23, matching the player's collar-to-boot band.
function outfitPalette(outfit: OutfitId): ArtPalette {
  const colors = OUTFIT_COLORS[outfit];
  return {
    B: colors.main,
    b: mixHex(colors.main, "#000000", 0.28),
    T: colors.trim,
    P: colors.pants,
    F: BOOT,
    // Hands: the outfit layer draws the exposed skin below the sleeves, so it
    // needs the skin ramp as well as the cloth.
    S: SKIN.base,
    s: SKIN.shade,
  };
}

function drawOutfitLayer(
  ctx: CanvasRenderingContext2D,
  outfit: OutfitId,
  px: number,
  py: number,
  size: number,
): void {
  const p = artPixel(size);
  const oy = personOriginY(py, size);
  drawArtOutline(ctx, OUTFIT_ROWS, KEYLINE, px, oy, p);
  drawArtRows(ctx, OUTFIT_ROWS, outfitPalette(outfit), px, oy, p);
  // Trade marks, drawn after the grid so the silhouette stays identical.
  const colors = OUTFIT_COLORS[outfit];
  const at = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(px + x * p, oy + y * p, w * p, h * p);
  };
  if (outfit === "labcoat") {
    at(5, 14, 2, 4, colors.trim);
    at(9, 17, 3, 2, colors.trim);
  } else if (outfit === "mechanic") {
    at(3, 17, 10, 1, colors.trim);
  } else if (outfit === "rider") {
    at(6, 14, 4, 1, colors.trim);
    at(7, 15, 2, 4, colors.trim);
  } else if (outfit === "leader") {
    at(3, 14, 10, 1, colors.trim);
    at(7, 17, 2, 2, colors.trim);
  } else if (outfit === "worker") {
    at(3, 17, 10, 1, colors.trim);
  }
}

function drawAccessoryLayer(
  ctx: CanvasRenderingContext2D,
  accessory: AccessoryId,
  px: number,
  py: number,
  size: number,
  npcId: string | undefined,
): void {
  if (accessory === "none") {
    return;
  }
  const p = artPixel(size);
  const oy = personOriginY(py, size);
  let palette: ArtPalette;
  if (accessory === "stetson") {
    const band = npcId ? houseAccentForNpc(npcId) ?? "#caa672" : "#caa672";
    palette = { A: "#a07d4a", a: band };
  } else if (accessory === "flatcap-glasses") {
    palette = { A: "#4a4452", a: "#33303a", G: "#2a2630" };
  } else if (accessory === "beanie-wrench") {
    palette = { A: "#7d6a52", a: "#5f5140" };
  } else if (accessory === "bandana-ponytail") {
    palette = { A: "#2a6b4f", h: "#7a4a1e" };
  } else {
    palette = { P: "#8a6a3a" };
  }
  const rows = ACCESSORY_ROWS[accessory];
  drawArtOutline(ctx, rows, KEYLINE, px, oy, p);
  drawArtRows(ctx, rows, palette, px, oy, p);
}

/** The full person: head, outfit, accessory, in that order. */
export function drawNpc(
  ctx: CanvasRenderingContext2D,
  sprite: string,
  px: number,
  py: number,
  size: number,
  facing: Direction,
  step: number,
  npcId?: string,
): void {
  if (sprite === "wreck") {
    drawWreck(ctx, px, py, size);
    return;
  }
  const parts = NPC_PARTS[sprite] ?? NPC_PARTS.default!;
  // A slow breath — one art pixel, several seconds long — so a standing
  // villager is alive rather than a decal. The phase comes from the id so
  // neighbours are not in lockstep.
  const phase = (npcId ?? sprite)
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const p = artPixel(size);
  const bob = Math.sin(step / 900 + phase) > 0.6 ? -p : 0;
  const lifted = py + bob;
  drawHeadLayer(ctx, parts.head, px, lifted, size);
  drawOutfitLayer(ctx, parts.outfit, px, lifted, size);
  drawAccessoryLayer(ctx, parts.accessory, px, lifted, size, npcId);
  void facing;
}

// ---- Sprite asset exports ----
// The game's art is all drawn in code; this renders each sprite to a real PNG
// data URL so a build-time exporter (scripts/export-sprites.mjs) can write
// actual image files. Dropping a file at assets/sprites/<id>.png (same id, see
// manifest.json) makes the runtime prefer it over the code draw — the
// pipeline for replacing art with AI-generated images.

const EXPORT_TILE_KINDS: TileKind[] = [
  "grass",
  "path",
  "tree",
  "building",
  "door",
  "vroomgrass",
  "water",
  "wall",
  "counter",
  "indoor-floor",
  "tall-grass-edge",
  "fence",
  "tree-trunk",
  "rock",
  "doormat",
  "bed",
];

export function collectSpriteExports(): Array<{ id: string; dataUrl: string }> {
  const mapsForExport = Object.values(MAPS);
  const out: Array<{ id: string; dataUrl: string }> = [];
  // 6 pixels per art pixel: 96 wide for a tile, 96x144 for a person (24 rows).
  const ART_SCALE = 6;
  const UNIT = 16 * ART_SCALE;

  const makeCanvas = (height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const canvas = document.createElement("canvas");
    canvas.width = UNIT;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("sprite export needs a 2d canvas");
    }
    return { canvas, ctx };
  };

  const tile = makeCanvas(UNIT);
  const person = makeCanvas(PERSON_ROWS * ART_SCALE);
  // A person's grid is anchored to the tile floor, which sits half a tile
  // below the top of their cell: 48px down a 144px canvas.
  const personY = (UNIT * (PERSON_HEIGHT_TILES - 1)) / 2;

  const snap = (
    target: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D },
    id: string,
  ): void => {
    out.push({ id, dataUrl: target.canvas.toDataURL("image/png") });
    target.ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
  };

  for (const kind of EXPORT_TILE_KINDS) {
    drawTile(tile.ctx, kind, 0, 0, UNIT, 0);
    snap(tile, `tile:${kind}`);
  }
  for (const kind of EXPORT_TILE_KINDS) {
    if (WALL_KINDS.has(kind)) {
      drawWallBase(tile.ctx, kind, 0, 0, UNIT);
      snap(tile, `wallbase:${kind}`);
      drawWallBrick(tile.ctx, kind, 0, 0, UNIT);
      snap(tile, `wallbrick:${kind}`);
      drawWallTrim(tile.ctx, kind, 0, 0, UNIT);
      snap(tile, `walltrim:${kind}`);
    } else {
      drawGroundBase(tile.ctx, kind, 0, 0, UNIT, 0, 0);
      snap(tile, `tilebase:${kind}`);
      drawGroundDetail(tile.ctx, kind, 0, 0, UNIT, 0, 0, 0);
      snap(tile, `tiledetail:${kind}`);
    }
  }
  const playerFacings = ["down", "up", "left", "right"] as const;
  for (const head of Object.keys(HEAD_SKINS) as HeadId[]) {
    drawHeadLayer(person.ctx, head, 0, personY, UNIT);
    snap(person, `head:${head}`);
  }
  for (const outfit of Object.keys(OUTFIT_COLORS) as OutfitId[]) {
    drawOutfitLayer(person.ctx, outfit, 0, personY, UNIT);
    snap(person, `outfit:${outfit}`);
  }
  const accessoryIds: AccessoryId[] = [
    "flatcap-glasses",
    "beanie-wrench",
    "bandana-ponytail",
    "stetson",
    "sign-post",
    "none",
  ];
  for (const accessory of accessoryIds) {
    drawAccessoryLayer(person.ctx, accessory, 0, personY, UNIT, undefined);
    snap(person, `accessory:${accessory}`);
  }
  // Two walk frames per facing: the renderer picks one from the step phase, so
  // the exported PNGs animate exactly like the code-drawn fallback.
  for (const facing of playerFacings) {
    for (const frame of [0, 1] as const) {
      drawPlayer(person.ctx, 0, personY, UNIT, facing, frame === 0 ? 0 : Math.PI / 2);
      snap(person, `player:${facing}:${frame}`);
    }
  }
  const seen = new Set<string>();
  for (const map of mapsForExport) {
    for (const npc of map.npcs ?? []) {
      if (seen.has(npc.id)) {
        continue;
      }
      seen.add(npc.id);
      drawNpc(
        person.ctx,
        npc.sprite,
        0,
        personY,
        UNIT,
        npc.facing as "down" | "up" | "left" | "right",
        0,
        npc.id,
      );
      snap(person, `npc:${npc.id}`);
    }
  }
  return out;
}

declare global {
  interface Window {
    __vroomonSprites?: () => Array<{ id: string; dataUrl: string }>;
  }
}
