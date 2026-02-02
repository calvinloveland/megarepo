import "./style.css";
import type { Annotation, BoardSpec, Point, Rect } from "./types";
import { getTileRect } from "./image";
import { solveBoard } from "./solver";

const fileInput = document.querySelector<HTMLInputElement>("#fileInput");
const rowsInput = document.querySelector<HTMLInputElement>("#rowsInput");
const colsInput = document.querySelector<HTMLInputElement>("#colsInput");
const selectBoardButton = document.querySelector<HTMLButtonElement>("#selectBoardButton");
const runSolverButton = document.querySelector<HTMLButtonElement>("#runSolverButton");
const exportButton = document.querySelector<HTMLButtonElement>("#exportButton");
const imageCanvas = document.querySelector<HTMLCanvasElement>("#imageCanvas");
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlayCanvas");
const statusList = document.querySelector<HTMLUListElement>("#statusList");

if (
  !fileInput ||
  !rowsInput ||
  !colsInput ||
  !selectBoardButton ||
  !runSolverButton ||
  !exportButton ||
  !imageCanvas ||
  !overlayCanvas ||
  !statusList
) {
  throw new Error("Missing required DOM elements.");
}

const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
const overlayCtx = overlayCanvas.getContext("2d");

if (!imageCtx || !overlayCtx) {
  throw new Error("Canvas context unavailable.");
}

let currentImage: HTMLImageElement | null = null;
let boardBounds: Rect | null = null;
let selectionPoints: Point[] = [];
let annotations: Annotation[] = [];

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  const image = await loadImageFromFile(file);
  currentImage = image;
  drawBaseImage(image);
  resetBoardSelection();
  setStatus(["Screenshot loaded. Select board bounds."]);
});

selectBoardButton.addEventListener("click", () => {
  if (!currentImage) {
    setStatus(["Upload a screenshot first."]);
    return;
  }
  selectionPoints = [];
  boardBounds = null;
  annotations = [];
  drawOverlay();
  setStatus(["Click top-left and bottom-right corners of the board."]);
});

overlayCanvas.addEventListener("click", (event) => {
  if (!currentImage) {
    return;
  }
  const point = getCanvasPoint(event, overlayCanvas);
  selectionPoints.push(point);
  if (selectionPoints.length === 2) {
    boardBounds = normalizeRect(selectionPoints[0], selectionPoints[1]);
    selectionPoints = [];
    drawOverlay();
    runSolverButton.disabled = false;
    exportButton.disabled = false;
    setStatus(["Board bounds set. Run solver to annotate."]);
  } else {
    drawOverlay();
  }
});

runSolverButton.addEventListener("click", () => {
  if (!currentImage || !boardBounds) {
    setStatus(["Select board bounds before running solver."]);
    return;
  }
  const rows = parseInt(rowsInput.value, 10);
  const cols = parseInt(colsInput.value, 10);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 1 || cols <= 1) {
    setStatus(["Rows/columns must be valid numbers."]);
    return;
  }
  const boardSpec: BoardSpec = { rows, cols, bounds: boardBounds };
  const imageData = imageCtx.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
  const result = solveBoard(imageData, boardSpec);
  annotations = result.annotations;
  drawOverlay();
  const slugCount = result.slugTiles.filter((tile) => tile.slugLie).length;
  setStatus([
    `Solver ran. Slug-border tiles detected: ${slugCount}.`,
    "Next step: classify numbers and dust bunnies."]);
});

exportButton.addEventListener("click", () => {
  if (!currentImage) {
    return;
  }
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
  link.download = "broomsweeper-annotated.png";
  link.click();
});

function drawBaseImage(image: HTMLImageElement): void {
  imageCanvas.width = image.naturalWidth;
  imageCanvas.height = image.naturalHeight;
  overlayCanvas.width = image.naturalWidth;
  overlayCanvas.height = image.naturalHeight;
  imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  imageCtx.drawImage(image, 0, 0);
  drawOverlay();
  runSolverButton.disabled = true;
  exportButton.disabled = true;
}

function drawOverlay(): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (boardBounds) {
    overlayCtx.strokeStyle = "#22c55e";
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(boardBounds.x, boardBounds.y, boardBounds.width, boardBounds.height);

    const rows = parseInt(rowsInput.value, 10);
    const cols = parseInt(colsInput.value, 10);
    if (rows > 1 && cols > 1) {
      drawGrid(boardBounds, rows, cols);
      drawAnnotations(boardBounds, rows, cols, annotations);
    }
  }

  if (selectionPoints.length === 1) {
    overlayCtx.fillStyle = "rgba(59, 130, 246, 0.7)";
    overlayCtx.beginPath();
    overlayCtx.arc(selectionPoints[0].x, selectionPoints[0].y, 6, 0, Math.PI * 2);
    overlayCtx.fill();
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

function resetBoardSelection(): void {
  boardBounds = null;
  selectionPoints = [];
  annotations = [];
  runSolverButton.disabled = true;
  exportButton.disabled = true;
}

function setStatus(messages: string[]): void {
  statusList.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    statusList.appendChild(item);
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
