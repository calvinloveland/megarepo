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
  SIM.systemProduction();
  SIM.systemSales();
  SIM.systemAging();
  SIM.systemFailures();
  SIM.systemWarrantyService();
  SIM.systemCustomerSatisfaction();
  SIM.systemFinance();
  SIM.systemCompetitors();
  SIM.systemRegulations();
  SIM.systemTechUnlocks();

  // Auto-save every 30 game days
  if (G.tickCount % 30 === 0) {
    try { saveGame(); } catch(e) { /* silent */ }
  }
};

// ---- Year Start/End ----

SIM.handleYearStart = function() {
  // Market grows
  G.market.totalMarketSize = Math.floor(
    DATA.defaults.marketSize * Math.pow(1 + DATA.defaults.marketGrowthRate, G.year - 1970)
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

  // Annual maintenance cost
  const techCost = G.company.technicians * DATA.defaults.dailyTechnicianCost * 365;
  G.company.cash -= techCost;
  G.company.totalExpenses += techCost;

  // Annual marketing budget spend
  const marketingAnnual = G.company.marketingBudget * 12;
  G.company.cash -= marketingAnnual;
  G.company.totalExpenses += marketingAnnual;

  // Annual R&D spend
  const researchAnnual = G.company.researchSpending * 12;
  G.company.cash -= researchAnnual;
  G.company.totalExpenses += researchAnnual;

  // R&D progress
  if (G.company.researchSpending > 0) {
    G.company.researchLevel += G.company.researchSpending * 0.01;
  }

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

// ---- Sales System ----

SIM.systemSales = function() {
  const available = Math.floor(G.company.productionQueue);
  if (available <= 0) return;

  // Calculate demand based on reputation, marketing, pricing
  const repFactor = G.company.reputation / 100;
  const marketingFactor = Math.min(1, G.company.marketingBudget / 5000);
  const models = G.company.models.filter(m => m.isActive);

  if (models.length === 0) return;

  // Calculate daily demand
  const baseDemand = G.market.totalMarketSize * 0.0003; // 0.03% of market per day
  const demandMultiplier = repFactor * (0.5 + marketingFactor * 0.5);
  let dailyDemand = Math.max(0.1, baseDemand * demandMultiplier);

  // Competitor pressure reduces demand
  const activeCompetitors = G.market.competitors.filter(c => c.active).length;
  dailyDemand *= Math.max(0.3, 1 - activeCompetitors * 0.1);

  // Actually sell
  const toSell = Math.min(available, Math.ceil(dailyDemand));
  const modelIndex = Math.floor(Math.random() * models.length);
  const model = models[modelIndex];

  for (let i = 0; i < toSell; i++) {
    // Pick a customer type
    const customerType = SIM.pickCustomerType();
    const customerId = nextCustomerId();

    // Create the machine
    const machine = createMachine(model.id, customerId, customerType.id);
    if (!machine) continue;

    // Determine sale price (retail - potential discount)
    let salePrice = model.retailPrice;

    // Early game market adjustment (inflation-ish)
    salePrice *= (1 + (G.year - 1970) * 0.008);

    // Add to active machines
    G.company.activeMachines.push(machine);
    G.company.totalMachinesSold++;
    G.market.soldThisYear++;

    // Revenue
    G.company.cash += salePrice;
    G.company.totalRevenue += salePrice;
  }

  G.company.productionQueue -= toSell;
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

    // Simulate loads based on customer type
    const custType = DATA.customerTypes.find(t => t.id === machine.customerType);
    const loadsPerDay = custType ? custType.loadsPerWeek / 7 : 0.3;

    // Not every day has a load
    if (Math.random() < loadsPerDay) {
      machine.loadsCompleted++;
    }
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

    // Check each failure type
    for (const failureDef of DATA.failureTypes) {
      // Base probability per load
      let prob = failureDef.baseRate * machine.loadsCompleted * wearMultiplier;

      // Adjust based on component quality
      const compSource = failureDef.componentSource;
      const compChoice = model.components[compSource];
      if (compChoice) {
        const compDef = DATA.components[compSource];
        if (compDef) {
          const opt = compDef.options.find(o => o.id === compChoice);
          if (opt) {
            prob *= (1 - opt.durability * 0.7); // better components = fewer failures
          }
        }
      }

      // Supplier quality modifier (component sourcing improvement)
      prob *= (1 / getEffectiveQualityMultiplier());

      // Age multiplier — older machines fail more
      const ageYears = machine.ageDays / 365;
      prob *= Math.max(1, ageYears * 0.3);

      // Roll the dice
      if (Math.random() < prob && prob > 0.00001) {
        // Failure occurs
        machine.currentStatus = 'broken';
        machine.lastFailureDay = G.day;

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

    // Assign technician if not assigned
    if (!claim.assignedTech && claim.daysOpen > 1) {
      const region = G.company.serviceRegions.find(r => r.id === claim.region);
      if (region && region.techCount > 0) {
        claim.assignedTech = true;
        claim.status = 'assigned';
        region.activeJobs.push(claim.id);

        // Auto-resolve after some time based on region tech count
        const resolutionDays = 2 + Math.floor(Math.random() * 4) - Math.floor(region.techCount / 2);
        claim._resolutionDay = G.day + Math.max(1, resolutionDays);
      }
    }

    // Resolve if tech was assigned long enough ago
    if (claim.status === 'assigned' && claim._resolutionDay && G.day >= claim._resolutionDay) {
      SIM.resolveClaim(claim);
    }

    // Claims that are too old get unhappy
    if (claim.daysOpen > 14 && claim.status === 'open') {
      // Auto-assign even if no techs (emergency)
      claim.assignedTech = true;
      claim.status = 'assigned';
      claim._resolutionDay = G.day + 5;
      SIM.addEvent('info', `🔄 Emergency dispatch for ${claim.id} (overdue)`);
    }
  }
};

SIM.resolveClaim = function(claim) {
  // Pick resolution based on warranty status and severity
  const isMajor = claim.severity === 'critical' || claim.severity === 'major';

  let resolution;
  if (claim.inWarranty) {
    // In warranty — we pay, repair or replace
    if (isMajor && Math.random() < 0.3) {
      resolution = 'replaceMachine';
    } else {
      resolution = 'repair';
    }
  } else {
    // Out of warranty — offer options
    const r = Math.random();
    if (r < 0.4) resolution = 'repair';
    else if (r < 0.6) resolution = 'discount';
    else if (r < 0.8) resolution = 'replaceMachine';
    else resolution = 'decline';
  }

  const resolutionDef = DATA.resolutionOptions.find(o => o.id === resolution);

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

  // Apply supplier cost modifiers to repair costs
  cost *= getSupplierCostMultiplier(G.company.suppliers.bearings || 'nationalSupplier');

  // Apply resolution
  if (resolution === 'decline') {
    claim.status = 'declined';
  } else {
    claim.status = 'resolved';
    G.company.cash -= cost;
    G.company.totalExpenses += cost;
    G.company.totalWarrantyCost += cost;
  }
  claim.resolution = resolution;

  // Update the machine
  const machine = G.company.activeMachines.find(m => m.serial === claim.machineSerial);
  if (machine) {
    const failure = machine.failures.find(f => !f.resolved);
    if (failure) failure.resolved = true;

    if (resolution === 'replaceMachine') {
      // New machine replaces the old one
      machine.currentStatus = 'active';
      machine.loadsCompleted = 0;
      machine.ageDays = 0;
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

  // Bankrupt check
  if (G.company.cash < -100000) {
    SIM.addEvent('critical', `🚨 BANKRUPTCY WARNING! Debt: $${Math.abs(G.company.cash).toLocaleString()}`);
  }
};

// ---- Competitor System ----

SIM.systemCompetitors = function() {
  for (const comp of G.market.competitors) {
    // Activate competitors based on year
    if (!comp.active && comp.startingYear <= G.year) {
      comp.active = true;
      SIM.addEvent('info', `🏭 Competitor enters market: ${comp.name}`);
    }

    if (!comp.active) continue;

    // Competitors sell machines too (eroding market share)
    const compPower = (comp.qualityLevel * 0.5 + comp.aggressiveness * 0.5) * 0.001;
    const randomFluctuation = 0.8 + Math.random() * 0.4;
    comp.machinesSold += compPower * randomFluctuation * 10;
  }

  // Calculate market shares
  const totalSold = G.company.totalMachinesSold +
    G.market.competitors.filter(c => c.active).reduce((sum, c) => sum + c.machinesSold, 0);

  for (const comp of G.market.competitors) {
    comp.marketShare = totalSold > 0 ? (comp.machinesSold / totalSold) * 100 : 0;
  }
};

// ---- Regulation System (my addition) ----

SIM.systemRegulations = function() {
  for (const reg of DATA.regulations) {
    if (reg.year === G.year && !G.market.activeRegulations.find(r => r.year === reg.year)) {
      G.market.activeRegulations.push(reg);
      SIM.addEvent('warning', `📋 NEW REGULATION: ${reg.name} — ${reg.description}`);

      // Apply effects
      const effect = reg.effect || '';
      if (effect.includes('noiseMax')) {
        SIM.addEvent('info', '🔇 Your machines must meet new noise standards!');
      } else if (effect.includes('waterMax')) {
        SIM.addEvent('info', '💧 Water usage limits now in effect!');
      } else if (effect.includes('energyReq')) {
        SIM.addEvent('info', '⚡ Stricter energy standards apply to new models!');
      }
    }
  }
};

// ---- Tech Unlock System ----

SIM.systemTechUnlocks = function() {
  const yearTechs = DATA.techUnlocks.filter(t => t.year === G.year);
  for (const tech of yearTechs) {
    if (!G.company.unlockedTechs.includes(tech.name)) {
      G.company.unlockedTechs.push(tech.name);
      SIM.addEvent('info', `🔬 TECH UNLOCKED: ${tech.name} — ${tech.description}`);
    }
  }
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
};

// ---- Fast-forward ----

SIM.runDays = function(days) {
  for (let i = 0; i < days; i++) {
    SIM.tick();
  }
};
