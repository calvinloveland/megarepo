import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function loadAppSource() {
  const filePath = path.resolve(__dirname, '..', '..', '..', 'src', 'ui', 'app.ts');
  return fs.readFileSync(filePath, 'utf-8');
}

function countExampleLines(source: string, label: string) {
  const sectionIndex = source.indexOf(label);
  if (sectionIndex === -1) return 0;
  const slice = source.slice(sectionIndex, sectionIndex + 1200);
  return slice.split(/\r?\n/).filter((line) => line.includes('=>')).length;
}

test('mix prompts use rich example lists', async () => {
  const source = loadAppSource();
  expect(source.length).toBeGreaterThan(0);

  expect(countExampleLines(source, 'const mixTagExamples')).toBeGreaterThanOrEqual(8);
  expect(countExampleLines(source, 'const mixDensityExamples')).toBeGreaterThanOrEqual(8);
  expect(countExampleLines(source, 'const mixColorExamples')).toBeGreaterThanOrEqual(8);
  expect(countExampleLines(source, 'const mixDescriptionExamples')).toBeGreaterThanOrEqual(8);
});
