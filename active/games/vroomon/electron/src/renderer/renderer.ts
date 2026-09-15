import type { DecodedDnaV2 } from "../shared/dna-v2.js";
import type {
  AppModeId,
  HallOfFame,
  HallOfFameEntry,
  RecordsBoard,
  RunStateSnapshot,
  TerrainPresetDefinition,
  VroomonParityContract,
} from "../shared/parity-contract.js";
import { bestRecord, proposeRecord } from "./records.js";
import { portraitSvgFor } from "./portraits.js";

import type {
  EvolutionPreview,
  GenerationResult,
  PopulationEvaluation,
  ScoreStats,
} from "../core/population.js";
import {createOverworldInputs } from "./world/overworld-controller.js";
import { renderOverworld } from "./world/overworld-renderer.js";
import { getMap } from "./world/maps.js";
import { findFaction } from "./world/factions.js";
import { DECOR_ITEMS, findDecor } from "./world/decor.js";
import { questFor } from "./world/quest.js";
import { SPRITE_PALETTE as PAL } from "./world/sprites-palette.js";
import { sfx } from "./audio.js";
import { Ambience, loadAmbienceSettings, type AmbienceScene } from "./ambience.js";
import { setMasterVolume as setSfxMasterVolume } from "./audio.js";
import { loadSettings, saveSettings, type Settings } from "./settings.js";
import { decodeRun, decodeWorld, encodeRun, encodeWorld } from "./save-io.js";
import { captureLineage, plantSeedDna } from "../core/population.js";
import {
  effectiveRunConfig,
  SUPPLIES,
  studLineCapacity,
  UPGRADES,
  upgradeCost,
  upgradeLevel,
  type UpgradeId,
  type SupplyId,
} from "../core/economy.js";
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
  purchaseUpgrade,
  purchaseDecor,
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
      loadUpgrades: () => Promise<Record<string, number>>;
      saveUpgrades: (upgrades: Record<string, number>) => Promise<string>;
      loadRecords: () => Promise<RecordsBoard>;
      saveRecords: (board: RecordsBoard) => Promise<string>;
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
  variant: "solo" | "leader" | "selected" | "racer" | "ghost";
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
const overworldDialoguePortrait = document.querySelector<HTMLElement>("[data-dialogue-portrait]");
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
// Keep centered viewport labels inside the canvas so racers near the edge
// don't get their label clipped mid-glyph (shared by clampLabelX and the
// clamped-label staggering in layoutViewportLabels).
const LABEL_EDGE_PADDING = 62;
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

function testDriveViewSignature(dna: string, terrainName: string, ghostDna: string | null = null): string {
  const s = rendererState;
  return [
    "td",
    s.mode,
    dna,
    terrainName,
    ghostDna ?? "",
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
  ghostDna: string | null = null,
): TestDriveViewData {
  const signature = testDriveViewSignature(dna, terrainName, ghostDna);
  if (testDriveViewDataCache && testDriveViewDataCache.signature === signature) {
    return testDriveViewDataCache.data;
  }
  const data = buildTestDriveViewData(dna, terrainName, ghostDna);
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
      statusMessage: `Earned the ${badge}! The feud is settled.`,
    };
    renderApp();
    scheduleWorldSave();
  },
  onFactionJoined: (faction) => {
    rendererState = setWorldState(rendererState, overworldController.state);
    rendererState = {
      ...rendererState,
      statusMessage: faction
        ? `You ride for ${faction.title}, the ${faction.house}.`
        : "You joined a household of the Vroom.",
    };
    renderApp();
    scheduleWorldSave();
  },
  onMapTransition: () => {
    rendererState = setWorldState(rendererState, overworldController.state);
    renderOverworldUi();
    scheduleWorldSave();
  },
  onGrandRoundup: () => {
    const badges = rendererState.world.badges.length;
    const hasChampion = rendererState.hallOfFame.entries.length > 0;
    if (badges < 5) {
      rendererState = {
        ...rendererState,
        statusMessage: "The Roundup King sizes you up: five Brands first, then we ride the whole road.",
      };
      renderApp();
      return;
    }
    if (!hasChampion) {
      rendererState = {
        ...rendererState,
        statusMessage: "The Roundup King nods: 'You'll need a champion's name in the Record Barn.'",
      };
      renderApp();
      return;
    }
    if (rendererState.world.flags["grand-roundup"]) {
      rendererState = {
        ...rendererState,
        statusMessage: "The road remembers your Roundup, champion.",
      };
      renderApp();
      return;
    }

    // Win: mark it, surface the celebration, and persist.
    overworldController.setFlag("grand-roundup", true);
    rendererState = setWorldState(rendererState, overworldController.state);
    const champion = [...rendererState.hallOfFame.entries].sort(
      (a, b) => b.score - a.score,
    )[0];
    const championLine = document.querySelector<HTMLElement>("[data-grand-roundup-champion]");
    if (championLine) {
      championLine.textContent = champion
        ? `${champion.name} · ${champion.dna} · ${formatNumber(champion.score)} pts`
        : "";
    }
    if (grandRoundupOverlay) {
      grandRoundupOverlay.hidden = false;
    }
    rendererState = {
      ...rendererState,
      statusMessage: `Grand Roundup complete — ${rendererState.world.rancherName || "the new hand"}'s champion is enshrined in the Record Barn!`,
    };
    scheduleWorldSave();
    renderApp();
  },
});
let overworldAnimationToken = 0;
let overworldLoopRunning = false;

// Records board: per-terrain Test Drive bests, raced against as ghosts.
let recordsBoard: RecordsBoard = { version: 1, entries: [] };
let latestRunTerrain: string | null = null;
let latestRunScore = 0;
let latestRunDna: string | null = null;
let viewportLastElapsed = 0;

void window.vroomon.loadRecords().then((board) => {
  recordsBoard = board;
  renderRecordsBoard();
});

function renderRecordsBoard(): void {
  const entries = recordsBoard.entries;
  const terrainCount = new Set(entries.map((entry) => entry.terrainName)).size;
  for (const count of Array.from(
    document.querySelectorAll<HTMLElement>("[data-records-count]"),
  )) {
    count.textContent = String(terrainCount);
  }
  for (const list of Array.from(
    document.querySelectorAll<HTMLElement>("[data-records-list]"),
  )) {
    list.innerHTML =
      entries.length === 0
        ? `<p class="muted">No records yet — set a lap in Test Drive to plant the first flag.</p>`
        : entries
            .map(
              (entry) => `
      <div class="records-row">
        <span class="records-row__terrain">${escapeHtml(entry.terrainName)}</span>
        <span class="records-row__score">${formatNumber(entry.score)} px best</span>
        <span class="records-row__dna">${escapeHtml(entry.dna)}</span>
        <button class="records-row__drive" data-drive-record="${escapeHtml(entry.terrainName)}" type="button">Drive</button>
      </div>`,
            )
            .join("");
    for (const button of Array.from(
      list.querySelectorAll<HTMLButtonElement>("[data-drive-record]"),
    )) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const record = bestRecord(recordsBoard, button.dataset.driveRecord ?? "");
        if (!record) {
          return;
        }
        rendererState = setDraftDna(rendererState, record.dna);
        rendererState = {
          ...rendererState,
          mode: "test-drive",
          statusMessage: `Loaded the ${record.terrainName} record into Test Drive — chase the ghost.`,
        };
        renderApp();
        sfx.click();
      });
    }
  }
}

let recordsToastTimer: ReturnType<typeof setTimeout> | null = null;

function showRecordsToast(message: string): void {
  const toast = document.querySelector<HTMLElement>("[data-records-toast]");
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  if (recordsToastTimer) {
    clearTimeout(recordsToastTimer);
  }
  recordsToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function recordDraftLap(): void {
  if (latestRunScore <= 0 || !latestRunTerrain || !latestRunDna) {
    return;
  }
  const result = proposeRecord(
    recordsBoard,
    latestRunTerrain,
    latestRunDna,
    latestRunScore,
    new Date().toISOString(),
  );
  if (!result.improved) {
    return;
  }
  recordsBoard = result.board;
  void window.vroomon.saveRecords(recordsBoard);
  sfx.win();
  showRecordsToast(
    `NEW ${latestRunTerrain} RECORD — ${formatNumber(latestRunScore)} px. Chase it with the ghost!`,
  );
  renderRecordsBoard();
}

const ambience = new Ambience();

function ambienceSceneFor(
  mode: AppModeId,
  mapId: string | undefined,
): AmbienceScene {
  if (mode === "world") {
    if (mapId === "route_2" || mapId === "gym_2") return "dunes";
    if (mapId === "hills_map") return "upland";
    if (mapId === "rocky_map") return "quarry";
    if (mapId === "ice_map") return "drift";
    return "meadow";
  }
  if (mode === "menu") {
    return "menu";
  }
  return "trackside";
}

function applyAmbienceScene(): void {
  ambience.setScene(
    ambienceSceneFor(rendererState.mode, rendererState.world.currentMapId),
  );
}

const ambienceButton = document.querySelector<HTMLButtonElement>("[data-ambience-toggle]");
function renderAmbienceButton(): void {
  const settings = ambience.getSettings();
  if (ambienceButton) {
    ambienceButton.textContent =
      settings.volume === 0
        ? "🔇 Sound: off"
        : `🔊 Sound: ${settings.volume === 1 ? "low" : "med"}`;
  }
}

ambienceButton?.addEventListener("click", () => {
  const settings = ambience.getSettings();
  const nextVolume = (settings.volume + 2) % 3 as 0 | 1 | 2; // med -> low -> off -> med
  ambience.setSettings({ ...settings, enabled: nextVolume > 0, volume: nextVolume });
  sfx.click();
  renderAmbienceButton();
  renderApp();
});

window.addEventListener("pointerdown", () => ambience.unlock(), { once: true });
window.addEventListener("keydown", () => ambience.unlock(), { once: true });

let playerSettings: Settings = loadSettings();
setSfxMasterVolume(playerSettings.masterVolume);
ambience.setMasterVolume(playerSettings.masterVolume);
ambience.setSettings({
  enabled: playerSettings.ambienceEnabled,
  volume: playerSettings.ambienceVolume,
});
renderAmbienceButton();

const settingsOverlay = document.querySelector<HTMLElement>("[data-settings-overlay]");
const settingsMasterInput = document.querySelector<HTMLInputElement>("[data-settings-master]");
const transferInput = document.querySelector<HTMLTextAreaElement>("[data-save-transfer]");
const exportWorldButton = document.querySelector<HTMLButtonElement>("[data-export-world]");
const importWorldButton = document.querySelector<HTMLButtonElement>("[data-import-world]");
const exportRunButton = document.querySelector<HTMLButtonElement>("[data-export-run]");
const importRunButton = document.querySelector<HTMLButtonElement>("[data-import-run]");
const transferCopyButton = document.querySelector<HTMLButtonElement>("[data-transfer-copy]");

function syncSettingsControls(): void {
  if (settingsMasterInput) {
    settingsMasterInput.value = String(Math.round(playerSettings.masterVolume * 100));
  }
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-settings-ambient]"),
  )) {
    const value = Number(button.dataset.settingsAmbient ?? "2") as 0 | 1 | 2;
    button.setAttribute(
      "aria-pressed",
      String(playerSettings.ambienceEnabled && playerSettings.ambienceVolume === value),
    );
  }
}

function applyPlayerSettings(): void {
  setSfxMasterVolume(playerSettings.masterVolume);
  ambience.setMasterVolume(playerSettings.masterVolume);
  ambience.setSettings({
    enabled: playerSettings.ambienceEnabled,
    volume: playerSettings.ambienceVolume,
  });
  saveSettings(playerSettings);
  renderAmbienceButton();
  renderApp();
}

document.querySelector<HTMLButtonElement>("[data-open-settings]")?.addEventListener("click", () => {
  if (settingsOverlay) {
    syncSettingsControls();
    settingsOverlay.hidden = false;
  }
});
document.querySelector<HTMLButtonElement>("[data-settings-close]")?.addEventListener("click", () => {
  if (settingsOverlay) {
    settingsOverlay.hidden = true;
  }
});
settingsOverlay?.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    settingsOverlay.hidden = true;
  }
});
settingsMasterInput?.addEventListener("input", () => {
  playerSettings = {
    ...playerSettings,
    masterVolume: Math.min(1, Math.max(0, Number(settingsMasterInput.value) / 100)),
  };
  applyPlayerSettings();
});
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-settings-ambient]"),
)) {
  button.addEventListener("click", () => {
    const value = Number(button.dataset.settingsAmbient ?? "2") as 0 | 1 | 2;
    playerSettings = {
      ...playerSettings,
      ambienceEnabled: value > 0,
      ambienceVolume: value,
    };
    applyPlayerSettings();
    syncSettingsControls();
  });
}
exportWorldButton?.addEventListener("click", () => {
  const persistedExport: PersistedWorldState = {
    ...rendererState.world,
    version: 1,
    lastSavedAt: new Date().toISOString(),
  };
  const encoded = encodeWorld(persistedExport);
  if (transferInput) {
    transferInput.value = encoded;
  }
  void copyTextToClipboard(encoded);
  rendererState = { ...rendererState, statusMessage: "World export copied to your clipboard — keep it safe." };
  renderApp();
});
importWorldButton?.addEventListener("click", (event) => {
  event.preventDefault();
  const decoded = decodeWorld(transferInput?.value ?? "");
  if (!decoded) {
    rendererState = { ...rendererState, statusMessage: "That world string doesn't look right — paste a fresh export." };
    renderApp();
    return;
  }
  applyPersistedWorldToRenderer(decoded);
  rendererState = { ...rendererState, statusMessage: "World restored from the import — ride on." };
  renderApp();
});
exportRunButton?.addEventListener("click", () => {
  const encoded = encodeRun(rendererState.runState);
  if (transferInput) {
    transferInput.value = encoded;
  }
  void copyTextToClipboard(encoded);
  rendererState = { ...rendererState, statusMessage: "Run export copied to your clipboard." };
  renderApp();
});
importRunButton?.addEventListener("click", () => {
  const decoded = decodeRun(transferInput?.value ?? "");
  if (!decoded) {
    rendererState = { ...rendererState, statusMessage: "That run string doesn't look right — paste a fresh export." };
    renderApp();
    return;
  }
  void window.vroomon.saveRunState(decoded);
  rendererState = setRendererRunState(rendererState, decoded, "Run restored from the import.");
  renderApp();
});
transferCopyButton?.addEventListener("click", async () => {
  if (transferInput && transferInput.value) {
    await copyTextToClipboard(transferInput.value);
    rendererState = { ...rendererState, statusMessage: "Transfer string copied." };
    renderApp();
  }
});

void loadAmbienceSettings(); // keep settings fresh for the label

populateTerrainSelect();
renderApp();
void renderGenerationLog();
void loadHallOfFame();
void loadWorldStateFromDisk();
// Ranch upgrades are campaign progression: carry them into a fresh session
// (the run state itself stays per-generation until the player saves it).
void window.vroomon.loadUpgrades().then((upgrades) => {
  rendererState = {
    ...rendererState,
    runState: { ...rendererState.runState, upgrades: { ...upgrades } },
  };
});

function renderApp(): void {
  applyAmbienceScene();
  renderContract();
  renderPanels();
  renderRunState();

  // The generation pill and terrain select are meaningless on the menu
  // start screen and in the overworld (which has no terrain preset); hide
  // them there so the chrome only shows where it applies.
  const genPillChrome = document.querySelector<HTMLElement>("[data-viewport-gen-pill]");
  const terrainWrapChrome = document.querySelector<HTMLElement>(".top-bar__terrain");
  const hideTopChrome = rendererState.mode === "menu" || rendererState.mode === "world";
  if (genPillChrome) genPillChrome.hidden = hideTopChrome;
  if (terrainWrapChrome) terrainWrapChrome.hidden = hideTopChrome;

  const terrain = getActiveTerrain();
  const evolutionViewData =
    rendererState.mode === "evolution" ? cachedEvolutionViewData() : null;
  const ghostRecord =
    rendererState.mode === "test-drive"
      ? bestRecord(recordsBoard, terrain.name)?.dna ?? null
      : null;
  const testDriveViewData =
    rendererState.mode === "test-drive" || rendererState.mode === "menu"
      ? cachedTestDriveViewData(rendererState.draftDna, terrain.name, ghostRecord)
      : null;

  renderDiagnostics(terrain, evolutionViewData, testDriveViewData);
  renderStage(terrain, evolutionViewData, testDriveViewData);
  renderSidebarCopy(evolutionViewData, testDriveViewData);
  statusMessage.textContent = rendererState.statusMessage;
  syncRunConfigSelects();
  renderBatchProgress();
  renderHallOfFame();
  renderMenuConsoleStats();
  renderStatsHud();
  if (rendererState.mode === "menu") {
    syncRancherCard();
  }

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
  // Show/hide the floating vehicle focus strip and its "save selected"
  // row together (hidden when no ranked vehicles).
  const hasRankedVehicles = evolutionViewData.rankedVehicles.length > 0;
  const vehicleStrip = document.querySelector<HTMLElement>("[data-vehicle-strip]");
  if (vehicleStrip) {
    vehicleStrip.hidden = !hasRankedVehicles;
  }
  const saveSelectedRow = document.querySelector<HTMLElement>("[data-save-selected-row]");
  if (saveSelectedRow) {
    saveSelectedRow.hidden = !hasRankedVehicles;
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
      "[data-viewport-actions-overlay],[data-viewport-hof-overlay],[data-viewport-dpad-overlay],[data-viewport-menu-overlay],[data-viewport-status-overlay],[data-viewport-chart-overlay]",
    ),
  );
  for (const wrapper of overlayWrappers) {
    if (wrapper.hasAttribute("data-viewport-menu-overlay")) {
      // Menu overlays additionally respect the selected variant (?menu=a|b).
      wrapper.hidden = !(
        rendererState.mode === "menu" &&
        wrapper.dataset.menuVariant === MENU_VARIANT
      );
      continue;
    }
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
        `<button class="focus-chip ${rendererState.selectedVehicleId === vehicle.id ? "active" : "ghost"}" type="button" data-select-vehicle="${escapeHtml(
          vehicle.id,
        )}" title="Score ${formatNumber(vehicle.score)}"><span class="focus-chip__id">${escapeHtml(
          vehicle.id,
        )}</span><span class="focus-chip__score">${formatNumber(vehicle.score)}</span></button>`,
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
            vehicle.id === rankedVehicles[0]?.id
              ? "leader"
              : vehicle.id === selectedVehicleId
                ? "selected"
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
  ghostDna: string | null = null,
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
  const draftLabel = rendererState.mode === "menu" ? "Preview" : "Draft car";
  const frames =
    ghostDna && ghostDna !== cleanedDna
      ? retimeViewportFrames(
          window.vroomon
            .previewPopulationRaceFrames(
              {
                ...rendererState.runState,
                mode: "test-drive",
                population: [
                  { id: "draft-car", dna: cleanedDna, parents: [], mutated: false, score: 0 },
                  { id: "record-ghost", dna: ghostDna, parents: [], mutated: false, score: 0 },
                ],
              },
              stepCount,
              frameCount,
            )
            .map((frame) => ({
              elapsedMs: frame.elapsedMs,
              entities: frame.vehicles
                .filter(
                  (vehicle) =>
                    vehicle.id === "draft-car" || vehicle.id === "record-ghost",
                )
                .map(
                  (vehicle) =>
                    ({
                      id: vehicle.id,
                      label: vehicle.id === "draft-car" ? draftLabel : "RECORD",
                      snapshot: vehicle,
                      variant: vehicle.id === "draft-car" ? "solo" : "ghost",
                      initialCenterX: vehicle.initialCenterX,
                    }) satisfies ViewportEntity,
                ),
            })),
          playbackDurationMs,
        )
      : retimeViewportFrames(
          window.vroomon
            .previewPhysicsFrames(cleanedDna, terrainName, stepCount, frameCount)
            .map((frame) => ({
              elapsedMs: frame.elapsedMs,
              entities: [
                {
                  id: "draft-car",
                  label: draftLabel,
                  snapshot: frame.snapshot,
                  variant: "solo",
                } satisfies ViewportEntity,
              ],
            })),
          playbackDurationMs,
        );

  // Lap telemetry for the records board: how far the draft got on this
  // terrain over the whole race window.
  const draftXs = frames
    .map(
      (frame) =>
        frame.entities.find((entity) => entity.id === "draft-car")?.snapshot
          .centerX ?? 0,
    )
    .filter((value) => value > 0);
  latestRunScore =
    draftXs.length > 1
      ? Math.max(0, Math.round(draftXs[draftXs.length - 1]! - draftXs[0]!))
      : 0;
  latestRunTerrain = terrainName;
  latestRunDna = cleanedDna;

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
    viewportLastElapsed = 0;
    return;
  }

  const start = performance.now();
  viewportLastElapsed = 0;

  const step = (now: number): void => {
    if (token !== viewportAnimationToken) {
      return;
    }

    const elapsed = (now - start) % totalDuration;
    // A wrap back to frame 0 = one completed lap. In test-drive mode that
    // is the moment the draft's run is finished enough to judge.
    if (elapsed < viewportLastElapsed - 100 && rendererState.mode === "test-drive") {
      recordDraftLap();
    }
    viewportLastElapsed = elapsed;
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

interface ViewportLabelLayout {
  label: string;
  slotY: number;
  labelX: number;
  showTravel: boolean;
  leaderLine: { x1: number; y1: number; x2: number; y2: number } | null;
}

// Assign each racer a label slot that never collides with another label.
// Solo previews keep the label directly above the car; race labels cascade
// top-down in score order (full distance readout only for the vehicles the
// player cares about) and a leader line links a slot back to its car when the
// label sits somewhere else than straight above it.
function layoutViewportLabels(
  entities: ViewportEntity[],
  view: ViewportWindow,
): Map<string, ViewportLabelLayout> {
  const layout = new Map<string, ViewportLabelLayout>();

  if (entities.length === 1 && entities[0]?.variant === "solo") {
    const entity = entities[0];
    const originY = toSvgY(view, entity.snapshot.centerY);
    layout.set(entity.id, {
      label: entity.label,
      slotY: Math.max(22, originY - 58),
      labelX: clampLabelX(toSvgX(view, entity.snapshot.centerX)),
      showTravel: true,
      leaderLine: null,
    });
    return layout;
  }

  const ranked = [...entities].sort(
    (left, right) => (right.score ?? 0) - (left.score ?? 0),
  );
  // 30px rows (17px text + margin) so a focused row's subtitle and the
  // racer line that starts under a slot never collide with the next row.
  const SLOT_STEP = 30;
  const clampOccupancy = new Map<number, number>();
  let nextSlotY = 22;

  for (const [rankIndex, entity] of ranked.entries()) {
    const originX = toSvgX(view, entity.snapshot.centerX);
    const originY = toSvgY(view, entity.snapshot.centerY);
    const slotY = Math.max(22, nextSlotY);
    let labelX = clampLabelX(originX);
    // Label lines that would all stack at an exact clamp edge get fanned
    // horizontally so each still reads as belonging to its own car.
    if (labelX === 62 || labelX === SVG_WIDTH - 62) {
      const occupants = clampOccupancy.get(labelX) ?? 0;
      clampOccupancy.set(labelX, occupants + 1);
      labelX += (occupants % 2 === 0 ? 16 : -16) * (Math.floor(occupants / 2) + 1);
      labelX = Math.min(SVG_WIDTH - LABEL_EDGE_PADDING, Math.max(LABEL_EDGE_PADDING, labelX));
    }
    const tail = entity.id.includes("-")
      ? entity.id.split("-").pop() ?? entity.id
      : entity.id;
    const isFocused =
      entity.variant === "leader" || entity.variant === "selected";
    const labelBaseY = originY - 58;
    // Anchor the leader line to the top of the vehicle's body bboxes (not
    // their centers) AND to the x of whichever part is actually the
    // topmost — sprawling multi-blob cars often have their topmost piece
    // off to one side, not under the center.
    let bodyTopY = Infinity;
    let bodyTopX = originX;
    const bodyParts = [
      ...entity.snapshot.chassis.map((vehicleBody) => ({
        x: vehicleBody.x,
        top: vehicleBody.y - (vehicleBody.height ?? 0) / 2,
      })),
      ...entity.snapshot.wheels.map((vehicleBody) => ({
        x: vehicleBody.x,
        top: vehicleBody.y - (vehicleBody.radius ?? 0),
      })),
    ];
    for (const part of bodyParts) {
      if (part.top < bodyTopY) {
        bodyTopY = part.top;
        bodyTopX = part.x;
      }
    }
    const bodyTop = toSvgY(view, bodyTopY);
    const bodyTopSvgX = toSvgX(view, bodyTopX);
    // The line starts below the tower (and below the focused metric row),
    // and only exists when it actually reaches the car.
    const lineStartY = slotY + SLOT_STEP + (isFocused ? 23 : 6);
    const leaderLine =
      lineStartY < bodyTop - 2 && Math.abs(slotY - labelBaseY) > 16
        ? {
            x1: labelX,
            y1: lineStartY,
            x2: Math.min(SVG_WIDTH - 6, Math.max(6, bodyTopSvgX)),
            y2: bodyTop - 2,
          }
        : null;
    // A focused label also carries a 12px travel subtitle; keep the next
    // slot clear of it so the metric never shares a row with the following
    // rank's label.
    nextSlotY = slotY + SLOT_STEP + (isFocused ? 17 : 0);

    layout.set(entity.id, {
      label: `#${rankIndex + 1} · ${tail}`,
      slotY,
      labelX,
      showTravel: isFocused,
      leaderLine,
    });
  }

  return layout;
}

function clampLabelX(labelX: number): number {
  return Math.min(
    SVG_WIDTH - LABEL_EDGE_PADDING,
    Math.max(LABEL_EDGE_PADDING, labelX),
  );
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
  const labelLayout = layoutViewportLabels(frame.entities, view);
  const vehicleMarkup = frame.entities
    .map((entity) => renderViewportEntity(entity, terrain, view, labelLayout))
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
  const edge = "rgba(16, 26, 36, 0.55)";
  const parts: string[] = [];

  for (let index = 0; index < terrain.obstacleCount; index += 1) {
    const height = terrain.obstacleHeightBase + terrain.obstacleHeightStep * index;
    const x = 600 + index * 300;
    const y = terrain.groundHeight - height;
    const gradId = `obstacle-grad-${index}`;
    // A soft vertical gradient + dark edge makes the slab read as a solid
    // boulder instead of an untextured placeholder.
    parts.push(
      `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${hexLighten(fill, 16)}"></stop>` +
        `<stop offset="1" stop-color="${fill}"></stop></linearGradient></defs>` +
        `<rect x="${toSvgX(view, x)}" y="${toSvgY(view, y)}" width="${
          terrain.obstacleWidth * view.scaleX
        }" height="${height * view.scaleY}" rx="12" fill="url(#${gradId})" stroke="${edge}" stroke-width="3"></rect>` +
        `<rect x="${toSvgX(view, x) + 10}" y="${toSvgY(view, y) + 10}" width="${
          terrain.obstacleWidth * view.scaleX - 20
        }" height="${Math.max(6, height * view.scaleY * 0.22)}" rx="8" fill="rgba(255,255,255,0.08)"></rect>` +
        `<rect x="${toSvgX(view, x) - 6}" y="${toSvgY(view, terrain.groundHeight)}" width="${
          terrain.obstacleWidth * view.scaleX + 12
        }" height="10" rx="5" fill="rgba(16, 26, 36, 0.38)"></rect>`,
    );
  }

  return parts.join("");
}

function hexLighten(hex: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    return hex;
  }
  const num = parseInt(match[1] ?? "000000", 16);
  const r = Math.min(255, ((num >> 16) & 255) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

function renderViewportEntity(
  entity: ViewportEntity,
  terrain: TerrainPresetDefinition,
  view: ViewportWindow,
  labelLayout: Map<string, ViewportLabelLayout>,
): string {
  const accent =
    entity.variant === "leader"
      ? { fill: PAL.accent.gold, stroke: "#fff4d1" }
      : entity.variant === "selected"
        ? { fill: PAL.accent.blue, stroke: "#f8fbff" }
        : entity.variant === "ghost"
          ? { fill: "#7fe9d0", stroke: "#a8f3e4" }
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
  const layout = labelLayout.get(entity.id);
  const labelTint =
    entity.variant === "leader"
      ? PAL.accent.gold
      : entity.variant === "selected"
        ? PAL.accent.blue
        : entity.variant === "ghost"
          ? "#7fe9d0"
          : "#f8fbff";
  const labelClass =
    entity.variant === "leader"
      ? "viewport-label viewport-label--leader"
      : entity.variant === "selected"
        ? "viewport-label viewport-label--selected"
        : entity.variant === "ghost"
          ? "viewport-label viewport-label--ghost"
          : "viewport-label";
  const labelMarkup = layout
    ? `
      ${
        layout.leaderLine
          ? `<line class="viewport-label-leaderline" x1="${layout.leaderLine.x1}" y1="${layout.leaderLine.y1}" x2="${layout.leaderLine.x2}" y2="${layout.leaderLine.y2}" stroke="${labelTint}" stroke-dashoffset="${(
              (6 - (Math.hypot(layout.leaderLine.x2 - layout.leaderLine.x1, layout.leaderLine.y2 - layout.leaderLine.y1) % 6)) % 6
            ).toFixed(0)}"></line>
      <circle class="viewport-label-dot" cx="${layout.leaderLine.x2}" cy="${layout.leaderLine.y2}" r="3.5"></circle>`
          : ""
      }
      <text class="${labelClass}" x="${layout.labelX}" y="${layout.slotY}" text-anchor="middle">${escapeHtml(
        layout.label,
      )}</text>${
        layout.showTravel
          ? `<text class="viewport-subtitle" x="${layout.labelX}" y="${layout.slotY + 17}" text-anchor="middle" fill="${labelTint}">${escapeHtml(
              travel,
            )}</text>`
          : ""
      }`
    : "";

  return `
    <g data-viewport-vehicle="${escapeHtml(entity.id)}">
      ${trail}
      ${constraintMarkup}
      ${bodyMarkup}
      ${labelMarkup}
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
    // Tire (dark) + hub (accent) so wheels read as wheels, not pale blobs.
    return (
      `<circle cx="${x}" cy="${y}" r="${radius}" fill="#22282f" stroke="rgba(8, 12, 18, 0.55)" stroke-width="2.5"></circle>` +
      `<circle cx="${x}" cy="${y}" r="${Math.max(2, radius * 0.55)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"></circle>`
    );
  }

  const width = (body.width ?? 18) * view.scaleX;
  const height = (body.height ?? 12) * view.scaleY;
  const angle = (body.angle * 180) / Math.PI;
  // Dark outline keeps neighbouring cars from merging (light strokes + white
  // constraint lines previously blurred every body into one blob).
  return `<rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="8" fill="${fill}" stroke="rgba(16, 24, 34, 0.7)" stroke-width="2.5" transform="rotate(${angle} ${x} ${y})"></rect>`;
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

  const chartMarkup = `
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
  scoreChartElement.innerHTML = chartMarkup;
  // Mirror the chart into the visible "HERD TREND" panel in evolution mode.
  for (const panel of Array.from(
    document.querySelectorAll<HTMLElement>("[data-viewport-score-chart]"),
  )) {
    panel.innerHTML = chartMarkup;
  }
}

function loadHallEntryIntoTestDrive(entryId: string): void {
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
}

function renderStatsHud(): void {
  // Player-facing stat chips, top-left under the top bar. Content is
  // mode-scoped; the menu has its own start screen and shows nothing.
  const overlay = document.querySelector<HTMLElement>("[data-viewport-stats-overlay]");
  if (!overlay) {
    return;
  }

  const mode = rendererState.mode;
  if (mode === "menu") {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;

  const wallet = `${rendererState.runState.wallet} cr`;
  const generation = String(rendererState.runState.generation);
  const hallSorted = [...rendererState.hallOfFame.entries].sort(
    (left, right) => right.score - left.score,
  );
  const hallTop = hallSorted[0] ?? null;
  const evolutionBest =
    rendererState.scoreHistory.at(-1)?.bestScore ??
    (rendererState.latestGeneration?.evaluatedPopulation.reduce(
      (best, entry) => Math.max(best, entry.score),
      0,
    ) ?? 0);

  const chips: Array<{ label: string; value: string }> = [];
  let questCardHtml = "";

  if (mode === "evolution") {
    chips.push({ label: "BEST", value: evolutionBest > 0 ? formatNumber(evolutionBest) : "—" });
    const lastMean = rendererState.scoreHistory.at(-1)?.meanScore;
    chips.push({ label: "MEAN", value: lastMean !== undefined ? formatNumber(lastMean) : "—" });
    // Ranch upgrades resize the herd past the base config — surface the
    // effective numbers so the selects (base values) don't read as a lie.
    const effectivePop = effectiveRunConfig(
      rendererState.runState.config,
      rendererState.runState.upgrades,
    ).populationSize;
    chips.push({ label: "HERD", value: String(effectivePop) });
    chips.push({ label: "POP", value: String(rendererState.runState.population.length) });
    chips.push({ label: "GEN", value: generation });
    const ownedTiers = Object.values(rendererState.runState.upgrades ?? {}).reduce(
      (sum, level) => sum + level,
      0,
    );
    if (ownedTiers > 0) {
      chips.push({ label: "RANCH", value: `L${ownedTiers}` });
    }
    chips.push({ label: "WALLET", value: wallet });
  } else if (mode === "world") {
    const map = getMap(rendererState.world.currentMapId);
    chips.push({ label: "MAP", value: map?.name ?? "—" });
    const quest = questFor(rendererState.world);
    questCardHtml = `
      <div class="stats-quest" data-stats-quest>
        <div class="stats-quest__line" data-stats-quest-line>${escapeHtml(quest.main)}</div>
        <div class="stats-quest__hint" data-stats-quest-hint>${escapeHtml(quest.hint)}</div>
      </div>`;
    chips.push({
      label: "HOUSES",
      value: String(Object.keys(rendererState.world.factionChoices).length),
    });
    chips.push({
      label: "BRANDS",
      value: `${rendererState.world.badges.length}/5`,
    });
    chips.push({
      label: "HERD",
      value: `${rendererState.world.vroomdex.length} ${rendererState.world.vroomdex.length === 1 ? "specimen" : "specimens"}`,
    });
    chips.push({ label: "WALLET", value: wallet });
  } else if (mode === "test-drive") {
    chips.push({ label: "HOF TOP", value: hallTop ? formatNumber(hallTop.score) : "—" });
    chips.push({ label: "GEN", value: generation });
    chips.push({ label: "WALLET", value: wallet });
  }

  overlay.innerHTML =
    chips
      .map(
        (chip) =>
          `<div class="stats-chip"><span class="stats-chip__label">${chip.label}</span><span class="stats-chip__value">${escapeHtml(
            chip.value,
          )}</span></div>`,
      )
      .join("") + questCardHtml;
}

function renderMenuConsoleStats(): void {
  // Console variant's readout only exists in the menu markup; no-op elsewhere.
  const gen = document.querySelector<HTMLElement>("[data-menu-gen]");
  if (gen) {
    gen.textContent = String(rendererState.runState.generation);
  }
  const wallet = document.querySelector<HTMLElement>("[data-menu-wallet]");
  if (wallet) {
    wallet.textContent = String(rendererState.runState.wallet);
  }
  const best = document.querySelector<HTMLElement>("[data-menu-best]");
  if (best) {
    const lastScore = rendererState.scoreHistory.at(-1)?.bestScore;
    best.textContent = lastScore !== undefined ? formatNumber(lastScore) : "—";
  }
}

function renderHallOfFame(): void {
  const entries = rendererState.hallOfFame.entries;
  const emptyMarkup = `<p class="muted">No vehicles in the Hall of Fame yet. Save top cars from evolution mode.</p>`;
  const testDriveEmptyMarkup = `<p class="muted">No vehicles in the Hall of Fame yet.</p>`;

  // Floating HoF summary card (bottom-right overlay in test-drive mode).
  if (hofCount) {
    hofCount.textContent = String(entries.length);
  }
  for (const count of Array.from(
    document.querySelectorAll<HTMLElement>("[data-menu-hof-count]"),
  )) {
    count.textContent = String(entries.length);
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

  for (const menuList of Array.from(
    document.querySelectorAll<HTMLElement>("[data-menu-hall-list]"),
  )) {
    menuList.innerHTML = `<p class="muted">No vehicles yet — save top cars from evolution mode.</p>`;
  }

  if (entries.length === 0) {
    hallOfFameElement.innerHTML = emptyMarkup;
    hallOfFameTestDriveElement.innerHTML = testDriveEmptyMarkup;
    return;
  }

  const sortedEntries = entries
    .slice()
    .sort((left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) || right.score - left.score)
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
        ${showRemove ? `<button class="hall-entry__fav" data-hall-fav="${escapeHtml(entry.id)}" type="button" title="${entry.favorite ? "Unpin favorite" : "Pin as favorite"}">${entry.favorite ? "★" : "☆"}</button>` : ""}
        ${showRemove ? `<button class="hall-entry__stud" data-hall-stud="${escapeHtml(entry.id)}" type="button" title="Add to / remove from the Split-Pen stud line">${studLineCapacity(rendererState.runState.upgrades) > 0 ? (isStudLineEntry(entry.id) ? "STUD" : "stud") : "—"}</button>` : ""}
        ${showRemove ? `<button class="hall-entry__copy" data-hall-copy="${escapeHtml(entry.id)}" type="button" title="Copy the DNA string">Copy</button>` : ""}
        ${showRemove ? `<button class="hall-entry__line" data-hall-line="${escapeHtml(entry.id)}" type="button" title="Browse the family line">Line</button>` : ""}
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
  for (const menuList of Array.from(
    document.querySelectorAll<HTMLElement>("[data-menu-hall-list]"),
  )) {
    menuList.innerHTML = sortedEntries
      .map((entry) => buildEntryHtml(entry, true))
      .join("");
    bindHallEntryActions(menuList);
  }

  bindHallEntryActions(hallOfFameElement);
  bindHallEntryActions(hallOfFameTestDriveElement);

function bindHallEntryActions(scope: HTMLElement): void {
  for (const entry of Array.from(
    scope.querySelectorAll<HTMLElement>("[data-hall-entry]"),
  )) {
    entry.addEventListener("click", () => {
      loadHallEntryIntoTestDrive(entry.dataset.hallEntry ?? "");
    });
  }

    for (const remove of Array.from(
      scope.querySelectorAll<HTMLButtonElement>("[data-hall-remove]"),
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
      scope.querySelectorAll<HTMLButtonElement>("[data-hall-rename]"),
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

    for (const fav of Array.from(
      scope.querySelectorAll<HTMLButtonElement>("[data-hall-fav]"),
    )) {
      fav.addEventListener("click", async (event) => {
        event.stopPropagation();
        const entryId = fav.dataset.hallFav ?? "";
        const entry = rendererState.hallOfFame.entries.find(
          (candidate) => candidate.id === entryId,
        );
        if (!entry) {
          return;
        }
        const updated = { ...entry, favorite: !entry.favorite };
        rendererState = {
          ...rendererState,
          hallOfFame: {
            ...rendererState.hallOfFame,
            entries: rendererState.hallOfFame.entries.map((candidate) =>
              candidate.id === entryId ? updated : candidate,
            ),
          },
        };
        await window.vroomon.saveHallOfFame(rendererState.hallOfFame);
        sfx.click();
        renderApp();
      });
    }

    for (const stud of Array.from(
      scope.querySelectorAll<HTMLButtonElement>("[data-hall-stud]"),
    )) {
      stud.addEventListener("click", async (event) => {
        event.stopPropagation();
        const entryId = stud.dataset.hallStud ?? "";
        const capacity = studLineCapacity(rendererState.runState.upgrades);
        if (capacity <= 0) {
          rendererState = {
            ...rendererState,
            statusMessage: "Buy The Split in the RANCH store to open a stud line.",
          };
          renderApp();
          return;
        }
        const penIds = rendererState.runState.penIds ?? [];
        const has = penIds.includes(entryId);
        const next = has
          ? penIds.filter((id) => id !== entryId)
          : [...penIds, entryId];
        if (next.length > capacity) {
          rendererState = {
            ...rendererState,
            statusMessage: `The Split holds ${capacity} stud slots — remove one first.`,
          };
          renderApp();
          sfx.deny();
          return;
        }
        rendererState = {
          ...rendererState,
          runState: { ...rendererState.runState, penIds: next },
        };
        await window.vroomon.saveRunState(rendererState.runState);
        rendererState = {
          ...rendererState,
          statusMessage: has
            ? "Removed from the stud line."
            : `Added to the stud line (${next.length}/${capacity}).`,
        };
        renderApp();
        playRanchSound("coin");
      });
    }

    for (const copyButton of Array.from(
      scope.querySelectorAll<HTMLButtonElement>("[data-hall-copy]"),
    )) {
      copyButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        const entryId = copyButton.dataset.hallCopy ?? "";
        const entry = rendererState.hallOfFame.entries.find(
          (candidate) => candidate.id === entryId,
        );
        if (!entry) {
          return;
        }
        const ok = await copyTextToClipboard(entry.dna);
        rendererState = {
          ...rendererState,
          statusMessage: ok
            ? `Copied ${entry.name}'s DNA — paste it into Test Drive or seed another herd.`
            : "Could not copy the DNA string.",
        };
        renderApp();
      });
    }

    for (const lineButton of Array.from(
      scope.querySelectorAll<HTMLButtonElement>("[data-hall-line]"),
    )) {
      lineButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openLineage(lineButton.dataset.hallLine ?? "");
      });
    }
  }
}

function isStudLineEntry(id: string): boolean {
  return (rendererState.runState.penIds ?? []).includes(id);
}

function lineageName(id: string): string {
  const hallEntry = rendererState.hallOfFame.entries.find(
    (candidate) => candidate.id === id,
  );
  if (hallEntry) {
    return `${hallEntry.name} · ${formatNumber(hallEntry.score)} pts`;
  }
  const live = rendererState.runState.population.find(
    (candidate) => candidate.id === id,
  );
  if (live) {
    return `herd line #${id.slice(-5)}`;
  }
  return "wild stock";
}

function openLineage(entryId: string): void {
  const entry = rendererState.hallOfFame.entries.find(
    (candidate) => candidate.id === entryId,
  );
  if (!entry || !lineageOverlay || !lineageTitle || !lineageRows || !lineageSub) {
    return;
  }
  lineageTitle.textContent = entry.name;
  const ancestors = entry.line ?? [];
  const generationLabels = ["parents", "grandparents", "great-grandparents", "3rd gen"];
  lineageRows.innerHTML =
    ancestors.length === 0
      ? `<div class="lineage-card__row muted">Wild-born stock — no captured ancestors.</div>`
      : ancestors
          .map((ancestorId, index) => {
            const label = generationLabels[Math.min(index, generationLabels.length - 1)];
            return `<div class="lineage-card__row"><span class="lineage-card__gen">${label}</span><span class="lineage-card__who">${escapeHtml(lineageName(ancestorId))}</span></div>`;
          })
          .join("");
  const descendants = (rendererState.runState.genealogy[entryId] ?? []).length;
  lineageSub.textContent =
    ancestors.length === 0
      ? "Names resolve against the Record Barn and the current herd."
      : `${descendants} live descendant${descendants === 1 ? "" : "s"} in the current herd. Names resolve against the Record Barn and the current herd.`;
  lineageOverlay.hidden = false;
  sfx.click();
}

function formatSavedAt(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
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

function applyPersistedWorldToRenderer(persisted: PersistedWorldState): void {
  const restored = applyPersistedWorld(overworldController.state, persisted);
  overworldController._setState(restored);
  rendererState = setWorldState(rendererState, restored);
  void window.vroomon.saveWorldState(persisted);
  void renderGenerationLog();
}

function applyPersistedWorld(
  world: WorldState,
  persisted: { currentMapId: string; playerX: number; playerY: number; playerFacing: Direction; badges: string[]; factionChoices?: Record<string, string>; decor?: string[]; rancherName?: string; rancherCap?: "navy" | "rust" | "green"; vroomdex: string[]; flags: Record<string, boolean> },
): WorldState {
  const mapExists = getMap(persisted.currentMapId) !== undefined;
  return {
    ...world,
    currentMapId: mapExists ? persisted.currentMapId : world.currentMapId,
    playerX: Number.isFinite(persisted.playerX) ? persisted.playerX : world.playerX,
    playerY: Number.isFinite(persisted.playerY) ? persisted.playerY : world.playerY,
    playerFacing: persisted.playerFacing ?? world.playerFacing,
    badges: Array.isArray(persisted.badges) ? persisted.badges : world.badges,
    factionChoices:
      persisted.factionChoices && typeof persisted.factionChoices === "object"
        ? persisted.factionChoices
        : world.factionChoices,
    decor: Array.isArray(persisted.decor) ? persisted.decor : world.decor,
    rancherName: typeof persisted.rancherName === "string" ? persisted.rancherName : world.rancherName,
    rancherCap: persisted.rancherCap === "rust" || persisted.rancherCap === "green"
      ? persisted.rancherCap
      : "navy",
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
  // Serialize the renderer's world (kept in sync with the controller on
  // every change) — this also carries decor purchases, which live only in
  // renderer state.
  const world = rendererState.world;
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
    factionChoices: { ...world.factionChoices },
    decor: [...world.decor],
    rancherName: world.rancherName,
    rancherCap: world.rancherCap,
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
    name: `${summary.id}`,
    score: summary.score,
    terrainName: rendererState.runState.terrainName,
    generation: rendererState.runState.generation,
    savedAt: new Date().toISOString(),
    notes: "",
    line: captureLineage(rendererState.runState.population, summary.id, 4),
  };

  rendererState = addHallOfFameEntry(rendererState, entry);
  await window.vroomon.saveHallOfFame(rendererState.hallOfFame);
  rendererState = {
    ...rendererState,
    statusMessage: `Saved ${entry.name} to Hall of Fame (${formatNumber(entry.score)} points).`,
  };
  renderApp();
}

function renderDialogueOptions(dialogue: { options?: Array<{ next: string; label: string }> }): void {
  if (!dialogue.options || dialogue.options.length === 0) {
    overworldDialogueOptions.innerHTML = "";
    return;
  }
  overworldDialogueOptions.innerHTML = dialogue.options
    .map(
      (option) => `<button type="button" data-dialogue-option="${escapeHtml(option.next)}">${escapeHtml(option.label)}</button>`,
    )
    .join("");
  for (const button of Array.from(
    overworldDialogueOptions.querySelectorAll<HTMLButtonElement>("[data-dialogue-option]"),
  )) {
    button.addEventListener("click", () => {
      const nextId = button.dataset.dialogueOption ?? "";
      // Dialogue options reference NPC ids in the current map (matching
      // the non-option "next" flow). The old text-matching lookup never
      // matched, so ANY option click silently ended the scene — the
      // faction joins and Professor Axle's explain options were dead.
      const target = overworldController._resolveDialogue(nextId);
      if (target) {
        const advanced = advanceWorldDialogue(overworldController.state, nextId, target);
        overworldController._setState(advanced);
        renderOverworldUi();
        renderStatsHud();
      } else {
        const ended = endWorldDialogue(overworldController.state, null, null);
        overworldController._setState(ended);
        renderOverworldUi();
        renderStatsHud();
      }
    });
  }
}

let typewriterTimer: ReturnType<typeof setTimeout> | null = null;
let dialogueTyping = false;
let typingDialogue: { text: string; options?: Array<{ next: string; label: string }> } | null = null;
let revealedChars = 0;
let lastDialogueSignature = "";

let typingLineText = "";

function cancelTypewriter(): void {
  if (typewriterTimer !== null) {
    clearTimeout(typewriterTimer);
    typewriterTimer = null;
  }
}

/** Complete the typewriter; returns true when the beat had options (callers
 * must not advance past an option dialogue). */
function completeDialogueTyping(): boolean {
  const hadOptions = (typingDialogue?.options?.length ?? 0) > 0;
  cancelTypewriter();
  dialogueTyping = false;
  if (typingDialogue) {
    overworldDialogueText.textContent = typingDialogue.text;
    typingDialogue = null;
  }
  return hadOptions;
}


function renderOverworldUi(): void {
  const world = overworldController.state;
  rendererState = setWorldState(rendererState, world);

  const map = getMap(world.currentMapId);
  const currentDialogue = world.dialogueQueue[0] ?? null;
  const activeNpc = map?.npcs.find((npc) => npc.id === world.activeNpc) ?? null;

  if (currentDialogue) {
    overworldDialogue.hidden = false;
    const dialogueName = activeNpc?.name ?? "Narrator";
    overworldDialogueName.textContent = dialogueName;
    if (overworldDialoguePortrait) {
      overworldDialoguePortrait.innerHTML = portraitSvgFor(
        activeNpc?.id ?? null,
        dialogueName,
      );
    }
    const signature = `${currentDialogue.text}|${currentDialogue.options?.length ?? 0}`;
    if (signature !== lastDialogueSignature) {
      lastDialogueSignature = signature;
      typingDialogue = currentDialogue;
      typingLineText = currentDialogue.text;
      dialogueTyping = true;
      revealedChars = 0;
      overworldDialogueText.textContent = "";
      // Options render right away so interaction never waits on the
      // typewriter (mobile/busy players keep the old snappy feel).
      renderDialogueOptions(currentDialogue);
      cancelTypewriter();
      const tick = (): void => {
        if (!typingDialogue || revealedChars >= typingDialogue.text.length) {
          dialogueTyping = false;
          typingDialogue = null;
          return;
        }
        revealedChars = Math.min(
          typingDialogue.text.length,
          revealedChars + (typingDialogue.text.length > 100 ? 3 : 2),
        );
        overworldDialogueText.textContent = typingDialogue.text.slice(0, revealedChars);
        typewriterTimer = setTimeout(tick, 11);
      };
      typewriterTimer = setTimeout(tick, 11);
    }
  } else {
    overworldDialogue.hidden = true;
    overworldDialogueName.textContent = "";
    overworldDialogueText.textContent = "";
    overworldDialogueOptions.innerHTML = "";
    cancelTypewriter();
    dialogueTyping = false;
    typingDialogue = null;
    lastDialogueSignature = "";
    if (overworldDialoguePortrait) {
      overworldDialoguePortrait.innerHTML = "";
    }
  }

  const joinedHouses = Object.keys(world.factionChoices).length;
  if (world.badges.length === 0 && joinedHouses === 0) {
    overworldBadgeList.innerHTML =
      `<li class="muted">No brands yet. Ride for the Meadow Elder or the Roundup King.</li>`;
  } else {
    const houseLine =
      joinedHouses > 0
        ? `<li>Houses: ${Object.values(world.factionChoices)
            .map((id) => findFaction(id)?.title ?? id)
            .join(", ")}</li>`
        : "";
    overworldBadgeList.innerHTML =
      world.badges.map((badge) => `<li>${escapeHtml(badge)}</li>`).join("") +
      houseLine;
  }
  overworldVroomdexCount.textContent = `${world.vroomdex.length} specimen${world.vroomdex.length === 1 ? "" : "s"} recorded in your Herd Book`;
    if (rendererState.mode === "world" && !world.flags["opening-seen"]) {
    // Only on a real world entry — applyPersistedWorld also calls
    // renderOverworldUi (once per boot), and must not consume the beat.
    overworldController.setFlag("opening-seen", true);
    // Re-sync the renderer's world copy so the flag persists, and write
    // the status DOM directly (renderApp already set it moments ago).
    rendererState = setWorldState(rendererState, overworldController.state);
    rendererState = {
      ...rendererState,
      statusMessage: "The road carries you to Starter Town. The meadow needs a new hand.",
    };
    statusMessage.textContent = rendererState.statusMessage;
    scheduleWorldSave();
  }
  const inStarterTown = map?.id === "starter_town";
  overworldSummary.textContent =
    !world.flags["met-axle"] && inStarterTown
      ? "Professor Axle is at the schoolhouse — talk to him (Z) to start your road."
      : `You're in ${map?.name ?? "the Vroom"}. Use arrow keys to walk and Z to talk to people.`;

  startOverworldAnimationLoop();
}

function startOverworldAnimationLoop(): void {
  // Guard on a boolean, not the token value: renderApp() calls
  // stopOverworldAnimationLoop() on every non-world render, so the old
  // `token !== 0` guard was permanently truthy after boot — the loop
  // never started and the overworld canvas stayed blank on every launch.
  if (overworldLoopRunning) {
    return;
  }
  overworldLoopRunning = true;
  const token = ++overworldAnimationToken;
  const tick = (): void => {
    if (!overworldLoopRunning || token !== overworldAnimationToken) {
      return;
    }
    const map = getMap(overworldController.state.currentMapId);
    if (map) {
      try {
        renderOverworld(overworldCanvas, {
          map,
          world: overworldController.state,
          decor: rendererState.world.decor,
          tick: performance.now(),
        });
      } catch (error) {
        // One bad frame must not kill the loop for good.
        console.error("[overworld] render failed:", error);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopOverworldAnimationLoop(): void {
  overworldLoopRunning = false;
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
      if (dialogueTyping) {
        const hadOptions = completeDialogueTyping();
        overworldDialogueText.textContent = typingLineText;
        if (hadOptions) {
          return;
        }
      }
      overworldController.advanceDialogue();
      renderOverworldUi();
      renderStatsHud();
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
  if (!window.confirm("Reset overworld progress? This wipes your brands, Herd Book, and position.")) {
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
    const mapName = getMap(overworldController.state.currentMapId)?.name ?? "the road";
    const rivalName = mapForDialog(trainerName);
    showRaceCard(
      "FEUD RACE",
      `${mapName}: the rival herd crossed at x=${formatNumber(result.centerX)}.`,
      rivalryLine(mapName),
      true,
    );
    rendererState = {
      ...rendererState,
      statusMessage: `${mapName} feud race — rival herd crossed at x=${formatNumber(result.centerX)}. The law of the road is yours.`,
    };
    if ((overworldController as unknown as { _awardBadge?: (badge: string) => unknown })._awardBadge) {
      (overworldController as unknown as { _awardBadge: (badge: string) => void })._awardBadge(
        overworldController.state.currentMapId,
      );
    }
    return;
  }

  if (kind === "trainer") {
    showRaceCard(
      "RIDER RACE",
      `${trainerName ?? "Opponent"} reached x=${formatNumber(result.centerX)}.`,
      "A friendly muster on the open road.",
      false,
    );
  }
  rendererState = {
    ...rendererState,
    statusMessage: kind === "trainer"
      ? `Rider race! ${trainerName ?? "Opponent"} reached x=${formatNumber(result.centerX)}.`
      : `A wild vehicle appeared (x=${formatNumber(result.centerX)}, y=${formatNumber(result.centerY)}).`,
  };
  renderApp();
}

function mapForDialog(name: string | null): string {
  return name && name !== "Feud Line" ? name : "the rival herd";
}

function rivalryLine(mapName: string): string {
  return `The ${mapName} feud is settled — the road remembers.`;
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

const copyDnaButton = document.querySelector<HTMLButtonElement>("[data-copy-dna]");
const copyDraftButton = document.querySelector<HTMLButtonElement>("[data-copy-draft-dna]");
const importDnaInput = document.querySelector<HTMLInputElement>("[data-import-dna]");
const seedImportButton = document.querySelector<HTMLButtonElement>("[data-seed-import-dna]");

copyDnaButton?.addEventListener("click", async () => {
  const summary = getSelectedVehicleSummary(rendererState);
  const dna = summary?.dna ?? dnaInput.value;
  const ok = await copyTextToClipboard(dna);
  rendererState = {
    ...rendererState,
    statusMessage: ok
      ? `Copied ${dna} — paste it into Test Drive or seed another herd with it.`
      : "Could not copy the DNA string.",
  };
  renderApp();
});

copyDraftButton?.addEventListener("click", async () => {
  const ok = await copyTextToClipboard(dnaInput.value);
  rendererState = {
    ...rendererState,
    statusMessage: ok ? `Copied draft DNA ${dnaInput.value}.` : "Could not copy the DNA string.",
  };
  renderApp();
});

seedImportButton?.addEventListener("click", () => {
  const dna = (importDnaInput?.value ?? "").trim();
  if (dna.length === 0) {
    rendererState = {
      ...rendererState,
      statusMessage: "Paste a DNA string first, then seed the herd.",
    };
    renderApp();
    return;
  }
  if (rendererState.runState.population.length === 0) {
    generatePopulation();
  }
  renderApp();
  const population = plantSeedDna(rendererState.runState.population, dna);
  rendererState = {
    ...rendererState,
    runState: {
      // plantSeedDna keeps every id — the genealogy map stays valid as-is.
      ...rendererState.runState,
      population,
    },
    statusMessage: `Seeded the herd with ${dna} — run a generation to breed from it.`,
  };
  renderApp();
});

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

const saveSelectedToHallButton = document.querySelector<HTMLButtonElement>(
  "[data-save-selected-to-hall]",
);
saveSelectedToHallButton?.addEventListener("click", () => {
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


// ---- Rancher creation card (menu) ----
// Lazy accessors: the card is wired far below the initial renderApp() call,
// so eager const lookups would hit the temporal dead zone at boot.
const rancherNameInput = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>("[data-rancher-name]");
const rancherCapButtons = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("[data-rancher-cap]"));
const saveRancherButton = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>("[data-save-rancher]");

let lastSyncedRancherName: string | null = null;

function syncWorldDetails(): void {
  // The controller world is the movement source of truth; decor and the
  // rancher identity live in renderer state. Mirror them into the
  // controller so renderOverworldUi's world re-sync never drops them.
  const current = overworldController.state;
  overworldController._setState({
    ...current,
    decor: [...rendererState.world.decor],
    rancherName: rendererState.world.rancherName,
    rancherCap: rendererState.world.rancherCap,
  });
}

function syncRancherCard(): void {
  // Self-contained queries: this runs during the very first renderApp, before
  // the module's late const declarations initialize (TDZ otherwise).
  // Only write the input when the STORED name changed — re-renders triggered
  // by other clicks must not wipe what the player is typing (and the cap
  // buttons steal focus, so a focus check alone isn't enough).
  const input = document.querySelector<HTMLInputElement>("[data-rancher-name]");
  if (input && rendererState.world.rancherName !== lastSyncedRancherName) {
    input.value = rendererState.world.rancherName;
    lastSyncedRancherName = rendererState.world.rancherName;
  }
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-rancher-cap]"),
  )) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.rancherCap === rendererState.world.rancherCap),
    );
  }
}

if (saveRancherButton() && rancherNameInput()) {
  for (const button of rancherCapButtons()) {
    button.addEventListener("click", () => {
      rendererState = setWorldState(rendererState, {
        ...rendererState.world,
        rancherCap: (button.dataset.rancherCap as "navy" | "rust" | "green") ?? "navy",
      });
      syncWorldDetails();
      syncRancherCard();
      renderApp();
    });
  }
  saveRancherButton()?.addEventListener("click", () => {
    const input = rancherNameInput();
    if (!input) {
      return;
    }
    const name = input.value.trim().slice(0, 24);
    rendererState = setWorldState(rendererState, {
      ...rendererState.world,
      rancherName: name,
    });
    syncWorldDetails();
    syncRancherCard();
    rendererState = {
      ...rendererState,
      statusMessage: name
        ? `The meadow knows your name now: ${name}.`
        : "The meadow will call you the new hand until you say otherwise.",
    };
    scheduleWorldSave();
    renderApp();
  });
}

// Menu overlay: the arcade start card (variant "a", chosen via A/B test on
// 2026-09-10 — "explicit menu, feels like a proper game"). Kept as a
// constant so any future variant still has a single hook.
const MENU_VARIANT = "a";
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-menu-action]"),
)) {
  button.addEventListener("click", () => {
    switch (button.dataset.menuAction) {
      case "new-run":
        // Begin the story: arrive at Starter Town and meet the Road's first
        // hand — evolution gets its starter herd (with a guide) on first visit.
        rendererState = setRendererMode(rendererState, "world");
        rendererState = {
          ...rendererState,
          statusMessage:
            "The road carries you to Starter Town. The meadow needs a new hand.",
        };
        renderApp();
        sfx.click();
        break;
      case "world":
        rendererState = setRendererMode(rendererState, "world");
        renderApp();
        break;
      case "test-drive":
        rendererState = setRendererMode(rendererState, "test-drive");
        renderApp();
        break;
      case "continue":
        void loadSavedRunState();
        break;
      default:
        break;
    }
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

// ---- Ranch economy store -------------------------------------------------
const ranchOverlay = document.querySelector<HTMLElement>("[data-ranch-overlay]");
const ranchWallet = document.querySelector<HTMLElement>("[data-ranch-wallet]");
const ranchList = document.querySelector<HTMLElement>("[data-ranch-list]");
const openRanchButton = document.querySelector<HTMLButtonElement>("[data-open-ranch]");
const closeRanchButton = document.querySelector<HTMLButtonElement>("[data-close-ranch]");

const RANCH_ICONS: Record<string, string> = {
  pasture: "🌾",
  stalls: "🏟",
  grazing: "🍀",
  velodrome: "🎡",
  grooming: "🪮",
  pens: "✂️",
  ledger: "📒",
};

// Tiny WebAudio blips for the ranch store — no assets, fail silently when
// audio is unavailable (headless tests, autoplay policies).
/** Copy a string to the clipboard, falling back to a hidden textarea for
 * contexts without the async clipboard API (older webviews). */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    document.body.removeChild(helper);
    return true;
  } catch {
    return false;
  }
}

function playRanchSound(kind: "coin" | "deny"): void {
  if (kind === "coin") {
    sfx.coin();
  } else {
    sfx.deny();
  }
}

const lineageOverlay = document.querySelector<HTMLElement>("[data-lineage-overlay]");
const lineageTitle = document.querySelector<HTMLElement>("[data-lineage-title]");
const lineageRows = document.querySelector<HTMLElement>("[data-lineage-rows]");
const lineageSub = document.querySelector<HTMLElement>("[data-lineage-sub]");
document.querySelector<HTMLButtonElement>("[data-lineage-close]")?.addEventListener("click", () => {
  if (lineageOverlay) {
    lineageOverlay.hidden = true;
  }
});

const raceOverlay = document.querySelector<HTMLElement>("[data-race-overlay]");
const raceTitle = document.querySelector<HTMLElement>("[data-race-title]");
const raceBody = document.querySelector<HTMLElement>("[data-race-body]");
const raceSub = document.querySelector<HTMLElement>("[data-race-sub]");
let raceCardToken = 0;

function showRaceCard(
  title: string,
  body: string,
  sub: string,
  isWin: boolean,
): void {
  if (raceOverlay) {
    raceOverlay.hidden = false;
  }
  const token = ++raceCardToken;
  const setTitle = (text: string) => {
    if (raceTitle && token === raceCardToken) {
      raceTitle.textContent = text;
    }
  };

  // Countdown beat, then the result.
  sfx.countdown();
  setTitle("3");
  setTimeout(() => token === raceCardToken && setTitle("2"), 430);
  setTimeout(() => token === raceCardToken && setTitle("1"), 860);
  setTimeout(() => {
    if (token === raceCardToken) {
      setTitle(title);
      if (raceBody) raceBody.innerHTML = body;
      if (raceSub) raceSub.textContent = sub;
      if (isWin) sfx.win();
      else sfx.place();
    }
  }, 1290);

  // Auto-dismiss shortly after the result is shown.
  setTimeout(() => {
    if (token === raceCardToken && raceOverlay) {
      raceOverlay.hidden = true;
    }
  }, 4200);
}

document.querySelector<HTMLButtonElement>("[data-race-close]")?.addEventListener("click", () => {
  raceCardToken += 1;
  if (raceOverlay) {
    raceOverlay.hidden = true;
  }
});

function renderRanch(): void {
  if (!ranchWallet || !ranchList) {
    return;
  }
  const wallet = rendererState.runState.wallet;
  ranchWallet.textContent = String(wallet);
  const slots = studLineCapacity(rendererState.runState.upgrades);
  const studLineNote =
    slots > 0
      ? `<div class="ranch-card"><div class="ranch-card__line"><strong>🏅 Stud line</strong><span>${(rendererState.runState.penIds ?? []).length}/${slots} marked</span></div><div class="ranch-card__flavor">Mark cars with the STUD button in the Record Barn — the next generations breed their bloodline first.</div></div>`
      : `<div class="ranch-card muted"><div class="ranch-card__flavor">Buy ✂️ The Split to set aside a stud line in the Record Barn. Mark cars there.</div></div>`;
  ranchList.innerHTML = UPGRADES.map((def) => {
    const level = upgradeLevel(rendererState.runState, def.id);
    const maxed = level >= def.maxLevel;
    const nextLevel = level + 1;
    const cost = maxed ? null : upgradeCost(def, nextLevel);
    const afford = cost !== null && wallet >= cost;
    const effectNow = level > 0 ? `<strong>${def.effectLabel(level)}</strong>` : "—";
    const effectNext = maxed ? "MAXED" : `<strong>${def.effectLabel(nextLevel)}</strong>`;
    return `
      <div class="ranch-card" data-ranch-card="${def.id}" data-maxed="${String(maxed)}">
        <div class="ranch-card__line"><strong>${RANCH_ICONS[def.id] ?? "🏠"} ${escapeHtml(def.name)}</strong><span>tier ${level}/${def.maxLevel}</span></div>
        <div class="ranch-card__flavor">${escapeHtml(def.flavor)}</div>
        <div class="ranch-card__row">
          <span class="ranch-card__effect">now ${effectNow} &nbsp;·&nbsp; next ${effectNext}</span>
          <button class="ranch-buy" type="button" data-buy-upgrade="${def.id}" ${maxed || !afford ? "disabled" : ""}>${maxed ? "MAX" : `${cost} cr · BUY`}</button>
        </div>
      </div>`;
  }).join("");
  ranchList.innerHTML +=
    studLineNote +
    `<div class="ranch-section-label">SUPPLIES · one shot per cycle</div>` +
    SUPPLIES.map((def) => {
      const owned = (rendererState.runState.supplies ?? { calm: 0, wild: 0 })[def.id] ?? 0;
      const afford = wallet >= def.cost;
      return `
      <div class="ranch-card">
        <div class="ranch-card__line"><strong>${def.id === "calm" ? "🧪" : "🌿"} ${escapeHtml(def.name)}</strong><span>held ×${owned}</span></div>
        <div class="ranch-card__flavor">${escapeHtml(def.flavor)}</div>
        <div class="ranch-card__row">
          <span class="ranch-card__effect">${escapeHtml(def.effectLabel)}</span>
          <button class="ranch-buy" type="button" data-buy-supply="${def.id}" ${!afford ? "disabled" : ""}>${def.cost} cr · BUY</button>
        </div>
      </div>`;
    }).join("");
}

if (openRanchButton && ranchOverlay) {
  openRanchButton.addEventListener("click", () => {
    if (rendererState.batchRunning) {
      return;
    }
    ranchOverlay.hidden = false;
    renderRanch();
    renderDecor();
  });
}
closeRanchButton?.addEventListener("click", () => {
  if (ranchOverlay) {
    ranchOverlay.hidden = true;
  }
});
ranchOverlay?.addEventListener("click", (event) => {
  if (event.target === ranchOverlay) {
    ranchOverlay.hidden = true;
  }
});
const ranchDecorList = document.querySelector<HTMLElement>("[data-ranch-decor-list]");
const ranchToast = document.querySelector<HTMLElement>("[data-ranch-toast]");

const grandRoundupOverlay = document.querySelector<HTMLElement>("[data-grand-roundup-overlay]");
document.querySelector<HTMLButtonElement>("[data-grand-roundup-close]")?.addEventListener("click", () => {
  if (grandRoundupOverlay) {
    grandRoundupOverlay.hidden = true;
  }
});
let ranchToastTimer: ReturnType<typeof setTimeout> | null = null;

function showRanchToast(message: string): void {
  if (!ranchToast) {
    return;
  }
  ranchToast.textContent = message;
  ranchToast.hidden = false;
  ranchToast.classList.add("visible");
  if (ranchToastTimer) {
    clearTimeout(ranchToastTimer);
  }
  ranchToastTimer = setTimeout(() => {
    ranchToast.classList.remove("visible");
    if (ranchToast) {
      ranchToast.hidden = true;
    }
  }, 1800);
}

function renderDecor(): void {
  if (!ranchDecorList) {
    return;
  }
  const wallet = rendererState.runState.wallet;
  if (ranchWallet) ranchWallet.textContent = String(wallet);
  ranchDecorList.innerHTML = DECOR_ITEMS.map((item) => {
    const owned = rendererState.world.decor.includes(item.id);
    const afford = !owned && wallet >= item.cost;
    return `
      <div class="ranch-card" data-ranch-card="${item.id}" data-owned="${String(owned)}">
        <div class="ranch-card__line"><strong><span class="ranch-decor-icon">${item.emoji}</span>${escapeHtml(item.name)}</strong><span>${owned ? "in the meadow" : `${item.cost} cr`}</span></div>
        <div class="ranch-card__flavor">${escapeHtml(item.flavor)}</div>
        <div class="ranch-card__row">
          <span class="ranch-card__effect">${owned ? "Placed in Starter Town" : "Purely decorative — parked by the meadow fence"}</span>
          <button class="ranch-buy" type="button" data-buy-decor="${item.id}" ${owned || !afford ? "disabled" : ""}>${owned ? "OWNED" : `${item.cost} cr · BUY`}</button>
        </div>
      </div>`;
  }).join("");
}

ranchDecorList?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-buy-decor]");
  if (!button || rendererState.batchRunning) {
    return;
  }
  const id = button.dataset.buyDecor ?? "";
  const result = purchaseDecor(rendererState, id);
  playRanchSound(result.ok ? "coin" : "deny");
  const item = findDecor(id);
  showRanchToast(
    result.ok
      ? `${item?.emoji ?? "🏠"} ${item?.name ?? "Decor"} placed in the meadow`
      : `Ranch: ${result.reason ?? "Could not place."}`,
  );
  rendererState = result.ok
    ? result.state
    : { ...rendererState, statusMessage: `Ranch: ${result.reason ?? "Could not place."}` };
  if (result.ok) {
    syncWorldDetails();
  }
  renderApp();
  if (result.ok) {
    void window.vroomon.saveRunState(rendererState.runState);
    scheduleWorldSave();
  }
  renderRanch();
  renderDecor();
});

ranchList?.addEventListener("click", (event) => {
  const supplyButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-buy-supply]");
  if (supplyButton) {
    if (rendererState.batchRunning) {
      return;
    }
    const supplyId = supplyButton.dataset.buySupply as SupplyId;
    const def = SUPPLIES.find((candidate) => candidate.id === supplyId);
    if (!def) {
      return;
    }
    if (rendererState.runState.wallet < def.cost) {
      playRanchSound("deny");
      showRanchToast(`Ranch: ${def.name} costs ${def.cost} cr.`);
      return;
    }
    const supplies = rendererState.runState.supplies ?? { calm: 0, wild: 0 };
    rendererState = {
      ...rendererState,
      runState: {
        ...rendererState.runState,
        wallet: rendererState.runState.wallet - def.cost,
        supplies: { ...supplies, [supplyId]: (supplies[supplyId] ?? 0) + 1 },
      },
    };
    playRanchSound("coin");
    showRanchToast(`Stocked ${def.name} (×${(rendererState.runState.supplies ?? { calm: 0, wild: 0 })[supplyId] ?? 0}).`);
    renderApp();
    void window.vroomon.saveRunState(rendererState.runState);
    renderRanch();
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-buy-upgrade]");
  if (!button || rendererState.batchRunning) {
    return;
  }
  const id = button.dataset.buyUpgrade as UpgradeId;
  const result = purchaseUpgrade(rendererState, id);
  playRanchSound(result.ok ? "coin" : "deny");
  const upgrade = UPGRADES.find((u) => u.id === id);
  showRanchToast(
    result.ok
      ? `${upgrade?.name ?? "Upgrade"} built to tier ${upgradeLevel(result.state.runState, id)}`
      : `Ranch: ${result.reason ?? "Could not buy."}`,
  );
  rendererState = result.ok
    ? result.state
    : { ...rendererState, statusMessage: `Ranch: ${result.reason ?? "Could not buy."}` };
  renderApp();
  if (result.ok) {
    void window.vroomon.saveRunState(rendererState.runState);
    void window.vroomon.saveUpgrades(rendererState.runState.upgrades ?? {});
  }
  renderRanch();
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return;
  }

  // Mode-switch shortcuts work in every mode, including the overworld,
  // where the old "world first" branch swallowed 1-4/m/o/e/t and left
  // players unable to leave via keyboard.
  const MODE_SWITCH_KEYS: Record<string, AppModeId> = {
    "1": "menu",
    m: "menu",
    "2": "world",
    o: "world",
    "3": "evolution",
    e: "evolution",
    "4": "test-drive",
    t: "test-drive",
  };
  const modeKey = MODE_SWITCH_KEYS[event.key.toLowerCase()];
  if (modeKey) {
    event.preventDefault();
    rendererState = setRendererMode(rendererState, modeKey);
    renderApp();
    return;
  }

  if (rendererState.mode === "menu") {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      generatePopulation();
    }
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
