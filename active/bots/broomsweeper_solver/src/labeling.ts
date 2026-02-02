import type { BoardSpec, LabelExport, Rect, TileLabel } from "./types";

export type LabelCentroid = {
  label: string;
  vector: number[];
  meanDistance: number;
  stdDistance: number;
};

export function normalizeLabelExport(payload: LabelExport): LabelExport {
  const maxRow = payload.labels.reduce((max, label) => Math.max(max, label.row), -1);
  const maxCol = payload.labels.reduce((max, label) => Math.max(max, label.col), -1);
  const rows = Math.max(payload.rows, maxRow + 1);
  const cols = Math.max(payload.cols, maxCol + 1);
  return {
    ...payload,
    rows,
    cols
  };
}

export function extractTileVector(imageData: ImageData, rect: Rect, size: number): number[] {
  const { width, data } = imageData;
  const vector: number[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sampleX = Math.floor(rect.x + ((x + 0.5) / size) * rect.width);
      const sampleY = Math.floor(rect.y + ((y + 0.5) / size) * rect.height);
      const idx = (sampleY * width + sampleX) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      vector.push(r / 255, g / 255, b / 255);
    }
  }
  return vector;
}

export function buildLabelCentroids(vectorsByLabel: Map<string, number[][]>): LabelCentroid[] {
  const centroids: LabelCentroid[] = [];
  for (const [label, vectors] of vectorsByLabel.entries()) {
    if (vectors.length === 0) {
      continue;
    }
    const centroid = new Array(vectors[0].length).fill(0);
    for (const vector of vectors) {
      for (let i = 0; i < vector.length; i += 1) {
        centroid[i] += vector[i];
      }
    }
    for (let i = 0; i < centroid.length; i += 1) {
      centroid[i] /= vectors.length;
    }
    const distances = vectors.map((vector) => vectorDistance(vector, centroid));
    const mean = distances.reduce((acc, value) => acc + value, 0) / distances.length;
    const variance = distances.reduce((acc, value) => acc + (value - mean) ** 2, 0) / distances.length;
    const std = Math.sqrt(variance);
    centroids.push({ label, vector: centroid, meanDistance: mean, stdDistance: std });
  }
  return centroids;
}

export function findBestCentroid(
  vector: number[],
  centroids: LabelCentroid[]
): { label: string; distance: number } | null {
  if (centroids.length === 0) {
    return null;
  }
  let best: { label: string; distance: number; threshold: number } | null = null;
  for (const centroid of centroids) {
    if (centroid.vector.length !== vector.length) {
      continue;
    }
    const distance = vectorDistance(vector, centroid.vector);
    const threshold = centroid.meanDistance + centroid.stdDistance * 2.25;
    if (!best || distance < best.distance) {
      best = { label: centroid.label, distance, threshold };
    }
  }
  if (!best) {
    return null;
  }
  if (best.distance > best.threshold) {
    return { label: "unknown", distance: best.distance };
  }
  return { label: best.label, distance: best.distance };
}

export function findNearestCentroid(
  vector: number[],
  centroids: LabelCentroid[]
): { label: string; distance: number } | null {
  if (centroids.length === 0) {
    return null;
  }
  let best: { label: string; distance: number } | null = null;
  for (const centroid of centroids) {
    if (centroid.vector.length !== vector.length) {
      continue;
    }
    const distance = vectorDistance(vector, centroid.vector);
    if (!best || distance < best.distance) {
      best = { label: centroid.label, distance };
    }
  }
  return best;
}

export function buildVectorsByLabel(
  imageData: ImageData,
  boardSpec: BoardSpec,
  labels: TileLabel[],
  sampleSize: number
): Map<string, number[][]> {
  const vectorsByLabel = new Map<string, number[][]>();
  for (const label of labels) {
    const tileRect = getTileRect(boardSpec, label.row, label.col);
    const vector = extractTileVector(imageData, tileRect, sampleSize);
    if (!vectorsByLabel.has(label.label)) {
      vectorsByLabel.set(label.label, []);
    }
    vectorsByLabel.get(label.label)?.push(vector);
  }
  return vectorsByLabel;
}

export function vectorDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum / a.length);
}

function getTileRect(board: BoardSpec, row: number, col: number): Rect {
  const tileWidth = board.bounds.width / board.cols;
  const tileHeight = board.bounds.height / board.rows;
  return {
    x: board.bounds.x + col * tileWidth,
    y: board.bounds.y + row * tileHeight,
    width: tileWidth,
    height: tileHeight
  };
}
