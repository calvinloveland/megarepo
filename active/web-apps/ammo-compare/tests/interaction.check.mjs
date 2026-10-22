/**
 * Interaction check for the ammo comparison table, driven over the Chrome
 * DevTools Protocol with Node's built-in WebSocket — no Playwright install, and
 * no browser download (NixOS-hostile) required.
 *
 * It talks only to localhost: the page URL you start with `node server.mjs` and
 * the Chrome debugging port you pass in CDP_URL. No internet access is used, so
 * the check runs the same in an offline sandbox.
 *
 * Usage:
 *   node server.mjs &                                   # 5113
 *   google-chrome --headless=new --no-sandbox \
 *     --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/ammo-chrome about:blank &
 *   APP_URL=http://localhost:5113/ node tests/interaction.check.mjs
 */
import { AMMO } from '../data/ammo.js';
import { derive } from '../lib/ballistics.js';

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5113/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (async () => {
  try {
    return await (
      await fetch(`${CDP}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })
    ).json();
  } catch {
    console.error(`Cannot reach a local Chrome at ${CDP}.`);
    console.error('Start one first (see the usage block above); this check only uses localhost.');
    process.exit(2);
  }
})();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
};
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
}

await send('Runtime.enable');
await sleep(1200);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}
const firstLoadName = () => evaluate(`document.querySelector('tbody tr.row .load-name').textContent`);
const rowCount = () => evaluate(`document.querySelectorAll('tbody tr.row').length`);
const clickChip = (category) =>
  evaluate(`[...document.querySelectorAll('.chip')].find((c) => c.dataset.category === '${category}').click()`);
const clickHeader = (key) => evaluate(`document.querySelector('th[data-sort="${key}"]').click()`);

// Expectations come from the dataset, so adding a load never silently breaks
// the checks (and never lets a stale count pass either).
const withEnergy = AMMO.map((l) => ({ ...l, ...derive(l) }));
const hottest = withEnergy.reduce((a, b) => (b.energyFtLb > a.energyFtLb ? b : a));
const fastest = withEnergy.reduce((a, b) => (b.velocityFps > a.velocityFps ? b : a));
const slowest = withEnergy.reduce((a, b) => (b.velocityFps < a.velocityFps ? b : a));
const pistolCount = AMMO.filter((l) => l.category === 'pistol').length;

check('renders every load', (await rowCount()) === AMMO.length, `${await rowCount()} rows vs ${AMMO.length} loads`);
check('summary counts loads', (await evaluate(`document.getElementById('summary').textContent`)).includes(`Showing ${AMMO.length}`));
check('default sort is energy, highest first', (await firstLoadName()) === hottest.name, await firstLoadName());

await clickChip('pistol');
await sleep(150);
check('category chip filters rows', (await rowCount()) === pistolCount, await evaluate(`document.getElementById('summary').textContent`));
check('active chip is pressed', (await evaluate(`document.querySelector('.chip[data-category="pistol"]').getAttribute('aria-pressed')`)) === 'true');

await clickChip('all');
await sleep(120);
await clickHeader('velocityFps');
await sleep(120);
check('numeric sort starts descending', (await firstLoadName()) === fastest.name, await firstLoadName());
await clickHeader('velocityFps');
await sleep(120);
check('second click flips to ascending', (await firstLoadName()) === slowest.name, await firstLoadName());
check('aria-sort tracks the active column', (await evaluate(`document.querySelector('th[data-sort="velocityFps"]').getAttribute('aria-sort')`)) === 'ascending');
check('only one column carries aria-sort', (await evaluate(`document.querySelectorAll('th[aria-sort]').length`)) === 1);

await evaluate(`document.querySelector('tbody tr.row').click()`);
await sleep(150);
check('row click opens details', (await evaluate(`document.querySelectorAll('tbody tr.detail').length`)) === 1);
check(
  'details name the platforms',
  (await evaluate(`document.querySelector('tr.detail').textContent`)).includes(slowest.platforms[0]),
  slowest.platforms[0],
);
check(
  'details show reference metadata',
  (await evaluate(`document.querySelector('tr.detail').textContent`)).includes('Wikipedia cartridge table'),
);
check('expanded row is announced', (await evaluate(`document.querySelector('tbody tr.row').getAttribute('aria-expanded')`)) === 'true');
await evaluate(`document.querySelector('tbody tr.row').click()`);
await sleep(150);
check('second click closes details', (await evaluate(`document.querySelectorAll('tbody tr.detail').length`)) === 0);

// Rows carry reference metadata, not just the derived numbers.
check(
  'rows show an introduction year',
  (await evaluate(`document.querySelector('tbody tr.row .col-introduced').textContent`)).trim().length === 4,
);
check(
  'rows show origin and dimensions under the name',
  (await evaluate(`document.querySelector('tbody tr.row .load-sub').textContent`)).includes('bullet'),
);
check(
  'rows show the usual bullet weight range',
  (await evaluate(`
    [...document.querySelectorAll('tbody tr.row .col-bullet .sub')].some((el) => /\\d+(\\.\\d+)?–\\d+(\\.\\d+)? gr/.test(el.textContent))
  `)) === true,
);

await evaluate(`(() => { const s = document.getElementById('units'); s.value = 'metric'; s.dispatchEvent(new Event('change')); })()`);
await sleep(150);
check('metric mode shows joules', (await evaluate(`document.querySelector('tbody tr.row td.energy').textContent`)).includes('J'));
check('metric mode shows m/s', (await evaluate(`document.querySelector('tbody tr.row .col-velocity').textContent`)).includes('m/s'));

// Prices exist only for curated, currently-produced loads; reference rows are
// deliberately unpriced and must sort to the bottom.
await clickHeader('costPerRound');
await sleep(150);
check(
  'cost sort starts with a priced load',
  (await evaluate(`document.querySelector('tbody tr.row .col-cost').textContent`)).includes('$'),
);
check(
  'cost sort sinks unpriced loads',
  (await evaluate(`[...document.querySelectorAll('tbody tr.row .col-cost')].at(-1).textContent`)).trim() === '—',
);
check(
  'reference rows render an unpriced dash',
  (await evaluate(`
    [...document.querySelectorAll('tbody tr.row')].slice(-20).every((row) => row.querySelector('.col-cost').textContent.trim() === '—')
  `)) === true,
);

await evaluate(`(() => { const s = document.getElementById('units'); s.value = 'imperial'; s.dispatchEvent(new Event('change')); })()`);
await evaluate(`(() => { const i = document.getElementById('search'); i.value = 'shotgun'; i.dispatchEvent(new Event('input')); })()`);
await sleep(150);
const shotgunCount = AMMO.filter(
  (l) => l.category === 'shotgun' || l.platforms.join(' ').toLowerCase().includes('shotgun'),
).length;
check('search matches category and platform text', (await rowCount()) === shotgunCount, `${await rowCount()} vs ${shotgunCount}`);

await evaluate(`(() => { const i = document.getElementById('search'); i.value = 'zzzz'; i.dispatchEvent(new Event('input')); })()`);
await sleep(150);
check(
  'no matches shows an empty state',
  (await evaluate(`document.querySelectorAll('tbody tr').length`)) === 1 &&
    (await evaluate(`document.querySelector('.empty')?.textContent ?? ''`)).includes('No loads match'),
);

const failures = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  → ${r.detail ?? ''}`}`);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
ws.close();
process.exit(failures.length ? 1 : 0);
