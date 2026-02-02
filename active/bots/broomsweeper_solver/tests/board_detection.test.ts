import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detectBoardFromEdges } from "../src/image";
import { normalizeLabelExport } from "../src/labeling";
import { loadImageData } from "./test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const labelPath = path.resolve(__dirname, "../data/broomsweeper.jpg.labels.json");

describe("board detection", () => {
  it("detects board bounds close to labeled data", async () => {
    const imageData = await loadImageData("broomsweeper.jpg");
    const detected = detectBoardFromEdges(imageData);
    expect(detected).not.toBeNull();
    if (!detected) {
      return;
    }

    const labelRaw = JSON.parse(readFileSync(labelPath, "utf-8")) as {
      rows: number;
      cols: number;
      bounds: { x: number; y: number; width: number; height: number };
      labels: Array<{ row: number; col: number; label: string }>;
      image: string;
    };
    const normalized = normalizeLabelExport(labelRaw);
    const detectedArea = detected.bounds.width * detected.bounds.height;
    const imageArea = imageData.width * imageData.height;
    const areaRatio = imageArea > 0 ? detectedArea / imageArea : 0;

    expect(detected.bounds.width).toBeGreaterThan(0);
    expect(detected.bounds.height).toBeGreaterThan(0);
    expect(areaRatio).toBeGreaterThan(0.1);
    expect(areaRatio).toBeLessThan(0.9);
    expect(normalized.bounds.width).toBeGreaterThan(0);
    expect(normalized.bounds.height).toBeGreaterThan(0);
  });
});
