// Drawing surfaces that were authored at a fixed pixel size.
//
// Every canvas in this app was designed at one resolution and then scaled by
// CSS to fit its panel, which shrinks the text with the drawing: the Heritage
// tree at 1200x620 drew its 13px labels at about 10px in a 1024px window. The
// fix is the same everywhere, so it lives in one place: give the canvas a
// backing store the size of the box it is displayed in, and let the drawing
// code lay out to that.

export interface CanvasFit {
  width: number;
  height: number;
}

/**
 * The backing size a canvas should use, given the box it is displayed in and
 * the aspect ratio it was designed at. Pure, so the arithmetic can be tested
 * without a DOM.
 */
export function fittedCanvasSize(options: {
  displayWidth: number;
  /** The panel's height, when the stylesheet clamps one. */
  displayHeight?: number;
  aspect: number;
  min?: number;
  max?: number;
}): CanvasFit | null {
  const { displayWidth, aspect } = options;
  if (!Number.isFinite(displayWidth) || displayWidth <= 0 || aspect <= 0) {
    return null;
  }
  const min = options.min ?? 320;
  const max = options.max ?? 1600;
  const width = Math.round(Math.max(min, Math.min(max, displayWidth)));
  const natural = Math.round(width / aspect);
  const clamped =
    options.displayHeight && options.displayHeight > 0
      ? Math.min(natural, Math.round(options.displayHeight))
      : natural;
  return { width, height: Math.max(1, clamped) };
}

/**
 * Size a canvas to the box it is drawn into, if that is a change. Returns the
 * size it ended up with, so callers can put it in their render signature — a
 * resize is a different drawing, not a stale one.
 */
export function fitCanvasToBox(
  canvas: HTMLCanvasElement,
  options: { aspect: number; min?: number; max?: number; heightClamp?: number },
): CanvasFit | null {
  const size = fittedCanvasSize({
    displayWidth: canvas.clientWidth,
    displayHeight: options.heightClamp,
    aspect: options.aspect,
    min: options.min,
    max: options.max,
  });
  if (!size) {
    return null;
  }
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  return size;
}
