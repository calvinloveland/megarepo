import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

test('firmware backend implementation file exists', () => {
  const txt = readFileSync(resolve(root, 'firmware/main/esp_array_backend.c'), 'utf8');
  assert.match(txt, /esp_array_sync_clocks/);
  assert.match(txt, /esp_array_make_plan/);
  assert.match(txt, /esp_array_capture_listener_rows/);
  assert.match(txt, /esp_array_gossip_listener_rows/);
});

test('firmware main CMakeLists registers the backend implementation', () => {
  const txt = readFileSync(resolve(root, 'firmware/main/CMakeLists.txt'), 'utf8');
  assert.match(txt, /esp_array_backend\.c/);
});
