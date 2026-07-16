import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('host-side firmware consumer stub compiles and runs with gcc in nix-shell', () => {
  const hostDir = resolve(process.cwd(), 'firmware/host');
  const run = spawnSync('nix-shell', ['-p', 'gcc', '--run', `cd '${hostDir}' && make clean && make && ./consume_example_test`], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `host firmware stub build/run failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
});
test('host-side DSP port compiles and recovers a known TOA delay', () => {
  const hostDir = resolve(process.cwd(), 'firmware/host');
  const run = spawnSync('nix-shell', ['-p', 'gcc', '--run', `cd '${hostDir}' && make test_dsp && ./test_dsp`], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `C DSP test failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.match(run.stdout, /OK: TOA within threshold/);
});
