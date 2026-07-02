// simulation.js — Main simulation tick and systems
// ====================================================================
// Depends on: data.js, game.js

const SIM = {};

// ---- Main Tick ----
// Called each game day (or multiple days if fast-forwarding)

SIM.tick = function() {
  if (G.paused) return;
  G.tickCount++;
  G.day++;

  // Year rollover
  if (G.day >= daysInYear(G.year)) {
    SIM.handleYearEnd();
    G.day = 0;
    G.year++;
    SIM.handleYearStart();
  }

  // Run systems (order matters)
  SIM.systemAI();              // AI decisions before production/sales
  SIM.systemProduction();
  SIM.systemSales();           // market-share-based now
  SIM.systemAging();
  SIM.systemFailures();
  SIM.systemWarrantyService();
  SIM.systemCustomerSatisfaction();
  SIM.systemFinance();
  SIM.systemCompetitors();
  SIM.systemRegulations();
  SIM.systemTechUnlocks();
  SIM.systemRandomEvents();

  // Auto-save every 30 game days
  if (G.tickCount % 30 === 0) {
    try { saveGame(); } catch(e) { /* silent */ }
  }
};

// ---- Year Start/End ----

SIM.handleYearStart = function() {
  // Market grows
  G.market.totalMarketSize = Math.floor(
    DATA.defaults.marketSize * Math.pow(1 + DATA.defaults.marketGrowthRate, G.year - DATA.defaults.baseYear)
  );

  // Reset yearly sales counter
  G.market.soldThisYear = 0;

  // Add event
  SIM.addEvent('info', `📅 Year ${G.year} begins. Market size: ~${(G.market.totalMarketSize/1000).toFixed(0)}K households.`);
};

SIM.handleYearEnd = function() {
  // Archive yearly sales
  G.market.yearSales.push({
    year: G.year,
    sold: G.market.soldThisYear,
  });

  // Annual reputation decay (small)
  G.company.reputation = Math.max(0, G.company.reputation - 0.5);

  // Annual technician salary (the daily systemFinance overhead is separate
  // and small; this is the real annual payroll booked at year end).
  const techCost = G.company.technicians * DATA.defaults.dailyTechnicianCost * 365;
  G.company.cash -= techCost;
  G.company.totalExpenses += techCost;

  // NOTE: marketing budget and R&D spending are already accrued DAILY by
  // systemFinance (budget/30 and spending/30). Do NOT deduct them again
  // here — that would double-count (bug #13).

  // NOTE: researchLevel progress is now accrued DAILY in systemFinance.
  // The old yearly bump (spending * 0.01) has been removed to avoid
  // double-counting. R&D progress is now smooth and responsive.

  // Record history snapshot for charts
  const totalComp = G.market.competitors.filter(c => c.active).reduce((s, c) => s + c.machinesSold, 0);
  const totalAll = G.company.totalMachinesSold + totalComp;
  const share = totalAll > 0 ? (G.company.totalMachinesSold / totalAll) * 100 : 0;

  // Use financial deltas from previous year-end
  const yearRevenue = G.company.totalRevenue - (G._lastYearRevenue || 0);
  const yearExpenses = G.company.totalExpenses - (G._lastYearExpenses || 0);
  G._lastYearRevenue = G.company.totalRevenue;
  G._lastYearExpenses = G.company.totalExpenses;

  G.history.years.push(G.year);
  G.history.reputation.push(Math.round(G.company.reputation));
  G.history.cash.push(Math.round(G.company.cash));
  G.history.revenue.push(Math.round(yearRevenue));
  G.history.expenses.push(Math.round(yearExpenses));
  G.history.machinesSold.push(G.market.soldThisYear);
  G.history.marketShare.push(Math.round(share * 10) / 10);
};

// ---- Production System ----

SIM.systemProduction = function() {
  for (const line of G.company.productionLines) {
    if (!line.active) continue;
    const model = G.company.models.find(m => m.id === line.modelId);
    if (!model) continue;

    // Production rate (units per day)
    // Base: 5 units/day/line, modified by quality control level
    const qcFactor = 1.0 - (line.qualityControl || 0) * 0.3; // QC slows production
    const dailyOutput = Math.max(0.5, line.speed * qcFactor);

    // Production cost per unit with supplier modifiers
    let unitCost = model.productionCost;
    for (const key of Object.keys(model.components)) {
      const supplierId = G.company.suppliers[key] || 'nationalSupplier';
      unitCost *= (1 + (getSupplierCostMultiplier(supplierId) - 1.0) / 7);
    }

    // Quality control reduces defect rate
    const defectRate = 0.05 * (1 - (line.qualityControl || 0) * 0.8);
    const defects = dailyOutput * defectRate;
    const goodUnits = dailyOutput - defects;

    // Cost to produce
    const productionCost = dailyOutput * unitCost;
    G.company.cash -= productionCost;
    G.company.totalExpenses += productionCost;

    // Add good units to queue for sale
    G.company.productionQueue += goodUnits;
    model.totalProduced += goodUnits;

    // Defects cost money but can be reworked
    G.company.cash -= defects * unitCost * 0.3; // rework cost
  }
};

// ---- Market-Share-Based Sales System ----
// Player and all active AI competitors compete for a share of daily demand

SIM.systemSales = function() {
  // 1. Calculate total market demand for the day
  const baseDemand = G.market.totalMarketSize * 0.0003; // 0.03% of market
  const dailyDemand = Math.max(0.5, baseDemand);

  // 2. Collect all market participants (player + active AI competitors)
  const participants = [];

  // Player — only count SELLABLE models (regulation-gated)
  const sellableModels = G.company.models.filter(m => m.isActive && SIM.isModelSellable(m));
  if (sellableModels.length > 0 && G.company.productionQueue >= 0.1) {
    // Calculate player competitiveness from sellable models only
    const repFactor = G.company.reputation / 100;
    const marketingFactor = Math.min(1, G.company.marketingBudget / 5000);
    const avgModelQuality = sellableModels.reduce((s, m) => s + m.qualityRating, 0) / sellableModels.length;
    const avgPrice = sellableModels.reduce((s, m) => s + (m.currentPrice || m.retailPrice), 0) / sellableModels.length;

    const playerScore =
      avgModelQuality * 50 * 0.3 +
      Math.max(0, 100 - avgPrice / 10) * 0.2 +
      repFactor * 100 * 0.25 +
      marketingFactor * 50 * 0.1 +
      G.company.customerSatisfactionAvg * 50 * 0.1 +
      (G.company.marketShareBonus || 0) +
      Math.random() * 5; // small randomness

    participants.push({
      id: 'player',
      name: G.company.name,
      score: Math.max(1, playerScore),
      isPlayer: true,
    });

    // Log a warning if sellable models < active models (regulation blocking)
    const blockedCount = G.company.models.length - sellableModels.length;
    if (blockedCount > 0 && Math.random() < 0.01) { // ~once per 100 ticks
      SIM.addEvent('warning', `📋 ${blockedCount} model(s) blocked by regulations — redesign to comply!`);
    }
  } else if (G.company.models.filter(m => m.isActive).length > 0 && sellableModels.length === 0) {
    // All models are non-compliant! Fire a warning (throttled).
    if (G.tickCount % 30 === 0) {
      SIM.addEvent('critical', `🚫 No compliant models! Redesign to meet current regulations.`);
    }
  }

  // AI competitors
  for (const comp of G.market.competitors) {
    if (!comp.active) continue;
    const compScore = AI.calcCompetitiveness(comp);
    if (compScore > 0) {
      participants.push({
        id: comp.id,
        name: comp.name,
        score: compScore,
        isPlayer: false,
        competitor: comp,
      });
    }
  }

  if (participants.length === 0) return;

  // 3. Calculate total score and allocate market share
  const totalScore = participants.reduce((s, p) => s + p.score, 0);

  // Record player share as the authoritative value (used by UI.calcMarketShare)
  G.company._currentMarketShare = 0;

  // 4. Sell to player's share
  const player = participants.find(p => p.isPlayer);
  if (player) {
    const playerShare = player.score / totalScore;
    G.company._currentMarketShare = playerShare * 100;
    const playerAllocation = Math.floor(dailyDemand * playerShare);
    const toSell = Math.min(Math.floor(G.company.productionQueue), playerAllocation);

    if (toSell > 0) {
      const model = sellableModels[Math.floor(Math.random() * sellableModels.length)];

      for (let i = 0; i < toSell; i++) {
        const customerType = SIM.pickCustomerType();
        const customerId = nextCustomerId();
        const machine = createMachine(model.id, customerId, customerType.id);
        if (!machine) continue;

        let salePrice = model.currentPrice || model.retailPrice;
        salePrice *= (1 + (G.year - (DATA.defaults.baseYear || 1945)) * 0.008);

        G.company.activeMachines.push(machine);
        G.company.totalMachinesSold++;
        G.market.soldThisYear++;
        G.company.cash += salePrice;
        G.company.totalRevenue += salePrice;
      }

      G.company.productionQueue -= toSell;
    }
  }

  // 5. Update AI competitor market shares
  for (const p of participants) {
    if (p.isPlayer) continue;
    const share = p.score / totalScore;
    const aiAllocation = dailyDemand * share;
    p.competitor.marketShare = share * 100;
    if (p.competitor._ai) {
      p.competitor._ai.marketShare = p.competitor.marketShare;
    }
  }

  // Player market share (calc separately since it's based on active machines)
  // This is calculated in UI.calcMarketShare for display
};

SIM.pickCustomerType = function() {
  const types = DATA.customerTypes;
  const weights = types.map(t => t.probabilityWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
};

// ---- Aging System ----

SIM.systemAging = function() {
  for (const machine of G.company.activeMachines) {
    if (machine.currentStatus === 'disposed') continue;
    machine.ageDays++;
    if (machine.currentStatus === 'broken') continue; // broken machines don't accumulate loads

    // Simulate loads per day based on customer type — accumulate the full
    // expected count, not a capped single load (fixes under-counting wear).
    const custType = DATA.customerTypes.find(t => t.id === machine.customerType);
    const loadsPerDayRaw = custType ? custType.loadsPerWeek / 7 : 0.3;
    const wholeLoads = Math.floor(loadsPerDayRaw);
    const fracLoad = loadsPerDayRaw - wholeLoads;
    // Whole loads always happen; fractional part probabilistic.
    let loadsToday = wholeLoads + (Math.random() < fracLoad ? 1 : 0);
    machine._loadsThisDay = loadsToday;
    machine.loadsCompleted += loadsToday;
  }
};

// ---- Failure System ----

SIM.systemFailures = function() {
  for (const machine of G.company.activeMachines) {
    if (machine.currentStatus !== 'active') continue;

    const model = G.company.models.find(m => m.id === machine.modelId);
    if (!model) continue;

    const custType = DATA.customerTypes.find(t => t.id === machine.customerType);
    const wearMultiplier = custType ? custType.wearFactor : 1.0;

    // Loads done TODAY (computed by systemAging). Default to the daily
    // expectation if aging didn't run first for some reason.
    const loadsToday = (machine._loadsThisDay !== undefined)
      ? machine._loadsThisDay
      : (custType ? custType.loadsPerWeek / 7 : 0.3);
    if (loadsToday <= 0) continue; // no usage → no failures this tick

    const ageYears = machine.ageDays / 365;
    // Older machines wear faster, but bounded so very new machines aren't
    // immune and very old ones don't fail every load.
    const ageFactor = 1 + Math.min(4, ageYears * 0.15);

    // Check each failure type — probability is PER LOAD, not cumulative.
    for (const failureDef of DATA.failureTypes) {
      // Base rate is per-load; scale by how many loads happened today.
      let probPerLoad = failureDef.baseRate * wearMultiplier * ageFactor;

      // Adjust based on component quality (better parts = fewer failures).
      const compSource = failureDef.componentSource;
      const compChoice = model.components[compSource];
      if (compChoice) {
        const compDef = DATA.components[compSource];
        if (compDef) {
          const opt = compDef.options.find(o => o.id === compChoice);
          if (opt) {
            probPerLoad *= (1 - opt.durability * 0.7);
          }
        }
      }

      // Supplier quality modifier (component sourcing improvement).
      probPerLoad *= (1 / getEffectiveQualityMultiplier());

      // Per-load probability → probability of ≥1 failure across today's loads:
      //   P(fail) = 1 - (1-p)^n   (avoids the n*p approximation blowing past 1).
      const probToday = 1 - Math.pow(1 - Math.min(0.5, probPerLoad), loadsToday);

      if (Math.random() < Math.min(0.25, probToday)) { // cap a single failure-type at 25% per day
        // Failure occurs
        machine.currentStatus = 'broken';
        machine.lastFailureDay = G.day;
        // Reset today's load counter so we don't double-charge wear this tick.
        machine._loadsThisDay = 0;

        // Create warranty claim
        const claim = createClaim(machine, failureDef.id);
        if (claim) {
          // Assign region based on customer ID hash
          const regionIdx = parseInt(machine.customerId.slice(-2), 16) % DATA.serviceRegions.length;
          claim.region = DATA.serviceRegions[regionIdx].id;
          G.company.pendingClaims.push(claim);
          machine.failures.push({
            day: G.day,
            year: G.year,
            failureType: failureDef.id,
            resolved: false,
          });
          model.totalFailed++;

          SIM.addEvent('warning', `⚠️ ${failureDef.name} — ${machine.serial} (${formatDate(G.year, G.day)})`);
        }
        break; // one failure at a time per machine
      }
    }
  }
};

// ---- Warranty & Service System ----

SIM.systemWarrantyService = function() {
  const pending = [...G.company.pendingClaims];
  for (const claim of pending) {
    claim.daysOpen++;

    // Assign a technician if possible (queue'ed, not auto-resolved) so that
    // in-warranty/open claims wait for the player to pick a resolution.
    if (!claim.assignedTech && claim.daysOpen > 1) {
      const region = G.company.serviceRegions.find(r => r.id === claim.region);
      if (region && region.techCount > 0) {
        claim.assignedTech = true;
        claim.status = 'assigned';   // still 'actionable' from the player's POV
        region.activeJobs.push(claim.id);
        claim._assignedOn = claim._assignedOn || G.day;
      }
    }

    // OUT-OF-WARRANTY claims are auto-resolved by the tech after a delay —
    // the customer already paid or declined without manufacturer involvement.
    if (!claim.inWarranty && claim.status === 'assigned' && claim._assignedOn !== undefined) {
      const region = G.company.serviceRegions.find(r => r.id === claim.region);
      const resolutionDays = 2 + Math.floor(Math.random() * 4) - Math.floor((region?.techCount || 0) / 2);
      if (G.day - claim._assignedOn >= Math.max(1, resolutionDays)) {
        SIM.resolveClaim(claim);
      }
    }

    // Claims that are too old get antsy — escalate for player attention only,
    // but do NOT auto-resolve. (Player can still decline.)
    if (claim.daysOpen > 14 && claim.status === 'open' && !claim.assignedTech) {
      // Emergency dispatch attempt, but resolution still waits for player.
      const region = G.company.serviceRegions.find(r => r.id === claim.region);
      if (region && region.techCount > 0) {
        claim.assignedTech = true;
        claim.status = 'assigned';
        claim._assignedOn = G.day;
        region.activeJobs.push(claim.id);
        SIM.addEvent('info', `🔄 Emergency dispatch for ${claim.id} (overdue)`);
      }
    }
  }
};

SIM.resolveClaim = function(claim, forcedResolution) {
  // forcedResolution (optional) honours the player's chosen resolution from
  // the Service Dept UI. If omitted, pick a sensible default per warranty.
  const resolutionDef = DATA.resolutionOptions.find(o => o.id === forcedResolution);
  let resolution = resolutionDef ? forcedResolution : null;

  if (!resolution) {
    const isMajor = claim.severity === 'critical' || claim.severity === 'major';
    if (claim.inWarranty) {
      // In warranty — manufacturer covers: repair (minor) or replace (major).
      resolution = (isMajor && Math.random() < 0.3) ? 'replaceMachine' : 'repair';
    } else {
      // Out of warranty — customer decides: usually repair or discount.
      const r = Math.random();
      if (r < 0.4) resolution = 'repair';
      else if (r < 0.6) resolution = 'discount';
      else if (r < 0.8) resolution = 'replaceMachine';
      else resolution = 'decline';
    }
  }

  // Calculate cost
  let cost = 0;
  if (resolution === 'repair') {
    cost = claim.repairCost * 1.2;
  } else if (resolution === 'discount') {
    cost = claim.repairCost * 0.5 + 50;
  } else if (resolution === 'replaceMachine') {
    const model = G.company.models.find(m => m.id === claim.modelId);
    cost = model ? model.productionCost * 1.5 : 200;
  }

  // Apply the CORRECT supplier cost modifier for the failed component
  // (was: always bearings — bug #4).
  const supplierKey = (function() {
    const failureDef = DATA.failureTypes.find(f => f.id === claim.failureType);
    return failureDef ? failureDef.componentSource : 'bearings';
  })();
  const supplierId = G.company.suppliers[supplierKey] || 'nationalSupplier';
  cost *= getSupplierCostMultiplier(supplierId);

  // Apply resolution
  if (resolution === 'decline') {
    claim.status = 'declined';
  } else {
    claim.status = 'resolved';
    G.company.cash -= cost;
    G.company.totalExpenses += cost;
    G.company.totalWarrantyCost += cost;
    // Decrement the region's active job count if one was assigned.
    if (claim.region) {
      const region = G.company.serviceRegions.find(r => r.id === claim.region);
      if (region) {
        const idx = region.activeJobs.indexOf(claim.id);
        if (idx >= 0) region.activeJobs.splice(idx, 1);
      }
    }
  }
  claim.resolution = resolution;
  claim._resolvedOnDay = G.day;

  // Update the machine
  const machine = G.company.activeMachines.find(m => m.serial === claim.machineSerial);
  if (machine) {
    const failure = machine.failures.find(f => !f.resolved);
    if (failure) failure.resolved = true;

    if (resolution === 'replaceMachine') {
      // New machine replaces the old one — reset wear & history so the
      // Machine Browser doesn't show a "0-day-old" unit with 30 past
      // failures (bug #16). Also mint a fresh serial so the fleet list
      // and claims line up with a distinct unit.
      machine.serial = nextSerial();
      machine.currentStatus = 'active';
      machine.loadsCompleted = 0;
      machine.ageDays = 0;
      machine._loadsThisDay = 0;
      machine.failures = [];
      machine.totalRepairCost = 0;
      machine.satisfactionScore = 0.5;
    } else if (resolution !== 'decline') {
      machine.currentStatus = 'active';
      machine.totalRepairCost += cost;
    } else {
      machine.currentStatus = 'disposed';
    }

    // Update satisfaction
    const satDelta = resolutionDef ? resolutionDef.satisfaction : 0;
    machine.satisfactionScore = Math.max(0, Math.min(1, machine.satisfactionScore + satDelta * 0.3));
  }

  // Reputation impact
  const repImpact = resolution === 'decline'
    ? claim.brandRepImpact * 1.5
    : -claim.brandRepImpact * 0.3; // handling well can boost reputation slightly

  G.company.reputation = Math.max(0, Math.min(100, G.company.reputation - repImpact));

  G.company.totalClaimsResolved++;

  // Remove from pending
  const idx = G.company.pendingClaims.indexOf(claim);
  if (idx >= 0) G.company.pendingClaims.splice(idx, 1);
};

// ---- Customer Satisfaction System ----

SIM.systemCustomerSatisfaction = function() {
  let totalSat = 0;
  let count = 0;

  for (const machine of G.company.activeMachines) {
    if (machine.currentStatus === 'disposed') continue;

    // Age affects satisfaction (older machines are less satisfying)
    const ageFactor = Math.max(0.5, 1 - (machine.ageDays / (365 * 12)));
    machine.satisfactionScore = Math.max(0, Math.min(1,
      machine.satisfactionScore * 0.99 + (ageFactor - 0.5) * 0.01
    ));

    // Broken machines = unhappy
    if (machine.currentStatus === 'broken') {
      machine.satisfactionScore = Math.max(0, machine.satisfactionScore - 0.02);
    }

    totalSat += machine.satisfactionScore;
    count++;
  }

  G.company.customerSatisfactionAvg = count > 0 ? totalSat / count : 0.5;

  // Satisfaction influences reputation
  const repDelta = (G.company.customerSatisfactionAvg - 0.5) * 0.01;
  G.company.reputation = Math.max(0, Math.min(100, G.company.reputation + repDelta));
};

// ---- Finance System ----

SIM.systemFinance = function() {
  // Daily overhead
  const overhead = 50 + G.company.technicians * 5;
  G.company.cash -= overhead;
  G.company.totalExpenses += overhead;

  // Marketing daily spend (monthly budget / 30)
  const dailyMarketing = G.company.marketingBudget / 30;
  G.company.cash -= dailyMarketing;
  G.company.totalExpenses += dailyMarketing;

  // Research daily spend
  const dailyResearch = G.company.researchSpending / 30;
  G.company.cash -= dailyResearch;
  G.company.totalExpenses += dailyResearch;

  // Daily research progress: same rate as the yearly formula (spending*0.01)
  // but spread smoothly across days so progress feels responsive.
  G.company.researchLevel += dailyResearch * 0.01 * (30 / 365);

  // Bankrupt check
  if (G.company.cash < -100000) {
    SIM.addEvent('critical', `🚨 BANKRUPTCY WARNING! Debt: $${Math.abs(G.company.cash).toLocaleString()}`);
  }
};

// ---- AI System ----
// Runs AI competitor decisions every tick

SIM.systemAI = function() {
  // Activate competitors based on year
  for (const comp of G.market.competitors) {
    if (!comp.active && comp.startingYear <= G.year) {
      comp.active = true;
      AI.initCompetitor(comp);
      SIM.addEvent('info', `🏭 Competitor enters market: ${comp.name}`);
    }
  }

  // Run AI decisions for all active competitors
  AI.tick();
};

// ---- Competitor System (simplified — now market share is computed in sales) ----

SIM.systemCompetitors = function() {
  // Market share is now calculated per-tick in SIM.systemSales
  // This function just tracks historical data
  for (const comp of G.market.competitors) {
    if (!comp.active) continue;
    // machinesSold is updated by AI._produceUnits
    // marketShare is updated by sales allocation
  }
};

// ---- Regulation System ----
// Regulations now have real teeth: a model's compliance is checked every
// day during sales. Non-compliant models earn zero revenue (blocked).

SIM.systemRegulations = function() {
  for (const reg of DATA.regulations) {
    if (reg.year === G.year && !G.market.activeRegulations.find(r => r.year === reg.year)) {
      // Parse the effect string into structured thresholds.
      const parsed = SIM._parseRegulationEffect(reg.effect || '');
      const entry = { ...reg, thresholds: parsed };
      G.market.activeRegulations.push(entry);

      SIM.addEvent('warning', `📋 NEW REGULATION: ${reg.name} — ${reg.description}`);
      for (const msg of parsed._events) {
        SIM.addEvent('info', msg);
      }
    }
  }
};

// Parse effect strings like 'noiseMax:75' or 'energyReq:0.55' or 'rohs:true'
// into a plain object of thresholds that getModelCompliance checks.
SIM._parseRegulationEffect = function(effectStr) {
  const out = { _events: [] };
  for (const part of effectStr.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Some multi-effects might be pipe-separated in future; for now use colon.
    // e.g. 'noiseMax:75', 'energyReq:0.55', 'waterMax:40', 'rohs:true',
    //      'smartGrid:true', 'partsMandate:10'
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (key === 'noiseMax') {
      out.noiseMax = parseFloat(rawVal);
      out._events.push(`🔇 Noise limit: max ${out.noiseMax}dB — check machine noise levels!`);
    } else if (key === 'waterMax') {
      out.waterMax = parseInt(rawVal, 10);
      out._events.push(`💧 Water usage limit: max ${out.waterMax}L per cycle`);
    } else if (key === 'energyReq') {
      out.energyReq = parseFloat(rawVal);
      out._events.push(`⚡ Minimum energy efficiency: ${(out.energyReq * 100).toFixed(0)}%`);
    } else if (key === 'rohs') {
      out.rohs = rawVal === 'true' || rawVal === 'True';
      out._events.push(`🧪 RoHS compliance required — electronic components must be lead-free.`);
    } else if (key === 'smartGrid') {
      out.smartGrid = rawVal === 'true' || rawVal === 'True';
      out._events.push(`📡 Smart grid ready: new models must support demand-response.`);
    } else if (key === 'partsMandate') {
      out.partsMandate = parseInt(rawVal, 10);
      out._events.push(`🔧 Right to Repair — parts must be available for ${out.partsMandate} years.`);
    }
  }
  return out;
};

// Check a model's components against all active regulations.
// Returns { compliant, reasons[] } where reasons list what's violated.
SIM.getModelCompliance = function(model) {
  const result = { compliant: true, reasons: [] };
  if (!model || !model.components) return result;

  for (const reg of G.market.activeRegulations) {
    const t = reg.thresholds || {};

    // Noise check: model's computed noise must be <= noiseMax / 100 (normalised to 0-1)
    if (t.noiseMax !== undefined) {
      const modelNoise = computeModelNoise(model.components);
      const threshold = t.noiseMax / 100; // 75dB → 0.75
      if (modelNoise > threshold) {
        result.compliant = false;
        result.reasons.push(`❌ ${reg.name}: noise too high (${(modelNoise * 100).toFixed(0)} > ${t.noiseMax}dB)`);
      }
    }

    // Energy efficiency: model's energy must be >= threshold
    if (t.energyReq !== undefined) {
      const modelEff = computeModelEnergyEfficiency(model.components);
      if (modelEff < t.energyReq) {
        result.compliant = false;
        result.reasons.push(`❌ ${reg.name}: energy efficiency too low (${(modelEff * 100).toFixed(0)}% < ${(t.energyReq * 100).toFixed(0)}%)`);
      }
    }

    // Water usage: estimated from pump flow rate (simple heuristic)
    if (t.waterMax !== undefined) {
      const pumpOpt = DATA.components.pump.options.find(o => o.id === model.components.pump);
      const flowRate = pumpOpt ? pumpOpt.flowRate || 0.5 : 0.5;
      // Estimate L/cycle from flow rate (higher flow = more water used)
      const waterEst = Math.round(30 + (1 - flowRate) * 40);
      if (waterEst > t.waterMax) {
        result.compliant = false;
        result.reasons.push(`❌ ${reg.name}: estimated water usage ${waterEst}L > ${t.waterMax}L limit`);
      }
    }

    // RoHS: control board must not be a mechanical timer
    if (t.rohs) {
      const boardOpt = DATA.components.controlBoard.options.find(o => o.id === model.components.controlBoard);
      if (boardOpt && (boardOpt.id === 'timer' || boardOpt.id === 'multicam')) {
        result.compliant = false;
        result.reasons.push(`❌ ${reg.name}: mechanical timer contains lead solder — upgrade to push-button or digital board`);
      }
    }

    // Smart Grid: control board needs smart features > 0
    if (t.smartGrid) {
      const boardOpt = DATA.components.controlBoard.options.find(o => o.id === model.components.controlBoard);
      if (!boardOpt || boardOpt.smartFeatures === undefined || boardOpt.smartFeatures < 0.2) {
        result.compliant = false;
        result.reasons.push(`❌ ${reg.name}: smart grid ready required — upgrade control board`);
      }
    }

    // Parts Mandate: affects reputation penalty for not supporting old models
    if (t.partsMandate !== undefined) {
      // Check: are ANY models older than partsMandate years still active?
      for (const m of G.company.models) {
        if (m.isActive && G.year - m.yearIntroduced >= t.partsMandate) {
          // Not a block, but a reputation penalty applied elsewhere
          // Just flag it.
          result.reasons.push(`⚠️ ${reg.name}: ${m.name} (${m.yearIntroduced}) is over ${t.partsMandate} years old — must keep parts available`);
        }
      }
    }
  }

  return result;
};

// Is a given model currently sellable? (compliance check)
SIM.isModelSellable = function(model) {
  if (!model || !model.isActive) return false;
  const compliance = SIM.getModelCompliance(model);
  return compliance.compliant;
};

// ---- Tech Unlock System ----
// Techs unlock when both the year AND accumulated researchLevel meet
// the threshold. This means passive year progress isn't enough — you
// must invest in R&D to keep up with the industry.

SIM.systemTechUnlocks = function() {
  for (const tech of DATA.techUnlocks) {
    if (tech.year > G.year) continue;                 // not yet invented
    if (G.company.unlockedTechs.includes(tech.name)) continue; // already done
    const needed = tech.requiredLevel !== undefined ? tech.requiredLevel : 0;
    if (G.company.researchLevel < needed) continue;   // not enough research

    G.company.unlockedTechs.push(tech.name);
    SIM.addEvent('info', `🔬 TECH UNLOCKED: ${tech.name} — ${tech.description}`);
    // If the year-end logging also happens, that's fine — duplicates
    // are prevented by the already-unlocked check.
  }
};

// ---- Random Events System ----

SIM._usedEvents = {};         // event id -> year last triggered
SIM._pendingEvent = null;     // event awaiting player choice

SIM.systemRandomEvents = function() {
  // Only check on day 1 of each month (roughly every 30 days)
  if (G.day % 30 !== 1) return;

  // Don't fire if already showing an event
  if (SIM._pendingEvent) return;

  // Don't fire too early — let the game establish itself
  if (G.tickCount < 365) return;

  const events = DATA.events.list;
  const diff = DATA.difficulty[G.difficulty] || DATA.difficulty.medium;

  // Filter eligible events
  const eligible = events.filter(e => {
    // Year gate
    if (e.minYear && G.year < e.minYear) return false;
    if (e.maxYear && G.year > e.maxYear) return false;
    // Cooldown — don't repeat too often
    if (SIM._usedEvents[e.id]) {
      const yearsSince = G.year - SIM._usedEvents[e.id];
      if (yearsSince < (e.cooldownYears || 3)) return false;
    }
    // Requires models
    if (e.requiresModels && G.company.models.length === 0) return false;
    // Requires minimum reputation
    if (e.minRep !== undefined && G.company.reputation < e.minRep) return false;
    // Max reputation
    if (e.maxRep !== undefined && G.company.reputation > e.maxRep) return false;
    return true;
  });

  if (eligible.length === 0) return;

  // Weighted random selection
  const totalWeight = eligible.reduce((s, e) => s + (e.weight || 5), 0);
  let roll = Math.random() * totalWeight;

  // Base chance scales with difficulty (more events on harder modes)
  const chanceMultiplier = diff.aiAdaptSpeed || 0.6;
  if (Math.random() > 0.04 * chanceMultiplier) return; // ~4% chance per check (~3-5 events/year)

  let selected = eligible[0];
  for (const e of eligible) {
    roll -= e.weight || 5;
    if (roll <= 0) { selected = e; break; }
  }

  if (!selected) return;

  // Mark cooldown
  SIM._usedEvents[selected.id] = G.year;

  // For choice events, store them pending player decision
  if (selected.type === 'choice') {
    SIM._pendingEvent = selected;
    SIM.addEvent('info', `📋 ${selected.name} — ${selected.narrative}`);
  } else {
    // Apply effects immediately
    SIM._applyEventEffects(selected);
  }
};

SIM._applyEventEffects = function(event) {
  const effects = event.effects || {};
  const msgParts = [];

  if (effects.reputation) {
    G.company.reputation = Math.max(0, Math.min(100, G.company.reputation + effects.reputation));
    msgParts.push(`reputation ${effects.reputation >= 0 ? '+' : ''}${effects.reputation}`);
  }
  if (effects.cash) {
    G.company.cash += effects.cash;
    msgParts.push(`$${effects.cash >= 0 ? '+' : ''}${effects.cash.toLocaleString()}`);
  }
  if (effects.technicians) {
    G.company.technicians = Math.max(0, G.company.technicians + effects.technicians);
    msgParts.push(`technicians ${effects.technicians >= 0 ? '+' : ''}${effects.technicians}`);
  }
  if (effects.customerSatisfaction) {
    G.company.customerSatisfactionAvg = Math.max(0, Math.min(1,
      G.company.customerSatisfactionAvg + effects.customerSatisfaction));
  }
  if (effects.marketShare) {
    // Real, persistent competitiveness bonus (not a disguised reputation bump).
    G.company.marketShareBonus = (G.company.marketShareBonus || 0) + effects.marketShare;
    msgParts.push(`share ${effects.marketShare >= 0 ? '+' : ''}${effects.marketShare}%`);
  }

  const icon = event.type === 'positive' ? '🌟' : '🌩️';
  SIM.addEvent(event.type === 'positive' ? 'info' : 'warning',
    `${icon} ${event.name}: ${msgParts.join(', ')}`);
  SIM.addEvent(event.type === 'positive' ? 'info' : 'critical',
    `  ${event.narrative || event.desc.slice(0, 80)}`);

  // Play stronger sound for negative events
  if (typeof SOUND !== 'undefined' && SOUND.enabled) {
    SOUND.onEvent(event.type === 'negative' ? 'warning' : 'info');
  }
};

SIM.resolveChoiceEvent = function(choiceIndex) {
  const event = SIM._pendingEvent;
  if (!event) return;

  const choice = event.choices[choiceIndex];
  if (!choice) {
    SIM._pendingEvent = null;
    return;
  }

  // Apply ALL choice effects via the same path as non-choice events
  // (was: only reputation+cash applied — bug #5).
  SIM._applyEventEffects({ type: 'choice', name: event.name, narrative: choice.result, desc: event.desc, effects: choice.effects || {} });
  SIM.addEvent('info', `📋 ${event.name} — ${choice.result || 'Decision made.'}`);
  SIM._pendingEvent = null;
};

// ---- Event System ----

SIM.events = [];

SIM.addEvent = function(level, message) {
  const event = {
    level: level, // 'info', 'warning', 'critical'
    message: message,
    year: G.year,
    day: G.day,
    tick: G.tickCount,
  };
  SIM.events.push(event);
  G.customerEvents.push(event);
  if (G.customerEvents.length > G.maxEvents) {
    G.customerEvents.shift();
  }

  // Play sound for event
  if (typeof SOUND !== 'undefined' && SOUND.enabled) {
    SOUND.onEvent(level);
  }
};

// ---- Fast-forward ----

SIM.runDays = function(days) {
  for (let i = 0; i < days; i++) {
    SIM.tick();
  }
};
