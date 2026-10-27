import { AMMO } from './data/ammo.js';
import { referenceFor } from './data/dimensions.js';
import { inventorFor } from './data/inventors.js';
import {
  derive,
  fmtInt,
  fmtCost,
  fmtEnergy,
  FPS_TO_MPS,
} from './lib/ballistics.js';
import { cartridgeSvg, cartridgeExtents } from './lib/cartridge-svg.js';
import {
  ballisticProfile,
  sectionalDensity,
  YD_TO_M,
  IN_TO_CM,
} from './lib/trajectory.js';
import { recoilProfile } from './lib/recoil.js';
import {
  JURISDICTIONS,
  matchesJurisdiction,
  restrictionsFor,
  jurisdictionNames,
} from './lib/legality.js';
import {
  CASE_CRITERIA,
  CASE_SCOPES,
  FEASIBLE_EPS,
  MIN_WIN,
  autoCaseFor,
  resultFor,
  scopeOptionsFor,
  criteriaForScope,
  dominantCriterion,
  percentileScores,
  rankCase,
} from './lib/case.js';

/** Enrich the static load data with derived numbers once, at module load. */
const ROWS = AMMO.map((load) => ({
  ...load,
  ...derive(load),
  ...ballisticProfile(load),
  ...recoilProfile(load),
  designer: inventorFor(load.id),
  sectionalDensity: sectionalDensity(load.bulletGr, load.diameterIn),
  reference: referenceFor(load.id),
}));

/** One shared scale, so silhouettes compare across rows. */
const EXTENTS = cartridgeExtents(ROWS);
for (const row of ROWS) row.silhouette = cartridgeSvg(row, EXTENTS);
const MAX_ENERGY = Math.max(...ROWS.map((r) => r.energyFtLb));
const MAX_LOG_ENERGY = Math.log1p(MAX_ENERGY);
const CATEGORIES = ['all', ...new Set(ROWS.map((r) => r.category))];

const state = {
  query: '',
  category: 'all',
  jurisdiction: 'all',
  sortKey: 'energy',
  sortDir: 'desc',
  units: 'imperial',
  // Non-null while a "make the case" weighting owns the table ordering.
  caseMode: null,
};

/** Percentile scores are recomputed once per comparison scope, then reused. */
const CASE_PERCENTILES = new Map();
function casePercentiles(scope) {
  if (!CASE_PERCENTILES.has(scope)) {
    CASE_PERCENTILES.set(scope, percentileScores(ROWS, scope));
  }
  return CASE_PERCENTILES.get(scope);
}

/** The jurisdiction currently filtering the table, or null for no filter. */
const legalJurisdiction = () =>
  state.jurisdiction === 'all'
    ? null
    : (JURISDICTIONS.find((jurisdiction) => jurisdiction.code === state.jurisdiction) ?? null);

/** Numeric-aware accessors: sorting and rendering both read from these. */
const ACCESSORS = {
  name: (r) => r.name.toLowerCase(),
  category: (r) => r.category,
  introduced: (r) => r.introduced ?? 0,
  designer: (r) => r.designer?.name.toLowerCase() ?? null,
  bulletGr: (r) => r.bulletGr,
  velocityFps: (r) => r.velocityFps,
  energy: (r) => r.energyFtLb,
  range: (r) => r.effectiveRangeYd,
  powerFactor: (r) => r.powerFactor,
  recoilFtLb: (r) => r.recoilFtLb,
  costPerRound: (r) => r.costPerRound ?? null,
  use: (r) => r.use.toLowerCase(),
};

const els = {
  rows: document.getElementById('rows'),
  summary: document.getElementById('summary'),
  search: document.getElementById('search'),
  units: document.getElementById('units'),
  jurisdiction: document.getElementById('jurisdiction'),
  categories: document.getElementById('categories'),
  table: document.getElementById('ammo'),
  controls: document.getElementById('controls'),
  casePanel: document.getElementById('case-panel'),
  caseName: document.getElementById('case-name'),
  caseStatus: document.getElementById('case-status'),
  caseScope: document.getElementById('case-scope'),
  caseNote: document.getElementById('case-note'),
  caseWeights: document.getElementById('case-weights'),
  caseClear: document.getElementById('case-clear'),
};

const expanded = new Set();

/* ---------------------------- formatting ---------------------------- */

function velocity(r) {
  return state.units === 'metric'
    ? `${fmtInt(r.velocityMps)}<span class="unit"> m/s</span>`
    : `${fmtInt(r.velocityFps)}<span class="unit"> fps</span>`;
}

function bullet(r) {
  const imperial = `${r.bulletGr} gr`;
  const metric = `${r.bulletGrams.toFixed(2)} g`;
  const [main, alt] = state.units === 'metric' ? [metric, imperial] : [imperial, metric];
  return `<span class="val">${main}</span><span class="sub">${alt}${commonWeights(r)}</span>`;
}

/**
 * Range of bullet weights normally sold for the cartridge. The row's own
 * weight is one load; this says how much the cartridge usually varies.
 */
function commonWeights(r) {
  if (!r.commonGrains) return '';
  const [lo, hi] = r.commonGrains;
  return ` · ${lo === hi ? lo : `${lo}–${hi}`} gr`;
}

/** Nation, bullet diameter, and case length under the cartridge name. */
function loadSubline(r) {
  const parts = [];
  if (r.nation) parts.push(r.nation);
  if (r.diameterIn) {
    parts.push(
      state.units === 'metric'
        ? `${(r.diameterIn * 25.4).toFixed(2)} mm bullet`
        : `${r.diameterIn}″ bullet`,
    );
  }
  if (r.caseLengthMm) parts.push(`${r.caseLengthMm} mm case`);
  if (!parts.length) return '';
  // The year has its own column on wide screens; inline it when that column
  // is dropped instead of losing the information.
  const year = r.introduced ? `<span class="year-inline"> · ${r.introduced}</span>` : '';
  return `<span class="load-sub">${parts.join(' · ')}${year}</span>`;
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
  const metric = state.units === 'metric';
  const value = metric ? r.recoilJoules : r.recoilFtLb;
  const dots = Array.from({ length: 5 }, (_, i) =>
    i < r.recoilLevel ? '●' : '<span class="off">●</span>',
  ).join('');
  const label = `${value < 10 ? value.toFixed(1) : fmtInt(value)}${metric ? ' J' : ' ft·lb'}`;
  return (
    `<span aria-hidden="true">${dots}</span>` +
    `<span class="label" title="Free recoil energy in ${r.recoilGunLabel}">${label}</span>`
  );
}

function range(r) {
  const metric = state.units === 'metric';
  const value = metric ? r.effectiveRangeYd * YD_TO_M : r.effectiveRangeYd;
  return `${fmtInt(value)}<span class="unit"> ${metric ? 'm' : 'yd'}</span>`;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function designer(r) {
  if (!r.designer) return '<span class="none" title="No designer recorded">—</span>';
  return `<span class="designer-name" title="${escapeHtml(r.designer.name)}">${escapeHtml(r.designer.name)}</span>`;
}

/* ------------------------------ filtering ------------------------------ */

function matchesQuery(r, q) {
  if (!q) return true;
  // Treat the multiplication sign and the letter x as the same character so
  // "9x19" finds "9×19mm" and vice versa.
  const normalize = (s) => String(s).toLowerCase().replace(/[×✕]/g, 'x');
  const haystack = normalize(
    [
      r.name,
      r.category,
      r.use,
      r.notes,
      r.nation ?? '',
      r.introduced ?? '',
      r.designer?.name ?? '',
      ...r.platforms,
    ].join(' '),
  );
  return normalize(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function visibleRows() {
  if (state.caseMode) {
    const { id, scope } = state.caseMode;
    const result = resultFor(id, scope);
    if (!result) return [];
    // The case owns the ordering, and the panel's own ranking is the only order
    // that matches the rank it reports. The selected row is deliberately *not*
    // floated above rows that score the same: a tie is not a win, and the table
    // must not look like one. The panel names the tied loads instead.
    const ranking = rankCase(ROWS, scope, result.weights, id, casePercentiles(scope));
    return ranking ? ranking.sorted.map((entry) => entry.row) : [];
  }

  const filtered = ROWS.filter(
    (r) =>
      (state.category === 'all' || r.category === state.category) &&
      matchesJurisdiction(r, state.jurisdiction) &&
      matchesQuery(r, state.query),
  );
  const get = ACCESSORS[state.sortKey] ?? ACCESSORS.energy;
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    // Unpriced rows sink to the bottom in both directions: "unknown" is not
    // cheaper than $0.10, and it is not dearer than $5 either.
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.name.localeCompare(b.name);
  });
}

/* ------------------------------ rendering ------------------------------ */

function rowHtml(r) {
  const open = expanded.has(r.id);
  const cased = state.caseMode?.id === r.id;
  // Restrictions are a property of the cartridge, so the badge rides with the
  // load rather than taking a column of its own.
  const restrictions = restrictionsFor(r);
  const lawBadge = restrictions.length
    ? `<span class="law-badge" title="${escapeHtml(
        restrictions.map((x) => `${x.label} (${x.scope}): ${x.note}`).join(' '),
      )}">${restrictions.map((x) => x.code).join(' ')}</span>`
    : '';
  // Energy spans three orders of magnitude once anti-materiel rounds are in the
  // set, so the bar is logarithmic; a linear scale would flatten everything
  // below .50 BMG into an invisible sliver.
  const width = Math.max(2, Math.round((Math.log1p(r.energyFtLb) / MAX_LOG_ENERGY) * 100));
  return `
    <tr class="row${open ? ' is-open' : ''}${cased ? ' is-case' : ''}" data-id="${r.id}" tabindex="0"
        aria-expanded="${open}" aria-controls="detail-${r.id}">
      <th scope="row" class="load">
        <span class="load-main">
          <span class="load-name">${r.name}</span><span class="cat">${r.category}</span>
          <button type="button" class="case-btn${cased ? ' is-active' : ''}" data-case="${r.id}"
                  title="Make the case for ${escapeHtml(r.name)}"
                  aria-label="Make the case for ${escapeHtml(r.name)}">Case</button>${lawBadge}
        </span>
        ${loadSubline(r)}
      </th>
      <td class="col-svg">${r.silhouette}</td>
      <td class="num col-introduced">${r.introduced ?? '<span class="none">—</span>'}</td>
      <td class="designer col-designer">${designer(r)}</td>
      <td class="num col-bullet">${bullet(r)}</td>
      <td class="num col-velocity">${velocity(r)}</td>
      <td class="num energy col-energy" data-sort-value="${r.energyFtLb}">
        <span class="bar" style="--w:${width}"></span>${energy(r)}
      </td>
      <td class="num col-range" title="Estimated effective range">${range(r)}</td>
      <td class="num col-pf">${momentum(r)}</td>
      <td class="recoil col-recoil">${recoil(r)}</td>
      <td class="num col-cost">${r.costPerRound == null ? '<span class="none" title="No current retail price">—</span>' : fmtCost(r.costPerRound)}</td>
      <td class="use col-use">${r.use}</td>
    </tr>
    ${open ? detailHtml(r) : ''}`;
}

function trajectoryHtml(r) {
  const metric = state.units === 'metric';
  const rangeLabel = `${fmtInt(metric ? r.effectiveRangeYd * YD_TO_M : r.effectiveRangeYd)} ${metric ? 'm' : 'yd'}`;
  if (!r.trajectory) {
    return `
      <div class="trajectory">
        <h3>Estimated trajectory</h3>
        <p class="trajectory-note">
          Pattern-limited: this is a shot charge, not a single projectile, so the
          useful range is about ${rangeLabel} regardless of retained energy. The
          table compares muzzle energy for the whole payload.
        </p>
      </div>`;
  }
  const rows = r.trajectory
    .map((t) => {
      const distance = metric ? `${fmtInt(t.distanceYd * YD_TO_M)} m` : `${fmtInt(t.distanceYd)} yd`;
      const velocity = metric ? `${fmtInt(t.velocityFps * FPS_TO_MPS)} m/s` : `${fmtInt(t.velocityFps)} fps`;
      const energy = metric ? `${fmtInt(t.energyJoules)} J` : `${fmtInt(t.energyFtLb)} ft·lb`;
      const drop =
        t.distanceYd === 0
          ? '—'
          : metric
            ? `${fmtInt(t.dropIn * IN_TO_CM)} cm`
            : `${t.dropIn.toFixed(1)}″`;
      return `<tr><td>${distance}</td><td>${velocity}</td><td>${energy}</td><td>${drop}</td><td>${t.timeS.toFixed(2)} s</td></tr>`;
    })
    .join('');
  return `
    <div class="trajectory">
      <h3>Estimated trajectory</h3>
      <table>
        <thead>
          <tr><th scope="col">Range</th><th scope="col">Velocity</th><th scope="col">Energy</th><th scope="col">Drop</th><th scope="col">Time</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="trajectory-note">
        ${r.zeroYd}-yard zero, ${r.sightHeightIn}″ sight height, G1 BC
        ${r.bcValue.toFixed(3)} (${r.bcSource}). Drop is relative to the line of
        sight. A simplified drag model drives these numbers: use them to compare
        loads, not as a dope card.
      </p>
    </div>`;
}

function detailHtml(r) {
  const restrictions = restrictionsFor(r);
  const payload = r.pelletLabel
    ? `<dt>Payload</dt><dd>${r.pelletLabel}</dd>`
    : '';
  const sourceLabel = {
    wikipedia: 'Wikipedia cartridge table',
    'wikipedia-estimate': 'Wikipedia table (representative load)',
    'curated-extra': 'Added for this table',
  }[r.source] ?? 'Curated for this table';
  const designerLabel = r.designer
    ? `${escapeHtml(r.designer.name)}${
        r.designer.page
          ? ` · <a href="https://en.wikipedia.org/wiki/${encodeURI(
              r.designer.page.replaceAll(' ', '_'),
            )}" target="_blank" rel="noopener">Wikipedia</a>`
          : ''
      }`
    : null;
  const specs = [
    ['Momentum', `${r.momentumLbfS.toFixed(2)} lbf·s`],
    [
      'Free recoil',
      `${r.recoilFtLb < 10 ? r.recoilFtLb.toFixed(2) : fmtInt(r.recoilFtLb)} ft·lb ` +
        `(${r.recoilJoules < 10 ? r.recoilJoules.toFixed(1) : fmtInt(r.recoilJoules)} J) ` +
        `from ${r.recoilGunLabel}; impulse ${r.recoilImpulseLbfS.toFixed(1)} lbf·s. ` +
        `Recoil energy scales inversely with gun weight — half the weight, twice the kick. ` +
        `Propellant gas is ignored, so magnum rifle and shotgun figures run low.`,
    ],
    r.introduced && ['Introduced', r.introduced],
    r.nation && ['Nation', r.nation],
    ['Typical use', r.use],
    designerLabel && ['Designer', designerLabel],
    r.diameterIn && [
      'Bullet diameter',
      `${r.diameterIn}″ (${(r.diameterIn * 25.4).toFixed(2)} mm)`,
    ],
    r.caseLengthMm && ['Case length', `${r.caseLengthMm} mm`],
    r.reference && [
      'Case dimensions',
      `${r.reference.standard} ${r.reference.title} — ${r.reference.baseMm} mm base, ${r.reference.rimMm} mm rim`,
    ],
    r.commonGrains && [
      'Common bullet weights',
      r.commonGrains[0] === r.commonGrains[1]
        ? `${r.commonGrains[0]} gr`
        : `${r.commonGrains[0]}–${r.commonGrains[1]} gr`,
    ],
    // A shot charge has many projectiles; one sectional density or BC would
    // misrepresent it, so those figures are shown only for single projectiles.
    ...(r.trajectory
      ? [
          ['Sectional density', `${r.sectionalDensity.toFixed(3)} lb/in²`],
          [
            'Ballistic coefficient',
            `${r.bcValue.toFixed(3)} G1 — ${
              r.bcSource === 'estimated' ? 'estimated from sectional density' : 'published value'
            }`,
          ],
        ]
      : []),
    [
      'Effective range',
      `≈ ${fmtInt(r.effectiveRangeYd)} yd (${fmtInt(r.effectiveRangeYd * YD_TO_M)} m) — estimated ${
        r.category === 'shotgun' ? 'practical' : 'energy-limited'
      } range`,
    ],
    Number.isInteger(r.factoryLoadings) && [
      'Factory loadings',
      String(r.factoryLoadings),
    ],
    [
      'Cost per round',
      r.costPerRound == null
        ? 'No current retail price — obsolete, surplus, or collector-only'
        : `≈ ${fmtCost(r.costPerRound)} (rough retail estimate)`,
    ],
    [
      'Legality',
      restrictions.length
        ? restrictions.map((x) => `${x.label} (${x.scope}): ${x.note}`).join(' ')
        : 'No restriction recorded for Mexico, Italy, or Canada.',
    ],
    ['Source', sourceLabel],
  ].filter(Boolean);
  return `
    <tr class="detail" id="detail-${r.id}">
      <td colspan="12">
        <dl>
          <dt>Platforms</dt>
          <dd class="badges">${r.platforms.map((p) => `<span class="badge">${p}</span>`).join('')}</dd>
          ${payload}
          ${specs.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}
          <dt>Notes</dt>
          <dd>${r.notes}</dd>
        </dl>
        <div class="detail-actions">
          <button type="button" class="case-btn case-btn-wide" data-case="${r.id}">Make the case for this load</button>
        </div>
        ${trajectoryHtml(r)}
      </td>
    </tr>`;
}

function renderChips() {
  // In case mode the table is the case's comparison set, so the chip row has to
  // describe that set rather than the paused filter. Centerfire is not a chip
  // category, so it leaves the row unselected instead of faking an "All" press.
  const scopeCategory = state.caseMode
    ? (state.caseMode.scope === 'centerfire' ? null : state.caseMode.scope)
    : null;
  els.categories.innerHTML = CATEGORIES.map((cat) => {
    const count = cat === 'all'
      ? ROWS.filter((r) => matchesJurisdiction(r, state.jurisdiction) && matchesQuery(r, state.query)).length
      : ROWS.filter(
          (r) =>
            r.category === cat &&
            matchesJurisdiction(r, state.jurisdiction) &&
            matchesQuery(r, state.query),
        ).length;
    const active = state.caseMode ? cat === scopeCategory : state.category === cat;
    return `<button type="button" class="chip" data-category="${cat}"
              aria-pressed="${active}"${state.caseMode ? ' disabled' : ''}>${
      cat === 'all' ? 'All' : cat
    }${count ? `<span class="count">${count}</span>` : ''}</button>`;
  }).join('');
}

function renderSortIndicators() {
  els.table.querySelectorAll('th[data-sort]').forEach((th) => {
    if (state.caseMode) {
      th.removeAttribute('aria-sort');
    } else if (th.dataset.sort === state.sortKey) {
      th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}

function renderSummary(rows) {
  if (state.caseMode) {    const row = ROWS.find((r) => r.id === state.caseMode.id);
    const result = resultFor(state.caseMode.id, state.caseMode.scope);
    const meta = CASE_SCOPES[state.caseMode.scope];
    const verdict = result?.feasible
      ? 'ranked #1'
      : result?.thin
        ? 'first, but by a hair'
        : `closest found #${result?.rank ?? '—'}`;
    const factorNote = result ? ` · ${result.factors} factor${result.factors === 1 ? '' : 's'}` : '';
    els.summary.innerHTML =
      `The case for <strong>${row?.name ?? 'this load'}</strong> · ` +
      `${rows.length} ${scopeNoun(meta)} · ${verdict}${factorNote}`;
    return;
  }
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
    `Showing <strong>${rows.length}</strong> of ${ROWS.length} loads` +
    (legalJurisdiction() ? ` legal for civilians in <strong>${legalJurisdiction().label}</strong>` : '') +
    ` · highest <strong>${hottest.name}</strong> at ${hottestLabel} · ` +
    `median ${medianLabel}`;
}

/* ------------------------------- the case ------------------------------ */

function startCase(id) {
  const auto = autoCaseFor(id);
  if (!auto) return;
  // A jurisdiction filter is a question about what the reader may own, so the
  // case starts in that set when the load is legal there. Otherwise the usual
  // auto scope (all -> ignition -> category) applies.
  const jurisdictionScope = state.jurisdiction === 'all' ? null : state.jurisdiction.toLowerCase();
  const inJurisdiction = jurisdictionScope ? resultFor(id, jurisdictionScope) : null;
  const previous = state.caseMode?.previous ?? {
    query: state.query,
    category: state.category,
    jurisdiction: state.jurisdiction,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
  };
  state.caseMode = { id, scope: inJurisdiction ? jurisdictionScope : auto.scope, previous };
  // The case owns the comparison set, so the ordinary filters are paused and
  // cleared. They are restored by Clear case. A jurisdiction filter is cleared
  // too: the stored weights were solved over the whole scope, so narrowing the
  // field afterwards would report a rank the weighting was never built for.
  state.query = '';
  state.category = 'all';
  state.jurisdiction = 'all';
  expanded.clear();
  render();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.casePanel.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'nearest',
  });
  // The table scrolls the selected row into the middle of its own viewport; if
  // that still lands under the fold, nudge the page by the minimum needed rather
  // than hiding the panel that explains the case.
  const caseRow = els.rows.querySelector('tr.row.is-case');
  if (caseRow) {
    // Capped: on a short viewport the panel alone fills the screen, and the
    // explanation matters more than the row it explains.
    const overhang = Math.min(
      caseRow.getBoundingClientRect().bottom - window.innerHeight + 16,
      96,
    );
    if (overhang > 0) {
      window.scrollBy({ top: overhang, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }
  // render() replaced the table body, which destroys the button that was just
  // activated, so focus would otherwise fall back to <body>.
  els.caseScope.focus({ preventScroll: true });
}

function clearCase() {
  if (!state.caseMode) return;
  const previous = state.caseMode.previous;
  state.caseMode = null;
  Object.assign(state, previous);
  render();
}

/** "Centerfire loads", "Loads legal in Mexico" -> mid-sentence form. */
const scopeNoun = (meta) => {
  const label = (meta?.label ?? 'loads').replace(/^All /i, '');
  return label.charAt(0).toLowerCase() + label.slice(1);
};

/**
 * Which used factors are load-bearing.
 *
 * A factor is essential when removing it (and renormalising the rest) drops the
 * load out of first place. The generator solves for the fewest columns, so for a
 * strict win every used column should come back essential; the panel checks that
 * rather than claiming it.
 */
function essentialFactors(id, scope, weights) {
  const percentiles = casePercentiles(scope);
  return weights
    .map((weight, index) => ({ weight, index }))
    .filter((entry) => entry.weight >= 1e-6)
    .map(({ index }) => {
      const trial = weights.slice();
      trial[index] = 0;
      const total = trial.reduce((sum, value) => sum + value, 0);
      if (total <= 0) return { index, keeps: false };
      const ranking = rankCase(
        ROWS,
        scope,
        trial.map((value) => value / total),
        id,
        percentiles,
      );
      return {
        index,
        keeps: ranking ? ranking.rank === 1 && ranking.margin >= MIN_WIN : false,
      };
    });
}

/** "A, B, C and 26 others" — long tie lists need a count, not a wall of names. */
function nameList(names, limit = 3) {
  if (names.length <= limit) return names.join(', ');
  const rest = names.length - limit;
  return `${names.slice(0, limit).join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`;
}

function caseNote(row, scope, result, ranking) {
  const meta = CASE_SCOPES[scope];
  const criteria = criteriaForScope(scope);
  const anyFeasible = scopeOptionsFor(row.id).some(
    (option) => resultFor(row.id, option.scope)?.feasible,
  );
  const used = criteria.filter((criterion, index) => result.weights[index] >= 1e-6);
  const usedList = used.map((criterion) => criterion.label.toLowerCase());
  const factors =
    `It needs ${result.factors} of the ${criteria.length} columns: ${nameList(usedList, 4)}.`;

  // How strong the argument is, in the same units the weights are shares of.
  // A one-point win is a squeaker; ten points is not. Saying so keeps the panel
  // from implying every win is equally convincing.
  const runnerUp = ranking?.sorted[1]?.row.name;
  const points = (value) => `${(value * 100).toFixed(1)} percentile points`;
  const gap = !ranking
    ? ''
    : result.feasible && ranking.margin >= 1e-4 && runnerUp
      ? ` It wins by ${points(ranking.margin)} over ${runnerUp}.`
      : !result.feasible && ranking.margin < -1e-4 && ranking.sorted[0]
        ? ` It sits ${points(-ranking.margin)} behind ${ranking.sorted[0].row.name}.`
        : '';

  // Essentiality is a claim the panel can check: drop a used column, renormalise,
  // and see whether the load is still first. The generator solves for the
  // fewest columns, so for a strict win every one of them should matter.
  const essential = result.feasible && result.factors > 1 ? essentialFactors(row.id, scope, result.weights) : null;
  const loadBearing = essential && essential.every((entry) => !entry.keeps)
    ? ' Every one of them is load-bearing: drop any and it loses first place.'
    : '';

  // A fallback weighting can be a simplex vertex: one column carrying everything.
  // For a strict win that is now the *point* (fewest factors), so only the
  // fallback branch says it is not an even argument.
  const dominant = dominantCriterion(criteria, result.weights);
  const narrow = dominant && !result.feasible
    ? ` This is not an even argument: ${dominant.criterion.label} carries ` +
      `${Math.round(dominant.weight * 100)}% of the weight.`
    : '';

  if (result.thin) {
    // First place, but not by enough to be an argument anybody would repeat.
    const beats = runnerUp ? ` over ${runnerUp}` : '';
    return (
      `It does reach first place, by ${points(ranking.margin)}${beats} — too thin to ` +
      `call a case, because a small change to the data would flip it. ` +
      `${factors}${narrow}`
    );
  }

  if (!result.feasible) {
    if (result.rank === 1) {
      const tied = ranking?.tiedWith ?? [];
      const tieNote = tied.length ? ` It ties with ${nameList(tied)}.` : '';
      return (
        `No strict weighting separates ${row.name} from the next load, so it only ties ` +
        `for first.${tieNote}${narrow}`
      );
    }
    let note =
      `No non-negative weighting of the ${criteria.length} numeric columns ` +
      `puts ${row.name} first among ${scopeNoun(meta)}. ` +
      `The table shows a closest case found by the search.${gap}`;
    if (ranking?.blockers.length) {
      const ahead = ranking.rank - 1;
      note +=
        ` Still ahead: ${ranking.blockers.join(', ')}` +
        (ahead > ranking.blockers.length
          ? ` and ${ahead - ranking.blockers.length} others`
          : '') +
        '.';
    }
    note += narrow;
    note += anyFeasible
      ? ' Try another comparison set.'
      : ' None of the available comparison sets can put it first.';
    return note;
  }

  if (scope === 'all') {
    return (
      `This weighting puts ${row.name} first against all ${meta.count} loads. ` +
      `${factors}${loadBearing}${gap}${narrow}`
    );
  }
  const all = resultFor(row.id, 'all');
  const ignition = row.category === 'rimfire' ? 'rimfire' : 'centerfire';
  const ignitionResult = resultFor(row.id, ignition);
  if (all && !all.feasible) {
    return (
      `No weighting puts it first against all ${CASE_SCOPES.all.count} loads. ` +
      `This case narrows the field to ${scopeNoun(meta)}. ${factors}${loadBearing}${gap}${narrow}`
    );
  }
  if (ignitionResult && !ignitionResult.feasible && scope === row.category) {
    return (
      `No weighting works against all loads or ${ignition} loads. ` +
      `This case narrows the field to ${scopeNoun(meta)}. ${factors}${loadBearing}${gap}${narrow}`
    );
  }
  return (
    `This weighting puts it first among ${scopeNoun(meta)}. ` +
    `${factors}${loadBearing}${gap}${narrow}`
  );
}

function renderCasePanel() {
  const active = state.caseMode;
  els.casePanel.hidden = !active;
  els.controls.classList.toggle('is-paused', Boolean(active));
  els.search.disabled = Boolean(active);
  els.table.classList.toggle('case-mode', Boolean(active));
  if (!active) return;

  const row = ROWS.find((r) => r.id === active.id);
  const result = resultFor(active.id, active.scope);
  if (!row || !result) return;
  const meta = CASE_SCOPES[active.scope];
  const ranking = rankCase(
    ROWS,
    active.scope,
    result.weights,
    active.id,
    casePercentiles(active.scope),
  );

  els.caseName.textContent = row.name;
  els.caseScope.innerHTML = scopeOptionsFor(row.id)
    .map(
      (option) =>
        `<option value="${option.scope}"${option.scope === active.scope ? ' selected' : ''}>` +
        `${option.label} (${option.count})</option>`,
    )
    .join('');

  if (result.feasible) {
    els.caseStatus.className = 'case-status is-feasible';
    els.caseStatus.textContent =
      `#1 of ${meta.count} ${scopeNoun(meta)} · ${result.factors} ` +
      `factor${result.factors === 1 ? '' : 's'}`;
  } else if (result.thin) {
    // First place, but by less than a case is worth making. Saying "tied" would
    // be false, and saying "#1" would oversell it.
    els.caseStatus.className = 'case-status is-thin';
    els.caseStatus.textContent =
      `#1 of ${meta.count} ${scopeNoun(meta)} · margin too thin to call a case`;
  } else if (result.rank === 1) {
    els.caseStatus.className = 'case-status is-infeasible';
    els.caseStatus.textContent = `No strict weighting · tied for #1 · ${result.factors} factor${result.factors === 1 ? '' : 's'}`;
  } else {
    els.caseStatus.className = 'case-status is-infeasible';
    els.caseStatus.textContent =
      `No weighting puts it first · closest found #${result.rank} of ${meta.count}`;
  }

  els.caseNote.textContent = caseNote(row, active.scope, result, ranking);

  // The generator solves for the fewest columns that can make the argument, so
  // the panel leads with those and lists the rest as unused.
  const ordered = criteriaForScope(active.scope)
    .map((criterion, index) => ({
      ...criterion,
      weight: result.weights[index],
    }))
    .sort((a, b) => b.weight - a.weight);
  const used = ordered.filter((criterion) => criterion.weight >= 1e-6);
  const unused = ordered.filter((criterion) => criterion.weight < 1e-6);
  els.caseWeights.innerHTML =
    used
      .map((criterion) => {
        const percent = criterion.weight * 100;
        const label = percent >= 10 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
        return `
        <div class="case-weight" title="${escapeHtml(criterion.label)}: ${percent.toFixed(1)}%">
          <span class="cw-label">${escapeHtml(criterion.label)}</span>
          <span class="cw-bar"><span style="--w:${Math.max(percent, 0).toFixed(2)}%"></span></span>
          <span class="cw-pct">${label}</span>
        </div>`;
      })
      .join('') +
    (unused.length
      ? `<p class="case-unused">Not needed: ${unused
          .map((criterion) => escapeHtml(criterion.label))
          .join(', ')}</p>`
      : '');

  // The selected row is no longer floated to the top, so bring it into view
  // inside the table's own scroll container without moving the page away from
  // the panel above it.
  const wrap = els.table.closest('.table-wrap');
  const caseRow = els.rows.querySelector('tr.row.is-case');
  if (wrap && caseRow) {
    const offset =
      caseRow.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
    wrap.scrollTop = Math.max(0, offset - wrap.clientHeight / 2 + caseRow.offsetHeight / 2);
  }
}

function render() {
  const rows = visibleRows();
  els.rows.innerHTML = rows.length
    ? rows.map(rowHtml).join('')
    : `<tr><td colspan="12" class="empty">No loads match that filter.</td></tr>`;
  renderSummary(rows);
  renderChips();
  renderSortIndicators();
  renderCasePanel();
  els.search.value = state.query;
  els.jurisdiction.value = state.jurisdiction;
  els.jurisdiction.disabled = Boolean(state.caseMode);
}

/* ------------------------------- events ------------------------------- */

els.search.addEventListener('input', (e) => {
  if (state.caseMode) return;
  state.query = e.target.value.trim();
  render();
});

els.units.addEventListener('change', (e) => {
  state.units = e.target.value;
  render();
});

els.jurisdiction.addEventListener('change', (e) => {
  if (state.caseMode) return;
  state.jurisdiction = e.target.value;
  render();
});

els.categories.addEventListener('click', (e) => {
  if (state.caseMode) return;
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.category = chip.dataset.category;
  render();
});

els.caseScope.addEventListener('change', (e) => {
  if (!state.caseMode) return;
  const scope = e.target.value;
  if (!resultFor(state.caseMode.id, scope)) return;
  state.caseMode.scope = scope;
  render();
});

els.caseClear.addEventListener('click', clearCase);

els.table.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    if (state.caseMode) return;
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      // Text columns read best A→Z; numeric columns worst→best.
      state.sortDir =
        key === 'name' || key === 'use' || key === 'category' || key === 'designer'
          ? 'asc'
          : 'desc';
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
  const caseButton = e.target.closest('[data-case]');
  if (caseButton) {
    e.preventDefault();
    e.stopPropagation();
    startCase(caseButton.dataset.case);
    return;
  }
  const row = e.target.closest('tr.row');
  if (row) toggleRow(row);
});

els.rows.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('[data-case]')) return;
  const row = e.target.closest('tr.row');
  if (!row) return;
  e.preventDefault();
  toggleRow(row);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.caseMode) clearCase();
});

els.jurisdiction.insertAdjacentHTML(
  'beforeend',
  JURISDICTIONS.map(
    (jurisdiction) =>
      `<option value="${jurisdiction.code}">${escapeHtml(jurisdiction.label)} (${escapeHtml(
        jurisdiction.scope,
      )})</option>`,
  ).join(''),
);

render();
