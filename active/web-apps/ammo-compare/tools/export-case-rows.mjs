/**
 * Serialize the enriched load rows for the case-weight generator.
 *
 * The browser keeps this enrichment in app.js; the Python generator needs the
 * same numbers (energy, effective range, recoil, jurisdiction restrictions)
 * without re-implementing the ballistic model or the legal overlay. Run from the
 * project root:
 *
 *   node tools/export-case-rows.mjs > /tmp/ammo-case-rows.json
 *
 * The output is `{ jurisdictions, rows }` so the generator can build one
 * comparison set per jurisdiction from the same rules the table filters on.
 */
import { AMMO } from '../data/ammo.js';
import { derive } from '../lib/ballistics.js';
import { effectiveRangeYd } from '../lib/trajectory.js';
import { recoilProfile } from '../lib/recoil.js';
import { JURISDICTIONS, restrictionsFor } from '../lib/legality.js';

const rows = AMMO.map((load) => {
  const derived = derive(load);
  return {
    id: load.id,
    name: load.name,
    category: load.category,
    introduced: load.introduced ?? null,
    bulletGr: load.bulletGr,
    velocityFps: load.velocityFps,
    energyFtLb: derived.energyFtLb,
    effectiveRangeYd: effectiveRangeYd(load),
    recoilFtLb: recoilProfile(load).recoilFtLb,
    costPerRound: load.costPerRound ?? null,
    caseLengthMm: load.caseLengthMm ?? null,
    // Which jurisdictions restrict this load, so the generator can scope a case
    // to "loads a civilian may own in X" without duplicating the rules.
    restrictedIn: restrictionsFor(load).map((restriction) => restriction.code),
  };
});

const jurisdictions = JURISDICTIONS.map(({ code, label, scope }) => ({ code, label, scope }));

process.stdout.write(JSON.stringify({ jurisdictions, rows }, null, 1));
