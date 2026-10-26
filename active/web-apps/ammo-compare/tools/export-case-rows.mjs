/**
 * Serialize the enriched load rows for the case-weight generator.
 *
 * The browser keeps this enrichment in app.js; the Python generator needs the
 * same numbers (energy, effective range, power factor) without re-implementing
 * the ballistic model. Run from the project root:
 *
 *   node tools/export-case-rows.mjs > /tmp/ammo-case-rows.json
 */
import { AMMO } from '../data/ammo.js';
import { derive } from '../lib/ballistics.js';
import { effectiveRangeYd } from '../lib/trajectory.js';
import { recoilProfile } from '../lib/recoil.js';

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
    powerFactor: derived.powerFactor,
    recoilFtLb: recoilProfile(load).recoilFtLb,
    costPerRound: load.costPerRound ?? null,
    caseLengthMm: load.caseLengthMm ?? null,
  };
});

process.stdout.write(JSON.stringify(rows, null, 1));
