import { AMMO } from './data/ammo.js';
import { derive, fmtInt, fmtCost, fmtEnergy } from './lib/ballistics.js';

/** Enrich the static load data with derived numbers once, at module load. */
const ROWS = AMMO.map((load) => ({ ...load, ...derive(load) }));
const MAX_ENERGY = Math.max(...ROWS.map((r) => r.energyFtLb));
const CATEGORIES = ['all', ...new Set(ROWS.map((r) => r.category))];

const state = {
  query: '',
  category: 'all',
  sortKey: 'energy',
  sortDir: 'desc',
  units: 'imperial',
};

/** Numeric-aware accessors: sorting and rendering both read from these. */
const ACCESSORS = {
  name: (r) => r.name.toLowerCase(),
  category: (r) => r.category,
  bulletGr: (r) => r.bulletGr,
  velocityFps: (r) => r.velocityFps,
  energy: (r) => r.energyFtLb,
  powerFactor: (r) => r.powerFactor,
  recoil: (r) => r.recoil,
  costPerRound: (r) => r.costPerRound,
  use: (r) => r.use.toLowerCase(),
};

const els = {
  rows: document.getElementById('rows'),
  summary: document.getElementById('summary'),
  search: document.getElementById('search'),
  units: document.getElementById('units'),
  categories: document.getElementById('categories'),
  table: document.getElementById('ammo'),
};

const expanded = new Set();

/* ---------------------------- formatting ---------------------------- */

function velocity(r) {
  return state.units === 'metric'
    ? `${fmtInt(r.velocityMps)}<span class="unit"> m/s</span>`
    : `${fmtInt(r.velocityFps)}<span class="unit"> fps</span>`;
}

function bullet(r) {
  return state.units === 'metric'
    ? `${r.bulletGrams.toFixed(2)} g`
    : `${r.bulletGr} gr`;
}

function energy(r) {
  const metric = state.units === 'metric';
  const value = metric ? fmtEnergy(r.energyJoules) : fmtEnergy(r.energyFtLb);
  return `<span class="val">${value}</span><span class="unit">${metric ? 'J' : 'ft·lb'}</span>`;
}

function momentum(r) {
  // Imperial power factor (gr·fps/1000) has a metric sibling in kg·m/s.
  if (state.units === 'metric') {
    return `${(r.bulletGrams / 1000 * r.velocityMps).toFixed(2)}`;
  }
  return fmtInt(r.powerFactor);
}

function recoil(r) {
  const dots = Array.from({ length: 5 }, (_, i) =>
    i < r.recoil ? '●' : '<span class="off">●</span>',
  ).join('');
  return `<span aria-hidden="true">${dots}</span><span class="label">${r.recoil}/5</span>`;
}

/* ------------------------------ filtering ------------------------------ */

function matchesQuery(r, q) {
  if (!q) return true;
  const haystack = [r.name, r.category, r.use, r.notes, ...r.platforms].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function visibleRows() {
  const filtered = ROWS.filter(
    (r) => (state.category === 'all' || r.category === state.category) && matchesQuery(r, state.query),
  );
  const get = ACCESSORS[state.sortKey] ?? ACCESSORS.energy;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.name.localeCompare(b.name);
  });
}

/* ------------------------------ rendering ------------------------------ */

function rowHtml(r) {
  const open = expanded.has(r.id);
  const width = Math.max(2, Math.round((r.energyFtLb / MAX_ENERGY) * 100));
  return `
    <tr class="row${open ? ' is-open' : ''}" data-id="${r.id}" tabindex="0"
        aria-expanded="${open}" aria-controls="detail-${r.id}">
      <th scope="row" class="load"><span class="load-name">${r.name}</span><span class="cat">${r.category}</span></th>
      <td class="num">${bullet(r)}</td>
      <td class="num">${velocity(r)}</td>
      <td class="num energy" data-sort-value="${r.energyFtLb}">
        <span class="bar" style="--w:${width}"></span>${energy(r)}
      </td>
      <td class="num">${momentum(r)}</td>
      <td class="recoil">${recoil(r)}</td>
      <td class="num">${fmtCost(r.costPerRound)}</td>
      <td class="use">${r.use}</td>
    </tr>
    ${open ? detailHtml(r) : ''}`;
}

function detailHtml(r) {
  const payload = r.pelletLabel
    ? `<dt>Payload</dt><dd>${r.pelletLabel}</dd>`
    : '';
  return `
    <tr class="detail" id="detail-${r.id}">
      <td colspan="8">
        <dl>
          <dt>Platforms</dt>
          <dd class="badges">${r.platforms.map((p) => `<span class="badge">${p}</span>`).join('')}</dd>
          ${payload}
          <dt>Notes</dt>
          <dd>${r.notes}</dd>
        </dl>
      </td>
    </tr>`;
}

function renderChips() {
  els.categories.innerHTML = CATEGORIES.map((cat) => {
    const count = cat === 'all'
      ? ROWS.filter((r) => matchesQuery(r, state.query)).length
      : ROWS.filter((r) => r.category === cat && matchesQuery(r, state.query)).length;
    const active = state.category === cat;
    return `<button type="button" class="chip" data-category="${cat}"
              aria-pressed="${active}">${cat === 'all' ? 'All' : cat}${
      count ? `<span class="count">${count}</span>` : ''
    }</button>`;
  }).join('');
}

function renderSortIndicators() {
  els.table.querySelectorAll('th[data-sort]').forEach((th) => {
    if (th.dataset.sort === state.sortKey) {
      th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}

function renderSummary(rows) {
  if (!rows.length) {
    els.summary.innerHTML = 'No loads match that filter.';
    return;
  }
  const hottest = rows.reduce((a, b) => (b.energyFtLb > a.energyFtLb ? b : a));
  const metric = state.units === 'metric';
  const hottestLabel = metric
    ? `${fmtInt(hottest.energyJoules)} J`
    : `${fmtInt(hottest.energyFtLb)} ft·lb`;
  const energies = rows.map((r) => r.energyFtLb).sort((a, b) => a - b);
  const median = energies[Math.floor(energies.length / 2)];
  const medianLabel = metric ? `${fmtInt(median * 1.3558179483314004)} J` : `${fmtInt(median)} ft·lb`;
  els.summary.innerHTML =
    `Showing <strong>${rows.length}</strong> of ${ROWS.length} loads · ` +
    `highest <strong>${hottest.name}</strong> at ${hottestLabel} · ` +
    `median ${medianLabel}`;
}

function render() {
  const rows = visibleRows();
  els.rows.innerHTML = rows.length
    ? rows.map(rowHtml).join('')
    : `<tr><td colspan="8" class="empty">No loads match that filter.</td></tr>`;
  renderSummary(rows);
  renderChips();
  renderSortIndicators();
}

/* ------------------------------- events ------------------------------- */

els.search.addEventListener('input', (e) => {
  state.query = e.target.value.trim();
  render();
});

els.units.addEventListener('change', (e) => {
  state.units = e.target.value;
  render();
});

els.categories.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.category = chip.dataset.category;
  render();
});

els.table.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      // Text columns read best A→Z; numeric columns worst→best.
      state.sortDir = key === 'name' || key === 'use' || key === 'category' ? 'asc' : 'desc';
    }
    render();
  });
});

function toggleRow(row) {
  const id = row.dataset.id;
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();
  // Keep focus on the row that was toggled rather than losing it to the DOM swap.
  const next = els.rows.querySelector(`tr.row[data-id="${id}"]`);
  next?.focus({ preventScroll: true });
}

els.rows.addEventListener('click', (e) => {
  const row = e.target.closest('tr.row');
  if (row) toggleRow(row);
});

els.rows.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('tr.row');
  if (!row) return;
  e.preventDefault();
  toggleRow(row);
});

render();
