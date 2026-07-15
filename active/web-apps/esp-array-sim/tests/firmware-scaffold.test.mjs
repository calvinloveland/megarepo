import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'firmware');

function read(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

test('firmware root CMakeLists declares an ESP-IDF project', () => {
  const txt = read('CMakeLists.txt');
  assert.match(txt, /project\(esp_array_node\)/);
  assert.match(txt, /project\.cmake/);
});

test('firmware main component scaffold points at the generated main source', () => {
  const txt = read('main/CMakeLists.txt');
  assert.match(txt, /idf_component_register/);
  assert.match(txt, /esp_array_main\.c/);
});

test('firmware component metadata and sdkconfig defaults exist', () => {
  const component = read('main/idf_component.yml');
  const sdkconfig = read('sdkconfig.defaults');
  assert.match(component, /ESP Array node firmware skeleton/);
  assert.match(component, /idf:/);
  assert.match(sdkconfig, /Placeholder ESP-IDF defaults/);
});