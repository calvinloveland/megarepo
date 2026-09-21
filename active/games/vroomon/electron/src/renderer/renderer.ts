import { cleanDna, type DecodedDnaV2 } from "../shared/dna-v2.js";
import { getTerrainPreset } from "../shared/parity-contract.js";
import { SIM_TUNING } from "../simulation/matter-simulation.js";
import { describeVehicle } from "../shared/blueprint.js";
import {
  inspectVehicle,
  inspectionSummary,
  topSpeedFor,
  trackResult,
  type TrackResult,
  type VehicleInspection,
} from "../shared/inspect.js";
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
import {
  badgeForMap,
  feudBar,
  feudBriefing,
  nextCircuitTarget,
  nextTier,
  rivalScoreFor,
  shapeForTier,
  shapeReadout,
  shapeShortfall,
  VENUE_ORDER,
  VENUE_TERRAIN,
  terrainForVenue,
  tierLabel,
  tierOutcome,
  venueTitle,
  VENUE_BADGE,
  type VehicleShape,
} from "./circuit.js";
import {
  buildHeritageGraph,
  describeKin,
  describeLine,
  lineReport,
  pedigreeNote,
  shortLabel,
  traceHeritage,
  type HeritageGraph,
} from "./heritage.js";
import {
  autoRunVerdict,
  improvementRatio,
  isOutlier,
} from "./evolution-lab.js";
import { collectSpriteExports } from "./world/sprites.js";
import { portraitSvgFor } from "./portraits.js";

import type {
  EvolutionPreview,
  GenerationResult,
  PopulationEvaluation,
  ScoreStats,
} from "../core/population.js";
import {createOverworldInputs } from "./world/overworld-controller.js";
import { renderOverworld } from "./world/overworld-renderer.js";
import { getMap, safeSpawn } from "./world/maps.js";
import { findFaction } from "./world/factions.js";
import { DECOR_ITEMS, findDecor } from "./world/decor.js";
import { canAfford, marketStock, sellPrice, sourceLabel } from "../core/market.js";
import {
  ageLabel,
  dexSummary,
  pruneSpecimenMeta,
  recordSpecimen,
  specimenEntries,
} from "./world/specimens.js";
import { questFor } from "./world/quest.js";
import { standingFor } from "./world/routines.js";
import { buildLedger, titlesToDefend, untriedGrounds } from "./ledger.js";
import { fitCanvasToBox } from "./canvas-fit.js";
import {
  describeWildGround,
  tierWalkHint,
  wildGroundRows,
  wildSendByTerrain,
  wildSendNote,
  type PackReading,
} from "./wild-ledger.js";
import { DAY_LENGTH_MS, dayPhase, isNight } from "./world/ambience-layer.js";
import { encounterWeather, weatherAt, weatherDefence } from "./world/weather.js";
import type { Track } from "./world/ambience-layer.js";
import {
  activeSideQuests,
  claimableQuests,
  questBeats,
  sideQuestLog,
  thanksSpokenKey,
  type QuestRun,
} from "./world/side-quests.js";
import { SPRITE_PALETTE as PAL } from "./world/sprites-palette.js";
import { sfx } from "./audio.js";
import { Ambience, loadAmbienceSettings, type AmbienceScene } from "./ambience.js";
import { setMasterVolume as setSfxMasterVolume } from "./audio.js";
import { loadSettings, saveSettings, type Settings } from "./settings.js";
import { decodeRun, decodeWorld, encodeRun, encodeWorld } from "./save-io.js";
import {
  captureLineage,
  keepFastest,
  plantSeedDna,
  releaseFromPopulation,
} from "../core/population.js";
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
import {
  addTally,
  createInitialWorldState,
  markVisited,
  recordEncounterDna,
} from "./world/world-state.js";
import { advanceWildPack, scoreWildPack, seedWildPack, wildTerrainFor, type WildPack } from "../core/wild.js";
import { serializeWorldState } from "./world/types.js";
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
        weather?: { grip?: number; drive?: number },
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

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 480;
// Keep centered viewport labels inside the canvas so racers near the edge
// don't get their label clipped mid-glyph (shared by clampLabelX and the
// clamped-label staggering in layoutViewportLabels).
const LABEL_EDGE_PADDING = 62;
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

let attractViewDataCache: { signature: string; data: TestDriveViewData } | null = null;

function cachedAttractViewData(terrainName: string): TestDriveViewData {
  const signature = `attract|${terrainName}|${rendererState.testDriveFrameCount ?? 24}`;
  if (attractViewDataCache && attractViewDataCache.signature === signature) {
    return attractViewDataCache.data;
  }
  const stepCount = rendererState.testDriveStepCount || DEFAULT_TEST_DRIVE_STEP_COUNT;
  const frameCount = rendererState.testDriveFrameCount || DEFAULT_TEST_DRIVE_FRAME_COUNT;
  const attractCars = Array.from({ length: 6 }, (_, index) => ({
    id: `attract-${index}`,
    dna: window.vroomon.createRandomDna(12),
    parents: [] as string[],
    mutated: false,
    score: 0,
  }));
  const frames = retimeViewportFrames(
    window.vroomon
      .previewPopulationRaceFrames(
        {
          ...rendererState.runState,
          mode: "test-drive",
          population: attractCars,
        },
        stepCount,
        frameCount,
      )
      .map((frame) => ({
        elapsedMs: frame.elapsedMs,
        entities: frame.vehicles.map(
          (vehicle) =>
            ({
              id: vehicle.id,
              label: "",
              snapshot: vehicle,
              variant: "racer" as const,
              initialCenterX: vehicle.initialCenterX,
            }) satisfies ViewportEntity,
        ),
      })),
    null,
  );
  const data: TestDriveViewData = {
    dna: attractCars[0]!.dna,
    decoded: window.vroomon.decodeDnaV2(attractCars[0]!.dna),
    snapshot: window.vroomon.previewPhysicsSnapshot(attractCars[0]!.dna, terrainName, stepCount),
    frames,
    scenarioLabel: null,
    stepCount,
    playbackDurationMs: null,
  };
  attractViewDataCache = { signature, data };
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
  onStarterVroomon: () => {
    plantStarterVroomon();
  },
  nextWildDna: (mapId) => nextWildDna(mapId),
  now: () => worldClock(),
  standing: () =>
    standingFor({
      badges: rendererState.world.badges,
      vroomdex: rendererState.world.vroomdex,
      flags: rendererState.world.flags,
      hallOfFameEntries: rendererState.hallOfFame.entries.length,
    }),
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
    // Walking somewhere new is a quest objective (and the world remembers).
    overworldController._setState(
      markVisited(overworldController.state, overworldController.state.currentMapId),
    );
    settleSideQuests();
    rendererState = setWorldState(rendererState, overworldController.state);
    renderOverworldUi();
    // The HUD chips carry the map name — walking between the house and the
    // yard left it reading the old map until the next unrelated repaint.
    renderStatsHud();
    scheduleWorldSave();
  },
  onOpenRanch: () => {
    openPocketRanch("herd");
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

/**
 * The ledger: every circuit's bar against the best this herd has run there,
 * with the car that set it. The rows that matter are the ones you would be
 * turned away from — a swept circuit's higher bar against an old champion.
 */
function renderLedger(): void {
  const list = document.querySelector<HTMLElement>("[data-ledger-list]");
  if (!list) {
    return;
  }
  const sky = weatherAt(worldClock(), dayPhase(worldClock()));
  const rows = buildLedger({
    records: recordsBoard.entries,
    feudTiers: rendererState.world.feudTiers ?? {},
    // A circuit run in this sky asks more; the ledger says so rather than
    // showing a bar you would not actually face.
    defence: weatherDefence(sky),
    hallScores: rendererState.hallOfFame.entries.map((entry) => ({
      terrainName: entry.terrainName,
      score: entry.score,
      dna: entry.dna,
    })),
  });

  const count = document.querySelector<HTMLElement>("[data-ledger-count]");
  if (count) {
    count.textContent = String(rows.length);
  }

  const defend = titlesToDefend(rows).length;
  const untried = untriedGrounds(rows).length;
  const skyNote =
    sky.label === "clear"
      ? ""
      : ` · raced in the ${sky.label}: every bar here is raised ${Math.round((weatherDefence(sky) - 1) * 100)}%`;

  list.innerHTML =
    rows
      .map((row) => {
        const verdict =
          row.status === "untried"
            ? `no run yet — bar ${formatNumber(row.bar)}`
            : row.status === "clears"
              ? `clears ${formatNumber(row.bar)} by ${formatNumber(row.margin)}`
              : `short by ${formatNumber(-row.margin)} · bar ${formatNumber(row.bar)}`;
        const detail =
          row.best > 0
            ? `you: ${formatNumber(row.best)}${row.dna ? ` (${escapeHtml(row.dna)})` : ""}`
            : "you: —";
        // The ledger is a work list, not a report: a row you are short on
        // sends you to the ground with your best car already on the bench.
        const prep =
          row.status === "short"
            ? `<button class="ledger-row__prep" type="button" data-ledger-prep="${escapeHtml(row.venueMapId)}" title="Load this ground and your best car onto the herd bench">Try it</button>`
            : "";
        return (
          `<div class="ledger-row ledger-row--${row.status}">` +
          `<span class="ledger-row__terrain">${escapeHtml(row.terrain)} ${tierLabel(row.tier)}</span>` +
          `<span class="ledger-row__detail">${detail}</span>` +
          `<span class="ledger-row__verdict">${verdict} ${prep}</span>` +
          `</div>`
        );
      })
      .join("") +
    (defend > 0
      ? `<div class="ledger-row ledger-row--short"><span class="ledger-row__terrain">DEFEND</span>` +
        `<span class="ledger-row__detail">${defend} circuit${defend === 1 ? "" : "s"} would turn your best away${escapeHtml(skyNote)}</span>` +
        `<span class="ledger-row__verdict">breed faster</span></div>`
      : skyNote
        ? `<div class="ledger-row ledger-row--untried"><span class="ledger-row__terrain">SKY</span>` +
          `<span class="ledger-row__detail">${escapeHtml(skyNote.replace(/^ · /, ""))}</span>` +
          `<span class="ledger-row__verdict">—</span></div>`
        : "") +
    (untried > 0
      ? `<div class="ledger-row ledger-row--untried"><span class="ledger-row__terrain">UNRUN</span>` +
        `<span class="ledger-row__detail">${untried} circuit${untried === 1 ? "" : "s"} never raced</span>` +
        `<span class="ledger-row__verdict">—</span></div>`
      : "");
}

/**
 * The grounds table: which packs the player has met, how far each has come and
 * what it would send. This is where "where you hunt matters" lives outside the
 * moment of a race.
 */
function renderWildGrounds(): void {
  const list = document.querySelector<HTMLElement>("[data-wild-grounds]");
  if (!list) {
    return;
  }
  const readings: Record<string, PackReading> = {};
  for (const [mapId, reading] of packReadings) {
    readings[mapId] = reading;
  }
  const rows = wildGroundRows(overworldController.state.wildGenerations ?? {}, readings);
  if (rows.length === 0) {
    list.innerHTML = `<div class="menu-hall__row"><span>No pack met yet — the grass is where you find them.</span></div>`;
  } else {
  list.innerHTML = rows
    .map(
      (row) =>
        `<div class="menu-hall__row" data-wild-ground="${escapeHtml(row.mapId)}">` +
        `<span>${escapeHtml(describeWildGround(row))}</span>` +
        (row.median > 0
          ? `<b>${row.median >= 1000 ? "sends a tier-grade animal" : "founder-class"}</b>`
          : "") +
        `</div>`,
      )
      .join("");
  }

  // And the question the table is really answering: does any of it clear the
  // bar in front of you?
  const hint = document.querySelector<HTMLElement>("[data-wild-hint]");
  if (hint) {
    const world = overworldController.state;
    const target = nextCircuitTarget(world.currentMapId, world.badges, world.feudTiers);
    const line = tierWalkHint(rows, {
      terrain: target.terrain,
      tier: target.tier,
      bar: target.bar,
    });
    hint.hidden = false;
    hint.innerHTML =
      `<span>FOR ${escapeHtml(line.terrain.toUpperCase())} ${escapeHtml(
        tierLabel(line.tier),
      )} · ${formatNumber(line.bar)}</span><b>${escapeHtml(line.text)}</b>`;
  }
}

function renderRecordsBoard(): void {
  renderWildGrounds();
  // The ledger is the other half of the board: bars against bests. Rendering
  // it here means every path that paints the board refreshes it too.
  renderLedger();

  const entries = recordsBoard.entries;
  // What the wild on each terrain would hand you, so a record can be read
  // against the alternative: "1543 px best against a ground that sends 884"
  // says whether it is worth walking out there.
  const readings: Record<string, PackReading> = {};
  for (const [mapId, reading] of packReadings) {
    readings[mapId] = reading;
  }
  const sends = wildSendByTerrain(
    wildGroundRows(overworldController.state.wildGenerations ?? {}, readings),
  );
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
        <span class="records-row__score">${formatNumber(entry.score)} px best${escapeHtml(
          wildSendNote(entry.terrainName, sends),
        )}</span>
        <span class="records-row__dna">${escapeHtml(entry.dna)}</span>
        <button class="records-row__drive" data-drive-record="${escapeHtml(entry.terrainName)}" type="button" title="Load this lap's car and ground onto the herd bench">Race it</button>
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
        // Chasing a record means standing on its terrain with its genome
        // in the draft — take the rancher straight to the herd bench.
        rendererState = setRendererTerrain(rendererState, record.terrainName);
        rendererState = setDraftDna(rendererState, record.dna);
        openPocketRanch("drive");
        rendererState = {
          ...rendererState,
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

let calloutTimer: ReturnType<typeof setTimeout> | null = null;

/** A big transient banner for the moments worth shouting about. */
function showCallout(message: string, ms = 3200): void {
  const callout = document.querySelector<HTMLElement>("[data-callout]");
  if (!callout) {
    return;
  }
  callout.textContent = message;
  callout.hidden = false;
  if (calloutTimer) {
    clearTimeout(calloutTimer);
  }
  calloutTimer = setTimeout(() => {
    callout.hidden = true;
  }, ms);
}

// ---- Auto-run: let the simulator grind while you watch ----
const autoRunButton = document.querySelector<HTMLButtonElement>("[data-auto-run]");
let autoRunTimer: ReturnType<typeof setTimeout> | null = null;
let autoRunArmed = false;
let autoRunDryStreak = 0;
let autoRunGenerations = 0;

function currentBestScore(): number {
  return rendererState.scoreHistory.reduce(
    (best, entry) => Math.max(best, entry.bestScore),
    0,
  );
}

function renderAutoRunButton(): void {
  if (!autoRunButton) {
    return;
  }
  autoRunButton.dataset.armed = String(autoRunArmed);
  autoRunButton.textContent = autoRunArmed
    ? `⏹ AUTO · ${autoRunGenerations}`
    : "▶ AUTO";
}

function stopAutoRun(reason: string): void {
  autoRunArmed = false;
  if (autoRunTimer) {
    clearTimeout(autoRunTimer);
    autoRunTimer = null;
  }
  renderAutoRunButton();
  rendererState = {
    ...rendererState,
    statusMessage: `Auto-run stopped (${reason}) after ${autoRunGenerations} generations.`,
  };
  renderApp();
}

async function autoRunTick(): Promise<void> {
  if (!autoRunArmed) {
    return;
  }
  const verdict = autoRunVerdict({
    feed: rendererState.runState.feed ?? 8,
    dryStreak: autoRunDryStreak,
    // A herd can sit on one score for many generations and then jump: with
    // per-car scoring one measured seed improved nothing for 8 generations
    // and then found a 25% better car. Six dry generations gave up before
    // that lucky generation arrived.
    plateauLimit: 15,
    stopAtPlateau: rendererState.convergeMode,
  });
  if (verdict !== "continue") {
    stopAutoRun(verdict === "out-of-feed" ? "out of feed" : "plateau");
    return;
  }
  if (!rendererState.batchRunning) {
    const before = currentBestScore();
    await runGeneration();
    const after = currentBestScore();
    autoRunGenerations += 1;
    if (isOutlier(before, after)) {
      autoRunDryStreak = 0;
      const gain = Math.round(improvementRatio(before, after) * 100);
      showCallout(`NEW OUTLIER · ${formatNumber(after)}${gain > 0 ? ` (+${gain}%)` : ""}`);
      sfx.win();
    } else {
      autoRunDryStreak += 1;
    }
    renderAutoRunButton();
    rendererState = {
      ...rendererState,
      statusMessage: `Auto-run gen ${autoRunGenerations} · best ${formatNumber(currentBestScore())} · ${autoRunDryStreak} dry`,
    };
    renderApp();
  }
  autoRunTimer = setTimeout(() => {
    void autoRunTick();
  }, 620);
}

autoRunButton?.addEventListener("click", () => {
  if (autoRunArmed) {
    stopAutoRun("switched off");
    return;
  }
  if ((rendererState.runState.feed ?? 8) < 1) {
    playRanchSound("deny");
    showCallout("Out of feed — buy grain or release some of the herd.");
    return;
  }
  autoRunArmed = true;
  autoRunGenerations = 0;
  autoRunDryStreak = 0;
  renderAutoRunButton();
  sfx.click();
  void autoRunTick();
});

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

// ---- Sprite PNG assets (see scripts/export-sprites.mjs) ----
// When present, assets/sprites/manifest.json drives image-file rendering
// over the code-drawn fallback; missing assets keep the old drawing path.
let spriteAssets: Map<string, HTMLImageElement> = new Map();
let spriteAssetsLoaded = false;

async function loadSpriteAssets(): Promise<void> {
  if (spriteAssetsLoaded) {
    return;
  }
  spriteAssetsLoaded = true;
  const loaded = new Map<string, HTMLImageElement>();
  try {
    const response = await fetch("./assets/sprites/manifest.json");
    if (!response.ok) {
      return;
    }
    const manifest = (await response.json()) as Array<{ id: string; file: string }>;
    await Promise.all(
      manifest.map(
        (entry) =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => {
              loaded.set(entry.id, image);
              resolve();
            };
            image.onerror = () => resolve();
            image.src = `./assets/sprites/${entry.file}`;
          }),
      ),
    );
  } catch {
    // no assets -> code drawing stays
    return;
  }
  if (loaded.size > 0) {
    spriteAssets = loaded;
  }
}
void loadSpriteAssets();

// Dev/build hook: the exporter script asks the running game for every
// sprite as a PNG data URL.
window.__vroomonSprites = (): Array<{ id: string; dataUrl: string }> =>
  collectSpriteExports();

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
    // Compact label: the gear shares this corner and must not collide.
    ambienceButton.textContent =
      settings.volume === 0
        ? "🔇 off"
        : settings.volume === 1
          ? "🔊 low"
          : "🔊 med";
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
// The herd comes back with the session. The world already persisted
// (rancher, map, brands, Herd Book) but the herd did not, so a reload lost
// the animals Robby lent you — restore it quietly, without touching the
// welcome status the rest of the boot sets up.
// Jobs can be finished while the game is closed (or by an action that does
// not touch the world). Settling one PAYS the rancher, which writes the run
// state — so it must not run until BOTH the world and the herd are loaded.
// Settling on the world load alone wrote the renderer's still-empty default
// run over a real herd: a finished job could wipe the animals.
let bootWorldLoaded = false;
let bootRunLoaded = false;
function settleWhenBootIsComplete(): void {
  if (bootWorldLoaded && bootRunLoaded) {
    settleSideQuests();
  }
}

void window.vroomon.loadWorldState().then(() => {
  bootWorldLoaded = true;
  settleWhenBootIsComplete();
});

void window.vroomon.loadRunState().then((restoredRun) => {
  // Tolerate an old or partial save: a missing config used to throw here and
  // take the boot with it.
  if (
    !restoredRun ||
    !Array.isArray(restoredRun.population) ||
    restoredRun.population.length === 0 ||
    typeof restoredRun.config?.populationSize !== "number"
  ) {
    bootRunLoaded = true;
    settleWhenBootIsComplete();
    return;
  }
  const status = rendererState.statusMessage;
  // setRendererRunState follows the run's own mode (a run saved on the herd
  // bench says "evolution"), so the boot is put back on the title screen —
  // the hub opens on demand.
  rendererState = {
    ...setRendererMode(
      setRendererRunState(rendererState, restoredRun, status),
      "menu",
    ),
    statusMessage: status,
  };
  renderApp();
  // renderApp's menu branch writes its own line; keep the boot's welcome.
  statusMessage.textContent = status;
  bootRunLoaded = true;
  settleWhenBootIsComplete();
});
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
  renderPocketRanch();
  syncContinueAndBarn();  renderContract();
  renderPanels();
  renderRunState();

  // The generation pill and terrain select are meaningless on the menu
  // start screen and in the overworld (which has no terrain preset); hide
  // them there so the chrome only shows where it applies.
  const genPillChrome = document.querySelector<HTMLElement>("[data-viewport-gen-pill]");
  const terrainWrapChrome = document.querySelector<HTMLElement>(".top-bar__terrain");
  const hideTopChrome =
    rendererState.mode === "menu" ||
    rendererState.mode === "world" ||
    (rendererState.barnOpen && rendererState.barnScene === "barn");
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
    rendererState.mode === "test-drive"
      ? cachedTestDriveViewData(rendererState.draftDna, terrain.name, ghostRecord)
      : rendererState.mode === "menu"
        ? cachedAttractViewData(terrain.name)
        : null;
  if (rendererState.mode === "test-drive" && testDriveViewData) {
    renderBlueprint(testDriveViewData.decoded);
  }

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

/**
 * The world's clock. Normally the real one; a world can pin its hour (dawn =
 * 0, afternoon = 0.5, night = 0.9) so a saved day stays put — and so tests
 * see the same street every run, now that people move with the day.
 */
function worldClock(): number {
  const pinned = rendererState.world.timeOverride;
  return typeof pinned === "number" ? pinned * DAY_LENGTH_MS : performance.now();
}

// ---------------------------------------------------------------------------
// Paces: the dirt the rancher has just kicked up. Small and forgetful — a
// handful of steps, faded out in a fraction of a second.
// ---------------------------------------------------------------------------

const trail: { tracks: Track[] } = { tracks: [] };
let lastTrailTile = "";

function noteFootstep(): void {
  const world = overworldController.state;
  const key = `${world.currentMapId}:${world.playerX},${world.playerY}`;
  if (key === lastTrailTile) {
    return;
  }
  lastTrailTile = key;
  trail.tracks.push({
    x: world.playerX,
    y: world.playerY,
    at: performance.now(),
  });
  if (trail.tracks.length > 8) {
    trail.tracks.shift();
  }
}

// ---------------------------------------------------------------------------
// The wild pack behind an encounter. Each biome keeps its own evolving pack
// (src/core/wild.ts): nobody steers it, the ground selects it, and every
// meeting breeds it one generation forward.
// ---------------------------------------------------------------------------

/** The vroomon you meet on this ground: a middling member of the pack, not
 * its champion (see WildPack.representative). Seeded the first time you walk
 * a biome's grass, then evolved by its own races. */
let lastScoredPack: { mapId: string; pack: string[]; scored: WildPack } | null = null;

/** What the pack on this ground is capable of — its champion's score. */
/**
 * The last measured numbers for each ground's pack. Scoring is real work, so
 * nothing re-scores for a screen: this is filled in by the places that already
 * score a pack (a meeting, the HUD chip, a hunt) and read by the wild table.
 */
const packReadings = new Map<string, PackReading>();

function rememberPack(
  mapId: string,
  scored: { representative: { score: number }; champion: { score: number } },
  generation: number,
): void {
  packReadings.set(mapId, {
    generation,
    median: scored.representative.score,
    champion: scored.champion.score,
  });
}

function packBestFor(mapId: string): number {
  if (lastScoredPack && lastScoredPack.mapId === mapId) {
    rememberPack(
      mapId,
      lastScoredPack.scored,
      overworldController.state.wildGenerations[mapId] ?? 0,
    );
    return Math.round(lastScoredPack.scored.champion.score);
  }
  const pack = overworldController.state.wildPacks[mapId];
  if (!pack) {
    return 0;
  }
  const scored = scoreWildPack(mapId, pack);
  rememberPack(mapId, scored, overworldController.state.wildGenerations[mapId] ?? 0);
  return Math.round(scored.champion.score);
}

function nextWildDna(mapId: string): string {
  const pack = rendererState.world.wildPacks[mapId] ?? seedWildPack(mapId);
  const scored = scoreWildPack(mapId, pack);
  // Keep the ranking: the pack breeds as soon as this meeting ends, and
  // racing all 24 animals again for that would double the cost of every
  // encounter (measured ~150ms each time).
  lastScoredPack = { mapId, pack, scored };
  const encountered = scored.representative.dna;
  const generation = rendererState.world.wildGenerations[mapId] ?? 0;
  rendererState = setWorldState(rendererState, {
    ...rendererState.world,
    wildPacks: { ...rendererState.world.wildPacks, [mapId]: pack },
    wildGenerations: { ...rendererState.world.wildGenerations, [mapId]: generation },
  });
  // Persist the founder pack immediately: the encounter is about to happen,
  // and a reload mid-race should not found a different pack.
  overworldController._setState({
    ...overworldController.state,
    wildPacks: { ...overworldController.state.wildPacks, [mapId]: pack },
    wildGenerations: {
      ...overworldController.state.wildGenerations,
      [mapId]: generation,
    },
  });
  scheduleWorldSave();
  return encountered;
}

/** One turn of the wild's wheel for that biome, after a meeting. */
function advanceWildForMap(mapId: string): void {
  const pack = overworldController.state.wildPacks[mapId] ?? seedWildPack(mapId);
  const random = mulberryFor(`wild:${mapId}:${overworldController.state.wildGenerations[mapId] ?? 0}`);
  const prescored =
    lastScoredPack && lastScoredPack.mapId === mapId && lastScoredPack.pack.length === pack.length
      ? lastScoredPack.scored
      : undefined;
  // Meetings after dark cost the pack two generations: the same animals run
  // the ground better at night, which is what Pell and Vane both claim.
  const steps = isNight(worldClock()) ? 2 : 1;
  const step = advanceWildPack(mapId, pack, random, prescored, steps);
  lastScoredPack = null;
  const generation = (overworldController.state.wildGenerations[mapId] ?? 0) + 1;
  // Keep what this cost us: the wild table reads these rather than re-scoring.
  rememberPack(mapId, step, generation);

  overworldController._setState({
    ...overworldController.state,
    wildPacks: { ...overworldController.state.wildPacks, [mapId]: step.pack },
    wildGenerations: { ...overworldController.state.wildGenerations, [mapId]: generation },
  });
  rendererState = setWorldState(rendererState, overworldController.state);
  scheduleWorldSave();
}

/** A deterministic generator, so a pack's history is reproducible. */
function mulberryFor(seed: string): () => number {
  let state = 0;
  for (const char of seed) {
    state = (state * 31 + char.charCodeAt(0)) % 4294967296;
  }
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Wild races: you catch a wild vroomon by beating it, never by finding it.
// A herd of hand-me-downs is not a herd — the good ones have to be bred.
// ---------------------------------------------------------------------------

interface WildRaceState {
  open: boolean;
  wildDna: string;
  /** The sky over this meeting, from the same clock as dawn and dusk. */
  weather: { kind: string; label: string; grip: number; drive: number; note: string };
  /** The pack's best on this ground, shown so the ceiling is legible. */
  packBest: number;
  packTerrain: string;
  myDna: string | null;
  terrain: string;
  frames: { mine: VehiclePreviewFrame[]; wild: VehiclePreviewFrame[] } | null;
  result: { mine: number; wild: number; won: boolean } | null;
  frameIndex: number;
  playing: boolean;
  caught: boolean;
}

let wildRaceState: WildRaceState = {
  open: false,
  wildDna: "",
  weather: weatherAt(0, 0),
  packBest: 0,
  packTerrain: "Grassland",
  myDna: null,
  terrain: "Grassland",
  frames: null,
  result: null,
  frameIndex: 0,
  playing: false,
  caught: false,
};

/**
 * Robby's loaner: a workable but plain car, so the first wild catch is a race
 * you can win and every keeper after it has to be bred faster than the last.
 * "vcG5pzmORWqC" is RRRWWR with two driven wheels — about 460px in a
 * three-second run, which beats the average wild vroomon and loses to a good
 * one.
 */
const STARTER_DNA = "vcG5pzmORWqC";

function plantStarterVroomon(): void {
  if (rendererState.runState.population.length === 0) {
    generatePopulation();
  }
  const alreadyPlanted = rendererState.runState.population.some(
    (entry) => entry.dna === STARTER_DNA,
  );
  if (alreadyPlanted) {
    return;
  }
  const population = plantSeedDna(rendererState.runState.population, STARTER_DNA);
  rendererState = {
    ...rendererState,
    runState: { ...rendererState.runState, population },
    statusMessage:
      "Robby hands you a starter vroomon — plain, but she runs. Race the wild one for it.",
  };
  renderApp();
  scheduleWorldSave();
  // Persist the herd too: Robby's loaner should survive a reload (the run
  // state is a separate save from the world).
  void window.vroomon.saveRunState(rendererState.runState);
}

/** The best car you own for a terrain: the Record Barn's champion if you
 * have one, else the strongest car in the live herd. */
function bestOwnedDna(terrainName: string): string | null {
  const hall = rendererState.hallOfFame.entries
    .filter((entry) => entry.terrainName === terrainName)
    .sort((left, right) => right.score - left.score)[0];
  if (hall?.dna) {
    return hall.dna;
  }
  const herd = rendererState.latestGeneration?.evaluatedPopulation ?? [];
  const scored = [...herd].sort((left, right) => right.score - left.score)[0];
  if (scored?.dna) {
    return scored.dna;
  }
  const seeded = rendererState.runState.population[0];
  return seeded?.dna ?? null;
}

function openWildRace(wildDna: string): void {
  const mapId = rendererState.world.currentMapId;
  // The ground the PACK lives on, not the ground the circuit would race you
  // on: `terrainForVenue` answers "Grassland" for every map that is not an
  // arena, so a meeting on the ice was raced, scored and chosen for on
  // Grassland - the panel said so, and `bestOwnedDna` picked a car for it.
  const terrain = wildTerrainFor(mapId);
  // The sky at the moment of the meeting: a one-off race, so the campaign's
  // own races stay reproducible under a clear sky. The first lesson waits for
  // a clear spell — a tutorial catch that can be rained off teaches the wrong
  // thing, since the player has one car and no way to know why they lost.
  const weather = encounterWeather({
    timeMs: worldClock(),
    phase: dayPhase(worldClock()),
    tutorial: !rendererState.world.flags["tut-caught"],
  });
  wildRaceState = { ...wildRaceState, weather };
  wildRaceState = {
    open: true,
    wildDna,
    weather,
    packBest: packBestFor(mapId),
    packTerrain: terrain,
    myDna: bestOwnedDna(terrain),
    terrain,
    frames: null,
    result: null,
    frameIndex: 0,
    playing: false,
    caught: false,
  };
  renderWildRace();
}

function closeWildRace(): void {
  stopWildRacePlayback();
  // Either way the meeting happened: the pack breeds on without you.
  advanceWildForMap(overworldController.state.currentMapId);
  wildRaceState = { ...wildRaceState, open: false, frames: null, playing: false };
  renderWildRace();
  // A win queues Robby's praise beat while the overlay is up, so the world
  // underneath has to be repainted when the overlay closes.
  renderOverworldUi();
  renderStatsHud();
  statusMessage.textContent = rendererState.statusMessage;
}

function stopWildRacePlayback(): void {
  if (wildRaceTimer !== null) {
    window.clearInterval(wildRaceTimer);
    wildRaceTimer = null;
  }
}

/** Run both cars over the same 3-second race and read the verdict. */
function runWildRace(): void {
  const { myDna, wildDna, terrain } = wildRaceState;
  if (!myDna) {
    return;
  }
  const sky = wildRaceState.weather;
  const mine = window.vroomon.previewPhysicsFrames(myDna, terrain, 180, 25, {
    grip: sky.grip,
    drive: sky.drive,
  });
  const wild = window.vroomon.previewPhysicsFrames(wildDna, terrain, 180, 25, {
    grip: sky.grip,
    drive: sky.drive,
  });
  const distance = (frames: VehiclePreviewFrame[]): number => {
    const first = frames[0]?.snapshot;
    const last = frames[frames.length - 1]?.snapshot;
    return first && last ? last.centerX - first.centerX : 0;
  };
  const mineDistance = distance(mine);
  const wildDistance = distance(wild);
  const won = mineDistance > wildDistance;
  wildRaceState = {
    ...wildRaceState,
    frames: { mine, wild },
    result: { mine: mineDistance, wild: wildDistance, won },
    frameIndex: 0,
    playing: true,
    caught: false,
  };
  renderWildRace();
  startWildRacePlayback();
}

let wildRaceTimer: number | null = null;

function startWildRacePlayback(): void {
  stopWildRacePlayback();
  const frames = wildRaceState.frames?.mine;
  if (!frames || frames.length < 2) {
    return;
  }
  const perFrameMs = Math.max(40, Math.round(3000 / frames.length));
  wildRaceTimer = window.setInterval(() => {
    const total = wildRaceState.frames?.mine.length ?? 0;
    if (!wildRaceState.open || total === 0) {
      stopWildRacePlayback();
      return;
    }
    const next = wildRaceState.frameIndex + 1;
    if (next >= total) {
      stopWildRacePlayback();
      wildRaceState = { ...wildRaceState, playing: false, frameIndex: total - 1 };
      finishWildRace();
      return;
    }
    wildRaceState = { ...wildRaceState, frameIndex: next };
    renderWildRace();
  }, perFrameMs);
}

/** The race is over: a win is the only way this genome joins the herd. */
function finishWildRace(): void {
  const result = wildRaceState.result;
  if (!result) {
    renderWildRace();
    return;
  }
  if (result.won && !wildRaceState.caught) {
    catchWildVroomon(wildRaceState.wildDna);
    wildRaceState = { ...wildRaceState, caught: true };
  }
  // A wild race is a job objective for the town's wranglers, win or lose
  // (they count the ones you beat).
  if (result.won) {
    const mapId = overworldController.state.currentMapId;
    // Both tallies: the road counts every race, and each biome counts its own
    // (the far biomes' jobs are about beating the wild where it lives).
    overworldController._setState(
      addTally(addTally(overworldController.state, "wildWins"), `wildWins:${mapId}`),
    );
    rendererState = setWorldState(rendererState, overworldController.state);
    settleSideQuests();
  }
  renderWildRace();
}

function catchWildVroomon(dna: string): void {
  const mapId = overworldController.state.currentMapId;
  const caughtWith = recordEncounterDna(overworldController.state, dna);
  // Where it came off and what it ran: the race just told us both.
  const withNotes = {
    ...caughtWith,
    specimenMeta: recordSpecimen(
      overworldController.state.specimenMeta,
      dna,
      {
        mapId,
        score: Math.max(0, wildRaceState.result?.wild ?? 0),
        caughtAt: new Date().toISOString(),
        origin: "caught" as const,
      },
      caughtWith.vroomdex,
    ),
  };
  overworldController._setState({
    ...withNotes,
    specimenMeta: pruneSpecimenMeta(withNotes.specimenMeta, withNotes.vroomdex),
  });
  rendererState = setWorldState(rendererState, overworldController.state);
  rendererState = {
    ...rendererState,
    statusMessage: "Beaten fair — its genome goes in your Herd Book.",
  };
  // The HUD counts specimens: repaint it so the Herd Book reads right the
  // moment you take one home.
  renderStatsHud();
  scheduleWorldSave();
  // The intro beat: the first catch on the ranch leads into Robby's praise.
  if (
    overworldController.state.currentMapId === "ranch_yard" &&
    !overworldController.state.flags["tut-caught"]
  ) {
    overworldController.setFlag("tut-caught", true);
    const robby = getMap("ranch_yard")?.npcs.find((npc) => npc.id === "robby-caught-1");
    if (robby?.dialogue) {
      overworldController._setState({
        ...overworldController.state,
        activeNpc: "robby-caught-1",
        dialogueQueue: [...overworldController.state.dialogueQueue, { ...robby.dialogue }],
      });
    }
  }
}

/** Two lanes, one ground line: your car above, the wild one below. */
function drawWildRace(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-wild-race-canvas]");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) {
    return;
  }
  // Draw at the size the canvas is shown at, or the lane labels shrink with
  // the drawing on a narrow window.
  fitCanvasToBox(canvas, { aspect: 720 / 260, min: 420 });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const frames = wildRaceState.frames;
  const index = wildRaceState.frameIndex;
  const ground = terrainGroundHeight();

  const laneTop = canvas.height * 0.34;
  const laneBottom = canvas.height * 0.78;
  for (const [lane, y] of [["mine", laneTop] as const, ["wild", laneBottom] as const]) {
    ctx.strokeStyle = "rgba(168, 122, 74, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(canvas.width - 24, y);
    ctx.stroke();
    void lane;
  }

  if (!frames) {
    // Before the race: both machines parked on their lines, drawn from the
    // parts their DNA builds so the window is never an empty sheet.
    const parked = (dna: string | null, laneY: number, fill: string): void => {
      if (!dna) {
        return;
      }
      const shapes = inspectVehicle(dna, inspectorTuning()).shapes;
      const span = Math.max(60, ...shapes.map((shape) => shape.x));
      const scale = Math.min(0.6, (canvas.width - 120) / span);
      for (const shape of shapes) {
        const x = (canvas.width - span * scale) / 2 + shape.x * scale;
        if (shape.kind === "wheel") {
          const radius = Math.max(3, shape.radius * scale);
          ctx.fillStyle = "#22282f";
          ctx.beginPath();
          ctx.arc(x, laneY - radius, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.arc(x, laneY - radius, Math.max(2, radius * 0.55), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const width = shape.width * scale;
        const height = shape.height * scale;
        ctx.save();
        ctx.translate(x, laneY - height / 2 - 2);
        ctx.rotate((shape.angleDeg * Math.PI) / 180);
        ctx.fillStyle = fill;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.strokeStyle = "rgba(16, 24, 34, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      }
    };
    parked(wildRaceState.myDna, laneTop, "#8ab4ff");
    parked(wildRaceState.wildDna, laneBottom, "#ffb3a7");
    return;
  }

  const startX = frames.mine[0]?.snapshot.centerX ?? 0;
  const scale = 0.42;
  const drawCar = (
    frameset: VehiclePreviewFrame[],
    laneY: number,
    fill: string,
  ): void => {
    const snapshot = frameset[Math.min(index, frameset.length - 1)]?.snapshot;
    if (!snapshot) {
      return;
    }
    const offsetX = 60 - (startX - snapshot.centerX) * scale;
    const dy = snapshot.centerY - ground;
    for (const plate of snapshot.chassis) {
      const x = offsetX + (plate.x - startX) * scale;
      const y = laneY + dy * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(plate.angle);
      ctx.fillStyle = fill;
      ctx.fillRect(
        (-(plate.width ?? 20) / 2) * scale,
        (-(plate.height ?? 12) / 2) * scale,
        (plate.width ?? 20) * scale,
        (plate.height ?? 12) * scale,
      );
      ctx.strokeStyle = "rgba(16, 24, 34, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        (-(plate.width ?? 20) / 2) * scale,
        (-(plate.height ?? 12) / 2) * scale,
        (plate.width ?? 20) * scale,
        (plate.height ?? 12) * scale,
      );
      ctx.restore();
    }
    for (const wheel of snapshot.wheels) {
      const x = offsetX + (wheel.x - startX) * scale;
      const y = laneY + (wheel.y - ground) * scale;
      const radius = Math.max(3, (wheel.radius ?? 10) * scale);
      ctx.fillStyle = "#22282f";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, radius * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  drawCar(frames.mine, laneTop, "#8ab4ff");
  drawCar(frames.wild, laneBottom, "#ffb3a7");

  // Distance markers, so the lanes read as a race.
  const result = wildRaceState.result;
  if (result) {
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`${Math.round(result.mine)} px`, canvas.width - 150, laneTop - 12);
    ctx.fillStyle = "#ffb3a7";
    ctx.fillText(`${Math.round(result.wild)} px`, canvas.width - 150, laneBottom - 12);
  }
}

function renderWildRace(): void {
  const overlay = document.querySelector<HTMLElement>("[data-wild-race-overlay]");
  if (!overlay) {
    return;
  }
  overlay.hidden = !wildRaceState.open;
  if (!wildRaceState.open) {
    return;
  }

  const wild = inspectVehicle(wildRaceState.wildDna, inspectorTuning());
  const mine = wildRaceState.myDna
    ? inspectVehicle(wildRaceState.myDna, inspectorTuning())
    : null;
  const title = document.querySelector<HTMLElement>("[data-wild-race-title]");
  if (title) {
    title.textContent = "WILD VROOMON IN THE GRASS";
  }
  const sub = document.querySelector<HTMLElement>("[data-wild-race-sub]");
  if (sub) {
    // The wild evolves on its own, so say how far this ground's pack has
    // come — a wild one that licked you last week has been breeding since.
    const mapId = overworldController.state.currentMapId;
    const generation = overworldController.state.wildGenerations[mapId] ?? 0;
    const packLine =
      generation > 0 ? `wild gen ${generation + 1}` : "the founders";
    const ceiling =
      wildRaceState.packBest > 0
        ? ` · this ground's best runs ${Math.round(wildRaceState.packBest)}px`
        : "";
    const sky = wildRaceState.weather;
    const skyLine =
      sky.label === "clear" ? "" : ` · ${sky.label}: ${sky.note}`;
    // Name the ground and what it breeds: each pack is selected on its own
    // terrain and settles on its own build, so "Canyon Quarry · Rocky stock"
    // is a different animal from the ice, and the player should be able to
    // tell before they race it.
    const place = getMap(mapId)?.name ?? wildRaceState.terrain;
    sub.textContent = `${place} · ${wildRaceState.terrain} stock · ${packLine}${ceiling}${skyLine} · win and it joins your Herd Book`;
  }
  const lanes = document.querySelector<HTMLElement>("[data-wild-race-lanes]");
  if (lanes) {
    const row = (label: string, dna: string | null, text: string): string =>
      `<b>${escapeHtml(label)}</b><span>${escapeHtml(text)}</span><i>${dna ? escapeHtml(dna) : "—"}</i>`;
    lanes.innerHTML = [
      row(
        "YOURS",
        wildRaceState.myDna,
        mine ? `${mine.modules} · ${mine.plates} plates · ${mine.wheels} wheels · ${mine.drivenCount} driven` : "",
      ),
      row(
        "WILD",
        wildRaceState.wildDna,
        `${wild.modules} · ${wild.plates} plates · ${wild.wheels} wheels · ${wild.drivenCount} driven`,
      ),
    ].join("");
  }

  const verdict = document.querySelector<HTMLElement>("[data-wild-race-verdict]");
  if (verdict) {
    const result = wildRaceState.result;
    if (!mine) {
      verdict.textContent =
        "You have no vroomon to race — Robby said he'd lend you a starter. Let this one go.";
    } else if (!result) {
      verdict.textContent = "Race it for the herd. Lose and it gets away.";
    } else if (result.won) {
      verdict.textContent = wildRaceState.caught
        ? `Beaten by ${Math.round(result.mine - result.wild)}px — its genome is in your Herd Book.`
        : "You won it.";
    } else {
      verdict.textContent = `It outran you by ${Math.round(result.wild - result.mine)}px and got away. Breed a faster one.`;
    }
  }

  const run = document.querySelector<HTMLButtonElement>("[data-wild-race-run]");
  if (run) {
    run.disabled = !mine || wildRaceState.playing;
    run.textContent = wildRaceState.result ? "▶ Race again" : "▶ Race";
  }
  drawWildRace();
}

// ---------------------------------------------------------------------------
// The inspector: one vroomon, every part, and a few tracks to try it on.
// ---------------------------------------------------------------------------

const INSPECTOR_TERRAINS = ["Flat", "Grassland", "Hills", "Rocky", "Ice"] as const;

interface InspectorState {
  open: boolean;
  dna: string;
  terrain: string;
  result: string;
  lastOutcome: string | null;
  frames: VehiclePreviewFrame[] | null;
  frameIndex: number;
  playing: boolean;
}

let inspectorState: InspectorState = {
  open: false,
  dna: "",
  terrain: INSPECTOR_TERRAINS[0],
  result: "",
  lastOutcome: null,
  frames: null,
  frameIndex: 0,
  playing: false,
};

function inspectorTuning(): { tiltCost: number; hullCost: number } {
  return { tiltCost: SIM_TUNING.tiltCost, hullCost: SIM_TUNING.hullCost };
}

function openInspector(dna: string): void {
  inspectorState = {
    open: true,
    dna: cleanDna(dna),
    terrain: INSPECTOR_TERRAINS[0],
    result: "Pick a track to run it.",
    lastOutcome: null,
    frames: null,
    frameIndex: 0,
    playing: false,
  };
  renderInspector();
}

function closeInspector(): void {
  stopInspectorPlayback();
  inspectorState = { ...inspectorState, open: false, frames: null, playing: false };
  renderInspector();
}

/** Run the draft's DNA on one track and report what it did. */
function runInspectorTrack(): void {
  const frames = window.vroomon.previewPhysicsFrames(
    inspectorState.dna,
    inspectorState.terrain,
    180,
    25,
  );
  const first = frames[0]?.snapshot;
  const last = frames[frames.length - 1]?.snapshot;
  if (!first || !last) {
    inspectorState = {
      ...inspectorState,
      frames: null,
      result: "That DNA cannot be built.",
      lastOutcome: null,
      playing: false,
    };
    renderInspector();
    return;
  }
  let topSpeed = 0;
  let air = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!.snapshot;
    const current = frames[index]!.snapshot;
    const dt = (frames[index]!.elapsedMs - frames[index - 1]!.elapsedMs) / 1000;
    if (dt > 0) {
      topSpeed = Math.max(topSpeed, (current.centerX - previous.centerX) / dt);
    }
    air = Math.max(air, terrainGroundHeight() - current.centerY);
  }
  const result = trackResult(
    inspectorState.terrain,
    last.centerX - first.centerX,
    topSpeed,
    air,
  );
  inspectorState = {
    ...inspectorState,
    frames,
    frameIndex: 0,
    result: describeTrackResult(result),
    lastOutcome: result.outcome,
  };
  // Play it: a run you watch tells you more than a number does.
  startInspectorPlayback();
}

function terrainGroundHeight(): number {
  const preset = getTerrainPreset(inspectorState.terrain);
  return preset?.groundHeight ?? 400;
}

function describeTrackResult(result: TrackResult): string {
  const distance = Math.round(result.distance);
  const speed = Math.round(Math.abs(result.topSpeed));
  return `${result.terrain}: ${result.outcome} — ${distance}px in 3s, top ${speed}px/s.`;
}

function drawInspection(
  inspection: VehicleInspection,
  snapshot: VehicleSnapshot | null,
): void {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-inspector-canvas]");
  if (!canvas) {
    return;
  }
  // Same reason as the wild lanes: the part labels are drawn into this canvas
  // and were arriving at 79% of their size on a 1024px window.
  fitCanvasToBox(canvas, { aspect: 640 / 240, min: 380 });
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // A live snapshot when a track has been run, otherwise the parts as built.
  const shapes = snapshot
    ? [
        ...snapshot.chassis.map((piece) => ({
          kind: "plate" as const,
          index: -1,
          x: piece.x,
          y: piece.y,
          width: piece.width ?? 20,
          height: piece.height ?? 12,
          angleDeg: (piece.angle * 180) / Math.PI,
        })),
        ...snapshot.wheels.map((piece) => ({
          kind: "wheel" as const,
          index: -1,
          x: piece.x,
          y: piece.y,
          radius: piece.radius ?? 12,
        })),
      ]
    : inspection.shapes;

  // A live snapshot is in WORLD coordinates (y grows downward from the top of
  // the world), so shift it up by the ground line before projecting; the
  // parts-as-built drawing is already relative to the chain line.
  const ground = terrainGroundHeight();
  const normalized = shapes.map((shape) =>
    snapshot ? { ...shape, y: shape.y - ground } : shape,
  );

  const halfWidth = (shape: (typeof normalized)[number]): number =>
    shape.kind === "wheel" ? shape.radius : shape.width / 2;
  const minX = Math.min(...normalized.map((shape) => shape.x - halfWidth(shape)));
  const maxX = Math.max(...normalized.map((shape) => shape.x + halfWidth(shape)));
  const maxY = Math.max(
    ...normalized.map((shape) =>
      shape.kind === "wheel" ? shape.y + shape.radius : shape.y + shape.height,
    ),
  );
  const minY = Math.min(
    ...normalized.map((shape) =>
      shape.kind === "wheel" ? shape.y - shape.radius : shape.y - shape.height,
    ),
  );
  const spanX = Math.max(maxX - minX, 60);
  const spanY = Math.max(maxY - minY, 40);
  const scale = Math.min((canvas.width - 40) / spanX, (canvas.height - 60) / spanY);
  const originX = (canvas.width - spanX * scale) / 2 - minX * scale;
  const groundY = canvas.height - 24;
  // Sit the car so its lowest point rests on the ground line.
  const originY = groundY - maxY * scale;

  // The ground line, so wheels visibly sit on something.
  ctx.strokeStyle = "rgba(168, 122, 74, 0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(canvas.width, groundY);
  ctx.stroke();

  for (const shape of normalized) {
    const x = originX + shape.x * scale;
    if (shape.kind === "wheel") {
      const y = snapshot ? originY + shape.y * scale : groundY - shape.radius * scale;
      const radius = shape.radius * scale;
      ctx.fillStyle = "#22282f";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7d94ba";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, radius * 0.55), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const y = snapshot
      ? originY + shape.y * scale
      : groundY - shape.height * scale - 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((shape.angleDeg * Math.PI) / 180);
    ctx.fillStyle = "#8ab4ff";
    ctx.fillRect((-shape.width / 2) * scale, (-shape.height / 2) * scale, shape.width * scale, shape.height * scale);
    ctx.strokeStyle = "rgba(16, 24, 34, 0.75)";
    ctx.lineWidth = 2;
    ctx.strokeRect((-shape.width / 2) * scale, (-shape.height / 2) * scale, shape.width * scale, shape.height * scale);
    ctx.restore();
  }
}

let inspectorPlaybackTimer: number | null = null;

function stopInspectorPlayback(): void {
  if (inspectorPlaybackTimer !== null) {
    window.clearInterval(inspectorPlaybackTimer);
    inspectorPlaybackTimer = null;
  }
}

/** Walk the recorded frames so a track run is watched, not just reported. */
function startInspectorPlayback(): void {
  stopInspectorPlayback();
  const frames = inspectorState.frames;
  if (!frames || frames.length < 2) {
    inspectorState = { ...inspectorState, playing: false };
    renderInspector();
    return;
  }
  inspectorState = { ...inspectorState, playing: true, frameIndex: 0 };
  renderInspector();
  // The run is three seconds of simulated time, played back at about that.
  const perFrameMs = Math.max(40, Math.round(3000 / frames.length));
  inspectorPlaybackTimer = window.setInterval(() => {
    const current = inspectorState.frames;
    if (!inspectorState.open || !current) {
      stopInspectorPlayback();
      return;
    }
    const next = inspectorState.frameIndex + 1;
    if (next >= current.length) {
      stopInspectorPlayback();
      inspectorState = {
        ...inspectorState,
        playing: false,
        frameIndex: current.length - 1,
      };
      renderInspector();
      return;
    }
    inspectorState = { ...inspectorState, frameIndex: next };
    renderInspector();
  }, perFrameMs);
}

function renderInspector(): void {
  const overlay = document.querySelector<HTMLElement>("[data-inspector-overlay]");
  if (!overlay) {
    return;
  }
  overlay.hidden = !inspectorState.open;
  if (!inspectorState.open) {
    return;
  }

  const inspection = inspectVehicle(inspectorState.dna, inspectorTuning());
  const tuning = {
    terminalSpeedPerPower: SIM_TUNING.terminalSpeedPerPower,
    referenceMass: SIM_TUNING.referenceMass,
    maxSpeed: SIM_TUNING.maxSpeed,
  };
  const title = document.querySelector<HTMLElement>("[data-inspector-title]");
  const summary = document.querySelector<HTMLElement>("[data-inspector-summary]");
  if (title) {
    title.textContent = `VROOMON ${inspection.dna}`;
  }
  if (summary) {
    summary.textContent = `${inspectionSummary(inspection)} · frame ${inspection.modules} · power ${inspection.powertrain}`;
  }

  const stats = document.querySelector<HTMLElement>("[data-inspector-stats]");
  if (stats) {
    const rows: Array<[string, string]> = [
      [
        "Structure",
        `${inspection.plates} plate${inspection.plates === 1 ? "" : "s"} · ` +
          `${inspection.wheels} wheel${inspection.wheels === 1 ? "" : "s"}`,
      ],
      [
        "Power",
        `${inspection.engines} engine${inspection.engines === 1 ? "" : "s"} · ` +
          `${inspection.shafts} shaft${inspection.shafts === 1 ? "" : "s"} · ` +
          `${inspection.gears} gear${inspection.gears === 1 ? "" : "s"}`,
      ],
      ["Driven wheels", `${inspection.drivenCount}/${inspection.wheels}`],
      ["Power at the wheels", `${inspection.totalPower}`],
      ["Torque", `${inspection.totalTorque}`],
      ["Mass", `${inspection.mass.toFixed(2)}`],
      ["Frame costs", `${Math.round(inspection.plant.tiltCost * 100)}% tilt · ${Math.round(inspection.plant.hullCost * 100)}% drag`],
      ["Drive on the ground", `${Math.round(inspection.plant.driveScale * 100)}%`],
      ["Top speed", inspection.drivenCount > 0 ? `${Math.round(topSpeedFor(inspection, tuning))} px/s` : "—"],
      ["Length", `${Math.round(inspection.length)} px`],
      // What the circuit would say about this car, right where its parts are
      // listed: the shape demand of the ground you are breeding for, answered.
      ["Circuit shape", shapeReadout(shapeOf(inspectorState.dna), circuitTierHere())],
    ];
    stats.innerHTML = rows
      .map(([label, value]) => `<span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span>`)
      .join("");
  }

  renderInspectorPedigree(inspectorState.dna);

  const parts = document.querySelector<HTMLElement>("[data-inspector-parts]");
  if (parts) {
    parts.innerHTML = inspection.rows
      .map(
        (row) =>
          `<div class="inspector__part inspector__part--${row.kind}">` +
          `<b>${row.index}</b>` +
          `<span>${escapeHtml(row.structure)}</span>` +
          `<em>${escapeHtml(row.power)}</em>` +
          `<i>${row.drivePower === null ? "—" : `${row.drivePower} pwr`}</i>` +
          `</div>`,
      )
      .join("");
  }

  const tracks = document.querySelector<HTMLElement>("[data-inspector-tracks]");
  if (tracks) {
    tracks.innerHTML = INSPECTOR_TERRAINS.map(
      (terrain) =>
        `<button class="hud-btn ${terrain === inspectorState.terrain ? "" : "hud-btn--secondary"}" type="button" data-inspector-terrain="${terrain}">${terrain}</button>`,
    ).join("");
  }

  const result = document.querySelector<HTMLElement>("[data-inspector-result]");
  if (result) {
    // The car's own run, read against the alternative: what the wild on that
    // ground would hand you. If this car already beats it, the walk is wasted.
    const readings: Record<string, PackReading> = {};
    for (const [mapId, reading] of packReadings) {
      readings[mapId] = reading;
    }
    const sends = wildSendByTerrain(
      wildGroundRows(overworldController.state.wildGenerations ?? {}, readings),
    );
    result.textContent = inspectorState.result + wildSendNote(inspectorState.terrain, sends);
    const outcome = inspectorState.lastOutcome;
    result.style.color =
      outcome === "flies" || outcome === "competitive"
        ? "#8bffa0"
        : outcome === "runs backwards" || outcome === "sits there"
          ? "#ff9b8a"
          : "#ffd166";
  }

  const frames = inspectorState.frames;
  const index = Math.min(
    inspectorState.frameIndex,
    Math.max(0, (frames?.length ?? 1) - 1),
  );
  const play = document.querySelector<HTMLButtonElement>("[data-inspector-play]");
  if (play) {
    play.textContent = inspectorState.playing ? "⏸ Pause" : "▶ Run";
    play.disabled = !frames || frames.length < 2;
  }
  const scrub = document.querySelector<HTMLInputElement>("[data-inspector-scrub]");
  if (scrub) {
    scrub.max = String(Math.max(0, (frames?.length ?? 1) - 1));
    scrub.value = String(index);
    scrub.disabled = !frames || frames.length < 2;
  }
  const clock = document.querySelector<HTMLElement>("[data-inspector-clock]");
  if (clock) {
    clock.textContent = `${((frames?.[index]?.elapsedMs ?? 0) / 1000).toFixed(1)}s`;
  }

  drawInspection(inspection, frames?.[index]?.snapshot ?? null);
}

/**
 * The family around one vroomon, read from the herd's own book. Built on
 * demand from the same inputs the Heritage scene uses, so the inspector can
 * say where a car sits without depending on that scene having been opened.
 */
let inspectorHerdId: string | null = null;

function renderInspectorPedigree(dna: string): void {
  const panel = document.querySelector<HTMLElement>("[data-inspector-pedigree]");
  const kin = document.querySelector<HTMLElement>("[data-inspector-kin]");
  if (!panel || !kin) {
    return;
  }
  // The book is keyed by herd id, and the inspector opens with a DNA string:
  // find the best-scoring car that carries it. Clones share a genome, so the
  // strongest one is the one worth reading the family of.
  const population =
    rendererState.latestGeneration?.evaluatedPopulation ?? rendererState.runState.population;
  const entry = population
    .filter((candidate) => candidate.dna === dna)
    .sort((left, right) => right.score - left.score)[0];
  if (!entry) {
    panel.hidden = true;
    inspectorHerdId = null;
    return;
  }
  inspectorHerdId = entry.id;
  const graph = buildHeritageGraph({
    population,
    genealogy: rendererState.runState.genealogy ?? {},
  });
  const note = pedigreeNote(graph, entry.id, { parents: entry.parents });
  if (!note) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  kin.textContent = describeKin(note);
}

/**
 * From one car's parts to its place in the tree: close the inspector, open
 * the Heritage scene, and focus the same animal there. The reverse direction
 * already exists (the tree's own Inspect button), so a family is one tap away
 * from its parts in either direction.
 */
function traceInspectorLine(): void {
  const id = inspectorHerdId;
  if (!id) {
    return;
  }
  closeInspector();
  openPocketRanch("heritage");
  focusHeritageNode(id);
}

function renderBlueprint(decoded: DecodedDnaV2): void {
  const structure = document.querySelector<HTMLElement>("[data-blueprint-structure]");
  const power = document.querySelector<HTMLElement>("[data-blueprint-power]");
  const drive = document.querySelector<HTMLElement>("[data-blueprint-drive]");
  const verdict = document.querySelector<HTMLElement>("[data-blueprint-verdict]");
  if (!structure || !power || !drive || !verdict) {
    return;
  }
  const blueprint = describeVehicle(decoded);
  structure.textContent = blueprint.structure;
  power.textContent = blueprint.power;
  drive.textContent =
    blueprint.wheels === 0
      ? "—"
      : `${blueprint.driven.length}/${blueprint.wheels} driven${
          blueprint.driven.length > 0 ? ` · ${blueprint.driven[0]!.power} pwr` : ""
        }`;
  verdict.textContent = blueprint.verdict;

  // The same verdict the Inspector gives, wherever else a car is described:
  // the shape the circuit is asking for, read against this build.
  const circuitLine = document.querySelector<HTMLElement>("[data-blueprint-circuit]");
  if (circuitLine) {
    const terrain = rendererState.runState.terrainName;
    const venue = VENUE_ORDER.find((mapId) => VENUE_TERRAIN[mapId] === terrain) ?? null;
    if (!venue) {
      circuitLine.hidden = true;
    } else {
      const shape: VehicleShape = {
        plates: blueprint.plates,
        wheels: blueprint.wheels,
        engines: blueprint.engines,
        drivenWheels: blueprint.driven.length,
      };
      const tier = rendererState.world.feudTiers?.[VENUE_BADGE[venue] ?? ""] ?? 1;
      const shortfall = shapeShortfall(shape, tier);
      circuitLine.hidden = false;
      circuitLine.dataset.fits = String(shortfall === null);
      circuitLine.textContent = `CIRCUIT · ${shapeReadout(shape, tier)}`;
    }
  }
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
  // The Pocket Ranch hub shows its herd/drive scenes as the full-screen
  // ones (evolution/test-drive) while the "barn" scene hides them all.
  const effectiveMode =
    rendererState.barnOpen && NON_MODE_SCENES.has(rendererState.barnScene)
      ? "barn"
      : rendererState.mode;
  for (const wrapper of overlayWrappers) {
    if (wrapper.hasAttribute("data-viewport-menu-overlay")) {
      wrapper.hidden = rendererState.mode !== "menu";
      continue;
    }
    const wrapperMode = wrapper.dataset.mode;
    wrapper.hidden = wrapperMode !== effectiveMode;
  }
}

/**
 * Say which car the Record Barn button will actually take. The selection
 * sticks to whatever you last touched - seeding the loaner moves it - so a
 * bare "SAVE" can quietly record a worse animal than the one on screen.
 */
function labelHallSaveButton(): void {
  // Looked up rather than captured: this runs long before the button's own
  // `const` is initialised.
  const button = document.querySelector<HTMLButtonElement>("[data-save-selected-to-hall]");
  if (!button) {
    return;
  }
  const summary = getSelectedVehicleSummary(rendererState);
  const leaderId = (() => {
    const evaluated = rendererState.latestGeneration?.evaluatedPopulation;
    if (!evaluated || evaluated.length === 0) {
      return null;
    }
    return evaluated.reduce((best, entry) => (entry.score > best.score ? entry : best)).id;
  })();

  if (!summary) {
    button.textContent = "🏆 SAVE";
    button.title = "Save the selected vehicle to the Hall of Fame";
    button.dataset.best = "false";
    return;
  }
  const isLeader = summary.id === leaderId;
  button.textContent = `🏆 SAVE ${summary.id} · ${formatNumber(summary.score)}`;
  button.title = isLeader
    ? "Save the selected vehicle - this is your best so far"
    : `Save the selected vehicle. Your best is ${leaderId ?? "not ranked yet"}`;
  button.dataset.best = String(isLeader);
}

/** The tier of the circuit the player is currently breeding for. */
function circuitTierHere(): number {
  const world = overworldController.state;
  return nextCircuitTarget(world.currentMapId, world.badges, world.feudTiers).tier;
}

/** Where the choice is made: say what your best is, and whether you have it. */
function renderFocusNote(vehicles: GenerationResult["evaluatedPopulation"]): void {
  const note = document.querySelector<HTMLElement>("[data-focus-note]");
  if (!note) {
    return;
  }
  const ranked = vehicles.slice().sort((left, right) => right.score - left.score);
  const leader = ranked[0];
  if (!leader) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  if (rendererState.selectedVehicleId === leader.id) {
    note.innerHTML = `This is your best: <b>${escapeHtml(leader.id)}</b> · ${formatNumber(leader.score)}`;
  } else {
    note.innerHTML =
      `Your best is <b>${escapeHtml(leader.id)}</b> · ${formatNumber(leader.score)} — select it to record that one.`;
  }
}

function renderVehicleFocusStrip(
  vehicles: GenerationResult["evaluatedPopulation"],
): void {
  labelHallSaveButton();
  renderFocusNote(vehicles);
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

  // Feed bounds the grind: the batch trims to however many generations the
  // carrier can actually feed, so the resource still matters.
  const availableFeed = rendererState.runState.feed ?? 8;
  const batchCount = Math.min(rendererState.batchCount, Math.max(0, availableFeed));
  rendererState = { ...rendererState, batchCount };
  if (batchCount === 0) {
    rendererState = setBatchRunning(rendererState, false);
    rendererState = {
      ...rendererState,
      statusMessage:
        "Out of feed — the carrier's empty. Buy grain in the RANCH store or release some of the herd.",
    };
    renderApp();
    return;
  }
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
  if ((rendererState.runState.feed ?? 8) < 1) {
    rendererState = {
      ...rendererState,
      statusMessage:
        "Out of feed — the carrier's empty. Buy grain in the RANCH store or release some of the herd to free up feed.",
    };
    renderApp();
    return;
  }
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

  const bestBeforeRun = currentBestScore();
  rendererState = applyGenerationToState(
    baseRendererState,
    generationResult,
    window.vroomon.advanceRunState(runState, generationResult),
  );
  if (isOutlier(bestBeforeRun, currentBestScore())) {
    const gain = Math.round(improvementRatio(bestBeforeRun, currentBestScore()) * 100);
    showCallout(
      `NEW OUTLIER · ${formatNumber(currentBestScore())}${gain > 0 ? ` (+${gain}%)` : ""}`,
    );
    sfx.win();
  }
  if (generatedPopulation) {
    rendererState = {
      ...rendererState,
      statusMessage: `Generated initial population and completed generation ${runState.generation + 1}.`,
    };
  }
  await renderGenerationLog();
  // "Run five generations" is a job someone pays for.
  settleSideQuests();
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
    // Wheels are rigid parts now, so they don't rotate on their own: roll
    // them by how far the car has travelled, which is what a wheel does.
    ...entity.snapshot.wheels.map((body) =>
      renderViewportBody(
        body,
        view,
        accent.stroke,
        accent.fill,
        entity.initialCenterX === undefined
          ? 0
          : (entity.snapshot.centerX - entity.initialCenterX) / Math.max(4, body.radius ?? 8),
      ),
    ),
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
  spin = 0,
): string {
  const x = toSvgX(view, body.x);
  const y = toSvgY(view, body.y);

  if (body.shape === "circle") {
    const radius = (body.radius ?? 8) * ((view.scaleX + view.scaleY) / 2);
    // Tire (dark) + hub (accent) so wheels read as wheels, not pale blobs.
    // The spoke is what makes the roll visible.
    const hub = Math.max(2, radius * 0.55);
    const spokeX = x + Math.cos(spin) * hub;
    const spokeY = y + Math.sin(spin) * hub;
    return (
      `<circle cx="${x}" cy="${y}" r="${radius}" fill="#22282f" stroke="rgba(8, 12, 18, 0.55)" stroke-width="2.5"></circle>` +
      `<circle cx="${x}" cy="${y}" r="${hub}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"></circle>` +
      `<line x1="${x}" y1="${y}" x2="${spokeX}" y2="${spokeY}" stroke="rgba(20, 28, 38, 0.75)" stroke-width="1.5"></line>`
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

// ---------------------------------------------------------------------------
// Side quests: what the world has to say about the jobs you took on.
// ---------------------------------------------------------------------------

/** Everything a quest needs to judge progress. */
function questRunState(): QuestRun {
  const generation = rendererState.runState.generation;
  const bestScore = rendererState.hallOfFame.entries.reduce(
    (best, entry) => Math.max(best, entry.score),
    rendererState.latestGeneration
      ? Math.max(...(rendererState.latestGeneration.evaluation.results.map((r) => r.score)), 0)
      : 0,
  );
  const released = overworldController.state.tally?.["released"] ?? 0;
  const bestByTerrain: Record<string, number> = {};
  for (const entry of recordsBoard.entries) {
    bestByTerrain[entry.terrainName] = Math.max(
      bestByTerrain[entry.terrainName] ?? 0,
      entry.score,
    );
  }
  return {
    generation,
    populationSize: rendererState.runState.population.length,
    bestScore,
    released,
    bestByTerrain,
  };
}

/**
 * Pay anything the rancher has finished and not been paid for. Runs whenever
 * the world is rendered or saved, so a job completed mid-race settles as soon
 * as you are back on the road.
 */
function settleSideQuests(): void {
  const run = questRunState();
  const ready = claimableQuests(
    {
      ...overworldController.state,
      specimenMeta: overworldController.state.specimenMeta ?? {},
    },
    run,
  );
  if (ready.length === 0) {
    return;
  }

  let world = overworldController.state;
  let runState = rendererState.runState;
  const paid: string[] = [];

  for (const entry of ready) {
    const { reward } = entry.quest;
    if (reward.wallet) {
      runState = { ...runState, wallet: runState.wallet + reward.wallet };
    }
    if (reward.feed) {
      runState = { ...runState, feed: (runState.feed ?? 8) + reward.feed };
    }
    if (reward.decor && !world.decor.includes(reward.decor)) {
      world = { ...world, decor: [...world.decor, reward.decor] };
    }
    if (reward.dna) {
      runState = { ...runState, population: plantSeedDna(runState.population, reward.dna) };
    }
    world = addTally(world, `paid:${entry.quest.id}`);
    paid.push(entry.quest.title);
  }

  overworldController._setState(world);
  rendererState = setWorldState(rendererState, world);
  rendererState = {
    ...rendererState,
    runState,
    statusMessage: `Job done — ${paid.join(", ")}. The giver paid up.`,
  };
  // A status line gets overwritten by whatever happens next; a payout is
  // worth the same banner the herd uses for a new outlier.
  showCallout(`JOB DONE · ${paid.join(" · ")}`);
  sfx.coin();
  void window.vroomon.saveRunState(runState);
  scheduleWorldSave();
  renderRanch();
  renderDecor();
}

/** The side-quest lines under the main objective. */
function sideQuestCardHtml(): string {
  const run = questRunState();
  const questWorld = {
    ...overworldController.state,
    specimenMeta: overworldController.state.specimenMeta ?? {},
  };
  const active = activeSideQuests(questWorld, run).slice(0, 3);
  if (active.length === 0) {
    return "";
  }
  return (
    `<div class="stats-quest__side" data-stats-quest-side>` +
    active
      .map(
        (entry) =>
          // Name the giver: the reward pays itself, so the only reason to go
          // back is to hear what they have to say about it — and without a
          // name there is nothing to go back to.
          `<div class="stats-quest__side-row"><span>${escapeHtml(entry.quest.title)}` +
          `<em class="stats-quest__giver"> · ${escapeHtml(entry.quest.giver)}</em></span>` +
          `<b>${escapeHtml(entry.progressText)}</b></div>`,
      )
      .join("") +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Oxide's trade counter: sell what you caught, buy blood you cannot reach.
// ---------------------------------------------------------------------------

/** What the counter pays for one specimen: priced on a short race. */
function specimenPrice(dna: string): number {
  const snapshot = window.vroomon.previewPhysicsSnapshot(dna, "Flat", 180);
  return sellPrice(snapshot.centerX - 60);
}

function renderMarket(): void {
  const walletEl = document.querySelector<HTMLElement>("[data-market-wallet]");
  if (walletEl) {
    walletEl.textContent = String(rendererState.runState.wallet);
  }
  const line = document.querySelector<HTMLElement>("[data-market-line]");
  const stock = marketStock(overworldController.state.wildPacks ?? {});
  const specimens = rendererState.world.vroomdex;

  const offerCount = document.querySelector<HTMLElement>("[data-market-offer-count]");
  if (offerCount) {
    offerCount.textContent = String(stock.offers.length);
  }
  const specimenCount = document.querySelector<HTMLElement>("[data-market-specimen-count]");
  if (specimenCount) {
    specimenCount.textContent = String(specimens.length);
  }
  if (line) {
    line.textContent =
      stock.offers.length === 0
        ? "Nothing on the shelf — the counter only stocks ground you have walked. Find some tall grass."
        : "Road stock off the ground you have walked. It gets better as those packs breed up.";
  }

  const offers = document.querySelector<HTMLElement>("[data-market-offers]");
  if (offers) {
    offers.innerHTML =
      stock.offers.length === 0
        ? `<p class="muted">No stock yet.</p>`
        : stock.offers
            .map(
              (offer, index) =>
                `<div class="market-row">` +
                `<span class="market-row__dna">${escapeHtml(offer.dna)}</span>` +
                `<span class="market-row__actions">` +
                `<button type="button" data-market-buy="${index}" ${canAfford(rendererState.runState.wallet, offer) ? "" : "disabled"}>${offer.price} cr · BUY</button>` +
                `</span>` +
                `<span class="market-row__meta">off ${escapeHtml(sourceLabel(offer.sourceMapId))} · ${escapeHtml(offer.terrain)} · runs ${offer.score}px</span>` +
                `<span></span>` +
                `</div>`,
            )
            .join("");
  }

  const specimenList = document.querySelector<HTMLElement>("[data-market-specimens]");
  if (specimenList) {
    const recent = [...specimens].slice(-14).reverse();
    specimenList.innerHTML =
      recent.length === 0
        ? `<p class="muted">Nothing caught yet. The tall grass pays in specimens.</p>`
        : recent
            .map((dna) => {
              const price = specimenPrice(dna);
              const inHerd = rendererState.runState.population.some((entry) => entry.dna === dna);
              return (
                `<div class="market-row">` +
                `<span class="market-row__dna">${escapeHtml(dna)}</span>` +
                `<span class="market-row__actions">` +
                `<button type="button" data-market-seed="${escapeHtml(dna)}">SEED HERD</button>` +
                `<button type="button" data-market-sell="${escapeHtml(dna)}">${price} cr · SELL</button>` +
                `</span>` +
                `<span class="market-row__meta">${inHerd ? "already in your herd" : "in the Herd Book"}</span>` +
                `<span></span>` +
                `</div>`
              );
            })
            .join("");
  }

  // Buy / sell / seed. Rebuilt every render, so listeners are attached here.
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-market-buy]"),
  )) {
    button.addEventListener("click", () => {
      const offer = stock.offers[Number(button.dataset.marketBuy ?? -1)];
      if (!offer || !canAfford(rendererState.runState.wallet, offer)) {
        sfx.deny();
        return;
      }
      // Buying puts the animal in the Herd Book AND the herd: what the
      // counter sells is a wild vroomon, so it arrives ready to breed with.
      const bought = recordEncounterDna(overworldController.state, offer.dna);
      overworldController._setState({
        ...bought,
        specimenMeta: pruneSpecimenMeta(
          recordSpecimen(
            overworldController.state.specimenMeta,
            offer.dna,
            {
              mapId: offer.sourceMapId,
              score: offer.score,
              caughtAt: new Date().toISOString(),
              origin: "bought",
            },
            bought.vroomdex,
          ),
          bought.vroomdex,
        ),
      });
      rendererState = setWorldState(rendererState, overworldController.state);
      rendererState = {
        ...rendererState,
        runState: {
          ...rendererState.runState,
          wallet: rendererState.runState.wallet - offer.price,
          population: plantSeedDna(rendererState.runState.population, offer.dna),
        },
        statusMessage: `Bought ${offer.dna} off ${sourceLabel(offer.sourceMapId)} for ${offer.price} cr.`,
      };
      sfx.coin();
      void window.vroomon.saveRunState(rendererState.runState);
      scheduleWorldSave();
      renderApp();
      renderMarket();
    });
  }

  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-market-sell]"),
  )) {
    button.addEventListener("click", () => {
      const dna = button.dataset.marketSell ?? "";
      const price = specimenPrice(dna);
      const remaining = overworldController.state.vroomdex.filter((entry) => entry !== dna);
      overworldController._setState({
        ...overworldController.state,
        vroomdex: remaining,
        specimenMeta: pruneSpecimenMeta(overworldController.state.specimenMeta, remaining),
      });
      rendererState = setWorldState(rendererState, overworldController.state);
      rendererState = {
        ...rendererState,
        runState: { ...rendererState.runState, wallet: rendererState.runState.wallet + price },
        statusMessage: `Sold ${dna} to the counter for ${price} cr.`,
      };
      sfx.coin();
      scheduleWorldSave();
      renderApp();
      renderMarket();
    });
  }

  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-market-seed]"),
  )) {
    button.addEventListener("click", () => {
      const dna = button.dataset.marketSeed ?? "";
      if (rendererState.runState.population.length === 0) {
        generatePopulation();
      }
      rendererState = {
        ...rendererState,
        runState: {
          ...rendererState.runState,
          population: plantSeedDna(rendererState.runState.population, dna),
        },
        statusMessage: `Seeded the herd with ${dna} — run a generation to breed from it.`,
      };
      renderApp();
      void window.vroomon.saveRunState(rendererState.runState);
      renderMarket();
    });
  }
}

// ---------------------------------------------------------------------------
// The Herd Book: every specimen, where it came off, and what it ran.
// ---------------------------------------------------------------------------

function renderDex(): void {
  const world = overworldController.state;
  const entries = specimenEntries(world.vroomdex, world.specimenMeta ?? {});
  const summary = dexSummary(entries);

  const line = document.querySelector<HTMLElement>("[data-dex-summary]");
  if (line) {
    line.innerHTML =
      summary.total === 0
        ? "Nothing in the book yet — walk some tall grass with SEEKING on."
        : `<b>${summary.total}</b> specimen${summary.total === 1 ? "" : "s"} from ` +
          `<b>${summary.biomes}</b> biome${summary.biomes === 1 ? "" : "s"}` +
          (summary.best ? ` · best wild animal runs <b>${Math.round(summary.best.score)}px</b> (${escapeHtml(summary.best.dna)})` : "") +
          (summary.unrecorded > 0 ? ` · ${summary.unrecorded} with no note` : "");
  }

  const list = document.querySelector<HTMLElement>("[data-dex-list]");
  if (!list) {
    return;
  }
  list.innerHTML =
    entries.length === 0
      ? `<p class="muted">Empty.</p>`
      : entries
          .map((entry) => {
            const note = entry.meta;
            const origin = note
              ? `${escapeHtml(sourceLabel(note.mapId))} · ${Math.round(note.score)}px · ${escapeHtml(ageLabel(note.caughtAt))}`
              : "caught before the book kept notes";
            return (
              `<div class="dex-row ${note ? "" : "dex-row--unknown"}">` +
              `<span class="dex-row__dna">${escapeHtml(entry.dna)}</span>` +
              `<span class="dex-row__origin">${note?.origin === "bought" ? "BOUGHT" : note ? "CAUGHT" : "—"}</span>` +
              `<span class="dex-row__meta">${origin}</span>` +
              `</div>`
            );
          })
          .join("");
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
  // All-time best across the run's generations — a champion found five
  // generations ago is still your champion (the last generation alone made
  // the chip disagree with the auto-run summary).
  const evolutionBest = rendererState.scoreHistory.reduce(
    (best, entry) => Math.max(best, entry.bestScore),
    rendererState.latestGeneration?.evaluatedPopulation.reduce(
      (best, entry) => Math.max(best, entry.score),
      0,
    ) ?? 0,
  );

  const chips: Array<{ label: string; value: string; action?: string }> = [];
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
    chips.push({ label: "FEED", value: String(rendererState.runState.feed ?? 8) });
    const circuit = nextCircuitTarget(
      rendererState.world.currentMapId,
      rendererState.world.badges,
      rendererState.world.feudTiers,
    );
    const championForCircuit = bestChampionScore(circuit.terrain);
    const circuitReady = championForCircuit >= circuit.bar;
    chips.push({
      label: "CIRCUIT",
      value: `${circuit.terrain} ${tierLabel(circuit.tier)} · ${formatNumber(circuit.bar)}${
        championForCircuit > 0
          ? circuitReady
            ? " ✓"
            : " ✗"
          : ""
      }`,
    });
    chips.push({ label: "WALLET", value: wallet });
  } else if (mode === "world") {
    const mapId = rendererState.world.currentMapId;
    const map = getMap(mapId);
    chips.push({ label: "MAP", value: map?.name ?? "—" });
    const quest = questFor(rendererState.world);
    questCardHtml = `
      <div class="stats-quest" data-stats-quest>
        <div class="stats-quest__line" data-stats-quest-line>${escapeHtml(quest.main)}</div>
        <div class="stats-quest__hint" data-stats-quest-hint>${escapeHtml(quest.hint)}</div>
        ${sideQuestCardHtml()}
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
    // The hunt toggle: you choose whether the tall grass is dangerous.
    chips.push({
      label: "SEEKING",
      value: rendererState.world.hunting ? "ON 🔍" : "OFF",
      action: "hunt",
    });
    // What the wild on this ground has become while nobody was watching.
    // Indoors there is no wild, so the chip would only confuse.
    if (!map?.interior) {
      const wildGeneration = rendererState.world.wildGenerations[mapId] ?? 0;
      const wildPack = rendererState.world.wildPacks[mapId];
      // What this ground would hand you, once a meeting has measured it: the
      // arms race is only half the fact without the number.
      const reading = packReadings.get(mapId);
      const send = reading && reading.median > 0 ? ` · sends ${Math.round(reading.median)}` : "";
      chips.push({
        label: "WILD",
        value: wildPack
          ? (wildGeneration > 0 ? `gen ${wildGeneration + 1}` : "founder stock") + send
          : "unmet",
      });
    }
  } else if (mode === "test-drive") {
    chips.push({ label: "HOF TOP", value: hallTop ? formatNumber(hallTop.score) : "—" });
    chips.push({ label: "GEN", value: generation });
    chips.push({ label: "WALLET", value: wallet });
  }

  overlay.innerHTML =
    chips
      .map((chip) =>
        chip.action
          ? `<button class="stats-chip stats-chip--button" type="button" data-hunt-toggle ` +
            `title="Look for wild vroomon in the tall grass? (H)">` +
            `<span class="stats-chip__label">${chip.label}</span>` +
            `<span class="stats-chip__value">${escapeHtml(chip.value)}</span></button>`
          : `<div class="stats-chip"><span class="stats-chip__label">${chip.label}</span><span class="stats-chip__value">${escapeHtml(
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
        ${showRemove ? `<button class="hall-entry__copy" data-hall-copy="${escapeHtml(entry.id)}" type="button" title="Copy the DNA string to the clipboard">Copy string</button>` : ""}
        ${showRemove ? `<button class="hall-entry__line" data-hall-line="${escapeHtml(entry.id)}" type="button" title="Open this car's traced line in the Heritage tree">🌳 Trace line</button>` : ""}
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
    // The shell depends on the saved identity too — without this the menu's
    // CONTINUE button stayed hidden on a reload even when a road existed.
    renderApp();
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
  persisted: { currentMapId: string; playerX: number; playerY: number; playerFacing: Direction; badges: string[]; factionChoices?: Record<string, string>; decor?: string[]; rancherName?: string; rancherCap?: "navy" | "rust" | "green"; vroomdex: string[]; feudTiers?: Record<string, number>; hunting?: boolean; tally?: Record<string, number>; timeOverride?: number | null; specimenMeta?: Record<string, { mapId: string; score: number; caughtAt: string; origin: "caught" | "bought" }>; wildPacks?: Record<string, string[]>; wildGenerations?: Record<string, number>; flags: Record<string, boolean> },
): WorldState {
  // A save can predate a map change (the ranch used to be one map): put the
  // rancher somewhere they can actually stand rather than in the void.
  const spawn = safeSpawn(
    persisted.currentMapId,
    Number.isFinite(persisted.playerX) ? persisted.playerX : world.playerX,
    Number.isFinite(persisted.playerY) ? persisted.playerY : world.playerY,
  );
  return {
    ...world,
    currentMapId: spawn.mapId,
    playerX: spawn.x,
    playerY: spawn.y,
    playerFacing: persisted.playerFacing ?? world.playerFacing,
    badges: Array.isArray(persisted.badges) ? persisted.badges : world.badges,
    factionChoices:
      persisted.factionChoices && typeof persisted.factionChoices === "object"
        ? persisted.factionChoices
        : world.factionChoices,
    feudTiers:
      persisted.feudTiers && typeof persisted.feudTiers === "object"
        ? persisted.feudTiers
        : world.feudTiers,
    // Old saves predate the hunt toggle; absent means "looking".
    hunting: typeof persisted.hunting === "boolean" ? persisted.hunting : world.hunting,
    tally:
      persisted.tally && typeof persisted.tally === "object"
        ? persisted.tally
        : world.tally,
    timeOverride:
      typeof persisted.timeOverride === "number" ? persisted.timeOverride : world.timeOverride,
    specimenMeta:
      persisted.specimenMeta && typeof persisted.specimenMeta === "object"
        ? persisted.specimenMeta
        : world.specimenMeta,
    wildPacks:
      persisted.wildPacks && typeof persisted.wildPacks === "object"
        ? persisted.wildPacks
        : world.wildPacks,
    wildGenerations:
      persisted.wildGenerations && typeof persisted.wildGenerations === "object"
        ? persisted.wildGenerations
        : world.wildGenerations,
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
  //
  // There is deliberately NO guard for "an NPC is talking": the serializer
  // only writes persistent fields (a queued dialogue is transient and not in
  // the shape at all), so saving mid-conversation is safe. The old guard
  // bailed out of the save and simply dropped the change — a wild catch made
  // during the tutorial's praise beat never reached the file, and because
  // the debounce had already fired, nothing came back for it.
  const world = rendererState.world;
  // Use the shared serializer rather than hand-listing fields here: a
  // hand-rolled copy silently dropped new state (circuit tiers) once.
  const persisted = serializeWorldState(world);
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
  labelHallSaveButton();

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

// Clicking the dialogue box advances it like Z does (options still win).
document
  .querySelector<HTMLElement>("[data-overworld-dialogue]")
  ?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-dialogue-option]")) {
      return;
    }
    const world = overworldController.state;
    const current = world.dialogueQueue[0];
    if (!current) {
      return;
    }
    if (current.options && current.options.length > 0) {
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
    scheduleWorldSave();
  });

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
      const resolved = overworldController._resolveDialogue(nextId);
      if (resolved) {
        // Before you race the ground, be told what it asks. This is where the
        // circuit stops being a scoreboard and becomes a breeding target: the
        // bar, what your barn holds, and the difference between them. It
        // replaces the node's "Three, two, one... GO!" rather than joining it,
        // because the race card does its own countdown.
        const target =
          resolved.onComplete === "gym" ? { ...resolved, text: briefForHere() } : resolved;
        const advanced = advanceWorldDialogue(overworldController.state, nextId, target);
        overworldController._setState(advanced);
        renderOverworldUi();
        renderStatsHud();
        scheduleWorldSave();
      } else {
        const ended = endWorldDialogue(overworldController.state, null, null);
        overworldController._setState(ended);
        renderOverworldUi();
        renderStatsHud();
        scheduleWorldSave();
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
    if (getMap(rendererState.world.currentMapId)?.id === "starter_town") {
      // The classic arrival line belongs to town; the intro set its own
      // status for the shoddy ranch wake-up.
      rendererState = {
        ...rendererState,
        statusMessage: "The road carries you to Starter Town. The meadow needs a new hand.",
      };
      statusMessage.textContent = rendererState.statusMessage;
    }
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
      noteFootstep();
      try {
        renderOverworld(overworldCanvas, {
          map,
          world: overworldController.state,
          decor: rendererState.world.decor,
          tick: worldClock(),
          spriteAssets,
          puffs: trail,
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
      scheduleWorldSave();
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
    talkAhead();
    renderOverworldUi();
    scheduleWorldSave();
  }
}

/**
 * Talk to whoever is in front of you — and let a quest giver say their own
 * line. The authored offer and thanks text existed in the quest data without
 * ever reaching a screen; a job's *reason* belongs in the mouth of the person
 * asking, not only in the objective list.
 */
/** The bar and the barn, in one sentence, for whoever is about to race. */
function briefForHere(): string {
  const world = overworldController.state;
  const target = nextCircuitTarget(world.currentMapId, world.badges, world.feudTiers);
  const bar = feudBar(target.terrain, target.tier);
  const champion = bestChampion(target.terrain);
  return feudBriefing({
    terrain: target.terrain,
    tier: target.tier,
    bar,
    best: champion?.score ?? 0,
    shape: champion ? shapeOf(champion.dna) : null,
  });
}

function talkAhead(): void {
  const before = overworldController.state.dialogueQueue.length;
  const next = overworldController.interact();
  if (before > 0 || next.dialogueQueue.length === 0) {
    return;
  }
  const opening = next.dialogueQueue[0]!;
  const npc = getMap(next.currentMapId)?.npcs.find((candidate) => candidate.id === next.activeNpc);
  if (!npc) {
    return;
  }
  const beats = questBeats(
    {
      ...next,
      specimenMeta: next.specimenMeta ?? {},
    },
    questRunState(),
    npc.id,
    npc.name,
  );
  // A greeting with a menu is how most givers already hand out work, so the
  // only thing they cannot say in static text is what happened *after*: the
  // nag while a job is open, and the thank-you when it is done. Those come
  // first; a plain offer is only voiced when the greeting has no menu of its
  // own to say it with.
  const hasMenu = (opening.options?.length ?? 0) > 0;
  const voice = beats.thanks ?? beats.pending ?? (hasMenu ? null : beats.offer);
  if (!voice) {
    return;
  }
  const withVoice =
    beats.thanks && voice === beats.thanks
      ? addTally(next, thanksSpokenKey(beats.thanks.id), 1)
      : next;
  overworldController._setState({
    ...withVoice,
    dialogueQueue: [{ text: voice.text, next: undefined }, ...next.dialogueQueue],
  });
}

function dispatchOverworldDpad(direction: Direction | "interact"): void {
  if (direction === "interact") {
    talkAhead();
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
    const world = overworldController.state;
    // A feud is fought on the *ground's* arena, not wherever you happen to
    // accept it: the Greensprouts' elder may challenge you in Starter Town,
    // but the Grassland Brand is defended at Rustler Pasture. Naming the map
    // you are standing on would make the same race read differently depending
    // on who you spoke to.
    const target = nextCircuitTarget(
      world.currentMapId,
      world.badges,
      world.feudTiers,
    );
    const mapName = getMap(target.mapId)?.name ?? "the road";
    const terrain = target.terrain;
    // The circuit tier is keyed by the Brand: sweeping the Grassland raises
    // the bar everywhere the Grassland circuit is raced.
    const circuitBadge = badgeForMap(target.mapId);
    const tier = world.feudTiers?.[circuitBadge] ?? 1;
    // The ground asks more of you in bad weather; your champion's recorded
    // score was set in the dry and does not move.
    const sky = weatherAt(worldClock(), dayPhase(worldClock()));
    const defence = weatherDefence(sky);
    const bar = feudBar(terrain, tier, defence);
    const rivalScore = rivalScoreFor(bar);
    // The tier judges two things: what the car runs, and what it is made of.
    // A score bar alone can be bought with one lucky animal off the grass.
    const champion = bestChampion(terrain);
    const championScore = champion?.score ?? 0;
    const { won: fastEnough, shortfall } = tierOutcome(championScore, bar);
    const shapeProblem = champion ? shapeShortfall(shapeOf(champion.dna), tier) : null;
    const won = fastEnough && shapeProblem === null;
    const title = venueTitle(mapName.replace(/^.*—\s*/, ""), tier);

    if (won) {
      showRaceCard(
        `FEUD RACE · ${tierLabel(tier)}`,
        `The bar was ${formatNumber(bar)} — your champion answered ${formatNumber(championScore)}.`,
        `${rivalName(trainerName)} took second at ${formatNumber(rivalScore)}. The ground is yours… for now.`,
        true,
      );
      // Nudge the arena up a tier: the next champion has to be faster. Keep
      // BOTH copies in step — persistWorldState serializes the renderer's
      // world, so a controller-only change would never reach the save.
      const withNextTier = {
        ...world,
        feudTiers: { ...(world.feudTiers ?? {}), [circuitBadge]: nextTier(tier) },
      };
      overworldController._setState(withNextTier);
      rendererState = setWorldState(rendererState, withNextTier);
      if ((overworldController as unknown as { _awardBadge?: (badge: string) => unknown })._awardBadge) {
        (overworldController as unknown as { _awardBadge: (badge: string) => void })._awardBadge(
          world.currentMapId,
        );
      }
      // Say it AFTER the badge award: that callback sets its own status.
      rendererState = {
        ...rendererState,
        statusMessage: `${title} swept${sky.label === "clear" ? "" : ` in the ${sky.label}`}! The circuit moves to ${tierLabel(nextTier(tier))} — bar ${formatNumber(feudBar(terrain, nextTier(tier)))}.`,
      };
      scheduleWorldSave();
      renderApp();
      return;
    }

    // Two ways to lose, and they ask for different work: a car that is not
    // fast enough needs generations, a car of the wrong shape needs a
    // different build. Say which one it was.
    const shapeOnlyLoss = fastEnough && shapeProblem !== null;
    showRaceCard(
      `FEUD RACE · ${tierLabel(tier)}${sky.label === "clear" ? "" : ` · ${sky.label.toUpperCase()}`}`,
      shapeOnlyLoss
        ? `Fast enough at ${formatNumber(championScore)} against a bar of ${formatNumber(bar)} — but the ground wants a shape.`
        : `The bar is ${formatNumber(bar)}${sky.label === "clear" ? "" : ` (raised ${Math.round((defence - 1) * 100)}% by the ${sky.label})`} — your best champion reached ${formatNumber(championScore)}.`,
      shapeOnlyLoss
        ? `${shapeProblem} ${rivalName(trainerName)} keeps the ground.`
        : `Short by ${formatNumber(shortfall)}. ${rivalName(trainerName)} keeps the ground. Breed a faster one.`,
      false,
    );
    rendererState = {
      ...rendererState,
      statusMessage: shapeOnlyLoss
        ? `Fast enough at ${title}, but not the right shape — ${shapeProblem}`
        : `Short by ${formatNumber(shortfall)} at ${title} — the bar is ${formatNumber(bar)} (your champion: ${formatNumber(championScore)}).`,
    };
    renderApp();
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
  if (kind === "wild") {
    // No free genomes: the wild vroomon has to be beaten on the road first.
    rendererState = {
      ...rendererState,
      statusMessage: "A wild vroomon breaks cover in the grass — race it for the herd.",
    };
    renderApp();
    openWildRace(dna);
    return;
  }

  // Whoever you lined up against remembers how it went.
  const rival = trainerName ?? "Opponent";
  if (kind === "trainer") {
    overworldController._setState(
      addTally(
        overworldController.state,
        `lastrace:${rival}`,
        result.centerX >= 60 ? 1 : 0,
      ),
    );
    rendererState = setWorldState(rendererState, overworldController.state);
    scheduleWorldSave();
  }
  rendererState = {
    ...rendererState,
    statusMessage: `Rider race! ${rival} reached x=${formatNumber(result.centerX)}.`,
  };
  renderApp();

}

/** The best champion you can put on this terrain: the Record Barn's best
 * for it, else the strongest car in the live herd. */
function bestChampionScore(terrainName: string): number {
  return bestChampion(terrainName)?.score ?? 0;
}

/** The car that will actually answer the feud, with its DNA. */
function bestChampion(
  terrainName: string,
): { score: number; dna: string; id: string } | null {
  const hall = rendererState.hallOfFame.entries
    .filter((entry) => entry.terrainName === terrainName)
    .reduce<{ score: number; dna: string; id: string } | null>(
      (best, entry) => (best === null || entry.score > best.score ? { score: entry.score, dna: entry.dna, id: entry.name } : best),
      null,
    );
  if (hall) {
    return hall;
  }
  const herd = rendererState.latestGeneration?.evaluatedPopulation ?? [];
  const top = herd.reduce<{ score: number; dna: string; id: string } | null>(
    (best, entry) => (best === null || entry.score > best.score ? { score: entry.score, dna: entry.dna, id: entry.id } : best),
    null,
  );
  return top;
}

/** What a DNA string is made of, structurally. */
function shapeOf(dna: string): VehicleShape {
  const blueprint = describeVehicle(window.vroomon.decodeDnaV2(dna));
  return {
    plates: blueprint.plates,
    wheels: blueprint.wheels,
    engines: blueprint.engines,
    drivenWheels: blueprint.driven.length,
  };
}

function rivalName(trainerName: string | null): string {
  return trainerName && trainerName !== "Feud Line" ? trainerName : "the rival herd";
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

const releaseButton = document.querySelector<HTMLButtonElement>("[data-release-selected]");
const cullButton = document.querySelector<HTMLButtonElement>("[data-cull-slow]");

releaseButton?.addEventListener("click", () => {
  const id = rendererState.selectedVehicleId;
  if (!id) {
    rendererState = {
      ...rendererState,
      statusMessage: "Pick a vroomon from the herd first, then release it.",
    };
    renderApp();
    return;
  }
  const { population, feed } = releaseFromPopulation(
    rendererState.runState.population,
    [id],
  );
  if (feed === 0) {
    rendererState = { ...rendererState, statusMessage: "That vroomon already left the herd." };
    renderApp();
    return;
  }
  rendererState = {
    ...rendererState,
    runState: {
      ...rendererState.runState,
      population,
      feed: Math.max(0, (rendererState.runState.feed ?? 8) + feed),
    },
  };
  playRanchSound("coin");
  rendererState = {
    ...rendererState,
    statusMessage: `Released one vroomon back to the wild — +${feed} feed for the carrier.`,
  };
  void window.vroomon.saveRunState(rendererState.runState);
  renderApp();
});

cullButton?.addEventListener("click", () => {
  const herd = rendererState.runState.population;
  if (herd.length <= 1) {
    rendererState = { ...rendererState, statusMessage: "Nothing to cull — the herd's already slim." };
    renderApp();
    return;
  }
  const { kept, released } = keepFastest(herd, 10);
  if (released.length === 0) {
    rendererState = { ...rendererState, statusMessage: "The whole herd fits in the top ten — no cull needed." };
    renderApp();
    return;
  }
  rendererState = {
    ...rendererState,
    runState: {
      ...rendererState.runState,
      population: kept,
      feed: Math.max(0, (rendererState.runState.feed ?? 8) + released.length),
    },
  };
  playRanchSound("coin");
  rendererState = {
    ...rendererState,
    statusMessage: `Culled ${released.length} slow stock to the wild — +${released.length} feed for the carrier.`,
  };
  void window.vroomon.saveRunState(rendererState.runState);
  renderApp();
});

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
  // A pasted champion has to survive a refresh: the seed is a change to the
  // herd, and the herd is its own save.
  void window.vroomon.saveRunState(rendererState.runState);
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
    currentMapId: rendererState.world.currentMapId,
    playerX: rendererState.world.playerX,
    playerY: rendererState.world.playerY,
    playerFacing: rendererState.world.playerFacing,
    decor: [...rendererState.world.decor],
    rancherName: rendererState.world.rancherName,
    rancherCap: rendererState.world.rancherCap,
    flags: { ...rendererState.world.flags },
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
        ? `Say it proud: ${name}.`
        : "The road will call you the new hand until you say otherwise.",
    };
    scheduleWorldSave();
    renderApp();
    // The intro's name step hands off to the wake-up call.
    if (!introOverlay?.hidden) {
      introBeatIndex = OPENING_BEATS.length; // next beat: the kitchen call
      showIntroBeat();
    }
  });
}

// ---- Opening story (monologue -> name -> wake) ----
const introOverlay = document.querySelector<HTMLElement>("[data-intro-overlay]");
const introTitle = document.querySelector<HTMLElement>("[data-intro-title]");
const introText = document.querySelector<HTMLElement>("[data-intro-text]");
const introNameStep = document.querySelector<HTMLElement>("[data-intro-name-step]");
const introPrompt = document.querySelector<HTMLElement>("[data-intro-prompt]");
const introContinueButton = document.querySelector<HTMLButtonElement>("[data-menu-action='continue']");

const OPENING_BEATS = [
  "Oh what a long trip it was to get to the Isles of Speid.",
  "At least I've finally got the chance to start over.",
  "Maybe I should even change my name.",
  "A kitchen call cuts through the morning fog: \"Hey sleepyhead! Time to wake up!\"",
];

let introBeatIndex = 0;
let introTypingToken = 0;

function startIntro(overwrite: boolean): void {
  if (!introOverlay || !introText || !introNameStep || !introPrompt) {
    return;
  }
  introBeatIndex = 0;
  introOverlay.hidden = false;
  introTitle?.classList.remove("intro-card__title--name");
  if (introTitle) introTitle.textContent = "THE ISLES OF SPEID";
  introNameStep.hidden = true;
  syncRancherCard();
  if (rancherNameInput() && overwrite) {
    rancherNameInput()!.value = "";
  }
  void overwrite;
  showIntroBeat();
}

function showIntroBeat(): void {
  if (!introText || !introPrompt) {
    return;
  }
  const beat = OPENING_BEATS[introBeatIndex];
  if (beat === undefined) {
    // The wake-up call has been read — into the shoddy ranch with you.
    finishIntro();
    return;
  }
  const token = ++introTypingToken;
  introNameStep!.hidden = true;
  introPrompt.textContent = "click / Z / Enter";
  introText.textContent = "";
  let revealed = 0;
  const tick = (): void => {
    if (token !== introTypingToken) {
      return;
    }
    revealed = Math.min(beat.length, revealed + 2);
    introText!.textContent = beat.slice(0, revealed);
    if (revealed < beat.length) {
      setTimeout(tick, 12);
      return;
    }
    introPrompt.textContent =
      introBeatIndex === 2 ? "—" : "Z / Enter";
    if (introBeatIndex === 2) {
      // Name moment: show the input + cap swatches.
      introNameStep!.hidden = false;
      if (rancherNameInput()) {
        rancherNameInput()!.focus();
        rancherNameInput()!.select();
      }
      if (introTitle) introTitle.textContent = "WHAT SHOULD MY NEW NAME BE?";
    }
  };
  setTimeout(tick, 12);
}

function advanceIntro(): void {
  if (!introOverlay || introOverlay.hidden) {
    return;
  }
  if (!introNameStep?.hidden) {
    return; // name step resolves via the confirm button
  }
  introBeatIndex += 1;
  showIntroBeat();
}

function finishIntro(): void {
  if (!introOverlay) {
    return;
  }
  introOverlay.hidden = true;
  introTypingToken += 1;
  const name = rendererState.world.rancherName || "the new hand";
  // The shoddy ranch becomes home: wake beside the bed with the kitchen
  // call already in the air.
  applyPersistedWorldToRenderer({
    ...rendererState.world,
    version: 1,
    lastSavedAt: new Date().toISOString(),
    currentMapId: "home_ranch",
    playerX: 3,
    playerY: 3,
    playerFacing: "right",
    flags: {
      ...rendererState.world.flags,
      "opening-seen": true,
    },
  });
  rendererState = {
    ...rendererState,
    mode: "world",
    statusMessage: `Sunlight through the cabin shutters. Somewhere, ${name}'s breakfast smells like it's already decided.`,
  };
  renderApp();
  sfx.click();
}

// ---- Barn & Records panel (world mode) ----
const barnOverlay = document.querySelector<HTMLElement>("[data-barn-overlay]");
const barnChip = document.querySelector<HTMLButtonElement>("[data-open-barn]");
document.querySelector<HTMLButtonElement>("[data-barn-close]")?.addEventListener("click", () => {
  if (barnOverlay) {
    barnOverlay.hidden = true;
  }
});
barnOverlay?.addEventListener("click", (event) => {
  if (event.target === barnOverlay) {
    barnOverlay.hidden = true;
  }
});
function renderHerdBook(): void {
  const entries = rendererState.world.vroomdex ?? [];
  for (const count of Array.from(
    document.querySelectorAll<HTMLElement>("[data-herdbook-count]"),
  )) {
    count.textContent = String(entries.length);
  }
  for (const list of Array.from(
    document.querySelectorAll<HTMLElement>("[data-herdbook-list]"),
  )) {
    list.innerHTML =
      entries.length === 0
        ? `<p class="muted">No genomes recorded yet — catch a wild vroomon in the tall grass.</p>`
        : entries
            .slice()
            .reverse()
            .slice(0, 24)
            .map(
              (dna) =>
                `<div class="herdbook-row">` +
                `<span class="herdbook-row__dna">${escapeHtml(dna)}</span>` +
                `<button class="hud-btn hud-btn--secondary herdbook-row__inspect" type="button" ` +
                `data-inspect-dna="${escapeHtml(dna)}" title="Inspect every part of this vroomon">🔍 Inspect</button>` +
                `</div>`,
            )
            .join("");
  }
}

type BarnScene = "herd" | "drive" | "barn" | "heritage" | "market" | "dex";

/** Hub scenes that aren't backed by a renderer mode (they replace the
 * bench/paddock view instead of scoping to it). */
const NON_MODE_SCENES = new Set<BarnScene>(["barn", "heritage", "market", "dex"]);

const BARN_SCENE_STATUS: Record<BarnScene, string> = {
  herd: "The carrier opens — the herd bench hums under your hand.",
  drive: "The paddock gate rolls back for a test drive.",
  barn: "The Record Barn creaks open, shelves and ledgers in order.",
  heritage: "You lay the herd book flat — every line back to the founders.",
  market: "Oxide sets a crate on the counter and flips the ledger open.",
  dex: "You open the Herd Book at the specimen pages.",
};

function openPocketRanch(scene: BarnScene): void {
  const alreadyThere =
    rendererState.barnOpen && rendererState.barnScene === scene;
  // Route through setRendererMode so the run state's mode (saved with the
  // run) stays in step with the hub — a mismatch made a reloaded save open
  // the wrong scene.
  rendererState = setRendererMode(
    rendererState,
    scene === "drive" ? "test-drive" : "evolution",
  );
  rendererState = {
    ...rendererState,
    barnOpen: true,
    barnScene: scene,
    statusMessage: alreadyThere
      ? rendererState.statusMessage
      : BARN_SCENE_STATUS[scene],
  };
  // Keep the barn surfaces fresh whenever the carrier opens, whichever
  // scene is showing (the lists are cheap and always current).
  renderHallOfFame();
  renderRecordsBoard();
  renderHerdBook();
  renderApp();
  sfx.click();
}

function closePocketRanch(): void {
  rendererState = setRendererMode(rendererState, "world");
  rendererState = {
    ...rendererState,
    barnOpen: false,
    barnScene: "herd",
    statusMessage: "Back on the road, carrier on your hip.",
  };
  renderApp();
  sfx.click();
}

// ---- Heritage tree ----
let heritageGraph: HeritageGraph | null = null;
let heritageSignature = "";
let heritageNodePositions: Array<{ id: string; x: number; y: number }> = [];
let heritageFocusId: string | null = null;

function heritageSignatureFor(): string {
  const run = rendererState.runState;
  // The canvas size is part of the signature: the tree is laid out to the
  // canvas, so a narrower window is a different drawing, not a stale one.
  const canvas = document.querySelector<HTMLCanvasElement>("[data-heritage-canvas]");
  return [
    run.generation,
    run.population.length,
    Object.keys(run.genealogy ?? {}).length,
    canvas?.width ?? 0,
  ].join("|");
}

/** Score -> colour: dim slate for unknown (released) stock, warm gold for
 * the best of the run. */
function heritageNodeColor(score: number | null, best: number): string {
  if (score === null || best <= 0) {
    return "#3f4a55";
  }
  const t = Math.max(0, Math.min(1, score / best));
  const r = Math.round(90 + 165 * t);
  const g = Math.round(120 + 90 * t);
  const b = Math.round(140 - 60 * t);
  return `rgb(${r},${g},${b})`;
}

/** The pedigree behind a traced car: every link, and the herd's own curve. */
function renderLineReport(id: string): void {
  const panel = document.querySelector<HTMLElement>("[data-heritage-line]");
  const rows = document.querySelector<HTMLElement>("[data-heritage-line-rows]");
  if (!panel || !rows || !heritageGraph) {
    return;
  }
  const report = lineReport(heritageGraph, traceHeritage(heritageGraph, id), {
    scoreHistory: rendererState.scoreHistory,
  });
  if (report.rows.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const count = document.querySelector<HTMLElement>("[data-heritage-line-count]");
  if (count) {
    count.textContent = String(report.rows.length);
  }
  rows.innerHTML = report.rows
    .map(
      (row) =>
        `<div class="heritage-line__row">` +
        `<em>gen ${row.depth}</em>` +
        `<span>#${escapeHtml(row.label)}${row.champion ? " ★" : ""}</span>` +
        `<b>${row.score !== null ? `${formatNumber(row.score)} pts` : "—"}</b>` +
        `</div>`,
    )
    .join("");

  const series = document.querySelector<HTMLElement>("[data-heritage-line-series]");
  if (series) {
    const points = report.series.slice(-12);
    series.textContent =
      points.length === 0
        ? "No generation history yet."
        : `Herd best: ${points.map((point) => `${point.generation}:${formatNumber(point.bestScore)}`).join(" → ")}` +
          (report.best
            ? ` · best on this line: #${escapeHtml(report.best.label)} (${formatNumber(report.best.score)})`
            : "");
  }
}

function renderHeritage(force = false): void {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-heritage-canvas]");
  const stats = document.querySelector<HTMLElement>("[data-heritage-stats]");
  if (!canvas) {
    return;
  }
  const signature = `${heritageSignatureFor()}|${heritageFocusId ?? ""}`;
  if (!force && heritageGraph && signature === heritageSignature) {
    return;
  }
  heritageSignature = signature;

  // Scores live on the last evaluated generation, not in the run state's
  // population (whose entries stay at 0) — the tree is meaningless without
  // them, so prefer the scored snapshot when we have one.
  const graph = buildHeritageGraph({
    population:
      rendererState.latestGeneration?.evaluatedPopulation ??
      rendererState.runState.population,
    genealogy: rendererState.runState.genealogy ?? {},
  });
  heritageGraph = graph;

  // Draw at the size the canvas is actually displayed at. The element used to
  // be a fixed 1200x620 scaled down by CSS, which shrank every label with it -
  // at 1024px wide the node names were two thirds of their designed size.
  // The stylesheet clamps this one's height to 62vh; match that here, or the
  // CSS squashes the drawing vertically by the difference.
  fitCanvasToBox(canvas, {
    aspect: 1200 / 620,
    min: 520,
    heightClamp: window.innerHeight * 0.62,
  });

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const best = graph.champion?.score ?? 0;
  // Tracing a line dims everyone who isn't on it.
  const focusNode = heritageFocusId
    ? graph.nodes.find((node) => node.id === heritageFocusId)
    : undefined;
  // A car with no known relations has nothing to trace — keep the fabric
  // visible rather than dimming the whole book for one lonely dot.
  const trace =
    heritageFocusId && focusNode &&
    (focusNode.parents.length > 0 || focusNode.children.length > 0)
      ? traceHeritage(graph, heritageFocusId)
      : null;
  const onTrace = trace
    ? new Set<string>([heritageFocusId!, ...trace.ancestors, ...trace.descendants])
    : null;
  const dimmed = (id: string): boolean => Boolean(onTrace) && !onTrace!.has(id);
  const columns = Math.max(1, graph.maxDepth + 1);
  const padX = 60;
  const padY = 40;
  const colWidth = columns > 1 ? (width - padX * 2) / (columns - 1) : 0;
  const maxRows = graph.columns.reduce((max, column) => Math.max(max, column.length), 1);
  const rowHeight = Math.min(34, (height - padY * 2) / Math.max(1, maxRows - 1 || 1));

  heritageNodePositions = [];
  const positionOf = (id: string): { x: number; y: number } => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      return { x: padX, y: padY };
    }
    return {
      x: padX + node.depth * colWidth,
      y: padY + node.row * rowHeight,
    };
  };

  // edges first, so nodes sit on top
  ctx.lineWidth = 1;
  for (const node of graph.nodes) {
    const to = positionOf(node.id);
    for (const parent of node.parents) {
      const from = positionOf(parent);
      if (onTrace && !(onTrace.has(node.id) && onTrace.has(parent))) {
        continue; // only the traced line's edges stay lit
      }
      ctx.strokeStyle = node.mutated
        ? "rgba(255, 209, 102, 0.45)"
        : "rgba(150, 190, 255, 0.28)";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      const midX = (from.x + to.x) / 2;
      ctx.bezierCurveTo(midX, from.y, midX, to.y, to.x, to.y);
      ctx.stroke();
    }
  }

  // nodes
  const championIds = new Set(graph.champions);
  for (const node of graph.nodes) {
    const { x, y } = positionOf(node.id);
    heritageNodePositions.push({ id: node.id, x, y });
    const radius = Math.max(2.5, Math.min(9, rowHeight * 0.4)) * (node.score !== null ? 1 : 0.7);
    ctx.globalAlpha = dimmed(node.id) ? 0.3 : 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = onTrace?.has(node.id)
      ? "#ffe08a"
      : heritageNodeColor(node.score, best);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (championIds.has(node.id)) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffd166";
      ctx.stroke();
    } else if (node.mutated) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 209, 102, 0.7)";
      ctx.stroke();
    }
  }

  // Label the champions (or the traced line). Columns are ~40px apart, so a
  // label is always wider than the gap to its neighbour: draw the *deepest*
  // first and skip anything that would land on top of a label already placed.
  // Recent animals are the ones worth naming, so they win the collisions.
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const candidates = (trace ? trace.chain : graph.champions)
    .map((id) => graph.nodes.find((candidate) => candidate.id === id))
    .filter((node): node is (typeof graph.nodes)[number] => node !== undefined)
    .sort((left, right) => right.depth - left.depth);
  const placed: Array<{ left: number; right: number; row: number }> = [];
  for (const node of candidates) {
    const { x, y } = positionOf(node.id);
    const text =
      node.score !== null
        ? `#${node.label} · ${formatNumber(node.score)}`
        : `#${node.label}`;
    const half = ctx.measureText(text).width / 2;
    const box = { left: x - half - 4, right: x + half + 4, row: y };
    const collides = placed.some(
      (other) =>
        Math.abs(other.row - box.row) < 14 &&
        box.left < other.right &&
        box.right > other.left,
    );
    // The car you came here for is named whatever happens.
    if (collides && node.id !== heritageFocusId) {
      continue;
    }
    // A dark halo so a label stays legible over the web of threads.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(12, 16, 26, 0.85)";
    ctx.strokeText(text, x, y - 13);
    ctx.fillStyle = "#ffd166";
    ctx.fillText(text, x, y - 13);
    placed.push(box);
  }

  // depth ruler
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(232, 220, 192, 0.55)";
  ctx.textAlign = "left";
  for (let depth = 0; depth <= graph.maxDepth; depth += 1) {
    const x = padX + depth * colWidth;
    ctx.fillText(`gen ${depth}`, x - 16, height - 8);
  }

  if (stats) {
    // An empty graph is not "1 generations deep": say there is nothing to trace
    // yet, and pluralise the depth like everything else does.
    const depth = graph.maxDepth + 1;
    stats.textContent =
      graph.nodes.length === 0
        ? "no lines yet — breed a generation"
        : `${graph.nodes.length} vroomon · ${graph.champions.length} ` +
          `champion${graph.champions.length === 1 ? "" : "s"} · ` +
          `${depth} generation${depth === 1 ? "" : "s"} deep`;
  }
}

/**
 * The DNA behind a heritage node: the car itself while it is in the herd, or
 * the last generation that raced it (a champion's line outlives the herd).
 */
function dnaForHerdId(id: string): string | null {
  const inHerd = rendererState.runState.population.find((entry) => entry.id === id);
  if (inHerd) {
    return inHerd.dna;
  }
  const raced = rendererState.latestGeneration?.evaluatedPopulation ?? [];
  return raced.find((entry) => entry.id === id)?.dna ?? null;
}

function pickHeritageNode(clientX: number, clientY: number): void {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-heritage-canvas]");
  const info = document.querySelector<HTMLElement>("[data-heritage-info]");
  if (!canvas || !info || !heritageGraph) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;
  let closest: { id: string; distance: number } | null = null;
  for (const node of heritageNodePositions) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance <= 16 && (!closest || distance < closest.distance)) {
      closest = { id: node.id, distance };
    }
  }
  if (!closest) {
    return;
  }
  focusHeritageNode(closest.id);
}

/** Focus one car in the tree, as if it had been tapped. */
function focusHeritageNode(id: string): void {
  const info = document.querySelector<HTMLElement>("[data-heritage-info]");
  if (!heritageGraph || !info) {
    return;
  }
  const node = heritageGraph.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    return;
  }
  const trace = traceHeritage(heritageGraph, node.id);
  const scoreText = node.score !== null ? `${formatNumber(node.score)} pts` : "released";
  const chainText =
    trace.chain.length > 1
      ? `line: ${trace.chain.map((id) => `#${shortLabel(id)}`).join(" ← ")}`
      : "founder stock — the line starts here";
  const kidText =
    trace.descendants.length > 0 ? ` · ${trace.descendants.length} descendants` : "";
  const line = `#${node.label} · ${scoreText} · gen ${node.depth} · ${chainText}${kidText}${node.mutated ? " · mutated" : ""}`;
  const dna = dnaForHerdId(node.id);
  renderLineReport(node.id);
  info.innerHTML =
    escapeHtml(line) +
    (dna
      ? ` <button class="hud-btn hud-btn--secondary heritage-panel__inspect" type="button" ` +
        `data-inspect-dna="${escapeHtml(dna)}" title="Inspect every part of this vroomon">🔍 Inspect</button>`
      : "");
  heritageFocusId = node.id;
  renderHeritage(true);
}

document
  .querySelector<HTMLCanvasElement>("[data-heritage-canvas]")
  ?.addEventListener("click", (event) => {
    pickHeritageNode(event.clientX, event.clientY);
  });

function renderPocketRanch(): void {
  if (!barnOverlay) {
    return;
  }
  if (autoRunArmed && (!rendererState.barnOpen || rendererState.barnScene !== "herd")) {
    stopAutoRun("left the bench");
  }
  // When something loads/switches the underlying mode while the hub is open
  // (a saved test-drive run, a record-driven draft), the scene follows —
  // the pills should never disagree with the content on screen. The
  // list-style scenes (barn, heritage) are not mode-backed, so they're left
  // alone.
  if (rendererState.barnOpen && !NON_MODE_SCENES.has(rendererState.barnScene)) {
    const derived = rendererState.mode === "test-drive" ? "drive" : "herd";
    if (rendererState.barnScene !== derived) {
      rendererState = { ...rendererState, barnScene: derived };
    }
  }
  barnOverlay.hidden = !rendererState.barnOpen;
  for (const pill of Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-barn-pill]"),
  )) {
    pill.setAttribute(
      "aria-pressed",
      String(pill.dataset.barnPill === rendererState.barnScene),
    );
  }
  for (const scene of Array.from(
    document.querySelectorAll<HTMLElement>("[data-barn-scene]"),
  )) {
    scene.hidden = scene.dataset.barnScene !== rendererState.barnScene;
  }
  if (rendererState.barnOpen && rendererState.barnScene === "heritage") {
    renderHeritage();
  }
  if (rendererState.barnOpen && rendererState.barnScene === "market") {
    renderMarket();
  }
  if (rendererState.barnOpen && rendererState.barnScene === "dex") {
    renderDex();
  }
}

barnChip?.addEventListener("click", () => {
  openPocketRanch("herd");
});

function setHunting(hunting: boolean): void {
  overworldController._setState({ ...overworldController.state, hunting });
  rendererState = setWorldState(rendererState, overworldController.state);
  rendererState = {
    ...rendererState,
    statusMessage: hunting
      ? "You keep an eye on the tall grass — anything that moves is fair game."
      : "You're not looking for new vroomon right now. The grass is just grass.",
  };
  renderOverworldUi();
  renderStatsHud();
  // renderOverworldUi owns the map/quest surfaces but not the status line, so
  // write it after the paint (otherwise the toggle looks like it did nothing).
  statusMessage.textContent = rendererState.statusMessage;
  scheduleWorldSave();
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const prep = target?.closest<HTMLElement>("[data-ledger-prep]");
  if (prep?.dataset.ledgerPrep) {
    const venueMapId = prep.dataset.ledgerPrep;
    const terrain = terrainForVenue(venueMapId);
    const dna =
      rendererState.hallOfFame.entries.find((entry) => entry.terrainName === terrain)?.dna ??
      recordsBoard.entries.find((entry) => entry.terrainName === terrain)?.dna ??
      rendererState.draftDna;
    rendererState = setDraftDna(rendererState, dna);
    dnaInput.value = dna;
    terrainSelect.value = terrain;
    // Set the paddock, then say so: opening the hub writes its own status.
    openPocketRanch("drive");
    const bar = feudBar(
      terrain,
      rendererState.world.feudTiers?.[VENUE_BADGE[venueMapId] ?? ""] ?? 1,
    );
    rendererState = {
      ...rendererState,
      statusMessage: `Paddock set for ${terrain} — ${dna} on the line. This circuit asks ${formatNumber(bar)}.`,
    };
    statusMessage.textContent = rendererState.statusMessage;
    renderRecordsBoard();
    return;
  }
  if (target?.closest("[data-hunt-toggle]")) {
    setHunting(!overworldController.state.hunting);
    return;
  }
  if (target?.closest("[data-wild-race-run]")) {
    runWildRace();
    return;
  }
  if (target?.closest("[data-wild-race-leave]")) {
    closeWildRace();
  }
});

document.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() === "h" &&
    rendererState.mode === "world" &&
    !rendererState.barnOpen &&
    !wildRaceState.open
  ) {
    setHunting(!overworldController.state.hunting);
  }
});

// The inspector: opened from the herd book, the paddock or a heritage line,
// and driven by whatever is on the bench.
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const inspect = target?.closest<HTMLElement>("[data-inspect-dna]");
  if (inspect?.dataset.inspectDna) {
    openInspector(inspect.dataset.inspectDna);
    return;
  }
  if (target?.closest("[data-inspect-draft]")) {
    openInspector(rendererState.draftDna);
    return;
  }
  const inspectSelected = target?.closest("[data-inspect-selected]");
  if (inspectSelected) {
    const dna = dnaForHerdId(rendererState.selectedVehicleId ?? "");
    openInspector(dna ?? rendererState.draftDna);
    return;
  }
  if (target?.closest("[data-inspector-close]")) {
    closeInspector();
    return;
  }
  if (target?.closest("[data-inspector-trace]")) {
    traceInspectorLine();
    return;
  }
  const terrain = target?.closest<HTMLElement>("[data-inspector-terrain]");
  if (terrain?.dataset.inspectorTerrain) {
    inspectorState = { ...inspectorState, terrain: terrain.dataset.inspectorTerrain };
    runInspectorTrack();
    return;
  }
  if (target?.closest("[data-inspector-play]")) {
    if (inspectorState.playing) {
      stopInspectorPlayback();
      inspectorState = { ...inspectorState, playing: false };
      renderInspector();
    } else {
      startInspectorPlayback();
    }
  }
});
document.addEventListener("input", (event) => {
  const scrub = (event.target as HTMLElement | null)?.closest<HTMLInputElement>(
    "[data-inspector-scrub]",
  );
  if (!scrub || !inspectorState.open) {
    return;
  }
  stopInspectorPlayback();
  inspectorState = {
    ...inspectorState,
    playing: false,
    frameIndex: Number(scrub.value),
  };
  renderInspector();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  if (inspectorState.open) {
    closeInspector();
    return;
  }
  // Esc lets the wild one go, which also breeds its pack on.
  if (wildRaceState.open) {
    closeWildRace();
  }
});
document.querySelector<HTMLButtonElement>("[data-barn-close]")?.addEventListener("click", () => {
  closePocketRanch();
});
for (const pill of Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-barn-pill]"),
)) {
  pill.addEventListener("click", () => {
    openPocketRanch((pill.dataset.barnPill as BarnScene) ?? "herd");
  });
}

function syncContinueAndBarn(): void {
  const started = Boolean(
    rendererState.world.rancherName || rendererState.world.badges.length > 0,
  );
  if (introContinueButton) {
    introContinueButton.hidden = !started;
  }
  if (barnChip) {
    barnChip.hidden = rendererState.mode !== "world";
    // The praise beat happens out in the YARD now, so the pulse has to count
    // both ranch spaces — gated on the house alone, the Barn button never
    // pulsed during the tutorial.
    const atRanch =
      rendererState.world.currentMapId === "home_ranch" ||
      rendererState.world.currentMapId === "ranch_yard";
    const pulseBarn =
      rendererState.mode === "world" &&
      atRanch &&
      rendererState.world.flags["tut-caught"] &&
      !rendererState.world.flags["tut-done"];
    barnChip.dataset.tutPulse = pulseBarn ? "true" : "false";
  }
  const ambienceToggleEl = document.querySelector<HTMLElement>("[data-ambience-toggle]");
  const settingsGearEl = document.querySelector<HTMLElement>("[data-open-settings]");
  // Sound + settings are ALWAYS reachable — hiding them in the world or the
  // hub made volume/save transfer impossible mid-session.
  if (ambienceToggleEl) ambienceToggleEl.hidden = false;
  if (settingsGearEl) settingsGearEl.hidden = false;
}

// Menu actions: the title screen only offers a fresh road or a continued one.
for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-menu-action]"),
)) {
  button.addEventListener("click", () => {
    switch (button.dataset.menuAction) {
      case "new-game":
        if (rendererState.world.rancherName || rendererState.world.badges.length > 0) {
          // A road's already been run — confirm the fresh start in-fiction.
          if (introOverlay) {
            introOverlay.hidden = false;
            introTitle!.textContent = "START OVER?";
            introText!.textContent =
              "A road's already been run in your name. Begin a new hand anyway — the old trails stay in the records.";
            introNameStep!.hidden = true;
            introPrompt!.textContent = "Z starts over · Esc keeps the road";
            introBeatIndex = 99;
          }
          return;
        }
        startIntro(false);
        break;
      case "continue":
        rendererState = setRendererMode(rendererState, "world");
        rendererState = {
          ...rendererState,
          statusMessage:
            rendererState.world.rancherName
              ? `Back on the road, ${rendererState.world.rancherName}.`
              : "The road carries you on.",
        };
        renderApp();
        sfx.click();
        break;
      default:
        break;
    }
  });
}

// Escape leaves the Pocket Ranch back to the road.
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && rendererState.barnOpen) {
    event.preventDefault();
    closePocketRanch();
  }
});

// Tap the card (or Z/Enter) to advance the beats; Esc backs out of
// the overwrite confirm. The name step resolves via its own button.
introOverlay?.addEventListener("click", (event) => {
  if (introOverlay?.hidden || introOverlay == null) {
    return;
  }
  if (introNameStep && !introNameStep.hidden) {
    return;
  }
  if ((event.target as HTMLElement).closest("[data-save-rancher]")) {
    return;
  }
  advanceIntro();
});

// Intro keystrokes (Z/Enter advance the beats; Esc backs out of overwrite).
window.addEventListener("keydown", (event) => {
  if (introOverlay?.hidden) {
    return;
  }
  if (event.key === "Escape") {
    introOverlay!.hidden = true;
    introTypingToken += 1;
    return;
  }
  if (event.key === "z" || event.key === "Z" || event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (introBeatIndex === 99) {
      // Overwrite confirm: Z starts fresh.
      rendererState = setWorldState(rendererState, {
        ...createInitialWorldState(),
      });
      syncWorldDetails();
      startIntro(false);
    } else {
      advanceIntro();
    }
  }
});

// Collapsible config panel toggle
// The sim dials live in an always-visible panel now (no ⚙ toggle): an
// evolution simulator should show its knobs.

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
  const feedRow = `
      <div class="ranch-card">
        <div class="ranch-card__line"><strong>🌾 Grain bin</strong><span>feed: ${rendererState.runState.feed ?? 8}</span></div>
        <div class="ranch-card__flavor">A pocket carrier runs on feed — breeding spends it, the slow repay it when released.</div>
        <div class="ranch-card__row">
          <span class="ranch-card__effect">+6 feed per bag</span>
          <button class="ranch-buy" type="button" data-buy-feed ${wallet >= 36 ? "" : "disabled"}>36 cr · BUY</button>
        </div>
      </div>`;
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
    feedRow +
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
  ranchDecorList.innerHTML = DECOR_ITEMS.filter((item) => !item.earnedOnly).map((item) => {
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
  const feedButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-buy-feed]");
  if (feedButton) {
    if (rendererState.batchRunning) {
      return;
    }
    if (rendererState.runState.wallet < 36) {
      playRanchSound("deny");
      showRanchToast("Ranch: a grain bag costs 36 cr.");
      return;
    }
    rendererState = {
      ...rendererState,
      runState: {
        ...rendererState.runState,
        wallet: rendererState.runState.wallet - 36,
        feed: (rendererState.runState.feed ?? 8) + 6,
      },
    };
    playRanchSound("coin");
    showRanchToast("Grain in the bin — +6 feed.");
    renderApp();
    void window.vroomon.saveRunState(rendererState.runState);
    renderRanch();
    return;
  }
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

  // While the opening story is on screen it owns every key — this stops
  // Enter from also tripping the menu's start-intro shortcut (which used
  // to reset the beats and loop forever on beat 2).
  if (!document.querySelector<HTMLElement>("[data-intro-overlay]")?.hidden) {
    return;
  }

  if (rendererState.mode === "menu") {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (introContinueButton && !introContinueButton.hidden) {
        // Continue if a road exists, else start fresh.
        document.querySelector<HTMLButtonElement>('[data-menu-action="continue"]')?.click();
      } else {
        startIntro(false);
      }
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
