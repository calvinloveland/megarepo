import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function loadPromptTemplate() {
  const filePath = path.resolve(__dirname, '..', '..', '..', '..', 'material_gen', 'prompt_templates.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

test('material prompt includes rich examples', async () => {
  const templates = loadPromptTemplate();
  const prompt = String(templates?.create_material || '');
  expect(prompt.length).toBeGreaterThan(0);
  expect(prompt).toContain('Examples:');

  const exampleLines = prompt.split(/\r?\n/).filter((line) => line.includes('=>'));
  expect(exampleLines.length).toBeGreaterThanOrEqual(6);

  expect(prompt).toContain('"tags":["sand"]');
  expect(prompt).toContain('"tags":["flow"]');
  expect(prompt).toContain('"tags":["float"]');
  expect(prompt).toContain('"tags":["static"]');
});
