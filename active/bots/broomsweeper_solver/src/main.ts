import "./style.css";
import type { Annotation, BoardSpec, DetectedBoard, LabelExport, Point, Rect, TileLabel } from "./types";
import { detectBoardFromEdges, getTileRect } from "./image";
import {
  buildLabelCentroids,
  buildVectorsByLabel,
  extractTileVector,
  findBestCentroid,
  findNearestCentroid,
  normalizeLabelExport,
  type LabelCentroid
} from "./labeling";
import { solveBoard } from "./solver";

type Mode = "solver" | "labeler" | "diagnostics";

type PaletteItem = {
  label: string;
  color: string;
};

type TemplateVector = {
  label: string;
  vector: number[];
};

const MIN_IMAGE_DIMENSION = 900;

type FileSystemDirectoryHandle = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>;
};

type FileSystemFileHandle = {
  createWritable: () => Promise<FileSystemWritableFileStream>;
};

type FileSystemWritableFileStream = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};

const datasetImages = Object.entries(
  import.meta.glob("../data/*.{png,jpg,jpeg}", {
    eager: true,
    query: "?url",
    import: "default"
  })
).map(([path, url]) => ({
  name: path.split("/").pop() ?? path,
  url: url as string
}));

const labelExportCache = new Map<string, LabelExport>();


const palette: PaletteItem[] = [
  { label: "unknown", color: "#64748b" },
  { label: "empty", color: "#0f172a" },
  { label: "1", color: "#2563eb" },
  { label: "2", color: "#16a34a" },
  { label: "3", color: "#dc2626" },
  { label: "4", color: "#1e3a8a" },
  { label: "5", color: "#7f1d1d" },
  { label: "6", color: "#0d9488" },
  { label: "7", color: "#111827" },
  { label: "8", color: "#7c3aed" },
  { label: "bunny", color: "#f472b6" },
  { label: "mega", color: "#f97316" },
  { label: "stack2", color: "#f59e0b" },
  { label: "stack3", color: "#d97706" },
  { label: "stack4", color: "#b45309" },
  { label: "slug", color: "#a855f7" }
];

const fileInput = document.querySelector<HTMLInputElement>("#fileInput");
const rowsInput = document.querySelector<HTMLInputElement>("#rowsInput");
const colsInput = document.querySelector<HTMLInputElement>("#colsInput");
const selectBoardButton = document.querySelector<HTMLButtonElement>("#selectBoardButton");
const autoDetectSolverButton = document.querySelector<HTMLButtonElement>("#autoDetectSolverButton");
const runSolverButton = document.querySelector<HTMLButtonElement>("#runSolverButton");
const exportButton = document.querySelector<HTMLButtonElement>("#exportButton");

const solverTab = document.querySelector<HTMLButtonElement>("#solverTab");
const labelerTab = document.querySelector<HTMLButtonElement>("#labelerTab");
const diagnosticsTab = document.querySelector<HTMLButtonElement>("#diagnosticsTab");
const solverSection = document.querySelector<HTMLElement>("#solverSection");
const labelerSection = document.querySelector<HTMLElement>("#labelerSection");
const diagnosticsSection = document.querySelector<HTMLElement>("#diagnosticsSection");
const datasetSelect = document.querySelector<HTMLSelectElement>("#datasetSelect");
const labelRowsInput = document.querySelector<HTMLInputElement>("#labelRowsInput");
const labelColsInput = document.querySelector<HTMLInputElement>("#labelColsInput");
const labelSelectBoardButton = document.querySelector<HTMLButtonElement>("#labelSelectBoardButton");
const autoDetectLabelerButton = document.querySelector<HTMLButtonElement>("#autoDetectLabelerButton");
const autoLabelButton = document.querySelector<HTMLButtonElement>("#autoLabelButton");
const clearLabelsButton = document.querySelector<HTMLButtonElement>("#clearLabelsButton");
const exportLabelsButton = document.querySelector<HTMLButtonElement>("#exportLabelsButton");
const pickLabelFolderButton = document.querySelector<HTMLButtonElement>("#pickLabelFolderButton");
const labelPalette = document.querySelector<HTMLDivElement>("#labelPalette");
const runDiagnosticsButton = document.querySelector<HTMLButtonElement>("#runDiagnosticsButton");
const diagnosticsSummary = document.querySelector<HTMLDivElement>("#diagnosticsSummary");
const diagnosticsResultsSection = document.querySelector<HTMLElement>("#diagnosticsResults");
const diagnosticsTableBody = document.querySelector<HTMLTableSectionElement>("#diagnosticsTableBody");
const diagnosticsPreviewImage = document.querySelector<HTMLImageElement>("#diagnosticsPreviewImage");
const diagnosticsPreviewMeta = document.querySelector<HTMLDivElement>("#diagnosticsPreviewMeta");
const magnifier = document.querySelector<HTMLDivElement>("#magnifier");
const magnifierCanvas = document.querySelector<HTMLCanvasElement>("#magnifierCanvas");
const magnifierToggle = document.querySelector<HTMLInputElement>("#magnifierToggle");

const imageCanvas = document.querySelector<HTMLCanvasElement>("#imageCanvas");
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlayCanvas");
const statusList = document.querySelector<HTMLUListElement>("#statusList");
const labelStatusList = document.querySelector<HTMLUListElement>("#labelStatusList");
const diagnosticsStatusList = document.querySelector<HTMLUListElement>("#diagnosticsStatusList");

if (
  !fileInput ||
  !rowsInput ||
  !colsInput ||
  !selectBoardButton ||
  !autoDetectSolverButton ||
  !runSolverButton ||
  !exportButton ||
  !solverTab ||
  !labelerTab ||
  !diagnosticsTab ||
  !solverSection ||
  !labelerSection ||
  !diagnosticsSection ||
  !datasetSelect ||
  !labelRowsInput ||
  !labelColsInput ||
  !labelSelectBoardButton ||
  !autoDetectLabelerButton ||
  !autoLabelButton ||
  !clearLabelsButton ||
  !exportLabelsButton ||
  !pickLabelFolderButton ||
  !labelPalette ||
  !runDiagnosticsButton ||
  !diagnosticsSummary ||
  !diagnosticsResultsSection ||
  !diagnosticsTableBody ||
  !diagnosticsPreviewImage ||
  !diagnosticsPreviewMeta ||
  !magnifier ||
  !magnifierCanvas ||
  !magnifierToggle ||
  !imageCanvas ||
  !overlayCanvas ||
  !statusList ||
  !labelStatusList ||
  !diagnosticsStatusList
) {
  throw new Error("Missing required DOM elements.");
}

const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
const overlayCtx = overlayCanvas.getContext("2d");
const magnifierCtx = magnifierCanvas.getContext("2d");

if (!imageCtx || !overlayCtx || !magnifierCtx) {
  throw new Error("Canvas context unavailable.");
}

let mode: Mode = "solver";
let currentImage: HTMLImageElement | null = null;

let solverBoardBounds: Rect | null = null;
let solverSelectionPoints: Point[] = [];
let solverAnnotations: Annotation[] = [];

let labelBoardBounds: Rect | null = null;
let labelSelectionPoints: Point[] = [];
let labelMap = new Map<string, TileLabel>();
let currentLabel = palette[0].label;
let currentDatasetImage: { name: string; url: string } | null = null;
let labelOutputDirectory: FileSystemDirectoryHandle | null = null;
let templateBank: TemplateVector[] = [];
let labelCentroids: LabelCentroid[] = [];
let diagnosticsRows: DiagnosticsRow[] = [];
let selectedDiagnosticsRow: DiagnosticsRow | null = null;
let lastMagnifierPoint: Point | null = null;

populateDatasetSelect();
renderLabelPalette();
setMode("solver");

fileInput.addEventListener("change", async () => {
  if (mode !== "solver") {
    return;
  }
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  const image = await loadImageFromFile(file);
  currentImage = image;
  drawBaseImage(image);
  resetSolverSelection();
  autoDetectSolverButton.disabled = false;
  setSolverStatus(["Screenshot loaded. Select board bounds."]);
});

selectBoardButton.addEventListener("click", () => {
  if (mode !== "solver") {
    return;
  }
  if (!currentImage) {
    setSolverStatus(["Upload a screenshot first."]);
    return;
  }
  solverSelectionPoints = [];
  solverBoardBounds = null;
  solverAnnotations = [];
  drawOverlay();
  setSolverStatus(["Click top-left and bottom-right corners of the board."]);
});

autoDetectSolverButton.addEventListener("click", () => {
  if (mode !== "solver") {
    return;
  }
  if (!currentImage) {
    setSolverStatus(["Upload a screenshot first."]);
    return;
  }
  const detected = detectBoard();
  if (!detected) {
    setSolverStatus(["Auto-detect failed. Try manual selection."]);
    return;
  }
  applyDetectedBoardToSolver(detected);
  setSolverStatus(["Board auto-detected. Review rows/cols and run solver."]);
});

runSolverButton.addEventListener("click", () => {
  if (mode !== "solver") {
    return;
  }
  if (!currentImage || !solverBoardBounds) {
    setSolverStatus(["Select board bounds before running solver."]);
    return;
  }
  const rows = parseInt(rowsInput.value, 10);
  const cols = parseInt(colsInput.value, 10);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 1 || cols <= 1) {
    setSolverStatus(["Rows/columns must be valid numbers."]);
    return;
  }
  const boardSpec: BoardSpec = { rows, cols, bounds: solverBoardBounds };
  const imageData = imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
  const result = solveBoard(imageData, boardSpec);
  solverAnnotations = result.annotations;
  drawOverlay();
  const slugCount = result.slugTiles.filter((tile) => tile.slugLie).length;
  setSolverStatus([
    `Solver ran. Slug-border tiles detected: ${slugCount}.`,
    "Next step: classify numbers and dust bunnies."
  ]);
});

exportButton.addEventListener("click", () => {
  if (mode !== "solver" || !currentImage) {
    return;
  }
  exportAnnotatedImage("broomsweeper-annotated.png");
});

labelSelectBoardButton.addEventListener("click", () => {
  if (mode !== "labeler") {
    return;
  }
  if (!currentImage) {
    setLabelerStatus(["Load a dataset image first."]);
    return;
  }
  labelSelectionPoints = [];
  labelBoardBounds = null;
  drawOverlay();
  setLabelerStatus(["Click top-left and bottom-right corners of the board."]);
});

autoDetectLabelerButton.addEventListener("click", () => {
  if (mode !== "labeler") {
    return;
  }
  if (!currentImage) {
    setLabelerStatus(["Load a dataset image first."]);
    return;
  }
  const detected = detectBoard();
  if (!detected) {
    setLabelerStatus(["Auto-detect failed. Try manual selection."]);
    return;
  }
  applyDetectedBoardToLabeler(detected);
  setLabelerStatus(["Board auto-detected. You can start labeling."]);
});

autoLabelButton.addEventListener("click", async () => {
  if (mode !== "labeler") {
    return;
  }
  if (!currentImage || !labelBoardBounds) {
    setLabelerStatus(["Select board bounds before auto-labeling."]);
    return;
  }
  await ensureTemplateBank();
  if (templateBank.length === 0) {
    setLabelerStatus(["No templates available. Label at least one image first."]);
    return;
  }
  runAutoLabel();
});

clearLabelsButton.addEventListener("click", () => {
  if (mode !== "labeler") {
    return;
  }
  labelMap = new Map();
  drawOverlay();
  setLabelerStatus(["Labels cleared."]);
});

exportLabelsButton.addEventListener("click", () => {
  if (mode !== "labeler") {
    return;
  }
  if (!currentDatasetImage || !labelBoardBounds) {
    setLabelerStatus(["Select a dataset image and board bounds first."]);
    return;
  }
  const rows = parseInt(labelRowsInput.value, 10);
  const cols = parseInt(labelColsInput.value, 10);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 1 || cols <= 1) {
    setLabelerStatus(["Rows/columns must be valid numbers."]);
    return;
  }
  const exportPayload: LabelExport = {
    image: currentDatasetImage.name,
    rows,
    cols,
    bounds: labelBoardBounds,
    labels: Array.from(labelMap.values()),
    createdAt: new Date().toISOString()
  };
  void saveLabelExport(exportPayload);
});

pickLabelFolderButton.addEventListener("click", async () => {
  if (mode !== "labeler") {
    return;
  }
  const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  if (!picker) {
    setLabelerStatus(["Directory picker not supported in this browser."]);
    return;
  }
  try {
    labelOutputDirectory = await picker();
    setLabelerStatus(["Label output folder selected."]);
  } catch (error) {
    setLabelerStatus(["Directory selection canceled."]);
  }
});

solverTab.addEventListener("click", () => setMode("solver"));
labelerTab.addEventListener("click", () => setMode("labeler"));
diagnosticsTab.addEventListener("click", () => setMode("diagnostics"));

datasetSelect.addEventListener("change", () => {
  if (mode !== "labeler") {
    return;
  }
  const selected = datasetImages.find((item) => item.name === datasetSelect.value) ?? null;
  if (!selected) {
    return;
  }
  void loadDatasetImage(selected);
});

overlayCanvas.addEventListener("click", (event) => {
  if (!currentImage) {
    return;
  }
  const point = getCanvasPoint(event, overlayCanvas);
  if (mode === "solver") {
    handleSolverClick(point);
  } else {
    handleLabelerClick(point);
  }
});

overlayCanvas.addEventListener("mousemove", (event) => {
  if (!currentImage || magnifierToggle.checked === false) {
    magnifier.classList.add("hidden");
    return;
  }
  const point = getCanvasPoint(event, overlayCanvas);
  lastMagnifierPoint = point;
  updateMagnifier(point);
});

overlayCanvas.addEventListener("mouseleave", () => {
  magnifier.classList.add("hidden");
});

magnifierToggle.addEventListener("change", () => {
  if (!magnifierToggle.checked) {
    magnifier.classList.add("hidden");
    return;
  }
  if (lastMagnifierPoint) {
    updateMagnifier(lastMagnifierPoint);
  }
});

runDiagnosticsButton.addEventListener("click", () => {
  if (mode !== "diagnostics") {
    return;
  }
  void runDiagnostics();
});

function setMode(nextMode: Mode): void {
  mode = nextMode;
  solverTab.classList.toggle("active", mode === "solver");
  labelerTab.classList.toggle("active", mode === "labeler");
  diagnosticsTab.classList.toggle("active", mode === "diagnostics");
  solverSection.classList.toggle("hidden", mode !== "solver");
  labelerSection.classList.toggle("hidden", mode !== "labeler");
  diagnosticsSection.classList.toggle("hidden", mode !== "diagnostics");
  statusList.classList.toggle("hidden", mode !== "solver");
  labelStatusList.classList.toggle("hidden", mode !== "labeler");
  diagnosticsStatusList.classList.toggle("hidden", mode !== "diagnostics");
  diagnosticsResultsSection.classList.toggle("hidden", mode !== "diagnostics");
  if (mode === "solver") {
    setSolverStatus(["Upload a screenshot to begin."]);
  } else {
    if (mode === "labeler") {
      setLabelerStatus(["Select a dataset image to begin labeling."]);
      if (datasetImages.length > 0) {
        const selected = datasetImages.find((item) => item.name === datasetSelect.value) ?? datasetImages[0];
        void loadDatasetImage(selected);
      }
    } else {
      setDiagnosticsStatus(["Run diagnostics to validate labels."]);
    }
  }
}

function handleSolverClick(point: Point): void {
  if (!currentImage) {
    return;
  }
  solverSelectionPoints.push(point);
  if (solverSelectionPoints.length === 2) {
    solverBoardBounds = normalizeRect(solverSelectionPoints[0], solverSelectionPoints[1]);
    solverSelectionPoints = [];
    drawOverlay();
    runSolverButton.disabled = false;
    exportButton.disabled = false;
    setSolverStatus(["Board bounds set. Run solver to annotate."]);
  } else {
    drawOverlay();
  }
}

function handleLabelerClick(point: Point): void {
  if (!currentImage) {
    return;
  }
  if (!labelBoardBounds) {
    labelSelectionPoints.push(point);
    if (labelSelectionPoints.length === 2) {
      labelBoardBounds = normalizeRect(labelSelectionPoints[0], labelSelectionPoints[1]);
      labelSelectionPoints = [];
      drawOverlay();
      autoLabelButton.disabled = false;
      clearLabelsButton.disabled = false;
      exportLabelsButton.disabled = false;
      setLabelerStatus(["Board bounds set. Click tiles to label."]);
    } else {
      drawOverlay();
    }
    return;
  }
  const rows = parseInt(labelRowsInput.value, 10);
  const cols = parseInt(labelColsInput.value, 10);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 1 || cols <= 1) {
    setLabelerStatus(["Rows/columns must be valid numbers."]);
    return;
  }
  const boardSpec: BoardSpec = { rows, cols, bounds: labelBoardBounds };
  const tile = getTileFromPoint(boardSpec, point);
  if (!tile) {
    return;
  }
  const key = `${tile.row}:${tile.col}`;
  const nextLabel: TileLabel = { row: tile.row, col: tile.col, label: currentLabel };
  labelMap.set(key, nextLabel);
  drawOverlay();
}

function drawBaseImage(image: HTMLImageElement): void {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const scale = Math.max(1, MIN_IMAGE_DIMENSION / Math.min(naturalWidth, naturalHeight));
  const targetWidth = Math.round(naturalWidth * scale);
  const targetHeight = Math.round(naturalHeight * scale);
  imageCanvas.width = targetWidth;
  imageCanvas.height = targetHeight;
  overlayCanvas.width = targetWidth;
  overlayCanvas.height = targetHeight;
  imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  imageCtx.imageSmoothingEnabled = scale === 1;
  imageCtx.drawImage(image, 0, 0, targetWidth, targetHeight);
  drawOverlay();
  runSolverButton.disabled = mode !== "solver";
  exportButton.disabled = mode !== "solver";
  if (magnifierToggle.checked && lastMagnifierPoint) {
    updateMagnifier(lastMagnifierPoint);
  }
}

function drawOverlay(): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (mode === "solver") {
    drawSolverOverlay();
  } else {
    drawLabelerOverlay();
  }
}

function drawSolverOverlay(): void {
  if (solverBoardBounds) {
    overlayCtx.strokeStyle = "#22c55e";
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(
      solverBoardBounds.x,
      solverBoardBounds.y,
      solverBoardBounds.width,
      solverBoardBounds.height
    );

    const rows = parseInt(rowsInput.value, 10);
    const cols = parseInt(colsInput.value, 10);
    if (rows > 1 && cols > 1) {
      drawGrid(solverBoardBounds, rows, cols);
      drawAnnotations(solverBoardBounds, rows, cols, solverAnnotations);
    }
  }

  if (solverSelectionPoints.length === 1) {
    drawSelectionDot(solverSelectionPoints[0]);
  }
}

function drawLabelerOverlay(): void {
  if (labelBoardBounds) {
    overlayCtx.strokeStyle = "#22c55e";
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(
      labelBoardBounds.x,
      labelBoardBounds.y,
      labelBoardBounds.width,
      labelBoardBounds.height
    );

    const rows = parseInt(labelRowsInput.value, 10);
    const cols = parseInt(labelColsInput.value, 10);
    if (rows > 1 && cols > 1) {
      drawGrid(labelBoardBounds, rows, cols);
      drawLabelAnnotations(labelBoardBounds, rows, cols);
    }
  }

  if (labelSelectionPoints.length === 1) {
    drawSelectionDot(labelSelectionPoints[0]);
  }
}

function drawGrid(bounds: Rect, rows: number, cols: number): void {
  overlayCtx.strokeStyle = "rgba(148, 163, 184, 0.5)";
  overlayCtx.lineWidth = 1;
  for (let row = 1; row < rows; row += 1) {
    const y = bounds.y + (bounds.height / rows) * row;
    overlayCtx.beginPath();
    overlayCtx.moveTo(bounds.x, y);
    overlayCtx.lineTo(bounds.x + bounds.width, y);
    overlayCtx.stroke();
  }
  for (let col = 1; col < cols; col += 1) {
    const x = bounds.x + (bounds.width / cols) * col;
    overlayCtx.beginPath();
    overlayCtx.moveTo(x, bounds.y);
    overlayCtx.lineTo(x, bounds.y + bounds.height);
    overlayCtx.stroke();
  }
}

function drawAnnotations(bounds: Rect, rows: number, cols: number, items: Annotation[]): void {
  for (const item of items) {
    const tile = getTileRect({ rows, cols, bounds }, item.row, item.col);
    overlayCtx.fillStyle = item.color;
    overlayCtx.globalAlpha = 0.75;
    overlayCtx.fillRect(tile.x, tile.y, tile.width, tile.height);
    overlayCtx.globalAlpha = 1;
    overlayCtx.fillStyle = "white";
    overlayCtx.font = `${Math.max(12, tile.height * 0.25)}px sans-serif`;
    overlayCtx.textAlign = "center";
    overlayCtx.textBaseline = "middle";
    overlayCtx.fillText(item.label, tile.x + tile.width / 2, tile.y + tile.height / 2);
  }
}

function drawLabelAnnotations(bounds: Rect, rows: number, cols: number): void {
  for (const label of labelMap.values()) {
    const tile = getTileRect({ rows, cols, bounds }, label.row, label.col);
    const paletteItem = palette.find((item) => item.label === label.label);
    overlayCtx.fillStyle = paletteItem?.color ?? "#0f172a";
    overlayCtx.globalAlpha = 0.6;
    overlayCtx.fillRect(tile.x, tile.y, tile.width, tile.height);
    overlayCtx.globalAlpha = 1;
    overlayCtx.fillStyle = "white";
    overlayCtx.font = `${Math.max(12, tile.height * 0.25)}px sans-serif`;
    overlayCtx.textAlign = "center";
    overlayCtx.textBaseline = "middle";
    overlayCtx.fillText(label.label, tile.x + tile.width / 2, tile.y + tile.height / 2);
  }
}

function drawSelectionDot(point: Point): void {
  overlayCtx.fillStyle = "rgba(59, 130, 246, 0.7)";
  overlayCtx.beginPath();
  overlayCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
  overlayCtx.fill();
}

function getTileFromPoint(board: BoardSpec, point: Point): { row: number; col: number } | null {
  if (
    point.x < board.bounds.x ||
    point.y < board.bounds.y ||
    point.x > board.bounds.x + board.bounds.width ||
    point.y > board.bounds.y + board.bounds.height
  ) {
    return null;
  }
  const relativeX = point.x - board.bounds.x;
  const relativeY = point.y - board.bounds.y;
  const col = Math.floor((relativeX / board.bounds.width) * board.cols);
  const row = Math.floor((relativeY / board.bounds.height) * board.rows);
  return { row, col };
}

function getCanvasPoint(event: MouseEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return { x, y, width, height };
}

function resetSolverSelection(): void {
  solverBoardBounds = null;
  solverSelectionPoints = [];
  solverAnnotations = [];
  runSolverButton.disabled = true;
  exportButton.disabled = true;
}

function setSolverStatus(messages: string[]): void {
  statusList.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    statusList.appendChild(item);
  }
}

function setLabelerStatus(messages: string[]): void {
  labelStatusList.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    labelStatusList.appendChild(item);
  }
}

function setDiagnosticsStatus(messages: string[]): void {
  diagnosticsStatusList.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    diagnosticsStatusList.appendChild(item);
  }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function loadDatasetImage(image: { name: string; url: string }): Promise<void> {
  const loaded = await loadImageFromUrl(image.url);
  currentDatasetImage = image;
  currentImage = loaded;
  drawBaseImage(loaded);
  labelBoardBounds = null;
  labelSelectionPoints = [];
  labelMap = new Map();
  autoDetectLabelerButton.disabled = false;
  autoLabelButton.disabled = true;
  clearLabelsButton.disabled = false;
  exportLabelsButton.disabled = true;
  const existingLabels = await fetchLabelExport(image.name, { bustCache: true });
  if (existingLabels) {
    applyLabelExport(existingLabels);
    setLabelerStatus([`Loaded ${image.name} with existing labels.`]);
  } else {
    setLabelerStatus([`Loaded ${image.name}. Select board bounds.`]);
  }
}

async function fetchLabelExport(
  imageName: string,
  options: { bustCache?: boolean } = {}
): Promise<LabelExport | null> {
  const cached = labelExportCache.get(imageName);
  if (cached && !options.bustCache) {
    return cached;
  }
  const cacheBust = options.bustCache ? `?t=${Date.now()}` : "";
  const candidateRoots = ["/data", "/label_output"];
  for (const root of candidateRoots) {
    const safeName = encodeURIComponent(imageName);
    const url = `${root}/${safeName}.labels.json${cacheBust}`;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      const json = (await response.json()) as LabelExport;
      const normalized = normalizeLabelExport(json);
      labelExportCache.set(imageName, normalized);
      return normalized;
    } catch (error) {
      continue;
    }
  }
  return null;
}

async function getAllLabelExports(
  options: { bustCache?: boolean } = {}
): Promise<LabelExport[]> {
  const results: LabelExport[] = [];
  for (const image of datasetImages) {
    const labelExport = await fetchLabelExport(image.name, options);
    if (labelExport) {
      results.push(labelExport);
    }
  }
  return results;
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load dataset image"));
    image.src = url;
  });
}

function exportAnnotatedImage(filename: string): void {
  const merged = document.createElement("canvas");
  merged.width = imageCanvas.width;
  merged.height = imageCanvas.height;
  const mergedCtx = merged.getContext("2d");
  if (!mergedCtx) {
    return;
  }
  mergedCtx.drawImage(imageCanvas, 0, 0);
  mergedCtx.drawImage(overlayCanvas, 0, 0);
  const url = merged.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

function downloadJson(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function populateDatasetSelect(): void {
  datasetSelect.innerHTML = "";
  if (datasetImages.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No dataset images found";
    datasetSelect.appendChild(option);
    datasetSelect.disabled = true;
    return;
  }
  datasetSelect.disabled = false;
  for (const image of datasetImages) {
    const option = document.createElement("option");
    option.value = image.name;
    option.textContent = image.name;
    datasetSelect.appendChild(option);
  }
}

function renderLabelPalette(): void {
  labelPalette.innerHTML = "";
  for (const item of palette) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "label-chip";
    button.style.borderColor = item.color;
    button.style.color = item.color;
    button.textContent = item.label;
    if (item.label === currentLabel) {
      button.classList.add("active");
      button.style.background = item.color;
      button.style.color = "white";
    }
    button.addEventListener("click", () => {
      currentLabel = item.label;
      renderLabelPalette();
    });
    labelPalette.appendChild(button);
  }
}

type DiagnosticsRow = {
  image: string;
  row: number;
  col: number;
  expected: string;
  predicted: string;
  distance: number;
  previewUrl: string;
};

async function runDiagnostics(): Promise<void> {
  diagnosticsSummary.textContent = "Running diagnostics...";
  diagnosticsTableBody.innerHTML = "";
  diagnosticsRows = [];
  selectedDiagnosticsRow = null;
  diagnosticsPreviewImage.src = "";
  diagnosticsPreviewMeta.textContent = "Select a mismatch row to preview.";
  setDiagnosticsStatus(["Loading images and labels..."]);

  const labelExports = await getAllLabelExports({ bustCache: true });
  if (labelExports.length === 0) {
    diagnosticsSummary.textContent = "No label files found.";
    setDiagnosticsStatus(["Add .labels.json files to data/."]);
    return;
  }

  let total = 0;
  let correct = 0;
  let mismatched = 0;

  for (const labelExport of labelExports) {
    const imageEntry = datasetImages.find((item) => item.name === labelExport.image);
    if (!imageEntry) {
      continue;
    }

    const trainingVectors = await buildTrainingVectors(labelExport.image, labelExports);
    const centroids = buildLabelCentroids(trainingVectors);
    if (centroids.length === 0) {
      continue;
    }

    const image = await loadImageFromUrl(imageEntry.url);
    const imageData = getImageDataFromImage(image);
    const boardSpec: BoardSpec = {
      rows: labelExport.rows,
      cols: labelExport.cols,
      bounds: labelExport.bounds
    };

    for (const label of labelExport.labels) {
      const tileRect = getTileRect(boardSpec, label.row, label.col);
      const vector = extractTileVector(imageData, tileRect, 10);
      const match = findNearestCentroid(vector, centroids);
      const predicted = match?.label ?? "unknown";
      total += 1;
      if (predicted === label.label) {
        correct += 1;
      } else {
        mismatched += 1;
        const previewUrl = buildTilePreview(imageData, tileRect, 160);
        diagnosticsRows.push({
          image: labelExport.image,
          row: label.row,
          col: label.col,
          expected: label.label,
          predicted,
          distance: match?.distance ?? 0,
          previewUrl
        });
      }
    }
  }

  const accuracy = total > 0 ? correct / total : 0;
  diagnosticsSummary.textContent = `Accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${total}) | Mismatches: ${mismatched}`;
  setDiagnosticsStatus(["Diagnostics complete."]);
  renderDiagnosticsTable();
}

async function buildTrainingVectors(
  excludeImage: string,
  labelExports: LabelExport[]
): Promise<Map<string, number[][]>> {
  const aggregateVectors = new Map<string, number[][]>();
  for (const labelExport of labelExports) {
    if (labelExport.image === excludeImage) {
      continue;
    }
    const imageEntry = datasetImages.find((item) => item.name === labelExport.image);
    if (!imageEntry) {
      continue;
    }
    const image = await loadImageFromUrl(imageEntry.url);
    const imageData = getImageDataFromImage(image);
    const boardSpec: BoardSpec = {
      rows: labelExport.rows,
      cols: labelExport.cols,
      bounds: labelExport.bounds
    };
    const vectorsByLabel = buildVectorsByLabel(imageData, boardSpec, labelExport.labels, 10);
    for (const [label, vectors] of vectorsByLabel.entries()) {
      if (!aggregateVectors.has(label)) {
        aggregateVectors.set(label, []);
      }
      aggregateVectors.get(label)?.push(...vectors);
    }
  }
  return aggregateVectors;
}

function getImageDataFromImage(image: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Unable to create diagnostics canvas.");
  }
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function renderDiagnosticsTable(): void {
  diagnosticsTableBody.innerHTML = "";
  if (diagnosticsRows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No mismatches found.";
    row.appendChild(cell);
    diagnosticsTableBody.appendChild(row);
    return;
  }
  for (const entry of diagnosticsRows) {
    const row = document.createElement("tr");
    row.addEventListener("click", () => {
      selectedDiagnosticsRow = entry;
      updateDiagnosticsPreview();
      const existingSelected = diagnosticsTableBody.querySelector("tr.selected");
      if (existingSelected) {
        existingSelected.classList.remove("selected");
      }
      row.classList.add("selected");
    });
    row.appendChild(buildCell(entry.image));
    row.appendChild(buildCell(entry.row.toString()));
    row.appendChild(buildCell(entry.col.toString()));
    row.appendChild(buildCell(entry.expected));
    row.appendChild(buildCell(entry.predicted));
    row.appendChild(buildCell(entry.distance.toFixed(4)));
    diagnosticsTableBody.appendChild(row);
  }
}

function buildCell(text: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function updateDiagnosticsPreview(): void {
  if (!selectedDiagnosticsRow) {
    diagnosticsPreviewImage.src = "";
    diagnosticsPreviewMeta.textContent = "Select a mismatch row to preview.";
    return;
  }
  diagnosticsPreviewImage.src = selectedDiagnosticsRow.previewUrl;
  diagnosticsPreviewMeta.textContent = `${selectedDiagnosticsRow.image} • r${selectedDiagnosticsRow.row} c${selectedDiagnosticsRow.col} • ${selectedDiagnosticsRow.expected} → ${selectedDiagnosticsRow.predicted}`;
}

function buildTilePreview(imageData: ImageData, rect: Rect, size: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  ctx.imageSmoothingEnabled = false;
  const cropped = cropImageData(imageData, rect);
  ctx.drawImage(cropped.canvas, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

function updateMagnifier(point: Point): void {
  const size = 24;
  const scale = magnifierCanvas.width / size;
  const half = Math.floor(size / 2);
  const sourceX = Math.max(0, Math.min(imageCanvas.width - size, Math.floor(point.x) - half));
  const sourceY = Math.max(0, Math.min(imageCanvas.height - size, Math.floor(point.y) - half));

  magnifierCtx.imageSmoothingEnabled = false;
  magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
  magnifierCtx.drawImage(
    imageCanvas,
    sourceX,
    sourceY,
    size,
    size,
    0,
    0,
    magnifierCanvas.width,
    magnifierCanvas.height
  );

  magnifierCtx.strokeStyle = "rgba(56, 189, 248, 0.9)";
  magnifierCtx.lineWidth = 1;
  magnifierCtx.strokeRect(
    magnifierCanvas.width / 2 - scale / 2,
    magnifierCanvas.height / 2 - scale / 2,
    scale,
    scale
  );

  magnifier.style.left = `${Math.min(point.x + 24, imageCanvas.width - 176)}px`;
  magnifier.style.top = `${Math.min(point.y + 24, imageCanvas.height - 176)}px`;
  magnifier.classList.remove("hidden");
}

function cropImageData(imageData: ImageData, rect: Rect): { canvas: HTMLCanvasElement } {
  const temp = document.createElement("canvas");
  temp.width = imageData.width;
  temp.height = imageData.height;
  const tempCtx = temp.getContext("2d", { willReadFrequently: true });
  if (!tempCtx) {
    throw new Error("Unable to create temp canvas.");
  }
  tempCtx.putImageData(imageData, 0, 0);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.floor(rect.width));
  cropCanvas.height = Math.max(1, Math.floor(rect.height));
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) {
    throw new Error("Unable to create crop canvas.");
  }
  cropCtx.drawImage(
    temp,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );
  return { canvas: cropCanvas };
}

function detectBoard(): DetectedBoard | null {
  const imageData = imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
  return detectBoardFromEdges(imageData);
}

function applyDetectedBoardToSolver(detected: DetectedBoard): void {
  solverBoardBounds = detected.bounds;
  rowsInput.value = String(detected.rows);
  colsInput.value = String(detected.cols);
  solverSelectionPoints = [];
  drawOverlay();
  runSolverButton.disabled = false;
  exportButton.disabled = false;
}

function applyDetectedBoardToLabeler(detected: DetectedBoard): void {
  labelBoardBounds = detected.bounds;
  labelRowsInput.value = String(detected.rows);
  labelColsInput.value = String(detected.cols);
  labelSelectionPoints = [];
  drawOverlay();
  autoLabelButton.disabled = false;
  clearLabelsButton.disabled = false;
  exportLabelsButton.disabled = false;
}

function applyLabelExport(payload: LabelExport): void {
  const normalized = normalizeLabelExport(payload);
  labelBoardBounds = normalized.bounds;
  labelRowsInput.value = String(normalized.rows);
  labelColsInput.value = String(normalized.cols);
  labelMap = new Map(normalized.labels.map((label) => [`${label.row}:${label.col}`, label]));
  drawOverlay();
  autoLabelButton.disabled = false;
  clearLabelsButton.disabled = false;
  exportLabelsButton.disabled = false;
}

async function saveLabelExport(payload: LabelExport): Promise<void> {
  const result = await saveLabelExportToServer(payload);
  if (result.ok) {
    const normalized = normalizeLabelExport(payload);
    labelExportCache.set(normalized.image, normalized);
    templateBank = [];
    labelCentroids = [];
  }
  setLabelerStatus([result.message]);
}

async function saveLabelExportToServer(
  payload: LabelExport
): Promise<{ ok: boolean; message: string }> {
  try {
    const labelsEndpoint =
      (import.meta as { env?: { VITE_LABELS_ENDPOINT?: string } }).env?.VITE_LABELS_ENDPOINT ??
      "/api/labels";
    const response = await fetch(labelsEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    if (!response.ok) {
      const details = text ? ` ${text}` : "";
      return {
        ok: false,
        message: `Server save failed (${response.status}).${details || " Ensure dev server is running."}`
      };
    }

    const json = (text ? JSON.parse(text) : null) as
      | { file?: string; overwritten?: boolean; fallback?: boolean; fallbackDir?: string }
      | null;
    const overwriteNote = json?.overwritten ? " (overwritten)" : "";
    const fallbackNote = json?.fallback ? ` (saved to ${json.fallbackDir ?? "label_output"})` : "";
    const message = json?.file
      ? `Label file saved on server (${json.file})${overwriteNote}${fallbackNote}.`
      : "Label file saved on server.";
    return { ok: true, message };
  } catch (error) {
    return {
      ok: false,
      message: "Server save failed. Ensure the dev server is running or use npm run dev:all."
    };
  }
}

async function ensureTemplateBank(): Promise<void> {
  if (templateBank.length > 0) {
    return;
  }
  const templates: TemplateVector[] = [];
  const aggregateVectorsByLabel = new Map<string, number[][]>();
  const labelExports = await getAllLabelExports({ bustCache: true });
  for (const labelExport of labelExports) {
    const imageEntry = datasetImages.find((item) => item.name === labelExport.image);
    if (!imageEntry) {
      continue;
    }
    const image = await loadImageFromUrl(imageEntry.url);
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = image.naturalWidth;
    tempCanvas.height = image.naturalHeight;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    if (!tempCtx) {
      continue;
    }
    tempCtx.drawImage(image, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const boardSpec: BoardSpec = {
      rows: labelExport.rows,
      cols: labelExport.cols,
      bounds: labelExport.bounds
    };
    const vectorsByLabel = buildVectorsByLabel(imageData, boardSpec, labelExport.labels, 10);
    for (const [label, vectors] of vectorsByLabel.entries()) {
      if (!aggregateVectorsByLabel.has(label)) {
        aggregateVectorsByLabel.set(label, []);
      }
      aggregateVectorsByLabel.get(label)?.push(...vectors);
    }
    for (const [label, vectors] of vectorsByLabel.entries()) {
      for (const vector of vectors) {
        templates.push({ label, vector });
      }
    }
  }
  templateBank = templates;
  labelCentroids = buildLabelCentroids(aggregateVectorsByLabel);
}

function runAutoLabel(): void {
  if (!labelBoardBounds || !currentImage) {
    return;
  }
  void (async () => {
    if (currentDatasetImage) {
      const existing = await fetchLabelExport(currentDatasetImage.name, { bustCache: true });
      if (existing) {
        applyLabelExport(existing);
        setLabelerStatus(["Applied existing manual labels for this image."]);
        return;
      }
    }
    const rows = parseInt(labelRowsInput.value, 10);
    const cols = parseInt(labelColsInput.value, 10);
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 1 || cols <= 1) {
      setLabelerStatus(["Rows/columns must be valid numbers."]);
      return;
    }
    const boardSpec: BoardSpec = { rows, cols, bounds: labelBoardBounds };
    const imageData = imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
    let assigned = 0;
    let unknown = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const tileRect = getTileRect(boardSpec, row, col);
        const vector = extractTileVector(imageData, tileRect, 10);
        const match = findBestCentroid(vector, labelCentroids);
        if (match) {
          labelMap.set(`${row}:${col}`, { row, col, label: match.label });
          if (match.label === "unknown") {
            unknown += 1;
          } else {
            assigned += 1;
          }
        } else {
          labelMap.set(`${row}:${col}`, { row, col, label: "unknown" });
          unknown += 1;
        }
      }
    }
    drawOverlay();
    setLabelerStatus([`Auto-label complete. ${assigned} labeled, ${unknown} unknown.`]);
  })();
}
