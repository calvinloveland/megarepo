import type { DecodedDnaV2 } from "../shared/dna-v2.js";
import type {
  RunStateSnapshot,
  TerrainPresetDefinition,
  VroomonParityContract,
} from "../shared/parity-contract.js";

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
      getParityContract: () => VroomonParityContract;
      getTerrainPreset: (name: string) => TerrainPresetDefinition | undefined;
      createEmptyRunState: (mode: "evolution" | "test-drive") => RunStateSnapshot;
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

if (
  !dnaInput ||
  !randomizeButton ||
  !output ||
  !modesList ||
  !terrainList ||
  !contractSummary ||
  !runStateOutput
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
