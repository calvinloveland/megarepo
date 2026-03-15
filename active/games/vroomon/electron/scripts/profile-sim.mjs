import { performance } from "node:perf_hooks";

import { advanceRunState, createPreviewRunState, runEvolutionGeneration } from "../dist/core/population.js";
import { createEmptyRunState } from "../dist/shared/parity-contract.js";

const baseState = createEmptyRunState("evolution", "Grassland", "profile");
baseState.config.populationSize = 12;
baseState.config.dnaLength = 12;

let state = createPreviewRunState("profile", baseState);
const samples = [];

for (let generationIndex = 0; generationIndex < 3; generationIndex += 1) {
  const startedAt = performance.now();
  const generation = runEvolutionGeneration(state);
  const elapsedMs = performance.now() - startedAt;
  const bestScore = Math.max(
    0,
    ...generation.evaluation.results.map((result) => result.score),
  );

  samples.push({
    generation: generationIndex + 1,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    bestScore: Number(bestScore.toFixed(2)),
    meanScore: Number((generation.evaluation.stats?.mean ?? 0).toFixed(2)),
  });

  state = advanceRunState(state, generation);
}

const averageElapsedMs =
  samples.reduce((sum, sample) => sum + sample.elapsedMs, 0) / samples.length;

console.log(
  JSON.stringify(
    {
      runId: state.runId,
      terrain: state.terrainName,
      populationSize: state.config.populationSize,
      samples,
      averageElapsedMs: Number(averageElapsedMs.toFixed(2)),
    },
    null,
    2,
  ),
);
