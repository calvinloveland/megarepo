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
// Constraints — optional handicap caps layered on top of any charter.
// Violating a cap costs a hard bite plus a linear surcharge so the GA's
// elitism steers the population toward compliant builds without hard-kludging
// the search (a tiny bit of violation is survivable, a lot never survives).
// ---------------------------------------------------------------------------

function constraintPenalty(w, constraints = {}) {
  let pen = 0;
  if (constraints.budgetCap > 0 && w.cost > constraints.budgetCap) {
    const over = w.cost - constraints.budgetCap;
    pen += over * 0.25 + 400;
  }
  if (constraints.thicknessCap > 0 && w.thickness > constraints.thicknessCap) {
    const over = w.thickness - constraints.thicknessCap;
    pen += over * 350 + 300;
  }
  return pen;
}

function constraintBreaches(w, constraints = {}) {
  const out = [];
  if (constraints.budgetCap > 0 && w.cost > constraints.budgetCap) {
    out.push(`⛔ budget over by CHF ${(w.cost - constraints.budgetCap).toLocaleString()}`);
  }
  if (constraints.thicknessCap > 0 && w.thickness > constraints.thicknessCap) {
    out.push(`⛔ ${(w.thickness - constraints.thicknessCap).toFixed(1)} mm over the thickness cap`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hybrid charters — blend two objectives by weight.
// Charter scores live on wildly different scales (skeleton ≈ 5000, chrono ≈
// 400), so a raw weighted sum would silently let the louder charter win.
// Blending by within-population rank fraction keeps both objectives audible:
//   blended = 100·((1−w)·rankFrac(charter₁) + w·rankFrac(charter₂))
// ---------------------------------------------------------------------------

function rankFraction(sortedDesc, idx) {
  return sortedDesc.length > 1 ? 1 - idx / (sortedDesc.length - 1) : 1;
}

// Mutates scored entries in place, setting `score` to the blended 0..100.
function blendScores(scored, primaryId, secondaryId, weight) {
  const byP = [...scored].sort((a, b) => b.sPrimary - a.sPrimary);
  const byS = [...scored].sort((a, b) => b.sSecondary - a.sSecondary);
  const rp = new Map(); byP.forEach((x, i) => rp.set(x, rankFraction(byP, i)));
  const rs = new Map(); byS.forEach((x, i) => rs.set(x, rankFraction(byS, i)));
  for (const x of scored) {
    x.score = 100 * ((1 - weight) * rp.get(x) + weight * rs.get(x));
  }
  return scored;
}

function scorePopulation(scored, challengeId, hybrid, constraints) {
  const c1 = CHALLENGES[challengeId];
  if (hybrid) {
    const c2 = CHALLENGES[hybrid.secondary];
    for (const s of scored) {
      s.sPrimary = c1.score(s.pheno);
      s.sSecondary = c2.score(s.pheno);
    }
    blendScores(scored, challengeId, hybrid.secondary, hybrid.weight);
  } else {
    for (const s of scored) s.score = c1.score(s.pheno);
  }
  for (const s of scored) s.score -= constraintPenalty(s.pheno, constraints);
  return scored;
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
                         score: 0, sPrimary: 0, sSecondary: 0 }));
  scorePopulation(scored, challengeId, params.hybrid || null, params.constraints || {});
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

// A themed founding archetype per charter gives each objective a plausible,
// legible starting point — a skeleton atelier opens with an openworked
// monster, a chronometer lab opens with a bare precision engine.
const FOUNDERS = {
  skeleton: (rng) => ({
    escapement: rng() < 0.7 ? 'lever' : 'coaxial', balance: 'freeSprung', hairspring: 'glucydur',
    beat: 21600, barrels: 2, trainWheels: 8, skeleton: 90, diameter: 40,
    complications: Object.fromEntries(['bigDate', 'day', 'moonphase', 'gmt', 'powerReserve', 'chronograph', 'perpetual']
      .map(id => [id, 1 + Math.floor(rng() * 2)])),
  }),
  minimalist: () => ({
    escapement: 'constant', balance: 'inertial', hairspring: 'silicon',
    beat: 36000, barrels: 1, trainWheels: 3, skeleton: 10, diameter: 34,
    complications: {},
  }),
  grandComplication: () => ({
    escapement: 'coaxial', balance: 'freeSprung', hairspring: 'glucydur',
    beat: 21600, barrels: 1, trainWheels: 3, skeleton: 50, diameter: 36,
    complications: { moonphase: 2, gmt: 2, powerReserve: 1, perpetual: 2, chronograph: 1 },
  }),
  chronometer: () => ({
    escapement: 'constant', balance: 'inertial', hairspring: 'silicon',
    beat: 28800, barrels: 1, trainWheels: 3, skeleton: 0, diameter: 34,
    complications: {},
  }),
  pocket: () => ({
    escapement: 'lever', balance: 'screw', hairspring: 'steel',
    beat: 18000, barrels: 3, trainWheels: 4, skeleton: 20, diameter: 42,
    complications: { powerReserve: 1 },
  }),
};

function founderArchetype(challengeId) {
  const fn = FOUNDERS[challengeId];
  return fn ? fn(W.mulberry32(seedFor(challengeId))) : null;
}

function seedFor(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

function randomPopulation(size, rng, challengeId) {
  const out = [];
  const archetype = challengeId ? founderArchetype(challengeId) : null;
  const founderCount = archetype ? Math.max(2, Math.round(size * 0.15)) : 0;
  if (archetype) out.push(archtype(archetype));   // pristine founding specimen
  for (let i = out.length; i < founderCount; i++) {
    // Archetype plus mild drift so the founding cohort isn't a monoculture.
    out.push(mutate(archtype(archetype), 0.22, rng));
  }
  for (let i = out.length; i < size; i++) out.push(W.randomGenotype(rng));
  return out;
}

function archtype(g) { return JSON.parse(JSON.stringify(g)); }

// Population diversity: 1 - fraction of identical complication-signatures.
// Collapsing diversity is the cue to hit "New seeds".
function diversity(pop) {
  if (pop.length < 2) return 0;
  const seen = new Set();
  for (const g of pop) {
    const sig = Object.keys(g.complications).sort().join(',');
    seen.add(sig);
  }
  return seen.size / Math.min(pop.length, 64);
}

function championPhenotype(pop, challengeId, constraints, hybrid) {
  let best = null;
  const scored = pop.map(geno => {
    const pheno = computePhenotype(geno);
    return { geno, pheno, score: 0, sPrimary: 0, sSecondary: 0 };
  });
  scorePopulation(scored, challengeId, hybrid || null, constraints || {});
  for (const s of scored) {
    if (!best || s.score > best.score) best = { geno: s.geno, pheno: s.pheno, score: s.score };
  }
  return best;
}

const EVOLUTION = { CHALLENGES, scoreWatch, evolvePopulation, randomPopulation, championPhenotype, FOUNDERS, founderArchetype, diversity, constraintPenalty, constraintBreaches, blendScores, scorePopulation, mutate };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EVOLUTION;
} else {
  root.WATCH_EVOLUTION = EVOLUTION;
}

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {}));
