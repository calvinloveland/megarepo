// tests/evolution.test.mjs — genetic algorithm behaviour
import { test } from 'node:test';
import assert from 'node:assert/strict';
import watchPkg from '../watch.js';
const { computePhenotype, mulberry32 } = watchPkg;
import evoPkg from '../evolution.js';
const { CHALLENGES, evolvePopulation, randomPopulation, scoreWatch } = evoPkg;

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