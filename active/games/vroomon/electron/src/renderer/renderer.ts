import type { DecodedDnaV2 } from "../shared/dna-v2.js";
import type {
  RunStateSnapshot,
  TerrainPresetDefinition,
  VroomonParityContract,
} from "../shared/parity-contract.js";
import type {
  EvolutionPreview,
  ScoreStats,
} from "../core/population.js";
import type { VehicleSnapshot } from "../simulation/matter-simulation.js";

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
      getParityContract: () => VroomonParityContract;
      getTerrainPreset: (name: string) => TerrainPresetDefinition | undefined;
      createEmptyRunState: (mode: "evolution" | "test-drive") => RunStateSnapshot;
      createPreviewRunState: (runId: string) => RunStateSnapshot;
      computeScoreStats: (scores: number[]) => ScoreStats | undefined;
      previewEvolutionStep: (state: RunStateSnapshot) => EvolutionPreview;
      previewPhysicsSnapshot: (
        dna: string,
        terrainName: string,
        stepCount?: number,
      ) => VehicleSnapshot;
    };
  }
}

const dnaInput = document.querySelector<HTMLInputElement>("[data-dna-input]");
const randomizeButton = document.querySelector<HTMLButtonElement>(
  "[data-randomize-dna]",
);
const output = document.querySelector<HTMLElement>("[data-dna-output]");
const modesList = document.querySelector<HTMLElement>("[data-mode-list]");
const terrainList = document.querySelector<HTMLElement>("[data-terrain-list]");
const contractSummary = document.querySelector<HTMLElement>("[data-contract-summary]");
const runStateOutput = document.querySelector<HTMLElement>("[data-run-state-output]");
const evolutionPreviewOutput = document.querySelector<HTMLElement>(
  "[data-evolution-preview-output]",
);
const physicsPreviewOutput = document.querySelector<HTMLElement>(
  "[data-physics-preview-output]",
);

if (
  !dnaInput ||
  !randomizeButton ||
  !output ||
  !modesList ||
  !terrainList ||
  !contractSummary ||
  !runStateOutput ||
  !evolutionPreviewOutput ||
  !physicsPreviewOutput
) {
  throw new Error("Renderer UI did not initialize correctly.");
}

const dnaInputElement = dnaInput;
const randomizeButtonElement = randomizeButton;
const outputElement = output;
const modesListElement = modesList;
const terrainListElement = terrainList;
const contractSummaryElement = contractSummary;
const runStateOutputElement = runStateOutput;
const evolutionPreviewOutputElement = evolutionPreviewOutput;
const physicsPreviewOutputElement = physicsPreviewOutput;
const parityContract = window.vroomon.getParityContract();

renderContract();

function renderDecodedDna(dna: string): void {
  const cleanedDna = window.vroomon.cleanDna(dna);
  const decoded = window.vroomon.decodeDnaV2(cleanedDna);
  const wheelCount = decoded.modules.filter((module) => module === "W").length;
  const rectangleCount = decoded.modules.length - wheelCount;

  outputElement.textContent = JSON.stringify(
    {
      dna: decoded.dna,
      moduleCount: decoded.modules.length,
      modules: decoded.modules,
      powertrainModules: decoded.powertrainModules,
      rectangleCount,
      wheelCount,
      positions: decoded.positions.map((position) => Number(position.toFixed(2))),
      globals: {
        ...decoded.globals,
        comShift: Number(decoded.globals.comShift.toFixed(3)),
        dampingLinear: Number(decoded.globals.dampingLinear.toFixed(3)),
        dampingAngular: Number(decoded.globals.dampingAngular.toFixed(3)),
        temperature: Number(decoded.globals.temperature.toFixed(3)),
      },
    },
    null,
    2,
  );
  renderPhysicsPreview(decoded.dna);
}

function renderContract(): void {
  contractSummaryElement.textContent = parityContract.summary;
  modesListElement.innerHTML = parityContract.modes
    .map(
      (mode) =>
        `<li><strong>${mode.label}</strong><br /><span>${mode.description}</span></li>`,
    )
    .join("");
  terrainListElement.innerHTML = parityContract.terrains
    .map((terrain) => {
      const detailParts = [
        `${terrain.groundLength}px ground`,
        `friction ${terrain.friction.toFixed(1)}`,
        terrain.obstacleCount > 0
          ? `${terrain.obstacleCount} obstacles`
          : "no obstacles",
      ];
      return `<li><strong>${terrain.name}</strong><br /><span>${detailParts.join(
        " · ",
      )}</span></li>`;
    })
    .join("");

  const emptyEvolutionState = window.vroomon.createEmptyRunState("evolution");
  runStateOutputElement.textContent = JSON.stringify(emptyEvolutionState, null, 2);
  renderPreviewEvolution();
}

function renderPreviewEvolution(): void {
  const previewState = window.vroomon.createPreviewRunState("preview");
  const previewStep = window.vroomon.previewEvolutionStep(previewState);
  const previewScores = previewStep.population.map((entry, index) => index * 12.5);
  const scoreStats = window.vroomon.computeScoreStats(previewScores);

  evolutionPreviewOutputElement.textContent = JSON.stringify(
    {
      generatedPopulation: previewState.population.slice(0, 5),
      breeding: previewStep.breeding,
      scoreStats,
    },
    null,
    2,
  );
}

function renderPhysicsPreview(dna: string): void {
  const terrainName = parityContract.terrains[0]?.name ?? "Grassland";
  const snapshot = window.vroomon.previewPhysicsSnapshot(dna, terrainName, 90);

  physicsPreviewOutputElement.textContent = JSON.stringify(
    {
      terrainName,
      chassisCount: snapshot.chassis.length,
      wheelCount: snapshot.wheels.length,
      centerX: Number(snapshot.centerX.toFixed(2)),
      centerY: Number(snapshot.centerY.toFixed(2)),
      firstChassis: snapshot.chassis[0] ?? null,
      firstWheel: snapshot.wheels[0] ?? null,
    },
    null,
    2,
  );
}

randomizeButtonElement.addEventListener("click", () => {
  const nextDna = window.vroomon.createRandomDna(12);
  dnaInputElement.value = nextDna;
  renderDecodedDna(nextDna);
});

dnaInputElement.addEventListener("input", () => {
  renderDecodedDna(dnaInputElement.value);
});

renderDecodedDna(dnaInputElement.value);
