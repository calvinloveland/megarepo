import type { BoardSpec, Rect, TileAnalysis } from "./types";

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
