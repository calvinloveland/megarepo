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
  BodySnapshot,
  RacePreviewFrame,
  RaceVehicleSnapshot,
  VehiclePreviewFrame,
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
import {
  resolveEvolutionPreviewRunState,
  resolveRunnableRunState,
} from "./view-model.js";

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
      getParityContract: () => VroomonParityContract;
      getTerrainPreset: (name: string) => TerrainPresetDefinition | undefined;
      createEmptyRunState: (mode: "evolution" | "test-drive") => RunStateSnapshot;
      createPreviewRunState: (
        runId: string,
        baseState?: RunStateSnapshot,
      ) => RunStateSnapshot;
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
      previewPhysicsFrames: (
        dna: string,
        terrainName: string,
        stepCount?: number,
        frameCount?: number,
      ) => VehiclePreviewFrame[];
      previewPopulationRace: (
        state: RunStateSnapshot,
        stepCount?: number,
      ) => RaceVehicleSnapshot[];
      previewPopulationRaceFrames: (
        state: RunStateSnapshot,
        stepCount?: number,
        frameCount?: number,
      ) => RacePreviewFrame[];
      saveRunState: (state: RunStateSnapshot) => Promise<string>;
      loadRunState: () => Promise<RunStateSnapshot | null>;
      appendGenerationLog: (entry: GenerationLogEntry) => Promise<string>;
      loadGenerationLog: (runId: string) => Promise<GenerationLogEntry[]>;
    };
  }
}

interface EvolutionViewData {
  baseState: RunStateSnapshot;
  generationResult: GenerationResult;
  rankedVehicles: GenerationResult["evaluatedPopulation"];
  viewportRace: RaceVehicleSnapshot[];
  viewportFrames: ViewportFrame[];
  selectedVehicleId: string | null;
  leaderId: string | null;
}

interface TestDriveViewData {
  dna: string;
  decoded: DecodedDnaV2;
  snapshot: VehicleSnapshot;
  frames: ViewportFrame[];
}

interface ViewportEntity {
  id: string;
  label: string;
  snapshot: VehicleSnapshot;
  initialCenterX?: number;
  variant: "solo" | "leader" | "selected" | "racer";
}

interface ViewportFrame {
  elapsedMs: number;
  entities: ViewportEntity[];
}

interface ViewportScene {
  title: string;
  subtitle: string;
  caption: string;
  terrain: TerrainPresetDefinition;
  frames: ViewportFrame[];
  focusVehicleId?: string | null;
}

function requireElement<T>(value: T | null, selector: string): T {
  if (!value) {
    throw new Error(`Renderer UI did not initialize correctly: missing ${selector}.`);
  }

  return value;
}

const modeButtons = document.querySelectorAll<HTMLButtonElement>("[data-mode-button]");
const dnaInput = requireElement(
  document.querySelector<HTMLInputElement>("[data-dna-input]"),
  "[data-dna-input]",
);
const randomizeButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-randomize-dna]"),
  "[data-randomize-dna]",
);
const generatePopulationButton = requireElement(
  document.querySelector<HTMLButtonElement>(
  "[data-generate-population]",
  ),
  "[data-generate-population]",
);
const runGenerationButton = requireElement(
  document.querySelector<HTMLButtonElement>(
  "[data-run-generation]",
  ),
  "[data-run-generation]",
);
const saveRunButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-save-run]"),
  "[data-save-run]",
);
const loadRunButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-load-run]"),
  "[data-load-run]",
);
const terrainSelect = requireElement(
  document.querySelector<HTMLSelectElement>("[data-terrain-select]"),
  "[data-terrain-select]",
);
const output = requireElement(
  document.querySelector<HTMLElement>("[data-dna-output]"),
  "[data-dna-output]",
);
const modesList = requireElement(
  document.querySelector<HTMLElement>("[data-mode-list]"),
  "[data-mode-list]",
);
const terrainList = requireElement(
  document.querySelector<HTMLElement>("[data-terrain-list]"),
  "[data-terrain-list]",
);
const contractSummary = requireElement(
  document.querySelector<HTMLElement>("[data-contract-summary]"),
  "[data-contract-summary]",
);
const runStateOutput = requireElement(
  document.querySelector<HTMLElement>("[data-run-state-output]"),
  "[data-run-state-output]",
);
const evolutionPreviewOutput = requireElement(
  document.querySelector<HTMLElement>(
  "[data-evolution-preview-output]",
  ),
  "[data-evolution-preview-output]",
);
const physicsPreviewOutput = requireElement(
  document.querySelector<HTMLElement>(
  "[data-physics-preview-output]",
  ),
  "[data-physics-preview-output]",
);
const selectedVehicleOutput = requireElement(
  document.querySelector<HTMLElement>(
  "[data-selected-vehicle-output]",
  ),
  "[data-selected-vehicle-output]",
);
const selectedVehicleButtons = requireElement(
  document.querySelector<HTMLElement>(
  "[data-selected-vehicle-buttons]",
  ),
  "[data-selected-vehicle-buttons]",
);
const generationLogOutput = requireElement(
  document.querySelector<HTMLElement>(
  "[data-generation-log-output]",
  ),
  "[data-generation-log-output]",
);
const statusMessage = requireElement(
  document.querySelector<HTMLElement>("[data-status-message]"),
  "[data-status-message]",
);
const panels = document.querySelectorAll<HTMLElement>("[data-panel]");
const viewportTitle = requireElement(
  document.querySelector<HTMLElement>("[data-viewport-title]"),
  "[data-viewport-title]",
);
const viewportSubtitle = requireElement(
  document.querySelector<HTMLElement>("[data-viewport-subtitle]"),
  "[data-viewport-subtitle]",
);
const viewportCaption = requireElement(
  document.querySelector<HTMLElement>("[data-viewport-caption]"),
  "[data-viewport-caption]",
);
const viewportSvg = requireElement(
  document.querySelector<SVGElement>("[data-race-viewport]"),
  "[data-race-viewport]",
);
const runSummary = requireElement(
  document.querySelector<HTMLElement>("[data-run-summary]"),
  "[data-run-summary]",
);
const selectedVehicleSummary = requireElement(
  document.querySelector<HTMLElement>(
  "[data-selected-vehicle-summary]",
  ),
  "[data-selected-vehicle-summary]",
);
const trackSummary = requireElement(
  document.querySelector<HTMLElement>("[data-track-summary]"),
  "[data-track-summary]",
);
const eventSummary = requireElement(
  document.querySelector<HTMLElement>("[data-event-summary]"),
  "[data-event-summary]",
);
const leaderboardSummary = requireElement(
  document.querySelector<HTMLElement>(
  "[data-leaderboard-summary]",
  ),
  "[data-leaderboard-summary]",
);
const menuSummary = requireElement(
  document.querySelector<HTMLElement>("[data-menu-summary]"),
  "[data-menu-summary]",
);
const evolutionSummary = requireElement(
  document.querySelector<HTMLElement>(
  "[data-evolution-summary]",
  ),
  "[data-evolution-summary]",
);
const testDriveSummary = requireElement(
  document.querySelector<HTMLElement>(
  "[data-test-drive-summary]",
  ),
  "[data-test-drive-summary]",
);

if (modeButtons.length === 0 || panels.length === 0) {
  throw new Error("Renderer UI did not initialize correctly.");
}

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 480;
const modeButtonsElements = Array.from(modeButtons);
const panelsElements = Array.from(panels);
const parityContract = window.vroomon.getParityContract();
let rendererState = createRendererState(
  window.vroomon.createEmptyRunState("evolution"),
  dnaInput.value,
);
let viewportAnimationToken = 0;

populateTerrainSelect();
renderApp();
void renderGenerationLog();

function renderApp(): void {
  renderContract();
  renderPanels();
  renderRunState();

  const terrain = getActiveTerrain();
  const evolutionViewData =
    rendererState.mode === "evolution" ? buildEvolutionViewData() : null;
  const testDriveViewData =
    rendererState.mode === "test-drive" || rendererState.mode === "menu"
      ? buildTestDriveViewData(rendererState.draftDna, terrain.name)
      : null;

  renderDiagnostics(terrain, evolutionViewData, testDriveViewData);
  renderStage(terrain, evolutionViewData, testDriveViewData);
  renderSidebarCopy(evolutionViewData, testDriveViewData);
  statusMessage.textContent = rendererState.statusMessage;
}

function renderStage(
  terrain: TerrainPresetDefinition,
  evolutionViewData: EvolutionViewData | null,
  testDriveViewData: TestDriveViewData | null,
): void {
  if (rendererState.mode === "evolution" && evolutionViewData) {
    renderEvolutionStage(terrain, evolutionViewData);
    return;
  }

  if (testDriveViewData) {
    renderTestDriveStage(terrain, testDriveViewData);
    return;
  }

  stopViewportAnimation();
}

function renderEvolutionStage(
  terrain: TerrainPresetDefinition,
  evolutionViewData: EvolutionViewData,
): void {
  const leader = evolutionViewData.rankedVehicles[0] ?? null;
  const selectedSummary = getSelectedVehicleSummary(rendererState);
  const selectedVehicle =
    evolutionViewData.rankedVehicles.find(
      (vehicle) => vehicle.id === evolutionViewData.selectedVehicleId,
    ) ?? leader;
  const raceCount = evolutionViewData.viewportRace.length;
  const scene: ViewportScene = {
    title: "Evolution viewport",
    subtitle:
      raceCount > 0
        ? `Tracking ${raceCount} highlighted racers on ${terrain.name}.`
        : "Generate a population to start a visible race.",
    caption: leader
      ? `${leader.id} leads by ${formatNumber(leader.score)} points after generation ${rendererState.runState.generation}.`
      : "No racers are active yet.",
    terrain,
    frames: evolutionViewData.viewportFrames,
    focusVehicleId: evolutionViewData.selectedVehicleId ?? evolutionViewData.leaderId,
  };

  viewportTitle.textContent = scene.title;
  viewportSubtitle.textContent = scene.subtitle;
  viewportCaption.textContent = scene.caption;
  playViewportScene(scene);

  runSummary.innerHTML = renderMetricList([
    { label: "Mode", value: "Evolution" },
    { label: "Generation", value: String(rendererState.runState.generation) },
    { label: "Population", value: String(rendererState.runState.population.length) },
    { label: "Leader", value: leader ? leader.id : "Waiting" },
    {
      label: "Best score",
      value: leader ? formatNumber(leader.score) : "--",
    },
  ]);

  selectedVehicleSummary.innerHTML = selectedSummary
    ? renderMetricList([
        { label: "Focused car", value: selectedSummary.id },
        { label: "Score", value: formatNumber(selectedSummary.score) },
        {
          label: "Mutation",
          value: selectedSummary.mutated ? "Mutated offspring" : "Direct survivor",
        },
        {
          label: "Parents",
          value:
            selectedSummary.parents.length > 0
              ? selectedSummary.parents.join(", ")
              : "Seed generation",
        },
        {
          label: "Children tracked",
          value: String(selectedSummary.children.length),
        },
      ])
    : renderMetricList([
        {
          label: "Focus",
          value: selectedVehicle ? selectedVehicle.id : "No racer selected",
        },
        {
          label: "Hint",
          value: "Use the race focus strip below the viewport.",
          muted: true,
        },
      ]);

  trackSummary.innerHTML = renderMetricList([
    { label: "Terrain", value: terrain.name },
    { label: "Ground length", value: `${terrain.groundLength}px` },
    { label: "Obstacles", value: String(terrain.obstacleCount) },
    {
      label: "Camera target",
      value: selectedVehicle ? selectedVehicle.id : leader ? leader.id : "Viewport center",
    },
    {
      label: "Travel shown",
      value:
        evolutionViewData.viewportRace.length > 0
          ? `${formatNumber(
              Math.max(
                ...evolutionViewData.viewportRace.map(
                  (vehicle) => vehicle.centerX - vehicle.initialCenterX,
                ),
              ),
            )} px`
          : "--",
    },
  ]);

  eventSummary.innerHTML = renderMetricList([
    { label: "Status", value: rendererState.statusMessage },
    { label: "Run ID", value: rendererState.runState.runId },
    {
      label: "Last save",
      value: rendererState.lastSavedPath ?? "Unsaved",
      muted: rendererState.lastSavedPath === null,
    },
  ]);

  renderVehicleFocusStrip(evolutionViewData.rankedVehicles.slice(0, 8));
  leaderboardSummary.textContent = leader
    ? `Click a racer to pin the camera. ${leader.id} is currently on top.`
    : "Run a generation to inspect the active race field.";
}

function renderTestDriveStage(
  terrain: TerrainPresetDefinition,
  testDriveViewData: TestDriveViewData,
): void {
  const wheelCount = testDriveViewData.decoded.modules.filter(
    (module) => module === "W",
  ).length;
  const rectangleCount = testDriveViewData.decoded.modules.length - wheelCount;
  const scene: ViewportScene = {
    title: rendererState.mode === "menu" ? "Preview stage" : "Test-drive viewport",
    subtitle:
      rendererState.mode === "menu"
        ? "A sample vehicle preview keeps the rewrite grounded in visible motion."
        : `Previewing the current DNA build on ${terrain.name}.`,
    caption:
      rendererState.mode === "menu"
        ? `Sample car with ${wheelCount} wheels and ${rectangleCount} chassis pieces.`
        : `Following the draft car across ${terrain.name}.`,
    terrain,
    frames: testDriveViewData.frames,
    focusVehicleId: "draft-car",
  };

  viewportTitle.textContent = scene.title;
  viewportSubtitle.textContent = scene.subtitle;
  viewportCaption.textContent = scene.caption;
  playViewportScene(scene);

  runSummary.innerHTML = renderMetricList([
    { label: "Mode", value: rendererState.mode === "menu" ? "Menu preview" : "Test Drive" },
    { label: "Terrain", value: terrain.name },
    { label: "DNA", value: testDriveViewData.decoded.dna },
    { label: "Modules", value: String(testDriveViewData.decoded.modules.length) },
    {
      label: "Balance",
      value: `${formatNumber(testDriveViewData.decoded.globals.comShift)} shift`,
    },
  ]);

  selectedVehicleSummary.innerHTML = renderMetricList([
    { label: "Wheel count", value: String(wheelCount) },
    { label: "Chassis count", value: String(rectangleCount) },
    {
      label: "Center X",
      value: formatNumber(testDriveViewData.snapshot.centerX),
    },
    {
      label: "Center Y",
      value: formatNumber(testDriveViewData.snapshot.centerY),
    },
    {
      label: "Powertrain modules",
      value: String(testDriveViewData.decoded.powertrainModules.length),
    },
  ]);

  trackSummary.innerHTML = renderMetricList([
    { label: "Terrain", value: terrain.name },
    { label: "Ground length", value: `${terrain.groundLength}px` },
    { label: "Obstacles", value: String(terrain.obstacleCount) },
    {
      label: "Camera target",
      value: rendererState.mode === "menu" ? "Sample preview" : "Draft car",
    },
  ]);

  eventSummary.innerHTML = renderMetricList([
    { label: "Status", value: rendererState.statusMessage },
    { label: "Run ID", value: rendererState.runState.runId },
    {
      label: "Tip",
      value:
        rendererState.mode === "menu"
          ? "Switch modes to move from overview into simulation control."
          : "Randomize DNA or change terrain to watch the motion update.",
      muted: true,
    },
  ]);

  selectedVehicleButtons.innerHTML = "";
  leaderboardSummary.textContent =
    rendererState.mode === "menu"
      ? "The viewport is already alive here; choose a mode to unlock controls."
      : "Test drive keeps one vehicle centered so the chassis motion stays readable.";
}

function renderSidebarCopy(
  evolutionViewData: EvolutionViewData | null,
  testDriveViewData: TestDriveViewData | null,
): void {
  menuSummary.textContent =
    "Start in evolution to watch a pack race, or drop into test drive to tune one machine at a time.";
  evolutionSummary.textContent = evolutionViewData
    ? `Generation ${rendererState.runState.generation} is visible in the viewport. Focus ${
        evolutionViewData.selectedVehicleId ?? evolutionViewData.leaderId ?? "the leader"
      } from the race strip below.`
    : "Generate a population, then run a generation to fill the viewport with racers.";
  testDriveSummary.textContent = testDriveViewData
    ? `Current DNA ${testDriveViewData.decoded.dna} is rendered live in the shared viewport.`
    : "The test-drive editor previews one car at a time.";
}

function renderDiagnostics(
  terrain: TerrainPresetDefinition,
  evolutionViewData: EvolutionViewData | null,
  testDriveViewData: TestDriveViewData | null,
): void {
  if (evolutionViewData) {
    evolutionPreviewOutput.textContent = JSON.stringify(
      {
        generatedPopulation: evolutionViewData.baseState.population.slice(0, 5),
        evaluatedPopulation: evolutionViewData.generationResult.evaluatedPopulation.slice(0, 5),
        breeding: evolutionViewData.generationResult.breeding,
        scoreStats: evolutionViewData.generationResult.evaluation.stats,
        evaluationSummary: evolutionViewData.generationResult.evaluation.stats,
        nextGeneration: evolutionViewData.generationResult.nextPopulation.slice(0, 5),
        racePreview: evolutionViewData.viewportRace.slice(0, 5).map((result) => ({
          id: result.id,
          travel: Number((result.centerX - result.initialCenterX).toFixed(2)),
          finalY: Number(result.centerY.toFixed(2)),
        })),
      },
      null,
      2,
    );
  } else {
    evolutionPreviewOutput.textContent = JSON.stringify(
      { message: "Switch to evolution mode to inspect generation diagnostics." },
      null,
      2,
    );
  }

  if (testDriveViewData && rendererState.mode === "test-drive") {
    output.textContent = JSON.stringify(
      buildDecodedDnaPayload(testDriveViewData.decoded),
      null,
      2,
    );
    physicsPreviewOutput.textContent = JSON.stringify(
      {
        terrainName: terrain.name,
        chassisCount: testDriveViewData.snapshot.chassis.length,
        wheelCount: testDriveViewData.snapshot.wheels.length,
        centerX: Number(testDriveViewData.snapshot.centerX.toFixed(2)),
        centerY: Number(testDriveViewData.snapshot.centerY.toFixed(2)),
        firstChassis: testDriveViewData.snapshot.chassis[0] ?? null,
        firstWheel: testDriveViewData.snapshot.wheels[0] ?? null,
      },
      null,
      2,
    );
  } else {
    output.textContent = JSON.stringify(
      { message: "Switch to test-drive mode to inspect decoded DNA." },
      null,
      2,
    );
    physicsPreviewOutput.textContent = JSON.stringify(
      { message: "Switch to test-drive mode to preview vehicle physics." },
      null,
      2,
    );
  }

  selectedVehicleOutput.textContent = JSON.stringify(
    getSelectedVehicleSummary(rendererState) ?? {
      message: "Run a generation to inspect a selected car.",
    },
    null,
    2,
  );
}

function renderContract(): void {
  contractSummary.textContent = parityContract.summary;
  modesList.innerHTML = parityContract.modes
    .map(
      (mode) =>
        `<li><strong>${escapeHtml(mode.label)}</strong><br /><span>${escapeHtml(mode.description)}</span></li>`,
    )
    .join("");
  terrainList.innerHTML = parityContract.terrains
    .map((terrain) => {
      const detailParts = [
        `${terrain.groundLength}px ground`,
        `friction ${terrain.friction.toFixed(1)}`,
        terrain.obstacleCount > 0 ? `${terrain.obstacleCount} obstacles` : "no obstacles",
      ];
      return `<li><strong>${escapeHtml(terrain.name)}</strong><br /><span>${escapeHtml(
        detailParts.join(" · "),
      )}</span></li>`;
    })
    .join("");
}

function renderRunState(): void {
  runStateOutput.textContent = JSON.stringify(rendererState.runState, null, 2);
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

function renderVehicleFocusStrip(
  vehicles: GenerationResult["evaluatedPopulation"],
): void {
  selectedVehicleButtons.innerHTML = vehicles
    .map(
      (vehicle) =>
        `<button class="${rendererState.selectedVehicleId === vehicle.id ? "active" : "ghost"}" type="button" data-select-vehicle="${escapeHtml(
          vehicle.id,
        )}" title="Score ${formatNumber(vehicle.score)}">${escapeHtml(vehicle.id)}</button>`,
    )
    .join("");

  for (const button of Array.from(
    selectedVehicleButtons.querySelectorAll<HTMLButtonElement>("[data-select-vehicle]"),
  )) {
    button.addEventListener("click", () => {
      rendererState = selectVehicle(rendererState, button.dataset.selectVehicle ?? "");
      renderApp();
    });
  }
}

function populateTerrainSelect(): void {
  terrainSelect.innerHTML = parityContract.terrains
    .map((terrain) => `<option value="${escapeHtml(terrain.name)}">${escapeHtml(terrain.name)}</option>`)
    .join("");
  terrainSelect.value = rendererState.runState.terrainName;
}

async function saveCurrentRunState(): Promise<void> {
  const savePath = await window.vroomon.saveRunState(rendererState.runState);
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
  terrainSelect.value = loadedState.terrainName;
  await renderGenerationLog();
  renderApp();
}

async function renderGenerationLog(): Promise<void> {
  const entries = await window.vroomon.loadGenerationLog(rendererState.runState.runId);
  generationLogOutput.textContent = JSON.stringify(
    entries.length > 0 ? entries : [{ message: "No saved generation log entries yet." }],
    null,
    2,
  );
}

async function runGeneration(): Promise<void> {
  const { runState, generatedPopulation } = resolveRunnableRunState(
    rendererState,
    window.vroomon.createPreviewRunState,
  );
  const baseRendererState =
    runState === rendererState.runState
      ? rendererState
      : setRendererRunState(
          rendererState,
          runState,
          generatedPopulation
            ? `Generated initial population for run ${runState.runId}.`
            : `Prepared run ${runState.runId} for evolution mode.`,
        );
  const generationResult = window.vroomon.runEvolutionGeneration(runState);

  await window.vroomon.appendGenerationLog(
    window.vroomon.createGenerationLogEntry(runState, generationResult),
  );

  rendererState = applyGenerationToState(
    baseRendererState,
    generationResult,
    window.vroomon.advanceRunState(runState, generationResult),
  );
  if (generatedPopulation) {
    rendererState = {
      ...rendererState,
      statusMessage: `Generated initial population and completed generation ${runState.generation + 1}.`,
    };
  }
  await renderGenerationLog();
  renderApp();
}

function generatePopulation(): void {
  const nextRunId = `preview-${Date.now().toString(36)}`;
  const nextRunState = window.vroomon.createPreviewRunState(nextRunId, {
    ...rendererState.runState,
    mode: "evolution",
  });
  rendererState = setRendererRunState(
    rendererState,
    nextRunState,
    `Generated population for run ${nextRunId}.`,
  );
  renderApp();
  void renderGenerationLog();
}

function buildEvolutionViewData(): EvolutionViewData {
  const baseState =
    rendererState.lastEvaluatedRunState ??
    resolveEvolutionPreviewRunState(rendererState, window.vroomon.createPreviewRunState);
  const generationResult =
    rendererState.latestGeneration ?? window.vroomon.runEvolutionGeneration(baseState);
  const rankedVehicles = generationResult.evaluatedPopulation
    .slice()
    .sort((left, right) => right.score - left.score);
  const selectedVehicleId =
    rendererState.selectedVehicleId ?? rankedVehicles[0]?.id ?? null;
  const viewportVehicles = uniqueVehiclesById(
    [
      ...rankedVehicles.filter((vehicle) => vehicle.id === selectedVehicleId),
      ...rankedVehicles,
    ].slice(0, 6),
  );
  const viewportState: RunStateSnapshot = {
    ...baseState,
    population: viewportVehicles.map((vehicle) => ({ ...vehicle })),
  };
  const previewRace = window.vroomon.previewPopulationRace(viewportState, 120);
  const previewFrames = window.vroomon
    .previewPopulationRaceFrames(viewportState, 120, 24)
    .map((frame) => ({
      elapsedMs: frame.elapsedMs,
      entities: frame.vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.id,
        snapshot: vehicle,
        initialCenterX: vehicle.initialCenterX,
        variant:
          vehicle.id === selectedVehicleId
            ? "selected"
            : vehicle.id === rankedVehicles[0]?.id
              ? "leader"
              : "racer",
      }) satisfies ViewportEntity),
    }));

  return {
    baseState,
    generationResult,
    rankedVehicles,
    viewportRace: previewRace,
    viewportFrames: previewFrames,
    selectedVehicleId,
    leaderId: rankedVehicles[0]?.id ?? null,
  };
}

function buildTestDriveViewData(
  dna: string,
  terrainName: string,
): TestDriveViewData {
  const cleanedDna = window.vroomon.cleanDna(dna);
  const decoded = window.vroomon.decodeDnaV2(cleanedDna);
  const snapshot = window.vroomon.previewPhysicsSnapshot(cleanedDna, terrainName, 90);
  const frames = window.vroomon
    .previewPhysicsFrames(cleanedDna, terrainName, 90, 24)
    .map((frame) => ({
      elapsedMs: frame.elapsedMs,
      entities: [
        {
          id: "draft-car",
          label: rendererState.mode === "menu" ? "Preview" : "Draft car",
          snapshot: frame.snapshot,
          variant: "solo",
        } satisfies ViewportEntity,
      ],
    }));

  return {
    dna: cleanedDna,
    decoded,
    snapshot,
    frames,
  };
}

function playViewportScene(scene: ViewportScene): void {
  stopViewportAnimation();

  if (scene.frames.length === 0) {
    viewportSvg.innerHTML = "";
    return;
  }

  const token = viewportAnimationToken;
  const totalDuration = scene.frames[scene.frames.length - 1]!.elapsedMs;
  let lastFrameIndex = -1;

  const renderAtIndex = (index: number): void => {
    const frame = scene.frames[index];

    if (!frame) {
      return;
    }

    viewportSvg.innerHTML = renderViewportMarkup(
      scene.terrain,
      frame,
      scene.focusVehicleId ?? null,
    );
  };

  if (scene.frames.length === 1 || totalDuration <= 0) {
    renderAtIndex(0);
    return;
  }

  const start = performance.now();

  const step = (now: number): void => {
    if (token !== viewportAnimationToken) {
      return;
    }

    const elapsed = (now - start) % totalDuration;
    let frameIndex = 0;

    for (let index = 0; index < scene.frames.length; index += 1) {
      if (scene.frames[index]!.elapsedMs <= elapsed) {
        frameIndex = index;
      } else {
        break;
      }
    }

    if (frameIndex !== lastFrameIndex) {
      renderAtIndex(frameIndex);
      lastFrameIndex = frameIndex;
    }

    requestAnimationFrame(step);
  };

  renderAtIndex(0);
  requestAnimationFrame(step);
}

function stopViewportAnimation(): void {
  viewportAnimationToken += 1;
}

function renderViewportMarkup(
  terrain: TerrainPresetDefinition,
  frame: ViewportFrame,
  focusVehicleId: string | null,
): string {
  const view = calculateViewportWindow(terrain, frame.entities, focusVehicleId);
  const vehicleMarkup = frame.entities
    .map((entity) => renderViewportEntity(entity, terrain, view))
    .join("");

  return `
    <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#15314f"></rect>
    <rect x="0" y="${toSvgY(view, terrain.groundHeight)}" width="${SVG_WIDTH}" height="${Math.max(30, SVG_HEIGHT - toSvgY(view, terrain.groundHeight))}" fill="${terrain.colorGround ?? "#6c5233"}"></rect>
    ${renderTerrainObstacles(terrain, view)}
    <line x1="${toSvgX(view, 220)}" y1="0" x2="${toSvgX(view, 220)}" y2="${SVG_HEIGHT}" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-dasharray="10 10"></line>
    ${vehicleMarkup}
  `;
}

function renderTerrainObstacles(
  terrain: TerrainPresetDefinition,
  view: ViewportWindow,
): string {
  if (
    terrain.obstacleCount === 0 ||
    !terrain.obstacleWidth ||
    terrain.obstacleHeightBase === undefined ||
    terrain.obstacleHeightStep === undefined
  ) {
    return "";
  }

  const fill = terrain.colorObstacle ?? "#9aa8bf";
  const parts: string[] = [];

  for (let index = 0; index < terrain.obstacleCount; index += 1) {
    const height = terrain.obstacleHeightBase + terrain.obstacleHeightStep * index;
    const x = 600 + index * 300;
    const y = terrain.groundHeight - height;
    parts.push(
      `<rect x="${toSvgX(view, x)}" y="${toSvgY(view, y)}" width="${
        terrain.obstacleWidth * view.scaleX
      }" height="${height * view.scaleY}" rx="12" fill="${fill}" opacity="0.88"></rect>`,
    );
  }

  return parts.join("");
}

function renderViewportEntity(
  entity: ViewportEntity,
  terrain: TerrainPresetDefinition,
  view: ViewportWindow,
): string {
  const accent =
    entity.variant === "leader"
      ? { fill: "#ffd166", stroke: "#fff4d1" }
      : entity.variant === "selected"
        ? { fill: "#7dd3fc", stroke: "#f8fbff" }
        : entity.variant === "solo"
          ? { fill: "#8ab4ff", stroke: "#f8fbff" }
          : { fill: "#63e6be", stroke: "rgba(255,255,255,0.88)" };
  const originX = toSvgX(view, entity.snapshot.centerX);
  const originY = toSvgY(view, entity.snapshot.centerY);
  const trail =
    entity.initialCenterX !== undefined
      ? `<line x1="${toSvgX(view, entity.initialCenterX)}" y1="${originY}" x2="${originX}" y2="${originY}" stroke="rgba(255,255,255,0.18)" stroke-width="3" stroke-dasharray="8 8"></line>`
      : "";
  const bodyMarkup = [
    ...entity.snapshot.chassis.map((body) => renderViewportBody(body, view, accent.fill, accent.stroke)),
    ...entity.snapshot.wheels.map((body) => renderViewportBody(body, view, accent.stroke, accent.fill)),
  ].join("");
  const travel =
    entity.initialCenterX !== undefined
      ? `${formatNumber(entity.snapshot.centerX - entity.initialCenterX)} px`
      : `${formatNumber(entity.snapshot.centerX)} px`;

  return `
    <g data-viewport-vehicle="${escapeHtml(entity.id)}">
      ${trail}
      ${bodyMarkup}
      <text class="viewport-label" x="${originX}" y="${Math.max(28, originY - 44)}" text-anchor="middle">${escapeHtml(
        entity.label,
      )}</text>
      <text class="viewport-subtitle" x="${originX}" y="${Math.max(48, originY - 24)}" text-anchor="middle">${escapeHtml(
        travel,
      )}</text>
    </g>
  `;
}

function renderViewportBody(
  body: BodySnapshot,
  view: ViewportWindow,
  fill: string,
  stroke: string,
): string {
  const x = toSvgX(view, body.x);
  const y = toSvgY(view, body.y);

  if (body.shape === "circle") {
    const radius = (body.radius ?? 8) * ((view.scaleX + view.scaleY) / 2);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="3"></circle>`;
  }

  const width = (body.width ?? 18) * view.scaleX;
  const height = (body.height ?? 12) * view.scaleY;
  const angle = (body.angle * 180) / Math.PI;
  return `<rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="3" transform="rotate(${angle} ${x} ${y})"></rect>`;
}

interface ViewportWindow {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  scaleX: number;
  scaleY: number;
}

function calculateViewportWindow(
  terrain: TerrainPresetDefinition,
  entities: ViewportEntity[],
  focusVehicleId: string | null,
): ViewportWindow {
  const focusEntity =
    entities.find((entity) => entity.id === focusVehicleId) ?? entities[0] ?? null;
  const fallbackFocusX = focusEntity?.snapshot.centerX ?? 320;
  const halfSpan = 420;
  let minX = Math.max(0, fallbackFocusX - halfSpan);
  let maxX = Math.min(terrain.groundLength, minX + halfSpan * 2);

  if (maxX - minX < halfSpan * 2) {
    minX = Math.max(0, maxX - halfSpan * 2);
  }

  const minY = 80;
  const maxY = terrain.groundHeight + 180;

  return {
    minX,
    maxX,
    minY,
    maxY,
    scaleX: SVG_WIDTH / Math.max(maxX - minX, 1),
    scaleY: SVG_HEIGHT / Math.max(maxY - minY, 1),
  };
}

function toSvgX(view: ViewportWindow, x: number): number {
  return Number(((x - view.minX) * view.scaleX).toFixed(2));
}

function toSvgY(view: ViewportWindow, y: number): number {
  return Number(((y - view.minY) * view.scaleY).toFixed(2));
}

function buildDecodedDnaPayload(decoded: DecodedDnaV2): Record<string, unknown> {
  const wheelCount = decoded.modules.filter((module) => module === "W").length;
  const rectangleCount = decoded.modules.length - wheelCount;

  return {
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
  };
}

function getActiveTerrain(): TerrainPresetDefinition {
  return window.vroomon.getTerrainPreset(rendererState.runState.terrainName) ??
    parityContract.terrains[0]!;
}

function uniqueVehiclesById<T extends { id: string }>(vehicles: T[]): T[] {
  const seen = new Set<string>();
  return vehicles.filter((vehicle) => {
    if (seen.has(vehicle.id)) {
      return false;
    }
    seen.add(vehicle.id);
    return true;
  });
}

function renderMetricList(
  rows: Array<{ label: string; value: string; muted?: boolean }>,
): string {
  return rows
    .map(
      (row) => `
        <div class="metric-row">
          <span class="metric-label">${escapeHtml(row.label)}</span>
          <span class="metric-value${row.muted ? " metric-value--muted" : ""}">${escapeHtml(
            row.value,
          )}</span>
        </div>
      `,
    )
    .join("");
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

randomizeButton.addEventListener("click", () => {
  const nextDna = window.vroomon.createRandomDna(12);
  dnaInput.value = nextDna;
  rendererState = setDraftDna(rendererState, nextDna);
  renderApp();
});

dnaInput.addEventListener("input", () => {
  rendererState = setDraftDna(rendererState, dnaInput.value);
  renderApp();
});

terrainSelect.addEventListener("change", () => {
  rendererState = setRendererTerrain(rendererState, terrainSelect.value);
  renderApp();
});

generatePopulationButton.addEventListener("click", () => {
  generatePopulation();
});

runGenerationButton.addEventListener("click", () => {
  void runGeneration();
});

saveRunButton.addEventListener("click", () => {
  void saveCurrentRunState();
});

loadRunButton.addEventListener("click", () => {
  void loadSavedRunState();
});
