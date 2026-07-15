import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWireExampleHeader } from '../src/firmware-c-example.mjs';

const hostDir = resolve(process.cwd(), 'firmware/host');

test('generated C example header declares rows and arrival arrays', () => {
  const txt = renderWireExampleHeader();
  assert.match(txt, /ESP_ARRAY_EXAMPLE_ROW_0_ARRIVALS/);
  assert.match(txt, /ESP_ARRAY_EXAMPLE_ROWS\[]/);
  assert.match(txt, /ESP_ARRAY_EXAMPLE_ROW_COUNT/);
});

test('host-side consumer stub includes the generated example header', () => {
  const txt = readFileSync(resolve(hostDir, 'consume_example.c'), 'utf8');
  assert.match(txt, /#include "esp_array_wire_example.h"/);
  assert.match(txt, /esp_array_consume_example/);
});