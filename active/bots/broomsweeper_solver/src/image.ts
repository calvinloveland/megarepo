import type { BoardSpec, DetectedBoard, Rect, TileAnalysis } from "./types";

const PURPLE_THRESHOLD = {
  minR: 110,
  maxG: 120,
  minB: 110
};

export function getTileRect(board: BoardSpec, row: number, col: number): Rect {
  const tileWidth = board.bounds.width / board.cols;
  const tileHeight = board.bounds.height / board.rows;
  return {
    x: board.bounds.x + col * tileWidth,
    y: board.bounds.y + row * tileHeight,
    width: tileWidth,
    height: tileHeight
  };
}

export function detectSlugTiles(imageData: ImageData, board: BoardSpec): TileAnalysis[] {
  const results: TileAnalysis[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const rect = getTileRect(board, row, col);
      const slugLie = hasPurpleBorder(imageData, rect);
      results.push({ row, col, slugLie });
    }
  }
  return results;
}

export function detectBoardFromEdges(imageData: ImageData): DetectedBoard | null {
  const { width, height, data } = imageData;
  const rowSum = new Float32Array(height);
  const colSum = new Float32Array(width);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = (y * width + x) * 4;
      const idxRight = (y * width + (x + 1)) * 4;
      const idxDown = ((y + 1) * width + x) * 4;
      const lum = luminance(data[idx], data[idx + 1], data[idx + 2]);
      const lumRight = luminance(data[idxRight], data[idxRight + 1], data[idxRight + 2]);
      const lumDown = luminance(data[idxDown], data[idxDown + 1], data[idxDown + 2]);
      const edge = Math.abs(lum - lumRight) + Math.abs(lum - lumDown);
      rowSum[y] += edge;
      colSum[x] += edge;
    }
  }

  const rowStats = computeStats(rowSum);
  const colStats = computeStats(colSum);
  const rowThreshold = rowStats.mean + rowStats.std * 0.8;
  const colThreshold = colStats.mean + colStats.std * 0.8;

  const rowBounds = findBounds(rowSum, rowThreshold);
  const colBounds = findBounds(colSum, colThreshold);

  if (!rowBounds || !colBounds) {
    return null;
  }

  const bounds: Rect = {
    x: colBounds.min,
    y: rowBounds.min,
    width: colBounds.max - colBounds.min,
    height: rowBounds.max - rowBounds.min
  };

  const rowPeaks = findPeaks(rowSum, rowBounds.min, rowBounds.max, rowThreshold, 6);
  const colPeaks = findPeaks(colSum, colBounds.min, colBounds.max, colThreshold, 6);

  if (rowPeaks.length < 2 || colPeaks.length < 2) {
    return null;
  }

  const rows = rowPeaks.length - 1;
  const cols = colPeaks.length - 1;

  if (rows <= 1 || cols <= 1) {
    return null;
  }

  return { bounds, rows, cols };
}

function hasPurpleBorder(imageData: ImageData, rect: Rect): boolean {
  const { width: imageWidth, data } = imageData;
  const samplePoints = collectBorderSamples(rect);
  let hits = 0;
  for (const point of samplePoints) {
    const index = (Math.floor(point.y) * imageWidth + Math.floor(point.x)) * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (r >= PURPLE_THRESHOLD.minR && b >= PURPLE_THRESHOLD.minB && g <= PURPLE_THRESHOLD.maxG) {
      hits += 1;
    }
  }
  return hits >= Math.max(3, Math.floor(samplePoints.length * 0.2));
}

function collectBorderSamples(rect: Rect): Array<{ x: number; y: number }> {
  const samples: Array<{ x: number; y: number }> = [];
  const steps = 6;
  const inset = Math.min(rect.width, rect.height) * 0.08;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    samples.push({ x: rect.x + inset + t * (rect.width - inset * 2), y: rect.y + inset });
    samples.push({ x: rect.x + inset + t * (rect.width - inset * 2), y: rect.y + rect.height - inset });
    samples.push({ x: rect.x + inset, y: rect.y + inset + t * (rect.height - inset * 2) });
    samples.push({ x: rect.x + rect.width - inset, y: rect.y + inset + t * (rect.height - inset * 2) });
  }
  return samples;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function computeStats(values: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
  }
  const mean = sum / values.length;
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) {
    const diff = values[i] - mean;
    variance += diff * diff;
  }
  const std = Math.sqrt(variance / values.length);
  return { mean, std };
}

function findBounds(values: Float32Array, threshold: number): { min: number; max: number } | null {
  let min = -1;
  let max = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > threshold) {
      min = i;
      break;
    }
  }
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] > threshold) {
      max = i;
      break;
    }
  }
  if (min === -1 || max === -1 || max <= min) {
    return null;
  }
  return { min, max };
}

function findPeaks(
  values: Float32Array,
  start: number,
  end: number,
  threshold: number,
  minDistance: number
): number[] {
  const peaks: number[] = [];
  let lastPeak = -Infinity;
  for (let i = Math.max(start + 1, 1); i < Math.min(end - 1, values.length - 1); i += 1) {
    const prev = values[i - 1];
    const current = values[i];
    const next = values[i + 1];
    if (current > threshold && current >= prev && current >= next) {
      if (i - lastPeak < minDistance) {
        if (peaks.length > 0 && current > values[lastPeak]) {
          peaks[peaks.length - 1] = i;
          lastPeak = i;
        }
      } else {
        peaks.push(i);
        lastPeak = i;
      }
    }
  }
  return peaks;
}
