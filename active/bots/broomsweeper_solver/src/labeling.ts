import type { BoardSpec, LabelExport, Rect, TileLabel } from "./types";

export type LabelCentroid = {
  label: string;
  vector: number[];
  meanDistance: number;
  stdDistance: number;
};

export const CLASSIFIER_VERSION = "1.4.6";

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
  const { width, height, data } = imageData;
  const vector: number[] = [];
  const paddingX = rect.width * 0.08;
  const paddingY = rect.height * 0.08;
  const sampleRect = {
    x: rect.x - paddingX,
    y: rect.y - paddingY,
    width: rect.width + paddingX * 2,
    height: rect.height + paddingY * 2
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sampleX = Math.floor(sampleRect.x + ((x + 0.5) / size) * sampleRect.width);
      const sampleY = Math.floor(sampleRect.y + ((y + 0.5) / size) * sampleRect.height);
      const clampedX = Math.max(0, Math.min(width - 1, sampleX));
      const clampedY = Math.max(0, Math.min(height - 1, sampleY));
      const idx = (clampedY * width + clampedX) * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      vector.push(r, g, b);
    }
  }

  return normalizeVector(vector);
}

export function normalizeVector(vector: number[]): number[] {
  if (vector.length === 0) {
    return vector;
  }
  let mean = 0;
  for (const value of vector) {
    mean += value;
  }
  mean /= vector.length;

  let variance = 0;
  for (const value of vector) {
    const diff = value - mean;
    variance += diff * diff;
  }
  const std = Math.sqrt(variance / vector.length) || 1;
  return vector.map((value) => (value - mean) / std);
}

export function buildLabelCentroids(vectorsByLabel: Map<string, number[][]>): LabelCentroid[] {
  const centroids: LabelCentroid[] = [];
  for (const [label, vectors] of vectorsByLabel.entries()) {
    if (vectors.length === 0) {
      continue;
    }
    const filteredVectors = trimOutliers(vectors);
    const clusterCount = chooseClusterCount(filteredVectors.length);
    const clusterCentroids =
      clusterCount === 1 ? [meanVector(filteredVectors)] : kMeans(filteredVectors, clusterCount);
    for (const centroid of clusterCentroids) {
      const distances = filteredVectors.map((vector) => vectorDistance(vector, centroid));
      const mean = distances.reduce((acc, value) => acc + value, 0) / distances.length;
      const variance =
        distances.reduce((acc, value) => acc + (value - mean) ** 2, 0) / distances.length;
      const std = Math.sqrt(variance);
      centroids.push({ label, vector: centroid, meanDistance: mean, stdDistance: std });
    }
  }
  return centroids;
}

function trimOutliers(vectors: number[][]): number[][] {
  if (vectors.length < 10) {
    return vectors;
  }
  const centroid = meanVector(vectors);
  const scored = vectors.map((vector) => ({ vector, distance: vectorDistance(vector, centroid) }));
  scored.sort((a, b) => a.distance - b.distance);
  const keepCount = Math.max(5, Math.ceil(scored.length * 0.9));
  return scored.slice(0, keepCount).map((entry) => entry.vector);
}

function chooseClusterCount(sampleCount: number): number {
  if (sampleCount < 6) {
    return 1;
  }
  if (sampleCount < 16) {
    return 2;
  }
  return 3;
}

function meanVector(vectors: number[][]): number[] {
  const centroid = new Array(vectors[0].length).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < vector.length; i += 1) {
      centroid[i] += vector[i];
    }
  }
  for (let i = 0; i < centroid.length; i += 1) {
    centroid[i] /= vectors.length;
  }
  return centroid;
}

function kMeans(vectors: number[][], k: number): number[][] {
  const centroids: number[][] = [];
  const step = Math.max(1, Math.floor(vectors.length / k));
  for (let i = 0; i < k; i += 1) {
    centroids.push([...vectors[(i * step) % vectors.length]]);
  }

  const assignments = new Array(vectors.length).fill(0);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let changed = false;
    for (let i = 0; i < vectors.length; i += 1) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c += 1) {
        const distance = vectorDistance(vectors[i], centroids[c]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = c;
        }
      }
      if (assignments[i] !== bestIndex) {
        assignments[i] = bestIndex;
        changed = true;
      }
    }

    const sums = centroids.map(() => new Array(vectors[0].length).fill(0));
    const counts = centroids.map(() => 0);
    for (let i = 0; i < vectors.length; i += 1) {
      const cluster = assignments[i];
      counts[cluster] += 1;
      const vector = vectors[i];
      for (let d = 0; d < vector.length; d += 1) {
        sums[cluster][d] += vector[d];
      }
    }

    for (let c = 0; c < centroids.length; c += 1) {
      if (counts[c] === 0) {
        continue;
      }
      for (let d = 0; d < centroids[c].length; d += 1) {
        centroids[c][d] = sums[c][d] / counts[c];
      }
    }

    if (!changed) {
      break;
    }
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

const UNKNOWN_STD_MULTIPLIER = 4.5;

export function predictLabelWithKnn(
  vector: number[],
  vectorsByLabel: Map<string, number[][]>,
  centroids: LabelCentroid[],
  k = 5
): { label: string; distance: number } | null {
  const neighbors: Array<{ label: string; distance: number }> = [];
  for (const [label, vectors] of vectorsByLabel.entries()) {
    for (const candidate of vectors) {
      if (candidate.length !== vector.length) {
        continue;
      }
      neighbors.push({ label, distance: vectorDistance(vector, candidate) });
    }
  }
  if (neighbors.length === 0) {
    return findNearestCentroid(vector, centroids);
  }
  neighbors.sort((a, b) => a.distance - b.distance);
  const top = neighbors.slice(0, Math.max(1, Math.min(k, neighbors.length)));
  const weights = new Map<string, number>();
  for (const neighbor of top) {
    const weight = 1 / (neighbor.distance + 1e-6);
    weights.set(neighbor.label, (weights.get(neighbor.label) ?? 0) + weight);
  }
  let bestLabel = top[0].label;
  let bestWeight = -Infinity;
  for (const [label, weight] of weights.entries()) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestLabel = label;
    }
  }

  let bestCentroid: LabelCentroid | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const centroid of centroids) {
    if (centroid.label !== bestLabel) {
      continue;
    }
    const distance = vectorDistance(vector, centroid.vector);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCentroid = centroid;
    }
  }

  if (!bestCentroid) {
    return findNearestCentroid(vector, centroids);
  }

  const threshold = bestCentroid.meanDistance + bestCentroid.stdDistance * UNKNOWN_STD_MULTIPLIER;
  if (bestDistance > threshold) {
    return { label: "unknown", distance: bestDistance };
  }
  return { label: bestLabel, distance: bestDistance };
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
