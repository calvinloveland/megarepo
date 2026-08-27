// tests/evolution.test.mjs — genetic algorithm behaviour
import { test } from 'node:test';
import assert from 'node:assert/strict';
import watchPkg from '../watch.js';
const { computePhenotype, mulberry32, randomGenotype } = watchPkg;
import evoPkg from '../evolution.js';
const { CHALLENGES, evolvePopulation, randomPopulation, scoreWatch, founderArchetype, diversity, constraintPenalty, constraintBreaches } = evoPkg;

const POP = 60;

test('evolution improves best fitness across generations', () => {
  for (const id of Object.keys(CHALLENGES)) {
    const rng = mulberry32(9001);
    let pop = randomPopulation(POP, rng);
    let best0 = -Infinity;
    for (const g of pop) best0 = Math.max(best0, scoreWatch(computePhenotype(g), id));

    let state = { population: pop, lastBest: undefined, stall: 0 };
    let bestEnd = best0;
    for (let gen = 0; gen < 60; gen++) {
      state = evolvePopulation({ ...state, challengeId: id, population: state.population, rng });
      bestEnd = state.best.score;
    }
    assert.ok(bestEnd >= best0, `${id}: ${bestEnd} >= ${best0}`);
  }
});

test('elite champion survives into the next generation unchanged', () => {
  const rng = mulberry32(1234);
  let pop = randomPopulation(40, rng);
  const state = evolvePopulation({ challengeId: 'skeleton', population: pop, elitism: 5, rng });
  const champGeno = state.scored[0].geno;
  const survived = state.population.some(g =>
    JSON.stringify({ ...g, complications: Object.fromEntries(Object.entries(g.complications).sort()) }) ===
    JSON.stringify({ ...champGeno, complications: Object.fromEntries(Object.entries(champGeno.complications).sort()) })
  );
  assert.ok(survived, 'best chromosome present in next generation');
});

test('population size is preserved across generations', () => {
  const rng = mulberry32(55);
  let state = { population: randomPopulation(POP, rng), lastBest: undefined, stall: 0 };
  for (let gen = 0; gen < 10; gen++) {
    state = evolvePopulation({ ...state, challengeId: 'minimalist', population: state.population, rng });
    assert.equal(state.population.length, POP);
  }
});

test('different challenges converge to visibly different builds', () => {
  const run = (id) => {
    const rng = mulberry32(7);
    let state = { population: randomPopulation(POP, rng), lastBest: undefined, stall: 0 };
    for (let gen = 0; gen < 80; gen++) {
      state = evolvePopulation({ ...state, challengeId: id, population: state.population, rng });
    }
    return state.best.pheno;
  };
  const skeletonChamp = run('skeleton');
  const slimChamp = run('grandComplication');
  const leanChamp = run('minimalist');

  // The grand complication champion piles on complications…
  assert.ok(slimChamp.compCount >= 4, `slim ${slimChamp.compCount}`);
  // …while the minimalist champion keeps the parts count low.
  assert.ok(leanChamp.componentCount <= 34, `lean ${leanChamp.componentCount}`);
  // And the skeleton champion exposes a lot of metal.
  assert.ok(skeletonChamp.open > 0.55, `skeleton open ${skeletonChamp.open}`);
});

test('stall counter rises when best fitness plateaus', () => {
  const rng = mulberry32(99);
  const frozen = randomPopulation(30, rng);
  let state = { population: frozen.slice(), lastBest: undefined, stall: 0 };
  for (let i = 0; i < 5; i++) {
    // A fully frozen population cannot improve — stall must accumulate.
    state = evolvePopulation({ ...state, challengeId: 'skeleton', population: frozen.slice(), rng });
  }
  assert.ok(state.stall >= 3, `stall ${state.stall}`);
  assert.ok(state.mutRate > 0.08, `adaptive mutation ${state.mutRate}`);
});

test('every charter has a themed founder archetype', () => {
  const archetypes = [];
  for (const id of Object.keys(CHALLENGES)) {
    const a = founderArchetype(id);
    assert.ok(a, `${id} archetype exists`);
    assert.ok(a.escapement && a.balance && a.hairspring, `${id} base genes set`);
    assert.ok(Number.isInteger(a.trainWheels) && a.trainWheels >= 3, `${id} train`);
    archetypes.push(a);
  }
  // The archetypes are visibly different from each other (base genes + load).
  const sigs = new Set(archetypes.map(a => `${a.escapement}|${a.balance}|${a.hairspring}|${a.beat}|${JSON.stringify(a.complications)}`));
  assert.ok(sigs.size >= 5, `distinct archetype signatures: ${sigs.size}`);
});

test('charter-seeded populations contain the founder signature', () => {
  const pop = randomPopulation(40, mulberry32(1), 'minimalist');
  const hasFounder = pop.some(g => Object.keys(g.complications).length === 0 && g.hairspring === 'silicon');
  assert.ok(hasFounder, 'a clean precision build survives in the founding cohort');
  const grand = randomPopulation(40, mulberry32(2), 'grandComplication');
  const hasLoaded = grand.some(g => Object.keys(g.complications).length >= 4);
  assert.ok(hasLoaded, 'Thin King founders start complication-loaded');
});

test('diversity collapses for a monoculture and recovers for random mixes', () => {
  const clonePop = Array.from({ length: 20 }, () => JSON.parse(JSON.stringify(founderArchetype('skeleton'))));
  assert.ok(diversity(clonePop) < 0.2, `clone diversity ${diversity(clonePop)}`);
  const mixed = randomPopulation(60, mulberry32(3), 'skeleton');
  assert.ok(diversity(mixed) > 0.5, `seeded diversity ${diversity(mixed)}`);
});

test('constraint penalty bites over-budget and too-thick builds', () => {
  const w = computePhenotype(randomGenotype(mulberry32(7)));
  assert.equal(constraintPenalty(w, {}), 0);
  // Budget: stricter cap ⇒ bigger bite (no other caps muddying the compare).
  const soft = constraintPenalty(w, { budgetCap: 20000 });
  const hard = constraintPenalty(w, { budgetCap: 1000 });
  assert.ok(soft > 0 || w.cost <= 20000, 'soft bite if over its cap');
  assert.ok(hard >= soft, `hard ${hard} >= soft ${soft}`);
  // Thickness cap adds up on top of budget.
  const both = constraintPenalty(w, { budgetCap: 20000, thicknessCap: 5 });
  assert.ok(both >= soft, `both ${both} >= soft ${soft}`);
  const none = constraintPenalty(w, { budgetCap: 0, thicknessCap: 0 });
  assert.equal(none, 0);
});

test('constrained evolution keeps the champion within caps', () => {
  const rng = mulberry32(4242);
  const constraints = { budgetCap: 12000, thicknessCap: 9 };
  let state = { population: randomPopulation(50, rng, 'grandComplication'), lastBest: undefined, stall: 0 };
  for (let g = 0; g < 90; g++) {
    state = evolvePopulation({ ...state, challengeId: 'grandComplication', population: state.population, constraints, rng });
  }
  const champ = state.best.pheno;
  assert.ok(champ.cost <= 12000, `cost ${champ.cost} ≤ 12000`);
  assert.ok(champ.thickness <= 9.5, `thickness ${champ.thickness} ≤ 9.5 (tolerance)`);
  assert.ok(champ.compCount >= 4, `still complication-loaded: ${champ.compCount}`);
});

test('constraint breaches report human-readable violations', () => {
  const w = computePhenotype({ ...randomGenotype(mulberry32(11)), complications: { minuteRepeater: 3 } });
  const list = constraintBreaches(w, { budgetCap: 2000, thicknessCap: 8 });
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.match(list.join(' '), /over|cap/);
});