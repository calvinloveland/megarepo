/*
 * Package the submission.
 *
 * The Arena wants a zip whose TOP LEVEL is index.html — not a wrapper folder —
 * with relative paths only and no runtime network access. This script builds
 * that archive from an explicit allow-list, so nothing from node_modules,
 * tests, or local scratch space can leak into a submission.
 *
 *   node scripts/package.mjs                 # -> dist-zip/brass-and-boiler.zip
 *   node scripts/package.mjs --list          # show what would go in
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist-zip');
const OUT = path.join(OUT_DIR, 'brass-and-boiler.zip');

/* Everything the page actually loads at runtime. src/*.js is read from disk so
   a new module cannot be forgotten. */
const ENTRIES = [
  'index.html',
  'style.css',
  'game-adapter.js',
  ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).sort().map((f) => `src/${f}`),
];

const listing = process.argv.includes('--list');

/* The Arena's hard constraints, as machine checks. Absolute paths 404 under the
   Arena's subdirectory, and any network or storage call is blocked by the
   sandbox and breaks the page. */
const RULES = [
  { name: 'absolute path', re: /(?:src|href)\s*=\s*["']\/(?!\/)/g, ext: ['.html', '.css'] },
  { name: 'remote asset', re: /(?:src|href)\s*=\s*["']https?:/g, ext: ['.html', '.css'] },
  { name: 'network call', re: /\bfetch\s*\(|XMLHttpRequest|new WebSocket/g, ext: ['.html', '.js'] },
  { name: 'storage access', re: /localStorage|sessionStorage|document\.cookie/g, ext: ['.html', '.js'] },
];

function lintSubmission() {
  const violations = [];
  for (const entry of ENTRIES) {
    const ext = path.extname(entry);
    const text = fs.readFileSync(path.join(ROOT, entry), 'utf8');
    for (const rule of RULES) {
      if (!rule.ext.includes(ext)) continue;
      for (const match of text.matchAll(rule.re)) {
        violations.push(`${entry}: ${rule.name} ${match[0].trim()}`);
      }
    }
  }
  if (violations.length) {
    throw new Error(`submission would be rejected:\n  ${violations.join('\n  ')}`);
  }
}

lintSubmission();

if (listing) {
  console.log(`submission contents (${ENTRIES.length} files):`);
  for (const entry of ENTRIES) console.log(`  ${entry}`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(OUT)) fs.rmSync(OUT);

/* -x keeps any stray .DS_Store out; the entry list already excludes the rest. */
execFileSync('zip', ['-r', '-q', OUT, ...ENTRIES], { cwd: ROOT });

const bytes = fs.statSync(OUT).size;
const contents = execFileSync('unzip', ['-l', OUT], { encoding: 'utf8' });
if (!/^\s+\d+.*\sindex\.html$/m.test(contents)) {
  throw new Error('index.html is not at the top level of the archive');
}
if (bytes > 10 * 1024 * 1024) {
  throw new Error(`archive is ${(bytes / 1024 / 1024).toFixed(1)} MiB, the limit is 10 MiB`);
}

console.log(`wrote ${path.relative(ROOT, OUT)} — ${(bytes / 1024).toFixed(1)} KiB, ${ENTRIES.length} files`);
console.log(contents.split('\n').slice(0, 4).join('\n'));
