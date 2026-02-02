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

    expect(Math.abs(detected.rows - normalized.rows)).toBeLessThanOrEqual(1);
    expect(Math.abs(detected.cols - normalized.cols)).toBeLessThanOrEqual(1);

    const detectedCenterX = detected.bounds.x + detected.bounds.width / 2;
    const detectedCenterY = detected.bounds.y + detected.bounds.height / 2;
    const labelCenterX = normalized.bounds.x + normalized.bounds.width / 2;
    const labelCenterY = normalized.bounds.y + normalized.bounds.height / 2;

    expect(Math.abs(detectedCenterX - labelCenterX)).toBeLessThanOrEqual(30);
    expect(Math.abs(detectedCenterY - labelCenterY)).toBeLessThanOrEqual(30);

    expect(Math.abs(detected.bounds.width - normalized.bounds.width)).toBeLessThanOrEqual(40);
    expect(Math.abs(detected.bounds.height - normalized.bounds.height)).toBeLessThanOrEqual(40);
  });
});
