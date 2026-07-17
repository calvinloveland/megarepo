import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();

function read(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

test('bootstrap script pins an ESP-IDF version and uses a project-local checkout path', () => {
  const txt = read('bin/bootstrap-esp-idf.sh');
  assert.match(txt, /ESP_IDF_VERSION="v5\.2\.2"/);
  assert.match(txt, /\.esp-idf\/esp-idf/);
  assert.match(txt, /IDF_TOOLS_PATH=.*\.esp-idf\/tools/);
  assert.match(txt, /install\.sh esp32/);
});

test('shell.nix exposes IDF_PATH when a local checkout exists', () => {
  const txt = read('shell.nix');
  assert.match(txt, /export IDF_PATH=.*\.esp-idf\/esp-idf/);
  assert.match(txt, /export IDF_TOOLS_PATH=.*\.esp-idf\/tools/);
  assert.match(txt, /bootstrap-esp-idf\.sh --checkout-only/);
});

test('bootstrap script is syntactically valid bash', () => {
  const run = spawnSync('bash', ['-n', resolve(root, 'bin/bootstrap-esp-idf.sh')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('shell.nix evaluates and can expose the local ESP-IDF checkout path', () => {
  const run = spawnSync('nix-shell', ['--run', 'printf "%s\n" "${IDF_PATH:-unset}"'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /(\.esp-idf\/esp-idf|unset)/);
});