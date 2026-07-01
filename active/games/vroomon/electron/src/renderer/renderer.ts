import type { DecodedDnaV2 } from "../shared/dna-v2.js";
import type {
  AppModeId,
  HallOfFame,
  HallOfFameEntry,
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
import { createOverworldInputs } from "./world/overworld-controller.js";
import { renderOverworld } from "./world/overworld-renderer.js";
import { getMap } from "./world/maps.js";
import { createInitialWorldState } from "./world/world-state.js";
import type { Direction, PersistedWorldState, WorldState } from "./world/types.js";
import { advanceDialogue as advanceWorldDialogue, endDialogue as endWorldDialogue } from "./world/world-state.js";
import type { GenerationLogEntry } from "../core/persistence.js";
import type {
  BodySnapshot,
  RacePreviewFrame,
  RaceVehicleSnapshot,
  VehiclePreviewFrame,
  VehicleSnapshot,
} from "../simulation/matter-simulation.js";
import {
  DEFAULT_BATCH_GENERATION_COUNT,
  DEFAULT_EVOLUTION_VIEWPORT_FRAME_COUNT,
  DEFAULT_EVOLUTION_VIEWPORT_STEP_COUNT,
  DEFAULT_TEST_DRIVE_FRAME_COUNT,
  DEFAULT_TEST_DRIVE_STEP_COUNT,
  addHallOfFameEntry,
  applyBatchGeneration,
  applyGenerationToState,
  BATCH_COUNT_OPTIONS,
  createRendererState,
  detectConvergence,
  getSelectedVehicleSummary,
  removeHallOfFameEntry,
  renameHallOfFameEntry,
  selectHallEntry,
  selectVehicle,
  setBatchCount,
  setBatchRunning,
  setConvergeMode,
  setDraftDna,
  setHallOfFame,
  setRendererMode,
  setRendererRunState,
  setRendererTerrain,
  setRunConfig,
  setSavedPath,
  setWorldState,
  setTestDriveReplay,
  updateBatchProgress,
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
      loadHallOfFame: () => Promise<HallOfFame>;
      saveHallOfFame: (hall: HallOfFame) => Promise<string>;
      loadWorldState: () => Promise<PersistedWorldState>;
      saveWorldState: (world: PersistedWorldState) => Promise<string>;
      runBatchGenerations: (
        state: RunStateSnapshot,
        count: number,
      ) => Promise<{
        generationResults: GenerationResult[];
        finalState: RunStateSnapshot;
        logEntries: GenerationLogEntry[];
      }>;
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
  scenarioLabel: string | null;
  stepCount: number;
  playbackDurationMs: number | null;
}

interface ViewportEntity {
  id: string;
  label: string;
  snapshot: VehicleSnapshot;
  initialCenterX?: number;
  variant: "solo" | "leader" | "selected" | "racer";
  score?: number;
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
const watchRegressionButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-watch-flat-track-regression]"),
  "[data-watch-flat-track-regression]",
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

const runBatchButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-run-batch-generations]"),
  "[data-run-batch-generations]",
);
const batchProgress = requireElement(
  document.querySelector<HTMLElement>("[data-batch-progress]"),
  "[data-batch-progress]",
);
const batchProgressFill = requireElement(
  document.querySelector<HTMLElement>("[data-batch-progress-fill]"),
  "[data-batch-progress-fill]",
);
const batchProgressText = requireElement(
  document.querySelector<HTMLElement>("[data-batch-progress-text]"),
  "[data-batch-progress-text]",
);
// These two controls only ship in the Electron desktop shell (index.html).
// The web shell (game.html) omits them, so look them up optionally and guard
// every wiring call below. Leaving them unwired previously meant the desktop
// "Generations per batch" select and "Stop on plateau" checkbox did nothing.
const batchCountSelect = document.querySelector<HTMLSelectElement>("[data-batch-count-select]");
const convergeToggle = document.querySelector<HTMLInputElement>("[data-converge-toggle]");

const populationSizeSelect = requireElement(
  document.querySelector<HTMLSelectElement>("[data-population-size-select]"),
  "[data-population-size-select]",
);
const dnaLengthSelect = requireElement(
  document.querySelector<HTMLSelectElement>("[data-dna-length-select]"),
  "[data-dna-length-select]",
);
const mutationRateSelect = requireElement(
  document.querySelector<HTMLSelectElement>("[data-mutation-rate-select]"),
  "[data-mutation-rate-select]",
);
const retainRatioSelect = requireElement(
  document.querySelector<HTMLSelectElement>("[data-retain-ratio-select]"),
  "[data-retain-ratio-select]",
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
// Floating overlay elements inside the viewport
const viewportGenValue = document.querySelector<HTMLElement>("[data-viewport-gen-value]");
const viewportLeaderPill = document.querySelector<HTMLElement>("[data-viewport-leader-pill]");
const viewportLeaderValue = document.querySelector<HTMLElement>("[data-viewport-leader-value]");
const viewportProgressOverlay = document.querySelector<HTMLElement>("[data-viewport-progress-overlay]");
const viewportProgressFill = document.querySelector<HTMLElement>("[data-viewport-progress-fill]");
const viewportProgressText = document.querySelector<HTMLElement>("[data-viewport-progress-text]");
const hofTopScore = document.querySelector<HTMLElement>("[data-hof-top-score]");
const hofCount = document.querySelector<HTMLElement>("[data-hof-count]");
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
const scoreChartElement = requireElement(
  document.querySelector<HTMLElement>("[data-score-chart]"),
  "[data-score-chart]",
);
const overworldCanvas = requireElement(
  document.querySelector<HTMLCanvasElement>("[data-overworld-canvas]"),
  "[data-overworld-canvas]",
);
const overworldDialogue = requireElement(
  document.querySelector<HTMLElement>("[data-overworld-dialogue]"),
  "[data-overworld-dialogue]",
);
const overworldDialogueName = requireElement(
  document.querySelector<HTMLElement>("[data-overworld-dialogue-name]"),
  "[data-overworld-dialogue-name]",
);
const overworldDialogueText = requireElement(
  document.querySelector<HTMLElement>("[data-overworld-dialogue-text]"),
  "[data-overworld-dialogue-text]",
);
const overworldDialogueOptions = requireElement(
  document.querySelector<HTMLElement>("[data-overworld-dialogue-options]"),
  "[data-overworld-dialogue-options]",
);
const overworldBadgeList = requireElement(
  document.querySelector<HTMLElement>("[data-overworld-badge-list]"),
  "[data-overworld-badge-list]",
);
const overworldVroomdexCount = requireElement(
  document.querySelector<HTMLElement>("[data-overworld-vroomdex-count]"),
  "[data-overworld-vroomdex-count]",
);
const overworldSummary = requireElement(
  document.querySelector<HTMLElement>("[data-world-summary]"),
  "[data-world-summary]",
);
const overworldSaveNowButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-overworld-save-now]"),
  "[data-overworld-save-now]",
);
const overworldResetButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-overworld-reset]"),
  "[data-overworld-reset]",
);
const hallOfFameElement = requireElement(
  document.querySelector<HTMLElement>("[data-hall-of-fame]"),
  "[data-hall-of-fame]",
);
const hallOfFameTestDriveElement = requireElement(
  document.querySelector<HTMLElement>("[data-hall-of-fame-test-drive]"),
  "[data-hall-of-fame-test-drive]",
);
const saveToHallButton = requireElement(
  document.querySelector<HTMLButtonElement>("[data-save-to-hall]"),
  "[data-save-to-hall]",
);

if (modeButtons.length === 0) {
  throw new Error("Renderer UI did not initialize correctly.");
}

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 480;
const modeButtonsElements = Array.from(modeButtons);
const panelsElements = Array.from(panels);
const parityContract = window.vroomon.getParityContract();
const FLAT_TRACK_REGRESSION_REPLAY = {
  label: "flat-track regression replay",
  dna: "aaaaaaaaaaaa",
  terrainName: "Flat",
  stepCount: 11_000,
  frameCount: 96,
  playbackDurationMs: 12_000,
} as const;
let rendererState = createRendererState(
  window.vroomon.createEmptyRunState("evolution"),
  dnaInput.value,
);
let viewportAnimationToken = 0;

// ---- View-data memoization ------------------------------------------------
// renderApp() fires on every keystroke, status update, hall-of-fame load,
// and batch progress tick. Re-running the Matter simulations that back the
// evolution/test-drive viewports on each of those calls is what made the app
// feel clunky (40-350ms synchronous physics on every render). These caches
// hold the last computed view data keyed by a signature of the inputs that
// actually affect the output, so we only re-simulate when something
// meaningful changes.
let evolutionViewDataCache: { signature: string; data: EvolutionViewData } | null = null;
let testDriveViewDataCache: {
  signature: string;
  data: TestDriveViewData;
} | null = null;

function evolutionViewSignature(): string {
  const s = rendererState;
  const c = s.runState.config;
  // For the empty-population preview we deliberately exclude the random
  // population from the key so the preview cars stay stable across renders
  // instead of shimmering into a new field on every status-text update.
  const hasPopulation = s.runState.population.length > 0;
  const populationTag = hasPopulation ? `pop:${s.runState.runId}:${s.runState.generation}:${s.runState.population.length}` : "pop:empty";
  return [
    "evo",
    s.mode,
    populationTag,
    s.runState.terrainName,
    s.runState.runId,
    String(s.runState.generation),
    `retain:${c.retainRatio}`,
    `mut:${c.mutationRate}`,
    `size:${c.populationSize}`,
    `len:${c.dnaLength}`,
    s.lastEvaluatedRunState ? "lastEval:y" : "lastEval:n",
    s.latestGeneration ? "gen:y" : "gen:n",
    s.selectedVehicleId ?? "",
  ].join("|");
}

function testDriveViewSignature(dna: string, terrainName: string): string {
  const s = rendererState;
  return [
    "td",
    s.mode,
    dna,
    terrainName,
    String(s.testDriveStepCount),
    String(s.testDriveFrameCount),
    String(s.testDrivePlaybackDurationMs ?? ""),
    s.testDriveScenarioLabel ?? "",
  ].join("|");
}

function cachedEvolutionViewData(): EvolutionViewData {
  const signature = evolutionViewSignature();
  if (evolutionViewDataCache && evolutionViewDataCache.signature === signature) {
    return evolutionViewDataCache.data;
  }
  const data = buildEvolutionViewData();
  evolutionViewDataCache = { signature, data };
  return data;
}

function cachedTestDriveViewData(
  dna: string,
  terrainName: string,
): TestDriveViewData {
  const signature = testDriveViewSignature(dna, terrainName);
  if (testDriveViewDataCache && testDriveViewDataCache.signature === signature) {
    return testDriveViewDataCache.data;
  }
  const data = buildTestDriveViewData(dna, terrainName);
  testDriveViewDataCache = { signature, data };
  return data;
}

const overworldController = createOverworldInputs(rendererState.world, {
  onEncounterStart: (kind, dna, trainerName) => {
    void startOverworldEncounter(kind, dna, trainerName);
  },
  onVroomdexTick: () => {
    renderOverworldUi();
    scheduleWorldSave();
  },
  onBadgeAwarded: (badge) => {
    rendererState = setWorldState(rendererState, overworldController.state);
    rendererState = {
      ...rendererState,
      statusMessage: `Earned the ${badge}! Return to Professor Axle's lab.`,
    };
    renderApp();
    scheduleWorldSave();
  },
});
let overworldAnimationToken = 0;

populateTerrainSelect();
renderApp();
void renderGenerationLog();
void loadHallOfFame();
void loadWorldStateFromDisk();

function renderApp(): void {
  renderContract();
  renderPanels();
  renderRunState();

  const terrain = getActiveTerrain();
  const evolutionViewData =
    rendererState.mode === "evolution" ? cachedEvolutionViewData() : null;
  const testDriveViewData =
    rendererState.mode === "test-drive" || rendererState.mode === "menu"
      ? cachedTestDriveViewData(rendererState.draftDna, terrain.name)
      : null;

  renderDiagnostics(terrain, evolutionViewData, testDriveViewData);
  renderStage(terrain, evolutionViewData, testDriveViewData);
  renderSidebarCopy(evolutionViewData, testDriveViewData);
  statusMessage.textContent = rendererState.statusMessage;
  syncRunConfigSelects();
  renderBatchProgress();
  renderHallOfFame();

  if (rendererState.mode === "world") {
    renderOverworldUi();
  } else {
    stopOverworldAnimationLoop();
  }
}

function renderStage(
  terrain: TerrainPresetDefinition,
  evolutionViewData: EvolutionViewData | null,
  testDriveViewData: TestDriveViewData | null,
): void {
  // Full-viewport mode: toggle the SVG wireframe viewport and the
  // pixel-art overworld canvas based on active mode. The old layout
  // relied on CSS panel visibility; the new viewport-first layout
  // does it here explicitly.
  const svgEl = document.querySelector<SVGElement>("[data-race-viewport]");
  const canvasEl = document.querySelector<HTMLCanvasElement>("[data-overworld-canvas]");
  if (svgEl && canvasEl) {
    if (rendererState.mode === "world") {
      svgEl.style.display = "none";
      canvasEl.style.display = "block";
    } else {
      svgEl.style.display = "block";
      canvasEl.style.display = "none";
    }
  }

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

  // Update the floating GEN pill (top-right of viewport).
  if (viewportGenValue) {
    viewportGenValue.textContent = String(rendererState.runState.generation);
  }
  if (viewportLeaderPill && viewportLeaderValue) {
    if (leader) {
      viewportLeaderPill.hidden = false;
      viewportLeaderValue.textContent = `${leader.id} · ${formatNumber(leader.score)}`;
    } else {
      viewportLeaderPill.hidden = true;
    }
  }

  runSummary.innerHTML = renderMetricList([
    { label: "Mode", value: "Evolution" },
    { label: "Generation", value: String(rendererState.runState.generation) },
    { label: "Population", value: String(rendererState.runState.population.length) },
    { label: "Leader", value: leader ? leader.id : "Waiting" },
    {
      label: "Best score",
      value: leader ? formatNumber(leader.score) : "--",
    },
    {
      label: "Wallet",
      value: `${rendererState.runState.wallet} credits`,
      muted: rendererState.runState.wallet === 0,
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
  // Show/hide the floating vehicle focus strip (hidden when no ranked vehicles).
  const vehicleStrip = document.querySelector<HTMLElement>("[data-vehicle-strip]");
  if (vehicleStrip) {
    vehicleStrip.hidden = evolutionViewData.rankedVehicles.length === 0;
  }
  leaderboardSummary.textContent = leader
    ? `Click a racer to pin the camera. ${leader.id} is currently on top.`
    : "Run a generation to inspect the active race field.";
  renderScoreChart();
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
        : testDriveViewData.scenarioLabel
          ? `Watching ${testDriveViewData.scenarioLabel} on ${terrain.name}.`
          : `Previewing the current DNA build on ${terrain.name}.`,
    caption:
      rendererState.mode === "menu"
        ? `Sample car with ${wheelCount} wheels and ${rectangleCount} chassis pieces.`
        : testDriveViewData.scenarioLabel
          ? `Replaying ${testDriveViewData.stepCount.toLocaleString()} simulation steps in a ${Math.round((testDriveViewData.playbackDurationMs ?? 0) / 1000)} second loop.`
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
    { label: "Preview steps", value: testDriveViewData.stepCount.toLocaleString() },
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
            : testDriveViewData.scenarioLabel
              ? "Edit the DNA or terrain to leave replay mode, or click the replay button again."
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
    ? testDriveViewData.scenarioLabel
      ? `Replay mode is showing ${testDriveViewData.scenarioLabel} with DNA ${testDriveViewData.decoded.dna}.`
      : `Current DNA ${testDriveViewData.decoded.dna} is rendered live in the shared viewport.`
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
        scenarioLabel: testDriveViewData.scenarioLabel,
        stepCount: testDriveViewData.stepCount,
        playbackDurationMs: testDriveViewData.playbackDurationMs,
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
    const panelModes = (panel.dataset.panel ?? "").split(/\s+/).filter(Boolean);
    panel.dataset.active = panelModes.includes(rendererState.mode) ? "true" : "false";
  }

  for (const button of modeButtonsElements) {
    button.classList.toggle(
      "active",
      button.dataset.modeButton === rendererState.mode,
    );
  }

  // Game-stage gets a mode-* class so the CSS can collapse side rails
  // (e.g. in evolution / test-drive modes, the right rail hides so the
  // viewport takes the whole screen).
  const stage = document.querySelector<HTMLElement>(".game-stage");
  if (stage) {
    stage.classList.remove("mode-world", "mode-evolution", "mode-test-drive", "mode-menu");
    stage.classList.add(`mode-${rendererState.mode}`);
  }

  // The viewport overlays are scoped to a single mode via data-mode and
  // only show when the current mode matches.
  const overlayWrappers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-viewport-actions-overlay],[data-viewport-hof-overlay],[data-viewport-dpad-overlay]",
    ),
  );
  for (const wrapper of overlayWrappers) {
    const wrapperMode = wrapper.dataset.mode;
    wrapper.hidden = wrapperMode !== rendererState.mode;
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

function renderBatchProgress(): void {
  if (rendererState.batchRunning && rendererState.batchCompleted > 0) {
    batchProgress.hidden = false;
    const percent = Math.min(
      100,
      Math.round((rendererState.batchCompleted / rendererState.batchCount) * 100),
    );
    batchProgressFill.style.width = `${percent}%`;
    batchProgressText.textContent = `${rendererState.batchCompleted} / ${rendererState.batchCount} generations`;
  } else if (rendererState.batchRunning) {
    batchProgress.hidden = false;
    batchProgressFill.style.width = "0%";
    batchProgressText.textContent = `Running ${rendererState.batchCount} generations…`;
  } else {
    batchProgress.hidden = true;
    batchProgressFill.style.width = "0%";
  }

  // Also drive the floating top-center overlay (visible inside the viewport).
  if (viewportProgressOverlay && viewportProgressFill && viewportProgressText) {
    if (rendererState.batchRunning) {
      viewportProgressOverlay.hidden = false;
      const percent = rendererState.batchCount > 0
        ? Math.min(100, Math.round((rendererState.batchCompleted / rendererState.batchCount) * 100))
        : 0;
      viewportProgressFill.style.width = `${percent}%`;
      viewportProgressText.textContent = `${rendererState.batchCompleted} / ${rendererState.batchCount} generations`;
    } else {
      viewportProgressOverlay.hidden = true;
      viewportProgressFill.style.width = "0%";
    }
  }

  runBatchButton.disabled = rendererState.batchRunning;
  runGenerationButton.disabled = rendererState.batchRunning;
}

async function runBatchGenerations(): Promise<void> {
  const { runState, generatedPopulation } = resolveRunnableRunState(
    rendererState,
    window.vroomon.createPreviewRunState,
  );
  const baseState =
    runState === rendererState.runState
      ? rendererState
      : setRendererRunState(
          rendererState,
          runState,
          generatedPopulation
            ? `Generated initial population for batch run ${runState.runId}.`
            : `Prepared batch run ${runState.runId} for evolution mode.`,
        );

  rendererState = setBatchRunning(
    {
      ...baseState,
      runState,
      lastEvaluatedRunState: null,
      latestGeneration: null,
    },
    true,
  );
  renderApp();

  const batchCount = rendererState.batchCount;
  const shouldDetectConvergence = rendererState.convergeMode;
  const worker = createEvolutionWorker();

  if (worker) {
    await runBatchWithWorker(worker, runState, batchCount, shouldDetectConvergence);
  } else {
    await runBatchSynchronous(runState, batchCount, shouldDetectConvergence);
  }

  rendererState = setBatchRunning(rendererState, false);
  await renderGenerationLog();
  renderApp();
}

interface EvolutionWorkerLike {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
}

interface ProgressPayload {
  type: "progress";
  completed: number;
  total: number;
  state: RunStateSnapshot;
  latestResult: GenerationResult;
  logEntry: GenerationLogEntry;
}

interface DonePayload {
  type: "done";
  completed: number;
  total: number;
  state: RunStateSnapshot;
  logEntries: GenerationLogEntry[];
  cancelled: boolean;
}

interface ErrorPayload {
  type: "error";
  message: string;
}

type WorkerPayload = ProgressPayload | DonePayload | ErrorPayload;

function createEvolutionWorker(): EvolutionWorkerLike | null {
  if (typeof Worker === "undefined") {
    return null;
  }

  try {
    return new Worker(new URL("./evolution.worker.js", import.meta.url), {
      type: "module",
    }) as unknown as EvolutionWorkerLike;
  } catch (error) {
    console.warn("Falling back to synchronous evolution runner.", error);
    return null;
  }
}

function isWorkerPayload(value: unknown): value is WorkerPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { type?: string };
  return (
    candidate.type === "progress" ||
    candidate.type === "done" ||
    candidate.type === "error"
  );
}

async function runBatchWithWorker(
  worker: EvolutionWorkerLike,
  runState: RunStateSnapshot,
  batchCount: number,
  shouldDetectConvergence: boolean,
): Promise<void> {
  let convergedEarly = false;
  let finalState: RunStateSnapshot = runState;
  const logEntries: GenerationLogEntry[] = [];
  let completed = 0;

  return new Promise<void>((resolve) => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;

      if (!isWorkerPayload(data)) {
        return;
      }

      if (data.type === "progress") {
        completed = data.completed;
        rendererState = applyBatchGeneration(
          rendererState,
          data.latestResult,
          data.state,
          data.completed,
          data.total,
        );
        logEntries.push(data.logEntry);
        renderApp();

        if (shouldDetectConvergence) {
          const { converged, message } = detectConvergence(rendererState.scoreHistory);

          if (converged) {
            convergedEarly = true;
            worker.postMessage({ type: "cancel" });
            rendererState = {
              ...rendererState,
              statusMessage: `${message} Stopped after ${data.completed} generation(s).`,
            };
            renderApp();
          }
        }
        return;
      }

      if (data.type === "done") {
        completed = data.completed;
        finalState = data.state;
        for (const entry of data.logEntries) {
          if (!logEntries.includes(entry)) {
            logEntries.push(entry);
          }
        }
        finalizeBatch(data.completed, data.total, data.cancelled || convergedEarly, logEntries);
        worker.removeEventListener("message", handleMessage);
        worker.terminate();
        resolve();
        return;
      }

      if (data.type === "error") {
        rendererState = {
          ...rendererState,
          statusMessage: `Worker error: ${data.message}. Falling back to inline batch.`,
        };
        worker.removeEventListener("message", handleMessage);
        worker.terminate();
        void runBatchSynchronous(runState, batchCount, shouldDetectConvergence).then(() =>
          resolve(),
        );
      }
    };

    worker.addEventListener("message", handleMessage);
    worker.postMessage({ type: "run-batch", state: runState, count: batchCount });
  });

  function finalizeBatch(
    completedCount: number,
    total: number,
    cancelled: boolean,
    entries: GenerationLogEntry[],
  ): void {
    finalState = finalState;
    rendererState = setBatchRunning(rendererState, false);

    if (cancelled) {
      rendererState = {
        ...rendererState,
        statusMessage: `Converged: ran ${completedCount} generations (final gen ${finalState.generation}). Scores plateaued.`,
      };
    } else {
      rendererState = {
        ...rendererState,
        statusMessage: `Batch complete: ran ${completedCount}/${total} generations (final gen ${finalState.generation}).`,
      };
    }

    void persistLogEntries(entries);
  }

  function persistLogEntries(entries: GenerationLogEntry[]): Promise<void> {
    return entries.reduce<Promise<void>>(async (chain, entry) => {
      await chain;
      await window.vroomon.appendGenerationLog(entry);
    }, Promise.resolve());
  }
}

async function runBatchSynchronous(
  runState: RunStateSnapshot,
  batchCount: number,
  shouldDetectConvergence: boolean,
): Promise<void> {
  let currentState = runState;
  const logEntries: GenerationLogEntry[] = [];
  let convergedEarly = false;

  for (let index = 0; index < batchCount; index += 1) {
    const generationResult = window.vroomon.runEvolutionGeneration(currentState);
    currentState = window.vroomon.advanceRunState(currentState, generationResult);
    const logEntry = window.vroomon.createGenerationLogEntry(currentState, generationResult);
    logEntries.push(logEntry);

    rendererState = applyBatchGeneration(
      rendererState,
      generationResult,
      currentState,
      index + 1,
      batchCount,
    );
    renderApp();

    if (shouldDetectConvergence) {
      const { converged, message } = detectConvergence(rendererState.scoreHistory);

      if (converged) {
        convergedEarly = true;
        rendererState = {
          ...rendererState,
          statusMessage: `${message} Stopped after ${index + 1} generation(s).`,
        };
        renderApp();
        break;
      }
    }
  }

  for (const entry of logEntries) {
    await window.vroomon.appendGenerationLog(entry);
  }

  if (convergedEarly) {
    rendererState = {
      ...rendererState,
      statusMessage: `Converged: ran ${rendererState.scoreHistory.length} generations (final gen ${currentState.generation}). Scores plateaued.`,
    };
  } else {
    rendererState = {
      ...rendererState,
      statusMessage: `Batch complete: ran ${batchCount} generations (final gen ${currentState.generation}).`,
    };
  }
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
  const rankMap = new Map(rankedVehicles.map((entry) => [entry.id, { score: entry.score }]));
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
  const previewFramesRaw = window.vroomon.previewPopulationRaceFrames(
    viewportState,
    DEFAULT_EVOLUTION_VIEWPORT_STEP_COUNT,
    DEFAULT_EVOLUTION_VIEWPORT_FRAME_COUNT,
  );
  // Derive the final-snapshot race summary from the last captured frame so
  // we don't pay for a second full Matter simulation just to populate the
  // "Travel shown" metric and diagnostics.
  const lastFrame = previewFramesRaw[previewFramesRaw.length - 1];
  const previewRace = lastFrame
    ? lastFrame.vehicles.map((vehicle) => ({
        id: vehicle.id,
        dna: vehicle.dna,
        chassis: vehicle.chassis,
        wheels: vehicle.wheels,
        centerX: vehicle.centerX,
        centerY: vehicle.centerY,
        initialCenterX: vehicle.initialCenterX,
        initialCenterY: vehicle.initialCenterY,
        finalCenterX: vehicle.centerX,
        finalCenterY: vehicle.centerY,
      }))
    : [];
  const previewFrames = previewFramesRaw.map((frame) => ({
      elapsedMs: frame.elapsedMs,
      entities: frame.vehicles.map((vehicle) => {
        const vehicleScoreInfo = rankMap.get(vehicle.id);
        return {
          id: vehicle.id,
          label: vehicle.id,
          snapshot: vehicle,
          initialCenterX: vehicle.initialCenterX,
          score: vehicleScoreInfo?.score,
          variant:
            vehicle.id === selectedVehicleId
              ? "selected"
              : vehicle.id === rankedVehicles[0]?.id
                ? "leader"
                : "racer",
        } satisfies ViewportEntity;
      }),
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
  const stepCount = rendererState.testDriveStepCount || DEFAULT_TEST_DRIVE_STEP_COUNT;
  const frameCount = rendererState.testDriveFrameCount || DEFAULT_TEST_DRIVE_FRAME_COUNT;
  const playbackDurationMs = rendererState.testDrivePlaybackDurationMs;
  const snapshot = window.vroomon.previewPhysicsSnapshot(
    cleanedDna,
    terrainName,
    stepCount,
  );
  const frames = retimeViewportFrames(
    window.vroomon
      .previewPhysicsFrames(cleanedDna, terrainName, stepCount, frameCount)
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
      })),
    playbackDurationMs,
  );

  return {
    dna: cleanedDna,
    decoded,
    snapshot,
    frames,
    scenarioLabel: rendererState.testDriveScenarioLabel,
    stepCount,
    playbackDurationMs,
  };
}

function retimeViewportFrames(
  frames: ViewportFrame[],
  durationMs: number | null,
): ViewportFrame[] {
  if (frames.length <= 1 || durationMs === null || durationMs <= 0) {
    return frames;
  }

  const originalDuration = frames[frames.length - 1]?.elapsedMs ?? 0;

  if (originalDuration <= 0 || originalDuration === durationMs) {
    return frames;
  }

  return frames.map((frame, index) => ({
    ...frame,
    elapsedMs:
      index === 0
        ? 0
        : index === frames.length - 1
          ? durationMs
          : Math.round((frame.elapsedMs / originalDuration) * durationMs),
  }));
}

// Track the scene the viewport is currently animating so that repeated
// renderApp() calls with the same frames (status-text updates, hall-of-fame
// loads, batch progress between generations) don't keep restarting the loop
// from frame 0 — which was the main reason the viewport looked frozen/flickery.
// `currentSceneToken` ties the cached scene to the live rAF loop: if the loop
// was stopped (token bumped) we must restart even for identical frames.
let currentSceneFrames: ViewportFrame[] | null = null;
let currentSceneTerrain: TerrainPresetDefinition | null = null;
let currentSceneFocusId: string | null | undefined = undefined;
let currentSceneToken = -1;

function playViewportScene(scene: ViewportScene): void {
  if (scene.frames.length === 0) {
    stopViewportAnimation();
    currentSceneFrames = null;
    currentSceneTerrain = null;
    currentSceneFocusId = undefined;
    viewportSvg.innerHTML = "";
    return;
  }

  // Same frames + terrain + focus still animating on the same loop? Leave it.
  if (
    currentSceneFrames === scene.frames &&
    currentSceneTerrain === scene.terrain &&
    currentSceneFocusId === scene.focusVehicleId &&
    currentSceneToken === viewportAnimationToken
  ) {
    return;
  }

  stopViewportAnimation();
  currentSceneFrames = scene.frames;
  currentSceneTerrain = scene.terrain;
  currentSceneFocusId = scene.focusVehicleId;

  const token = viewportAnimationToken;
  currentSceneToken = token;
  const totalDuration = scene.frames[scene.frames.length - 1]!.elapsedMs;

  const renderFrame = (frame: ViewportFrame): void => {
    if (token !== viewportAnimationToken) {
      return;
    }
    viewportSvg.innerHTML = renderViewportMarkup(
      scene.terrain,
      frame,
      scene.focusVehicleId ?? null,
    );
  };

  renderFrame(scene.frames[0]!);

  if (scene.frames.length === 1 || totalDuration <= 0) {
    return;
  }

  const start = performance.now();

  const step = (now: number): void => {
    if (token !== viewportAnimationToken) {
      return;
    }

    const elapsed = (now - start) % totalDuration;
    const interpolated = interpolateViewportFrame(scene.frames, elapsed);
    renderFrame(interpolated);

    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

function stopViewportAnimation(): void {
  viewportAnimationToken += 1;
}

function interpolateViewportFrame(
  frames: ViewportFrame[],
  elapsedMs: number,
): ViewportFrame {
  // Find the surrounding keyframes.
  let lower = 0;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index]!.elapsedMs <= elapsedMs) {
      lower = index;
    } else {
      break;
    }
  }
  const upper = Math.min(frames.length - 1, lower + 1);
  const a = frames[lower]!;
  const b = frames[upper]!;
  const span = b.elapsedMs - a.elapsedMs;
  const t = span > 0 ? Math.min(1, Math.max(0, (elapsedMs - a.elapsedMs) / span)) : 0;

  if (t === 0 || a === b) {
    return a;
  }

  return {
    elapsedMs,
    entities: a.entities.map((entityA, entityIndex) => {
      const entityB = b.entities[entityIndex];
      if (!entityB) {
        return entityA;
      }
      return {
        ...entityA,
        snapshot: interpolateSnapshot(entityA.snapshot, entityB.snapshot, t),
      } satisfies ViewportEntity;
    }),
  };
}

function interpolateSnapshot(
  a: VehicleSnapshot,
  b: VehicleSnapshot,
  t: number,
): VehicleSnapshot {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const lerpAngle = (x: number, y: number) => {
    let delta = y - x;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return x + delta * t;
  };
  const chassis = a.chassis.map((bodyA, index) => {
    const bodyB = b.chassis[index];
    if (!bodyB) return bodyA;
    return {
      ...bodyA,
      x: lerp(bodyA.x, bodyB.x),
      y: lerp(bodyA.y, bodyB.y),
      angle: lerpAngle(bodyA.angle, bodyB.angle),
    } satisfies BodySnapshot;
  });
  const wheels = a.wheels.map((bodyA, index) => {
    const bodyB = b.wheels[index];
    if (!bodyB) return bodyA;
    return {
      ...bodyA,
      x: lerp(bodyA.x, bodyB.x),
      y: lerp(bodyA.y, bodyB.y),
      angle: lerpAngle(bodyA.angle, bodyB.angle),
    } satisfies BodySnapshot;
  });
  return {
    chassis,
    wheels,
    centerX: lerp(a.centerX, b.centerX),
    centerY: lerp(a.centerY, b.centerY),
  };
}

function renderViewportMarkup(
  terrain: TerrainPresetDefinition,
  frame: ViewportFrame,
  focusVehicleId: string | null,
): string {
  const view = calculateViewportWindow(terrain, frame.entities, focusVehicleId);
  const groundY = toSvgY(view, terrain.groundHeight);
  const groundHeight = Math.max(30, SVG_HEIGHT - groundY);
  const patternId = `terrain-pattern-${escapeHtml(terrain.name.toLowerCase())}`;
  const vehicleMarkup = frame.entities
    .map((entity) => renderViewportEntity(entity, terrain, view))
    .join("");

  return `
    <defs>
      ${renderTerrainPatternDefs(terrain)}
    </defs>
    <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#15314f"></rect>
    <rect x="0" y="${groundY}" width="${SVG_WIDTH}" height="${groundHeight}" fill="${terrain.colorGround ?? "#6c5233"}"></rect>
    <rect x="0" y="${groundY}" width="${SVG_WIDTH}" height="${groundHeight}" fill="url(#${patternId})" opacity="0.6"></rect>
    ${renderTerrainObstacles(terrain, view)}
    <line x1="${toSvgX(view, 220)}" y1="0" x2="${toSvgX(view, 220)}" y2="${SVG_HEIGHT}" stroke="rgba(255,255,255,0.2)" stroke-width="4" stroke-dasharray="10 10"></line>
    <line x1="${toSvgX(view, terrain.groundLength - 200)}" y1="0" x2="${toSvgX(view, terrain.groundLength - 200)}" y2="${SVG_HEIGHT}" stroke="rgba(255,215,0,0.35)" stroke-width="6" stroke-dasharray="8 8"></line>
    ${vehicleMarkup}
  `;
}

function renderTerrainPatternDefs(terrain: TerrainPresetDefinition): string {
  const name = terrain.name.toLowerCase();
  const ground = terrain.colorGround ?? "#6c5233";

  switch (name) {
    case "grassland":
      return `<pattern id="terrain-pattern-grassland" width="16" height="12" patternUnits="userSpaceOnUse">
        <rect width="16" height="12" fill="none"></rect>
        <path d="M4 12 Q4 6 8 4" stroke="rgba(90,180,80,0.35)" stroke-width="1.5" fill="none"></path>
        <path d="M12 12 Q12 5 14 3" stroke="rgba(80,170,70,0.3)" stroke-width="1.5" fill="none"></path>
      </pattern>`;
    case "flat":
      return `<pattern id="terrain-pattern-flat" width="20" height="8" patternUnits="userSpaceOnUse">
        <rect width="20" height="8" fill="none"></rect>
        <line x1="0" y1="2" x2="20" y2="2" stroke="rgba(255,255,255,0.06)" stroke-width="1"></line>
        <line x1="0" y1="6" x2="20" y2="6" stroke="rgba(0,0,0,0.06)" stroke-width="1"></line>
      </pattern>`;
    case "sand":
      return `<pattern id="terrain-pattern-sand" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="none"></rect>
        <circle cx="2" cy="2" r="0.8" fill="rgba(180,140,60,0.5)"></circle>
        <circle cx="6" cy="6" r="0.6" fill="rgba(200,160,80,0.4)"></circle>
        <circle cx="1" cy="5" r="0.5" fill="rgba(160,120,50,0.3)"></circle>
      </pattern>`;
    case "hills":
      return `<pattern id="terrain-pattern-hills" width="40" height="20" patternUnits="userSpaceOnUse">
        <rect width="40" height="20" fill="none"></rect>
        <path d="M0 14 Q10 4 20 14 Q30 4 40 14" stroke="rgba(60,140,50,0.3)" stroke-width="2" fill="none"></path>
        <path d="M0 18 Q10 10 20 18 Q30 10 40 18" stroke="rgba(50,130,40,0.2)" stroke-width="1.5" fill="none"></path>
      </pattern>`;
    case "rocky":
      return `<pattern id="terrain-pattern-rocky" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="none"></rect>
        <line x1="0" y1="0" x2="16" y2="16" stroke="rgba(120,120,120,0.3)" stroke-width="1"></line>
        <line x1="16" y1="0" x2="0" y2="16" stroke="rgba(120,120,120,0.3)" stroke-width="1"></line>
        <rect x="2" y="2" width="4" height="4" rx="1" fill="rgba(160,160,160,0.25)"></rect>
        <rect x="10" y="10" width="3" height="3" rx="1" fill="rgba(140,140,140,0.2)"></rect>
      </pattern>`;
    case "ice":
      return `<pattern id="terrain-pattern-ice" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="none"></rect>
        <circle cx="4" cy="4" r="1" fill="rgba(255,255,255,0.5)"></circle>
        <circle cx="18" cy="10" r="1.2" fill="rgba(255,255,255,0.4)"></circle>
        <circle cx="8" cy="18" r="0.8" fill="rgba(255,255,255,0.3)"></circle>
        <circle cx="20" cy="20" r="0.6" fill="rgba(200,230,255,0.35)"></circle>
        <line x1="0" y1="12" x2="24" y2="12" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      </pattern>`;
    default:
      return `<pattern id="terrain-pattern-${escapeHtml(name)}" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="none"></rect>
      </pattern>`;
  }
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
          : scoreToAccent(entity.score);
  const originX = toSvgX(view, entity.snapshot.centerX);
  const originY = toSvgY(view, entity.snapshot.centerY);
  const trail =
    entity.initialCenterX !== undefined
      ? `<line x1="${toSvgX(view, entity.initialCenterX)}" y1="${originY}" x2="${originX}" y2="${originY}" stroke="rgba(255,255,255,0.18)" stroke-width="3" stroke-dasharray="8 8"></line>`
      : "";
  // Draw constraint lines from each chassis to each wheel so the car
  // looks like an assembled vehicle instead of a cloud of disconnected
  // pieces. Lines go through the body centers.
  const constraintMarkup = [
    ...entity.snapshot.chassis.flatMap((chassis) => {
      const cx = toSvgX(view, chassis.x);
      const cy = toSvgY(view, chassis.y);
      return entity.snapshot.wheels.map((wheel) => {
        const wx = toSvgX(view, wheel.x);
        const wy = toSvgY(view, wheel.y);
        return `<line x1="${cx}" y1="${cy}" x2="${wx}" y2="${wy}" stroke="${accent.stroke}" stroke-width="2" stroke-opacity="0.55"></line>`;
      });
    }),
    // Chassis-to-chassis connectors (frame skeleton)
    ...entity.snapshot.chassis.slice(0, -1).map((chassis, index) => {
      const next = entity.snapshot.chassis[index + 1];
      if (!next) return "";
      return `<line x1="${toSvgX(view, chassis.x)}" y1="${toSvgY(view, chassis.y)}" x2="${toSvgX(view, next.x)}" y2="${toSvgY(view, next.y)}" stroke="${accent.stroke}" stroke-width="3" stroke-opacity="0.7"></line>`;
    }),
  ].join("");
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
      ${constraintMarkup}
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

function scoreToAccent(score: number | undefined): { fill: string; stroke: string } {
  if (score === undefined) {
    return { fill: "#63e6be", stroke: "rgba(255,255,255,0.88)" };
  }

  const clamped = Math.min(1, Math.max(0, score / 200));
  const hue = 90 + clamped * 60; // 90 (green) → 150 (teal) for higher scores
  const lightnessLow = 52;
  const lightnessHigh = 70;
  const lightness = lightnessLow + clamped * (lightnessHigh - lightnessLow);
  const sat = 65 + clamped * 25;
  const fill = `hsl(${hue}, ${sat}%, ${lightness}%)`;
  const stroke = `hsla(${hue}, ${Math.min(100, sat + 20)}%, ${Math.min(100, lightness + 20)}%, 0.88)`;

  return { fill, stroke };
}

function renderScoreChart(): void {
  const history = rendererState.scoreHistory;

  if (history.length === 0) {
    scoreChartElement.innerHTML =
      `<p class="muted">Run generations to see best and mean scores over time.</p>`;
    return;
  }

  const bestScore = Math.max(...history.map((entry) => entry.bestScore));
  const chartHeight = 100;
  const barWidth = Math.max(4, Math.min(16, Math.floor(240 / Math.max(history.length, 1))));
  const gap = 2;

  const chartBars = history
    .map((entry, index) => {
      const bestBarHeight = (entry.bestScore / Math.max(bestScore, 1)) * chartHeight;
      const meanBarHeight = (entry.meanScore / Math.max(bestScore, 1)) * chartHeight;
      const x = index * (barWidth + gap);

      return `
        <g>
          <rect x="${x}" y="${chartHeight - bestBarHeight}" width="${barWidth}" height="${bestBarHeight}" fill="#ffd166" rx="2" opacity="0.85"></rect>
          <rect x="${x}" y="${chartHeight - meanBarHeight}" width="${barWidth}" height="${meanBarHeight}" fill="#8ab4ff" rx="2" opacity="0.6"></rect>
          <title>Gen ${entry.generation}: best=${formatNumber(entry.bestScore)} mean=${formatNumber(entry.meanScore)} pop=${entry.populationSize}</title>
        </g>`;
    })
    .join("");

  const labels = `
    <text x="0" y="${chartHeight + 14}" fill="#97abc7" font-size="10">${history[0]?.generation ?? 0}</text>
    <text x="${(history.length - 1) * (barWidth + gap)}" y="${chartHeight + 14}" fill="#97abc7" font-size="10" text-anchor="end">${history[history.length - 1]?.generation ?? 0}</text>
  `;

  scoreChartElement.innerHTML = `
    <div class="score-chart-layout">
      <div class="score-chart-legend">
        <span><span class="legend-swatch" style="background:#ffd166"></span>Best</span>
        <span><span class="legend-swatch" style="background:#8ab4ff"></span>Mean</span>
      </div>
      <svg width="100%" height="${chartHeight + 24}" viewBox="0 0 ${Math.max(240, history.length * (barWidth + gap))} ${chartHeight + 24}">
        ${chartBars}
        ${labels}
      </svg>
    </div>`;
}

function renderHallOfFame(): void {
  const entries = rendererState.hallOfFame.entries;
  const emptyMarkup = `<p class="muted">No vehicles in the Hall of Fame yet. Save top cars from evolution mode.</p>`;
  const testDriveEmptyMarkup = `<p class="muted">No vehicles in the Hall of Fame yet.</p>`;

  // Floating HoF summary card (bottom-right overlay in test-drive mode).
  if (hofCount) {
    hofCount.textContent = String(entries.length);
  }
  if (hofTopScore) {
    if (entries.length === 0) {
      hofTopScore.textContent = "—";
    } else {
      const top = entries.reduce((best, current) =>
        current.score > best.score ? current : best,
      );
      hofTopScore.textContent = formatNumber(top.score);
    }
  }

  if (entries.length === 0) {
    hallOfFameElement.innerHTML = emptyMarkup;
    hallOfFameTestDriveElement.innerHTML = testDriveEmptyMarkup;
    return;
  }

  const sortedEntries = entries
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);

  const buildEntryHtml = (entry: HallOfFameEntry, showRemove: boolean): string => `
    <div class="hall-entry" data-hall-entry="${escapeHtml(entry.id)}" data-active="${rendererState.selectedHallEntryId === entry.id ? "true" : "false"}">
      <div>
        <div class="hall-entry__name">${escapeHtml(entry.name)}</div>
        <div class="hall-entry__dna">${escapeHtml(entry.dna)}</div>
        <div class="hall-entry__meta">gen ${entry.generation} · ${escapeHtml(entry.terrainName)} · ${formatSavedAt(entry.savedAt)}</div>
      </div>
      <div style="display:grid; gap:0.3rem; text-align:right;">
        <span class="hall-entry__score">${formatNumber(entry.score)}</span>
        ${showRemove ? `<button class="hall-entry__rename" data-hall-rename="${escapeHtml(entry.id)}" type="button" title="Rename (1 credit)">Rename</button>` : ""}
        ${showRemove ? `<button class="hall-entry__remove" data-hall-remove="${escapeHtml(entry.id)}" type="button">Remove</button>` : ""}
      </div>
    </div>
  `;

  hallOfFameElement.innerHTML = sortedEntries
    .map((entry) => buildEntryHtml(entry, true))
    .join("");
  hallOfFameTestDriveElement.innerHTML = sortedEntries
    .map((entry) => buildEntryHtml(entry, false))
    .join("");

  for (const element of [hallOfFameElement, hallOfFameTestDriveElement]) {
    for (const entry of Array.from(
      element.querySelectorAll<HTMLElement>("[data-hall-entry]"),
    )) {
      entry.addEventListener("click", () => {
        const entryId = entry.dataset.hallEntry ?? "";
        const found = rendererState.hallOfFame.entries.find(
          (candidate) => candidate.id === entryId,
        );

        if (!found) {
          return;
        }

        if (rendererState.mode !== "test-drive") {
          rendererState = setRendererMode(rendererState, "test-drive");
        }

        dnaInput.value = found.dna;
        rendererState = setDraftDna(rendererState, found.dna);
        rendererState = selectHallEntry(rendererState, found.id);
        rendererState = {
          ...rendererState,
          statusMessage: `Loaded ${found.name} from Hall of Fame (${found.terrainName}, score ${formatNumber(found.score)}).`,
        };
        renderApp();
      });
    }

    for (const remove of Array.from(
      element.querySelectorAll<HTMLButtonElement>("[data-hall-remove]"),
    )) {
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        const entryId = remove.dataset.hallRemove ?? "";
        rendererState = removeHallOfFameEntry(rendererState, entryId);
        await window.vroomon.saveHallOfFame(rendererState.hallOfFame);
        renderApp();
      });
    }

    for (const rename of Array.from(
      element.querySelectorAll<HTMLButtonElement>("[data-hall-rename]"),
    )) {
      rename.addEventListener("click", async (event) => {
        event.stopPropagation();
        const entryId = rename.dataset.hallRename ?? "";
        const entry = rendererState.hallOfFame.entries.find(
          (candidate) => candidate.id === entryId,
        );

        if (!entry) {
          return;
        }

        const newName = window.prompt(
          `Rename "${entry.name}" (costs 1 credit; you have ${rendererState.runState.wallet})`,
          entry.name,
        );

        if (newName === null) {
          return;
        }

        const result = renameHallOfFameEntry(rendererState, entryId, newName);
        rendererState = result.state;

        if (!result.ok) {
          rendererState = {
            ...rendererState,
            statusMessage: `Rename failed: ${result.reason ?? "unknown error"}`,
          };
          renderApp();
          return;
        }

        await window.vroomon.saveHallOfFame(rendererState.hallOfFame);
        rendererState = {
          ...rendererState,
          statusMessage: `Renamed entry to "${newName.trim()}" (1 credit spent).`,
        };
        renderApp();
      });
    }
  }
}

function formatSavedAt(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString();
  } catch {
    return isoString;
  }
}

async function loadHallOfFame(): Promise<void> {
  try {
    const hall = await window.vroomon.loadHallOfFame();
    rendererState = setHallOfFame(rendererState, hall);
    renderApp();
  } catch {
    rendererState = {
      ...rendererState,
      statusMessage: "Could not load Hall of Fame.",
    };
    renderApp();
  }
}

async function loadWorldStateFromDisk(): Promise<void> {
  try {
    const persisted = await window.vroomon.loadWorldState();
    const restored = applyPersistedWorld(overworldController.state, persisted);
    overworldController._setState(restored);
    rendererState = setWorldState(rendererState, restored);
    renderOverworldUi();
  } catch {
    rendererState = {
      ...rendererState,
      statusMessage: "Could not load overworld save.",
    };
    renderApp();
  }
}

function applyPersistedWorld(
  world: WorldState,
  persisted: { currentMapId: string; playerX: number; playerY: number; playerFacing: Direction; badges: string[]; vroomdex: string[]; flags: Record<string, boolean> },
): WorldState {
  const mapExists = getMap(persisted.currentMapId) !== undefined;
  return {
    ...world,
    currentMapId: mapExists ? persisted.currentMapId : world.currentMapId,
    playerX: Number.isFinite(persisted.playerX) ? persisted.playerX : world.playerX,
    playerY: Number.isFinite(persisted.playerY) ? persisted.playerY : world.playerY,
    playerFacing: persisted.playerFacing ?? world.playerFacing,
    badges: Array.isArray(persisted.badges) ? persisted.badges : world.badges,
    vroomdex: Array.isArray(persisted.vroomdex) ? persisted.vroomdex : world.vroomdex,
    flags:
      persisted.flags && typeof persisted.flags === "object" ? persisted.flags : world.flags,
  };
}

let worldSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWorldSave(): void {
  if (worldSaveTimer !== null) {
    return;
  }
  worldSaveTimer = setTimeout(() => {
    worldSaveTimer = null;
    void persistWorldState();
  }, 250);
}

async function persistWorldState(): Promise<void> {
  const world = overworldController.state;
  if (world.activeNpc || world.currentEncounter) {
    return;
  }
  const persisted = {
    version: 1 as const,
    currentMapId: world.currentMapId,
    playerX: world.playerX,
    playerY: world.playerY,
    playerFacing: world.playerFacing,
    badges: [...world.badges],
    vroomdex: [...world.vroomdex],
    flags: { ...world.flags },
    lastSavedAt: new Date().toISOString(),
  };
  try {
    await window.vroomon.saveWorldState(persisted);
  } catch {
    rendererState = {
      ...rendererState,
      statusMessage: "Could not save overworld state.",
    };
  }
}

async function saveSelectedToHall(): Promise<void> {
  const summary = getSelectedVehicleSummary(rendererState);

  if (!summary) {
    rendererState = {
      ...rendererState,
      statusMessage: "Select a vehicle first, then save it to the Hall of Fame.",
    };
    renderApp();
    return;
  }

  const entry: HallOfFameEntry = {
    id: `hall-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    runId: rendererState.runState.runId,
    dna: summary.dna,
    name: `${summary.id} (g${rendererState.runState.generation})`,
    score: summary.score,
    terrainName: rendererState.runState.terrainName,
    generation: rendererState.runState.generation,
    savedAt: new Date().toISOString(),
    notes: "",
  };

  rendererState = addHallOfFameEntry(rendererState, entry);
  await window.vroomon.saveHallOfFame(rendererState.hallOfFame);
  rendererState = {
    ...rendererState,
    statusMessage: `Saved ${entry.name} to Hall of Fame (${formatNumber(entry.score)} points).`,
  };
  renderApp();
}

function renderOverworldUi(): void {
  const world = overworldController.state;
  rendererState = setWorldState(rendererState, world);

  const map = getMap(world.currentMapId);
  const currentDialogue = world.dialogueQueue[0] ?? null;
  const activeNpc = map?.npcs.find((npc) => npc.id === world.activeNpc) ?? null;

  if (currentDialogue) {
    overworldDialogue.hidden = false;
    overworldDialogueName.textContent = activeNpc?.name ?? "Narrator";
    overworldDialogueText.textContent = currentDialogue.text;

    if (currentDialogue.options && currentDialogue.options.length > 0) {
      overworldDialogueOptions.innerHTML = currentDialogue.options
        .map(
          (option) => `<button type="button" data-dialogue-option="${escapeHtml(option.next)}">${escapeHtml(option.label)}</button>`,
        )
        .join("");
      for (const button of Array.from(
        overworldDialogueOptions.querySelectorAll<HTMLButtonElement>("[data-dialogue-option]"),
      )) {
        button.addEventListener("click", () => {
          const nextId = button.dataset.dialogueOption ?? "";
          const target = map?.npcs
            .map((npc) => npc.dialogue)
            .find((dialogue) => dialogue !== null && (dialogue as { text?: string }).text === nextId)
            ?? null;
          if (target) {
            const advanced = advanceWorldDialogue(world, nextId, target);
            overworldController._setState(advanced);
            renderOverworldUi();
          } else {
            const ended = endWorldDialogue(world, null, null);
            overworldController._setState(ended);
            renderOverworldUi();
          }
        });
      }
    } else {
      overworldDialogueOptions.innerHTML = "";
    }
  } else {
    overworldDialogue.hidden = true;
    overworldDialogueName.textContent = "";
    overworldDialogueText.textContent = "";
    overworldDialogueOptions.innerHTML = "";
  }

  if (world.badges.length === 0) {
    overworldBadgeList.innerHTML =
      `<li class="muted">No badges yet. Challenge Coach Flint on Route 1.</li>`;
  } else {
    overworldBadgeList.innerHTML = world.badges
      .map((badge) => `<li>${escapeHtml(badge)}</li>`)
      .join("");
  }
  overworldVroomdexCount.textContent = `${world.vroomdex.length} specimen${world.vroomdex.length === 1 ? "" : "s"} recorded`;
  overworldSummary.textContent = map
    ? `You're in ${map.name}. Use arrow keys to walk and Z to talk to people.`
    : "Use arrow keys to walk and Z to talk to people.";

  startOverworldAnimationLoop();
}

function startOverworldAnimationLoop(): void {
  if (overworldAnimationToken !== 0) {
    return;
  }
  const token = ++overworldAnimationToken;
  const tick = (): void => {
    if (token !== overworldAnimationToken) {
      return;
    }
    const map = getMap(overworldController.state.currentMapId);
    if (map) {
      renderOverworld(overworldCanvas, {
        map,
        world: overworldController.state,
        tick: performance.now(),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopOverworldAnimationLoop(): void {
  overworldAnimationToken += 1;
}

function handleOverworldKeydown(event: KeyboardEvent): void {
  const world = overworldController.state;

  if (world.dialogueQueue.length > 0) {
    if (event.key === "z" || event.key === "Z" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const current = world.dialogueQueue[0];
      if (current?.options && current.options.length > 0) {
        return;
      }
      overworldController.advanceDialogue();
      renderOverworldUi();
    }
    return;
  }

  const directionMap: Record<string, Direction> = {
    arrowup: "up",
    w: "up",
    arrowdown: "down",
    s: "down",
    arrowleft: "left",
    a: "left",
    arrowright: "right",
    d: "right",
  };

  const targetDirection = directionMap[event.key.toLowerCase()];

  if (targetDirection) {
    event.preventDefault();
    overworldController.move(targetDirection);
    renderOverworldUi();
    scheduleWorldSave();
    return;
  }

  if (event.key === "z" || event.key === "Z" || event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    overworldController.interact();
    renderOverworldUi();
    scheduleWorldSave();
  }
}

function dispatchOverworldDpad(direction: Direction | "interact"): void {
  if (direction === "interact") {
    overworldController.interact();
    renderOverworldUi();
    scheduleWorldSave();
    return;
  }
  overworldController.move(direction);
  renderOverworldUi();
  scheduleWorldSave();
}

for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-dpad]"),
)) {
  button.addEventListener("click", () => {
    const value = button.dataset.dpad;
    if (
      value === "up" ||
      value === "down" ||
      value === "left" ||
      value === "right" ||
      value === "interact"
    ) {
      dispatchOverworldDpad(value);
    }
  });
}

overworldSaveNowButton.addEventListener("click", () => {
  void persistWorldState().then(() => {
    rendererState = {
      ...rendererState,
      statusMessage: "Overworld saved.",
    };
    renderApp();
  });
});

overworldResetButton.addEventListener("click", () => {
  if (!window.confirm("Reset overworld progress? This wipes your badges, Vroomdex, and position.")) {
    return;
  }
  const reset = createInitialWorldState();
  overworldController._setState(reset);
  rendererState = setWorldState(rendererState, reset);
  void persistWorldState();
  rendererState = {
    ...rendererState,
    statusMessage: "Overworld progress reset.",
  };
  renderOverworldUi();
});

async function startOverworldEncounter(
  kind: "wild" | "trainer" | "gym",
  dna: string,
  trainerName: string | null,
): Promise<void> {
  const result = window.vroomon.previewPhysicsSnapshot(dna, "Grassland", 60);

  if (kind === "gym") {
    rendererState = {
      ...rendererState,
      statusMessage: `Coach Flint's car ${formatNumber(result.centerX)} (y=${formatNumber(result.centerY)}). Build a better car in the lab and come back!`,
    };
    if ((overworldController as unknown as { _awardBadge?: (badge: string) => unknown })._awardBadge) {
      (overworldController as unknown as { _awardBadge: (badge: string) => void })._awardBadge(
        overworldController.state.currentMapId,
      );
    }
    return;
  }

  rendererState = {
    ...rendererState,
    statusMessage: kind === "trainer"
      ? `Rider race! ${trainerName ?? "Opponent"} reached x=${formatNumber(result.centerX)}.`
      : `A wild vehicle appeared (x=${formatNumber(result.centerX)}, y=${formatNumber(result.centerY)}).`,
  };
  renderApp();
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

watchRegressionButton.addEventListener("click", () => {
  dnaInput.value = FLAT_TRACK_REGRESSION_REPLAY.dna;
  terrainSelect.value = FLAT_TRACK_REGRESSION_REPLAY.terrainName;
  rendererState = setTestDriveReplay(rendererState, {
    ...FLAT_TRACK_REGRESSION_REPLAY,
    statusMessage: `Watching ${FLAT_TRACK_REGRESSION_REPLAY.label}.`,
  });
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

runBatchButton.addEventListener("click", () => {
  void runBatchGenerations();
});

saveToHallButton.addEventListener("click", () => {
  void saveSelectedToHall();
});

function syncRunConfigSelects(): void {
  const config = rendererState.runState.config;
  if (populationSizeSelect.value !== String(config.populationSize)) {
    populationSizeSelect.value = String(config.populationSize);
  }
  if (dnaLengthSelect.value !== String(config.dnaLength)) {
    dnaLengthSelect.value = String(config.dnaLength);
  }
  if (mutationRateSelect.value !== String(config.mutationRate)) {
    mutationRateSelect.value = String(config.mutationRate);
  }
  if (retainRatioSelect.value !== String(config.retainRatio)) {
    retainRatioSelect.value = String(config.retainRatio);
  }
  if (batchCountSelect && String(batchCountSelect.value) !== String(rendererState.batchCount)) {
    batchCountSelect.value = String(rendererState.batchCount);
  }
  if (convergeToggle && convergeToggle.checked !== rendererState.convergeMode) {
    convergeToggle.checked = rendererState.convergeMode;
  }
}

populationSizeSelect.addEventListener("change", () => {
  const value = Number(populationSizeSelect.value) || 100;
  rendererState = setRunConfig(rendererState, { populationSize: value });
  renderApp();
});

dnaLengthSelect.addEventListener("change", () => {
  const value = Number(dnaLengthSelect.value) || 12;
  rendererState = setRunConfig(rendererState, { dnaLength: value });
  renderApp();
});

mutationRateSelect.addEventListener("change", () => {
  const value = Number(mutationRateSelect.value) || 0.1;
  rendererState = setRunConfig(rendererState, { mutationRate: value });
  renderApp();
});

retainRatioSelect.addEventListener("change", () => {
  const value = Number(retainRatioSelect.value) || 0.5;
  rendererState = setRunConfig(rendererState, { retainRatio: value });
  renderApp();
});

// Populate and wire the batch controls (desktop shell only — game.html omits
// these elements, so all wiring is guarded).
if (batchCountSelect) {
  batchCountSelect.innerHTML = BATCH_COUNT_OPTIONS.map(
    (option) => `<option value="${option}">${option}</option>`,
  ).join("");
  batchCountSelect.value = String(rendererState.batchCount);
  batchCountSelect.addEventListener("change", () => {
    const value = Number(batchCountSelect.value) || DEFAULT_BATCH_GENERATION_COUNT;
    rendererState = setBatchCount(rendererState, value);
    renderApp();
  });
}

if (convergeToggle) {
  convergeToggle.checked = rendererState.convergeMode;
  convergeToggle.addEventListener("change", () => {
    rendererState = setConvergeMode(rendererState, convergeToggle.checked);
    renderApp();
  });
}

// Collapsible config panel toggle
const configToggle = document.querySelector<HTMLButtonElement>("[data-config-toggle]");
const configPanel = document.querySelector<HTMLElement>("[data-config-panel]");
if (configToggle && configPanel) {
  configToggle.addEventListener("click", () => {
    configPanel.hidden = !configPanel.hidden;
  });
}

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return;
  }

  if (rendererState.mode === "world") {
    handleOverworldKeydown(event);
    return;
  }

  switch (event.key.toLowerCase()) {
    case "r":
      if (rendererState.mode === "evolution" && !rendererState.batchRunning) {
        event.preventDefault();
        void runGeneration();
      }
      break;
    case "g":
      if (rendererState.mode === "evolution" && !rendererState.batchRunning) {
        event.preventDefault();
        generatePopulation();
      }
      break;
    case "b":
      if (rendererState.mode === "evolution" && !rendererState.batchRunning) {
        event.preventDefault();
        void runBatchGenerations();
      }
      break;
    case "d":
      if (rendererState.mode === "test-drive" && !rendererState.batchRunning) {
        event.preventDefault();
        const nextDna = window.vroomon.createRandomDna(12);
        dnaInput.value = nextDna;
        rendererState = setDraftDna(rendererState, nextDna);
        renderApp();
      }
      break;
    case "1":
    case "m":
      event.preventDefault();
      rendererState = setRendererMode(rendererState, "menu");
      renderApp();
      break;
    case "2":
    case "o":
      event.preventDefault();
      rendererState = setRendererMode(rendererState, "world");
      renderApp();
      break;
    case "3":
    case "e":
      event.preventDefault();
      rendererState = setRendererMode(rendererState, "evolution");
      renderApp();
      break;
    case "4":
    case "t":
      event.preventDefault();
      rendererState = setRendererMode(rendererState, "test-drive");
      renderApp();
      break;
    case "s":
      if (!rendererState.batchRunning) {
        event.preventDefault();
        void saveCurrentRunState();
      }
      break;
    case "l":
      if (!rendererState.batchRunning) {
        event.preventDefault();
        void loadSavedRunState();
      }
      break;
    default:
      break;
  }
});
