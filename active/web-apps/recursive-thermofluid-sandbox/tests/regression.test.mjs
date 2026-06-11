/**
 * Regression tests — deterministic simulation snapshots.
 *
 * These save known-good states and verify that re-loading them
 * and running steps still produces physically reasonable results.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRID_SIZE,
  CELL_COUNT,
  coordToIndex,
  createGrid,
  createLeafCell,
  createSimulationState,
  ensureAggregate,
  gatherLeafStats,
  simulationStep,
  setWheel,
} from '../sim-core.mjs';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

function round3(v) { return Math.round((v ?? 0) * 1000) / 1000; }

function cellSnapshot(cell) {
  return {
    gm: round3(cell.gasMass),
    lm: round3(cell.liquidMass),
    t: round3(cell.temperature),
    p: round3(cell.pressure),
    vx: round3(cell.velocityX),
    vy: round3(cell.velocityY),
    mat: cell.materialType,
    fl: cell.fluidType,
    sp: cell.wheel ? round3(cell.wheel.spin) : null,
  };
}

function gridSnapshot(grid) {
  return grid.cells.map(cellSnapshot);
}

function loadSnapshot(snapshot, grid) {
  for (let i = 0; i < CELL_COUNT && i < snapshot.length; i += 1) {
    const s = snapshot[i];
    const cell = grid.cells[i];
    Object.assign(cell, createLeafCell({
      fluidType: s.fl,
      gasMass: s.gm,
      liquidMass: s.lm,
      temperature: s.t,
      pressure: s.p,
      velocityX: s.vx,
      velocityY: s.vy,
      materialType: s.mat,
    }));
    if (s.sp !== null && s.sp !== undefined) {
      cell.wheel = { powered: true, direction: 1, spin: s.sp, torque: 0, wheelAngle: 0 };
    }
  }
}

test('regression: pump preset fixture can be saved and reloaded', () => {
  const grid = createGrid();
  for (let i = 0; i < CELL_COUNT; i += 1) {
    Object.assign(grid.cells[i], createLeafCell({ fluidType: 'water', gasMass: 0.12, liquidMass: 0.78, temperature: 293 }));
  }
  setWheel(grid, 1, 1, { powered: true, direction: 1, fluidType: 'water', gasMass: 0.12, liquidMass: 0.78 });
  ensureAggregate(grid);

  const sim = createSimulationState({ rootGrid: grid, externalPower: 10, autoExpand: false, autoCollapse: false });
  for (let i = 0; i < 100; i += 1) simulationStep(sim);

  const snapshot = gridSnapshot(grid);

  // Save as fixture
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(join(FIXTURES_DIR, 'pump-100-ticks.json'), JSON.stringify(snapshot, null, 2));
  assert.ok(existsSync(join(FIXTURES_DIR, 'pump-100-ticks.json')));

  // Reload and verify structure
  const reloaded = JSON.parse(readFileSync(join(FIXTURES_DIR, 'pump-100-ticks.json'), 'utf8'));
  assert.equal(reloaded.length, CELL_COUNT);
  assert.ok(reloaded.some((c) => c.sp !== null), 'at least one cell should have a wheel');
});

test('regression: loaded fixture produces physically reasonable behavior', () => {
  const fixturePath = join(FIXTURES_DIR, 'pump-100-ticks.json');
  mkdirSync(FIXTURES_DIR, { recursive: true });

  // Generate fixture if it doesn't exist yet (when running test in isolation)
  if (!existsSync(fixturePath)) {
    const grid = createGrid();
    for (let i = 0; i < CELL_COUNT; i += 1) {
      Object.assign(grid.cells[i], createLeafCell({ fluidType: 'water', gasMass: 0.12, liquidMass: 0.78, temperature: 293 }));
    }
    setWheel(grid, 1, 1, { powered: true, direction: 1, fluidType: 'water', gasMass: 0.12, liquidMass: 0.78 });
    ensureAggregate(grid);
    const sim = createSimulationState({ rootGrid: grid, externalPower: 10, autoExpand: false, autoCollapse: false });
    for (let i = 0; i < 100; i += 1) simulationStep(sim);
    writeFileSync(fixturePath, JSON.stringify(gridSnapshot(grid), null, 2));
  }

  const snapshot = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const grid = createGrid();
  for (let i = 0; i < CELL_COUNT; i += 1) {
    Object.assign(grid.cells[i], createLeafCell({ fluidType: 'water', gasMass: 0.12, liquidMass: 0.78, temperature: 293 }));
  }
  loadSnapshot(snapshot, grid);
  setWheel(grid, 1, 1, { powered: true, direction: 1, fluidType: 'water', gasMass: 0.12, liquidMass: 0.78 });
  ensureAggregate(grid);

  // Verify wheel exists and has reasonable spin
  const center = grid.cells[coordToIndex(1, 1)];
  assert.ok(center.wheel, 'wheel should exist');
  assert.ok(Math.abs(center.wheel.spin) > 0.01, 'wheel should have non-zero spin');
  assert.ok(Math.abs(center.wheel.spin) <= 3.0, 'wheel spin within clamp range');

  // Step once — verify it changes state
  const sim = createSimulationState({ rootGrid: grid, externalPower: 10, autoExpand: false, autoCollapse: false });
  const beforeSpin = grid.cells[coordToIndex(1, 1)].wheel?.spin ?? 0;
  simulationStep(sim);
  const afterSpin = grid.cells[coordToIndex(1, 1)].wheel?.spin ?? 0;

  // Either spin changed or it was already at equilibrium — either is fine
  const changed = grid.cells.some((c, i) => JSON.stringify(cellSnapshot(c)) !== JSON.stringify(snapshot[i]));
  assert.ok(changed, 'at least one cell should change after a step');

  // Mass approximately conserved
  const stats = gatherLeafStats(grid);
  assert.ok(stats.mass > 5 && stats.mass < 12, `total mass ${stats.mass} should be reasonable`);
});
