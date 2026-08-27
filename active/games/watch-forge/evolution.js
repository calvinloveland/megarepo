// evolution.js — Watch Forge challenges + genetic algorithm
// =========================================================
// Each challenge is a scoring equation over a watch phenotype. The player
// picks a charter (objective), and the GA evolves a population of
// chromosomes toward it.
//
// The GA is deliberately simple and inspectable:
//   - fitness = challenge score
//   - rank selection: elites survive, the rest are bred via crossover+mutate
//   - adaptive mutation: if the best fitness stalls, mutation rate rises so
//     the search can jump out of local maxima.

'use strict';

(function (root) {

const W = (typeof module !== 'undefined' && module.exports)
  ? require('./watch.js')
  : root.WATCH;
const { computePhenotype, genotypeHash, mulberry32 } = W;

// ---------------------------------------------------------------------------
// Challenges — the scoring equations
// ---------------------------------------------------------------------------
// Each `score(w)` receives a phenotype. The stated intent in comments is what
// the equation rewards; tests in tests/fitness.test.mjs lock the behaviour in.

const CHALLENGES = {
  skeleton: {
    id: 'skeleton',
    name: 'Glass Palace',
    icon: '🔍',
    tagline: 'Show every gear. Expose as many components as possible.',
    equation: '14·visibleParts + 30·openness + 0.15·reserve − 6·thickness − 0.004·cost',
    score(w) {
      return w.visibleComponents * 14
        + w.open * 30
        + w.powerReserve * 0.15
        - w.thickness * 6
        - w.cost * 0.004;
    },
  },

  minimalist: {
    id: 'minimalist',
    name: 'Less Is More',
    icon: '🪶',
    tagline: 'Chronometric perfection with the fewest possible parts.',
    equation: '480/(1+|acc|) + 50·reliability − 9·components − 14·thickness − 1.2·complexity − 0.0025·cost',
    score(w) {
      return 480 / (1 + Math.abs(w.accuracy))
        + w.reliability * 50
        - w.componentCount * 9
        - w.thickness * 14
        - w.complexity * 1.2
        - w.cost * 0.0025;
    },
  },

  grandComplication: {
    id: 'grandComplication',
    name: 'Thin King',
    icon: '👑',
    tagline: 'Maximum complications in the slimmest form factor.',
    equation: '75·complications + 22·gradeSum + 40/(1+|acc|) + 25·reliability − 48·thickness − 1.5·components',
    score(w) {
      return w.compCount * 75
        + w.compGradeSum * 22
        + 40 / (1 + Math.abs(w.accuracy))
        + w.reliability * 25
        - w.thickness * 48
        - w.componentCount * 1.5
        - w.cost * 0.002;
    },
  },

  chronometer: {
    id: 'chronometer',
    name: 'Chronometer Trials',
    icon: '🎯',
    tagline: 'Pure rate accuracy. No excuses.',
    equation: '600/(1+|effAcc|) + 80·reliability − 0.004·cost − 8·thickness',
    score(w) {
      return 600 / (1 + Math.abs(w.effectiveAccuracy))
        + w.reliability * 80
        - w.cost * 0.004
        - w.thickness * 8;
    },
  },

  pocket: {
    id: 'pocket',
    name: 'Eight-Day Pocket Hero',
    icon: '⏳',
    tagline: 'Power reserve and dependability above all.',
    equation: '2.2·reserve + 90·reliability − 0.003·cost − 10·thickness − 0.5·acc',
    score(w) {
      return w.powerReserve * 2.2
        + w.reliability * 90
        - w.cost * 0.003
        - w.thickness * 10
        - w.accuracy * 0.5;
    },
  },
};

function scoreWatch(pheno, challengeId) {
  return CHALLENGES[challengeId].score(pheno);
}

// ---------------------------------------------------------------------------
// Genetic algorithm
// ---------------------------------------------------------------------------

function evolvePopulation(params) {
  // params: { challengeId, population, elitism, baseMutRate, rng }
  const { challengeId, elitism = 10, baseMutRate = 0.08 } = params;
  const rng = params.rng || Math.random;
  const pop = params.population;

  const scored = pop
    .filter(w => w)
    .map(geno => ({ geno, pheno: computePhenotype(geno, { rng: mulberry32(genotypeHash(geno) ^ 0x51ed270b) }),
                         score: 0 }));
  for (const s of scored) s.score = CHALLENGES[challengeId].score(s.pheno);
  scored.sort((a, b) => b.score - a.score);

  const next = [];
  for (let i = 0; i < Math.min(elitism, scored.length); i++) next.push(scored[i].geno);

  // Adaptive mutation: detect stall via best-score memory stored on params.
  const bestNow = scored[0].score;
  let stall = params.stall || 0;
  if (params.lastBest !== undefined && bestNow <= params.lastBest + 0.001) stall += 1;
  else stall = 0;
  params.lastBest = bestNow;
  params.stall = stall;
  params.mutRate = Math.min(0.35, baseMutRate * (1 + stall * 0.25));

  while (next.length < pop.length) {
    const a = tournament(scored, rng);
    const b = tournament(scored, rng);
    let child = crossover(a.geno, b.geno, rng);
    child = mutate(child, params.mutRate, rng);
    next.push(child);
  }

  return { population: next, scored, best: scored[0], stall: params.stall, mutRate: params.mutRate, lastBest: params.lastBest };
}

function tournament(scored, rng) {
  const k = Math.min(4, scored.length);
  let best = scored[Math.floor(rng() * scored.length)];
  for (let i = 1; i < k; i++) {
    const c = scored[Math.floor(rng() * scored.length)];
    if (c.score > best.score) best = c;
  }
  return best;
}

// Uniform blend crossover: each gene comes from a random parent.
function crossover(a, b, rng) {
  const child = {
    escapement: rng() < 0.5 ? a.escapement : b.escapement,
    balance: rng() < 0.5 ? a.balance : b.balance,
    hairspring: rng() < 0.5 ? a.hairspring : b.hairspring,
    beat: rng() < 0.5 ? a.beat : b.beat,
    barrels: rng() < 0.5 ? a.barrels : b.barrels,
    trainWheels: rng() < 0.5 ? a.trainWheels : b.trainWheels,
    skeleton: rng() < 0.5 ? a.skeleton : b.skeleton,
    diameter: rng() < 0.5 ? a.diameter : b.diameter,
    complications: {},
  };
  for (const id in { ...a.complications, ...b.complications }) {
    const ga = a.complications[id] || 0;
    const gb = b.complications[id] || 0;
    if (ga === gb) { if (ga) child.complications[id] = ga; continue; }
    // Bias toward the parent with the higher grade so useful modules persist.
    const parent = (rng() < 0.5) ? (ga > gb ? a : b) : (ga > gb ? b : a);
    const g = parent.complications[id] || 0;
    if (g) child.complications[id] = g;
  }
  return child;
}

function mutate(geno, rate, rng) {
  const g = {
    escapement: geno.escapement, balance: geno.balance, hairspring: geno.hairspring,
    beat: geno.beat, barrels: geno.barrels, trainWheels: geno.trainWheels,
    skeleton: geno.skeleton, diameter: geno.diameter,
    complications: { ...geno.complications },
  };

  if (rng() < rate) g.escapement = pickOther(escKeys, g.escapement, rng);
  if (rng() < rate) g.balance = pickOther(balKeys, g.balance, rng);
  if (rng() < rate) g.hairspring = pickOther(hsKeys, g.hairspring, rng);
  if (rng() < rate) g.beat = pickOther(beatKeys, g.beat, rng);
  if (rng() < rate) g.barrels = clampInt(g.barrels + randStep(rng), 1, 3);
  if (rng() < rate) g.trainWheels = clampInt(g.trainWheels + randStep(rng), 3, 9);
  if (rng() < rate) g.skeleton = clampInt(g.skeleton + Math.floor((rng() * 2 - 1) * 16), 0, 100);
  if (rng() < rate) g.diameter = clampInt(g.diameter + Math.floor((rng() * 2 - 1) * 4), 28, 42);

  for (const id of complicationIds) {
    if (rng() < rate * 1.1) {
      const cur = g.complications[id] || 0;
      const next = cur === 0
        ? (rng() < 0.5 ? 1 + Math.floor(rng() * 3) : 0)            // chance to add
        : (rng() < 0.5 ? cur + 1 : cur - 1);                        // grade up/down
      const v = clampInt(next, 0, 3);
      if (v === 0) delete g.complications[id];
      else g.complications[id] = v;
    }
  }
  return g;
}

// ---- mutation helpers (browser+node safe) -------------------------------

const D_ = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.WATCH_DATA;
const escKeys = Object.keys(D_.ESCAPEMENTS);
const balKeys = Object.keys(D_.BALANCES);
const hsKeys = Object.keys(D_.HAIRSPRINGS);
const beatKeys = Object.keys(D_.BEATS).map(Number);
const complicationIds = D_.COMPLICATION_IDS;

function pickOther(keys, current, rng) {
  const others = keys.filter(k => k !== current);
  return others.length ? others[Math.floor(rng() * others.length)] : current;
}
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function randStep(rng) { return rng() < 0.5 ? -1 : 1; }

// ---------------------------------------------------------------------------
// Population factory
// ---------------------------------------------------------------------------

function randomPopulation(size, rng) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(W.randomGenotype(rng));
  return out;
}

function championPhenotype(pop, challengeId) {
  let best = null;
  for (const geno of pop) {
    const pheno = computePhenotype(geno);
    const s = CHALLENGES[challengeId].score(pheno);
    if (!best || s > best.score) best = { geno, pheno, score: s };
  }
  return best;
}

const EVOLUTION = { CHALLENGES, scoreWatch, evolvePopulation, randomPopulation, championPhenotype };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EVOLUTION;
} else {
  root.WATCH_EVOLUTION = EVOLUTION;
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {}));
