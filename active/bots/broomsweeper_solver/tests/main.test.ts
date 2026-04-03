// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const imageModule = vi.hoisted(() => ({
  detectBoardFromEdges: vi.fn(),
  getTileRect: vi.fn((board: { bounds: { x: number; y: number; width: number; height: number }; rows: number; cols: number }, row: number, col: number) => ({
    x: board.bounds.x + (board.bounds.width / board.cols) * col,
    y: board.bounds.y + (board.bounds.height / board.rows) * row,
    width: board.bounds.width / board.cols,
    height: board.bounds.height / board.rows
  }))
}));

const labelingModule = vi.hoisted(() => ({
  CLASSIFIER_VERSION: "test-classifier",
  buildLabelCentroids: vi.fn((vectorsByLabel: Map<string, number[][]>) =>
    Array.from(vectorsByLabel.entries()).map(([label, vectors]) => ({
      label,
      vector: vectors[0] ?? [0],
      count: vectors.length
    }))
  ),
  buildVectorsByLabel: vi.fn(
    (
      _imageData: ImageData,
      _boardSpec: { rows: number; cols: number; bounds: { x: number; y: number; width: number; height: number } },
      labels: Array<{ row: number; col: number; label: string }>,
      _sampleSize: number
    ) => {
      const result = new Map<string, number[][]>();
      for (const label of labels) {
        const vectors = result.get(label.label) ?? [];
        vectors.push([label.row, label.col, label.label.length]);
        result.set(label.label, vectors);
      }
      return result;
    }
  ),
  extractTileVector: vi.fn(() => [0.1, 0.2, 0.3]),
  findBestCentroid: vi.fn(),
  findNearestCentroid: vi.fn(),
  normalizeLabelExport: vi.fn((payload: unknown) => payload),
  normalizeVector: vi.fn((vector: number[]) => vector),
  predictLabelWithKnn: vi.fn(() => ({ label: "1", distance: 0.12 }))
}));

const solverModule = vi.hoisted(() => ({
  solveBoard: vi.fn(() => ({
    annotations: [{ row: 0, col: 0, label: "1", color: "#2563eb" }],
    slugTiles: [{ row: 0, col: 0, slugLie: true }]
  }))
}));

vi.mock("../src/image", () => imageModule);
vi.mock("../src/labeling", () => labelingModule);
vi.mock("../src/solver", () => solverModule);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexHtml = readFileSync(path.resolve(__dirname, "../index.html"), "utf-8");
const bodyHtml = (indexHtml.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? "").replace(
  /<script[\s\S]*?<\/script>/gi,
  ""
);

type MainModule = typeof import("../src/main");

type MockContext = {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

let canvasContexts = new WeakMap<HTMLCanvasElement, MockContext>();

function createImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(Math.max(1, width * height * 4))
  } as ImageData;
}

function getMockContext(canvas: HTMLCanvasElement): MockContext {
  const existing = canvasContexts.get(canvas);
  if (existing) {
    return existing;
  }
  const created: MockContext = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x = 0, _y = 0, width = canvas.width || 10, height = canvas.height || 10) =>
      createImageData(width, height)
    ),
    putImageData: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    imageSmoothingEnabled: true,
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic"
  };
  canvasContexts.set(canvas, created);
  return created;
}

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1200;
  naturalHeight = 800;
  width = 1200;
  height = 800;
  private _src = "";

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      if (value.includes("fail")) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }

  get src(): string {
    return this._src;
  }
}

class MockFileReader {
  result: string | ArrayBuffer | null = "data:image/png;base64,ZmFrZQ==";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(file: File): void {
    queueMicrotask(() => {
      if (file.name.includes("fail")) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }
}

function makeImage(): HTMLImageElement {
  return {
    naturalWidth: 1200,
    naturalHeight: 800,
    width: 1200,
    height: 800
  } as HTMLImageElement;
}

function makeLabelExport(image = "broomsweeper.jpg") {
  return {
    image,
    rows: 2,
    cols: 2,
    bounds: { x: 10, y: 20, width: 100, height: 120 },
    labels: [
      { row: 0, col: 0, label: "1" },
      { row: 0, col: 1, label: "unknown" }
    ],
    createdAt: "2026-04-03T00:00:00.000Z"
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadMainModule(options: { body?: string; nullContexts?: boolean } = {}): Promise<MainModule> {
  vi.resetModules();
  canvasContexts = new WeakMap<HTMLCanvasElement, MockContext>();
  document.body.innerHTML = options.body ?? bodyHtml;
  localStorage.clear();

  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" })));
  vi.stubGlobal("Image", MockImage as unknown as typeof Image);
  vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);
  vi.stubGlobal("showDirectoryPicker", undefined);
  vi.stubGlobal("open", vi.fn());
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn()
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    if (options.nullContexts) {
      return null;
    }
    return getMockContext(this as HTMLCanvasElement) as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,mock");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const module = await import("../src/main");
  Object.defineProperty(module.__testApi.elements.overlayCanvas, "getBoundingClientRect", {
    value: () => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 120,
      width: 100,
      height: 100,
      toJSON: () => ({})
    }),
    configurable: true
  });
  return module;
}

beforeEach(() => {
  vi.restoreAllMocks();
  imageModule.detectBoardFromEdges.mockReset();
  imageModule.getTileRect.mockClear();
  labelingModule.buildLabelCentroids.mockClear();
  labelingModule.buildVectorsByLabel.mockClear();
  labelingModule.extractTileVector.mockClear();
  labelingModule.findBestCentroid.mockClear();
  labelingModule.findNearestCentroid.mockClear();
  labelingModule.normalizeLabelExport.mockClear();
  labelingModule.normalizeLabelExport.mockImplementation((payload: unknown) => payload);
  labelingModule.normalizeVector.mockClear();
  labelingModule.normalizeVector.mockImplementation((vector: number[]) => vector);
  labelingModule.predictLabelWithKnn.mockClear();
  labelingModule.predictLabelWithKnn.mockImplementation(() => ({ label: "1", distance: 0.12 }));
  solverModule.solveBoard.mockClear();
});

describe("main.ts", () => {
  it("throws when required DOM elements or canvas contexts are missing", async () => {
    await expect(loadMainModule({ body: "<div>missing</div>" })).rejects.toThrow("Missing required DOM elements.");
    await expect(loadMainModule({ nullContexts: true })).rejects.toThrow("Canvas context unavailable.");
  });

  it("initializes the app, populates UI, and keeps solver mode active", async () => {
    const module = await loadMainModule();

    expect(module.__testApi.elements.datasetSelect.options.length).toBeGreaterThan(0);
    expect(module.__testApi.elements.labelPalette.querySelectorAll("button").length).toBe(
      module.__testApi.palette.length
    );
    expect(module.__testApi.getState().mode).toBe("solver");
    expect(module.__testApi.elements.statusList.textContent).toContain("Upload a screenshot to begin.");
  });

  it("switches modes and loads the first dataset image in labeler mode", async () => {
    const module = await loadMainModule();

    module.setMode("labeler");
    await flush();

    expect(module.__testApi.getState().mode).toBe("labeler");
    expect(module.__testApi.elements.labelerSection.classList.contains("hidden")).toBe(false);
    expect(module.__testApi.getState().currentDatasetImage).not.toBeNull();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Loaded");

    module.setMode("diagnostics");
    expect(module.__testApi.elements.diagnosticsStatusList.textContent).toContain("Run diagnostics");
  });

  it("handles solver selection clicks, board detection, and solver execution", async () => {
    const module = await loadMainModule();
    const image = makeImage();

    module.__testApi.setState({ currentImage: image });
    module.handleSolverClick({ x: 10, y: 20 });
    module.handleSolverClick({ x: 110, y: 220 });
    expect(module.__testApi.getState().solverBoardBounds).toEqual({ x: 10, y: 20, width: 100, height: 200 });
    expect(module.__testApi.elements.runSolverButton.disabled).toBe(false);
    expect(module.__testApi.elements.exportButton.disabled).toBe(false);

    imageModule.detectBoardFromEdges.mockReturnValue({
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      rows: 8,
      cols: 9
    });
    module.__testApi.elements.autoDetectSolverButton.disabled = false;
    module.__testApi.elements.autoDetectSolverButton.click();
    expect(module.__testApi.getState().solverBoardBounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(module.__testApi.elements.rowsInput.value).toBe("8");

    module.__testApi.setState({ solverBoardBounds: { x: 1, y: 2, width: 30, height: 40 } });
    module.__testApi.elements.rowsInput.value = "3";
    module.__testApi.elements.colsInput.value = "4";
    module.__testApi.elements.runSolverButton.click();

    expect(solverModule.solveBoard).toHaveBeenCalled();
    expect(module.__testApi.getState().solverAnnotations).toHaveLength(1);
    expect(module.__testApi.elements.statusList.textContent).toContain("Solver ran.");

    module.resetSolverSelection();
    expect(module.__testApi.elements.runSolverButton.disabled).toBe(true);
  });

  it("handles labeler selection, tile labeling, and manual export payload wiring", async () => {
    const module = await loadMainModule();
    const image = makeImage();

    module.__testApi.setState({ currentImage: image, mode: "labeler" });
    module.handleLabelerClick({ x: 10, y: 20 });
    module.handleLabelerClick({ x: 110, y: 220 });
    expect(module.__testApi.getState().labelBoardBounds).toEqual({ x: 10, y: 20, width: 100, height: 200 });

    module.__testApi.elements.labelRowsInput.value = "2";
    module.__testApi.elements.labelColsInput.value = "2";
    module.handleLabelerClick({ x: 25, y: 40 });
    expect(module.__testApi.getState().labelMap.size).toBe(1);

    module.__testApi.setState({
      currentDatasetImage: { name: "broomsweeper.jpg", url: "/data/broomsweeper.jpg" }
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ file: "saved.labels.json" })
    } as Response);
    module.__testApi.elements.exportLabelsButton.click();
    await flush();
    expect(fetch).toHaveBeenCalled();
  });

  it("covers geometry, status, and palette helpers", async () => {
    const module = await loadMainModule();

    expect(module.normalizeRect({ x: 5, y: 6 }, { x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2,
      width: 4,
      height: 4
    });
    expect(
      module.getTileFromPoint(
        { rows: 2, cols: 2, bounds: { x: 10, y: 20, width: 100, height: 100 } },
        { x: 30, y: 70 }
      )
    ).toEqual({ row: 1, col: 0 });
    expect(
      module.getTileFromPoint(
        { rows: 2, cols: 2, bounds: { x: 10, y: 20, width: 100, height: 100 } },
        { x: 0, y: 0 }
      )
    ).toBeNull();
    expect(
      module.getCanvasPoint(
        new MouseEvent("click", { clientX: 60, clientY: 70 }),
        module.__testApi.elements.overlayCanvas
      )
    ).toEqual({ x: 150, y: 75 });

    module.setSolverStatus(["one", "two"]);
    module.setLabelerStatus(["three"]);
    module.setDiagnosticsStatus(["four"]);
    expect(module.__testApi.elements.statusList.querySelectorAll("li")).toHaveLength(2);
    expect(module.__testApi.elements.labelStatusList.querySelectorAll("li")).toHaveLength(1);
    expect(module.__testApi.elements.diagnosticsStatusList.querySelectorAll("li")).toHaveLength(1);

    const firstButton = module.__testApi.elements.labelPalette.querySelector("button");
    expect(firstButton).not.toBeNull();
    firstButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(module.__testApi.elements.labelPalette.querySelector(".active")).not.toBeNull();
  });

  it("loads images from files and URLs and reports failures", async () => {
    const module = await loadMainModule();

    await expect(module.loadImageFromUrl("/data/example.png")).resolves.toBeTruthy();
    await expect(module.loadImageFromUrl("/data/fail.png")).rejects.toThrow("Failed to load dataset image");

    await expect(module.loadImageFromFile(new File(["ok"], "ok.png", { type: "image/png" }))).resolves.toBeTruthy();
    await expect(
      module.loadImageFromFile(new File(["fail"], "fail.png", { type: "image/png" }))
    ).rejects.toThrow("Failed to read file");
  });

  it("fetches label exports, uses cache, and aggregates all exports", async () => {
    const module = await loadMainModule();
    const payload = makeLabelExport();
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload, text: async () => "" } as Response);

    const first = await module.fetchLabelExport(payload.image, { bustCache: true });
    expect(first).toEqual(payload);
    const second = await module.fetchLabelExport(payload.image);
    expect(second).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    module.__testApi.clearLabelExportCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => payload, text: async () => "" } as Response);
    const all = await module.getAllLabelExports();
    expect(all.length).toBeGreaterThan(0);
  });

  it("exports annotated images and downloads JSON", async () => {
    const module = await loadMainModule();

    module.exportAnnotatedImage("annotated.png");
    module.downloadJson({ ok: true }, "payload.json");

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("covers diagnostics metric builders and table rendering", async () => {
    const module = await loadMainModule();

    const labelStats = new Map([
      [
        "1",
        { support: 4, predicted: 5, correct: 3, distanceSum: 1, distanceCount: 4, falseUnknown: 1, falsePositive: 2 }
      ]
    ]);
    const imageStats = new Map([["demo.png", { total: 4, correct: 3, mismatches: 1, distanceSum: 1, distanceCount: 4 }]]);
    const confusions = new Map([["1", new Map([["unknown", 2]])]]);

    const labelMetrics = module.buildLabelMetrics(labelStats);
    const imageMetrics = module.buildImageMetrics(imageStats);
    const confusionRows = module.buildConfusionRows(confusions, new Map([["1", { support: 4 }]]));

    expect(labelMetrics[0].precision).toBeCloseTo(0.6);
    expect(imageMetrics[0].avgDistance).toBeCloseTo(0.25);
    expect(confusionRows[0]).toEqual({ expected: "1", predicted: "unknown", count: 2, rate: 0.5 });

    module.renderLabelMetricsTable([]);
    module.renderImageMetricsTable([]);
    module.renderConfusionTable([]);
    expect(module.__testApi.elements.diagnosticsLabelTableBody.textContent).toContain("No label metrics");
    expect(module.__testApi.elements.diagnosticsImageTableBody.textContent).toContain("No image metrics");
    expect(module.__testApi.elements.diagnosticsConfusionTableBody.textContent).toContain("No confusions");

    module.renderDiagnosticsMetrics(
      { accuracy: 0.7, nonUnknownAccuracy: 0.8, avgDistance: 0.12, total: 10, mismatched: 3 },
      { accuracy: 0.5, nonUnknownAccuracy: 0.55, avgDistance: 0.2, total: 10, mismatched: 5 },
      "v1"
    );
    module.renderLabelMetricsTable(labelMetrics);
    module.renderImageMetricsTable(imageMetrics);
    module.renderConfusionTable(confusionRows);

    expect(module.__testApi.elements.diagnosticsMetrics.textContent).toContain("Classifier version");
    expect(module.__testApi.elements.diagnosticsLabelTableBody.querySelectorAll("tr")).toHaveLength(1);
    expect(module.__testApi.elements.diagnosticsImageTableBody.querySelectorAll("tr")).toHaveLength(1);
    expect(module.__testApi.elements.diagnosticsConfusionTableBody.querySelectorAll("tr")).toHaveLength(1);
  });

  it("records classifier history and renders both empty and populated states", async () => {
    const module = await loadMainModule();

    module.renderHistoryTable();
    expect(module.__testApi.elements.diagnosticsHistoryTableBody.textContent).toContain("No history");

    module.saveClassifierHistory([
      {
        version: "v1",
        recordedAt: "2026-04-03T00:00:00.000Z",
        accuracy: 0.7,
        nonUnknownAccuracy: 0.8,
        avgDistance: 0.1,
        total: 10
      }
    ]);
    expect(module.loadClassifierHistory()).toHaveLength(1);

    localStorage.setItem("broomsweeperClassifierHistory", "not-json");
    expect(module.loadClassifierHistory()).toEqual([]);

    module.recordClassifierAccuracy(
      { accuracy: 0.9, nonUnknownAccuracy: 0.95, avgDistance: 0.02, total: 12 },
      "v2"
    );
    module.renderHistoryTable();
    expect(module.__testApi.elements.diagnosticsHistoryTableBody.querySelectorAll("tr").length).toBeGreaterThan(0);
    expect(module.formatPercent(0.456)).toBe("45.6%");
  });

  it("evaluates diagnostics and renders diagnostics rows and preview", async () => {
    const module = await loadMainModule();
    const exports = [makeLabelExport()];

    const result = await module.evaluateDiagnostics(exports, {
      collectDetails: true,
      includeSelf: true,
      includeSelfOnly: true,
      selfMatch: false,
      knnK: 1
    });

    expect(result.metrics.total).toBe(2);
    expect(result.rows.length).toBe(1);
    module.__testApi.setState({ diagnosticsRows: result.rows });
    module.renderDiagnosticsTable();
    const firstRow = module.__testApi.elements.diagnosticsTableBody.querySelector("tr");
    expect(firstRow).not.toBeNull();
    firstRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(module.__testApi.elements.diagnosticsPreviewMeta.textContent).toContain("broomsweeper.jpg");

    module.__testApi.setState({ selectedDiagnosticsRow: null });
    module.updateDiagnosticsPreview();
    expect(module.__testApi.elements.diagnosticsPreviewMeta.textContent).toContain("Select a mismatch");
  });

  it("handles diagnostics fetches and both no-labels and server-result runDiagnostics paths", async () => {
    const module = await loadMainModule();
    const payload = makeLabelExport();
    const apiPayload = {
      version: "server-v1",
      generatedAt: "2026-04-03T00:00:00.000Z",
      baseline: { metrics: { accuracy: 0.5, nonUnknownAccuracy: 0.5, avgDistance: 0.2, total: 10, mismatched: 5 } },
      augmented: {
        metrics: { accuracy: 0.7, nonUnknownAccuracy: 0.8, avgDistance: 0.1, total: 10, mismatched: 3 },
        labelMetrics: [],
        imageMetrics: [],
        confusions: [],
        rows: []
      }
    };

    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response);
    await module.runDiagnostics();
    expect(module.__testApi.elements.diagnosticsSummary.textContent).toContain("No label files found");

    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/diagnostics") {
        return {
          ok: true,
          status: 200,
          json: async () => apiPayload,
          text: async () => JSON.stringify(apiPayload)
        } as Response;
      }
      if (url.includes(".labels.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => payload,
          text: async () => ""
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
    });

    expect(await module.fetchDiagnosticsFromServer()).toEqual(apiPayload);
    await module.runDiagnostics();
    expect(module.__testApi.elements.diagnosticsSummary.textContent).toContain("Augmented accuracy");
  });

  it("covers training, augmentation, randomization, and image preview helpers", async () => {
    const module = await loadMainModule();
    const exports = [makeLabelExport(), makeLabelExport("broomsweeper2.jpeg")];

    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.4)
      .mockReturnValue(0.3);

    const vectors = await module.buildTrainingVectors("broomsweeper.jpg", exports, {
      includeSelf: true,
      includeSelfOnly: false,
      augmentCopies: 1,
      noiseStd: 0.05
    });
    expect(vectors.size).toBeGreaterThan(0);
    expect(module.augmentVectors([[1, 2]], 2, 0.01)).toHaveLength(2);
    expect(Number.isFinite(module.gaussianRandom())).toBe(true);

    const items = [1, 2, 3];
    module.shuffleInPlace(items);
    expect(items.sort()).toEqual([1, 2, 3]);

    const imageData = createImageData(10, 10);
    expect(module.getImageDataFromImage(makeImage()).width).toBe(1200);
    expect(module.buildTilePreview(imageData, { x: 0, y: 0, width: 5, height: 5 }, 32)).toContain("data:image/png");
    expect(module.cropImageData(imageData, { x: 0, y: 0, width: 5, height: 5 }).canvas.width).toBe(5);
  });

  it("updates the magnifier and board application helpers", async () => {
    const module = await loadMainModule();
    const image = makeImage();

    module.drawBaseImage(image);
    module.updateMagnifier({ x: 40, y: 50 });
    expect(module.__testApi.elements.magnifier.classList.contains("hidden")).toBe(false);

    module.__testApi.setState({ currentImage: image });
    imageModule.detectBoardFromEdges.mockReturnValue({
      bounds: { x: 2, y: 3, width: 40, height: 50 },
      rows: 6,
      cols: 7
    });
    expect(module.detectBoard()).toEqual({
      bounds: { x: 2, y: 3, width: 40, height: 50 },
      rows: 6,
      cols: 7
    });

    module.applyDetectedBoardToSolver({ bounds: { x: 2, y: 3, width: 4, height: 5 }, rows: 8, cols: 9 });
    expect(module.__testApi.elements.rowsInput.value).toBe("8");
    module.applyDetectedBoardToLabeler({ bounds: { x: 2, y: 3, width: 4, height: 5 }, rows: 4, cols: 5 });
    expect(module.__testApi.elements.labelRowsInput.value).toBe("4");
  });

  it("applies label exports and saves them through the server path", async () => {
    const module = await loadMainModule();
    const payload = makeLabelExport();

    module.applyLabelExport(payload);
    expect(module.__testApi.getState().labelMap.size).toBe(2);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ file: "saved.labels.json", overwritten: true, fallback: true, fallbackDir: "label_output" })
    } as Response);
    const saved = await module.saveLabelExportToServer(payload);
    expect(saved.ok).toBe(true);
    expect(saved.message).toContain("saved.labels.json");

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" } as Response);
    expect((await module.saveLabelExportToServer(payload)).ok).toBe(false);

    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await module.saveLabelExport(payload);
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Server save failed");
  });

  it("builds template banks and auto-labels tiles", async () => {
    const module = await loadMainModule();
    const image = makeImage();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeLabelExport(),
      text: async () => ""
    } as Response);
    await module.ensureTemplateBank();
    expect(module.__testApi.getState().templateBank.length).toBeGreaterThan(0);

    module.__testApi.setState({
      currentImage: image,
      labelBoardBounds: { x: 10, y: 20, width: 100, height: 100 },
      currentDatasetImage: null,
      templateVectorsByLabel: new Map([["1", [[0.1, 0.2, 0.3]]]]),
      labelCentroids: [{ label: "1", vector: [0.1, 0.2, 0.3], count: 1 }]
    });
    module.__testApi.elements.labelRowsInput.value = "2";
    module.__testApi.elements.labelColsInput.value = "2";
    module.runAutoLabel();
    await flush();
    expect(module.__testApi.getState().labelMap.size).toBe(4);
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Auto-label complete");
  });

  it("covers event listener guard paths across solver, labeler, overlay, and diagnostics controls", async () => {
    const module = await loadMainModule();
    const image = makeImage();

    Object.defineProperty(module.__testApi.elements.fileInput, "files", {
      value: [new File(["image"], "image.png", { type: "image/png" })],
      configurable: true
    });
    module.__testApi.elements.fileInput.dispatchEvent(new Event("change"));
    await flush();
    expect(module.__testApi.getState().currentImage).not.toBeNull();

    module.setMode("labeler");
    module.__testApi.elements.fileInput.dispatchEvent(new Event("change"));
    await flush();
    expect(module.__testApi.getState().mode).toBe("labeler");

    module.setMode("solver");
    module.__testApi.setState({ currentImage: null });
    module.__testApi.elements.selectBoardButton.click();
    expect(module.__testApi.elements.statusList.textContent).toContain("Upload a screenshot first");

    module.__testApi.setState({ currentImage: image });
    module.__testApi.elements.selectBoardButton.click();
    expect(module.__testApi.elements.statusList.textContent).toContain("Click top-left");

    imageModule.detectBoardFromEdges.mockReturnValue(null);
    module.__testApi.elements.autoDetectSolverButton.disabled = false;
    module.__testApi.elements.autoDetectSolverButton.click();
    expect(module.__testApi.elements.statusList.textContent).toContain("Auto-detect failed");

    module.__testApi.setState({ solverBoardBounds: null });
    module.__testApi.elements.runSolverButton.disabled = false;
    module.__testApi.elements.runSolverButton.click();
    expect(module.__testApi.elements.statusList.textContent).toContain("Select board bounds");

    module.__testApi.elements.exportButton.click();

    module.setMode("labeler");
    module.__testApi.setState({ currentImage: null });
    module.__testApi.elements.labelSelectBoardButton.click();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Load a dataset image first");

    module.__testApi.setState({ currentImage: image });
    imageModule.detectBoardFromEdges.mockReturnValue(null);
    module.__testApi.elements.autoDetectLabelerButton.disabled = false;
    module.__testApi.elements.autoDetectLabelerButton.click();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Auto-detect failed");

    module.__testApi.setState({ labelBoardBounds: null });
    module.__testApi.elements.autoLabelButton.disabled = false;
    module.__testApi.elements.autoLabelButton.click();
    await flush();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Select board bounds");

    module.__testApi.setState({ labelMap: new Map([["0:0", { row: 0, col: 0, label: "1" }]]) });
    module.__testApi.elements.clearLabelsButton.disabled = false;
    module.__testApi.elements.clearLabelsButton.click();
    expect(module.__testApi.getState().labelMap.size).toBe(0);

    module.__testApi.setState({ currentDatasetImage: null, labelBoardBounds: null });
    module.__testApi.elements.exportLabelsButton.disabled = false;
    module.__testApi.elements.exportLabelsButton.click();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Select a dataset image");

    module.__testApi.elements.pickLabelFolderButton.click();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Directory picker not supported");

    vi.stubGlobal("showDirectoryPicker", vi.fn(async () => ({ getFileHandle: vi.fn() })));
    module.__testApi.elements.pickLabelFolderButton.click();
    await flush();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Label output folder selected");

    vi.stubGlobal("showDirectoryPicker", vi.fn(async () => {
      throw new Error("cancel");
    }));
    module.__testApi.elements.pickLabelFolderButton.click();
    await flush();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Directory selection canceled");

    module.setMode("solver");
    module.__testApi.elements.datasetSelect.dispatchEvent(new Event("change"));
    module.setMode("labeler");
    module.__testApi.elements.datasetSelect.value = "__missing__";
    module.__testApi.elements.datasetSelect.dispatchEvent(new Event("change"));
    module.__testApi.elements.datasetSelect.value = module.__testApi.datasetImages[0]?.name ?? "";
    module.__testApi.elements.datasetSelect.dispatchEvent(new Event("change"));
    await flush();

    module.__testApi.setState({ currentImage: null });
    module.__testApi.elements.overlayCanvas.dispatchEvent(new MouseEvent("click", { clientX: 20, clientY: 20 }));
    module.__testApi.setState({ currentImage: image, mode: "solver" });
    module.__testApi.elements.overlayCanvas.dispatchEvent(new MouseEvent("click", { clientX: 20, clientY: 20 }));
    module.__testApi.setState({ mode: "labeler" });
    module.__testApi.elements.overlayCanvas.dispatchEvent(new MouseEvent("click", { clientX: 30, clientY: 30 }));

    module.__testApi.setState({ currentImage: image });
    module.__testApi.elements.magnifierToggle.checked = false;
    module.__testApi.elements.overlayCanvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 20 }));
    expect(module.__testApi.elements.magnifier.classList.contains("hidden")).toBe(true);
    module.__testApi.elements.magnifierToggle.checked = true;
    module.__testApi.elements.overlayCanvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 20 }));
    module.__testApi.elements.overlayCanvas.dispatchEvent(new MouseEvent("mouseleave"));
    expect(module.__testApi.elements.magnifier.classList.contains("hidden")).toBe(true);
    module.__testApi.elements.magnifierToggle.checked = false;
    module.__testApi.elements.magnifierToggle.dispatchEvent(new Event("change"));
    module.__testApi.setState({ lastMagnifierPoint: { x: 10, y: 10 } });
    module.__testApi.elements.magnifierToggle.checked = true;
    module.__testApi.elements.magnifierToggle.dispatchEvent(new Event("change"));

    module.setMode("solver");
    module.__testApi.elements.runDiagnosticsButton.click();
    module.setMode("diagnostics");
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response);
    module.__testApi.elements.runDiagnosticsButton.click();
    await flush();
    expect(module.__testApi.elements.diagnosticsSummary.textContent).toContain("No label files found");
  });

  it("covers remaining helper fallback and error paths", async () => {
    const module = await loadMainModule();

    module.__testApi.setState({
      currentImage: null,
      labelBoardBounds: { x: 0, y: 0, width: 10, height: 10 }
    });
    module.handleSolverClick({ x: 1, y: 1 });
    module.handleLabelerClick({ x: 1, y: 1 });

    module.__testApi.setState({ currentImage: makeImage(), labelBoardBounds: { x: 0, y: 0, width: 10, height: 10 } });
    module.__testApi.elements.labelRowsInput.value = "bad";
    module.__testApi.elements.labelColsInput.value = "2";
    module.handleLabelerClick({ x: 1, y: 1 });
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Rows/columns must be valid");

    module.__testApi.elements.labelRowsInput.value = "2";
    module.__testApi.elements.labelColsInput.value = "2";
    module.handleLabelerClick({ x: 50, y: 50 });
    expect(module.__testApi.getState().labelMap.size).toBe(0);

    module.__testApi.setState({ lastMagnifierPoint: { x: 12, y: 12 } });
    module.drawBaseImage(makeImage());

    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    expect(await module.fetchLabelExport("missing.png", { bustCache: true })).toBeNull();

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "canvas") {
        vi.spyOn(element as HTMLCanvasElement, "getContext").mockReturnValue(null);
      }
      return element;
    }) as typeof document.createElement);
    module.exportAnnotatedImage("noop.png");
    expect(module.buildTilePreview(createImageData(4, 4), { x: 0, y: 0, width: 1, height: 1 }, 8)).toBe("");
    expect(() => module.getImageDataFromImage(makeImage())).toThrow("Unable to create diagnostics canvas.");
    expect(() => module.cropImageData(createImageData(4, 4), { x: 0, y: 0, width: 1, height: 1 })).toThrow(
      "Unable to create temp canvas."
    );

    vi.restoreAllMocks();
    document.body.innerHTML = bodyHtml;
    const reloaded = await loadMainModule();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementationOnce(function () {
        return getMockContext(this as HTMLCanvasElement) as unknown as CanvasRenderingContext2D;
      })
      .mockImplementationOnce(() => null as unknown as CanvasRenderingContext2D);
    expect(() => reloaded.cropImageData(createImageData(4, 4), { x: 0, y: 0, width: 1, height: 1 })).toThrow(
      "Unable to create crop canvas."
    );

    const datasetImages = reloaded.__testApi.datasetImages;
    const originalDataset = [...datasetImages];
    datasetImages.splice(0, datasetImages.length);
    reloaded.populateDatasetSelect();
    expect(reloaded.__testApi.elements.datasetSelect.textContent).toContain("No dataset images found");
    datasetImages.push(...originalDataset);
    reloaded.populateDatasetSelect();

    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response);
    await expect(reloaded.fetchDiagnosticsFromServer()).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => "" } as Response);
    await expect(reloaded.fetchDiagnosticsFromServer()).resolves.toBeNull();
    vi.mocked(fetch).mockRejectedValue(new Error("down"));
    await expect(reloaded.fetchDiagnosticsFromServer()).resolves.toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => reloaded.saveClassifierHistory([])).not.toThrow();

    const emptyResult = await reloaded.evaluateDiagnostics([{ ...makeLabelExport("missing-image.png"), image: "missing-image.png" }], {
      collectDetails: true,
      includeSelf: true,
      includeSelfOnly: false,
      selfMatch: false
    });
    expect(emptyResult.metrics.total).toBe(0);
  });

  it("covers remaining training, template, auto-label, and test-state branches", async () => {
    const module = await loadMainModule();

    module.__testApi.setState({
      solverSelectionPoints: [{ x: 1, y: 2 }],
      solverAnnotations: [{ row: 0, col: 0, label: "1", color: "#fff" }],
      labelSelectionPoints: [{ x: 3, y: 4 }],
      labelMap: new Map([["0:0", { row: 0, col: 0, label: "1" }]]),
      currentLabel: "mega",
      labelOutputDirectory: { getFileHandle: vi.fn() },
      templateBank: [{ label: "1", vector: [0.1] }],
      labelCentroids: [{ label: "1", vector: [0.1], count: 1 }],
      templateVectorsByLabel: new Map([["1", [[0.1]]]]),
      diagnosticsRows: [],
      lastMagnifierPoint: { x: 5, y: 6 }
    });
    expect(module.__testApi.getState().currentLabel).toBe("mega");

    const training = await module.buildTrainingVectors("broomsweeper.jpg", [makeLabelExport(), makeLabelExport("other-missing.png")], {
      includeSelf: false,
      includeSelfOnly: false
    });
    expect(training.size).toBe(0);

    labelingModule.buildVectorsByLabel.mockImplementationOnce(() => {
      const tooMany = new Map<string, number[][]>();
      tooMany.set("unknown", Array.from({ length: 90 }, (_, index) => [index]));
      return tooMany;
    });
    const capped = await module.buildTrainingVectors("broomsweeper.jpg", [makeLabelExport()], {
      includeSelf: true,
      includeSelfOnly: true
    });
    expect((capped.get("unknown") ?? []).length).toBeLessThanOrEqual(80);

    await module.ensureTemplateBank();
    const existingLength = module.__testApi.getState().templateBank.length;
    await module.ensureTemplateBank();
    expect(module.__testApi.getState().templateBank.length).toBe(existingLength);

    const originalDataset = [...module.__testApi.datasetImages];
    module.__testApi.datasetImages.splice(0, module.__testApi.datasetImages.length);
    module.__testApi.clearLabelExportCache();
    await module.ensureTemplateBank();
    module.__testApi.datasetImages.push(...originalDataset);

    module.__testApi.setState({ currentImage: null, labelBoardBounds: null });
    module.runAutoLabel();

    module.__testApi.setState({
      currentImage: makeImage(),
      labelBoardBounds: { x: 10, y: 20, width: 100, height: 100 },
      currentDatasetImage: { name: "broomsweeper.jpg", url: "/data/broomsweeper.jpg" }
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeLabelExport(),
      text: async () => ""
    } as Response);
    module.runAutoLabel();
    await flush();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Applied existing manual labels");

    module.__testApi.clearLabelExportCache();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response);
    module.__testApi.elements.labelRowsInput.value = "bad";
    module.runAutoLabel();
    await flush();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Rows/columns must be valid");

    module.__testApi.elements.labelRowsInput.value = "2";
    module.__testApi.elements.labelColsInput.value = "2";
    labelingModule.predictLabelWithKnn.mockReturnValueOnce({ label: "unknown", distance: 0.5 }).mockReturnValueOnce(null);
    module.runAutoLabel();
    await flush();
    expect(module.__testApi.getState().labelMap.size).toBeGreaterThan(0);

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({}) } as Response);
    const success = await module.saveLabelExportToServer(makeLabelExport());
    expect(success.message).toBe("Label file saved on server.");
  });

  it("covers the final listener and helper edge branches", async () => {
    const module = await loadMainModule();
    const image = makeImage();

    Object.defineProperty(module.__testApi.elements.fileInput, "files", {
      value: [],
      configurable: true
    });
    module.__testApi.elements.fileInput.dispatchEvent(new Event("change"));

    module.setMode("labeler");
    module.__testApi.elements.selectBoardButton.click();
    module.setMode("solver");
    module.__testApi.setState({ currentImage: null });
    module.__testApi.elements.autoDetectSolverButton.disabled = false;
    module.__testApi.elements.autoDetectSolverButton.click();
    module.setMode("labeler");
    module.__testApi.elements.autoDetectSolverButton.click();

    module.setMode("labeler");
    module.__testApi.setState({ currentImage: image, solverBoardBounds: { x: 1, y: 2, width: 3, height: 4 } });
    module.__testApi.elements.runSolverButton.disabled = false;
    module.__testApi.elements.runSolverButton.click();
    module.setMode("solver");
    module.__testApi.elements.rowsInput.value = "bad";
    module.__testApi.elements.colsInput.value = "2";
    module.__testApi.elements.runSolverButton.click();

    module.__testApi.setState({ currentImage: null, mode: "solver" });
    module.__testApi.elements.exportButton.disabled = false;
    module.__testApi.elements.exportButton.click();
    module.__testApi.setState({ currentImage: image, mode: "solver" });
    module.__testApi.elements.exportButton.disabled = false;
    module.__testApi.elements.exportButton.click();

    module.setMode("solver");
    module.__testApi.elements.labelSelectBoardButton.click();
    module.setMode("labeler");
    module.__testApi.setState({ currentImage: image });
    module.__testApi.elements.labelSelectBoardButton.click();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Click top-left");

    module.__testApi.elements.autoDetectLabelerButton.disabled = false;
    module.setMode("solver");
    module.__testApi.elements.autoDetectLabelerButton.click();
    module.setMode("labeler");
    module.__testApi.setState({ currentImage: null });
    module.__testApi.elements.autoDetectLabelerButton.disabled = false;
    module.__testApi.elements.autoDetectLabelerButton.click();
    module.__testApi.setState({ currentImage: image });
    imageModule.detectBoardFromEdges.mockReturnValue({
      bounds: { x: 4, y: 5, width: 6, height: 7 },
      rows: 8,
      cols: 9
    });
    module.__testApi.elements.autoDetectLabelerButton.click();
    expect(module.__testApi.elements.labelRowsInput.value).toBe("8");

    module.__testApi.elements.autoLabelButton.disabled = false;
    module.setMode("solver");
    module.__testApi.elements.autoLabelButton.click();
    module.setMode("labeler");
    module.__testApi.setState({ currentImage: image, labelBoardBounds: { x: 0, y: 0, width: 10, height: 10 }, templateBank: [] });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response);
    module.__testApi.elements.autoLabelButton.click();
    await flush();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("No templates available");
    module.__testApi.setState({
      currentImage: image,
      currentDatasetImage: null,
      labelBoardBounds: { x: 0, y: 0, width: 10, height: 10 },
      templateBank: [{ label: "1", vector: [1, 0, 0] }],
      templateVectorsByLabel: new Map([["1", [[1, 0, 0]]]]),
      labelCentroids: [{ label: "1", centroid: [1, 0, 0] }],
      labelMap: new Map()
    });
    module.__testApi.elements.labelRowsInput.value = "2";
    module.__testApi.elements.labelColsInput.value = "2";
    module.__testApi.elements.autoLabelButton.disabled = false;
    labelingModule.predictLabelWithKnn.mockReturnValue({ label: "1", distance: 0.1 });
    module.__testApi.elements.autoLabelButton.click();
    await flush();

    module.setMode("solver");
    module.__testApi.setState({ labelMap: new Map([["0:0", { row: 0, col: 0, label: "1" }]]) });
    module.__testApi.elements.clearLabelsButton.click();
    expect(module.__testApi.getState().labelMap.size).toBe(1);

    module.__testApi.elements.exportLabelsButton.disabled = false;
    module.setMode("solver");
    module.__testApi.elements.exportLabelsButton.click();
    module.setMode("labeler");
    module.__testApi.setState({
      currentDatasetImage: { name: "broomsweeper.jpg", url: "/data/broomsweeper.jpg" },
      labelBoardBounds: { x: 0, y: 0, width: 10, height: 10 }
    });
    module.__testApi.elements.labelRowsInput.value = "bad";
    module.__testApi.elements.exportLabelsButton.disabled = false;
    module.__testApi.elements.exportLabelsButton.click();
    expect(module.__testApi.elements.labelStatusList.textContent).toContain("Rows/columns must be valid");

    module.setMode("solver");
    module.__testApi.elements.pickLabelFolderButton.click();

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/diagnostics") {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
      }
      if (url.includes(".labels.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => makeLabelExport(),
          text: async () => ""
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
    });
    module.setMode("diagnostics");
    await module.runDiagnostics();
    expect(module.__testApi.elements.diagnosticsSummary.textContent).toContain("Augmented accuracy");

    labelingModule.buildLabelCentroids.mockReturnValueOnce([]);
    const skipped = await module.evaluateDiagnostics([makeLabelExport()], {
      collectDetails: true,
      includeSelf: true,
      includeSelfOnly: true,
      selfMatch: false
    });
    expect(skipped.metrics.total).toBe(0);

    labelingModule.predictLabelWithKnn.mockReturnValueOnce({ label: "unknown", distance: 0.5 });
    const falseUnknown = await module.evaluateDiagnostics([makeLabelExport()], {
      collectDetails: true,
      includeSelf: true,
      includeSelfOnly: true,
      selfMatch: false
    });
    expect(falseUnknown.labelStats.get("1")?.falseUnknown).toBe(1);

    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("full");
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0
    });
    expect(() => module.saveClassifierHistory([])).not.toThrow();

    const includeSelfOnly = await module.buildTrainingVectors("broomsweeper.jpg", [makeLabelExport("other.png")], {
      includeSelfOnly: true
    });
    expect(includeSelfOnly.size).toBe(0);

    labelingModule.buildVectorsByLabel.mockImplementationOnce(() => new Map([["glitch", [[1, 2, 3]]]]));
    const originalGet = Map.prototype.get;
    vi.spyOn(Map.prototype, "get").mockImplementation(function (key: string) {
      if (key === "glitch" && this.has(key)) {
        return undefined;
      }
      return originalGet.call(this, key);
    });
    const weird = await module.buildTrainingVectors("broomsweeper.jpg", [makeLabelExport()], {
      includeSelf: true,
      includeSelfOnly: true
    });
    expect(weird.size).toBe(1);

    module.__testApi.setState({
      diagnosticsRows: [
        { image: "a", row: 0, col: 0, expected: "1", predicted: "2", distance: 0.1, previewUrl: "p1" },
        { image: "b", row: 1, col: 1, expected: "2", predicted: "3", distance: 0.2, previewUrl: "p2" }
      ]
    });
    module.renderDiagnosticsTable();
    const rows = module.__testApi.elements.diagnosticsTableBody.querySelectorAll("tr");
    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(rows[0]?.classList.contains("selected")).toBe(false);
    expect(rows[1]?.classList.contains("selected")).toBe(true);

    module.__testApi.setState({ templateBank: [], labelCentroids: [], templateVectorsByLabel: new Map() });
    const originalDataset = [...module.__testApi.datasetImages];
    module.__testApi.datasetImages.splice(0, module.__testApi.datasetImages.length);
    module.__testApi.datasetImages.push({ name: "only.png", url: "/data/only.png" });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeLabelExport("not-found.png"),
      text: async () => ""
    } as Response);
    await module.ensureTemplateBank();

    module.__testApi.setState({ templateBank: [], labelCentroids: [], templateVectorsByLabel: new Map() });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "canvas") {
        vi.spyOn(element as HTMLCanvasElement, "getContext").mockReturnValue(null);
      }
      return element;
    }) as typeof document.createElement);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeLabelExport("only.png"),
      text: async () => ""
    } as Response);
    await module.ensureTemplateBank();
    module.__testApi.datasetImages.splice(0, module.__testApi.datasetImages.length, ...originalDataset);
  });
});
