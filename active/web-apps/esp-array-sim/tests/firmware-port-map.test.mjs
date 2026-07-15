import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRMWARE_PORT_MAP } from '../src/firmware-port-map.mjs';

test('firmware port map has unique simulator modules and non-empty fields', () => {
  const mods = FIRMWARE_PORT_MAP.map((x) => x.simModule);
  assert.equal(new Set(mods).size, mods.length);
  for (const row of FIRMWARE_PORT_MAP) {
    assert.ok(row.simModule);
    assert.ok(row.firmwareComponent);
    assert.ok(row.responsibility);
  }
});

test('firmware port map covers the critical distributed-calibration path', () => {
  const mods = new Set(FIRMWARE_PORT_MAP.map((x) => x.simModule));
  for (const key of [
    'src/calibration-config.mjs',
    'src/firmware-protocol.mjs',
    'src/firmware-backend.mjs',
    'src/capture.mjs',
    'src/dsp.mjs',
    'src/mesh.mjs',
    'src/localize.mjs',
    'src/scenario.mjs',
  ]) assert.ok(mods.has(key), `${key} must be covered`);
});

test('render/app are explicitly marked as non-firmware or tooling concerns', () => {
  const render = FIRMWARE_PORT_MAP.find((x) => x.simModule === 'src/render.mjs');
  const app = FIRMWARE_PORT_MAP.find((x) => x.simModule === 'app.js');
  assert.match(render.responsibility, /validation oracle/i);
  assert.match(app.responsibility, /control\/debug surface/i);
});