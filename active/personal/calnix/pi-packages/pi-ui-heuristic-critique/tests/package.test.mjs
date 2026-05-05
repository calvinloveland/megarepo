import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(packageDir, 'README.md'), 'utf8');
const prompt = fs.readFileSync(path.join(packageDir, 'prompts', 'ui-heuristic-critique.md'), 'utf8');

test('package manifest exposes only prompts for Pi', () => {
  assert.equal(packageJson.name, 'pi-ui-heuristic-critique');
  assert.deepEqual(packageJson.pi, { prompts: ['./prompts'] });
  assert.deepEqual(packageJson.files, ['prompts', 'README.md', 'LICENSE']);
  assert.ok(packageJson.keywords.includes('pi-package'));
  assert.ok(packageJson.keywords.includes('pi-prompt-template'));
});

test('readme describes prompt-only screenshot-first workflow', () => {
  assert.match(readme, /Prompt-only Pi package/i);
  assert.match(readme, /\/ui-heuristic-critique/);
  assert.match(readme, /\/ui-heuristic-score/);
  assert.match(readme, /screenshot/i);
});

test('prompt enforces screenshot-first heuristic critique structure', () => {
  assert.match(prompt, /^---[\s\S]*description:/);
  assert.match(prompt, /Work screenshot-first\./);
  assert.match(prompt, /If no screenshot or visual artifact is available, say the critique is lower confidence/i);
  assert.match(prompt, /Key issues/);
  assert.match(prompt, /Severity/);
  assert.match(prompt, /Recommended change/);
});

test('score prompt exists for machine-friendly severity scoring', () => {
  const scorePrompt = fs.readFileSync(path.join(packageDir, 'prompts', 'ui-heuristic-score.md'), 'utf8');
  assert.match(scorePrompt, /Overall score: `0-100`/);
  assert.match(scorePrompt, /Ship decision/);
  assert.match(scorePrompt, /blocker \| major \| minor \| nit/);
});
