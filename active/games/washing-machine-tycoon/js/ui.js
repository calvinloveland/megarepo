// ui.js — All UI rendering and interaction handlers
// ====================================================================
// Depends on: data.js, game.js, simulation.js

const UI = {
  currentScreen: 'dashboard',
  selectedModelId: null,
  selectedMachineSerial: null,
  selectedClaimId: null,
  designForm: {},
  factoryForm: {},
  message: '',
  messageTimer: 0,
};

// ---- Initialization ----

UI.init = function() {
  UI.setupNavigation();
  UI.render();
  UI.showScreen('dashboard');
};

UI.setupNavigation = function() {
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.addEventListener('click', (e) => {
      const screen = el.dataset.screen;
      UI.showScreen(screen);
    });
  });
};

UI.showScreen = function(screenId) {
  UI.currentScreen = screenId;
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === screenId);
  });
  // Show/hide screens
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.toggle('active', el.id === `screen-${screenId}`);
  });
  UI.render();
  // Close help overlay if open
  const helpOverlay = document.getElementById('help-overlay');
  if (helpOverlay) helpOverlay.style.display = 'none';
};

UI.showMessage = function(msg, duration = 3000) {
  UI.message = msg;
  UI.messageTimer = Date.now() + duration;
};

// ---- Main Render ----
// Only rebuild the ACTIVE screen's DOM each frame. Re-rendering every
// screen at 60fps destroys in-progress inputs (search box, sliders, name
// field) and tanks perf with a large fleet (issue #8/#9).
// Each renderX also writes to el.innerHTML only if the screen element is
// present; non-active screens keep their last-rendered DOM until visited.

UI._screenRenderers = {
  dashboard:    'renderDashboard',
  design:       'renderDesignStudio',
  factory:      'renderFactoryView',
  machines:     'renderMachineBrowser',
  service:      'renderServiceDept',
  market:       'renderMarketView',
  research:     'renderResearchView',
};

UI.render = function() {
  if (!G) return;

  // Topbar + setup guide + toast update every frame (cheap, focused writes).
  UI.renderTopBar();
  UI.renderScreen(UI.currentScreen);

  // Setup guide auto-detection (runs every frame regardless of guide visibility)
  UI._updateSetupGuide();

  // Show message if active
  if (UI.message && Date.now() < UI.messageTimer) {
    const el = document.getElementById('message-toast');
    if (el) { el.textContent = UI.message; el.style.display = 'block'; }
  } else {
    const el = document.getElementById('message-toast');
    if (el) el.style.display = 'none';
  }
};

// Render a single screen by id. Falls back to dashboard.
UI.renderScreen = function(screenId) {
  const fnName = UI._screenRenderers[screenId] || 'renderDashboard';
  if (typeof UI[fnName] === 'function') UI[fnName]();
};

// ---- Top Bar ----

UI.renderTopBar = function() {
  const dateEl = document.getElementById('topbar-date');
  const cashEl = document.getElementById('topbar-cash');
  const repEl = document.getElementById('topbar-rep');
  const machinesEl = document.getElementById('topbar-machines');
  const speedEl = document.getElementById('topbar-speed');

  if (dateEl) dateEl.textContent = formatDate(G.year, G.day);
  if (cashEl) {
    const color = G.company.cash >= 0 ? '#4ade80' : '#f87171';
    cashEl.innerHTML = `<span style="color:${color}">$${Math.floor(G.company.cash).toLocaleString()}</span>`;
  }
  if (repEl) {
    const tier = getReputationTier(G.company.reputation);
    repEl.innerHTML = `<span style="color:${tier.color}">${tier.label} (${Math.floor(G.company.reputation)}%)</span>`;
  }
  if (machinesEl) machinesEl.textContent = G.company.totalMachinesSold.toLocaleString();
  if (speedEl) {
    speedEl.textContent = `${G.speed}x`;
    speedEl.style.color = G.paused ? '#f87171' : G.speed > 1 ? '#fbbf24' : '#4ade80';
  }

  const researchEl = document.getElementById('topbar-research');
  if (researchEl) {
    researchEl.textContent = G.company.researchLevel.toFixed(1);
    researchEl.style.color = G.company.researchLevel >= 35 ? '#4ade80' : G.company.researchLevel >= 10 ? '#fbbf24' : 'var(--accent-cyan)';
  }

  const diffEl = document.getElementById('topbar-diff');
  if (diffEl && G.difficulty) {
    const diffLabel = DATA.difficulty[G.difficulty]?.label || G.difficulty;
    const colors = { easy: '#4ade80', medium: '#fbbf24', hard: '#f87171', nightmare: '#ef4444' };
    diffEl.textContent = diffLabel;
    diffEl.style.color = colors[G.difficulty] || '#fbbf24';
  }

  const soundEl = document.getElementById('topbar-sound');
  if (soundEl) {
    soundEl.textContent = SOUND.enabled ? '🔊' : '🔇';
    soundEl.style.color = SOUND.enabled ? '#4ade80' : '#f87171';
  }

  // Check for pending random events
  UI.checkPendingEvent();

  // Paused indicator
  UI.renderPausedIndicator();

  // Setup guide button visibility
  const setupBtn = document.getElementById('setup-guide-btn');
  if (setupBtn) {
    setupBtn.style.display = (UI._setupState && UI._setupState.step < 99) ? 'inline-block' : 'none';
  }

  // Auto-update setup guide if it's visible
  const setupGuide = document.getElementById('setup-guide');
  if (setupGuide && setupGuide.style.display === 'flex') {
    UI._updateSetupGuide();
  }

  // Factory ambience management
  if (SOUND.enabled && SOUND._ctx) {
    const hasActiveProduction = G.company.productionLines.some(l => l.active);
    if (hasActiveProduction && !G.paused) {
      SOUND._startAmbience();
    } else {
      SOUND.stopAmbience();
    }
  }
};

// ---- Dashboard ----

UI.renderDashboard = function() {
  const el = document.getElementById('screen-dashboard');
  if (!el) return;

  // Key metrics
  const html = `
    <div class="dash-grid">
      <div class="card metric-card">
        <div class="metric-label">Cash</div>
        <div class="metric-value ${G.company.cash >= 0 ? 'positive' : 'negative'}">$${Math.floor(G.company.cash).toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Revenue (Total)</div>
        <div class="metric-value">$${Math.floor(G.company.totalRevenue).toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Expenses (Total)</div>
        <div class="metric-value">$${Math.floor(G.company.totalExpenses).toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Profit (Total)</div>
        <div class="metric-value ${G.company.totalRevenue - G.company.totalExpenses >= 0 ? 'positive' : 'negative'}">$${Math.floor(G.company.totalRevenue - G.company.totalExpenses).toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Machines Sold</div>
        <div class="metric-value">${G.company.totalMachinesSold.toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Active Machines</div>
        <div class="metric-value">${G.company.activeMachines.filter(m => m.currentStatus !== 'disposed').length.toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Market Share</div>
        <div class="metric-value">${UI.calcMarketShare()}%</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Customer Satisfaction</div>
        <div class="metric-value">${(G.company.customerSatisfactionAvg * 100).toFixed(1)}%</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Pending Claims</div>
        <div class="metric-value warning">${G.company.pendingClaims.length}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Warranty Cost (Total)</div>
        <div class="metric-value">$${Math.floor(G.company.totalWarrantyCost).toLocaleString()}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Technicians</div>
        <div class="metric-value">${G.company.technicians}</div>
      </div>
      <div class="card metric-card">
        <div class="metric-label">Production Lines</div>
        <div class="metric-value">${G.company.productionLines.filter(l => l.active).length} / ${DATA.defaults.maxProductionLines}</div>
      </div>
    </div>

    ${G.paused && UI._setupState && UI._setupState.step < 99 ? `
    <div class="card" style="margin-top:16px;border-color:var(--accent-cyan);background:#0a1a2a">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>⏸ Game is Paused — Setup Incomplete</span>
        <button class="btn btn-sm btn-accent" onclick="UI.showSetupGuide()">📋 Open Setup Guide</button>
        <button class="btn btn-sm btn-secondary" onclick="UI.unpauseAndStart()">▶ Start Anyway</button>
      </div>
      <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">
        Complete the setup steps to avoid going bankrupt from overhead costs.
        ${!UI._setupState.designedMachine ? '🔴 <strong>Design a machine</strong> to start.' : '✅ Machine designed.'}
        ${!UI._setupState.startedProduction ? '🔴 <strong>Start production</strong> to generate revenue.' : '✅ Production active.'}
      </div>
    </div>
    ` : ''}

    <div class="card" style="margin-top:16px">
      <div class="card-title">Company Overview</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
        <div><strong>Name:</strong> ${G.company.name}</div>
        <div><strong>Year:</strong> ${G.year}</div>
        <div><strong>Research Level:</strong> ${G.company.researchLevel.toFixed(1)}</div>
        <div><strong>Models:</strong> ${G.company.models.length} designed</div>
        <div><strong>Production Queue:</strong> ${Math.floor(G.company.productionQueue)} units</div>
        <div><strong>Marketing Budget:</strong> $${G.company.marketingBudget}/mo</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">Recent Events</div>
      <div class="event-log">
        ${G.customerEvents.slice(-8).reverse().map(e => `
          <div class="event-item event-${e.level}">
            <span class="event-date">${formatDate(e.year, e.day)}</span>
            <span class="event-msg">${e.message}</span>
          </div>
        `).join('')}
        ${G.customerEvents.length === 0 ? '<div class="event-item" style="color:#666">No events yet. Start by designing a machine!</div>' : ''}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">Quick Actions</div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="UI.showScreen('design')">Design a Machine</button>
        <button class="btn btn-secondary" onclick="UI.showScreen('factory')">Manage Factory</button>
        <button class="btn btn-secondary" onclick="UI.showScreen('service')">Service Dept</button>
        <button class="btn btn-accent" onclick="var g=window.gameState;if(g.speed===1){g.speed=5;g.paused=false}else if(g.speed===5){g.speed=30}else if(g.speed===30){g.speed=1} UI.render();">Toggle Speed</button>
        <button class="btn ${G.paused?'btn-primary':'btn-secondary'}" onclick="var g=window.gameState;g.paused=!g.paused;UI.render();">${G.paused?'▶ Resume':'⏸ Pause'}</button>
        <button class="btn btn-secondary" onclick="saveGame();UI.showMessage('✅ Game saved!');UI.render();">💾 Save</button>
        <button class="btn btn-secondary" onclick="if(loadGame()){UI.showMessage('📂 Game loaded!');UI.render();}else{UI.showMessage('No saved game found.');}">📂 Load</button>
        <button class="btn btn-secondary" onclick="UI.showHelp()">❓ How to Play</button>
        <button class="btn btn-danger" onclick="if(confirm('Start a new game? All progress will be lost.')){UI.restartGame();}">🔄 New Game</button>
      </div>
    </div>

    <!-- Error Log Section (shown when errors exist) -->
    ${typeof ErrorReporter !== 'undefined' && ErrorReporter.getCount() > 0 ? `
    <div class="card" style="margin-top:16px;border-color:var(--accent-red)">
      <div class="card-title" style="color:var(--accent-red);display:flex;justify-content:space-between">
        <span>🛑 Script Errors (${ErrorReporter.getCount()})</span>
        <button class="btn btn-sm btn-secondary" onclick="ErrorReporter.clear();UI.render();">Clear</button>
      </div>
      <div class="event-log" style="max-height:150px">
        ${ErrorReporter.getRecent(8).map(e => `
          <div class="event-item" style="color:var(--accent-red);font-size:11px">
            <span class="event-date">${e.type}</span>
            <span class="event-msg">${String(e.message).slice(0, 120)}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Charts Section -->
    <div class="card" style="margin-top:16px">
      <div class="card-title">📈 Trends</div>
      <div class="charts-grid">
        <div class="chart-container">
          <canvas id="chart-reputation" width="320" height="160"></canvas>
          <div class="chart-label">Reputation</div>
        </div>
        <div class="chart-container">
          <canvas id="chart-financial" width="320" height="160"></canvas>
          <div class="chart-label">Revenue vs Expenses</div>
        </div>
        <div class="chart-container">
          <canvas id="chart-market" width="320" height="160"></canvas>
          <div class="chart-label">Market Share</div>
        </div>
        <div class="chart-container">
          <canvas id="chart-sales" width="320" height="160"></canvas>
          <div class="chart-label">Units Sold per Year</div>
        </div>
      </div>
    </div>
  `;

  // Draw charts after DOM update
  setTimeout(() => UI.drawCharts(), 50);

  el.innerHTML = html;
};

UI.calcMarketShare = function() {
  // Use the authoritative value computed by SIM.systemSales (the same
  // formula used for AI competitor shares). Falls back to cumulative
  // machine count for backward compatibility with saved games that don't
  // have _currentMarketShare.
  const s = G.company._currentMarketShare;
  if (s !== undefined && s !== 0) return s.toFixed(1);

  // Legacy fallback
  const total = G.company.totalMachinesSold +
    G.market.competitors.filter(c => c.active).reduce((s, c) => s + c.machinesSold, 0);
  return total > 0 ? ((G.company.totalMachinesSold / total) * 100).toFixed(1) : '0.0';
};

// ---- Design Studio ----

UI.renderDesignStudio = function() {
  const el = document.getElementById('screen-design');
  if (!el) return;

  const models = G.company.models;

  let html = `
    <div class="design-layout">
      <div class="design-sidebar">
        <div class="card">
          <div class="card-title">Your Models</div>
          <div style="margin-top:8px">
            ${models.length === 0 ? '<div style="color:#666">No models designed yet.</div>' :
              models.map(m => {
                const isSelected = UI.selectedModelId === m.id;
                const sales = G.company.activeMachines.filter(mach => mach.modelId === m.id).length;
                const retiredStyle = m.isActive ? '' : 'opacity:0.5';
                return `
                  <div class="model-list-item ${isSelected ? 'selected' : ''}" style="${retiredStyle}" onclick="UI.selectedModelId='${m.id}';UI.render();">
                    <div><strong>${m.name}</strong> <span class="badge">${m.yearIntroduced}</span>${m.isActive ? '' : ' <span class="badge badge-warning" style="background:#444">Retired</span>'}</div>
                    <div style="font-size:11px;color:#888">Cost: $${m.productionCost.toFixed(0)} | Price: $${m.currentPrice || m.retailPrice}${(m.currentPrice && m.currentPrice !== m.retailPrice) ? ' (was $'+m.retailPrice+')' : ''} | Sold: ${sales}</div>
                  </div>
                `;
              }).join('')}
          </div>
        </div>
      </div>
      <div class="design-main">
        ${UI.selectedModelId ? UI.renderModelDetail(models.find(m => m.id === UI.selectedModelId)) : UI.renderNewModelForm()}
      </div>
    </div>
  `;

  el.innerHTML = html;
};

UI.renderModelDetail = function(model) {
  if (!model) return '<div class="card"><div class="card-title">Model not found</div></div>';

  const failureCount = G.company.activeMachines.filter(m =>
    m.modelId === model.id && m.failures.length > 0
  ).length;
  const activeCount = G.company.activeMachines.filter(m =>
    m.modelId === model.id && m.currentStatus !== 'disposed'
  ).length;

  let compHtml = '';
  for (const [key, val] of Object.entries(model.components)) {
    const compDef = DATA.components[key];
    if (!compDef) continue;
    const opt = compDef.options.find(o => o.id === val);
    compHtml += `<div><span class="comp-key">${compDef.label}:</span> ${opt ? opt.name : val}</div>`;
  }

  return `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${model.name} (${model.yearIntroduced})</span>
        <span>
          <button class="btn btn-sm btn-secondary" onclick="UI.selectedModelId=null;UI.render();">← Back</button>
          <button class="btn btn-sm btn-default" onclick="UI.cloneModel('${model.id}')">Clone</button>
          ${model.isActive ? `<button class="btn btn-sm btn-danger" onclick="var m=window.gameState.company.models.find(x=>x.id==='${model.id}');if(m&&confirm('Retire ${model.name}? It will stop being sold.')){m.isActive=false;UI.selectedModelId=null;UI.render();}">Retire</button>` : `<button class="btn btn-sm btn-primary" onclick="var m=window.gameState.company.models.find(x=>x.id==='${model.id}');if(m){m.isActive=true;UI.render();}">Reactivate</button>`}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <div>
          <div class="stat-label">Production Cost</div>
          <div class="stat-value">$${model.productionCost.toFixed(0)}</div>
        </div>
        <div>
          <div class="stat-label">Selling Price</div>
          <div class="stat-value">
            $<input type="number" id="price-${model.id}" class="form-input" value="${model.currentPrice || model.retailPrice}" min="50" max="9999"
              style="width:70px;display:inline;font-size:14px"
              onchange="var m=window.gameState.company.models.find(m=>m.id==='${model.id}');if(m){m.currentPrice=parseInt(this.value)||m.retailPrice;}">
            <span style="font-size:11px;margin-left:4px">
              (design: $${model.retailPrice}
              <span style="color:${((model.currentPrice||model.retailPrice)-model.productionCost) > 0 ? '#4ade80' : '#f87171'}">
                | margin: $${((model.currentPrice||model.retailPrice)-model.productionCost).toFixed(0)}</span>)
            </span>
          </div>
        </div>
        <div>
          <div class="stat-label">Quality Rating</div>
          <div class="stat-value">${(model.qualityRating * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div class="stat-label">Warranty</div>
          <div class="stat-value">${model.warrantyYears} years</div>
        </div>
        <div>
          <div class="stat-label">Active Units</div>
          <div class="stat-value">${activeCount}</div>
        </div>
        <div>
          <div class="stat-label">Failed Units</div>
          <div class="stat-value warning">${failureCount}</div>
        </div>
        <div>
          <div class="stat-label">Noise Level</div>
          <div class="stat-value">${(computeModelNoise(model.components) * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div class="stat-label">Energy Efficiency</div>
          <div class="stat-value">${(computeModelEnergyEfficiency(model.components) * 100).toFixed(0)}%</div>
        </div>
      </div>
      <div style="margin-top:12px;border-top:1px solid #333;padding-top:12px">
        <div class="card-subtitle">Components</div>
        ${compHtml}
      </div>

      ${function() {
        const compliance = SIM.getModelCompliance(model);
        if (compliance.compliant && compliance.reasons.length === 0) return '';
        const icon = compliance.compliant ? '✅' : '🚫';
        const headerClass = compliance.compliant ? '' : 'style="color:var(--accent-red)"';
        return `
          <div style="margin-top:12px;border-top:1px solid #333;padding-top:12px">
            <div class="card-subtitle" ${headerClass}>${icon} Regulation Compliance</div>
            ${compliance.reasons.map(r => `<div style="font-size:12px;padding:2px 0">${r}</div>`).join('')}
          </div>
        `;
      }()}
    </div>
  `;
};

UI.renderNewModelForm = function() {
  let html = `
    <div class="card">
      <div class="card-title">Design New Washing Machine</div>
      <div style="margin-top:12px">
        <div class="form-group">
          <label>Model Name</label>
          <input type="text" id="design-name" class="form-input" value="Series ${G.company.models.length + 1}" placeholder="e.g., Cascade X200">
        </div>
      </div>
  `;

  // Component selectors — pick best available option for the current year
  const componentKeys = ['drum', 'motor', 'pump', 'bearings', 'suspension', 'controlBoard', 'exterior'];
  // Default picks per component (best value-for-money that's usually available)
  const defaultPicks = {
    drum: 'stainless', motor: 'universal', pump: 'standard',
    bearings: 'standard', suspension: 'torsion',
    controlBoard: 'timer', exterior: 'chrome'
  };
  for (const key of componentKeys) {
    const compDef = DATA.components[key];
    if (!compDef) continue;
    const options = getAvailableComponentOptions(key, G.year);
    const defaultPick = options.find(o => o.id === defaultPicks[key]) || options[0];
    html += `
      <div class="form-group">
        <label>${compDef.label}</label>
        <select id="design-${key}" class="form-select" onchange="UI.updateDesignCost()">
          ${options.map(o => `
            <option value="${o.id}" ${o.id === (defaultPick ? defaultPick.id : options[0]?.id) ? 'selected' : ''}
              data-cost="${o.cost}">
              ${o.name} — $${o.cost} ${o.durability ? '| Durability: ' + (o.durability * 100).toFixed(0) + '%' : ''}${o.noise !== undefined ? ' | Noise: ' + (o.noise * 100).toFixed(0) + '%' : ''}
            </option>
          `).join('')}
        </select>
        <div class="comp-description" id="desc-${key}">
          ${defaultPick ? defaultPick.description : ''}
        </div>
      </div>
    `;
  }

  html += `
      <div class="form-row">
        <div class="form-group">
          <label>Retail Price ($)</label>
          <input type="number" id="design-price" class="form-input" value="499" min="100" max="5000">
        </div>
        <div class="form-group">
          <label>Warranty (years)</label>
          <input type="number" id="design-warranty" class="form-input" value="2" min="0" max="20">
        </div>
      </div>
      <div class="form-group">
        <div id="design-cost-display" class="cost-display">Estimated Production Cost: $<span id="design-cost-value">0</span></div>
      </div>
      <button class="btn btn-primary" onclick="UI.submitDesign()">💾 Create Model</button>
    </div>
  `;

  return html;
};

UI.updateDesignCost = function() {
  const components = {};
  let totalCost = 30; // base
  for (const key of Object.keys(DATA.components)) {
    const sel = document.getElementById(`design-${key}`);
    if (sel) {
      const val = sel.value;
      components[key] = val;
      const opt = DATA.components[key].options.find(o => o.id === val);
      if (opt) totalCost += opt.cost;
    }
  }
  const costEl = document.getElementById('design-cost-value');
  if (costEl) costEl.textContent = totalCost;

  // Update descriptions
  for (const key of Object.keys(DATA.components)) {
    const sel = document.getElementById(`design-${key}`);
    const desc = document.getElementById(`desc-${key}`);
    if (sel && desc) {
      const opt = DATA.components[key].options.find(o => o.id === sel.value);
      desc.textContent = opt ? opt.description : '';
    }
  }

  // Show regulation compliance warning for the current design
  const existing = document.getElementById('design-compliance-warning');
  if (G.market && G.market.activeRegulations && G.market.activeRegulations.length > 0) {
    const compliance = typeof SIM !== 'undefined' ? SIM.getModelCompliance({ components: components }) : { compliant: true, reasons: [] };
    if (!compliance.compliant) {
      let warnEl = existing || document.getElementById('design-cost-display');
      if (warnEl) {
        let warnDiv = existing;
        if (!warnDiv) {
          warnDiv = document.createElement('div');
          warnDiv.id = 'design-compliance-warning';
          warnDiv.style.cssText = 'font-size:12px;padding:6px 0;color:var(--accent-red)';
          warnEl.parentNode.insertBefore(warnDiv, warnEl.nextSibling);
        }
        warnDiv.innerHTML = '🚫 <strong>Non-compliant!</strong> ' + compliance.reasons.slice(0,2).join('; ');
      }
    } else if (existing) {
      existing.innerHTML = '✅ Compliant with all regulations';
    }
  } else if (existing) {
    existing.remove();
  }
};

UI.submitDesign = function() {
  const name = document.getElementById('design-name')?.value?.trim() || `Series ${G.company.models.length + 1}`;
  const price = parseInt(document.getElementById('design-price')?.value) || 499;
  const warranty = parseInt(document.getElementById('design-warranty')?.value) || 2;

  const components = {};
  for (const key of Object.keys(DATA.components)) {
    const sel = document.getElementById(`design-${key}`);
    if (sel) components[key] = sel.value;
  }

  const model = companyAddModel({
    name: name,
    components: components,
    retailPrice: price,
    warrantyYears: warranty,
  });

  UI.selectedModelId = model.id;
  SIM.addEvent('info', `🏭 New model designed: ${model.name} (est. cost: $${model.productionCost.toFixed(0)}, price: $${price})`);
  UI.showMessage(`✅ ${model.name} designed!`);
  UI.render();
};

UI.cloneModel = function(modelId) {
  const original = G.company.models.find(m => m.id === modelId);
  if (!original) return;
  const model = companyAddModel({
    name: `${original.name} Rev.2`,
    components: { ...original.components },
    retailPrice: original.retailPrice,
    warrantyYears: original.warrantyYears,
  });
  UI.selectedModelId = model.id;
  UI.showMessage(`📋 Cloned ${original.name} as ${model.name}`);
  UI.render();
};

// ---- Factory View ----

UI.renderFactoryView = function() {
  const el = document.getElementById('screen-factory');
  if (!el) return;

  const lines = G.company.productionLines;
  const models = G.company.models;

  let html = `
    <div class="card">
      <div class="card-title">Production Lines</div>
      <div style="margin-top:8px;margin-bottom:12px">
        Max lines: ${DATA.defaults.maxProductionLines} | Active: ${lines.filter(l => l.active).length}
        ${lines.length < DATA.defaults.maxProductionLines ? `
          <button class="btn btn-sm btn-primary" onclick="UI.addProductionLine()" style="margin-left:12px">+ Add Line</button>
        ` : ''}
      </div>
  `;

  if (lines.length === 0) {
    html += '<div style="color:#666;padding:12px 0">No production lines. Add one to start manufacturing.</div>';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const model = models.find(m => m.id === line.modelId);
    html += `
      <div class="production-line ${line.active ? 'active' : 'inactive'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>Line ${i + 1}</strong>
            ${line.active ? '🟢 Active' : '🔴 Inactive'}
            ${model ? `— Producing: <strong>${model.name}</strong>${(function(){try{const c=SIM.getModelCompliance(model);return c.compliant?' <span style="color:#4ade80;font-size:11px">✅ Compliant</span>':' <span style="color:#f87171;font-size:11px">🚫 Blocked</span>'}catch(e){return ''}})()}` : '— No model assigned'}
          </div>
          <div>
            <button class="btn btn-sm ${line.active ? 'btn-secondary' : 'btn-primary'}" onclick="UI.toggleLine(${i})">
              ${line.active ? 'Stop' : 'Start'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="UI.removeLine(${i})">✕</button>
          </div>
        </div>
        <div class="line-controls" style="margin-top:8px;display:${line.active ? 'grid' : 'none'};grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div>
            <label style="font-size:11px;color:#888">Production Speed</label>
            <input type="range" min="0.5" max="5" step="0.5" value="${line.speed || 1}"
              oninput="window.gameState.company.productionLines[${i}].speed=parseFloat(this.value);this.nextElementSibling.textContent=this.value+'x';UI._updateLineOutputLabel(${i});">
            <span style="font-size:11px">${line.speed || 1}x</span>
          </div>
          <div>
            <label style="font-size:11px;color:#888">Quality Control</label>
            <input type="range" min="0" max="1" step="0.05" value="${line.qualityControl || 0}"
              oninput="window.gameState.company.productionLines[${i}].qualityControl=parseFloat(this.value);this.nextElementSibling.textContent=(parseFloat(this.value)*100).toFixed(0)+'%';UI._updateLineOutputLabel(${i});">
            <span style="font-size:11px">${((line.qualityControl || 0) * 100).toFixed(0)}%</span>
          </div>
          <div>
            <label style="font-size:11px;color:#888">Model</label>
            <select onchange="window.gameState.company.productionLines[${i}].modelId=this.value;UI.render();" class="form-select" style="font-size:12px">
              <option value="">— Select —</option>
              ${models.filter(m => m.isActive).map(m =>
                `<option value="${m.id}" ${line.modelId === m.id ? 'selected' : ''}>${m.name}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        ${line.active ? `
          <div style="margin-top:6px;font-size:11px;color:#888">
            Daily output: ~${Math.max(0.5, (line.speed || 1) * (1 - (line.qualityControl || 0) * 0.3)).toFixed(1)} units
            ${(line.qualityControl || 0) > 0 ? `| Defect rate: ${(0.05 * (1 - (line.qualityControl || 0) * 0.8) * 100).toFixed(1)}%` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  html += '</div>';

  // Component Sourcing Panel (my addition)
  html += `
    <div class="card" style="margin-top:16px">
      <div class="card-title">🔗 Component Sourcing & Supply Chain</div>
      <div style="font-size:12px;color:#888;margin-bottom:8px">Choose suppliers for each component. Better quality costs more but reduces failures.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${Object.keys(DATA.components).map(key => {
          const compDef = DATA.components[key];
          const current = G.company.suppliers[key] || 'nationalSupplier';
          const availableSuppliers = DATA.suppliers.filter(s =>
            (s.minYear || 0) <= G.year && (!s.maxYear || s.maxYear >= G.year)
          );
          return `
            <div class="form-group" style="margin:0">
              <label style="font-size:12px">${compDef.label}</label>
              <select class="form-select" onchange="window.gameState.company.suppliers['${key}']=this.value;UI.render();">
                ${availableSuppliers.map(s => `
                  <option value="${s.id}" ${current === s.id ? 'selected' : ''}>
                    ${s.name} — ${s.costMultiplier < 1 ? '+' : ''}${((1 - s.costMultiplier) * 100).toFixed(0)}% cost | ${(s.qualityMultiplier * 100).toFixed(0)}% quality
                  </option>
                `).join('')}
              </select>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // Production Queue
  html += `
    <div class="card" style="margin-top:16px">
      <div class="card-title">Production Queue</div>
      <div style="font-size:24px;font-weight:bold">${Math.floor(G.company.productionQueue).toLocaleString()} units</div>
      <div style="font-size:12px;color:#888">Waiting to be sold</div>
    </div>
  `;

  el.innerHTML = html;
};

UI.addProductionLine = function() {
  if (G.company.productionLines.length >= DATA.defaults.maxProductionLines) return;
  G.company.productionLines.push({
    id: `line-${G.company.productionLines.length + 1}`,
    modelId: G.company.models.length > 0 ? G.company.models[0].id : null,
    speed: 1,
    qualityControl: 0,
    active: true,
  });
  const cost = 50000; // setup cost
  G.company.cash -= cost;
  G.company.totalExpenses += cost;
  UI.showMessage(`🏭 Production line added ($${cost.toLocaleString()})`);
  UI.render();
};

UI.toggleLine = function(index) {
  const line = G.company.productionLines[index];
  if (line) line.active = !line.active;
  UI.render();
};

// Live-update the "Daily output / Defect rate" label on a factory line
// without re-rendering the whole screen (preserves slider drag).
UI._updateLineOutputLabel = function(index) {
  const container = document.querySelectorAll('.production-line')[index];
  if (!container) return;
  const line = G.company.productionLines[index];
  if (!line) return;
  let label = container.querySelector('.line-output-label');
  if (!label) {
    label = document.createElement('div');
    label.className = 'line-output-label';
    label.style.cssText = 'margin-top:6px;font-size:11px;color:#888';
    container.appendChild(label);
  }
  const out = Math.max(0.5, (line.speed || 1) * (1 - (line.qualityControl || 0) * 0.3)).toFixed(1);
  const defect = (0.05 * (1 - (line.qualityControl || 0) * 0.8) * 100).toFixed(1);
  label.textContent = `Daily output: ~${out} units${(line.qualityControl || 0) > 0 ? ` | Defect rate: ${defect}%` : ''}`;
};

UI.removeLine = function(index) {
  G.company.productionLines.splice(index, 1);
  UI.render();
};

// ---- Machine Browser ----

UI.renderMachineBrowser = function() {
  const el = document.getElementById('screen-machines');
  if (!el) return;

  // Preserve the user's in-progress search/filter across re-renders so the
  // search box doesn't lose focus/value when <input oninput="UI.render()">
  // fires on the machines screen (issue #9).
  const prevSearchEl = document.getElementById('machine-search');
  const prevFilterEl = document.getElementById('machine-filter');
  const hadSearchFocus = prevSearchEl && document.activeElement === prevSearchEl;
  const prevCaret = prevSearchEl ? prevSearchEl.selectionStart : null;

  const machines = G.company.activeMachines;
  const total = machines.length;
  const active = machines.filter(m => m.currentStatus === 'active').length;
  const broken = machines.filter(m => m.currentStatus === 'broken').length;

  let html = `
    <div class="card">
      <div class="card-title">Machine Fleet — ${total.toLocaleString()} total</div>
      <div style="display:flex;gap:16px;margin:8px 0;font-size:13px">
        <span>🟢 Active: <strong>${active.toLocaleString()}</strong></span>
        <span>🔴 Broken: <strong>${broken.toLocaleString()}</strong></span>
        <span>⚫ Disposed: <strong>${machines.filter(m => m.currentStatus === 'disposed').length.toLocaleString()}</strong></span>
      </div>

      <div style="display:flex;gap:8px;margin:8px 0">
        <input type="text" id="machine-search" class="form-input" placeholder="Search serial or model..." style="flex:1"
          value="${(prevSearchEl?prevSearchEl.value:'').replace(/"/g,'&quot;')}"
          oninput="UI.render()">
        <select id="machine-filter" class="form-select" onchange="UI.render()">
          <option value="all" ${prevFilterEl && prevFilterEl.value==='all' ? 'selected':''}>All Status</option>
          <option value="active" ${prevFilterEl && prevFilterEl.value==='active' ? 'selected':''}>Active</option>
          <option value="broken" ${prevFilterEl && prevFilterEl.value==='broken' ? 'selected':''}>Broken</option>
          <option value="disposed" ${prevFilterEl && prevFilterEl.value==='disposed' ? 'selected':''}>Disposed</option>
        </select>
      </div>

      <div class="machine-table">
        <div class="machine-table-header">
          <span>Serial</span>
          <span>Model</span>
          <span>Age</span>
          <span>Loads</span>
          <span>Status</span>
          <span>Satisfaction</span>
        </div>
  `;

  const search = (document.getElementById('machine-search')?.value || '').toLowerCase();
  const filter = document.getElementById('machine-filter')?.value || 'all';

  // Paginated filter: show recent machines up to _machineMax limit.
  if (UI._machineMax === undefined) UI._machineMax = 100;

  const filteredMachines = machines
    .filter(m => {
      if (filter !== 'all' && m.currentStatus !== filter) return false;
      if (search) {
        const model = G.company.models.find(mod => mod.id === m.modelId);
        return m.serial.toLowerCase().includes(search) ||
               (model && model.name.toLowerCase().includes(search));
      }
      return true;
    });
  const displayMachines = filteredMachines
    .slice(-UI._machineMax)
    .reverse();
  const totalFiltered = filteredMachines.length;

  for (const machine of displayMachines) {
    const model = G.company.models.find(m => m.id === machine.modelId);
    const ageYears = (machine.ageDays / 365).toFixed(1);
    const statusIcon = machine.currentStatus === 'active' ? '🟢' : machine.currentStatus === 'broken' ? '🔴' : '⚫';
    const satPct = (machine.satisfactionScore * 100).toFixed(0);

    html += `
      <div class="machine-table-row ${UI.selectedMachineSerial === machine.serial ? 'selected' : ''}"
           onclick="UI.selectedMachineSerial='${machine.serial}';UI.render();">
        <span class="mono">${machine.serial}</span>
        <span>${model ? model.name : 'Unknown'}</span>
        <span>${ageYears}y</span>
        <span>${machine.loadsCompleted.toLocaleString()}</span>
        <span>${statusIcon} ${machine.currentStatus}</span>
        <span>${satPct}%</span>
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  // Show more button if there are more filtered results
  if (totalFiltered > UI._machineMax) {
    html += `<div style="text-align:center;margin:8px 0">
      <button class="btn btn-sm btn-secondary" onclick="UI._machineMax+=200;UI.render();">
        Show ${Math.min(200, totalFiltered - UI._machineMax)} more (${totalFiltered - UI._machineMax} remaining)
      </button>
    </div>`;
  }

  // Detail view for selected machine
  if (UI.selectedMachineSerial) {
    const machine = G.company.activeMachines.find(m => m.serial === UI.selectedMachineSerial);
    if (machine) {
      const model = G.company.models.find(m => m.id === machine.modelId);
      html += `
        <div class="card" style="margin-top:16px">
          <div class="card-title">Machine Detail — ${machine.serial}</div>
          <button class="btn btn-sm btn-secondary" onclick="UI.selectedMachineSerial=null;UI.render();">← Close</button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><strong>Model:</strong> ${model ? model.name : 'Unknown'}</div>
            <div><strong>Manufactured:</strong> ${formatDate(machine.manufactured.year, machine.manufactured.day)}</div>
            <div><strong>Age:</strong> ${(machine.ageDays / 365).toFixed(2)} years</div>
            <div><strong>Loads Completed:</strong> ${machine.loadsCompleted.toLocaleString()}</div>
            <div><strong>Status:</strong> ${machine.currentStatus}</div>
            <div><strong>Satisfaction:</strong> ${(machine.satisfactionScore * 100).toFixed(0)}%</div>
            <div><strong>Customer:</strong> ${machine.customerId}</div>
            <div><strong>Customer Type:</strong> ${(DATA.customerTypes.find(t => t.id === machine.customerType) || {}).name || machine.customerType}</div>
            <div><strong>Total Repair Cost:</strong> $${machine.totalRepairCost.toFixed(0)}</div>
            <div><strong>Failures:</strong> ${machine.failures.length}</div>
          </div>
          ${machine.failures.length > 0 ? `
            <div style="margin-top:12px;border-top:1px solid #333;padding-top:12px">
              <div class="card-subtitle">Failure History</div>
              ${machine.failures.slice(-5).reverse().map(f => {
                const fdef = DATA.failureTypes.find(d => d.id === f.failureType);
                return `<div style="font-size:12px;padding:2px 0">⚠️ ${fdef ? fdef.name : f.failureType} — ${formatDate(f.year, f.day)} ${f.resolved ? '✅' : '⏳'}</div>`;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  if (total === 0) {
    html += '<div class="card" style="margin-top:16px;color:#666;text-align:center;padding:40px">No machines yet. Design a model and start production!</div>';
  }

  el.innerHTML = html;

  // Restore search input focus + caret so typing survives re-render.
  if (hadSearchFocus) {
    const newSearch = document.getElementById('machine-search');
    if (newSearch) {
      newSearch.focus();
      try {
        const len = newSearch.value.length;
        const pos = (prevCaret != null && prevCaret <= len) ? prevCaret : len;
        newSearch.setSelectionRange(pos, pos);
      } catch(e) { /* some browsers throw on setSelectionRange */ }
    }
  }
};

// ---- Service Department ----

UI.renderServiceDept = function() {
  const el = document.getElementById('screen-service');
  if (!el) return;

  const claims = G.company.pendingClaims;
  const resolved = G.company.totalClaimsResolved;

  let html = `
    <div class="card">
      <div class="card-title">🔧 Service Department</div>
      <div style="display:flex;gap:16px;margin:8px 0;font-size:13px">
        <span>📋 Open Claims: <strong class="warning">${claims.length}</strong></span>
        <span>✅ Resolved: <strong>${resolved}</strong></span>
        <span>👷 Technicians: <strong>${G.company.technicians}</strong></span>
        <span>💰 Total Warranty Cost: <strong>$${Math.floor(G.company.totalWarrantyCost).toLocaleString()}</strong></span>
      </div>
      <button class="btn btn-sm btn-primary" onclick="window.gameState.company.technicians++;UI.render();">+ Hire Technician ($${DATA.defaults.baseTechnicianCost.toLocaleString()}/yr)</button>
      <button class="btn btn-sm btn-secondary" onclick="var g=window.gameState;if(g.company.technicians>1){g.company.technicians--;UI.render();}">- Fire Technician</button>
    </div>

    <!-- Service Regions -->
    <div class="card" style="margin-top:16px">
      <div class="card-title">Service Regions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        ${G.company.serviceRegions.map(r => `
          <div class="region-card">
            <div><strong>${r.name}</strong></div>
            <div style="font-size:12px;color:#888">Techs: ${r.techCount} | Active Jobs: ${r.activeJobs.length}</div>
            <div style="font-size:12px;color:#888">Population: ${(r.population * 100).toFixed(0)}% of market</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Claims List
  html += `
    <div class="card" style="margin-top:16px">
      <div class="card-title">Pending Claims (${claims.length})</div>
  `;

  if (claims.length === 0) {
    html += '<div style="color:#666;padding:12px 0">No pending claims. Great job keeping your machines reliable!</div>';
  } else {
    html += `
      <div class="claims-list">
        ${claims.map(c => {
          const machine = G.company.activeMachines.find(m => m.serial === c.machineSerial);
          const ageDays = c.daysOpen;
          return `
            <div class="claim-item ${c.severity}" onclick="UI.selectedClaimId='${c.id}';UI.render();">
              <div style="display:flex;justify-content:space-between">
                <div>
                  <strong>${c.failureName}</strong> — ${c.machineSerial}
                  <span class="badge ${c.inWarranty ? 'badge-warranty' : 'badge-nowarranty'}">${c.inWarranty ? 'In Warranty' : 'Out of Warranty'}</span>
                  <span class="badge badge-severity">${c.severity}</span>
                </div>
                <div style="font-size:12px;color:#888">${ageDays} day${ageDays !== 1 ? 's' : ''} open</div>
              </div>
              <div class="claim-desc">${c.description}</div>
              <div style="font-size:11px;color:#888;margin-top:4px">
                Customer: ${c.customerId} | Region: ${c.region || 'unassigned'}
                ${c.assignedTech ? '| 👷 Tech assigned' : '| ⏳ Waiting for tech'}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Selected claim detail
  if (UI.selectedClaimId) {
    const claim = G.company.pendingClaims.find(c => c.id === UI.selectedClaimId);
    if (claim) {
      html += `
        <div class="card" style="margin-top:16px">
          <div class="card-title">Claim ${claim.id} — ${claim.failureName}</div>
          <button class="btn btn-sm btn-secondary" onclick="UI.selectedClaimId=null;UI.render();">← Close</button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
            <div><strong>Machine:</strong> ${claim.machineSerial}</div>
            <div><strong>Customer:</strong> ${claim.customerId}</div>
            <div><strong>Reported:</strong> ${formatDate(claim.reportedYear, claim.reportedDay)}</div>
            <div><strong>Days Open:</strong> ${claim.daysOpen}</div>
            <div><strong>Warranty:</strong> ${claim.inWarranty ? '✅ Covered' : '❌ Expired'}</div>
            <div><strong>Est. Repair Cost:</strong> $${claim.repairCost}</div>
            <div><strong>Status:</strong> ${claim.status}</div>
          </div>
          ${(claim.status === 'open' || claim.status === 'assigned') ? `
            <div style="margin-top:12px;border-top:1px solid #333;padding-top:12px">
              <div class="card-subtitle">Manual Resolution ${claim.assignedTech ? '(👷 tech on-site)' : ''}</div>
              <div style="font-size:12px;color:#888;margin-bottom:8px">
                ${claim.inWarranty ? '✅ In warranty — you decide and pay. Pick how to handle this claim.' : '❌ Out of warranty — declining now risks reputation. Pick to intervene early.'}
              </div>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                ${DATA.resolutionOptions.map(ro => {
                  const emoji = { repair: '🔧', repairExpress: '⚡', discount: '💰', replaceMachine: '🔄', storeCredit: '🎫', decline: '❌' };
                  return `<button class="btn btn-sm ${ro.id === 'decline' ? 'btn-danger' : ro.id === 'replaceMachine' ? 'btn-accent' : 'btn-primary'}" onclick="SIM.resolveClaim(window.gameState.company.pendingClaims.find(c=>c.id==='${claim.id}'),'${ro.id}');UI.render();">${emoji[ro.id] || '🔧'} ${ro.name}</button>`;
                }).join('')}
              </div>
              <div style="font-size:11px;color:#888;margin-top:4px">
                ${DATA.resolutionOptions.map(ro => `<span style="margin-right:8px"><strong>${ro.name}:</strong> ${ro.description}</span>`).join('')}
              </div>
            </div>
          ` : `
            <div style="margin-top:12px;border-top:1px solid #333;padding-top:12px">
              <div class="card-subtitle">Resolution: ${claim.resolution}</div>
            </div>
          `}
        </div>
      `;
    }
  }

  el.innerHTML = html;
};

// ---- Market View ----

UI.renderMarketView = function() {
  const el = document.getElementById('screen-market');
  if (!el) return;

  const playerShare = UI.calcMarketShare();

  let html = `
    <div class="card">
      <div class="card-title">📊 Market Overview — ${G.year}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
        <div class="metric-card">
          <div class="metric-label">Total Addressable Market</div>
          <div class="metric-value">${G.market.totalMarketSize.toLocaleString()} households</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Your Market Share</div>
          <div class="metric-value">${playerShare}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Your Machines Sold</div>
          <div class="metric-value">${G.company.totalMachinesSold.toLocaleString()}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Sales This Year</div>
          <div class="metric-value">${G.market.soldThisYear.toLocaleString()}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">Marketing</div>
      <div class="form-group">
        <label>Monthly Marketing Budget ($)</label>
        <input type="range" min="0" max="50000" step="1000" value="${G.company.marketingBudget}"
          oninput="window.gameState.company.marketingBudget=parseInt(this.value);document.getElementById('mktg-val').textContent='$'+this.value;"
          style="width:100%">
        <div style="text-align:center" id="mktg-val">$${G.company.marketingBudget.toLocaleString()}</div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label>Marketing Focus</label>
        <select class="form-select" onchange="window.gameState.company.marketingFocus=this.value;UI.render();">
          <option value="balanced" ${G.company.marketingFocus === 'balanced' ? 'selected' : ''}>⚖️ Balanced</option>
          <option value="price" ${G.company.marketingFocus === 'price' ? 'selected' : ''}>💰 Budget Champion</option>
          <option value="quality" ${G.company.marketingFocus === 'quality' ? 'selected' : ''}>🏆 10-Year Warranty</option>
          <option value="quiet" ${G.company.marketingFocus === 'quiet' ? 'selected' : ''}>🔇 Quietest Washer</option>
          <option value="eco" ${G.company.marketingFocus === 'eco' ? 'selected' : ''}>🌿 Lowest Water Usage</option>
          <option value="durability" ${G.company.marketingFocus === 'durability' ? 'selected' : ''}>💪 Built Like a Tank</option>
        </select>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">🏭 Competitors <span style="font-size:12px;color:var(--text-secondary);font-weight:400">(AI-driven — they design, produce, and compete)</span></div>
      <div class="machine-table">
        <div class="machine-table-header">
          <span>Company</span>
          <span>Status</span>
          <span>Market Share</span>
          <span>Reputation</span>
          <span>Last Model</span>
          <span>Price</span>
          <span>Production</span>
          <span>Marketing</span>
        </div>
        <div class="machine-table-row" style="color:var(--accent-cyan);font-weight:600">
          <span>${G.company.name} (You)</span>
          <span>🟢</span>
          <span>${playerShare}%</span>
          <span>${Math.round(G.company.reputation)}%</span>
          <span>${G.company.models.length > 0 ? G.company.models[G.company.models.length-1].name : '—'}</span>
          <span>${G.company.models.length > 0 ? '$'+(G.company.models[G.company.models.length-1].currentPrice || G.company.models[G.company.models.length-1].retailPrice) : '—'}</span>
          <span>${G.company.productionLines.filter(l=>l.active).length} lines</span>
          <span>$${G.company.marketingBudget.toLocaleString()}</span>
        </div>
        ${G.market.competitors.filter(c => c.active).map(c => {
          const info = AI.getSummary(c);
          const repColor = c._ai?.currentReputation > 60 ? 'var(--accent-green)' : c._ai?.currentReputation > 30 ? 'var(--accent-amber)' : 'var(--accent-red)';
          return `
          <div class="machine-table-row">
            <span><strong>${c.name}</strong></span>
            <span>🟢</span>
            <span>${c.marketShare.toFixed(1)}%</span>
            <span style="color:${repColor}">${info.reputation}</span>
            <span style="font-size:11px">${info.model}</span>
            <span>${info.price}</span>
            <span style="font-size:11px">${info.production}</span>
            <span style="font-size:11px">${info.marketing}</span>
          </div>
        `}).join('')}
        ${G.market.competitors.filter(c => !c.active).map(c => `
          <div class="machine-table-row" style="color:#555">
            <span>${c.name}</span>
            <span>⏳ ${c.startingYear}</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span>—</span>
          </div>
        `).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px">
        AI competitors design machines from available components, set prices, adjust production, and compete for market share.
        Their behaviour is influenced by their strategy and the ${(DATA.difficulty[G.difficulty] || {}).label || G.difficulty} difficulty setting.
      </div>
    </div>
  `;

  // Active Regulations (my addition)
  if (G.market.activeRegulations.length > 0) {
    html += `
      <div class="card" style="margin-top:16px">
        <div class="card-title">📋 Active Regulations</div>
        ${G.market.activeRegulations.map(r => `
          <div class="regulation-item">
            <div><strong>${r.name}</strong> (${r.year})</div>
            <div style="font-size:12px;color:#888">${r.description}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  el.innerHTML = html;
};

// ---- Research View ----

UI.renderResearchView = function() {
  const el = document.getElementById('screen-research');
  if (!el) return;

  const allTechs = DATA.techUnlocks;
  const unlocked = G.company.unlockedTechs;

  let html = `
    <div class="card">
      <div class="card-title">🔬 Research & Development</div>
      <div style="margin-top:8px">
        <div class="form-group">
          <label>Monthly R&D Budget ($)</label>
          <input type="range" min="0" max="20000" step="500" value="${G.company.researchSpending}"
            oninput="window.gameState.company.researchSpending=parseInt(this.value);document.getElementById('research-val').textContent='$'+this.value;"
            style="width:100%">
          <div style="text-align:center" id="research-val">$${G.company.researchSpending.toLocaleString()}</div>
        </div>
        <div style="margin-top:8px">
          <strong>Research Progress:</strong> ${G.company.researchLevel.toFixed(1)}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">Technology Timeline</div>
      <div style="margin-top:8px">
        ${allTechs.map(t => {
          const isUnlocked = unlocked.includes(t.name);
          const yearReached = t.year <= G.year;
          const canResearch = yearReached && !isUnlocked && G.company.researchLevel >= (t.requiredLevel || 0);
          const needResearch = yearReached && !isUnlocked && G.company.researchLevel < (t.requiredLevel || 0);
          const cls = isUnlocked ? 'unlocked' : canResearch ? 'current' : 'locked';
          const icon = isUnlocked ? '✅' : canResearch ? '🔄' : needResearch ? '🔬' : '🔒';
          const progress = needResearch ? ` <span style="color:var(--accent-amber);font-size:11px">(${G.company.researchLevel.toFixed(0)}/${t.requiredLevel})</span>` : '';
          return `
            <div class="tech-item ${cls}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <strong>${t.name}</strong>
                  <span class="badge">${t.year}</span>
                  ${progress}
                </div>
                <div>
                  ${icon}
                </div>
              </div>
              <div style="font-size:12px;color:#888">${t.description}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  el.innerHTML = html;
};

// ---- Game Loop Render ----

UI.gameLoop = function() {
  // _startLock keeps the game paused during initial setup
  // Only explicit unpause (unpauseAndStart) clears it
  if (G._startLock) {
    G.paused = true;
  }
  if (!G.paused) {
    SIM.tick();
  }
  UI.render();
  requestAnimationFrame(UI.gameLoop);
};

// ---- Start Game ----

// ---- Difficulty Selection ----

UI.selectedDifficulty = 'medium';

UI.selectDifficulty = function(diff) {
  UI.selectedDifficulty = diff;
  // Update visual selection
  document.querySelectorAll('.difficulty-option').forEach(el => {
    el.classList.toggle('selected', el.querySelector('.diff-name')?.textContent.toLowerCase().includes(diff) ||
      el.getAttribute('onclick')?.includes(diff));
  });
};

UI.confirmDifficulty = function() {
  // Read company name from input
  const nameInput = document.getElementById('company-name-input');
  const companyName = nameInput ? nameInput.value.trim() : 'Your Brand';

  const modal = document.getElementById('difficulty-modal');
  if (modal) modal.classList.remove('active');
  UI._startFreshGame(UI.selectedDifficulty, companyName || 'Your Brand');
};

UI.showDifficultyPicker = function() {
  const modal = document.getElementById('difficulty-modal');
  if (modal) {
    modal.classList.add('active');
    // Default to medium selected
    UI.selectedDifficulty = 'medium';
  }
};

UI._startFreshGame = function(difficulty, companyName) {
  initGame();
  G.difficulty = difficulty;
  if (companyName) G.company.name = companyName;
  // Re-apply difficulty bonuses after init
  const diff = DATA.difficulty[difficulty] || DATA.difficulty.medium;
  if (diff.playerBonusRep) G.company.reputation += diff.playerBonusRep;
  if (diff.playerBonusCash) G.company.cash += diff.playerBonusCash;

  // Add a default production line
  G.company.productionLines.push({
    id: 'line-1',
    modelId: null,
    speed: 1,
    qualityControl: 0,
    active: false,
  });

  // Initialise AI for any competitors active at start (1945)
  for (const comp of G.market.competitors) {
    if (comp.active) {
      AI.initCompetitor(comp);
    }
  }

  // Start PAUSED with a setup guide — use _startLock so nothing else can unpause
  // Start PAUSED with a setup guide — use _startLock so nothing else can unpause
  G.paused = true;
  G._startLock = true;
  UI._setupState = { step: 0, designedMachine: false, startedProduction: false };

  // Initialise error reporter
  if (typeof ErrorReporter !== 'undefined') {
    ErrorReporter.init();
  }

  SIM.addEvent('info', `🚀 Washing Machine Tycoon started on ${difficulty} difficulty!`);
  UI.init();
  UI.gameLoop();
  // Show the setup overlay after the game loop starts
  setTimeout(() => UI.showSetupGuide(), 200);
};

// ---- Audio Init (on first user click) ----

document.addEventListener('click', function _initAudio() {
  SOUND.init();
  SOUND.setVolume(0.3);
  document.removeEventListener('click', _initAudio);
}, { once: true });

// ---- Keyboard Shortcuts ----
// Space = pause/resume; ArrowUp = speed up; ArrowDown = speed down

document.addEventListener('keydown', function(e) {
  if (typeof G === 'undefined' || !G) return;
  // Don't intercept when typing in an input/textarea/select
  if (/^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName)) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      G.paused = !G.paused;
      if (typeof UI !== 'undefined') UI.render();
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (!G.paused) {
        if (G.speed === 1) { G.speed = 5; }
        else if (G.speed === 5) { G.speed = 30; }
        else { G.speed = 30; }
        if (typeof UI !== 'undefined') UI.render();
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (!G.paused) {
        if (G.speed === 30) { G.speed = 5; }
        else if (G.speed === 5) { G.speed = 1; }
        else { G.speed = 1; }
        if (typeof UI !== 'undefined') UI.render();
      }
      break;
  }
});

// ---- Start Game ----

UI.startGame = function() {
  // Check for saved game — use an in-DOM modal instead of confirm() so it
  // works in iframes / headless / dialog-suppressing contexts (bug #6).
  if (hasSavedGame()) {
    UI._showContinueModal();
    return;
  }

  // Show difficulty picker for fresh start
  UI.showDifficultyPicker();
};

UI.restartGame = function() {
  deleteSavedGame();
  // Reset event system
  SIM._usedEvents = {};
  SIM._pendingEvent = null;
  // Hide any open modals
  const cm = document.getElementById('continue-modal');
  if (cm) cm.style.display = 'none';
  const dm = document.getElementById('difficulty-modal');
  if (dm) dm.classList.remove('active');
  // Hide setup guide if visible
  UI.hideSetupGuide();
  // Show difficulty picker
  UI.showDifficultyPicker();
};

UI._showContinueModal = function() {
  // Build a transient continue/overwrite modal in the DOM.
  let modal = document.getElementById('continue-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'continue-modal';
    modal.className = 'difficulty-modal'; // reuse styling
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="difficulty-modal-content" style="max-width:420px;text-align:center">
        <div class="difficulty-header">📂 Saved Game Found</div>
        <div class="difficulty-subtitle">
          Continue from where you left off, or start a fresh game?
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
          <button class="btn btn-primary" id="continue-yes">📂 Continue Saved Game</button>
          <button class="btn btn-secondary" id="continue-no">🆕 Start Fresh</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
  }

  document.getElementById('continue-yes').onclick = function() {
    modal.style.display = 'none';
    if (loadGame()) {
      if (typeof ErrorReporter !== 'undefined') ErrorReporter.init();
      SIM.addEvent('info', '📂 Game loaded — continuing from ' + formatDate(G.year, G.day));
      UI.init();
      UI.gameLoop();
    } else {
      UI.showMessage('⚠️ Saved game could not be loaded — starting fresh.');
      UI.showDifficultyPicker();
    }
  };
  document.getElementById('continue-no').onclick = function() {
    modal.style.display = 'none';
    UI.showDifficultyPicker();
  };
};

// ---- Chart Drawing ----

UI.drawCharts = function() {
  const h = G.history;
  if (!h.years || h.years.length < 2) return;

  UI.drawLineChart('chart-reputation', h.years, [h.reputation], ['Reputation'], ['#60a5fa'], 0, 100);
  UI.drawLineChart('chart-financial', h.years, [h.revenue, h.expenses], ['Revenue', 'Expenses'], ['#4ade80', '#f87171'], null, null);
  UI.drawLineChart('chart-market', h.years, [h.marketShare], ['Market Share %'], ['#a78bfa'], 0, null);
  UI.drawLineChart('chart-sales', h.years, [h.machinesSold], ['Units Sold'], ['#fbbf24'], 0, null);
};

UI.drawLineChart = function(canvasId, labels, datasets, datasetNames, colors, yMin, yMax) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width;
  const h = canvas.height;
  
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 12, right: 12, bottom: 24, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  if (labels.length < 2 || plotW < 10 || plotH < 10) return;

  // Compute y range across all datasets
  let minY = Infinity, maxY = -Infinity;
  for (const data of datasets) {
    for (const v of data) {
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
  }
  // Pad range
  const range = maxY - minY;
  if (range === 0) { minY -= 1; maxY += 1; }
  const yPad = Math.max(1, range * 0.1);
  const effectiveMin = yMin !== null ? yMin : minY - yPad;
  const effectiveMax = yMax !== null ? yMax : maxY + yPad;

  // Grid lines
  ctx.strokeStyle = '#2d3550';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = '#666';
  const nGrid = 4;
  for (let i = 0; i <= nGrid; i++) {
    const y = pad.top + (plotH / nGrid) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    const val = effectiveMax - (effectiveMax - effectiveMin) * (i / nGrid);
    ctx.fillText(formatY(val), 2, y + 3);
  }

  // X labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#666';
  const labelStep = Math.max(1, Math.floor(labels.length / 6));
  for (let i = 0; i < labels.length; i += labelStep) {
    const x = pad.left + (plotW * i) / (labels.length - 1);
    ctx.fillText(labels[i], x, h - 4);
  }

  // Draw datasets
  for (let d = 0; d < datasets.length; d++) {
    const data = datasets[d];
    ctx.strokeStyle = colors[d % colors.length];
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = pad.left + (plotW * i) / (Math.max(1, data.length - 1));
      const y = pad.top + plotH - ((data[i] - effectiveMin) / (effectiveMax - effectiveMin)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dot on last value
    if (data.length > 0) {
      const lastX = pad.left + plotW;
      const lastY = pad.top + plotH - ((data[data.length - 1] - effectiveMin) / (effectiveMax - effectiveMin)) * plotH;
      ctx.fillStyle = colors[d % colors.length];
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Legend
  ctx.font = '10px sans-serif';
  let legendX = pad.left;
  for (let d = 0; d < datasets.length; d++) {
    ctx.fillStyle = colors[d % colors.length];
    ctx.fillRect(legendX, 3, 8, 8);
    ctx.fillText(datasetNames[d] || '', legendX + 12, 11);
    legendX += ctx.measureText((datasetNames[d] || '') + '  ').width + 24;
    if (legendX > w - pad.right) break;
  }
};

function formatY(v) {
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(0) + 'K';
  return v.toFixed(0);
}

// ---- Setup Guide (Paused Start) ----

UI._setupState = { step: 0, designedMachine: false, startedProduction: false };

UI.showSetupGuide = function() {
  const overlay = document.getElementById('setup-guide');
  if (overlay) overlay.style.display = 'flex';
  UI._updateSetupGuide();
};

UI.hideSetupGuide = function() {
  const overlay = document.getElementById('setup-guide');
  if (overlay) overlay.style.display = 'none';
};

UI._updateSetupGuide = function() {
  // Guard: don't run before G is fully initialized
  if (!G || !G.company || !G.company.models || !UI._setupState) return;

  // Auto-detect progress
  if (G.company.models.length > 0) {
    UI._setupState.designedMachine = true;
  }
  if (G.company.productionLines.some(l => l.active)) {
    UI._setupState.startedProduction = true;
  }

  const state = UI._setupState;
  const steps = [
    { label: 'Design a washing machine', done: state.designedMachine, action: "UI.showScreen('design'); UI.hideSetupGuide();", screen: 'design' },
    { label: 'Assign model & start production', done: state.startedProduction, action: "UI.showScreen('factory'); UI.hideSetupGuide();", screen: 'factory' },
    { label: 'Unpause the game and start selling', done: false, action: "UI.unpauseAndStart();", screen: null, alwaysShow: true },
  ];

  const progress = steps.filter(s => s.done).length;
  const total = steps.length - 1; // last step doesn't count as "done"

  let html = '<div class="setup-progress">';
  html += '<div class="setup-progress-bar"><div class="setup-progress-fill" style="width:' + (progress / total * 100) + '%"></div></div>';
  html += '<div class="setup-progress-label">' + progress + ' of ' + total + ' setup steps complete</div></div>';
  html += '<div class="setup-steps">';

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isActive = i === state.step && !s.done;
    const cls = s.done ? 'setup-step done' : isActive ? 'setup-step active' : 'setup-step';
    html += '<div class="' + cls + '">';
    html += '<div class="setup-step-indicator">' + (s.done ? '✓' : (i + 1)) + '</div>';
    html += '<div class="setup-step-body">';
    html += '<div class="setup-step-label">' + s.label + '</div>';
    if (!s.done && s.action) {
      html += '<button class="btn btn-sm ' + (isActive ? 'btn-primary' : 'btn-secondary') + '" onclick="' + s.action + '">' +
        (i < 2 ? 'Go there →' : '▶ Unpause & Start') + '</button>';
    }
    if (s.done) {
      html += '<div class="setup-step-done">✅ Done</div>';
    }
    html += '</div></div>';
  }

  html += '</div>';
  html += '<div class="setup-tip" id="setup-tip">';
  html += UI._getSetupTip(state);
  html += '</div>';

  const bodyEl = document.getElementById('setup-guide-body');
  if (bodyEl) bodyEl.innerHTML = html;
};

UI._getSetupTip = function(state) {
  if (!state.designedMachine) {
    return '💡 <strong>Tip:</strong> Start in the <strong>Design Studio</strong>. A stainless steel drum and induction motor make a solid mid-range machine. Set the price around $499.';
  }
  if (!state.startedProduction) {
    return '💡 <strong>Tip:</strong> In the <strong>Factory</strong>, select your new model in the production line dropdown, then click <strong>Start</strong>. Balance speed vs quality control.';
  }
  return '💡 <strong>Tip:</strong> Your factory is running! Click <strong>Unpause</strong> to start selling machines. Watch the Dashboard for your first sales and reputation growth.';
};

UI.unpauseAndStart = function() {
  G._startLock = false;
  G.paused = false;
  UI.hideSetupGuide();
  UI._setupState.step = 99;
  ErrorReporter.clear();
  UI.showMessage('🚀 Game started! Watch your Dashboard for sales.');
  UI.render();
};

// ---- Help Overlay (How to Play) ----

UI.showHelp = function() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'flex';
};

UI.dismissHelp = function() {
  const overlay = document.getElementById('help-overlay');
  if (overlay) overlay.style.display = 'none';
};

// ---- Paused Indicator (shown in topbar when paused) ----

UI.renderPausedIndicator = function() {
  // This is called from renderTopBar
  const indicator = document.getElementById('paused-indicator');
  if (!indicator) return;
  if (G.paused && UI._setupState && UI._setupState.step < 99) {
    indicator.style.display = 'flex';
    indicator.innerHTML = '⏸ <span>PAUSED — Complete the setup steps above to start</span>';
  } else if (G.paused) {
    indicator.style.display = 'flex';
    indicator.innerHTML = '⏸ <span>PAUSED — <a href="#" onclick="G.paused=false;UI.render();return false" style="color:var(--accent-cyan)">Click to resume</a></span>';
  } else {
    indicator.style.display = 'none';
    indicator.innerHTML = '';
  }
};

// ---- Random Event UI ----

UI._lastEventCheck = 0;

UI.checkPendingEvent = function() {
  if (!SIM._pendingEvent) {
    const modal = document.getElementById('event-modal');
    if (modal && modal.style.display !== 'none') {
      modal.style.display = 'none';
      G.paused = false;
    }
    return;
  }

  // Only process one event at a time
  const event = SIM._pendingEvent;
  const modal = document.getElementById('event-modal');
  if (!modal) return;

  // Pause the game while event is showing
  G.paused = true;
  modal.style.display = 'flex';

  const headerEl = document.getElementById('event-modal-header');
  const titleEl = document.getElementById('event-modal-title');
  const descEl = document.getElementById('event-modal-desc');
  const narrEl = document.getElementById('event-modal-narrative');
  const choicesEl = document.getElementById('event-modal-choices');
  const footerEl = document.getElementById('event-modal-footer');

  if (headerEl) {
    const typeLabel = { positive: '🌟 GOOD NEWS', negative: '🌩️ TROUBLE', choice: '📋 DECISION REQUIRED' };
    headerEl.textContent = typeLabel[event.type] || '📋 EVENT';
    headerEl.className = 'event-modal-header ' + (event.type === 'positive' ? 'positive' : event.type === 'negative' ? 'negative' : 'choice');
  }
  if (titleEl) titleEl.textContent = event.name;
  if (descEl) descEl.textContent = event.desc;
  if (narrEl) narrEl.textContent = event.narrative || '';

  if (choicesEl && footerEl) {
    if (event.type === 'choice' && event.choices) {
      choicesEl.style.display = 'flex';
      footerEl.style.display = 'none';
      choicesEl.innerHTML = event.choices.map((c, i) => `
        <button class="event-choice-btn" onclick="UI.resolveEventChoice(${i})">
          ${c.text}
          ${c.effects ? '<span class="choice-cost">' + UI._formatChoiceEffects(c.effects) + '</span>' : ''}
        </button>
      `).join('');
    } else {
      choicesEl.style.display = 'none';
      footerEl.style.display = 'block';
    }
  }
};

UI._formatChoiceEffects = function(effects) {
  const parts = [];
  if (effects.cash) parts.push(`Cash: ${effects.cash >= 0 ? '+' : ''}$${effects.cash.toLocaleString()}`);
  if (effects.reputation) parts.push(`Rep: ${effects.reputation >= 0 ? '+' : ''}${effects.reputation}`);
  return parts.join(' · ');
};

UI.resolveEventChoice = function(index) {
  SIM.resolveChoiceEvent(index);
  const modal = document.getElementById('event-modal');
  if (modal) modal.style.display = 'none';
  G.paused = false;
  UI.render();
};

UI.dismissEvent = function() {
  const modal = document.getElementById('event-modal');
  if (modal) modal.style.display = 'none';
  // If there's a pending non-choice event, clear it
  if (SIM._pendingEvent && SIM._pendingEvent.type !== 'choice') {
    SIM._pendingEvent = null;
  }
  G.paused = false;
  UI.render();
};

// ---- Expose to HTML ----

// Make key functions accessible from HTML onclick
// Note: G is a global variable (from game.js), not window.G
window.UI = UI;
window.SIM = SIM;
