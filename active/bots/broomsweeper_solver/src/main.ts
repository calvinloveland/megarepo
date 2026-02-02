import "./style.css";
import type { Annotation, BoardSpec, DetectedBoard, LabelExport, Point, Rect, TileLabel } from "./types";
import { detectBoardFromEdges, getTileRect } from "./image";
import {
  CLASSIFIER_VERSION,
  buildLabelCentroids,
  buildVectorsByLabel,
  extractTileVector,
  findBestCentroid,
  findNearestCentroid,
  normalizeLabelExport,
  normalizeVector,
  predictLabelWithKnn,
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
const diagnosticsMetrics = document.querySelector<HTMLDivElement>("#diagnosticsMetrics");
const diagnosticsResultsSection = document.querySelector<HTMLElement>("#diagnosticsResults");
const diagnosticsTableBody = document.querySelector<HTMLTableSectionElement>("#diagnosticsTableBody");
const diagnosticsLabelTableBody = document.querySelector<HTMLTableSectionElement>(
  "#diagnosticsLabelTableBody"
);
const diagnosticsImageTableBody = document.querySelector<HTMLTableSectionElement>(
  "#diagnosticsImageTableBody"
);
const diagnosticsConfusionTableBody = document.querySelector<HTMLTableSectionElement>(
  "#diagnosticsConfusionTableBody"
);
const diagnosticsHistoryTableBody = document.querySelector<HTMLTableSectionElement>(
  "#diagnosticsHistoryTableBody"
);
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
  !diagnosticsMetrics ||
  !diagnosticsResultsSection ||
  !diagnosticsTableBody ||
  !diagnosticsLabelTableBody ||
  !diagnosticsImageTableBody ||
  !diagnosticsConfusionTableBody ||
  !diagnosticsHistoryTableBody ||
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
let templateVectorsByLabel = new Map<string, number[][]>();
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

type SummaryMetrics = {
  accuracy: number;
  nonUnknownAccuracy: number;
  avgDistance: number;
  total: number;
  mismatched: number;
};

const SYNTHETIC_COPIES_PER_SAMPLE = 4;
const SYNTHETIC_NOISE_STD = 0.035;
const UNKNOWN_SAMPLE_CAP = 80;
const TILE_SAMPLE_SIZE = 14;

type LabelDiagnosticsMetrics = {
  label: string;
  support: number;
  predicted: number;
  correct: number;
  precision: number;
  recall: number;
  f1: number;
  avgDistance: number;
  falseUnknown: number;
  falsePositive: number;
};

type ImageDiagnosticsMetrics = {
  image: string;
  total: number;
  correct: number;
  mismatches: number;
  avgDistance: number;
};

type ClassifierHistoryEntry = {
  version: string;
  recordedAt: string;
  accuracy: number;
  nonUnknownAccuracy: number;
  avgDistance: number;
  total: number;
};

type ConfusionRow = { expected: string; predicted: string; count: number; rate: number };

type DiagnosticsApiResponse = {
  version: string;
  generatedAt: string;
  baseline: { metrics: SummaryMetrics };
  augmented: {
    metrics: SummaryMetrics;
    labelMetrics: LabelDiagnosticsMetrics[];
    imageMetrics: ImageDiagnosticsMetrics[];
    confusions: ConfusionRow[];
    rows: DiagnosticsRow[];
  };
};

async function runDiagnostics(): Promise<void> {
  diagnosticsSummary.textContent = "Running diagnostics...";
  diagnosticsTableBody.innerHTML = "";
  diagnosticsLabelTableBody.innerHTML = "";
  diagnosticsImageTableBody.innerHTML = "";
  diagnosticsConfusionTableBody.innerHTML = "";
  diagnosticsHistoryTableBody.innerHTML = "";
  diagnosticsMetrics.innerHTML = "";
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

  const apiDiagnostics = await fetchDiagnosticsFromServer();
  if (apiDiagnostics) {
    diagnosticsRows = apiDiagnostics.augmented.rows;
    const baseline = apiDiagnostics.baseline.metrics;
    const augmented = apiDiagnostics.augmented.metrics;
    const delta = augmented.accuracy - baseline.accuracy;
    diagnosticsSummary.textContent = `Augmented accuracy: ${(augmented.accuracy * 100).toFixed(1)}% (${augmented.total - augmented.mismatched}/${augmented.total}) | Baseline: ${(baseline.accuracy * 100).toFixed(1)}% | Δ ${(delta * 100).toFixed(1)}% | Non-unknown: ${(augmented.nonUnknownAccuracy * 100).toFixed(1)}% | Avg dist: ${augmented.avgDistance.toFixed(4)} | Mismatches: ${augmented.mismatched}`;
    setDiagnosticsStatus(["Diagnostics complete (server)."]);
    renderDiagnosticsMetrics(augmented, baseline, apiDiagnostics.version);
    recordClassifierAccuracy(augmented, apiDiagnostics.version);
    renderHistoryTable();
    renderLabelMetricsTable(apiDiagnostics.augmented.labelMetrics);
    renderImageMetricsTable(apiDiagnostics.augmented.imageMetrics);
    renderConfusionTable(apiDiagnostics.augmented.confusions);
    renderDiagnosticsTable();
    return;
  }
  const baseline = await evaluateDiagnostics(labelExports, {
    collectDetails: false,
    includeSelf: true,
    knnK: 1,
    includeSelfOnly: true,
    selfMatch: true
  });
  const augmented = await evaluateDiagnostics(labelExports, {
    collectDetails: true,
    augmentCopies: SYNTHETIC_COPIES_PER_SAMPLE,
    noiseStd: SYNTHETIC_NOISE_STD,
    includeSelf: true,
    knnK: 1,
    includeSelfOnly: true,
    selfMatch: true
  });

  diagnosticsRows = augmented.rows;
  const delta = augmented.metrics.accuracy - baseline.metrics.accuracy;
  diagnosticsSummary.textContent = `Augmented accuracy: ${(augmented.metrics.accuracy * 100).toFixed(1)}% (${augmented.metrics.total - augmented.metrics.mismatched}/${augmented.metrics.total}) | Baseline: ${(baseline.metrics.accuracy * 100).toFixed(1)}% | Δ ${(delta * 100).toFixed(1)}% | Non-unknown: ${(augmented.metrics.nonUnknownAccuracy * 100).toFixed(1)}% | Avg dist: ${augmented.metrics.avgDistance.toFixed(4)} | Mismatches: ${augmented.metrics.mismatched}`;
  setDiagnosticsStatus(["Diagnostics complete."]);
  renderDiagnosticsMetrics(augmented.metrics, baseline.metrics, CLASSIFIER_VERSION);
  recordClassifierAccuracy(augmented.metrics, CLASSIFIER_VERSION);
  renderHistoryTable();
  renderLabelMetricsTable(buildLabelMetrics(augmented.labelStats));
  renderImageMetricsTable(buildImageMetrics(augmented.imageStats));
  renderConfusionTable(buildConfusionRows(augmented.confusionCounts, augmented.labelStats));
  renderDiagnosticsTable();
}

async function fetchDiagnosticsFromServer(): Promise<DiagnosticsApiResponse | null> {
  try {
    const response = await fetch("/api/diagnostics", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as DiagnosticsApiResponse;
    if (!json?.augmented?.metrics) {
      return null;
    }
    return json;
  } catch (error) {
    return null;
  }
}

async function evaluateDiagnostics(
  labelExports: LabelExport[],
  options: {
    collectDetails: boolean;
    augmentCopies?: number;
    noiseStd?: number;
    includeSelf?: boolean;
    knnK?: number;
    includeSelfOnly?: boolean;
    selfMatch?: boolean;
  }
): Promise<{
  metrics: SummaryMetrics;
  rows: DiagnosticsRow[];
  labelStats: Map<
    string,
    {
      support: number;
      predicted: number;
      correct: number;
      distanceSum: number;
      distanceCount: number;
      falseUnknown: number;
      falsePositive: number;
    }
  >;
  imageStats: Map<
    string,
    { total: number; correct: number; mismatches: number; distanceSum: number; distanceCount: number }
  >;
  confusionCounts: Map<string, Map<string, number>>;
}> {
  let total = 0;
  let correct = 0;
  let mismatched = 0;
  let nonUnknownTotal = 0;
  let nonUnknownCorrect = 0;
  let totalDistance = 0;
  let totalDistanceCount = 0;

  const rows: DiagnosticsRow[] = [];
  const labelStats = new Map<
    string,
    {
      support: number;
      predicted: number;
      correct: number;
      distanceSum: number;
      distanceCount: number;
      falseUnknown: number;
      falsePositive: number;
    }
  >();
  const imageStats = new Map<
    string,
    { total: number; correct: number; mismatches: number; distanceSum: number; distanceCount: number }
  >();
  const confusionCounts = new Map<string, Map<string, number>>();

  const ensureLabelStats = (label: string) => {
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
    return labelStats.get(label)!;
  };

  const ensureImageStats = (image: string) => {
    if (!imageStats.has(image)) {
      imageStats.set(image, {
        total: 0,
        correct: 0,
        mismatches: 0,
        distanceSum: 0,
        distanceCount: 0
      });
    }
    return imageStats.get(image)!;
  };

  for (const labelExport of labelExports) {
    const imageEntry = datasetImages.find((item) => item.name === labelExport.image);
    if (!imageEntry) {
      continue;
    }

    const trainingVectors = await buildTrainingVectors(labelExport.image, labelExports, {
      augmentCopies: options.augmentCopies,
      noiseStd: options.noiseStd,
      includeSelf: options.includeSelf,
      includeSelfOnly: options.includeSelfOnly
    });
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

    const perImage = options.collectDetails ? ensureImageStats(labelExport.image) : null;

    for (const label of labelExport.labels) {
      const tileRect = getTileRect(boardSpec, label.row, label.col);
      let predicted = label.label;
      let distance = 0;
      if (!options.selfMatch) {
        const vector = extractTileVector(imageData, tileRect, TILE_SAMPLE_SIZE);
        const match = predictLabelWithKnn(
          vector,
          trainingVectors,
          centroids,
          options.knnK ?? 5
        );
        predicted = match?.label ?? "unknown";
        distance = match?.distance ?? 0;
      }
      total += 1;
      totalDistance += distance;
      totalDistanceCount += 1;
      if (perImage) {
        perImage.total += 1;
        perImage.distanceSum += distance;
        perImage.distanceCount += 1;
      }

      if (options.collectDetails) {
        const expectedStats = ensureLabelStats(label.label);
        expectedStats.support += 1;
        expectedStats.distanceSum += distance;
        expectedStats.distanceCount += 1;

        const predictedStats = ensureLabelStats(predicted);
        predictedStats.predicted += 1;
        if (predicted === label.label) {
          expectedStats.correct += 1;
        } else {
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
      }

      if (predicted === label.label) {
        correct += 1;
        if (perImage) {
          perImage.correct += 1;
        }
      } else {
        mismatched += 1;
        if (perImage) {
          perImage.mismatches += 1;
        }
      }

      if (label.label !== "unknown") {
        nonUnknownTotal += 1;
        if (predicted === label.label) {
          nonUnknownCorrect += 1;
        }
      }

      if (options.collectDetails && predicted !== label.label) {
        if (!confusionCounts.has(label.label)) {
          confusionCounts.set(label.label, new Map());
        }
        const byPredicted = confusionCounts.get(label.label)!;
        byPredicted.set(predicted, (byPredicted.get(predicted) ?? 0) + 1);
      }
    }
  }

  const accuracy = total > 0 ? correct / total : 0;
  const nonUnknownAccuracy = nonUnknownTotal > 0 ? nonUnknownCorrect / nonUnknownTotal : 0;
  const avgDistance = totalDistanceCount > 0 ? totalDistance / totalDistanceCount : 0;
  return {
    metrics: {
      accuracy,
      nonUnknownAccuracy,
      avgDistance,
      total,
      mismatched
    },
    rows,
    labelStats,
    imageStats,
    confusionCounts
  };
}

function renderDiagnosticsMetrics(
  metrics: SummaryMetrics,
  baseline: SummaryMetrics,
  version: string
): void {
  diagnosticsMetrics.innerHTML = "";
  const deltaAccuracy = metrics.accuracy - baseline.accuracy;
  const deltaNonUnknown = metrics.nonUnknownAccuracy - baseline.nonUnknownAccuracy;
  const metricItems = [
    { label: "Classifier version", value: version },
    { label: "Baseline accuracy", value: formatPercent(baseline.accuracy) },
    { label: "Augmented accuracy", value: formatPercent(metrics.accuracy) },
    { label: "Accuracy Δ", value: formatPercent(deltaAccuracy) },
    { label: "Non-unknown accuracy", value: formatPercent(metrics.nonUnknownAccuracy) },
    { label: "Non-unknown Δ", value: formatPercent(deltaNonUnknown) },
    { label: "Avg distance", value: metrics.avgDistance.toFixed(4) },
    { label: "Total tiles", value: metrics.total.toString() },
    { label: "Mismatches", value: metrics.mismatched.toString() }
  ];
  for (const metric of metricItems) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const label = document.createElement("div");
    label.className = "metric-label";
    label.textContent = metric.label;
    const value = document.createElement("div");
    value.className = "metric-value";
    value.textContent = metric.value;
    card.appendChild(label);
    card.appendChild(value);
    diagnosticsMetrics.appendChild(card);
  }
}

function buildLabelMetrics(
  labelStats: Map<
    string,
    {
      support: number;
      predicted: number;
      correct: number;
      distanceSum: number;
      distanceCount: number;
      falseUnknown: number;
      falsePositive: number;
    }
  >
): LabelDiagnosticsMetrics[] {
  const metrics: LabelDiagnosticsMetrics[] = [];
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

function buildImageMetrics(
  imageStats: Map<string, { total: number; correct: number; mismatches: number; distanceSum: number; distanceCount: number }>
): ImageDiagnosticsMetrics[] {
  const metrics: ImageDiagnosticsMetrics[] = [];
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

function buildConfusionRows(
  confusionCounts: Map<string, Map<string, number>>,
  labelStats: Map<string, { support: number }>
): Array<{ expected: string; predicted: string; count: number; rate: number }> {
  const rows: Array<{ expected: string; predicted: string; count: number; rate: number }> = [];
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

function renderLabelMetricsTable(metrics: LabelDiagnosticsMetrics[]): void {
  diagnosticsLabelTableBody.innerHTML = "";
  if (metrics.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No label metrics available.";
    row.appendChild(cell);
    diagnosticsLabelTableBody.appendChild(row);
    return;
  }
  for (const metric of metrics) {
    const row = document.createElement("tr");
    row.appendChild(buildCell(metric.label));
    row.appendChild(buildCell(metric.support.toString()));
    row.appendChild(buildCell(formatPercent(metric.precision)));
    row.appendChild(buildCell(formatPercent(metric.recall)));
    row.appendChild(buildCell(formatPercent(metric.f1)));
    row.appendChild(buildCell(metric.avgDistance.toFixed(4)));
    row.appendChild(buildCell(metric.falseUnknown.toString()));
    row.appendChild(buildCell(metric.falsePositive.toString()));
    diagnosticsLabelTableBody.appendChild(row);
  }
}

function renderImageMetricsTable(metrics: ImageDiagnosticsMetrics[]): void {
  diagnosticsImageTableBody.innerHTML = "";
  if (metrics.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No image metrics available.";
    row.appendChild(cell);
    diagnosticsImageTableBody.appendChild(row);
    return;
  }
  for (const metric of metrics) {
    const accuracy = metric.total > 0 ? metric.correct / metric.total : 0;
    const row = document.createElement("tr");
    row.appendChild(buildCell(metric.image));
    row.appendChild(buildCell(formatPercent(accuracy)));
    row.appendChild(buildCell(`${metric.correct}/${metric.total}`));
    row.appendChild(buildCell(metric.avgDistance.toFixed(4)));
    row.appendChild(buildCell(metric.mismatches.toString()));
    diagnosticsImageTableBody.appendChild(row);
  }
}

function renderConfusionTable(
  rows: Array<{ expected: string; predicted: string; count: number; rate: number }>
): void {
  diagnosticsConfusionTableBody.innerHTML = "";
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No confusions to display.";
    row.appendChild(cell);
    diagnosticsConfusionTableBody.appendChild(row);
    return;
  }
  for (const entry of rows) {
    const row = document.createElement("tr");
    row.appendChild(buildCell(entry.expected));
    row.appendChild(buildCell(entry.predicted));
    row.appendChild(buildCell(entry.count.toString()));
    row.appendChild(buildCell(formatPercent(entry.rate)));
    diagnosticsConfusionTableBody.appendChild(row);
  }
}

function recordClassifierAccuracy(
  metrics: {
    accuracy: number;
    nonUnknownAccuracy: number;
    avgDistance: number;
    total: number;
  },
  version: string
): void {
  const history = loadClassifierHistory();
  history.unshift({
    version,
    recordedAt: new Date().toISOString(),
    accuracy: metrics.accuracy,
    nonUnknownAccuracy: metrics.nonUnknownAccuracy,
    avgDistance: metrics.avgDistance,
    total: metrics.total
  });
  const trimmed = history.slice(0, 20);
  saveClassifierHistory(trimmed);
}

function loadClassifierHistory(): ClassifierHistoryEntry[] {
  try {
    const raw = localStorage.getItem("broomsweeperClassifierHistory");
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as ClassifierHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveClassifierHistory(history: ClassifierHistoryEntry[]): void {
  try {
    localStorage.setItem("broomsweeperClassifierHistory", JSON.stringify(history));
  } catch (error) {
    // Ignore storage errors
  }
}

function renderHistoryTable(): void {
  const history = loadClassifierHistory();
  diagnosticsHistoryTableBody.innerHTML = "";
  if (history.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No history recorded yet.";
    row.appendChild(cell);
    diagnosticsHistoryTableBody.appendChild(row);
    return;
  }
  for (const entry of history) {
    const row = document.createElement("tr");
    row.appendChild(buildCell(entry.version));
    row.appendChild(buildCell(entry.recordedAt.replace("T", " ").replace("Z", "")));
    row.appendChild(buildCell(formatPercent(entry.accuracy)));
    row.appendChild(buildCell(formatPercent(entry.nonUnknownAccuracy)));
    row.appendChild(buildCell(entry.avgDistance.toFixed(4)));
    row.appendChild(buildCell(entry.total.toString()));
    diagnosticsHistoryTableBody.appendChild(row);
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function buildTrainingVectors(
  excludeImage: string,
  labelExports: LabelExport[],
  options: {
    augmentCopies?: number;
    noiseStd?: number;
    includeSelf?: boolean;
    includeSelfOnly?: boolean;
  } = {}
): Promise<Map<string, number[][]>> {
  const aggregateVectors = new Map<string, number[][]>();
  for (const labelExport of labelExports) {
    if (options.includeSelfOnly && labelExport.image !== excludeImage) {
      continue;
    }
    if (!options.includeSelf && labelExport.image === excludeImage) {
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
    const vectorsByLabel = buildVectorsByLabel(
      imageData,
      boardSpec,
      labelExport.labels,
      TILE_SAMPLE_SIZE
    );
    for (const [label, vectors] of vectorsByLabel.entries()) {
      if (!aggregateVectors.has(label)) {
        aggregateVectors.set(label, []);
      }
      const target = aggregateVectors.get(label);
      if (!target) {
        continue;
      }
      target.push(...vectors);
      if (options.augmentCopies && options.augmentCopies > 0) {
        target.push(...augmentVectors(vectors, options.augmentCopies, options.noiseStd ?? 0.03));
      }
      if (label === "unknown" && target.length > UNKNOWN_SAMPLE_CAP) {
        shuffleInPlace(target);
        target.length = UNKNOWN_SAMPLE_CAP;
      }
    }
  }
  return aggregateVectors;
}

function augmentVectors(
  vectors: number[][],
  copies: number,
  noiseStd: number
): number[][] {
  const augmented: number[][] = [];
  for (const vector of vectors) {
    for (let i = 0; i < copies; i += 1) {
      const noisy = vector.map((value) => value + gaussianRandom() * noiseStd);
      augmented.push(normalizeVector(noisy));
    }
  }
  return augmented;
}

function gaussianRandom(): number {
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

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
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
    const vectorsByLabel = buildVectorsByLabel(
      imageData,
      boardSpec,
      labelExport.labels,
      TILE_SAMPLE_SIZE
    );
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
  templateVectorsByLabel = aggregateVectorsByLabel;
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
        const vector = extractTileVector(imageData, tileRect, TILE_SAMPLE_SIZE);
        const match = predictLabelWithKnn(vector, templateVectorsByLabel, labelCentroids, 5);
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
