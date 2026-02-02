import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BoardSpec } from "../src/types";
import {
  buildLabelCentroids,
  buildVectorsByLabel,
  extractTileVector,
  findNearestCentroid,
  normalizeLabelExport
} from "../src/labeling";
import { getTileRect } from "../src/image";
import { loadImageData } from "./test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const labelPath = path.resolve(__dirname, "../data/broomsweeper.jpg.labels.json");

describe("classifier", () => {
  it("matches manual labels on the labeled image", async () => {
    const labelRaw = JSON.parse(readFileSync(labelPath, "utf-8")) as {
      rows: number;
      cols: number;
      bounds: { x: number; y: number; width: number; height: number };
      labels: Array<{ row: number; col: number; label: string }>;
      image: string;
    };
    const normalized = normalizeLabelExport(labelRaw);
    const imageData = await loadImageData(normalized.image);

    const boardSpec: BoardSpec = {
      rows: normalized.rows,
      cols: normalized.cols,
      bounds: normalized.bounds
    };

    const vectorsByLabel = buildVectorsByLabel(imageData, boardSpec, normalized.labels, 10);
    const centroids = buildLabelCentroids(vectorsByLabel);

    let correct = 0;
    let total = 0;
    let nonUnknownCorrect = 0;
    let nonUnknownTotal = 0;

    for (const label of normalized.labels) {
      const tileRect = getTileRect(boardSpec, label.row, label.col);
      const vector = extractTileVector(imageData, tileRect, 10);
      const match = findNearestCentroid(vector, centroids);
      const predicted = match?.label ?? "unknown";
      total += 1;
      if (predicted === label.label) {
        correct += 1;
      }
      if (label.label !== "unknown") {
        nonUnknownTotal += 1;
        if (predicted === label.label) {
          nonUnknownCorrect += 1;
        }
      }
    }

    const accuracy = correct / total;
    const nonUnknownAccuracy = nonUnknownTotal > 0 ? nonUnknownCorrect / nonUnknownTotal : 1;

    expect(accuracy).toBeGreaterThanOrEqual(0.6);
    expect(nonUnknownAccuracy).toBeGreaterThanOrEqual(0.7);
  });
});
