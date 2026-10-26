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
import { INVENTORS } from '../data/inventors.js';
import { recoilProfile } from '../lib/recoil.js';
import { matchesJurisdiction, restrictionsFor } from '../lib/legality.js';

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
// The table sheds columns below 1500 px; use a desktop viewport so the
// designer and range columns are present for these checks.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
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
check(
  'every row draws a cartridge silhouette',
  (await evaluate(`document.querySelectorAll('tbody tr.row td.col-svg svg.cart').length`)) === AMMO.length,
);
check(
  'silhouettes share one viewBox',
  (await evaluate(`new Set([...document.querySelectorAll('td.col-svg svg')].map((s) => s.getAttribute('viewBox'))).size`)) === 1,
);
check('default sort is energy, highest first', (await firstLoadName()) === hottest.name, await firstLoadName());

/* --------------------------------- recoil --------------------------------- */

const recoilOf = (id) =>
  evaluate(`(() => {
    const cell = document.querySelector('tbody tr.row[data-id="${id}"] td.col-recoil');
    return {
      label: cell.querySelector('.label').textContent,
      filled: 5 - cell.querySelectorAll('span.off').length,
      title: cell.querySelector('.label').title,
    };
  })()`);
const recoil380 = await recoilOf('380acp');
const recoil9mm = await recoilOf('9mm');
check('recoil is shown in derived units', /ft·lb$/.test(recoil380.label), recoil380.label);
check('recoil names the reference gun', /2 lb pistol/.test(recoil380.title), recoil380.title);
check(
  'recoil now separates .380 ACP from 9mm',
  recoil380.filled < recoil9mm.filled,
  `.380 ${recoil380.filled}/5 vs 9mm ${recoil9mm.filled}/5`,
);
check(
  'derived recoil matches the library',
  recoil9mm.label === `${recoilProfile(AMMO.find((l) => l.id === '9mm')).recoilFtLb.toFixed(1)} ft·lb`,
  recoil9mm.label,
);
await clickHeader('recoilFtLb');
await sleep(150);
check(
  'recoil sorts hardest first',
  (await firstLoadName()) === AMMO.map((l) => ({ ...l, ...recoilProfile(l) })).reduce((a, b) => (b.recoilFtLb > a.recoilFtLb ? b : a)).name,
  await firstLoadName(),
);
await clickHeader('recoilFtLb');
await sleep(150);
check('recoil sorts gentlest first', (await firstLoadName()) === '2 mm Kolibri', await firstLoadName());

/* ------------------------------- jurisdiction ------------------------------ */

const setJurisdiction = (code) =>
  evaluate(`(() => {
    const select = document.getElementById('jurisdiction');
    select.value = ${JSON.stringify(code)};
    select.dispatchEvent(new Event('change'));
  })()`);

check(
  'restricted rows carry a jurisdiction badge',
  (await evaluate(`document.querySelector('tbody tr.row[data-id="9mm"] .law-badge')?.textContent`)) === 'MX IT',
  await evaluate(`document.querySelector('tbody tr.row[data-id="9mm"] .law-badge')?.textContent`),
);
check(
  'unrestricted rows carry no badge',
  (await evaluate(`document.querySelector('tbody tr.row[data-id="380acp"] .law-badge')`)) === null,
);

await setJurisdiction('MX');
await sleep(200);
const legalInMx = AMMO.filter((load) => matchesJurisdiction(load, 'MX')).length;
check('jurisdiction filter counts legal loads', (await rowCount()) === legalInMx, `${await rowCount()} vs ${legalInMx}`);
check(
  'jurisdiction filter names the jurisdiction',
  (await evaluate(`document.getElementById('summary').textContent`)).includes('Mexico'),
  await evaluate(`document.getElementById('summary').textContent`),
);
check(
  '.380 ACP survives the Mexico filter',
  (await evaluate(`document.querySelector('tbody tr.row[data-id="380acp"]') !== null`)) === true,
);
check(
  '9mm does not survive the Mexico filter',
  (await evaluate(`document.querySelector('tbody tr.row[data-id="9mm"]') === null`)) === true,
);
check(
  'category chips respect the jurisdiction filter',
  (await evaluate(`[...document.querySelectorAll('.chip')].every((chip) => !chip.querySelector('.count') || Number(chip.querySelector('.count').textContent) <= ${legalInMx})`)) === true,
);

await setJurisdiction('all');
await sleep(150);
check('clearing the jurisdiction filter restores every load', (await rowCount()) === AMMO.length, `${await rowCount()} rows`);

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
check(
  'rows name a designer',
  (await evaluate(`[...document.querySelectorAll('tbody tr.row .col-designer')].filter((el) => el.textContent.trim() !== '—').length`)) >= 250,
);
check(
  'rows show an estimated effective range',
  (await evaluate(`document.querySelector('tbody tr.row .col-range').textContent`)).includes('yd'),
);

await clickHeader('range');
await sleep(120);
check(
  'range sort starts with the longest reach',
  (await evaluate(`document.querySelector('tbody tr.row .col-range').textContent`)).includes('2,500'),
  await evaluate(`document.querySelector('tbody tr.row .col-range').textContent`),
);

await evaluate(`(() => { const s = document.getElementById('units'); s.value = 'metric'; s.dispatchEvent(new Event('change')); })()`);
await sleep(150);
check('metric mode shows joules', (await evaluate(`document.querySelector('tbody tr.row td.energy').textContent`)).includes('J'));
check('metric mode shows m/s', (await evaluate(`document.querySelector('tbody tr.row .col-velocity').textContent`)).includes('m/s'));
check('metric mode converts effective range to metres', (await evaluate(`document.querySelector('tbody tr.row .col-range').textContent`)).includes('m'));

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

await evaluate(`(() => { const i = document.getElementById('search'); i.value = 'Browning'; i.dispatchEvent(new Event('input')); })()`);
await sleep(150);
const browningCount = AMMO.filter((l) => /browning/i.test(INVENTORS[l.id]?.name ?? '')).length;
check(
  'search matches a designer name',
  (await rowCount()) >= browningCount,
  `${await rowCount()} vs ${browningCount} designer matches`,
);
check(
  'designer search surfaces named designers',
  (await evaluate(`[...document.querySelectorAll('tbody tr.row .col-designer')].some((el) => /Browning/i.test(el.textContent))`)) === true,
);

await evaluate(`(() => { const i = document.getElementById('search'); i.value = 'zzzz'; i.dispatchEvent(new Event('input')); })()`);
await sleep(150);
check(
  'no matches shows an empty state',
  (await evaluate(`document.querySelectorAll('tbody tr').length`)) === 1 &&
    (await evaluate(`document.querySelector('.empty')?.textContent ?? ''`)).includes('No loads match'),
);

await evaluate(`(() => { const i = document.getElementById('search'); i.value = '9mm Luger'; i.dispatchEvent(new Event('input')); })()`);
await sleep(150);
await evaluate(`document.querySelector('tbody tr.row').click()`);
await sleep(150);
check(
  'details cite published case dimensions where used',
  (await evaluate(`document.querySelector('tbody tr.detail')?.textContent ?? ''`)).includes('SAAMI Z299.3'),
);
check(
  'details name the designer',
  (await evaluate(`document.querySelector('tbody tr.detail')?.textContent ?? ''`)).includes('Designer'),
);
check(
  'details explain the ballistic coefficient',
  (await evaluate(`document.querySelector('tbody tr.detail')?.textContent ?? ''`)).includes('G1'),
);
check(
  'details include a trajectory table',
  (await evaluate(`document.querySelectorAll('tbody tr.detail .trajectory tbody tr').length`)) >= 4,
);
check(
  'details cite the jurisdiction that restricts the load',
  (await evaluate(`document.querySelector('tbody tr.detail')?.textContent ?? ''`)).includes('Art. 10'),
);

/* ------------------------------ make the case ------------------------------ */

const setSearch = (query) =>
  evaluate(`(() => {
    const input = document.getElementById('search');
    input.value = ${JSON.stringify(query)};
    input.dispatchEvent(new Event('input'));
  })()`);
const caseButtonFor = (id) =>
  evaluate(`document.querySelector('tbody tr.row[data-id="${id}"] .case-btn').click()`);
const caseStatus = () => evaluate(`document.getElementById('case-status').textContent`);
const clearCase = () => evaluate(`document.getElementById('case-clear').click()`);

await setSearch('9mm Luger');
await sleep(150);
await caseButtonFor('9mm');
await sleep(350);
check('case panel opens from a row', (await evaluate(`document.getElementById('case-panel').hidden`)) === false);
check('case panel names the selected load', (await evaluate(`document.getElementById('case-name').textContent`)) === '9mm Luger');
check('9mm case falls back to centerfire', (await evaluate(`document.getElementById('case-scope').value`)) === 'centerfire');
check('9mm is first among centerfire loads', (await firstLoadName()) === '9mm Luger', await firstLoadName());
check('9mm case shows 284 centerfire loads', (await rowCount()) === 284, `${await rowCount()} rows`);
check('9mm case explains the narrower field', (await evaluate(`document.getElementById('case-note').textContent`)).includes('narrows the field to centerfire loads'));
check('9mm case shows seven weighted columns', (await evaluate(`document.querySelectorAll('.case-weight').length`)) === 7);
check('9mm case gives cost the largest weight', (await evaluate(`document.querySelector('.case-weight .cw-label').textContent`)) === 'Low cost');
check('case mode pauses search', (await evaluate(`document.getElementById('search').disabled`)) === true);
check('case mode pauses category chips', (await evaluate(`[...document.querySelectorAll('.chip')].every((chip) => chip.disabled)`)) === true);
check('case mode names the case in the summary', (await evaluate(`document.getElementById('summary').textContent`)).includes('centerfire'));
check('case mode clears the open row', (await evaluate(`document.querySelectorAll('tbody tr.detail').length`)) === 0);
check('case mode removes the ordinary sort arrow', (await evaluate(`document.querySelectorAll('th[aria-sort]').length`)) === 0);

await evaluate(`(() => {
  const select = document.getElementById('case-scope');
  select.value = 'all';
  select.dispatchEvent(new Event('change'));
})()`);
await sleep(300);
check('case scope can be widened to all loads', (await rowCount()) === AMMO.length, `${await rowCount()} rows`);
check('9mm admits it cannot win against all loads', (await caseStatus()).includes('No weighting puts it first'), await caseStatus());
check('9mm reports its closest all-load rank', (await caseStatus()).includes('closest found #2'), await caseStatus());
check('the closest all-load table is not forced to 9mm', (await firstLoadName()) !== '9mm Luger', await firstLoadName());

await evaluate(`(() => {
  const select = document.getElementById('case-scope');
  select.value = 'centerfire';
  select.dispatchEvent(new Event('change'));
})()`);
await sleep(250);
check('case scope can be narrowed back to centerfire', (await firstLoadName()) === '9mm Luger');

await clearCase();
await sleep(200);
check('clear case hides the panel', (await evaluate(`document.getElementById('case-panel').hidden`)) === true);
check('clear case re-enables search', (await evaluate(`document.getElementById('search').disabled`)) === false);
check('clear case restores the search that was active', (await rowCount()) === 2, `${await rowCount()} rows`);
check('clear case restores normal sorting', (await firstLoadName()) === '9mm Luger +P');

await setSearch('.223 Rem');
await sleep(150);
await caseButtonFor('223');
await sleep(300);
check('.223 can win against every load', (await caseStatus()) === '#1 of 295 loads', await caseStatus());
check('.223 is actually first', (await firstLoadName()).startsWith('.223 Rem'), await firstLoadName());
check('.223 case spans range and cost', (await evaluate(`document.querySelectorAll('.case-weight .cw-label')[0].textContent`)) === 'Low cost');
await clearCase();
await sleep(150);

await setSearch('.45 ACP');
await sleep(150);
await caseButtonFor('45acp');
await sleep(300);
check('.45 ACP can now win against every load', (await evaluate(`document.getElementById('case-scope').value`)) === 'all', await evaluate(`document.getElementById('case-scope').value`));
check('.45 ACP is first among all loads', (await firstLoadName()) === '.45 ACP', await firstLoadName());
check('.45 ACP reports a strict win', (await caseStatus()) === '#1 of 295 loads', await caseStatus());
check(
  '.45 ACP case leads on cost',
  (await evaluate(`document.querySelector('.case-weight .cw-label').textContent`)) === 'Low cost',
  await evaluate(`document.querySelector('.case-weight .cw-label').textContent`),
);
await clearCase();
await sleep(150);

await setSearch('.380 ACP');
await sleep(150);
await caseButtonFor('380acp');
await sleep(300);
check('.380 ACP falls back to pistols', (await evaluate(`document.getElementById('case-scope').value`)) === 'pistol');
check('.380 ACP is first among pistols', (await firstLoadName()) === '.380 ACP', await firstLoadName());
check('.380 ACP wins its pistol case', (await caseStatus()) === '#1 of 64 pistol loads', await caseStatus());
check('.380 ACP pistol case shows eight weighted columns', (await evaluate(`document.querySelectorAll('.case-weight').length`)) === 8);
check(
  '.380 ACP now leads on derived recoil',
  (await evaluate(`document.querySelector('.case-weight .cw-label').textContent`)) === 'Low recoil',
  await evaluate(`document.querySelector('.case-weight .cw-label').textContent`),
);
check('.380 ACP notes the narrower field', (await evaluate(`document.getElementById('case-note').textContent`)).includes('pistol loads'));

await evaluate(`(() => {
  const select = document.getElementById('case-scope');
  select.value = 'all';
  select.dispatchEvent(new Event('change'));
})()`);
await sleep(300);
check('.380 ACP still cannot win against all loads', (await caseStatus()).includes('No weighting puts it first'), await caseStatus());
check('.380 ACP reports its closest all-load rank', (await caseStatus()).includes('closest found #7'), await caseStatus());
check('the closest .380 all-load table is not forced to .380', (await firstLoadName()) !== '.380 ACP', await firstLoadName());

await clearCase();
await sleep(150);

// A load that can only tie must not be presented as a win: no hoisting, and the
// loads it ties with are named.
await setSearch('.44 Magnum');
await sleep(150);
await caseButtonFor('44mag');
await sleep(300);
check('.44 Magnum only ties for first', (await caseStatus()).includes('tied for #1'), await caseStatus());
check(
  '.44 Magnum is not floated above its ties',
  (await firstLoadName()) !== '.44 Magnum',
  await firstLoadName(),
);
check(
  '.44 Magnum case names the loads it ties with',
  (await evaluate(`document.getElementById('case-note').textContent`)).includes('It ties with'),
  await evaluate(`document.getElementById('case-note').textContent`),
);
check(
  '.44 Magnum case admits the weighting is one column',
  (await evaluate(`document.getElementById('case-note').textContent`)).includes('not an even argument'),
  await evaluate(`document.getElementById('case-note').textContent`),
);
check(
  'case mode marks the pistol chip instead of All',
  (await evaluate(`document.querySelector('.chip[aria-pressed="true"]')?.dataset.category`)) === 'pistol',
  await evaluate(`document.querySelector('.chip[aria-pressed="true"]')?.dataset.category`),
);
check('starting a case moves focus to the scope menu', (await evaluate(`document.activeElement.id`)) === 'case-scope', await evaluate(`document.activeElement.id`));

await clearCase();
await sleep(150);

// The fallback for a rifle load is a low-rank mixed weighting; the note has to
// count the loads still ahead and the table must stay in rank order.
await setSearch('6.5x55mm');
await sleep(150);
await caseButtonFor('65x55mm');
await sleep(300);
check('6.5×55mm reports a closest case, not a win', (await caseStatus()).includes('closest found #'), await caseStatus());
check(
  '6.5×55mm counts the loads still ahead',
  /and \d+ others/.test(await evaluate(`document.getElementById('case-note').textContent`)),
  await evaluate(`document.getElementById('case-note').textContent`),
);
check(
  '6.5×55mm stays in rank order',
  (await firstLoadName()) !== '6.5×55mm',
  await firstLoadName(),
);
check(
  'the selected row is scrolled into view inside the table',
  (await evaluate(`(() => {
    const wrap = document.getElementById('ammo').closest('.table-wrap');
    const row = document.querySelector('tr.row.is-case');
    if (!wrap || !row) return false;
    const w = wrap.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return r.top >= w.top - 1 && r.bottom <= w.bottom + 1;
  })()`)) === true,
);

await clearCase();
await sleep(150);
await setSearch('.308 Win');
await sleep(150);
await evaluate(`document.querySelector('tbody tr.row[data-id="308"]').click()`);
await sleep(150);
await evaluate(`document.querySelector('tbody tr.detail [data-case]').click()`);
await sleep(300);
check('detail button starts a case', (await evaluate(`document.getElementById('case-name').textContent`)) === '.308 Win / 7.62 NATO');
check('.308 wins against every load', (await caseStatus()) === '#1 of 295 loads', await caseStatus());
check('.308 case uses all loads', (await evaluate(`document.getElementById('case-scope').value`)) === 'all');
check('detail button closes the old detail row', (await evaluate(`document.querySelectorAll('tbody tr.detail').length`)) === 0);

await send('Emulation.setDeviceMetricsOverride', {
  width: 720,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: true,
});
await sleep(250);
check(
  'case panel fits a phone viewport',
  (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth && document.getElementById('case-panel').hidden === false`)) === true,
);
await send('Emulation.setDeviceMetricsOverride', {
  width: 420,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await sleep(250);
check(
  'case panel fits a narrow phone viewport',
  (await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`)) === true,
);

// Leave the page in its normal desktop state for any later checks.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(150);
await clearCase();
await sleep(150);

// A case owns its comparison set, so a jurisdiction filter is parked and restored
// rather than silently narrowing a rank the weights were not solved for.
await clearCase();
await sleep(150);
await setSearch('');
await sleep(150);
await setJurisdiction('MX');
await sleep(150);
await caseButtonFor('380acp');
await sleep(300);
check(
  'starting a case clears the jurisdiction filter',
  (await evaluate(`document.getElementById('jurisdiction').value`)) === 'all',
  await evaluate(`document.getElementById('jurisdiction').value`),
);
check(
  'the jurisdiction filter is disabled during a case',
  (await evaluate(`document.getElementById('jurisdiction').disabled`)) === true,
);
await clearCase();
await sleep(200);
check(
  'clearing the case restores the jurisdiction filter',
  (await evaluate(`document.getElementById('jurisdiction').value`)) === 'MX',
  await evaluate(`document.getElementById('jurisdiction').value`),
);
await setJurisdiction('all');
await sleep(120);


const failures = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  → ${r.detail ?? ''}`}`);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
ws.close();
process.exit(failures.length ? 1 : 0);
