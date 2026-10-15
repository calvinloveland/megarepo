// watch.js — Watch Forge genotype → phenotype model
// =================================================
// A "watch" is a chromosome (base genes + complication grades). This module
// converts a chromosome into the physical/scoring attributes the challenges
// price: component count, visible components, thickness, weight, cost,
// complexity, power reserve, accuracy, reliability.
//
// Deterministic: same chromosome → same phenotype, so fitness comparisons in
// the genetic algorithm are stable. Browser <script> + node:test compatible.

'use strict';

(function (root) {

const D = (typeof module !== 'undefined' && module.exports)
  ? require('./data.js')
  : root.WATCH_DATA;

const { ESCAPEMENTS, BALANCES, HAIRSPRINGS, BEATS, BARREL, TRAIN_WHEEL,
        TRAIN_MIN, TRAIN_MAX, SKELETON_MIN, SKELETON_MAX,
        MAINSPRING_RESERVE, COMPLICATIONS, COMPLICATION_IDS, GRADE_MAX } = D;

// Power draw added by complications (× base draw).
const COMPLICATION_POWER = {
  chronograph: 0.12, splitSecond: 0.20, minuteRepeater: 0.22, tourbillon: 0.18,
  perpetual: 0.05, worldTime: 0.06, equationOfTime: 0.03, moonphase: 0.02,
};

// ---------------------------------------------------------------------------
// Genotype helpers
// ---------------------------------------------------------------------------

const BEAT_KEYS = Object.keys(BEATS).map(Number);

function randomGenotype(rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const g = {
    escapement: pick(Object.keys(ESCAPEMENTS)),
    balance: pick(Object.keys(BALANCES)),
    hairspring: pick(Object.keys(HAIRSPRINGS)),
    beat: pick(BEAT_KEYS),
    barrels: 1 + Math.floor(rng() * 3),           // 1..3
    trainWheels: TRAIN_MIN + Math.floor(rng() * (TRAIN_MAX - TRAIN_MIN + 1)),
    skeleton: Math.floor(rng() * (SKELETON_MAX - SKELETON_MIN + 1)),
    diameter: 28 + Math.floor(rng() * 15),        // 28..42 mm
    complications: {},
  };
  for (const id of COMPLICATION_IDS) {
    if (rng() < 0.30) g.complications[id] = 1 + Math.floor(rng() * GRADE_MAX);
  }
  return g;
}

// Deterministic integer hash of a genotype — used for noise seeding and names.
function genotypeHash(geno) {
  let h = 2166136261 >>> 0;
  const feed = (s) => {
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  feed(geno.escapement); feed(geno.balance); feed(geno.hairspring);
  feed(geno.beat); feed(geno.barrels); feed(geno.trainWheels);
  feed(geno.skeleton); feed(geno.diameter);
  for (const id of COMPLICATION_IDS) {
    const g = geno.complications[id] || 0;
    feed(id); feed(g);
  }
  return h >>> 0;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function roman(n) { return ROMAN[(n - 1) % ROMAN.length]; }

function championName(geno) {
  const h = genotypeHash(geno);
  const calibre = `Calibre ${roman((h % 10) + 1)}${h % 2 ? '½' : ''}`;
  const features = [];
  if (geno.skeleton >= 70) features.push('Squelette');
  if (geno.complications.tourbillon) features.push('Tourbillon');
  if (geno.complications.minuteRepeater) features.push('Grande Sonnerie');
  if (geno.complications.perpetual) features.push('Perpétuel');
  if (geno.complications.chronograph || geno.complications.splitSecond) features.push('Chronographe');
  if (geno.barrels >= 3) features.push('Huit Jours');
  if (geno.hairspring === 'silicon') features.push('Silicium');
  if (features.length === 0) features.push(ESCAPEMENTS[geno.escapement].name.replace('Swiss ', ''));
  return `${calibre} ${features.join(' · ')}`;
}

// ---------------------------------------------------------------------------
// Phenotype
// ---------------------------------------------------------------------------

function gradeScale(grade, parts) {
  const g = grade - 1;
  return {
    thick: 1 + 0.04 * g,
    weight: 1 + 0.05 * g,
    cost: 0.75 + 0.35 * grade,
    complexity: 0.7 + 0.4 * grade,
    acc: -0.03 * grade,
    vis: 0.8 + 0.25 * g,
    parts: 1,
  };
}

function computePhenotype(geno, opts = {}) {
  const rng = opts.rng || mulberry32(genotypeHash(geno) ^ 0x9e3779b9);
  const esc = ESCAPEMENTS[geno.escapement];
  const bal = BALANCES[geno.balance];
  const hs = HAIRSPRINGS[geno.hairspring];
  const beat = BEATS[geno.beat];
  const open = Math.max(0, Math.min(1, geno.skeleton / 100));

  // --- component counts -------------------------------------------------
  let partsTotal = 5;                       // main plate, bridges, crown, stem, hands
  partsTotal += geno.barrels * 2;           // barrel + cap per barrel
  partsTotal += geno.trainWheels * 1.7;     // wheel + pinion each
  partsTotal += 4;                          // escape wheel, pallet fork, staffs
  partsTotal += 3;                          // balance, hairspring, regulator

  let thickness = 0.35                      // main plate
    + esc.thick + bal.thick + hs.thick
    + geno.barrels * BARREL.thick
    + geno.trainWheels * TRAIN_WHEEL.thick
    + 0.55;                                 // dial + case back
  let weight = 2.2 + esc.weight + bal.weight + hs.weight
    + geno.barrels * BARREL.weight
    + geno.trainWheels * TRAIN_WHEEL.weight;
  let cost = 180 + esc.cost + bal.cost + hs.cost
    + geno.barrels * BARREL.cost
    + geno.trainWheels * TRAIN_WHEEL.cost;
  let complexity = 2 + esc.complexity + bal.complexity + hs.complexity
    + geno.barrels * BARREL.complexity
    + geno.trainWheels * TRAIN_WHEEL.complexity;

  // Diameter estate: bigger movements are heavier, pricier, and give the
  // skeletonizer more dial to show off.
  const diaScale = Math.max(0, geno.diameter - 34);
  weight += diaScale * 0.30;
  cost += diaScale * 45;

  // --- complications ------------------------------------------------------
  const cross = (id) => COMPLICATION_POWER[id] || 0;
  let power = 1.0 * esc.power * beat.power * (1 + (geno.trainWheels - TRAIN_MIN) * 0.03);
  // Rate deviation (s/day). Base 3.0 s/day is multiplied down by each
  // component's accFactor — multiplicative so upgrades can never overshoot
  // into "worse" territory. Friction from train wheels / extra springs and
  // the running draw of heavy complications add back linearly.
  let accDev = 3.0 * esc.accFactor * bal.accFactor * hs.accFactor * beat.accFactor
    + (geno.trainWheels - TRAIN_MIN) * 0.18
    + (geno.barrels - 1) * 0.08;
  let visSum = 5 * 0.5
    + geno.barrels * 2 * BARREL.vis
    + geno.trainWheels * 1.7 * TRAIN_WHEEL.vis
    + 4 * esc.vis + 3 * bal.vis + 1 * hs.vis;

  let compCount = 0;
  let compGradeSum = 0;
  const compList = [];

  for (const id of COMPLICATION_IDS) {
    const grade = geno.complications[id] || 0;
    if (!grade) continue;
    const def = COMPLICATIONS[id];
    const s = gradeScale(grade, def.parts);
    const parts = def.parts * s.parts;

    compCount += 1;
    compGradeSum += grade;
    compList.push({ id, grade, name: def.name, parts: Math.round(parts),
                    thick: def.thick * s.thick, weight: def.weight * s.weight,
                    cost: def.cost * s.cost, complexity: def.complexity * s.complexity,
                    vis: def.vis * s.vis });

    partsTotal += parts;
    thickness += def.thick * s.thick;
    weight += def.weight * s.weight;
    cost += def.cost * s.cost;
    complexity += def.complexity * s.complexity;
    power += cross(id);
    accDev += def.acc + s.acc;
    visSum += parts * def.vis * s.vis;
  }

  // --- derived -------------------------------------------------------------
  const componentCount = Math.round(partsTotal);
  power = Math.max(0.5, power);
  const powerReserve = Math.min(240, (geno.barrels * MAINSPRING_RESERVE) / power);

  const reliability = Math.max(0.30, Math.min(1.0,
    0.94 * esc.rel * hs.rel * beat.rel
    - complexity * 0.004
    - (geno.barrels - 1) * 0.006
  ));

  // Deterministic manufacturing noise, ±0.35 s/day, so identical builds vary
  // slightly between "specimens" — real watchmakers will recognise this.
  accDev += (rng() * 0.7 - 0.35);

  const accuracy = Math.max(0.3, Math.abs(accDev));
  const effectiveAccuracy = accuracy * (2.0 - reliability);

  const visibility = open === 0
    ? visSum * 0.25
    : visSum * (0.25 + 0.75 * open);
  const visibleComponents = Math.round(visibility * (1 + diaScale * 0.01));

  return {
    geno, open,
    componentCount,
    visibleComponents,
    thickness: round1(thickness),
    weight: round1(weight),
    cost: Math.round(cost),
    complexity: round1(complexity),
    powerReserve: Math.round(powerReserve),
    accuracy: round2(accuracy),
    effectiveAccuracy: round2(effectiveAccuracy),
    reliability: round3(reliability),
    power,
    compCount, compGradeSum, compList,
    name: championName(geno),
  };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }
function round3(x) { return Math.round(x * 1000) / 1000; }

const WATCH = { randomGenotype, genotypeHash, computePhenotype, championName, mulberry32 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ...WATCH, D };
} else {
  root.WATCH = WATCH;
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {}));
