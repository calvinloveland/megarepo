// Pixel-art primitives.
//
// The overworld's art is authored on a 16-column grid and scaled by
// `size / 16`, so a 32px tile is exactly 2 screen pixels per art pixel and a
// 96px export is 6. Nothing lands on a half pixel at either size, which is
// what keeps a scaled-up canvas crisp instead of soupy — the single biggest
// difference between "drawn in a canvas" and "pixel art".
//
// Everything here is pure: no DOM types beyond the two canvas methods the
// drawing needs, so the modules that use it stay testable without a browser.

export type ArtPalette = Record<string, string>;

/** The subset of a 2D context the pixel helpers write through. */
export interface PixelCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export const ART_COLUMNS = 16;

/** Transparent cells in an art row: a full stop or a space. */
export const ART_BLANK = ". ";

export function artPixel(size: number, columns: number = ART_COLUMNS): number {
  return size / columns;
}

/** Deterministic 0..1 hash of a tile coordinate — the same cell always looks
 * the same, in every frame and in every export. */
export function hashUnit(x: number, y: number, salt = 0): number {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Draw an art grid. Each cell is `p` pixels square, every character maps to a
 * palette entry, and characters with no entry (or blank cells) stay
 * transparent — so a typo in a row leaves a hole rather than throwing mid
 * frame.
 */
export function drawArtRows(
  ctx: PixelCanvas,
  rows: readonly string[],
  palette: ArtPalette,
  ox: number,
  oy: number,
  p: number,
  blank: string = ART_BLANK,
): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]!;
      if (blank.includes(ch)) {
        continue;
      }
      const color = palette[ch];
      if (!color) {
        continue;
      }
      ctx.fillStyle = color;
      ctx.fillRect(ox + x * p, oy + y * p, p, p);
    }
  });
}

/**
 * Draw a one-art-pixel silhouette around the art grid, before (or after — the
 * caller decides) the coloured cells. A sprite with a dark keyline reads as an
 * object in front of the ground; the same sprite without one reads as a stain.
 */
export function drawArtOutline(
  ctx: PixelCanvas,
  rows: readonly string[],
  color: string,
  ox: number,
  oy: number,
  p: number,
  blank: string = ART_BLANK,
): void {
  const filled = (x: number, y: number): boolean => {
    const row = rows[y];
    if (row === undefined) {
      return false;
    }
    const ch = row[x];
    return ch !== undefined && !blank.includes(ch);
  };
  ctx.fillStyle = color;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (filled(x, y)) {
        continue;
      }
      // Four-neighbour, not eight: expanding into the diagonals rounds every
      // corner off and a sprite made of rectangles starts to look like a
      // bubble. Leaving the corners empty keeps the silhouette angular, which
      // is what the era's art actually looks like.
      const touches =
        filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1);
      if (touches) {
        ctx.fillRect(ox + x * p, oy + y * p, p, p);
      }
    }
  });
}

/** Mix two hex colours — used for ramps (light/shade) that read as one hue. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const clean = hex.replace("#", "");
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (from: number, to: number): string =>
    Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}
