export const GRID_SIZE = 3;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;
export const GRID_CENTER = Math.floor(GRID_SIZE / 2);
export const MAX_DEPTH = 4;
export const BASE_TEMPERATURE = 293;
export const DEFAULT_GAS_MASS = 0.35;
export const DEFAULT_LIQUID_MASS = 0.7;
export const AMBIENT_PRESSURE = 1;
export const GAS_CONSTANT = 1.15;
export const ACTIVITY_EXPAND_THRESHOLD = 0.26;
export const ACTIVITY_COLLAPSE_THRESHOLD = 0.045;
export const MIN_CHILD_AGE = 180;

export const FLUIDS = {
  air: {
    label: 'Air',
    gasColor: '#96defa',
    liquidColor: '#d8f6ff',
    boilingPoint: 30,
    condensationPoint: 20,
    latentHeat: 0.1,
    gasThermalFactor: 0.9,
    liquidThermalFactor: 0.2,
  },
  water: {
    label: 'Water / Steam',
    gasColor: '#ade8ff',
    liquidColor: '#2388ff',
    boilingPoint: 373,
    condensationPoint: 368,
    latentHeat: 2.8,
    gasThermalFactor: 1.1,
    liquidThermalFactor: 1.2,
  },
  refrigerant: {
    label: 'Refrigerant',
    gasColor: '#b3ffdf',
    liquidColor: '#35cc9b',
    boilingPoint: 280,
    condensationPoint: 274,
    latentHeat: 1.9,
    gasThermalFactor: 1.0,
    liquidThermalFactor: 0.8,
  },
};

export const MATERIALS = {
  void: { label: 'Void', conductivity: 0.04, heatCapacity: 0.4, density: 0.05, strength: 0.01, solid: false },
  steel: { label: 'Steel', conductivity: 0.88, heatCapacity: 0.78, density: 7.8, strength: 0.96, solid: true },
  copper: { label: 'Copper', conductivity: 1.2, heatCapacity: 0.68, density: 8.9, strength: 0.7, solid: true },
  insulation: { label: 'Insulation', conductivity: 0.1, heatCapacity: 1.15, density: 0.3, strength: 0.35, solid: true },
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function indexToCoord(index) {
  return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
}

export function coordToIndex(x, y) {
  return y * GRID_SIZE + x;
}

export function createLeafCell(overrides = {}) {
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

export function createGrid(level = 0, parentCell = null) {
  return {
    level,
    parentCell,
    cells: Array.from({ length: CELL_COUNT }, () => createLeafCell()),
  };
}

export function cloneWheel(wheel) {
  return wheel ? { powered: wheel.powered, direction: wheel.direction, spin: wheel.spin ?? 0, torque: wheel.torque ?? 0 } : null;
}

export function createChildGridFromCell(cell, level) {
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

export function pickDominantKey(map, fallback) {
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

export function aggregateCellFromChildren(cell) {
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

export function collapseChildGrid(cell) {
  if (!cell.childGrid) return;
  aggregateCellFromChildren(cell);
  cell.childGrid = null;
}

export function isSolid(cell) {
  return MATERIALS[cell.materialType]?.solid && !cell.wheel;
}

export function isTraversable(cell) {
  return !isSolid(cell);
}

export function updatePressure(cell) {
  const fluid = FLUIDS[cell.fluidType] ?? FLUIDS.water;
  const temperatureFactor = clamp(cell.temperature / BASE_TEMPERATURE, 0.18, 3.2);
  const liquidFill = clamp(cell.liquidMass, 0, 1.4);
  const freeVolume = clamp(1 - liquidFill * 0.82, 0.08, 1.2);
  const gasTerm = (cell.gasMass * GAS_CONSTANT * temperatureFactor * fluid.gasThermalFactor) / freeVolume;
  const liquidCompression = Math.max(0, liquidFill - 0.9) * 12 * fluid.liquidThermalFactor;
  const kineticPressure = (Math.abs(cell.velocityX) + Math.abs(cell.velocityY)) * 0.08;
  cell.pressure = clamp(0.12 + gasTerm + liquidCompression + kineticPressure, 0.02, 18);
}

export function ensureAggregate(grid) {
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

export function computeGridActivity(grid) {
  let total = 0;
  for (const cell of grid.cells) total += cell.activity;
  return total / CELL_COUNT;
}

export function gatherLeafStats(grid, metrics = { mass: 0, pressure: 0, temperature: 0, wheelCount: 0, powered: 0, active: 0, leaves: 0, childGrids: 0, maxDepth: 1 }) {
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

export function forEachGrid(grid, visitor) {
  visitor(grid);
  for (const cell of grid.cells) {
    if (cell.childGrid) forEachGrid(cell.childGrid, visitor);
  }
}

export function averageConductivity(a, b) {
  const matA = MATERIALS[a.materialType] ?? MATERIALS.void;
  const matB = MATERIALS[b.materialType] ?? MATERIALS.void;
  return (matA.conductivity + matB.conductivity) / 2;
}

export function compressionHeating(cell) {
  return clamp((cell.pressure - 1) * 0.12 - (Math.abs(cell.velocityX) + Math.abs(cell.velocityY)) * 0.015, -0.4, 0.7);
}

export function handlePhaseChange(cell) {
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

export function createSimulationState(overrides = {}) {
  return {
    rootGrid: overrides.rootGrid ?? createGrid(0, null),
    externalPower: overrides.externalPower ?? 8,
    gravity: overrides.gravity ?? 0.08,
    autoExpand: overrides.autoExpand ?? true,
    autoCollapse: overrides.autoCollapse ?? true,
    tick: overrides.tick ?? 0,
    powerFactor: overrides.powerFactor ?? 1,
    generatedPower: overrides.generatedPower ?? 0,
    usedPower: overrides.usedPower ?? 0,
    totalDemand: overrides.totalDemand ?? 0,
    maxDepthObserved: overrides.maxDepthObserved ?? 1,
    gridPath: overrides.gridPath ?? [],
    currentGrid: overrides.currentGrid ?? null,
    selectedCell: overrides.selectedCell ?? null,
  };
}

export function simulateGrid(grid, simState) {
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
    const gravityBias = orientation === 'vertical' ? simState.gravity * ((indexToCoord(aIndex).y < indexToCoord(bIndex).y) ? 1 : -1) : 0;
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
    applyWheelInteraction(grid, index, vxDelta, vyDelta, tempDelta, activityDelta, simState);
  }

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = grid.cells[index];
    if (cell.childGrid) continue;

    cell.gasMass = clamp(cell.gasMass + gasDelta[index], 0.001, 3);
    cell.liquidMass = clamp(cell.liquidMass + liquidDelta[index], 0, 1.4);
    cell.temperature = clamp(cell.temperature + tempDelta[index], 150, 800);
    cell.velocityX = clamp((cell.velocityX + vxDelta[index]) * (isSolid(cell) ? 0.4 : 0.94), -3, 3);
    cell.velocityY = clamp((cell.velocityY + vyDelta[index] + (isSolid(cell) ? 0 : simState.gravity * 0.02)) * (isSolid(cell) ? 0.4 : 0.94), -3, 3);
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

export function applyWheelInteraction(grid, index, vxDelta, vyDelta, tempDelta, activityDelta, simState) {
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
      ring.push({ neighborIndex, tangentX, tangentY });
    }
  }

  const requestedPower = cell.wheel.powered ? 1 : 0;
  const motorAssist = cell.wheel.powered ? cell.wheel.direction * 0.16 * simState.powerFactor : 0;
  cell.wheel.spin = clamp((cell.wheel.spin ?? 0) * 0.92 + motorAssist + torque * 0.02, -2.5, 2.5);
  cell.wheel.torque = torque;
  cell.wheel.wheelAngle = (cell.wheel.wheelAngle ?? 0) + cell.wheel.spin * 0.12;

  if (cell.wheel.powered) {
    simState.usedPower += requestedPower * simState.powerFactor;
  }

  const generated = Math.max(0, Math.abs(cell.wheel.spin * torque) * 0.04 - requestedPower * 0.02);
  simState.generatedPower += generated;

  for (const entry of ring) {
    const impulse = cell.wheel.spin * 0.08;
    vxDelta[entry.neighborIndex] += entry.tangentX * impulse;
    vyDelta[entry.neighborIndex] += entry.tangentY * impulse;
    tempDelta[entry.neighborIndex] += Math.abs(impulse) * 0.08;
    activityDelta[entry.neighborIndex] += Math.abs(impulse) * 0.24;
  }

  activityDelta[index] += clamp(Math.abs(torque) * 0.06 + Math.abs(cell.wheel.spin) * 0.04, 0, 0.35);
}

export function manageHierarchy(grid, simState) {
  for (const cell of grid.cells) {
    if (cell.childGrid) {
      const childActivity = computeGridActivity(cell.childGrid);
      cell.quietAge = childActivity < ACTIVITY_COLLAPSE_THRESHOLD ? (cell.quietAge ?? 0) + 1 : 0;
      if (simState.autoCollapse && cell.quietAge > MIN_CHILD_AGE && childActivity < ACTIVITY_COLLAPSE_THRESHOLD) {
        collapseChildGrid(cell);
      }
      continue;
    }

    const shouldExpand = simState.autoExpand
      && grid.level + 1 < MAX_DEPTH
      && (cell.activity > ACTIVITY_EXPAND_THRESHOLD || cell.wheel || Math.abs(cell.phaseShift) > 0.0001);

    if (shouldExpand) {
      createChildGridFromCell(cell, grid.level);
      cell.quietAge = 0;
    }
  }
}

export function reconcileCurrentGridPath(simState) {
  let grid = simState.rootGrid;
  const validPath = [];
  for (const index of simState.gridPath) {
    const nextCell = grid.cells[index];
    if (!nextCell?.childGrid) break;
    validPath.push(index);
    grid = nextCell.childGrid;
  }
  simState.gridPath = validPath;
  simState.currentGrid = grid;
  if (simState.selectedCell && simState.selectedCell.grid !== simState.currentGrid) {
    simState.selectedCell = null;
  }
}

export function simulationStep(simState) {
  ensureAggregate(simState.rootGrid);
  const preStats = gatherLeafStats(simState.rootGrid);
  simState.maxDepthObserved = preStats.maxDepth;
  simState.totalDemand = preStats.powered;
  simState.powerFactor = preStats.powered > 0 ? Math.min(1, (simState.externalPower + simState.generatedPower) / preStats.powered) : 1;
  simState.generatedPower = 0;
  simState.usedPower = 0;

  forEachGrid(simState.rootGrid, (grid) => simulateGrid(grid, simState));
  ensureAggregate(simState.rootGrid);

  if (simState.autoExpand || simState.autoCollapse) {
    forEachGrid(simState.rootGrid, (grid) => manageHierarchy(grid, simState));
    ensureAggregate(simState.rootGrid);
    reconcileCurrentGridPath(simState);
  }

  simState.tick += 1;
  return simState;
}

export function clearGridToVoid(grid) {
  for (const cell of grid.cells) {
    Object.assign(cell, createLeafCell({ fluidType: 'air', gasMass: DEFAULT_GAS_MASS, liquidMass: 0 }));
  }
}

export function setWall(grid, x, y, materialType = 'steel', temperature = BASE_TEMPERATURE) {
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

export function setFluid(grid, x, y, { fluidType = 'water', gasMass = DEFAULT_GAS_MASS, liquidMass = DEFAULT_LIQUID_MASS, temperature = BASE_TEMPERATURE, velocityX = 0, velocityY = 0 } = {}) {
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

export function setWheel(grid, x, y, { powered = true, direction = 1, fluidType = 'water', gasMass = 0.25, liquidMass = 0.45, temperature = BASE_TEMPERATURE } = {}) {
  const cell = grid.cells[coordToIndex(x, y)];
  cell.materialType = 'void';
  cell.fluidType = fluidType;
  cell.gasMass = gasMass;
  cell.liquidMass = liquidMass;
  cell.temperature = temperature;
  cell.wheel = { powered, direction, spin: powered ? direction * 0.6 : 0, torque: 0, wheelAngle: 0 };
}
