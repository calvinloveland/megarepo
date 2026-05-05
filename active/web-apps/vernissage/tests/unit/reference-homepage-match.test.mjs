import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  getChromiumLaunchOptions,
  getCompareScriptPath,
  getDefaultOutputDir,
  getDefaultReferenceImage,
  writeSummary
} from '../../scripts/reference-homepage-match.mjs';

test('reference homepage match helpers point at the expected defaults', () => {
  assert.equal(getDefaultReferenceImage(), '/home/calvin/Downloads/vernissage_homepage.png');
  assert.equal(getDefaultOutputDir('/tmp/demo'), '/tmp/demo/artifacts/reference-homepage');
  assert.ok(getCompareScriptPath('/tmp/repo').endsWith('personal/calnix/pi-skills/pi-extension-testing/scripts/compare_pi_screenshots.py'));
  const launchOptions = getChromiumLaunchOptions();
  assert.deepEqual(launchOptions.args, ['--no-sandbox']);
});

test('writeSummary writes a readable markdown artifact', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'vernissage-reference-match-'));
  writeSummary({
    outputDir,
    url: 'http://127.0.0.1:3000/reference-homepage',
    referenceImage: '/home/calvin/Downloads/vernissage_homepage.png',
    screenshotPath: resolve(outputDir, 'render.png'),
    diffStats: {
      changed_pixels: 123,
      changed_ratio: 0.12,
      bbox: { left: 1, top: 2, right: 3, bottom: 4 }
    }
  });

  const summaryPath = resolve(outputDir, 'README.md');
  assert.equal(existsSync(summaryPath), true);
  const text = readFileSync(summaryPath, 'utf-8');
  assert.match(text, /Reference Homepage Match Report/);
  assert.match(text, /Changed pixels: `123`/);
  assert.match(text, /render\.png/);
  assert.match(text, /diff\.json/);
});
