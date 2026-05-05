#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

export function getDefaultReferenceImage() {
  return '/home/calvin/Downloads/vernissage_homepage.png';
}

export function getDefaultOutputDir(cwd = process.cwd()) {
  return resolve(cwd, 'artifacts/reference-homepage');
}

export function getCompareScriptPath(cwd = process.cwd()) {
  return resolve(cwd, '../../personal/calnix/pi-skills/pi-extension-testing/scripts/compare_pi_screenshots.py');
}

export function getChromiumLaunchOptions() {
  const localChromePath = '/run/current-system/sw/bin/google-chrome-stable';
  return {
    headless: true,
    args: ['--no-sandbox'],
    ...(existsSync(localChromePath) ? { executablePath: localChromePath } : {})
  };
}

export async function captureReferenceHomepage({ url, screenshotPath }) {
  const browser = await chromium.launch(getChromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await browser.close();
}

export function runCompare({ compareScript, referenceImage, screenshotPath, outputDir }) {
  const proc = spawnSync('python3', [compareScript, referenceImage, screenshotPath, '--output-dir', outputDir], {
    encoding: 'utf-8'
  });
  if (proc.status !== 0) {
    throw new Error((proc.stderr || proc.stdout || 'compare script failed').trim());
  }
  return JSON.parse(proc.stdout);
}

export function writeSummary({ outputDir, url, referenceImage, screenshotPath, diffStats }) {
  const summaryPath = resolve(outputDir, 'README.md');
  writeFileSync(
    summaryPath,
    `# Reference Homepage Match Report\n\n` +
      `- URL: \`${url}\`\n` +
      `- Reference image: \`${referenceImage}\`\n` +
      `- Render screenshot: \`${screenshotPath}\`\n` +
      `- Changed pixels: \`${diffStats.changed_pixels}\`\n` +
      `- Changed ratio: \`${diffStats.changed_ratio}\`\n` +
      `- Bounding box: \`${JSON.stringify(diffStats.bbox)}\`\n\n` +
      `Generated files:\n\n` +
      `- render.png\n- diff.png\n- diff.json\n`,
    'utf-8'
  );
}

async function main() {
  const cwd = process.cwd();
  const url = process.argv[2] || 'http://127.0.0.1:3000/reference-homepage';
  const referenceImage = process.argv[3] || getDefaultReferenceImage();
  const outputDir = process.argv[4] || getDefaultOutputDir(cwd);
  const compareScript = getCompareScriptPath(cwd);
  mkdirSync(outputDir, { recursive: true });
  const screenshotPath = resolve(outputDir, 'render.png');

  await captureReferenceHomepage({ url, screenshotPath });
  const diffStats = runCompare({ compareScript, referenceImage, screenshotPath, outputDir });
  writeSummary({ outputDir, url, referenceImage, screenshotPath, diffStats });
  process.stdout.write(JSON.stringify(diffStats, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
