import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../data");
const fallbackDir = path.resolve(__dirname, "../label_output");
const port = Number(process.env.LABEL_SERVER_PORT ?? 5175);

const DEFAULT_AUGMENT_COPIES = 4;
const DEFAULT_NOISE_STD = 0.035;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = req.url ?? "";
  if (requestUrl.startsWith("/api/diagnostics") && req.method === "GET") {
    await handleDiagnostics(res);
    return;
  }

  if (requestUrl !== "/api/labels" || req.method !== "POST") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      if (!body) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Empty request body." }));
        return;
      }
      const payload = JSON.parse(body);
      if (!payload?.image || typeof payload.image !== "string") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Missing image field." }));
        return;
      }

      const safeName = path.basename(payload.image).replace(/[^a-zA-Z0-9._-]/g, "_");
      await fs.mkdir(dataDir, { recursive: true });
      const outputPath = path.join(dataDir, `${safeName}.labels.json`);
      const tempPath = path.join(dataDir, `${safeName}.labels.json.tmp`);
      const exists = await fs
        .stat(outputPath)
        .then(() => true)
        .catch(() => false);
      try {
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
        await fs.rename(tempPath, outputPath);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            file: `${safeName}.labels.json`,
            overwritten: exists,
            fallback: false
          })
        );
      } catch (error) {
        await fs.rm(tempPath, { force: true });
        await fs.mkdir(fallbackDir, { recursive: true });
        const fallbackPath = path.join(fallbackDir, `${safeName}.labels.json`);
        await fs.writeFile(fallbackPath, JSON.stringify(payload, null, 2), "utf-8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            file: `${safeName}.labels.json`,
            overwritten: false,
            fallback: true,
            fallbackDir: "label_output"
          })
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Label save failed:", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: "Failed to save labels.",
          details: error instanceof Error ? error.message : String(error)
        })
      );
    }
  });
});

async function handleDiagnostics(res) {
  try {
    const labelExports = await loadLabelExports();
    if (labelExports.length === 0) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          version: await readClassifierVersion(),
          generatedAt: new Date().toISOString(),
          baseline: { metrics: emptyMetrics() },
          augmented: {
            metrics: emptyMetrics(),
            labelMetrics: [],
            imageMetrics: [],
            confusions: [],
            rows: []
          }
        })
      );
      return;
    }

    const imageCache = await buildImageCache(labelExports);
    const baseline = await evaluateDiagnostics(labelExports, imageCache, {
      augmentCopies: 0,
      noiseStd: 0
    });
    const augmented = await evaluateDiagnostics(labelExports, imageCache, {
      augmentCopies: DEFAULT_AUGMENT_COPIES,
      noiseStd: DEFAULT_NOISE_STD
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        version: await readClassifierVersion(),
        generatedAt: new Date().toISOString(),
        baseline: { metrics: baseline.metrics },
        augmented: {
          metrics: augmented.metrics,
          labelMetrics: buildLabelMetrics(augmented.labelStats),
          imageMetrics: buildImageMetrics(augmented.imageStats),
          confusions: buildConfusionRows(augmented.confusionCounts, augmented.labelStats),
          rows: augmented.rows
        }
      })
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Diagnostics failed:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: "Failed to compute diagnostics.",
        details: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

async function readClassifierVersion() {
  try {
    const labelingPath = path.resolve(__dirname, "../src/labeling.ts");
    const contents = await fs.readFile(labelingPath, "utf-8");
    const match = contents.match(/CLASSIFIER_VERSION\s*=\s*"([^"]+)"/);
    if (match?.[1]) {
      return match[1];
    }
  } catch (error) {
    // ignore
  }
  return "unknown";
}

function emptyMetrics() {
  return { accuracy: 0, nonUnknownAccuracy: 0, avgDistance: 0, total: 0, mismatched: 0 };
}

async function loadLabelExports() {
  let entries = [];
  try {
    entries = await fs.readdir(dataDir);
  } catch (error) {
    return [];
  }
  const labelFiles = entries.filter((name) => name.endsWith(".labels.json"));
  const exports = [];
  for (const fileName of labelFiles) {
    const filePath = path.join(dataDir, fileName);
    const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
    exports.push(normalizeLabelExport(raw));
  }
  return exports;
}

function normalizeLabelExport(payload) {
  const maxRow = payload.labels.reduce((max, label) => Math.max(max, label.row), -1);
  const maxCol = payload.labels.reduce((max, label) => Math.max(max, label.col), -1);
  const rows = Math.max(payload.rows, maxRow + 1);
  const cols = Math.max(payload.cols, maxCol + 1);
  return { ...payload, rows, cols };
}

async function buildImageCache(labelExports) {
  const cache = new Map();
  for (const labelExport of labelExports) {
    if (cache.has(labelExport.image)) {
      continue;
    }
    const imagePath = path.join(dataDir, labelExport.image);
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    cache.set(labelExport.image, ctx.getImageData(0, 0, canvas.width, canvas.height));
  }
  return cache;
}

async function evaluateDiagnostics(labelExports, imageCache, options) {
  let total = 0;
  let correct = 0;
  let mismatched = 0;
  let nonUnknownTotal = 0;
  let nonUnknownCorrect = 0;
  let totalDistance = 0;
  let totalDistanceCount = 0;

  const rows = [];
  const labelStats = new Map();
  const imageStats = new Map();
  const confusionCounts = new Map();

  const ensureLabelStats = (label) => {
    if (!labelStats.has(label)) {
      labelStats.set(label, {
        support: 0,
        predicted: 0,
        correct: 0,
        distanceSum: 0,
        distanceCount: 0,
        falseUnknown: 0,
        falsePositive: 0
      });
    }
    return labelStats.get(label);
  };

  const ensureImageStats = (image) => {
    if (!imageStats.has(image)) {
      imageStats.set(image, {
        total: 0,
        correct: 0,
        mismatches: 0,
        distanceSum: 0,
        distanceCount: 0
      });
    }
    return imageStats.get(image);
  };

  for (const labelExport of labelExports) {
    const trainingVectors = await buildTrainingVectors(labelExport.image, labelExports, imageCache, options);
    const centroids = buildLabelCentroids(trainingVectors);
    if (centroids.length === 0) {
      continue;
    }

    const imageData = imageCache.get(labelExport.image);
    if (!imageData) {
      continue;
    }

    const boardSpec = {
      rows: labelExport.rows,
      cols: labelExport.cols,
      bounds: labelExport.bounds
    };

    const perImage = ensureImageStats(labelExport.image);

    for (const label of labelExport.labels) {
      const tileRect = getTileRect(boardSpec, label.row, label.col);
      const vector = extractTileVector(imageData, tileRect, 10);
      const match = predictLabelWithKnn(vector, trainingVectors, centroids, 5);
      const predicted = match?.label ?? "unknown";
      const distance = match?.distance ?? 0;
      total += 1;
      perImage.total += 1;
      totalDistance += distance;
      totalDistanceCount += 1;
      perImage.distanceSum += distance;
      perImage.distanceCount += 1;

      const expectedStats = ensureLabelStats(label.label);
      expectedStats.support += 1;
      expectedStats.distanceSum += distance;
      expectedStats.distanceCount += 1;

      const predictedStats = ensureLabelStats(predicted);
      predictedStats.predicted += 1;

      if (predicted === label.label) {
        correct += 1;
        perImage.correct += 1;
        expectedStats.correct += 1;
      } else {
        mismatched += 1;
        perImage.mismatches += 1;
        if (predicted === "unknown" && label.label !== "unknown") {
          expectedStats.falseUnknown += 1;
        }
        if (predicted !== "unknown") {
          predictedStats.falsePositive += 1;
        }
        const previewUrl = buildTilePreview(imageData, tileRect, 160);
        rows.push({
          image: labelExport.image,
          row: label.row,
          col: label.col,
          expected: label.label,
          predicted,
          distance,
          previewUrl
        });
      }

      if (label.label !== "unknown") {
        nonUnknownTotal += 1;
        if (predicted === label.label) {
          nonUnknownCorrect += 1;
        }
      }

      if (predicted !== label.label) {
        if (!confusionCounts.has(label.label)) {
          confusionCounts.set(label.label, new Map());
        }
        const byPredicted = confusionCounts.get(label.label);
        byPredicted.set(predicted, (byPredicted.get(predicted) ?? 0) + 1);
      }
    }
  }

  const accuracy = total > 0 ? correct / total : 0;
  const nonUnknownAccuracy = nonUnknownTotal > 0 ? nonUnknownCorrect / nonUnknownTotal : 0;
  const avgDistance = totalDistanceCount > 0 ? totalDistance / totalDistanceCount : 0;
  return {
    metrics: { accuracy, nonUnknownAccuracy, avgDistance, total, mismatched },
    rows,
    labelStats,
    imageStats,
    confusionCounts
  };
}

async function buildTrainingVectors(excludeImage, labelExports, imageCache, options) {
  const aggregateVectors = new Map();
  for (const labelExport of labelExports) {
    if (labelExport.image === excludeImage) {
      continue;
    }
    const imageData = imageCache.get(labelExport.image);
    if (!imageData) {
      continue;
    }
    const boardSpec = {
      rows: labelExport.rows,
      cols: labelExport.cols,
      bounds: labelExport.bounds
    };
    const vectorsByLabel = buildVectorsByLabel(imageData, boardSpec, labelExport.labels, 10);
    for (const [label, vectors] of vectorsByLabel.entries()) {
      if (!aggregateVectors.has(label)) {
        aggregateVectors.set(label, []);
      }
      const target = aggregateVectors.get(label);
      target.push(...vectors);
      if (options.augmentCopies && options.augmentCopies > 0) {
        target.push(...augmentVectors(vectors, options.augmentCopies, options.noiseStd ?? 0.03));
      }
    }
  }
  return aggregateVectors;
}

function buildVectorsByLabel(imageData, boardSpec, labels, sampleSize) {
  const vectorsByLabel = new Map();
  for (const label of labels) {
    const tileRect = getTileRect(boardSpec, label.row, label.col);
    const vector = extractTileVector(imageData, tileRect, sampleSize);
    if (!vectorsByLabel.has(label.label)) {
      vectorsByLabel.set(label.label, []);
    }
    vectorsByLabel.get(label.label).push(vector);
  }
  return vectorsByLabel;
}

function extractTileVector(imageData, rect, size) {
  const { width, height, data } = imageData;
  const vector = [];
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

function normalizeVector(vector) {
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

function buildLabelCentroids(vectorsByLabel) {
  const centroids = [];
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

function chooseClusterCount(sampleCount) {
  if (sampleCount < 6) {
    return 1;
  }
  if (sampleCount < 16) {
    return 2;
  }
  return 3;
}

function meanVector(vectors) {
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

function kMeans(vectors, k) {
  const centroids = [];
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

function trimOutliers(vectors) {
  if (vectors.length < 10) {
    return vectors;
  }
  const centroid = meanVector(vectors);
  const scored = vectors.map((vector) => ({ vector, distance: vectorDistance(vector, centroid) }));
  scored.sort((a, b) => a.distance - b.distance);
  const keepCount = Math.max(5, Math.ceil(scored.length * 0.9));
  return scored.slice(0, keepCount).map((entry) => entry.vector);
}

function vectorDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum / a.length);
}

function predictLabelWithKnn(vector, vectorsByLabel, centroids, k = 5) {
  const neighbors = [];
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
  const weights = new Map();
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

  let bestCentroid = null;
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

  const threshold = bestCentroid.meanDistance + bestCentroid.stdDistance * 2.25;
  if (bestDistance > threshold) {
    return { label: "unknown", distance: bestDistance };
  }
  return { label: bestLabel, distance: bestDistance };
}

function findNearestCentroid(vector, centroids) {
  if (centroids.length === 0) {
    return null;
  }
  let best = null;
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

function augmentVectors(vectors, copies, noiseStd) {
  const augmented = [];
  for (const vector of vectors) {
    for (let i = 0; i < copies; i += 1) {
      const noisy = vector.map((value) => value + gaussianRandom() * noiseStd);
      augmented.push(normalizeVector(noisy));
    }
  }
  return augmented;
}

function gaussianRandom() {
  let u = 0;
  let v = 0;
  while (u === 0) {
    u = Math.random();
  }
  while (v === 0) {
    v = Math.random();
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function getTileRect(board, row, col) {
  const tileWidth = board.bounds.width / board.cols;
  const tileHeight = board.bounds.height / board.rows;
  return {
    x: board.bounds.x + col * tileWidth,
    y: board.bounds.y + row * tileHeight,
    width: tileWidth,
    height: tileHeight
  };
}

function buildTilePreview(imageData, rect, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const cropCanvas = createCanvas(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
  const cropCtx = cropCanvas.getContext("2d");
  const tempCanvas = createCanvas(imageData.width, imageData.height);
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  tempCtx.putImageData(imageData, 0, 0);
  cropCtx.drawImage(
    tempCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );
  ctx.drawImage(cropCanvas, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

function buildLabelMetrics(labelStats) {
  const metrics = [];
  for (const [label, stats] of labelStats.entries()) {
    const precision = stats.predicted > 0 ? stats.correct / stats.predicted : 0;
    const recall = stats.support > 0 ? stats.correct / stats.support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const avgDistance = stats.distanceCount > 0 ? stats.distanceSum / stats.distanceCount : 0;
    metrics.push({
      label,
      support: stats.support,
      predicted: stats.predicted,
      correct: stats.correct,
      precision,
      recall,
      f1,
      avgDistance,
      falseUnknown: stats.falseUnknown,
      falsePositive: stats.falsePositive
    });
  }
  metrics.sort((a, b) => b.support - a.support || a.label.localeCompare(b.label));
  return metrics;
}

function buildImageMetrics(imageStats) {
  const metrics = [];
  for (const [image, stats] of imageStats.entries()) {
    const avgDistance = stats.distanceCount > 0 ? stats.distanceSum / stats.distanceCount : 0;
    metrics.push({
      image,
      total: stats.total,
      correct: stats.correct,
      mismatches: stats.mismatches,
      avgDistance
    });
  }
  metrics.sort((a, b) => (a.correct / Math.max(1, a.total)) - (b.correct / Math.max(1, b.total)));
  return metrics;
}

function buildConfusionRows(confusionCounts, labelStats) {
  const rows = [];
  for (const [expected, predictedMap] of confusionCounts.entries()) {
    const support = labelStats.get(expected)?.support ?? 0;
    for (const [predicted, count] of predictedMap.entries()) {
      const rate = support > 0 ? count / support : 0;
      rows.push({ expected, predicted, count, rate });
    }
  }
  rows.sort((a, b) => b.count - a.count || b.rate - a.rate);
  return rows.slice(0, 15);
}

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Label server listening on http://127.0.0.1:${port}/api/labels`);
});
