import type { DecodedDnaV2 } from "../shared/dna-v2.js";
import type {
  AppModeId,
  RunStateSnapshot,
  TerrainPresetDefinition,
  VroomonParityContract,
} from "../shared/parity-contract.js";
import type {
  EvolutionPreview,
  GenerationResult,
  PopulationEvaluation,
  ScoreStats,
} from "../core/population.js";
import type { GenerationLogEntry } from "../core/persistence.js";
import type {
  RaceVehicleSnapshot,
  VehicleSnapshot,
} from "../simulation/matter-simulation.js";
import {
  applyGenerationToState,
  createRendererState,
  getSelectedVehicleSummary,
  selectVehicle,
  setDraftDna,
  setRendererMode,
  setRendererRunState,
  setRendererTerrain,
  setSavedPath,
  type RendererState,
} from "./state.js";

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
      evaluatePopulation: (state: RunStateSnapshot) => PopulationEvaluation;
      runEvolutionGeneration: (state: RunStateSnapshot) => GenerationResult;
      advanceRunState: (
        state: RunStateSnapshot,
        generationResult: GenerationResult,
      ) => RunStateSnapshot;
      createGenerationLogEntry: (
        state: RunStateSnapshot,
        generationResult: GenerationResult,
      ) => GenerationLogEntry;
      previewEvolutionStep: (state: RunStateSnapshot) => EvolutionPreview;
      previewPhysicsSnapshot: (
        dna: string,
        terrainName: string,
        stepCount?: number,
      ) => VehicleSnapshot;
      previewPopulationRace: (
        state: RunStateSnapshot,
        stepCount?: number,
      ) => RaceVehicleSnapshot[];
      saveRunState: (state: RunStateSnapshot) => Promise<string>;
      loadRunState: () => Promise<RunStateSnapshot | null>;
      appendGenerationLog: (entry: GenerationLogEntry) => Promise<string>;
      loadGenerationLog: (runId: string) => Promise<GenerationLogEntry[]>;
    };
  }
}

const modeButtons = document.querySelectorAll<HTMLButtonElement>("[data-mode-button]");
const dnaInput = document.querySelector<HTMLInputElement>("[data-dna-input]");
const randomizeButton = document.querySelector<HTMLButtonElement>(
  "[data-randomize-dna]",
);
const generatePopulationButton = document.querySelector<HTMLButtonElement>(
  "[data-generate-population]",
);
const runGenerationButton = document.querySelector<HTMLButtonElement>(
  "[data-run-generation]",
);
const saveRunButton = document.querySelector<HTMLButtonElement>("[data-save-run]");
const loadRunButton = document.querySelector<HTMLButtonElement>("[data-load-run]");
const terrainSelect = document.querySelector<HTMLSelectElement>("[data-terrain-select]");
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
const selectedVehicleOutput = document.querySelector<HTMLElement>(
  "[data-selected-vehicle-output]",
);
const selectedVehicleButtons = document.querySelector<HTMLElement>(
  "[data-selected-vehicle-buttons]",
);
const generationLogOutput = document.querySelector<HTMLElement>(
  "[data-generation-log-output]",
);
const statusMessage = document.querySelector<HTMLElement>("[data-status-message]");
const panels = document.querySelectorAll<HTMLElement>("[data-panel]");

if (
  modeButtons.length === 0 ||
  !dnaInput ||
  !randomizeButton ||
  !generatePopulationButton ||
  !runGenerationButton ||
  !saveRunButton ||
  !loadRunButton ||
  !terrainSelect ||
  !output ||
  !modesList ||
  !terrainList ||
  !contractSummary ||
  !runStateOutput ||
  !evolutionPreviewOutput ||
  !physicsPreviewOutput ||
  !selectedVehicleOutput ||
  !selectedVehicleButtons ||
  !generationLogOutput ||
  !statusMessage ||
  panels.length === 0
) {
  throw new Error("Renderer UI did not initialize correctly.");
}

const modeButtonsElements = Array.from(modeButtons);
const dnaInputElement = dnaInput;
const randomizeButtonElement = randomizeButton;
const generatePopulationButtonElement = generatePopulationButton;
const runGenerationButtonElement = runGenerationButton;
const saveRunButtonElement = saveRunButton;
const loadRunButtonElement = loadRunButton;
const terrainSelectElement = terrainSelect;
const outputElement = output;
const modesListElement = modesList;
const terrainListElement = terrainList;
const contractSummaryElement = contractSummary;
const runStateOutputElement = runStateOutput;
const evolutionPreviewOutputElement = evolutionPreviewOutput;
const physicsPreviewOutputElement = physicsPreviewOutput;
const selectedVehicleOutputElement = selectedVehicleOutput;
const selectedVehicleButtonsElement = selectedVehicleButtons;
const generationLogOutputElement = generationLogOutput;
const statusMessageElement = statusMessage;
const panelsElements = Array.from(panels);
const parityContract = window.vroomon.getParityContract();
let rendererState = createRendererState(parityContract, dnaInputElement.value);

populateTerrainSelect();
renderApp();

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

function renderApp(): void {
  renderContract();
  renderPanels();
  renderRunState();
  renderSelectedVehiclePanel();
  renderPreviewEvolution();
  renderDecodedDna(rendererState.draftDna);
  statusMessageElement.textContent = rendererState.statusMessage;
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
}

function renderPreviewEvolution(): void {
  const previewState =
    rendererState.runState.population.length > 0
      ? rendererState.runState
      : window.vroomon.createPreviewRunState(rendererState.runState.runId);
  const generationResult =
    rendererState.latestGeneration ??
    window.vroomon.runEvolutionGeneration(previewState);
  const previewRace = window.vroomon.previewPopulationRace(previewState, 120);
  const previewScores = previewRace.map(
    (result) => Math.max(0, result.centerX - result.initialCenterX),
  );
  const scoreStats = window.vroomon.computeScoreStats(previewScores);

  evolutionPreviewOutputElement.textContent = JSON.stringify(
    {
      generatedPopulation: previewState.population.slice(0, 5),
      evaluatedPopulation: generationResult.evaluatedPopulation.slice(0, 5),
      breeding: generationResult.breeding,
      scoreStats,
      evaluationSummary: generationResult.evaluation.stats,
      nextGeneration: generationResult.nextPopulation.slice(0, 5),
      racePreview: previewRace.slice(0, 5).map((result) => ({
        id: result.id,
        travel: Number((result.centerX - result.initialCenterX).toFixed(2)),
        finalY: Number(result.centerY.toFixed(2)),
      })),
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

function renderRunState(): void {
  runStateOutputElement.textContent = JSON.stringify(rendererState.runState, null, 2);
}

function renderPanels(): void {
  for (const panel of panelsElements) {
    panel.dataset.active = panel.dataset.panel === rendererState.mode ? "true" : "false";
  }

  for (const button of modeButtonsElements) {
    button.classList.toggle(
      "active",
      button.dataset.modeButton === rendererState.mode,
    );
  }
}

function renderSelectedVehiclePanel(): void {
  const evaluatedVehicles = rendererState.latestGeneration?.evaluatedPopulation ?? [];
  selectedVehicleButtonsElement.innerHTML = evaluatedVehicles
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map(
      (vehicle) =>
        `<button class="${rendererState.selectedVehicleId === vehicle.id ? "active" : "ghost"}" type="button" data-select-vehicle="${vehicle.id}">${vehicle.id}</button>`,
    )
    .join("");

  const selectedVehicle = getSelectedVehicleSummary(rendererState);
  selectedVehicleOutputElement.textContent = JSON.stringify(
    selectedVehicle ?? { message: "Run a generation to inspect a selected car." },
    null,
    2,
  );

  for (const button of Array.from(
    selectedVehicleButtonsElement.querySelectorAll<HTMLButtonElement>(
      "[data-select-vehicle]",
    ),
  )) {
    button.addEventListener("click", () => {
      rendererState = selectVehicle(
        rendererState,
        button.dataset.selectVehicle ?? "",
      );
      renderSelectedVehiclePanel();
    });
  }
}

function populateTerrainSelect(): void {
  terrainSelectElement.innerHTML = parityContract.terrains
    .map(
      (terrain) =>
        `<option value="${terrain.name}">${terrain.name}</option>`,
    )
    .join("");
  terrainSelectElement.value = rendererState.runState.terrainName;
}

async function saveCurrentRunState(): Promise<void> {
  const savePath = await window.vroomon.saveRunState(rendererState.runState);

  if (rendererState.latestGeneration) {
    await window.vroomon.appendGenerationLog(
      window.vroomon.createGenerationLogEntry(
        {
          ...rendererState.runState,
          generation: rendererState.runState.generation - 1,
        },
        rendererState.latestGeneration,
      ),
    );
  }

  rendererState = setSavedPath(rendererState, savePath);
  await renderGenerationLog();
  renderApp();
}

async function loadSavedRunState(): Promise<void> {
  const loadedState = await window.vroomon.loadRunState();

  if (!loadedState) {
    rendererState = {
      ...rendererState,
      statusMessage: "No saved run state was found yet.",
    };
    renderApp();
    return;
  }

  rendererState = setRendererRunState(
    rendererState,
    loadedState,
    `Loaded run ${loadedState.runId}.`,
  );
  terrainSelectElement.value = loadedState.terrainName;
  await renderGenerationLog();
  renderApp();
}

async function renderGenerationLog(): Promise<void> {
  const entries = await window.vroomon.loadGenerationLog(rendererState.runState.runId);
  generationLogOutputElement.textContent = JSON.stringify(
    entries.length > 0
      ? entries
      : [{ message: "No saved generation log entries yet." }],
    null,
    2,
  );
}

async function runGeneration(): Promise<void> {
  const generationResult = window.vroomon.runEvolutionGeneration(rendererState.runState);
  rendererState = applyGenerationToState(rendererState, generationResult);
  await renderGenerationLog();
  renderApp();
}

function generatePopulation(): void {
  const nextRunId = `preview-${Date.now().toString(36)}`;
  const nextRunState = window.vroomon.createPreviewRunState(nextRunId);
  rendererState = setRendererRunState(
    rendererState,
    {
      ...nextRunState,
      terrainName: rendererState.runState.terrainName,
    },
    `Generated population for run ${nextRunId}.`,
  );
  renderApp();
  void renderGenerationLog();
}

for (const button of modeButtonsElements) {
  button.addEventListener("click", () => {
    rendererState = setRendererMode(
      rendererState,
      (button.dataset.modeButton as AppModeId) ?? "menu",
    );
    renderApp();
  });
}

randomizeButtonElement.addEventListener("click", () => {
  const nextDna = window.vroomon.createRandomDna(12);
  dnaInputElement.value = nextDna;
  rendererState = setDraftDna(rendererState, nextDna);
  renderApp();
});

dnaInputElement.addEventListener("input", () => {
  rendererState = setDraftDna(rendererState, dnaInputElement.value);
  renderApp();
});

terrainSelectElement.addEventListener("change", () => {
  rendererState = setRendererTerrain(rendererState, terrainSelectElement.value);
  renderApp();
});

generatePopulationButtonElement.addEventListener("click", () => {
  generatePopulation();
});

runGenerationButtonElement.addEventListener("click", () => {
  void runGeneration();
});

saveRunButtonElement.addEventListener("click", () => {
  void saveCurrentRunState();
});

loadRunButtonElement.addEventListener("click", () => {
  void loadSavedRunState();
});

void renderGenerationLog();
