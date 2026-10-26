/**
 * Resolve the jurisdiction overlay in `data/legality.js` into per-load answers.
 *
 * Two questions the UI asks:
 *   restrictionsFor(row)        → which jurisdictions restrict this load, and why
 *   matchesJurisdiction(row, c) → may I keep this row while filtering to `c`
 *
 * The filter is deliberately a hard filter, not a weighted criterion: "legal
 * here" is a gate you pass or fail, not a percentile you trade against energy.
 */
import { EXCEPTIONS, JURISDICTIONS, RULES } from '../data/legality.js';

export { EXCEPTIONS, JURISDICTIONS, RULES };

const BY_CODE = new Map(JURISDICTIONS.map((jurisdiction) => [jurisdiction.code, jurisdiction]));

export function jurisdictionFor(code) {
  return BY_CODE.get(code) ?? null;
}

/** Every restriction that applies to a load, in jurisdiction order. */
export function restrictionsFor(row) {
  const exceptions = EXCEPTIONS[row.id] ?? {};
  const found = [];
  for (const jurisdiction of JURISDICTIONS) {
    if (Object.hasOwn(exceptions, jurisdiction.code)) {
      const note = exceptions[jurisdiction.code];
      if (note) found.push({ ...jurisdiction, note });
      continue;
    }
    const rule = RULES.find(
      (candidate) => candidate.code === jurisdiction.code && candidate.test(row),
    );
    if (rule) found.push({ ...jurisdiction, note: rule.note, rule: rule.key });
  }
  return found;
}

/** True when no restriction is recorded for the jurisdiction (or filtering is off). */
export function matchesJurisdiction(row, code) {
  if (!code || code === 'all') return true;
  return !restrictionsFor(row).some((restriction) => restriction.code === code);
}

/** "Mexico, Italy" — for badges and summary lines. */
export function jurisdictionNames(restrictions) {
  return restrictions.map((restriction) => restriction.label).join(', ');
}
