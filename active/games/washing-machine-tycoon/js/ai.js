// ai.js — AI competitor system
// ====================================================================
// Each AI competitor designs machines, sets prices, runs production,
// and competes for market share with the player.
// Difficulty levels control how smart/aggressive they are.

const AI = {};

// ---- Initialise AI for a competitor when they enter the market ----

AI.initCompetitor = function(comp) {
  const diff = DATA.difficulty[G.difficulty] || DATA.difficulty.medium;

  comp._ai = {
    lastDesignYear: G.year - 1,
    currentModel: null,        // { components, retailPrice, cost, quality, noise, efficiency, smartFeatures }
    modelsReleased: [],
    productionLevel: 1 + Math.random() * diff.aiProductionScale,
    marketingBudget: 1000 + Math.random() * 3000,
    totalUnitsProduced: 0,
    currentReputation: diff.aiStartingRep + (comp.qualityLevel || 0.5) * 20,
    lastReputation: diff.aiStartingRep + (comp.qualityLevel || 0.5) * 20,
    marketShare: 0,
    designCounter: 0,
    adaptationRate: diff.aiAdaptSpeed + (Math.random() - 0.5) * 0.2,
  };

  // Do initial design
  AI._designNewModel(comp);

  return comp;
};

// ---- Main AI Tick ----

AI.tick = function() {
  if (G.paused) return;
  const diff = DATA.difficulty[G.difficulty] || DATA.difficulty.medium;

  for (const comp of G.market.competitors) {
    if (!comp.active) continue;

    const ai = comp._ai;
    if (!ai) continue;

    // --- 1. Decide whether to design a new model ---
    AI._checkDesign(comp, diff);

    // --- 2. Update reputation ---
    ai.lastReputation = ai.currentReputation;
    ai.currentReputation = Math.max(5, Math.min(100,
      ai.currentReputation * (1 - 0.0005 * diff.aiRepDecay) + 0.002 * (comp.qualityLevel * 10)
    ));

    // --- 3. Adjust production level based on market performance ---
    AI._adjustProduction(comp, diff);

    // --- 4. Adjust marketing ---
    AI._adjustMarketing(comp, diff);

    // --- 5. Produce units ---
    AI._produceUnits(comp, diff);
  }
};

// ---- Check & Design New Model ----

AI._checkDesign = function(comp, diff) {
  const ai = comp._ai;
  if (!ai.currentModel) {
    AI._designNewModel(comp);
    return;
  }

  // Design frequency depends on difficulty
  const yearsSinceDesign = G.year - ai.lastDesignYear;
  const designInterval = Math.max(2, Math.round(6 * diff.aiDesignFrequency + (Math.random() - 0.5) * 2));

  if (yearsSinceDesign >= designInterval) {
    // Also check if a new tech unlock or regulation makes redesign worthwhile
    const hasRegulationChange = G.market.activeRegulations.length > 0 &&
      ai.lastDesignYear < G.market.activeRegulations[G.market.activeRegulations.length - 1].year;

    if (yearsSinceDesign >= designInterval || hasRegulationChange) {
      AI._designNewModel(comp);
    }
  }
};

AI._designNewModel = function(comp) {
  const ai = comp._ai;
  const diff = DATA.difficulty[G.difficulty] || DATA.difficulty.medium;
  const strategy = comp.focusComponents;

  // Pick components — blend strategy with what's available and difficulty bias
  const components = {};
  let totalCost = 30;

  for (const key of Object.keys(DATA.components)) {
    const compDef = DATA.components[key];
    if (!compDef) continue;
    const available = compDef.options.filter(o => o.yearAvailable <= G.year);
    if (available.length === 0) continue;

    // Try to use the strategy's preferred component, falling back if not yet available
    const preferred = strategy[key];
    let chosen;
    if (preferred) {
      const prefOpt = available.find(o => o.id === preferred);
      if (prefOpt) {
        chosen = prefOpt;
      }
    }

    // If no preferred choice or not available, pick based on strategy/quality bias
    if (!chosen) {
      // Strategy-based selection
      const qualityShift = diff.aiQualityBias + (comp.qualityLevel - 0.5) * 0.4;
      const scoreFn = (o) => {
        let score = o.durability || 0.5;
        // Bias toward cost-effective or premium based on strategy
        if (comp.id === 'cheapImports') score = (1 - o.durability || 0.5) * 0.7 + (1 - o.cost / 100) * 0.3;
        else if (comp.id === 'germanEngineering') score = (o.durability || 0.5) * 0.8 + (o.marketingAppeal || 0) * 0.2;
        else if (comp.id === 'smartHome') score = (o.marketingAppeal || 0) * 0.5 + (o.durability || 0.5) * 0.3 + (o.energyEfficiency || 0.5) * 0.2;
        else if (comp.id === 'commercialDurability') score = (o.durability || 0.5) * 0.9 + (o.repairCost || 0.5) * 0.1;
        else if (comp.id === 'ecoFriendly') score = (o.energyEfficiency || 0.5) * 0.5 + (o.durability || 0.5) * 0.5;
        score += qualityShift;
        // Add noise for variety
        score += (Math.random() - 0.5) * 0.15;
        return score;
      };

      // Sort by score and pick top (with some randomness on harder difficulties)
      const sorted = [...available].sort((a, b) => scoreFn(b) - scoreFn(a));
      const pickIndex = Math.random() < diff.aiAdaptSpeed ? 0 : Math.floor(Math.random() * Math.min(3, sorted.length));
      chosen = sorted[pickIndex];
    }

    components[key] = chosen.id;
    totalCost += chosen.cost;
  }

  // Set price based on strategy
  let priceMultiplier;
  switch (comp.priceStrategy) {
    case 'budget':  priceMultiplier = 1.1 + Math.random() * 0.2; break;
    case 'mid':     priceMultiplier = 1.4 + Math.random() * 0.3; break;
    case 'premium': priceMultiplier = 1.8 + Math.random() * 0.5; break;
    default:        priceMultiplier = 1.3 + Math.random() * 0.3;
  }

  const retailPrice = Math.round(totalCost * priceMultiplier);

  // Calculate quality, noise, efficiency
  const quality = computeModelQuality(components);
  const noise = computeModelNoise(components);
  const efficiency = computeModelEnergyEfficiency(components);
  const smartFeatures = computeModelSmartFeatures(components);

  ai.currentModel = {
    components,
    retailPrice,
    cost: totalCost,
    quality,
    noise,
    efficiency,
    smartFeatures,
    yearIntroduced: G.year,
  };

  ai.modelsReleased.push({ ...ai.currentModel });
  ai.lastDesignYear = G.year;
  ai.designCounter = (ai.designCounter || 0) + 1;

  // Log significant events (first design and each new design)
  if (ai.designCounter <= 1 || ai.designCounter % 3 === 0) {
    SIM.addEvent('info', `🏭 ${comp.name} released a new model (${G.year})`);
  }
};

// ---- Adjust Production ----

AI._adjustProduction = function(comp, diff) {
  const ai = comp._ai;
  // Ramp up production when market share is growing, ease off when shrinking
  const shareTrend = ai.marketShare - (comp.marketShare || 0);

  let targetLevel;
  if (shareTrend > 0.5) {
    targetLevel = Math.min(5, ai.productionLevel + 0.3 * diff.aiAdaptSpeed);
  } else if (shareTrend < -0.5) {
    targetLevel = Math.max(0.5, ai.productionLevel - 0.2 * diff.aiAdaptSpeed);
  } else {
    targetLevel = ai.productionLevel + (Math.random() - 0.5) * 0.1;
  }

  // Difficulty scale
  targetLevel *= (0.5 + diff.aiProductionScale * 0.5);
  ai.productionLevel = Math.max(0.3, Math.min(8, targetLevel));
};

// ---- Adjust Marketing ----

AI._adjustMarketing = function(comp, diff) {
  const ai = comp._ai;
  const baseBudget = 500 + comp.aggressiveness * 4000;
  // Scale with reputation and difficulty
  const repFactor = ai.currentReputation / 50;
  ai.marketingBudget = Math.max(0, Math.round(baseBudget * repFactor * diff.aiProductionScale));
};

// ---- Produce Units ----

AI._produceUnits = function(comp, diff) {
  const ai = comp._ai;
  if (!ai.currentModel) return;

  // Daily production
  const dailyOutput = ai.productionLevel * (1 + diff.aiProductionScale * 0.2);
  ai.totalUnitsProduced += dailyOutput;

  // Track cumulative production for market share calc
  comp.machinesSold = ai.totalUnitsProduced;
};

// ---- Calculate AI Competitiveness Score ----
// Used by sales system to split market share

AI.calcCompetitiveness = function(comp) {
  const ai = comp._ai;
  if (!ai || !ai.currentModel) return 0;

  const model = ai.currentModel;
  const diff = DATA.difficulty[G.difficulty] || DATA.difficulty.medium;

  // Score based on quality, price, reputation, marketing
  const qualityScore = model.quality * 100;
  const priceScore = Math.max(0, 100 - (model.retailPrice / 10));
  const repScore = ai.currentReputation;
  const marketingScore = Math.min(50, ai.marketingBudget / 200);
  // Noise matters too (lower is better)
  const noiseScore = Math.max(0, 50 - model.noise * 50);
  // Efficiency matters
  const efficiencyScore = model.efficiency * 50;

  const total = qualityScore * 0.3 +
                priceScore * 0.2 +
                repScore * 0.25 +
                marketingScore * 0.1 +
                noiseScore * 0.05 +
                efficiencyScore * 0.1;

  // Add randomness for variety
  return total * (0.9 + Math.random() * 0.2) * (0.8 + diff.aiAdaptSpeed * 0.2);
};

// ---- Format AI info for UI ----

AI.getSummary = function(comp) {
  const ai = comp._ai;
  if (!ai || !ai.currentModel) {
    return { model: '—', price: '—', quality: '—', production: '—', marketing: '—', reputation: '—' };
  }
  return {
    model: `${ai.currentModel.yearIntroduced}`,
    price: `$${ai.currentModel.retailPrice}`,
    quality: `${(ai.currentModel.quality * 100).toFixed(0)}%`,
    production: `${ai.productionLevel.toFixed(1)}x`,
    marketing: `$${Math.round(ai.marketingBudget).toLocaleString()}/mo`,
    reputation: `${Math.round(ai.currentReputation)}%`,
  };
};
