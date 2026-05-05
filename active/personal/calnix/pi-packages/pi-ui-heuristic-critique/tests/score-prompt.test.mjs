import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const prompt = fs.readFileSync(path.join(packageDir, 'prompts', 'ui-heuristic-score.md'), 'utf8');

test('score prompt defines a screenshot-first scoring rubric', () => {
  assert.match(prompt, /^---[\s\S]*description:/);
  assert.match(prompt, /Work screenshot-first\./);
  assert.match(prompt, /Overall score: `0-100`/);
  assert.match(prompt, /blocker \| major \| minor \| nit/);
  assert.match(prompt, /Ship decision/);
  assert.match(prompt, /ab_test_visuals/);
  assert.match(prompt, /captureRationale: true/);
});
