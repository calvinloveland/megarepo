import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_TEMPERATURE,
  CELL_COUNT,
  GRID_CENTER,
  GRID_SIZE,
  MIN_CHILD_AGE,
  coordToIndex,
  createGrid,
  createLeafCell,
  createChildGridFromCell,
  createSimulationState,
  clearGridToVoid,
  ensureAggregate,
  gatherLeafStats,
  forEachGrid,
  handlePhaseChange,
  manageHierarchy,
  setFluid,
  setWall,
  setWheel,
  simulateGrid,
  simulationStep,
  updatePressure,
} from '../sim-core.mjs';

function approxEqual(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected} ± ${tolerance}`);
}

test('recursive grid geometry is 3x3 with 9 total cells', () => {
  assert.equal(GRID_SIZE, 3);
  assert.equal(CELL_COUNT, 9);
  assert.equal(GRID_CENTER, 1);
});

test('pressure rises when temperature rises at fixed mass', () => {
  const cool = createLeafCell({ fluidType: 'air', gasMass: 0.55, liquidMass: 0, temperature: 260 });
  const hot = createLeafCell({ fluidType: 'air', gasMass: 0.55, liquidMass: 0, temperature: 420 });
  updatePressure(cool);
  updatePressure(hot);
  assert.ok(hot.pressure > cool.pressure);
});

test('pressure rises when free volume shrinks', () => {
  const loose = createLeafCell({ fluidType: 'water', gasMass: 0.28, liquidMass: 0.2, temperature: BASE_TEMPERATURE });
  const compressed = createLeafCell({ fluidType: 'water', gasMass: 0.28, liquidMass: 1.05, temperature: BASE_TEMPERATURE });
  updatePressure(loose);
  updatePressure(compressed);
  assert.ok(compressed.pressure > loose.pressure);
});

test('boiling converts liquid to gas and cools the cell via latent heat', () => {
  const cell = createLeafCell({ fluidType: 'water', gasMass: 0.08, liquidMass: 0.9, temperature: 430, activity: 0 });
  const startGas = cell.gasMass;
  const startLiquid = cell.liquidMass;
  const startTemperature = cell.temperature;
  handlePhaseChange(cell);
  assert.ok(cell.gasMass > startGas);
  assert.ok(cell.liquidMass < startLiquid);
  assert.ok(cell.temperature < startTemperature);
  assert.ok(cell.phaseShift > 0);
  assert.ok(cell.activity > 0);
});

test('condensation converts gas to liquid and releases heat', () => {
  const cell = createLeafCell({ fluidType: 'refrigerant', gasMass: 0.8, liquidMass: 0.05, temperature: 250, activity: 0 });
  const startGas = cell.gasMass;
  const startLiquid = cell.liquidMass;
  const startTemperature = cell.temperature;
  handlePhaseChange(cell);
  assert.ok(cell.gasMass < startGas);
  assert.ok(cell.liquidMass > startLiquid);
  assert.ok(cell.temperature > startTemperature);
  assert.ok(cell.phaseShift < 0);
});

test('pressure gradients push gas from high-pressure cells to low-pressure cells', () => {
  const grid = createGrid();
  setFluid(grid, 0, 1, { fluidType: 'air', gasMass: 1.0, liquidMass: 0, temperature: 420 });
  setFluid(grid, 1, 1, { fluidType: 'air', gasMass: 0.12, liquidMass: 0, temperature: 260 });
  ensureAggregate(grid);
  const leftIndex = coordToIndex(0, 1);
  const rightIndex = coordToIndex(1, 1);
  const beforeLeft = grid.cells[leftIndex].gasMass;
  const beforeRight = grid.cells[rightIndex].gasMass;
  simulateGrid(grid, createSimulationState({ rootGrid: grid, autoExpand: false, autoCollapse: false }));
  assert.ok(grid.cells[leftIndex].gasMass < beforeLeft);
  assert.ok(grid.cells[rightIndex].gasMass > beforeRight);
});

test('gravity biases liquid downward', () => {
  const grid = createGrid();
  setFluid(grid, 1, 0, { fluidType: 'water', gasMass: 0.1, liquidMass: 1.0, temperature: BASE_TEMPERATURE });
  setFluid(grid, 1, 1, { fluidType: 'water', gasMass: 0.1, liquidMass: 0.05, temperature: BASE_TEMPERATURE });
  ensureAggregate(grid);
  const topIndex = coordToIndex(1, 0);
  const bottomIndex = coordToIndex(1, 1);
  const beforeTop = grid.cells[topIndex].liquidMass;
  const beforeBottom = grid.cells[bottomIndex].liquidMass;
  simulateGrid(grid, createSimulationState({ rootGrid: grid, gravity: 0.2, autoExpand: false, autoCollapse: false }));
  assert.ok(grid.cells[topIndex].liquidMass < beforeTop);
  assert.ok(grid.cells[bottomIndex].liquidMass > beforeBottom);
});

test('walls block direct fluid transfer but still conduct heat', () => {
  const grid = createGrid();
  setFluid(grid, 1, 1, { fluidType: 'air', gasMass: 0.8, liquidMass: 0, temperature: 520 });
  setWall(grid, 2, 1, 'steel', 280);
  ensureAggregate(grid);
  const hotCellIndex = coordToIndex(1, 1);
  const wallIndex = coordToIndex(2, 1);
  const beforeWallTemp = grid.cells[wallIndex].temperature;
  const beforeWallGas = grid.cells[wallIndex].gasMass;
  simulateGrid(grid, createSimulationState({ rootGrid: grid, autoExpand: false, autoCollapse: false }));
  approxEqual(grid.cells[wallIndex].gasMass, beforeWallGas, 1e-9);
  assert.ok(grid.cells[wallIndex].temperature > beforeWallTemp);
  assert.ok(grid.cells[hotCellIndex].temperature < 520);
});

test('powered wheels impose exactly one watt of demand each and throttling lowers power factor', () => {
  const grid = createGrid();
  setWheel(grid, 1, 1, { powered: true, direction: 1, fluidType: 'water' });
  setWheel(grid, 2, 1, { powered: true, direction: -1, fluidType: 'water' });
  ensureAggregate(grid);
  const sim = createSimulationState({ rootGrid: grid, externalPower: 1, autoExpand: false, autoCollapse: false });
  simulationStep(sim);
  assert.equal(sim.totalDemand, 2);
  assert.ok(sim.powerFactor > 0 && sim.powerFactor < 1);
  assert.ok(sim.usedPower <= 1.1);
});

test('free wheels can generate positive power from incoming flow', () => {
  const grid = createGrid();
  setWheel(grid, 1, 1, { powered: false, direction: 1, fluidType: 'air', gasMass: 0.4, liquidMass: 0 });
  setFluid(grid, 1, 0, { fluidType: 'air', gasMass: 0.7, liquidMass: 0, velocityX: 1.4, velocityY: 0.2, temperature: BASE_TEMPERATURE + 10 });
  setFluid(grid, 2, 1, { fluidType: 'air', gasMass: 0.7, liquidMass: 0, velocityX: 0.1, velocityY: -1.3, temperature: BASE_TEMPERATURE + 10 });
  setFluid(grid, 1, 2, { fluidType: 'air', gasMass: 0.7, liquidMass: 0, velocityX: -1.1, velocityY: -0.2, temperature: BASE_TEMPERATURE + 10 });
  ensureAggregate(grid);
  const sim = createSimulationState({ rootGrid: grid, externalPower: 0, autoExpand: false, autoCollapse: false });
  simulationStep(sim);
  assert.ok(sim.generatedPower > 0);
  assert.ok(Math.abs(grid.cells[coordToIndex(1, 1)].wheel.spin) > 0);
});

test('simulation approximately conserves total fluid mass over one step', () => {
  const grid = createGrid();
  setFluid(grid, 0, 1, { fluidType: 'water', gasMass: 0.2, liquidMass: 0.8, temperature: BASE_TEMPERATURE + 20 });
  setFluid(grid, 1, 1, { fluidType: 'water', gasMass: 0.3, liquidMass: 0.6, temperature: BASE_TEMPERATURE - 10 });
  setFluid(grid, 2, 1, { fluidType: 'air', gasMass: 0.7, liquidMass: 0, temperature: BASE_TEMPERATURE + 5 });
  ensureAggregate(grid);
  const before = gatherLeafStats(grid).mass;
  simulationStep(createSimulationState({ rootGrid: grid, autoExpand: false, autoCollapse: false }));
  const after = gatherLeafStats(grid).mass;
  approxEqual(after, before, 0.08);
});

test('active cells expand into child grids when hierarchy is enabled', () => {
  const grid = createGrid();
  const cell = grid.cells[coordToIndex(1, 1)];
  cell.activity = 0.8;
  manageHierarchy(grid, createSimulationState({ rootGrid: grid, autoExpand: true, autoCollapse: false }));
  assert.ok(cell.childGrid, 'expected an active cell to subdivide');
  approxEqual(gatherLeafStats(cell.childGrid).mass, cell.gasMass + cell.liquidMass, 0.05);
});

test('quiet child grids collapse back into parent cells after enough idle ticks', () => {
  const grid = createGrid();
  const parent = grid.cells[coordToIndex(1, 1)];
  Object.assign(parent, createLeafCell({ fluidType: 'water', gasMass: 0.25, liquidMass: 0.5, temperature: BASE_TEMPERATURE + 12 }));
  createChildGridFromCell(parent, grid.level);
  for (const child of parent.childGrid.cells) {
    child.activity = 0;
    child.velocityX = 0;
    child.velocityY = 0;
  }
  parent.quietAge = MIN_CHILD_AGE + 1;
  manageHierarchy(grid, createSimulationState({ rootGrid: grid, autoExpand: false, autoCollapse: true }));
  assert.equal(parent.childGrid, null);
  assert.ok(parent.aggregateDepth >= 1);
});

test('aggregate stats count subdivided leaf cells correctly', () => {
  const grid = createGrid();
  const parent = grid.cells[coordToIndex(1, 1)];
  Object.assign(parent, createLeafCell({ fluidType: 'water', gasMass: 0.81, liquidMass: 0.81, temperature: BASE_TEMPERATURE }));
  createChildGridFromCell(parent, grid.level);
  ensureAggregate(grid);
  const stats = gatherLeafStats(grid);
  assert.equal(stats.leaves, CELL_COUNT - 1 + CELL_COUNT);
  assert.equal(stats.childGrids, 1);
  assert.ok(stats.maxDepth >= 2);
});

test('subdivision preserves parent mass across child cells', () => {
  const parent = createLeafCell({ fluidType: 'water', gasMass: 0.9, liquidMass: 0.45, temperature: BASE_TEMPERATURE + 20 });
  createChildGridFromCell(parent, 0);
  const childMass = parent.childGrid.cells.reduce((sum, cell) => sum + cell.gasMass + cell.liquidMass, 0);
  approxEqual(childMass, 1.35, 1e-9);
});

test('subdivision keeps wheel centered in a 3x3 child grid', () => {
  const parent = createLeafCell({ wheel: { powered: true, direction: 1, spin: 0.6, torque: 0 }, fluidType: 'water', gasMass: 0.3, liquidMass: 0.6 });
  createChildGridFromCell(parent, 0);
  const centerCell = parent.childGrid.cells[coordToIndex(1, 1)];
  assert.ok(centerCell.wheel);
  assert.equal(parent.childGrid.cells.filter((cell) => cell.wheel).length, 1);
});

test('powered wheel direction changes local tangential flow sign', () => {
  const cwGrid = createGrid();
  setWheel(cwGrid, 1, 1, { powered: true, direction: 1, fluidType: 'air', gasMass: 0.3, liquidMass: 0 });
  ensureAggregate(cwGrid);
  simulationStep(createSimulationState({ rootGrid: cwGrid, externalPower: 5, autoExpand: false, autoCollapse: false }));
  const cwNeighbor = cwGrid.cells[coordToIndex(1, 0)];

  const ccwGrid = createGrid();
  setWheel(ccwGrid, 1, 1, { powered: true, direction: -1, fluidType: 'air', gasMass: 0.3, liquidMass: 0 });
  ensureAggregate(ccwGrid);
  simulationStep(createSimulationState({ rootGrid: ccwGrid, externalPower: 5, autoExpand: false, autoCollapse: false }));
  const ccwNeighbor = ccwGrid.cells[coordToIndex(1, 0)];

  assert.ok(Math.sign(cwNeighbor.velocityX) !== Math.sign(ccwNeighbor.velocityX));
});

test('copper conducts more heat than insulation over the same temperature gradient', () => {
  const copperGrid = createGrid();
  setFluid(copperGrid, 1, 1, { fluidType: 'air', gasMass: 0.8, liquidMass: 0, temperature: 520 });
  setWall(copperGrid, 2, 1, 'copper', 280);
  ensureAggregate(copperGrid);
  simulateGrid(copperGrid, createSimulationState({ rootGrid: copperGrid, autoExpand: false, autoCollapse: false }));
  const copperTemp = copperGrid.cells[coordToIndex(2, 1)].temperature;

  const insulationGrid = createGrid();
  setFluid(insulationGrid, 1, 1, { fluidType: 'air', gasMass: 0.8, liquidMass: 0, temperature: 520 });
  setWall(insulationGrid, 2, 1, 'insulation', 280);
  ensureAggregate(insulationGrid);
  simulateGrid(insulationGrid, createSimulationState({ rootGrid: insulationGrid, autoExpand: false, autoCollapse: false }));
  const insulationTemp = insulationGrid.cells[coordToIndex(2, 1)].temperature;

  assert.ok(copperTemp > insulationTemp);
});

test('powered wheel drives directional fluid flow (emergent pump)', () => {
  // A powered wheel should impart tangential momentum to surrounding fluid,
  // creating directional flow — no special pump code, just a wheel + physics.
  const grid = createGrid();
  clearGridToVoid(grid);
  for (let i = 0; i < CELL_COUNT; i += 1) {
    Object.assign(grid.cells[i], createLeafCell({ fluidType: 'water', gasMass: 0.12, liquidMass: 0.78, temperature: BASE_TEMPERATURE }));
  }
  setWheel(grid, GRID_CENTER, GRID_CENTER, { powered: true, direction: 1, fluidType: 'water', gasMass: 0.12, liquidMass: 0.78 });
  ensureAggregate(grid);

  const sim = createSimulationState({ rootGrid: grid, externalPower: 10, autoExpand: false, autoCollapse: false });
  for (let i = 0; i < 80; i += 1) simulationStep(sim);

  // Wheel should have spun up from power
  const centerWheel = grid.cells[coordToIndex(GRID_CENTER, GRID_CENTER)].wheel;
  assert.ok(centerWheel, 'wheel exists');
  assert.ok(centerWheel.spin > 0.1, `wheel spin ${centerWheel.spin} should be > 0.1`);

  // With CW rotation, neighbor above center gets pushed RIGHT (+X),
  // neighbor left of center gets pushed UP (-Y).
  const topVel = grid.cells[coordToIndex(GRID_CENTER, GRID_CENTER - 1)].velocityX;
  const leftVel = grid.cells[coordToIndex(GRID_CENTER - 1, GRID_CENTER)].velocityY;
  assert.ok(topVel > 0.05, `expected top neighbor to move right, got vx=${topVel.toFixed(3)}`);
  assert.ok(leftVel < -0.05, `expected left neighbor to move up, got vy=${leftVel.toFixed(3)}`);

  // Total fluid mass should be approximately conserved (some loss from phase change is OK)
  const mass = gatherLeafStats(grid).mass;
  approxEqual(mass, 0.9 * CELL_COUNT, 0.5);
});

test('wheel-driven circulation creates measurable flow pattern across the grid', () => {
  // A powered wheel should create directional flow in surrounding fluid,
  // demonstrating emergent pump behavior without any pump-specific code.
  const grid = createGrid();
  clearGridToVoid(grid);
  for (let i = 0; i < CELL_COUNT; i += 1) {
    Object.assign(grid.cells[i], createLeafCell({ fluidType: 'water', gasMass: 0.1, liquidMass: 0.82, temperature: BASE_TEMPERATURE }));
  }
  setWheel(grid, GRID_CENTER, GRID_CENTER, { powered: true, direction: 1, fluidType: 'water', gasMass: 0.1, liquidMass: 0.82 });
  ensureAggregate(grid);

  const sim = createSimulationState({ rootGrid: grid, externalPower: 10, autoExpand: false, autoCollapse: false });
  for (let i = 0; i < 100; i += 1) simulationStep(sim);

  // CW wheel pushes neighbors tangentially:
  //   top neighbor (1,0) → RIGHT  (+X)
  //   left neighbor (0,1) → UP    (-Y)
  //   bottom neighbor (1,2) → LEFT (-X)
  //   right neighbor (2,1) → DOWN (+Y)
  // This creates a clockwise circulation pattern.
  const topVx = grid.cells[coordToIndex(GRID_CENTER, 0)].velocityX;
  const bottomVx = grid.cells[coordToIndex(GRID_CENTER, GRID_SIZE - 1)].velocityX;
  const leftVy = grid.cells[coordToIndex(0, GRID_CENTER)].velocityY;
  const rightVy = grid.cells[coordToIndex(GRID_SIZE - 1, GRID_CENTER)].velocityY;

  // Top moving right, bottom moving left, left moving up, right moving down = CW circulation
  const cwCirculation = (topVx > 0.01) && (bottomVx < -0.01) && (leftVy < -0.01) && (rightVy > 0.01);
  assert.ok(cwCirculation,
    `expected CW circulation: top=${topVx.toFixed(3)} bottom=${bottomVx.toFixed(3)} left=${leftVy.toFixed(3)} right=${rightVy.toFixed(3)}`);

  // Wheel should have positive spin
  assert.ok(grid.cells[coordToIndex(GRID_CENTER, GRID_CENTER)].wheel.spin > 0.1);

  // Mass approximately conserved (100 ticks of circulation loses some to phase change)
  approxEqual(gatherLeafStats(grid).mass, 0.92 * CELL_COUNT, 0.8);
});

test('serialize/deserialize round-trip preserves cell properties', () => {
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
      wheel: cell.wheel ? {
        powered: cell.wheel.powered,
        direction: cell.wheel.direction,
        spin: cell.wheel.spin ?? 0,
        torque: cell.wheel.torque ?? 0,
        wheelAngle: cell.wheel.wheelAngle ?? 0,
      } : null,
    };
    if (cell.childGrid) {
      obj.childGrid = {
        level: cell.childGrid.level,
        cells: cell.childGrid.cells.map(serializeCell),
      };
    }
    return obj;
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

  // Build a complex grid with varied properties
  const src = createGrid();
  setWheel(src, 1, 1, { powered: true, direction: 1, fluidType: 'water', gasMass: 0.15, liquidMass: 0.65 });
  setFluid(src, 0, 1, { fluidType: 'refrigerant', gasMass: 0.4, liquidMass: 0.3, temperature: 260, velocityX: 0.5 });
  setWall(src, 1, 0, 'copper', 380);
  setFluid(src, 2, 2, { fluidType: 'air', gasMass: 0.7, liquidMass: 0, temperature: 500, velocityY: -0.8 });
  ensureAggregate(src);

  // Serialize
  const serialized = src.cells.map(serializeCell);
  assert.equal(serialized.length, CELL_COUNT);

  // Deserialize into a fresh grid
  const dst = createGrid();
  serialized.forEach((data, i) => deserializeCell(dst.cells[i], data));
  ensureAggregate(dst);

  // Compare key properties
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const a = src.cells[i];
    const b = dst.cells[i];
    approxEqual(a.gasMass, b.gasMass, 1e-9);
    approxEqual(a.liquidMass, b.liquidMass, 1e-9);
    approxEqual(a.temperature, b.temperature, 1e-9);
    assert.equal(a.materialType, b.materialType);
    assert.equal(a.fluidType, b.fluidType);
    assert.equal(!!a.wheel, !!b.wheel);
    if (a.wheel && b.wheel) {
      assert.equal(a.wheel.powered, b.wheel.powered);
      approxEqual(a.wheel.spin, b.wheel.spin, 1e-9);
    }
  }
});

test('undo stack preserves previous grid states', () => {
  const grid = createGrid();
  clearGridToVoid(grid);
  ensureAggregate(grid);

  // Simulate a paint action: snapshot before change
  function snapshot(g) {
    return g.cells.map((c) => ({
      mat: c.materialType,
      fl: c.fluidType,
      gm: c.gasMass,
      lm: c.liquidMass,
    }));
  }

  function applySnapshot(g, snap) {
    snap.forEach((s, i) => {
      g.cells[i].materialType = s.mat;
      g.cells[i].fluidType = s.fl;
      g.cells[i].gasMass = s.gm;
      g.cells[i].liquidMass = s.lm;
    });
  }

  const stack = [];
  const redoStack = [];

  // Paint action 1: add wheel
  stack.push(snapshot(grid));
  redoStack.length = 0;
  setWheel(grid, 1, 1, { powered: true, direction: 1 });

  // Paint action 2: add wall
  stack.push(snapshot(grid));
  redoStack.length = 0;
  setWall(grid, 0, 0, 'steel');

  // Paint action 3: add fluid
  stack.push(snapshot(grid));
  redoStack.length = 0;
  setFluid(grid, 2, 2, { fluidType: 'water', liquidMass: 0.9 });

  // Verify stack has 3 snapshots
  assert.equal(stack.length, 3);

  // Undo: pop from stack, push to redo
  redoStack.push(snapshot(grid));
  applySnapshot(grid, stack.pop());
  // After undo, cell (2,2) should NOT have water
  assert.notEqual(grid.cells[coordToIndex(2, 2)].fluidType, 'water');

  // Undo again
  redoStack.push(snapshot(grid));
  applySnapshot(grid, stack.pop());
  // After second undo, cell (0,0) should NOT be steel
  assert.notEqual(grid.cells[coordToIndex(0, 0)].materialType, 'steel');

  // Redo: pop from redo, push to stack
  stack.push(snapshot(grid));
  applySnapshot(grid, redoStack.pop());
  // After redo, cell (0,0) should be steel again
  assert.equal(grid.cells[coordToIndex(0, 0)].materialType, 'steel');

  // Max stack size enforcement
  for (let i = 0; i < 100; i += 1) {
    stack.push(snapshot(grid));
    if (stack.length > 50) stack.shift();
  }
  assert.ok(stack.length <= 50, 'stack capped at 50');
});



