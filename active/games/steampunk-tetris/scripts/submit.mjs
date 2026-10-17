/*
 * Submit to the Arena.
 *
 * The token is never passed on the command line or typed into chat: it is read
 * from disk (repo convention — see the root AGENTS.md "Secrets and Credentials").
 *
 *   mkdir -p .secrets && printf '%s' "$TOKEN" > .secrets/tetris-arena.token
 *   node scripts/submit.mjs                 # game + both bots
 *   node scripts/submit.mjs --game          # just the game
 *   node scripts/submit.mjs --bots          # just the bots
 *   node scripts/submit.mjs --dry-run       # show the requests, send nothing
 *
 * Token lookup order: --token-file, $TETRIS_ARENA_TOKEN, .secrets/tetris-arena.token
 * (repo root), ~/.secrets/tetris-arena.token.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARENA = process.env.TETRIS_ARENA || 'https://tetris-arena.ian-m-karlinsey.workers.dev';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const dryRun = argv.includes('--dry-run');
const onlyGame = argv.includes('--game');
const onlyBots = argv.includes('--bots');

function token() {
  const candidates = [
    flag('token-file', null),
    path.join(ROOT, '.secrets', 'tetris-arena.token'),
    path.join(ROOT, '..', '..', '.secrets', 'tetris-arena.token'),
    path.join(os.homedir(), '.secrets', 'tetris-arena.token'),
  ].filter(Boolean);
  if (process.env.TETRIS_ARENA_TOKEN) return process.env.TETRIS_ARENA_TOKEN.trim();
  for (const candidate of candidates) {
    try {
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value) return value;
    } catch { /* not there */ }
  }
  throw new Error(`no token found. Write it to ${path.relative(ROOT, path.join(ROOT, '.secrets', 'tetris-arena.token'))} first.`);
}

const UPLOADS = [
  { kind: 'game', name: 'Brass & Boiler', path: path.join(ROOT, 'dist-zip', 'brass-and-boiler.zip'), prepare: true },
  { kind: 'bot', name: 'Boiler Stoker', path: path.join(ROOT, 'bots', 'dist', 'boiler-stoker.js') },
  { kind: 'bot', name: 'Four-Line Fanatic', path: path.join(ROOT, 'bots', 'dist', 'four-line-fanatic.js') },
];

let uploads = UPLOADS;
if (onlyGame) uploads = uploads.filter((u) => u.kind === 'game');
if (onlyBots) uploads = uploads.filter((u) => u.kind === 'bot');

if (uploads.some((u) => u.prepare)) {
  execFileSync('node', [path.join(ROOT, 'scripts', 'package.mjs')], { cwd: ROOT, stdio: 'inherit' });
}
execFileSync('node', [path.join(ROOT, 'scripts', 'build-bots.mjs'), '--check'], { cwd: ROOT, stdio: 'inherit' });

const auth = dryRun ? 'Bearer <token>' : `Bearer ${token()}`;

for (const upload of uploads) {
  const url = `${ARENA}/api/submit/${upload.kind}`;
  console.log(`\n${upload.kind}: ${upload.name} <- ${path.relative(ROOT, upload.path)}`);
  if (dryRun) {
    console.log(`  curl -s -X POST ${url} -H "authorization: ${auth}" -F "name=${upload.name}" -F "file=@${path.relative(ROOT, upload.path)}"`);
    continue;
  }
  const form = new FormData();
  form.set('name', upload.name);
  form.set('file', new Blob([fs.readFileSync(upload.path)]), path.basename(upload.path));
  const res = await fetch(url, { method: 'POST', headers: { authorization: auth }, body: form });
  const body = await res.text();
  console.log(`  ${res.status} ${body.slice(0, 600)}`);
  if (!res.ok) process.exitCode = 1;
}
