import * as Core from './sim-core.mjs';
import { createErrorLogger } from './vendor/browser-error-logger.js';

const GRID_SIZE = Core.GRID_SIZE;
const CELL_COUNT = Core.CELL_COUNT;
const GRID_CENTER = Core.GRID_CENTER;
const MAX_DEPTH = Core.MAX_DEPTH;
const BASE_TEMPERATURE = Core.BASE_TEMPERATURE;
const DEFAULT_GAS_MASS = Core.DEFAULT_GAS_MASS;
const DEFAULT_LIQUID_MASS = Core.DEFAULT_LIQUID_MASS;
const AMBIENT_PRESSURE = Core.AMBIENT_PRESSURE;
const GAS_CONSTANT = Core.GAS_CONSTANT;
const ACTIVITY_EXPAND_THRESHOLD = Core.ACTIVITY_EXPAND_THRESHOLD;
const ACTIVITY_COLLAPSE_THRESHOLD = Core.ACTIVITY_COLLAPSE_THRESHOLD;
const MIN_CHILD_AGE = Core.MIN_CHILD_AGE;
const COLORS = {
  background: '#091525',
  grid: 'rgba(141, 185, 227, 0.18)',
  gridStrong: 'rgba(170, 214, 255, 0.45)',
  text: '#eaf4ff',
  muted: '#8eb1d0',
  hot: '#ff7a59',
  cold: '#67d0ff',
  liquid: '#2f8cff',
  gas: '#97e1ff',
  wall: '#8892a7',
  wheel: '#f6d36f',
  activeOutline: 'rgba(255, 255, 255, 0.85)',
  nested: 'rgba(189, 133, 255, 0.6)',
};

const FLUIDS = Core.FLUIDS;
const MATERIALS = Core.MATERIALS;

const ui = {
  canvas: document.getElementById('sandboxCanvas'),
  playPauseButton: document.getElementById('playPauseButton'),
  stepButton: document.getElementById('stepButton'),
  resetButton: document.getElementById('resetButton'),
  speedSlider: document.getElementById('speedSlider'),
  powerSlider: document.getElementById('powerSlider'),
  powerValue: document.getElementById('powerValue'),
  gravitySlider: document.getElementById('gravitySlider'),
  gravityValue: document.getElementById('gravityValue'),
  autoHierarchyToggle: document.getElementById('autoHierarchyToggle'),
  autoCollapseToggle: document.getElementById('autoCollapseToggle'),
  fluidSelect: document.getElementById('fluidSelect'),
  materialSelect: document.getElementById('materialSelect'),
  renderModeSelect: document.getElementById('renderModeSelect'),
  tickReadout: document.getElementById('tickReadout'),
  hierarchyReadout: document.getElementById('hierarchyReadout'),
  viewTitle: document.getElementById('viewTitle'),
  selectionLabel: document.getElementById('selectionLabel'),
  globalStats: document.getElementById('globalStats'),
  cellStats: document.getElementById('cellStats'),
  inspectorEmpty: document.getElementById('inspectorEmpty'),
  inspectorPath: document.getElementById('inspectorPath'),
  enterButton: document.getElementById('enterButton'),
  backButton: document.getElementById('backButton'),
  statusLine: document.getElementById('statusLine'),
  canvasWrapper: document.querySelector('.canvas-wrapper'),
  canvasToolbar: document.getElementById('canvasToolbar'),
  toggleToolbarButton: document.getElementById('toggleToolbarButton'),
  toolbarButtons: document.getElementById('toolbarButtons'),
  workspaceTabs: document.querySelectorAll('[data-workspace-tab]'),
  workspacePanels: document.querySelectorAll('[data-workspace-panel]'),
  feedbackForms: document.getElementById('feedbackForms'),
  feedbackStatus: document.getElementById('feedbackStatus'),
  submitAllFeedbackButton: document.getElementById('submitAllFeedbackButton'),
  telemetryToggle: document.getElementById('telemetryToggle'),
  blueprintName: document.getElementById('blueprintName'),
  saveBlueprintButton: document.getElementById('saveBlueprintButton'),
  loadBlueprintSelect: document.getElementById('loadBlueprintSelect'),
  deleteBlueprintButton: document.getElementById('deleteBlueprintButton'),
};

const ctx = ui.canvas.getContext('2d');

const state = {
  rootGrid: null,
  currentGrid: null,
  gridPath: [],
  selectedCell: null,
  selectedTool: 'liquid',
  running: true,
  ticksPerFrame: Number(ui.speedSlider.value),
  externalPower: Number(ui.powerSlider.value),
  gravity: Number(ui.gravitySlider.value) / 100,
  autoExpand: ui.autoHierarchyToggle.checked,
  autoCollapse: ui.autoCollapseToggle.checked,
  renderMode: ui.renderModeSelect.value,
  tick: 0,
  powerFactor: 1,
  generatedPower: 0,
  usedPower: 0,
  totalDemand: 0,
  maxDepthObserved: 1,
  dragging: false,
  animationHandle: null,
  lastTimestamp: 0,
  lastUiRefresh: 0,
  selectedPreset: 'pump',
  activeWorkspace: 'sandbox',
  feedbackStore: {},
  toolbarVisible: true,
  telemetryVisible: false,
  undoStack: [],
  redoStack: [],
};

const FEEDBACK_API = '/api/feedback';
const FEEDBACK_COMPONENTS = [
  {
    id: 'viewport',
    name: 'Viewport / canvas',
    prompt: 'Comment on readability, motion, and whether the sandbox itself communicates what the machine is doing.',
  },
  {
    id: 'wheel-visual',
    name: 'Wheel visual',
    prompt: 'Comment on whether wheel direction, reach, and energy transfer are understandable.',
  },
  {
    id: 'nested-grid-preview',
    name: 'Nested-grid preview',
    prompt: 'Comment on whether subdivided cells preview clearly and help you decide when to drill in.',
  },
  {
    id: 'simulation-controls',
    name: 'Simulation controls',
    prompt: 'Comment on play, pause, step, speed, gravity, and power controls.',
  },
  {
    id: 'build-tools',
    name: 'Build tools',
    prompt: 'Comment on painting gas, liquid, heat, walls, and wheels.',
  },
  {
    id: 'presets',
    name: 'Preset buttons',
    prompt: 'Comment on whether the starter machines are understandable and useful.',
  },
  {
    id: 'telemetry',
    name: 'Telemetry panel',
    prompt: 'Comment on whether the global stats help or feel noisy.',
  },
  {
    id: 'inspector',
    name: 'Cell inspector',
    prompt: 'Comment on whether the selected-cell details are useful and readable.',
  },
  {
    id: 'mobile-layout',
    name: 'Mobile layout',
    prompt: 'Comment on spacing, button sizes, scrolling, and whether the mobile experience feels comfortable.',
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(lerp(a.r, b.r, t))}, ${Math.round(lerp(a.g, b.g, t))}, ${Math.round(lerp(a.b, b.b, t))})`;
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function indexToCoord(index) {
  return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
}

function coordToIndex(x, y) {
  return y * GRID_SIZE + x;
}

function createLeafCell(overrides = {}) {
  const fluidType = overrides.fluidType ?? 'air';
  return {
    gasMass: overrides.gasMass ?? DEFAULT_GAS_MASS,
    liquidMass: overrides.liquidMass ?? 0,
    temperature: overrides.temperature ?? BASE_TEMPERATURE,
    pressure: overrides.pressure ?? AMBIENT_PRESSURE,
    velocityX: overrides.velocityX ?? 0,
    velocityY: overrides.velocityY ?? 0,
    materialType: overrides.materialType ?? 'void',
    fluidType,
    wheel: overrides.wheel ? { ...overrides.wheel } : null,
    childGrid: null,
    activity: overrides.activity ?? 0,
    aggregateDepth: 1,
    quietAge: 0,
    phaseShift: 0,
  };
}

function createGrid(level = 0, parentCell = null) {
  return {
    level,
    parentCell,
    cells: Array.from({ length: CELL_COUNT }, () => createLeafCell()),
  };
}

function cloneWheel(wheel) {
  return wheel ? { powered: wheel.powered, direction: wheel.direction, spin: wheel.spin ?? 0, torque: wheel.torque ?? 0, wheelAngle: wheel.wheelAngle ?? 0 } : null;
}

function createChildGridFromCell(cell, level) {
  const childGrid = createGrid(level + 1, cell);
  for (const child of childGrid.cells) {
    child.gasMass = cell.gasMass / CELL_COUNT;
    child.liquidMass = cell.liquidMass / CELL_COUNT;
    child.temperature = cell.temperature;
    child.pressure = cell.pressure;
    child.velocityX = cell.velocityX;
    child.velocityY = cell.velocityY;
    child.materialType = cell.materialType;
    child.fluidType = cell.fluidType;
    child.wheel = cloneWheel(cell.wheel);
    child.activity = cell.activity * 0.5;
  }
  cell.childGrid = childGrid;
  if (cell.wheel) {
    const centerIndex = coordToIndex(GRID_CENTER, GRID_CENTER);
    childGrid.cells.forEach((child, index) => {
      child.wheel = index === centerIndex ? cloneWheel(cell.wheel) : null;
    });
    cell.wheel = null;
  }
  return childGrid;
}

function collapseChildGrid(cell) {
  if (!cell.childGrid) return;
  aggregateCellFromChildren(cell);
  cell.childGrid = null;
}

function aggregateCellFromChildren(cell) {
  if (!cell.childGrid) return cell;
  let gasMass = 0;
  let liquidMass = 0;
  let temperature = 0;
  let pressure = 0;
  let velocityX = 0;
  let velocityY = 0;
  let activity = 0;
  let aggregateDepth = 1;
  let dominantSolid = null;
  const materialWeights = new Map();
  const fluidWeights = new Map();
  let wheelWinner = null;
  let wheelSpin = 0;
  let wheelTorque = 0;
  let wheelCount = 0;

  for (const child of cell.childGrid.cells) {
    gasMass += child.gasMass;
    liquidMass += child.liquidMass;
    temperature += child.temperature;
    pressure += child.pressure;
    velocityX += child.velocityX;
    velocityY += child.velocityY;
    activity += child.activity;
    aggregateDepth = Math.max(aggregateDepth, child.aggregateDepth + 1);
    materialWeights.set(child.materialType, (materialWeights.get(child.materialType) ?? 0) + child.liquidMass + child.gasMass + 0.2);
    fluidWeights.set(child.fluidType, (fluidWeights.get(child.fluidType) ?? 0) + child.gasMass + child.liquidMass + 0.2);
    if (MATERIALS[child.materialType]?.solid) dominantSolid = child.materialType;
    if (child.wheel) {
      wheelWinner = child.wheel;
      wheelSpin += child.wheel.spin ?? 0;
      wheelTorque += child.wheel.torque ?? 0;
      wheelCount += 1;
      if (!wheelWinner.wheelAngle) wheelWinner.wheelAngle = child.wheel.wheelAngle ?? 0;
    }
  }

  const total = CELL_COUNT;
  cell.gasMass = gasMass;
  cell.liquidMass = liquidMass;
  cell.temperature = temperature / total;
  cell.pressure = pressure / total;
  cell.velocityX = velocityX / total;
  cell.velocityY = velocityY / total;
  cell.activity = activity / total;
  cell.aggregateDepth = aggregateDepth;
  cell.materialType = dominantSolid ?? pickDominantKey(materialWeights, 'void');
  cell.fluidType = pickDominantKey(fluidWeights, 'water');
  cell.wheel = wheelWinner
    ? {
        powered: wheelWinner.powered,
        direction: wheelWinner.direction,
        spin: wheelSpin / Math.max(1, wheelCount),
        torque: wheelTorque / Math.max(1, wheelCount),
        wheelAngle: wheelWinner.wheelAngle ?? 0,
      }
    : null;
  return cell;
}

function pickDominantKey(map, fallback) {
  let bestKey = fallback;
  let bestValue = -Infinity;
  for (const [key, value] of map.entries()) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}

function isSolid(cell) {
  return MATERIALS[cell.materialType]?.solid && !cell.wheel;
}

function isTraversable(cell) {
  return !isSolid(cell);
}

function ensureAggregate(grid) {
  for (const cell of grid.cells) {
    if (cell.childGrid) {
      ensureAggregate(cell.childGrid);
      aggregateCellFromChildren(cell);
    } else {
      updatePressure(cell);
      cell.aggregateDepth = 1;
    }
  }
}

function updatePressure(cell) {
  const fluid = FLUIDS[cell.fluidType] ?? FLUIDS.water;
  const temperatureFactor = clamp(cell.temperature / BASE_TEMPERATURE, 0.18, 3.2);
  const liquidFill = clamp(cell.liquidMass, 0, 1.4);
  const freeVolume = clamp(1 - liquidFill * 0.82, 0.08, 1.2);
  const gasTerm = (cell.gasMass * GAS_CONSTANT * temperatureFactor * fluid.gasThermalFactor) / freeVolume;
  const liquidCompression = Math.max(0, liquidFill - 0.9) * 12 * fluid.liquidThermalFactor;
  const kineticPressure = (Math.abs(cell.velocityX) + Math.abs(cell.velocityY)) * 0.08;
  cell.pressure = clamp(0.12 + gasTerm + liquidCompression + kineticPressure, 0.02, 18);
}

function computeGridActivity(grid) {
  let total = 0;
  for (const cell of grid.cells) total += cell.activity;
  return total / CELL_COUNT;
}

function applyPreset(name) {
  state.selectedPreset = name;
  const grid = createGrid(0, null);
  switch (name) {
    case 'blank':
      break;
    case 'pump':
      buildPumpPreset(grid);
      break;
    case 'compressor':
      buildCompressorPreset(grid);
      break;
    case 'turbine':
      buildTurbinePreset(grid);
      break;
    case 'refrigerator':
      buildRefrigeratorPreset(grid);
      break;
    case 'steam':
      buildSteamPreset(grid);
      break;
    default:
      buildPumpPreset(grid);
      break;
  }
  state.rootGrid = grid;
  state.currentGrid = grid;
  state.gridPath = [];
  state.selectedCell = null;
  state.tick = 0;
  state.generatedPower = 0;
  state.usedPower = 0;
  state.totalDemand = 0;
  ensureAggregate(state.rootGrid);
  updateUi();
  render();
}

function clearGridToVoid(grid) {
  for (const cell of grid.cells) {
    Object.assign(cell, createLeafCell({ fluidType: 'air', gasMass: DEFAULT_GAS_MASS, liquidMass: 0 }));
  }
}

function setWall(grid, x, y, materialType = 'steel', temperature = BASE_TEMPERATURE) {
  const cell = grid.cells[coordToIndex(x, y)];
  cell.materialType = materialType;
  cell.gasMass = 0.02;
  cell.liquidMass = 0;
  cell.temperature = temperature;
  cell.velocityX = 0;
  cell.velocityY = 0;
  cell.wheel = null;
  cell.fluidType = 'air';
}

function setFluid(grid, x, y, { fluidType = 'water', gasMass = DEFAULT_GAS_MASS, liquidMass = DEFAULT_LIQUID_MASS, temperature = BASE_TEMPERATURE, velocityX = 0, velocityY = 0 } = {}) {
  const cell = grid.cells[coordToIndex(x, y)];
  cell.materialType = 'void';
  cell.fluidType = fluidType;
  cell.gasMass = gasMass;
  cell.liquidMass = liquidMass;
  cell.temperature = temperature;
  cell.velocityX = velocityX;
  cell.velocityY = velocityY;
  cell.wheel = null;
}

function setWheel(grid, x, y, { powered = true, direction = 1, fluidType = 'water', gasMass = 0.25, liquidMass = 0.45, temperature = BASE_TEMPERATURE } = {}) {
  const cell = grid.cells[coordToIndex(x, y)];
  cell.materialType = 'void';
  cell.fluidType = fluidType;
  cell.gasMass = gasMass;
  cell.liquidMass = liquidMass;
  cell.temperature = temperature;
  cell.wheel = { powered, direction, spin: powered ? direction * 0.6 : 0, torque: 0, wheelAngle: 0 };
}

function outlineBox(grid, x0, y0, x1, y1, material = 'steel', temperature = BASE_TEMPERATURE) {
  for (let x = x0; x <= x1; x += 1) {
    setWall(grid, x, y0, material, temperature);
    setWall(grid, x, y1, material, temperature);
  }
  for (let y = y0; y <= y1; y += 1) {
    setWall(grid, x0, y, material, temperature);
    setWall(grid, x1, y, material, temperature);
  }
}

function subdivideCell(grid, x, y, seed) {
  const cell = grid.cells[coordToIndex(x, y)];
  const child = createChildGridFromCell(cell, grid.level);
  clearGridToVoid(child);
  seed(child);
  ensureAggregate(child);
  return child;
}

function seedRotorChamber(child, {
  fluidType,
  powered,
  direction,
  gasMass,
  liquidMass,
  temperature = BASE_TEMPERATURE,
  ringTemperature = temperature,
  ringVelocityX = 0,
  ringVelocityY = 0,
  walls = [],
  hotCells = [],
  coldCells = [],
} = {}) {
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (x === GRID_CENTER && y === GRID_CENTER) continue;
      setFluid(child, x, y, { fluidType, gasMass, liquidMass, temperature: ringTemperature, velocityX: ringVelocityX, velocityY: ringVelocityY });
    }
  }
  for (const [x, y, material = 'steel', temp = temperature] of walls) {
    setWall(child, x, y, material, temp);
  }
  for (const [x, y, temp] of hotCells) {
    child.cells[coordToIndex(x, y)].temperature = temp;
  }
  for (const [x, y, temp] of coldCells) {
    child.cells[coordToIndex(x, y)].temperature = temp;
  }
  setWheel(child, GRID_CENTER, GRID_CENTER, { powered, direction, fluidType, gasMass, liquidMass, temperature });
}

function buildPumpPreset(grid) {
  clearGridToVoid(grid);
  setWall(grid, 1, 0, 'steel');
  setWall(grid, 1, 2, 'steel');
  setFluid(grid, 0, 1, { fluidType: 'water', gasMass: 0.08, liquidMass: 0.95, temperature: BASE_TEMPERATURE - 4 });
  setFluid(grid, 2, 1, { fluidType: 'water', gasMass: 0.1, liquidMass: 0.88, temperature: BASE_TEMPERATURE + 2, velocityX: 0.35 });
  subdivideCell(grid, 1, 1, (child) => {
    seedRotorChamber(child, {
      fluidType: 'water',
      powered: true,
      direction: 1,
      gasMass: 0.08,
      liquidMass: 0.86,
      ringTemperature: BASE_TEMPERATURE,
      hotCells: [[2, 1, BASE_TEMPERATURE + 8]],
      coldCells: [[0, 1, BASE_TEMPERATURE - 6]],
    });
  });
}

function buildCompressorPreset(grid) {
  clearGridToVoid(grid);
  setWall(grid, 1, 0, 'copper', BASE_TEMPERATURE + 18);
  setWall(grid, 1, 2, 'copper', BASE_TEMPERATURE + 18);
  setFluid(grid, 0, 1, { fluidType: 'air', gasMass: 0.42, liquidMass: 0, temperature: BASE_TEMPERATURE - 10 });
  setFluid(grid, 2, 1, { fluidType: 'air', gasMass: 0.82, liquidMass: 0, temperature: BASE_TEMPERATURE + 28, velocityX: 0.25 });
  subdivideCell(grid, 1, 1, (child) => {
    seedRotorChamber(child, {
      fluidType: 'air',
      powered: true,
      direction: 1,
      gasMass: 0.62,
      liquidMass: 0,
      ringTemperature: BASE_TEMPERATURE + 4,
      hotCells: [[2, 1, BASE_TEMPERATURE + 26]],
      coldCells: [[0, 1, BASE_TEMPERATURE - 10]],
    });
  });
}

function buildTurbinePreset(grid) {
  clearGridToVoid(grid);
  setWall(grid, 1, 0, 'steel');
  setWall(grid, 1, 2, 'steel');
  setFluid(grid, 0, 1, { fluidType: 'air', gasMass: 0.82, liquidMass: 0, temperature: BASE_TEMPERATURE + 20, velocityX: 1.4 });
  setFluid(grid, 2, 1, { fluidType: 'air', gasMass: 0.36, liquidMass: 0, temperature: BASE_TEMPERATURE - 4, velocityX: 0.55 });
  subdivideCell(grid, 1, 1, (child) => {
    seedRotorChamber(child, {
      fluidType: 'air',
      powered: false,
      direction: 1,
      gasMass: 0.48,
      liquidMass: 0,
      ringTemperature: BASE_TEMPERATURE + 6,
      ringVelocityX: 0.9,
      hotCells: [[0, 1, BASE_TEMPERATURE + 26]],
    });
  });
}

function buildRefrigeratorPreset(grid) {
  clearGridToVoid(grid);
  setWall(grid, 1, 0, 'insulation', BASE_TEMPERATURE - 12);
  setWall(grid, 1, 2, 'copper', BASE_TEMPERATURE + 18);
  setFluid(grid, 0, 1, { fluidType: 'refrigerant', gasMass: 0.14, liquidMass: 0.82, temperature: BASE_TEMPERATURE - 16 });
  setFluid(grid, 2, 1, { fluidType: 'refrigerant', gasMass: 0.58, liquidMass: 0.08, temperature: BASE_TEMPERATURE + 20, velocityX: 0.2 });
  subdivideCell(grid, 1, 1, (child) => {
    seedRotorChamber(child, {
      fluidType: 'refrigerant',
      powered: true,
      direction: 1,
      gasMass: 0.24,
      liquidMass: 0.5,
      ringTemperature: BASE_TEMPERATURE,
      hotCells: [[2, 1, BASE_TEMPERATURE + 22]],
      coldCells: [[0, 1, BASE_TEMPERATURE - 18]],
      walls: [[1, 2, 'insulation', BASE_TEMPERATURE - 18]],
    });
  });
}

function buildSteamPreset(grid) {
  clearGridToVoid(grid);
  setWall(grid, 0, 1, 'copper', BASE_TEMPERATURE + 95);
  setWall(grid, 2, 1, 'steel', BASE_TEMPERATURE - 8);
  setFluid(grid, 1, 2, { fluidType: 'water', gasMass: 0.08, liquidMass: 0.98, temperature: BASE_TEMPERATURE + 110 });
  setFluid(grid, 1, 0, { fluidType: 'water', gasMass: 0.74, liquidMass: 0.04, temperature: BASE_TEMPERATURE + 20, velocityY: -0.85 });
  subdivideCell(grid, 1, 1, (child) => {
    seedRotorChamber(child, {
      fluidType: 'water',
      powered: false,
      direction: 1,
      gasMass: 0.54,
      liquidMass: 0.12,
      ringTemperature: BASE_TEMPERATURE + 35,
      ringVelocityY: -0.65,
      hotCells: [[1, 2, BASE_TEMPERATURE + 105]],
      coldCells: [[1, 0, BASE_TEMPERATURE + 12]],
    });
  });
}

function gatherLeafStats(grid, metrics = { mass: 0, pressure: 0, temperature: 0, wheelCount: 0, powered: 0, active: 0, leaves: 0, childGrids: 0, maxDepth: 1 }) {
  for (const cell of grid.cells) {
    metrics.maxDepth = Math.max(metrics.maxDepth, cell.aggregateDepth);
    if (cell.childGrid) {
      metrics.childGrids += 1;
      gatherLeafStats(cell.childGrid, metrics);
    } else {
      metrics.mass += cell.gasMass + cell.liquidMass;
      metrics.pressure += cell.pressure;
      metrics.temperature += cell.temperature;
      metrics.active += cell.activity;
      metrics.leaves += 1;
      if (cell.wheel) {
        metrics.wheelCount += 1;
        if (cell.wheel.powered) metrics.powered += 1;
      }
    }
  }
  return metrics;
}

function forEachGrid(grid, visitor) {
  visitor(grid);
  for (const cell of grid.cells) {
    if (cell.childGrid) forEachGrid(cell.childGrid, visitor);
  }
}

function simulationStep() {
  Core.simulationStep(state);
}

function simulateGrid(grid) {
  for (const cell of grid.cells) {
    if (cell.childGrid) continue;
    updatePressure(cell);
  }

  const gasDelta = new Array(CELL_COUNT).fill(0);
  const liquidDelta = new Array(CELL_COUNT).fill(0);
  const tempDelta = new Array(CELL_COUNT).fill(0);
  const vxDelta = new Array(CELL_COUNT).fill(0);
  const vyDelta = new Array(CELL_COUNT).fill(0);
  const activityDelta = new Array(CELL_COUNT).fill(0);

  const exchangePair = (aIndex, bIndex, orientation) => {
    const a = grid.cells[aIndex];
    const b = grid.cells[bIndex];

    const pressureDiff = a.pressure - b.pressure;
    const temperatureFlux = (a.temperature - b.temperature) * averageConductivity(a, b) * 0.024;
    tempDelta[aIndex] -= temperatureFlux;
    tempDelta[bIndex] += temperatureFlux;

    if (!isTraversable(a) || !isTraversable(b)) {
      const blockedActivity = Math.abs(temperatureFlux) * 0.04 + Math.abs(pressureDiff) * 0.01;
      activityDelta[aIndex] += blockedActivity;
      activityDelta[bIndex] += blockedActivity;
      return;
    }

    const pressureFlow = pressureDiff * 0.012;
    const gravityBias = orientation === 'vertical' ? state.gravity * ((indexToCoord(aIndex).y < indexToCoord(bIndex).y) ? 1 : -1) : 0;
    const liquidFlow = clamp((pressureFlow + gravityBias) * 0.2, -b.liquidMass * 0.4, a.liquidMass * 0.4);
    const gasFlow = clamp(pressureFlow * 0.7, -b.gasMass * 0.35, a.gasMass * 0.35);

    gasDelta[aIndex] -= gasFlow;
    gasDelta[bIndex] += gasFlow;
    liquidDelta[aIndex] -= liquidFlow;
    liquidDelta[bIndex] += liquidFlow;

    const velocityExchange = pressureDiff * 0.03;
    if (orientation === 'horizontal') {
      vxDelta[aIndex] -= velocityExchange;
      vxDelta[bIndex] += velocityExchange;
    } else {
      vyDelta[aIndex] -= velocityExchange;
      vyDelta[bIndex] += velocityExchange;
    }

    const activity = Math.abs(pressureDiff) * 0.05 + Math.abs(liquidFlow) * 0.15 + Math.abs(gasFlow) * 0.1 + Math.abs(temperatureFlux) * 0.03;
    activityDelta[aIndex] += activity;
    activityDelta[bIndex] += activity;
  };

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = coordToIndex(x, y);
      if (x < GRID_SIZE - 1) exchangePair(index, coordToIndex(x + 1, y), 'horizontal');
      if (y < GRID_SIZE - 1) exchangePair(index, coordToIndex(x, y + 1), 'vertical');
    }
  }

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = grid.cells[index];
    if (cell.childGrid) continue;
    applyWheelInteraction(grid, index, vxDelta, vyDelta, tempDelta, activityDelta);
  }

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = grid.cells[index];
    if (cell.childGrid) continue;

    cell.gasMass = clamp(cell.gasMass + gasDelta[index], 0.001, 3);
    cell.liquidMass = clamp(cell.liquidMass + liquidDelta[index], 0, 1.4);
    cell.temperature = clamp(cell.temperature + tempDelta[index], 150, 800);
    cell.velocityX = clamp((cell.velocityX + vxDelta[index]) * (isSolid(cell) ? 0.4 : 0.94), -3, 3);
    cell.velocityY = clamp((cell.velocityY + vyDelta[index] + (isSolid(cell) ? 0 : state.gravity * 0.02)) * (isSolid(cell) ? 0.4 : 0.94), -3, 3);
    cell.activity = clamp(cell.activity * 0.88 + activityDelta[index], 0, 1.5);
    cell.temperature += compressionHeating(cell);
    handlePhaseChange(cell);
    if (isSolid(cell)) {
      cell.gasMass = Math.min(cell.gasMass, 0.02);
      cell.liquidMass = 0;
    }
    updatePressure(cell);
  }
}

function averageConductivity(a, b) {
  const matA = MATERIALS[a.materialType] ?? MATERIALS.void;
  const matB = MATERIALS[b.materialType] ?? MATERIALS.void;
  return (matA.conductivity + matB.conductivity) / 2;
}

function compressionHeating(cell) {
  return clamp((cell.pressure - 1) * 0.12 - (Math.abs(cell.velocityX) + Math.abs(cell.velocityY)) * 0.015, -0.4, 0.7);
}

function handlePhaseChange(cell) {
  const fluid = FLUIDS[cell.fluidType] ?? FLUIDS.water;
  cell.phaseShift = 0;
  if (cell.liquidMass > 0.02 && cell.temperature > fluid.boilingPoint) {
    const amount = Math.min(cell.liquidMass * 0.1, (cell.temperature - fluid.boilingPoint) * 0.004);
    cell.liquidMass -= amount;
    cell.gasMass += amount * 0.92;
    cell.temperature -= fluid.latentHeat * amount * 8;
    cell.phaseShift = amount;
  } else if (cell.gasMass > 0.03 && cell.temperature < fluid.condensationPoint) {
    const amount = Math.min(cell.gasMass * 0.08, (fluid.condensationPoint - cell.temperature) * 0.003);
    cell.gasMass -= amount;
    cell.liquidMass += amount;
    cell.temperature += fluid.latentHeat * amount * 6;
    cell.phaseShift = -amount;
  }
  if (Math.abs(cell.phaseShift) > 0.0001) {
    cell.activity = clamp(cell.activity + Math.abs(cell.phaseShift) * 1.8, 0, 1.5);
  }
}

function applyWheelInteraction(grid, index, vxDelta, vyDelta, tempDelta, activityDelta) {
  const cell = grid.cells[index];
  if (!cell.wheel) return;

  const { x, y } = indexToCoord(index);
  const ring = [];
  let torque = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
      const neighborIndex = coordToIndex(nx, ny);
      const neighbor = grid.cells[neighborIndex];
      if (!isTraversable(neighbor)) continue;
      const tangentX = -dy;
      const tangentY = dx;
      const neighborMomentum = neighbor.velocityX * tangentX + neighbor.velocityY * tangentY;
      torque += neighborMomentum * (neighbor.gasMass + neighbor.liquidMass + 0.05);
      ring.push({ neighborIndex, tangentX, tangentY, neighbor });
    }
  }

  const requestedPower = cell.wheel.powered ? 1 : 0;
  const motorAssist = cell.wheel.powered ? cell.wheel.direction * 0.16 * state.powerFactor : 0;
  cell.wheel.spin = clamp((cell.wheel.spin ?? 0) * 0.92 + motorAssist + torque * 0.02, -2.5, 2.5);
  cell.wheel.torque = torque;

  if (cell.wheel.powered) {
    state.usedPower += requestedPower * state.powerFactor;
  }

  const generated = Math.max(0, Math.abs(cell.wheel.spin * torque) * 0.04 - requestedPower * 0.02);
  state.generatedPower += generated;

  for (const entry of ring) {
    const impulse = cell.wheel.spin * 0.08;
    vxDelta[entry.neighborIndex] += entry.tangentX * impulse;
    vyDelta[entry.neighborIndex] += entry.tangentY * impulse;
    tempDelta[entry.neighborIndex] += Math.abs(impulse) * 0.08;
    activityDelta[entry.neighborIndex] += Math.abs(impulse) * 0.24;
  }

  activityDelta[index] += clamp(Math.abs(torque) * 0.06 + Math.abs(cell.wheel.spin) * 0.04, 0, 0.35);
}

function manageHierarchy(grid) {
  for (const cell of grid.cells) {
    if (cell.childGrid) {
      const childActivity = computeGridActivity(cell.childGrid);
      cell.quietAge = childActivity < ACTIVITY_COLLAPSE_THRESHOLD ? (cell.quietAge ?? 0) + 1 : 0;
      if (state.autoCollapse && cell.quietAge > MIN_CHILD_AGE && childActivity < ACTIVITY_COLLAPSE_THRESHOLD) {
        collapseChildGrid(cell);
      }
      continue;
    }

    const shouldExpand = state.autoExpand
      && grid.level + 1 < MAX_DEPTH
      && (cell.activity > ACTIVITY_EXPAND_THRESHOLD || cell.wheel || Math.abs(cell.phaseShift) > 0.0001);

    if (shouldExpand) {
      createChildGridFromCell(cell, grid.level);
      cell.quietAge = 0;
    }
  }
}

function cellAtCanvasPosition(event) {
  const rect = ui.canvas.getBoundingClientRect();
  const scaleX = ui.canvas.width / rect.width;
  const scaleY = ui.canvas.height / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  const cellSize = ui.canvas.width / GRID_SIZE;
  const x = clamp(Math.floor(px / cellSize), 0, GRID_SIZE - 1);
  const y = clamp(Math.floor(py / cellSize), 0, GRID_SIZE - 1);
  return { x, y, index: coordToIndex(x, y) };
}

function paintCell(index) {
  const cell = state.currentGrid.cells[index];
  if (!cell) return;
  const selectedFluid = ui.fluidSelect.value;
  const selectedMaterial = ui.materialSelect.value;

  switch (state.selectedTool) {
    case 'gas':
      Object.assign(cell, createLeafCell({ fluidType: selectedFluid, gasMass: 0.58, liquidMass: 0.02, temperature: BASE_TEMPERATURE, materialType: 'void' }));
      break;
    case 'liquid':
      Object.assign(cell, createLeafCell({ fluidType: selectedFluid, gasMass: 0.12, liquidMass: 0.92, temperature: BASE_TEMPERATURE, materialType: 'void' }));
      break;
    case 'wall':
      Object.assign(cell, createLeafCell({ materialType: selectedMaterial, fluidType: 'air', gasMass: 0.02, liquidMass: 0, temperature: BASE_TEMPERATURE }));
      break;
    case 'heat':
      cell.temperature = clamp(cell.temperature + 35, 150, 800);
      cell.activity = clamp(cell.activity + 0.12, 0, 1.5);
      break;
    case 'cool':
      cell.temperature = clamp(cell.temperature - 35, 150, 800);
      cell.activity = clamp(cell.activity + 0.12, 0, 1.5);
      break;
    case 'wheel-powered-cw':
      Object.assign(cell, createLeafCell({ fluidType: selectedFluid, gasMass: 0.24, liquidMass: selectedFluid === 'air' ? 0 : 0.46, materialType: 'void', temperature: BASE_TEMPERATURE }));
      cell.wheel = { powered: true, direction: 1, spin: 0.8, torque: 0 };
      break;
    case 'wheel-powered-ccw':
      Object.assign(cell, createLeafCell({ fluidType: selectedFluid, gasMass: 0.24, liquidMass: selectedFluid === 'air' ? 0 : 0.46, materialType: 'void', temperature: BASE_TEMPERATURE }));
      cell.wheel = { powered: true, direction: -1, spin: -0.8, torque: 0 };
      break;
    case 'wheel-free':
      Object.assign(cell, createLeafCell({ fluidType: selectedFluid, gasMass: 0.24, liquidMass: selectedFluid === 'air' ? 0 : 0.3, materialType: 'void', temperature: BASE_TEMPERATURE }));
      cell.wheel = { powered: false, direction: 1, spin: 0, torque: 0 };
      break;
    case 'erase':
      Object.assign(cell, createLeafCell({ fluidType: 'air', gasMass: DEFAULT_GAS_MASS, liquidMass: 0 }));
      break;
    case 'subdivide':
      if (cell.childGrid) {
        state.selectedCell = { grid: state.currentGrid, index };
      } else if (state.currentGrid.level + 1 < MAX_DEPTH) {
        createChildGridFromCell(cell, state.currentGrid.level);
        state.selectedCell = { grid: state.currentGrid, index };
      }
      break;
    default:
      break;
  }

  if (state.selectedTool !== 'subdivide') {
    cell.childGrid = null;
  }

  // Push snapshot to undo (before the change)
  state.undoStack.push(serializeGrid(state.rootGrid));
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];

  updatePressure(cell);
  ensureAggregate(state.rootGrid);
  updateUi();
  render();
}

function undoAction() {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(serializeGrid(state.rootGrid));
  const snapshot = state.undoStack.pop();
  applySerializedGrid(snapshot);
}

function redoAction() {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(serializeGrid(state.rootGrid));
  const snapshot = state.redoStack.pop();
  applySerializedGrid(snapshot);
}

function applySerializedGrid(snapshot) {
  const newGrid = deserializeGrid(snapshot);
  state.rootGrid = newGrid;
  state.currentGrid = newGrid;
  state.gridPath = [];
  state.selectedCell = null;
  ensureAggregate(state.rootGrid);
  updateUi();
  render();
}

function selectCell(index) {
  state.selectedCell = { grid: state.currentGrid, index };
  updateInspector();
  render();
}

function enterSelectedCell() {
  if (!state.selectedCell || state.selectedCell.grid !== state.currentGrid) return;
  const cell = state.currentGrid.cells[state.selectedCell.index];
  if (!cell.childGrid) return;
  state.gridPath.push(state.selectedCell.index);
  state.currentGrid = cell.childGrid;
  state.selectedCell = null;
  updateUi();
  render();
}

function goBackOneLevel() {
  if (state.gridPath.length === 0) return;
  state.gridPath.pop();
  let grid = state.rootGrid;
  for (const index of state.gridPath) {
    grid = grid.cells[index].childGrid;
  }
  state.currentGrid = grid;
  state.selectedCell = null;
  updateUi();
  render();
}

function reconcileCurrentGridPath() {
  let grid = state.rootGrid;
  const validPath = [];
  for (const index of state.gridPath) {
    const nextCell = grid.cells[index];
    if (!nextCell?.childGrid) break;
    validPath.push(index);
    grid = nextCell.childGrid;
  }
  state.gridPath = validPath;
  state.currentGrid = grid;
  if (state.selectedCell && state.selectedCell.grid !== state.currentGrid) {
    state.selectedCell = null;
  }
}

function currentGridPathLabel() {
  if (state.gridPath.length === 0) return 'root';
  return ['root', ...state.gridPath.map((index) => {
    const { x, y } = indexToCoord(index);
    return `(${x},${y})`;
  })].join(' › ');
}

function cellOpacity(cell) {
  if (cell.childGrid) return 1;
  if (isSolid(cell)) return 1;
  const totalMass = cell.gasMass + cell.liquidMass;
  return clamp(totalMass / 0.55, 0.28, 1);
}

function render() {
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  const cellSize = ui.canvas.width / GRID_SIZE;

  // ── Pass 1: fill cell backgrounds with density opacity ──
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = coordToIndex(x, y);
      const cell = state.currentGrid.cells[index];
      const px = x * cellSize;
      const py = y * cellSize;
      ctx.globalAlpha = cellOpacity(cell);
      ctx.fillStyle = cellColor(cell);
      ctx.fillRect(px, py, cellSize, cellSize);
    }
  }
  ctx.globalAlpha = 1;

  // ── Pass 2: grid lines ──
  ctx.strokeStyle = COLORS.gridStrong;
  ctx.lineWidth = 1;
  for (let line = 0; line <= GRID_SIZE; line += 1) {
    const p = line * cellSize;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, ui.canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(ui.canvas.width, p);
    ctx.stroke();
  }

  // ── Pass 3: overlays (childGrid, arrows, wheels, phase) on top of grid lines ──
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = coordToIndex(x, y);
      const cell = state.currentGrid.cells[index];
      const px = x * cellSize;
      const py = y * cellSize;

      if (cell.childGrid) {
        drawMiniGrid(cell.childGrid, px, py, cellSize);
        ctx.strokeStyle = COLORS.nested;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 5, py + 5, cellSize - 10, cellSize - 10);
      } else {
        drawVelocityArrow(cell, px, py, cellSize);
        drawWheel(cell, px, py, cellSize);
        drawPhaseMarker(cell, px, py, cellSize);
      }
    }
  }

  // ── Pass 4: selection outline (always on top) ──
  if (state.selectedCell && state.selectedCell.grid === state.currentGrid) {
    const { x, y } = indexToCoord(state.selectedCell.index);
    ctx.strokeStyle = COLORS.activeOutline;
    ctx.lineWidth = 3;
    ctx.strokeRect(x * cellSize + 2, y * cellSize + 2, cellSize - 4, cellSize - 4);
  }
}

function drawMiniGrid(childGrid, px, py, cellSize) {
  const inset = 8;
  const previewSize = cellSize - inset * 2;
  const sub = previewSize / GRID_SIZE;
  const subColors = [];
  let hasWheel = false;

  // First pass: collect background colors
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const child = childGrid.cells[i];
    subColors.push(cellColor(child));
    if (child.wheel) hasWheel = true;
  }

  // Draw filled subcells
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = coordToIndex(x, y);
      const child = childGrid.cells[index];
      const sx = px + inset + x * sub;
      const sy = py + inset + y * sub;
      const opacity = cellOpacity(child);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = subColors[index];
      ctx.fillRect(sx, sy, sub, sub);
    }
  }
  ctx.globalAlpha = 1;

  // Subcell grid lines
  ctx.strokeStyle = 'rgba(189, 133, 255, 0.35)';
  ctx.lineWidth = 0.8;
  for (let line = 1; line < GRID_SIZE; line += 1) {
    const p = line * sub;
    ctx.beginPath();
    ctx.moveTo(px + inset + p, py + inset);
    ctx.lineTo(px + inset + p, py + inset + previewSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + inset, py + inset + p);
    ctx.lineTo(px + inset + previewSize, py + inset + p);
    ctx.stroke();
  }

  // Draw wheel and arrows on top of subcell grid
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const child = childGrid.cells[coordToIndex(x, y)];
      const sx = px + inset + x * sub;
      const sy = py + inset + y * sub;
      if (child.wheel) drawWheel(child, sx, sy, sub);
      if (!child.childGrid && Math.hypot(child.velocityX, child.velocityY) > 0.35) {
        drawVelocityArrow(child, sx, sy, sub);
      }
    }
  }

  // Outer border
  ctx.strokeStyle = 'rgba(189, 133, 255, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + inset - 1, py + inset - 1, previewSize + 2, previewSize + 2);
}

function drawVelocityArrow(cell, px, py, cellSize) {
  const magnitude = Math.hypot(cell.velocityX, cell.velocityY);
  if (magnitude < 0.08) return;
  const centerX = px + cellSize / 2;
  const centerY = py + cellSize / 2;
  const scale = clamp(magnitude * 12, 6, cellSize * 0.35);
  const nx = cell.velocityX / magnitude;
  const ny = cell.velocityY / magnitude;
  const endX = centerX + nx * scale;
  const endY = centerY + ny * scale;

  ctx.strokeStyle = 'rgba(234, 244, 255, 0.68)';
  ctx.fillStyle = 'rgba(234, 244, 255, 0.68)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - nx * 7 - ny * 4, endY - ny * 7 + nx * 4);
  ctx.lineTo(endX - nx * 7 + ny * 4, endY - ny * 7 - nx * 4);
  ctx.closePath();
  ctx.fill();
}

function drawWheel(cell, px, py, cellSize) {
  if (!cell.wheel) return;
  const cx = px + cellSize / 2;
  const cy = py + cellSize / 2;
  const angle = cell.wheel.wheelAngle ?? 0;
  const bladeLength = cellSize * 0.95;
  const bladeWidth = Math.max(3, cellSize * 0.12);
  const bladeColor = cell.wheel.powered ? COLORS.wheel : '#8ce4ff';
  const outlineColor = cell.wheel.powered ? '#3f3411' : '#15405f';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = bladeColor;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = Math.max(1.5, cellSize * 0.018);

  ctx.beginPath();
  ctx.rect(-bladeWidth / 2, -bladeLength, bladeWidth, bladeLength * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(-bladeLength, -bladeWidth / 2, bladeLength * 2, bladeWidth);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = outlineColor;
  ctx.fillRect(-bladeWidth * 0.55, -bladeWidth * 0.55, bladeWidth * 1.1, bladeWidth * 1.1);
  ctx.restore();
}

function drawPhaseMarker(cell, px, py, cellSize) {
  if (Math.abs(cell.phaseShift) < 0.003) return;
  ctx.fillStyle = cell.phaseShift > 0 ? 'rgba(255, 169, 86, 0.92)' : 'rgba(141, 255, 198, 0.92)';
  ctx.beginPath();
  ctx.arc(px + cellSize - 14, py + 14, 6, 0, Math.PI * 2);
  ctx.fill();
}

function childColor(cell) {
  const savedMode = state.renderMode;
  if (savedMode === 'hierarchy') {
    return cell.childGrid ? mixColor('#0d1a2b', '#b98bff', 0.65) : mixColor('#0d1a2b', '#50627a', 0.2);
  }
  return cellColor(cell);
}

function cellColor(cell) {
  switch (state.renderMode) {
    case 'pressure': {
      const normalized = clamp(cell.pressure / 6, 0, 1);
      return mixColor('#11253f', '#ff835b', normalized);
    }
    case 'temperature': {
      const normalized = clamp((cell.temperature - 220) / 240, 0, 1);
      return mixColor('#093457', '#ff764f', normalized);
    }
    case 'flow': {
      const normalized = clamp(Math.hypot(cell.velocityX, cell.velocityY) / 2.2, 0, 1);
      return mixColor('#0b1b2b', '#84dcff', normalized);
    }
    case 'hierarchy': {
      const normalized = clamp((cell.aggregateDepth - 1) / (MAX_DEPTH - 1), 0, 1);
      return mixColor('#0d1a2b', '#b98bff', normalized);
    }
    case 'hybrid':
    default:
      break;
  }

  if (isSolid(cell)) {
    const material = cell.materialType;
    return material === 'copper' ? '#b97a48' : material === 'insulation' ? '#46566f' : COLORS.wall;
  }

  const fluid = FLUIDS[cell.fluidType] ?? FLUIDS.water;
  const fluidFraction = clamp(cell.liquidMass / 1.1, 0, 1);
  let base = mixColor(fluid.gasColor, fluid.liquidColor, fluidFraction);
  const tempBias = clamp((cell.temperature - BASE_TEMPERATURE + 70) / 170, 0, 1);
  base = mixColor('#7be7ff', '#ff7d57', tempBias * 0.75 + fluidFraction * 0.25);
  if (cell.childGrid) {
    base = mixColor(base, '#b98bff', 0.18);
  }
  return base;
}

function updateGlobalStats() {
  if (!ui.globalStats && !ui.hierarchyReadout) return;
  const stats = gatherLeafStats(state.rootGrid);
  const avgPressure = stats.pressure / Math.max(1, stats.leaves);
  const avgTemperature = stats.temperature / Math.max(1, stats.leaves);
  const avgActivity = stats.active / Math.max(1, stats.leaves);

  if (ui.globalStats) {
    ui.globalStats.innerHTML = [
      ['Total fluid mass', stats.mass.toFixed(2)],
      ['Mean pressure', `${avgPressure.toFixed(2)} bar*`],
      ['Mean temperature', `${avgTemperature.toFixed(1)} K`],
      ['Active wheels', `${stats.wheelCount} (${stats.powered} powered)`],
      ['Power demand', `${state.totalDemand.toFixed(1)} W`],
      ['Generated power', `${state.generatedPower.toFixed(2)} W`],
      ['Delivered power', `${state.usedPower.toFixed(2)} W`],
      ['Power factor', `${(state.powerFactor * 100).toFixed(0)}%`],
      ['Leaf cells', stats.leaves.toString()],
      ['Nested grids', stats.childGrids.toString()],
      ['Average activity', avgActivity.toFixed(3)],
      ['Max depth', stats.maxDepth.toString()],
    ].map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('');
  }

  if (ui.hierarchyReadout) ui.hierarchyReadout.textContent = `Depth ${stats.maxDepth}`;
}

function updateInspector() {
  if (!state.selectedCell || state.selectedCell.grid !== state.currentGrid) {
    if (ui.inspectorEmpty) ui.inspectorEmpty.style.display = 'block';
    if (ui.cellStats) ui.cellStats.innerHTML = '';
    if (ui.inspectorPath) ui.inspectorPath.textContent = currentGridPathLabel();
    if (ui.enterButton) ui.enterButton.disabled = true;
    return;
  }

  const cell = state.currentGrid.cells[state.selectedCell.index];
  const { x, y } = indexToCoord(state.selectedCell.index);
  if (ui.inspectorEmpty) ui.inspectorEmpty.style.display = 'none';
  if (ui.inspectorPath) ui.inspectorPath.textContent = `${currentGridPathLabel()} › (${x},${y})`;
  if (ui.enterButton) ui.enterButton.disabled = !cell.childGrid;

  if (ui.cellStats) {
    ui.cellStats.innerHTML = [
      ['Fluid', FLUIDS[cell.fluidType]?.label ?? cell.fluidType],
      ['Material', MATERIALS[cell.materialType]?.label ?? cell.materialType],
      ['Gas mass', cell.gasMass.toFixed(3)],
      ['Liquid mass', cell.liquidMass.toFixed(3)],
      ['Temperature', `${cell.temperature.toFixed(1)} K`],
      ['Pressure', `${cell.pressure.toFixed(2)} bar*`],
      ['Velocity x', cell.velocityX.toFixed(2)],
      ['Velocity y', cell.velocityY.toFixed(2)],
      ['Activity', cell.activity.toFixed(3)],
      ['Hierarchy depth', cell.aggregateDepth.toString()],
      ['Wheel', cell.wheel ? `${cell.wheel.powered ? 'powered' : 'free'} / spin ${cell.wheel.spin.toFixed(2)}` : 'none'],
      ['Phase shift', cell.phaseShift.toFixed(3)],
    ].map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('');
  }
}

function updateUi() {
  if (ui.tickReadout) ui.tickReadout.textContent = `Tick ${state.tick}`;
  if (ui.playPauseButton) {
    ui.playPauseButton.textContent = state.running ? 'Pause' : 'Play';
    ui.playPauseButton.classList.toggle('primary', state.running);
  }
  if (ui.powerValue) ui.powerValue.textContent = `${state.externalPower} W`;
  if (ui.gravityValue) ui.gravityValue.textContent = state.gravity.toFixed(2);
  if (ui.viewTitle) ui.viewTitle.textContent = state.gridPath.length === 0 ? 'Root 3×3 grid' : `Nested 3×3 grid at ${currentGridPathLabel()}`;
  if (ui.selectionLabel) ui.selectionLabel.textContent = `Tool: ${state.selectedTool}`;
  if (ui.backButton) ui.backButton.disabled = state.gridPath.length === 0;
  if (ui.statusLine) {
    ui.statusLine.textContent = state.selectedPreset === 'blank'
      ? 'Blank lab ready. Paint fluid, walls, heat, and wheels into 3×3 cells to invent a machine.'
      : `Loaded preset: ${state.selectedPreset}. Modify it, then drill into active 3×3 cells to inspect recursive detail.`;
  }
  updateGlobalStats();
  updateInspector();
  syncActiveButtons();
}

function syncActiveButtons() {
  const selector = '#toolButtons button, #toolbarButtons button';
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === state.selectedTool);
  });
}

function loadFeedbackStore() {
  try {
    state.feedbackStore = JSON.parse(localStorage.getItem('thermofluid-ui-feedback-v1') || '{}');
  } catch {
    state.feedbackStore = {};
  }
}

function renderFeedbackForms() {
  ui.feedbackForms.innerHTML = FEEDBACK_COMPONENTS.map((component) => {
    const entry = state.feedbackStore[component.id] ?? {};
    const safeNotes = (entry.notes ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
      <article class="feedback-card" data-feedback-card="${component.id}">
        <div class="feedback-card-header">
          <h3>${component.name}</h3>
          <p>${component.prompt}</p>
        </div>
        <div class="feedback-meta">
          <label>
            <span>Status</span>
            <select data-feedback-field="status" data-component-id="${component.id}">
              <option value="">No opinion yet</option>
              <option value="works" ${entry.status === 'works' ? 'selected' : ''}>Works well</option>
              <option value="unclear" ${entry.status === 'unclear' ? 'selected' : ''}>Unclear</option>
              <option value="needs-work" ${entry.status === 'needs-work' ? 'selected' : ''}>Needs work</option>
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select data-feedback-field="priority" data-component-id="${component.id}">
              <option value="">No priority</option>
              <option value="low" ${entry.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${entry.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="high" ${entry.priority === 'high' ? 'selected' : ''}>High</option>
            </select>
          </label>
        </div>
        <label>
          <span>Feedback</span>
          <textarea data-feedback-field="notes" data-component-id="${component.id}" placeholder="What feels good? What feels confusing? What should change?">${safeNotes}</textarea>
        </label>
        <div class="feedback-save-row">
          <span class="feedback-save-note muted" data-feedback-saved="${component.id}">${entry.savedAt ? `Saved ${new Date(entry.savedAt).toLocaleString()}` : 'Not saved yet'}</span>
          <button data-feedback-save="${component.id}">Save locally</button>
        </div>
      </article>
    `;
  }).join('');
}

function updateFeedbackStatus(message = null) {
  const savedCount = Object.values(state.feedbackStore).filter((entry) => entry?.notes || entry?.status || entry?.priority).length;
  ui.feedbackStatus.textContent = message ?? (savedCount > 0
    ? `${savedCount} UI element${savedCount === 1 ? '' : 's'} with saved feedback.`
    : 'No saved feedback yet.');
}

function saveFeedbackCard(componentId) {
  const card = ui.feedbackForms.querySelector(`[data-feedback-card="${componentId}"]`);
  if (!card) return;
  const status = card.querySelector('[data-feedback-field="status"]').value;
  const priority = card.querySelector('[data-feedback-field="priority"]').value;
  const notes = card.querySelector('[data-feedback-field="notes"]').value.trim();
  state.feedbackStore[componentId] = { status, priority, notes, savedAt: new Date().toISOString() };
  localStorage.setItem('thermofluid-ui-feedback-v1', JSON.stringify(state.feedbackStore));
  card.querySelector(`[data-feedback-saved="${componentId}"]`).textContent = `Saved ${new Date().toLocaleString()}`;
  updateFeedbackStatus(`Saved locally.`);
}

async function submitAllFeedback() {
  const payload = {
    exportedAt: new Date().toISOString(),
    url: window.location.href,
    feedback: FEEDBACK_COMPONENTS.map((component) => ({
      id: component.id,
      name: component.name,
      ...(state.feedbackStore[component.id] ?? {}),
    })),
  };
  try {
    const resp = await fetch(FEEDBACK_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (result.ok) {
      updateFeedbackStatus('Submitted to server!');
    } else {
      updateFeedbackStatus('Server error.');
    }
  } catch (e) {
    updateFeedbackStatus(`Failed: ${e.message}`);
  }
}

function setWorkspaceTab(tab) {
  state.activeWorkspace = tab;
  ui.workspaceTabs.forEach((button) => {
    const active = button.dataset.workspaceTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ui.workspacePanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.workspacePanel !== tab);
  });
}

// ── Blueprint serialization ──────────────────────────────

function serializeCell(cell) {
  const obj = {
    gasMass: cell.gasMass,
    liquidMass: cell.liquidMass,
    temperature: cell.temperature,
    pressure: cell.pressure,
    velocityX: cell.velocityX,
    velocityY: cell.velocityY,
    materialType: cell.materialType,
    fluidType: cell.fluidType,
    activity: cell.activity,
    wheel: cell.wheel ? { powered: cell.wheel.powered, direction: cell.wheel.direction, spin: cell.wheel.spin ?? 0, torque: cell.wheel.torque ?? 0, wheelAngle: cell.wheel.wheelAngle ?? 0 } : null,
  };
  if (cell.childGrid) {
    obj.childGrid = { level: cell.childGrid.level, cells: cell.childGrid.cells.map(serializeCell) };
  }
  return obj;
}

function serializeGrid(grid) {
  return { level: grid.level, cells: grid.cells.map(serializeCell) };
}

function deserializeCell(into, data) {
  into.gasMass = data.gasMass;
  into.liquidMass = data.liquidMass;
  into.temperature = data.temperature;
  into.pressure = data.pressure;
  into.velocityX = data.velocityX;
  into.velocityY = data.velocityY;
  into.materialType = data.materialType;
  into.fluidType = data.fluidType;
  into.activity = data.activity;
  into.wheel = data.wheel ? { ...data.wheel } : null;
  into.childGrid = null;
  into.aggregateDepth = 1;
  into.quietAge = 0;
  into.phaseShift = 0;
  if (data.childGrid) {
    const child = createGrid(data.childGrid.level, into);
    data.childGrid.cells.forEach((cd, i) => deserializeCell(child.cells[i], cd));
    into.childGrid = child;
  }
}

function deserializeGrid(data) {
  const grid = createGrid(data.level, null);
  data.cells.forEach((cd, i) => deserializeCell(grid.cells[i], cd));
  return grid;
}

// ── Blueprint save/load ──────────────────────────────────

async function saveBlueprint() {
  const name = ui.blueprintName?.value?.trim() || 'Unnamed';
  const data = serializeGrid(state.rootGrid);
  try {
    const resp = await fetch('/api/blueprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    const result = await resp.json();
    if (result.ok) {
      if (ui.statusLine) ui.statusLine.textContent = `Saved blueprint: ${name}`;
      await loadBlueprintList();
    }
  } catch (e) {
    if (ui.statusLine) ui.statusLine.textContent = `Save failed: ${e.message}`;
  }
}

async function loadBlueprintList() {
  try {
    const resp = await fetch('/api/blueprints');
    const list = await resp.json();
    const select = ui.loadBlueprintSelect;
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">— Load —</option>' + list.map((bp) =>
      `<option value="${bp.id}" ${bp.id === current ? 'selected' : ''}>${bp.name}</option>`
    ).join('');
    return list;
  } catch {
    return [];
  }
}

async function loadBlueprint() {
  const id = ui.loadBlueprintSelect?.value;
  if (!id) return;
  try {
    const resp = await fetch('/api/blueprints/' + id);
    const record = await resp.json();
    if (!record.data) throw new Error('Invalid blueprint');
    const newGrid = deserializeGrid(record.data);
    state.rootGrid = newGrid;
    state.currentGrid = newGrid;
    state.gridPath = [];
    state.selectedCell = null;
    state.tick = 0;
    ensureAggregate(state.rootGrid);
    updateUi();
    render();
    if (ui.statusLine) ui.statusLine.textContent = 'Loaded: ' + (record.name || id);
  } catch (e) {
    if (ui.statusLine) ui.statusLine.textContent = 'Load failed: ' + e.message;
  }
}

async function deleteBlueprint() {
  const id = ui.loadBlueprintSelect?.value;
  if (!id) return;
  try {
    await fetch('/api/blueprints/' + id, { method: 'DELETE' });
    if (ui.statusLine) ui.statusLine.textContent = 'Deleted blueprint';
    await loadBlueprintList();
  } catch (e) {
    if (ui.statusLine) ui.statusLine.textContent = 'Delete failed: ' + e.message;
  }
}

function animationFrame(timestamp) {
  const elapsed = timestamp - state.lastTimestamp;
  if (elapsed > 32) {
    const shouldRender = state.running || (timestamp - state.lastUiRefresh > 180);
    if (state.running) {
      for (let i = 0; i < state.ticksPerFrame; i += 1) simulationStep();
    }
    if (shouldRender) render();
    if (timestamp - state.lastUiRefresh > 180) {
      updateUi();
      state.lastUiRefresh = timestamp;
    }
    state.lastTimestamp = timestamp;
  }
  state.animationHandle = requestAnimationFrame(animationFrame);
}

function bindEvents() {
  ui.playPauseButton.addEventListener('click', () => {
    state.running = !state.running;
    updateUi();
  });

  ui.stepButton.addEventListener('click', () => {
    simulationStep();
    updateUi();
    render();
  });

  ui.resetButton.addEventListener('click', () => {
    applyPreset(state.selectedPreset);
  });

  ui.speedSlider.addEventListener('input', () => {
    state.ticksPerFrame = Number(ui.speedSlider.value);
  });

  ui.powerSlider.addEventListener('input', () => {
    state.externalPower = Number(ui.powerSlider.value);
    updateUi();
  });

  ui.gravitySlider.addEventListener('input', () => {
    state.gravity = Number(ui.gravitySlider.value) / 100;
    updateUi();
  });

  ui.autoHierarchyToggle.addEventListener('change', () => {
    state.autoExpand = ui.autoHierarchyToggle.checked;
  });

  ui.autoCollapseToggle.addEventListener('change', () => {
    state.autoCollapse = ui.autoCollapseToggle.checked;
  });

  ui.renderModeSelect.addEventListener('change', () => {
    state.renderMode = ui.renderModeSelect.value;
    render();
  });

  document.querySelectorAll('#toolButtons button, #toolbarButtons button').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedTool = button.dataset.tool;
      updateUi();
    });
  });

  ui.toggleToolbarButton.addEventListener('click', () => {
    state.toolbarVisible = !state.toolbarVisible;
    ui.toolbarButtons.classList.toggle('hidden', !state.toolbarVisible);
    ui.toggleToolbarButton.textContent = state.toolbarVisible ? '✕' : '⊙';
  });

  ui.telemetryToggle.addEventListener('click', () => {
    state.telemetryVisible = !state.telemetryVisible;
    ui.globalStats.classList.toggle('hidden', !state.telemetryVisible);
    ui.telemetryToggle.textContent = state.telemetryVisible ? 'Hide' : 'Show';
  });

  ui.enterButton.addEventListener('click', enterSelectedCell);
  ui.backButton.addEventListener('click', goBackOneLevel);

  ui.workspaceTabs.forEach((button) => {
    button.addEventListener('click', () => setWorkspaceTab(button.dataset.workspaceTab));
  });

  ui.feedbackForms.addEventListener('click', (event) => {
    const saveButton = event.target.closest('[data-feedback-save]');
    if (saveButton) saveFeedbackCard(saveButton.dataset.feedbackSave);
  });

  ui.submitAllFeedbackButton.addEventListener('click', submitAllFeedback);

  ui.saveBlueprintButton.addEventListener('click', saveBlueprint);
  ui.loadBlueprintSelect.addEventListener('change', loadBlueprint);
  ui.deleteBlueprintButton.addEventListener('click', deleteBlueprint);

  // ── Pointer events (mouse + touch) ──
  function pointerDown(event) {
    state.dragging = true;
    const pos = event.touches ? { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY } : event;
    const { index } = cellAtCanvasPosition(pos);
    selectCell(index);
    paintCell(index);
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!state.dragging) return;
    const pos = event.touches ? { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY } : event;
    const { index } = cellAtCanvasPosition(pos);
    selectCell(index);
    paintCell(index);
    event.preventDefault();
  }

  function pointerUp() {
    state.dragging = false;
  }

  ui.canvas.addEventListener('mousedown', pointerDown);
  ui.canvas.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  ui.canvas.addEventListener('click', (event) => {
    const { index } = cellAtCanvasPosition(event);
    selectCell(index);
  });
  ui.canvas.addEventListener('touchstart', pointerDown, { passive: false });
  ui.canvas.addEventListener('touchmove', pointerMove, { passive: false });
  ui.canvas.addEventListener('touchend', pointerUp);

  // Collapse toolbar to icons on small screens
  const mql = window.matchMedia('(max-width: 720px)');
  function handleMobileLayout(e) {
    const buttons = document.querySelectorAll('#toolbarButtons button');
    buttons.forEach((btn) => {
      const tool = btn.dataset.tool;
      if (tool === 'gas') btn.textContent = 'G';
      else if (tool === 'liquid') btn.textContent = 'L';
      else if (tool === 'wall') btn.textContent = 'W';
      else if (tool === 'heat') btn.textContent = '🔥';
      else if (tool === 'cool') btn.textContent = '❄';
      else if (tool === 'wheel-powered-cw') btn.textContent = '↻';
      else if (tool === 'wheel-powered-ccw') btn.textContent = '↺';
      else if (tool === 'wheel-free') btn.textContent = '⏣';
      else if (tool === 'erase') btn.textContent = '⌫';
      else if (tool === 'subdivide') btn.textContent = '⊞';
    });
  }
  mql.addEventListener('change', handleMobileLayout);
  handleMobileLayout(mql);

  window.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      event.preventDefault();
      state.running = !state.running;
      updateUi();
    }
    if (event.key === 'Enter') {
      enterSelectedCell();
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      goBackOneLevel();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoAction();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) {
      event.preventDefault();
      redoAction();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
      event.preventDefault();
      redoAction();
    }
  });
}

let errorLogger = null;

function init() {
  // Initialize browser error logger — captures unhandled errors & promise rejections
  // and sends them to the server so we can diagnose issues remotely.
  try {
    errorLogger = createErrorLogger({
      endpoint: '/api/feedback',
      appName: 'recursive-thermofluid-sandbox',
      appVersion: '0.1.0',
      batchSize: 5,
      flushInterval: 3000,
      captureUnhandled: true,
      capturePromiseRejections: true,
      captureConsoleErrors: false,
      debug: false,
      filter: (report) => {
        // Avoid spamming the server with noise
        if (report.message && report.message.includes('ResizeObserver')) return false;
        return true;
      },
    });
  } catch (e) {
    console.warn('Failed to init error logger:', e);
  }

  loadFeedbackStore();
  renderFeedbackForms();
  updateFeedbackStatus();
  bindEvents();
  setWorkspaceTab('sandbox');
  ui.globalStats.classList.add('hidden');
  loadBlueprintList();
  applyPreset('pump');
  syncActiveButtons();
  state.animationHandle = requestAnimationFrame(animationFrame);
}

init();
