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


// ---------------------------------------------------------------------------
// The host: one owner for a canvas's size and its repaints.
// ---------------------------------------------------------------------------

export interface CanvasHostOptions {
  /** The aspect the drawing was authored at. */
  aspect: number;
  min?: number;
  max?: number;
  /** A height the stylesheet clamps to, so CSS cannot squash the drawing. */
  heightClamp?: () => number;
}

export type CanvasDraw = (
  ctx: CanvasRenderingContext2D,
  size: CanvasFit,
) => void;

/**
 * A canvas that keeps itself the right size and repaints when the window
 * changes shape.
 *
 * The four canvases in this app each did their own arithmetic and their own
 * checking, and the bugs that came out of that were all the same: labels at 79%
 * of their size because nobody refitted on a narrow window, a leading car drawn
 * off the right edge because two of them applied an offset twice, and a resize
 * that repainted only if some unrelated state happened to change. The size and
 * the repaint are one concern, so they have one owner.
 */
export class CanvasHost {
  private draw: CanvasDraw | null = null;
  private lastSize: CanvasFit | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: CanvasHostOptions,
  ) {}

  /** The size the drawing is currently laid out to. */
  get size(): CanvasFit | null {
    return this.lastSize;
  }

  /**
   * Fit the backing store to the box the canvas is displayed in, then draw.
   * The draw callback is remembered, so a resize can repaint without the
   * caller having to know.
   */
  paint(draw: CanvasDraw): void {
    this.draw = draw;
    const size = this.fit();
    const ctx = this.canvas.getContext("2d");
    if (!size || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, size.width, size.height);
    draw(ctx, size);
  }

  /** Repaint at the current size, if there is anything to repaint with. */
  repaint(): void {
    if (this.draw) {
      this.paint(this.draw);
    }
  }

  /**
   * Fit the backing store and report the size, or null when the canvas has no
   * box yet (it is hidden, or the page has not laid out).
   */
  fit(): CanvasFit | null {
    const size = fittedCanvasSize({
      displayWidth: this.canvas.clientWidth,
      displayHeight: this.options.heightClamp?.(),
      aspect: this.options.aspect,
      min: this.options.min,
      max: this.options.max,
    });
    if (!size) {
      return null;
    }
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    this.lastSize = size;
    return size;
  }
}

/** Hosts that repaint themselves when the window changes shape. */
const resizeWatched = new Set<CanvasHost>();
let resizeWired = false;

function wireResize(): void {
  if (resizeWired || typeof window === "undefined") {
    return;
  }
  resizeWired = true;
  let queued = false;
  window.addEventListener("resize", () => {
    if (queued) {
      return;
    }
    queued = true;
    // One frame, one repaint: a drag fires dozens of these.
    window.requestAnimationFrame(() => {
      queued = false;
      for (const host of resizeWatched) {
        host.repaint();
      }
    });
  });
}

/**
 * Build a host for a canvas. Every host made here repaints on resize, which is
 * the part that used to be missing: a drawing that only refitted when some
 * unrelated state changed would keep stale pixels through a window resize.
 */
export function hostCanvas(
  canvas: HTMLCanvasElement,
  options: CanvasHostOptions,
): CanvasHost {
  const host = new CanvasHost(canvas, options);
  resizeWatched.add(host);
  wireResize();
  return host;
}
