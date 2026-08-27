// data.js — Watch Forge component catalog
// =========================================
// Pure data + tiny helpers. Loaded as a plain <script> in the browser and
// require()d by the node:test suite, so it must not touch the DOM.
//
// The catalog defines the genotype alphabet:
//   - base genes   : escapement, balance, hairspring, beat rate,
//                    mainspring barrels, gear-train wheels, skeletonization
//   - complications: optional modules, each with 1..3 quality grades
//
// Every value is in watchmaker-adjacent units so the derived phenotypes
// (thickness mm, weight g, cost CHF, accuracy s/day, power reserve h) read
// naturally. Numbers are not intended to be museum-accurate; the game is a
// believable engineering toy, not a cost book.

'use strict';

(function (root) {


// ---------------------------------------------------------------------------
// Base movement genes
// ---------------------------------------------------------------------------

// Escapements. `accFactor` multiplies the base rate deviation (1.0 = no
// improvement, lower = better). `power` multiplies power consumption.
// `rel` multiplies reliability (friction / fragility compromise).
const ESCAPEMENTS = {
  lever:     { name: 'Swiss lever',        thick: 1.15, weight: 0.85, cost: 320,   complexity: 3, accFactor: 1.00, power: 1.00, rel: 1.02, vis: 0.95 },
  coaxial:   { name: 'Co-axial',           thick: 1.30, weight: 1.00, cost: 980,   complexity: 5, accFactor: 0.82, power: 0.85, rel: 1.00, vis: 1.10 },
  detent:    { name: 'Detent chronometer', thick: 1.45, weight: 1.15, cost: 1450,  complexity: 6, accFactor: 0.68, power: 0.92, rel: 0.80, vis: 1.15 },
  constant:  { name: 'Constant force',     thick: 1.70, weight: 1.30, cost: 2100,  complexity: 8, accFactor: 0.55, power: 0.78, rel: 0.88, vis: 1.25 },
};

// Balances.
const BALANCES = {
  plain:      { name: 'Plain balance',     thick: 1.00, weight: 0.50, cost: 140,  complexity: 1, accFactor: 1.00, vis: 0.50 },
  screw:      { name: 'Screw balance',     thick: 1.00, weight: 0.75, cost: 340,  complexity: 3, accFactor: 0.80, vis: 0.85 },
  freeSprung: { name: 'Free-sprung',       thick: 1.10, weight: 0.65, cost: 690,  complexity: 4, accFactor: 0.62, vis: 0.70 },
  inertial:   { name: 'Mono-metallic',     thick: 1.10, weight: 0.90, cost: 890,  complexity: 5, accFactor: 0.52, vis: 0.80 },
};

// Hairsprings.
const HAIRSPRINGS = {
  steel:    { name: 'Steel',             thick: 0.18, weight: 0.05, cost: 90,   complexity: 0, accFactor: 1.00, vis: 0.35, rel: 1.00 },
  glucydur: { name: 'Glucydur BeCu',     thick: 0.18, weight: 0.05, cost: 210,  complexity: 0, accFactor: 0.86, vis: 0.35, rel: 1.05 },
  silicon:  { name: 'Silicon',           thick: 0.16, weight: 0.03, cost: 520,  complexity: 1, accFactor: 0.72, vis: 0.45, rel: 1.10 },
};

// Beat rates (vibrations per hour). Higher beats promise better rate stability
// but drain the mainspring faster and wear the pivot harder.
const BEATS = {
  18000: { name: '18,000 vph (2.5 Hz)', accFactor: 1.00, power: 1.00, rel: 1.02 },
  21600: { name: '21,600 vph (3 Hz)',   accFactor: 0.90, power: 1.15, rel: 1.00 },
  28800: { name: '28,800 vph (4 Hz)',   accFactor: 0.78, power: 1.35, rel: 0.97 },
  36000: { name: '36,000 vph (5 Hz)',   accFactor: 0.67, power: 1.60, rel: 0.93 },
};

// Mainspring barrels. Each barrel stores ~44 h of nominal energy and adds
// thickness. Twin barrels run in parallel (more torque), three in series or
// parallel stacks give the "eight day" legs of a pocket hero.
const MAINSPRING_RESERVE = 44; // nominal hours per barrel
const BARREL = {
  thick: 1.55, weight: 1.45, cost: 220, complexity: 1, vis: 1.30,
};

// Gear-train wheels: 3..9. Each wheel adds a countable, visible, frictiony
// component. More wheels = more parts to expose (skeleton love) but more
// friction (accuracy + power draw penalties) and bulk.
const TRAIN_MIN = 3;
const TRAIN_MAX = 9;
const TRAIN_WHEEL = { thick: 0.12, weight: 0.30, cost: 70, complexity: 0.6, vis: 0.55 };

// Skeletonization 0..100 — percent of movement material cut away. This is the
// lever that makes components visible, at the cost of stiffness and dust.
const SKELETON_MIN = 0;
const SKELETON_MAX = 100;

// ---------------------------------------------------------------------------
// Complications
// ---------------------------------------------------------------------------
// Each complication has `parts` (component-count contribution at grade 1) and
// per-grade multipliers. Grades scale finishing: higher grade = better
// accuracy/visibility/weight but more cost + complexity.
//
// Grade multipliers are applied to the base stats:
//   thick * (1 + 0.04*g)     weight * (1 + 0.05*g)
//   cost  * (0.75 + 0.35*g)  complexity * (0.7 + 0.4*g)
//   acc   bonus: -0.03*g     vis * (0.8 + 0.25*g)
// Part count is fixed per complication — grading up refines finishing, it
// does not add wheels.

const COMPLICATION_DEFS = [
  { id: 'date',          name: 'Date',             category: 'Calendar',
    parts: 5,  thick: 0.55, weight: 0.30, cost: 260,  complexity: 2, vis: 0.40, acc: 0.0,
    desc: 'Simple date window. The gateway complication.' },
  { id: 'bigDate',       name: 'Big date',         category: 'Calendar',
    parts: 9,  thick: 0.80, weight: 0.55, cost: 480,  complexity: 4, vis: 0.65, acc: 0.0,
    desc: 'Double-disc oversized date — a favourite of the skeleton crowd.' },
  { id: 'day',           name: 'Day of week',      category: 'Calendar',
    parts: 5,  thick: 0.50, weight: 0.30, cost: 300,  complexity: 3, vis: 0.45, acc: 0.0,
    desc: 'Day disc sharing the calendar train.' },
  { id: 'month',         name: 'Month',            category: 'Calendar',
    parts: 6,  thick: 0.50, weight: 0.32, cost: 330,  complexity: 3, vis: 0.45, acc: 0.0,
    desc: 'Month indicator; pairs with the day disc.' },
  { id: 'leapYear',      name: 'Leap year',        category: 'Calendar',
    parts: 4,  thick: 0.35, weight: 0.18, cost: 240,  complexity: 2, vis: 0.35, acc: 0.0,
    desc: 'Four-year cam — cheap once you already have a calendar train.' },
  { id: 'perpetual',     name: 'Perpetual calendar', category: 'Calendar',
    parts: 18, thick: 1.10, weight: 0.95, cost: 1800, complexity: 11, vis: 0.95, acc: 0.0,
    desc: 'Auto-compensating calendar. Correct until 2100. Heavy brain.' },
  { id: 'moonphase',     name: 'Moon phase',       category: 'Astronomical',
    parts: 8,  thick: 0.90, weight: 0.65, cost: 720,  complexity: 4, vis: 0.85, acc: 0.0,
    desc: 'Lunar disc with a 59-tooth star wheel. Poet’s complication.' },
  { id: 'equationOfTime', name: 'Equation of time', category: 'Astronomical',
    parts: 11, thick: 1.00, weight: 0.80, cost: 1150, complexity: 7, vis: 0.90, acc: 0.0,
    desc: 'Solar vs mean time cam. Beautiful, absurd, collectible.' },
  { id: 'gmt',           name: 'GMT / dual time',  category: 'Travel',
    parts: 7,  thick: 0.70, weight: 0.50, cost: 580,  complexity: 3, vis: 0.70, acc: 0.0,
    desc: 'Second time zone hand with a 24-hour scale.' },
  { id: 'worldTime',     name: 'World timer',      category: 'Travel',
    parts: 14, thick: 1.05, weight: 1.05, cost: 1400, complexity: 8, vis: 1.00, acc: 0.0,
    desc: 'Rotating city ring — every time zone at a glance.' },
  { id: 'chronograph',   name: 'Chronograph',      category: 'Stopwatch',
    parts: 24, thick: 1.35, weight: 1.60, cost: 1600, complexity: 12, vis: 1.15, acc: 0.25,
    desc: 'Monopusher column-wheel chrono. Thick, heavy, glorious.' },
  { id: 'splitSecond',   name: 'Split-seconds chrono', category: 'Stopwatch',
    parts: 34, thick: 1.90, weight: 2.20, cost: 3200, complexity: 18, vis: 1.30, acc: 0.40,
    desc: 'Two chrono hands and a rattrapante heart. A complication of complications.' },
  { id: 'powerReserve',  name: 'Power reserve',    category: 'Indicator',
    parts: 6,  thick: 0.60, weight: 0.40, cost: 420,  complexity: 3, vis: 0.70, acc: 0.0,
    desc: 'Barrel torque gauge. Practically mandatory on automatics.' },
  { id: 'regulator',     name: 'Regulator display', category: 'Display',
    parts: 6,  thick: 0.65, weight: 0.55, cost: 690,  complexity: 4, vis: 0.95, acc: -0.10,
    desc: 'Hours, minutes, seconds on separate axes — horology’s science-fiction look.' },
  { id: 'jumpingHour',   name: 'Jumping hour',     category: 'Display',
    parts: 9,  thick: 0.75, weight: 0.60, cost: 1100, complexity: 6, vis: 0.85, acc: 0.0,
    desc: 'Instant-jump hour disc. Snap, snap, snap.' },
  { id: 'tourbillon',    name: 'Tourbillon',       category: 'Oscillator',
    parts: 22, thick: 1.85, weight: 1.30, cost: 3400, complexity: 15, vis: 1.55, acc: -0.90,
    desc: 'Rotating cage for the balance. The ultimate bridge between art and engineering.' },
  { id: 'minuteRepeater', name: 'Minute repeater', category: 'Aural',
    parts: 48, thick: 2.10, weight: 2.60, cost: 6500, complexity: 24, vis: 1.60, acc: 0.15,
    desc: 'Gongs + hammers + serial cams. A cathedral in your pocket.' },
];

const COMPLICATIONS = Object.fromEntries(COMPLICATION_DEFS.map(d => [d.id, d]));

// Slots for drawing each complication on the skeleton dial (fractional
// coordinates, 0..1 of the dial radius / half-extent). `kind` selects the
// drawing routine in render.js.
const COMPLICATION_SLOTS = {
  date:            { ang: Math.PI * 1.12, rad: 0.94, kind: 'window' },
  bigDate:         { ang: Math.PI * 1.10, rad: 0.94, kind: 'bigDate' },
  day:             { ang: Math.PI * 1.32, rad: 0.92, kind: 'window' },
  month:           { ang: Math.PI * 1.48, rad: 0.92, kind: 'window' },
  leapYear:        { ang: Math.PI * 1.64, rad: 0.90, kind: 'window' },
  perpetual:       { ang: Math.PI * 0.90, rad: 0.90, kind: 'perpetual' },
  moonphase:       { ang: Math.PI * 0.70, rad: 0.90, kind: 'moonphase' },
  equationOfTime:  { ang: Math.PI * 0.52, rad: 0.92, kind: 'arc' },
  gmt:             { ang: Math.PI * 0.42, rad: 0.88, kind: 'gmt' },
  worldTime:       { ang: Math.PI * 0.30, rad: 0.86, kind: 'worldTime' },
  chronograph:     { ang: Math.PI * 0.18, rad: 0.88, kind: 'chronograph' },
  splitSecond:     { ang: Math.PI * 0.04, rad: 0.88, kind: 'chronograph' },
  powerReserve:    { ang: Math.PI * 1.86, rad: 0.90, kind: 'arc' },
  regulator:       { ang: 0,               rad: 0.00, kind: 'regulator' },
  jumpingHour:     { ang: Math.PI * 1.22, rad: 0.86, kind: 'window' },
  tourbillon:      { ang: Math.PI * 0.30, rad: 0.56, kind: 'tourbillon' },
  minuteRepeater:  { ang: 0,               rad: 0.00, kind: 'repeater' },
};

// ---------------------------------------------------------------------------
// Genotype fabric / constants used by mutation
// ---------------------------------------------------------------------------
const COMPLICATION_IDS = COMPLICATION_DEFS.map(d => d.id);
const GRADE_MAX = 3;

const BASE_GENE_KEYS = ['escapement', 'balance', 'hairspring', 'beat', 'barrels', 'trainWheels', 'skeleton', 'diameter'];
const COMPLICATION_GENE_KEYS = COMPLICATION_IDS.map(id => `complication.${id}`);

const CATALOG = {
  ESCAPEMENTS, BALANCES, HAIRSPRINGS, BEATS,
  BARREL, TRAIN_WHEEL, TRAIN_MIN, TRAIN_MAX,
  SKELETON_MIN, SKELETON_MAX, MAINSPRING_RESERVE,
  COMPLICATIONS, COMPLICATION_DEFS, COMPLICATION_IDS, COMPLICATION_SLOTS,
  GRADE_MAX, BASE_GENE_KEYS, COMPLICATION_GENE_KEYS,
};

// Export for Node tests; globalThis for the browser <script> loader.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CATALOG;
} else {
  root.WATCH_DATA = CATALOG;
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {}));
