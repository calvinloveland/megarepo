// game.js — Core game state, Company, Models, and Machine instances
// ====================================================================
// Depends on: data.js (DATA global)

let G = null; // Global game state — populated by initGame()
window.gameState = G; // Mirror for HTML onclick handlers

function initGame() {
  G = window.gameState = {
    difficulty: 'medium', // 'easy','medium','hard','nightmare'
    year: DATA.defaults.baseYear,  // starts at end of WWII (1945)
    day: 0,          // 0–364
    tickCount: 0,
    speed: 1,        // ticks per real second
    paused: false,

    company: {
      name: 'Your Brand',
      cash: DATA.defaults.startingCapital,
      reputation: DATA.defaults.startingReputation,
      totalMachinesSold: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      totalWarrantyCost: 0,

      // Design & production
      models: [],            // designed machine models
      activeMachines: [],    // all machines in the field
      productionLines: [],   // factory line configs
      productionQueue: 0,    // backlog of machines to produce

      // Service
      technicians: 3,
      serviceRegions: DATA.serviceRegions.map(sr => ({
        ...sr,
        techCount: sr.baseTechs,
        activeJobs: [],
        partsInventory: {},
      })),
      totalClaimsResolved: 0,
      pendingClaims: [],
      customerSatisfactionAvg: 0.5,

      // Supplies (component sourcing — my addition)
      suppliers: {
        drum: 'nationalSupplier',
        motor: 'nationalSupplier',
        pump: 'nationalSupplier',
        bearings: 'nationalSupplier',
        suspension: 'nationalSupplier',
        controlBoard: 'nationalSupplier',
        exterior: 'nationalSupplier',
      },

      // Marketing
      marketingBudget: 0,     // per month
      marketingFocus: 'balanced', // 'price','quality','quiet','eco','durability'
      marketShareBonus: 0,    // persistent competitiveness bonus from events/acquisitions

      // R&D
      researchLevel: 0,
      researchSpending: 0,    // per month
      unlockedTechs: ['Basic Manufacturing'],
    },

    // Market state
    market: {
      totalMarketSize: DATA.defaults.marketSize,
      soldThisYear: 0,
      yearSales: [],  // history
      competitors: DATA.competitorArchetypes.map(c => ({
        ...c,
        active: c.startingYear <= 1970,
        machinesSold: 0,
        reputation: 40,
        marketShare: 0,
        _ai: null,  // populated by AI.initCompetitor when activated
      })),
      activeRegulations: [],  // regulations that have taken effect
    },

    // Customer satisfaction tracking
    customerEvents: [],      // recent notifications
    maxEvents: 50,

    // Calendar helpers
    daysThisYear: 365,

    // History for charts (snapshots at year end)
    history: {
      years: [],           // year labels
      reputation: [],      // reputation at year end
      cash: [],            // cash at year end
      revenue: [],         // revenue that year
      expenses: [],        // expenses that year
      machinesSold: [],    // machines sold that year
      marketShare: [],     // market share at year end
    },
  };

  // Track per-year financials via deltas from previous year-end
  G._lastYearRevenue = 0;
  G._lastYearExpenses = 0;

  // Apply difficulty bonuses/penalties to player
  const _diff = DATA.difficulty[G.difficulty] || DATA.difficulty.medium;
  if (_diff.playerBonusRep) G.company.reputation += _diff.playerBonusRep;
  if (_diff.playerBonusCash) G.company.cash += _diff.playerBonusCash;
  return G;
}

// ---- Helper: generate serial number ----
let serialCounter = 0;
function nextSerial() {
  serialCounter++;
  const padded = String(serialCounter).padStart(8, '0');
  return `WM-${padded}`;
}

let customerCounter = 0;
function nextCustomerId() {
  customerCounter++;
  return `C-${String(customerCounter).padStart(5, '0')}`;
}

let modelCounter = 0;
function nextModelId() {
  modelCounter++;
  return `M-${String(modelCounter).padStart(3, '0')}`;
}

let claimCounter = 0;
function nextClaimId() {
  claimCounter++;
  return `CL-${String(claimCounter).padStart(5, '0')}`;
}

// ---- Company helpers ----

function companyAddModel(modelDef) {
  const basePrice = modelDef.retailPrice || DATA.defaults.machineBasePrice;
  const model = {
    id: nextModelId(),
    name: modelDef.name || `Model ${G.company.models.length + 1}`,
    yearIntroduced: G.year,
    components: { ...modelDef.components },
    retailPrice: basePrice,
    currentPrice: basePrice,   // adjustable post-design; starts matching retail
    warrantyYears: modelDef.warrantyYears ?? 2,  // 0 means no warranty (was: || which converted 0→2)
    qualityRating: computeModelQuality(modelDef.components),
    productionCost: computeModelCost(modelDef.components),
    isActive: true,
    totalProduced: 0,
    totalFailed: 0,
  };
  G.company.models.push(model);
  return model;
}

function computeModelCost(components) {
  let cost = 30; // base chassis + assembly
  for (const key of Object.keys(components)) {
    const compDef = DATA.components[key];
    if (!compDef) continue;
    const opt = compDef.options.find(o => o.id === components[key]);
    if (opt) cost += opt.cost;
  }
  return cost;
}

function computeModelQuality(components) {
  let score = 0;
  let count = 0;
  for (const key of ['drum','motor','pump','bearings','suspension','controlBoard']) {
    const compDef = DATA.components[key];
    if (!compDef) continue;
    const opt = compDef.options.find(o => o.id === components[key]);
    if (opt) {
      score += opt.durability;
      count++;
    }
  }
  return count > 0 ? score / count : 0.5;
}

function computeModelNoise(components) {
  let noise = 0;
  let count = 0;
  for (const key of ['drum','motor','pump','bearings','suspension']) {
    const compDef = DATA.components[key];
    if (!compDef) continue;
    const opt = compDef.options.find(o => o.id === components[key]);
    if (opt && opt.noise !== undefined) {
      noise += opt.noise;
      count++;
    }
  }
  return count > 0 ? noise / count : 0.5;
}

function computeModelEnergyEfficiency(components) {
  const motor = DATA.components.motor.options.find(o => o.id === components.motor);
  return motor ? motor.energyEfficiency : 0.3;
}

function computeModelSmartFeatures(components) {
  const board = DATA.components.controlBoard.options.find(o => o.id === components.controlBoard);
  return board ? board.smartFeatures : 0;
}

// ---- Machine instance factory ----

function createMachine(modelId, customerId, customerType) {
  const model = G.company.models.find(m => m.id === modelId);
  if (!model) return null;

  const machine = {
    serial: nextSerial(),
    modelId: modelId,
    manufactured: { year: G.year, day: G.day },
    customerId: customerId,
    customerType: customerType,
    loadsCompleted: 0,
    ageDays: 0,
    failures: [],
    currentStatus: 'active', // active | broken | disposed
    lastFailureDay: null,
    totalRepairCost: 0,
    satisfactionScore: 0.5, // starts neutral
  };

  // Apply supplier quality modifiers to component durability
  // (component sourcing improvement)
  const qualityMultiplier = getEffectiveQualityMultiplier();
  machine._effectiveQuality = model.qualityRating * qualityMultiplier;

  return machine;
}

function getEffectiveQualityMultiplier() {
  let mult = 1.0;
  for (const key of Object.keys(G.company.suppliers)) {
    const supplierId = G.company.suppliers[key];
    const supplier = DATA.suppliers.find(s => s.id === supplierId);
    if (supplier) {
      mult += (supplier.qualityMultiplier - 1.0) / 7; // each component contributes
    }
  }
  return mult;
}

// ---- Warranty Claim factory ----

function createClaim(machine, failureType) {
  const model = G.company.models.find(m => m.id === machine.modelId);
  const failureDef = DATA.failureTypes.find(f => f.id === failureType);
  if (!model || !failureDef) return null;

  const ageYears = machine.ageDays / 365;
  const inWarranty = ageYears < model.warrantyYears;

  return {
    id: nextClaimId(),
    machineSerial: machine.serial,
    customerId: machine.customerId,
    modelId: machine.modelId,
    failureType: failureType,
    failureName: failureDef.name,
    description: failureDef.description,
    severity: failureDef.severity,
    repairCost: failureDef.repairCost,
    brandRepImpact: failureDef.brandRepImpact,
    reportedDay: G.day,
    reportedYear: G.year,
    inWarranty: inWarranty,
    status: 'open',       // open | assigned | repaired | replaced | declined
    resolution: null,
    daysOpen: 0,
    assignedTech: null,
    region: null,
  };
}

// ---- Time helpers ----

function daysInYear(year) {
  // Simplified: no leap years for game simplicity
  return 365;
}

function yearProgress() {
  return G.day / daysInYear(G.year);
}

function formatDate(year, day) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthIdx = Math.floor(day / 30.4);
  const dayOfMonth = Math.floor(day % 30.4) + 1;
  return `${months[Math.min(monthIdx, 11)]} ${dayOfMonth}, ${year}`;
}

function formatYear(year) {
  return String(year);
}

// ---- Save / Load (localStorage) ----

const SAVE_KEY = 'wmt_save';

const SAVE_VERSION = 2;  // bump when save schema changes; migration in loadGame

function saveGame() {
  try {
    const data = {
      version: SAVE_VERSION,
      timestamp: Date.now(),
      state: G,
      counters: {
        serialCounter,
        customerCounter,
        modelCounter,
        claimCounter,
      },
      events: SIM.events,
      // Persist random-event cooldowns and pending choice so they survive reload
      usedEvents: SIM._usedEvents,
      pendingEvent: SIM._pendingEvent,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !data.state) return false;

    const savedVersion = data.version || 1;

    // ---- Migration: version 1 -> version 2 ----
    if (savedVersion < 2) {
      // Version 1 saves didn't have currentPrice, marketShareBonus,
      // _currentMarketShare, or researchLevel on tech unlocks.
      // Add currentPrice to models if missing.
      if (data.state.company && data.state.company.models) {
        for (const m of data.state.company.models) {
          if (m.currentPrice === undefined) m.currentPrice = m.retailPrice;
          if (m.marketShareBonus === undefined) m.marketShareBonus = 0;
        }
      }
      // Ensure researchLevel defaults
      if (data.state.company && data.state.company.researchLevel === undefined) {
        data.state.company.researchLevel = 0;
      }
      // Ensure unlockedTechs has Basic Manufacturing
      if (data.state.company && (!data.state.company.unlockedTechs || data.state.company.unlockedTechs.length === 0)) {
        data.state.company.unlockedTechs = ['Basic Manufacturing'];
      }
    }

    // ---- Restore state ----
    G = window.gameState = data.state;

    // Restore counters
    serialCounter = data.counters?.serialCounter ?? 0;
    customerCounter = data.counters?.customerCounter ?? 0;
    modelCounter = data.counters?.modelCounter ?? 0;
    claimCounter = data.counters?.claimCounter ?? 0;

    // Restore events
    SIM.events = data.events || [];

    // Restore random-event cooldowns and pending choice (bug fix)
    if (data.usedEvents) SIM._usedEvents = data.usedEvents;
    if (data.pendingEvent) SIM._pendingEvent = data.pendingEvent;

    // Rebuild customerEvents from events if missing
    if (!G.customerEvents || G.customerEvents.length === 0) {
      G.customerEvents = SIM.events.slice(-G.maxEvents);
    }

    // Ensure defaults for any missing properties (save compatibility)
    if (!G.company.unlockedTechs) G.company.unlockedTechs = ['Basic Manufacturing'];
    if (!G.market.activeRegulations) G.market.activeRegulations = [];
    if (!G.market.competitors) G.market.competitors = [];
    if (!G.company.serviceRegions) G.company.serviceRegions = [];
    if (G.company.marketShareBonus === undefined) G.company.marketShareBonus = 0;
    if (G.company._currentMarketShare === undefined) G.company._currentMarketShare = 0;

    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

function hasSavedGame() {
  return localStorage.getItem(SAVE_KEY) !== null;
}

function deleteSavedGame() {
  localStorage.removeItem(SAVE_KEY);
}

// ---- Financial helpers ----

function getComponentCost(componentKey, optionId) {
  const compDef = DATA.components[componentKey];
  if (!compDef) return 0;
  const opt = compDef.options.find(o => o.id === optionId);
  return opt ? opt.cost : 0;
}

function getSupplierCostMultiplier(supplierId) {
  const supplier = DATA.suppliers.find(s => s.id === supplierId);
  return supplier ? supplier.costMultiplier : 1.0;
}

function getSupplierQualityMultiplier(supplierId) {
  const supplier = DATA.suppliers.find(s => s.id === supplierId);
  return supplier ? supplier.qualityMultiplier : 1.0;
}

function getSupplierLeadTime(supplierId) {
  const supplier = DATA.suppliers.find(s => s.id === supplierId);
  return supplier ? supplier.leadTimeDays : 7;
}

// ---- Reputation tier ----

function getReputationTier(rep) {
  let tier = DATA.reputationTiers[0];
  for (const t of DATA.reputationTiers) {
    if (rep >= t.min) tier = t;
  }
  return tier;
}

// ---- Tech unlock check ----

function getUnlockedTechs(year) {
  return DATA.techUnlocks.filter(t => t.year <= year).map(t => t.name);
}

function isComponentUnlocked(componentKey, optionId, year) {
  const compDef = DATA.components[componentKey];
  if (!compDef) return true;
  const opt = compDef.options.find(o => o.id === optionId);
  if (!opt) return false;
  return opt.yearAvailable <= year;
}

function getAvailableComponentOptions(componentKey, year, unlockedTechsOverride) {
  const compDef = DATA.components[componentKey];
  if (!compDef) return [];
  // Use caller-provided tech list if given (e.g., AI has its own research);
  // otherwise fall back to the player's unlockedTechs.
  const techs = unlockedTechsOverride || (G && G.company ? G.company.unlockedTechs : null);
  return compDef.options.filter(o => {
    // Year gate: not invented yet
    if (o.yearAvailable > year) return false;
    // Tech gate: dependent tech must be researched
    if (o.techDependency && techs) {
      if (!techs.includes(o.techDependency)) return false;
    }
    return true;
  });
}
