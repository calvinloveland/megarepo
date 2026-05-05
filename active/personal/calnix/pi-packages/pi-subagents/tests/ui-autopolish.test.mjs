import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const prompt = fs.readFileSync(path.join(packageDir, 'prompts', 'ui-autopolish.md'), 'utf8');
const readme = fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8');

test('ui-autopolish prompt defines a bounded worker/reviewer chain', () => {
  assert.match(prompt, /^---[\s\S]*description:/);
  assert.match(prompt, /worker/);
  assert.match(prompt, /reviewer/);
  assert.match(prompt, /artifacts\/ui-regression/);
  assert.match(prompt, /ab_test_visuals/);
  assert.match(prompt, /captureRationale: true/);
  assert.match(prompt, /at most two worker passes/);
});

test('README mentions the ui-autopolish workflow prompt', () => {
  assert.match(readme, /\/ui-autopolish/);
});
