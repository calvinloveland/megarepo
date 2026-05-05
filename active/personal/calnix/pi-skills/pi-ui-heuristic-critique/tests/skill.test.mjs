import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, '..');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const reference = fs.readFileSync(path.join(skillDir, 'references', 'ui-heuristic-critique.md'), 'utf8');

test('skill frontmatter matches directory and describes usage', () => {
  assert.match(skill, /^---[\s\S]*name: pi-ui-heuristic-critique/m);
  assert.match(skill, /description: Guide Pi through screenshot-first heuristic UI critiques\./);
  assert.match(skill, /\/ui-heuristic-critique/);
});

test('skill references the companion doc and screenshot-first flow', () => {
  assert.match(skill, /Ask for or inspect screenshots first/i);
  assert.match(skill, /references\/ui-heuristic-critique\.md/);
  assert.match(skill, /If no screenshot is available, say that confidence is lower/i);
});

test('reference doc contains the expected heuristic checklist', () => {
  assert.match(reference, /Screenshot-first workflow/);
  assert.match(reference, /### 1\. Clarity and purpose/);
  assert.match(reference, /### 8\. Density and responsiveness/);
  assert.match(reference, /Avoid generic advice/i);
});
