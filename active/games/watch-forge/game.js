// game.js — Watch Forge main controller (browser only)
// =====================================================
// Wires the domain (data.js, watch.js, evolution.js) and the renderer
// (render.js) to the DOM: challenge cards, evolution controls, the dial /
// profile / chart canvases, the champion panel, the watchmaker tinker
// panel, and the Hall of Fame (localStorage).

'use strict';

(() => {
  const D = window.WATCH_DATA;
  const W = window.WATCH;
  const E = window.WATCH_EVOLUTION;
  const R = window.WATCH_RENDER;

  // Restore the saved dial finish before the first paint.
  let themeName = 'cream';
  try { themeName = localStorage.getItem('watchforge.theme') || 'cream'; } catch { /* private mode */ }
  R.setTheme(themeName);

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  const G = {
    challengeId: 'skeleton',
    popSize: 80,
    elitism: 10,
    speed: '10x',
    running: true,
    generation: 0,
    bestSeries: [],        // best score per generation (decimated)
    avgSeries: [],
    seriesPointGap: 1,     // record every Nth generation
    champion: null,        // { geno, pheno, score }
    population: [],
    evoState: { population: [], lastBest: undefined, stall: 0, mutRate: 0.08 },
    rngSeed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
    gensPerSecond: 40,
    acc: 0,
    lastGenUI: -1,
    clock: 0,
    watchmaker: null,
    hof: [],
    history: [],          // lineage events: { gen, name, note }
    soundOn: false,
    chimeOn: false,
    constraints: { budgetCap: 0, thicknessCap: 0 },
    hybrid: null,             // { primary, secondary, weight } or null
  };

  const S = window.WATCH_SOUND;

  const SPEEDS = {
    pause: { label: '⏸', gps: 0 },
    '1x':   { label: '1×', gps: 4 },
    '10x':  { label: '10×', gps: 60 },
    '100x': { label: '100×', gps: 600 },
    '1000x': { label: '1000×', gps: 3000 },
  };

  // -----------------------------------------------------------------------
  // DOM refs
  // -----------------------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const els = {
    dial: $('#dialCanvas'), profile: $('#profileCanvas'), chart: $('#chartCanvas'),
    gen: $('#gen'), score: $('#score'), mutRate: $('#mutRate'), stall: $('#stall'),
    diversity: $('#diversity'),
    name: $('#champName'), challenge: $('#champChallenge'),
    stats: $('#statGrid'), comps: $('#compList'),
    challenges: $('#challengeCards'), speeds: $('#speedButtons'),
    hybridSel: $('#hybridSel'), hybridWeight: $('#hybridWeight'), hybridWeightVal: $('#hybridWeightVal'),
    hybridWeightWrap: $('#hybridWeightWrap'),
    popSize: $('#popSize'), popSizeVal: $('#popSizeVal'),
    reset: $('#resetBtn'), seedNew: $('#seedNewBtn'), step: $('#stepBtn'),
    hof: $('#hofList'), saveHof: $('#saveHofBtn'),
    exportBtn: $('#exportBtn'),
    themePick: $('#themePick'),
    budgetCap: $('#budgetCap'), thicknessCap: $('#thicknessCap'),
    soundTick: $('#soundTick'), soundChime: $('#soundChime'),
    lineage: $('#lineageList'),
    wmLoad: $('#wmLoadBtn'), wmSeed: $('#wmSeedBtn'),
    scoreBreakdown: $('#scoreBreakdown'),
    rngSeed: $('#rngSeed'),
  };

  // -----------------------------------------------------------------------
  // Canvas setup (DPR aware)
  // -----------------------------------------------------------------------
  function setupCanvas(canvas, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  const dialCtx = setupCanvas(els.dial, 560, 560);
  const profileCtx = setupCanvas(els.profile, 560, 120);
  const chartCtx = setupCanvas(els.chart, 560, 210);

  // -----------------------------------------------------------------------
  // Population / evolution
  // -----------------------------------------------------------------------
  function newPopulation(seed) {
    if (seed === undefined) seed = G.rngSeed;
    const rng = W.mulberry32(seed);
    G.population = E.randomPopulation(G.popSize, rng, G.challengeId);
    G.evoState = { population: G.population.slice(), lastBest: undefined, stall: 0, mutRate: 0.08 };
    G.generation = 0;
    G.bestSeries = []; G.avgSeries = [];
    G.seriesPointGap = 1;
    G.acc = 0;
    // Initial champion
    const c = E.championPhenotype(G.population, G.challengeId, G.constraints, G.hybrid);
    G.champion = c;
    G.lastGenUI = -1;
    updateChampionUI();
  }

  function stepGeneration() {
    const n = Math.min(G.popSize, 1);
    G.evoState = E.evolvePopulation({
      challengeId: G.challengeId,
      population: G.evoState.population,
      elitism: G.elitism,
      baseMutRate: 0.08,
      constraints: G.constraints,
      hybrid: G.hybrid,
      rng: W.mulberry32((G.rngSeed ^ (G.generation * 2654435761)) >>> 0),
    });
    G.population = G.evoState.population;
    G.generation += n;
    recordSeries();
    if (G.evoState.best.score > (G.champion ? G.champion.score : -Infinity) + 1e-9) {
      const prev = G.champion;
      G.champion = G.evoState.best;
      pushLineage(prev, G.champion);
    }
  }

  function pushLineage(prev, next) {
    let note = '';
    if (!prev) {
      note = 'founding specimen';
    } else {
      const added = next.pheno.compList.filter(c => !prev.pheno.compList.some(p => p.id === c.id));
      const removed = prev.pheno.compList.filter(p => !next.pheno.compList.some(c => c.id === p.id));
      if (added.length) note = `+${added.map(c => c.name).join(', ')}`;
      else if (removed.length) note = `−${removed.map(c => c.name).join(', ')}`;
      else if (next.pheno.accuracy !== prev.pheno.accuracy) note = `rate ${prev.pheno.accuracy} → ${next.pheno.accuracy} s/day`;
      else note = `score +${(next.score - prev.score).toFixed(1)}`;
    }
    G.history.push({ gen: G.generation, name: next.pheno.name, note, score: next.score });
    if (G.history.length > 60) G.history.shift();
  }

  function renderLineage() {
    if (!G.history.length) { els.lineage.innerHTML = ''; return; }
    els.lineage.innerHTML = G.history.slice(-6).reverse().map(h =>
      `<div class="lineage-row"><span class="lg">g${h.gen}</span><span class="ld">${h.name}</span><span>${h.note}</span></div>`
    ).join('');
  }


  function recordSeries() {
    if (G.generation % G.seriesPointGap !== 0) return;
    const scored = G.evoState.scored;
    let sum = 0;
    for (const s of scored) sum += s.score;
    // Plot the champion as the best line: it only moves upward (stepGeneration
    // accepts strictly better champions), so the curve reads as progress even
    // for rank-blended hybrids where per-generation maxima can jitter.
    G.bestSeries.push(G.champion ? G.champion.score : G.evoState.best.score);
    G.avgSeries.push(sum / scored.length);
    // Keep the arrays bounded; grow the decimation gap when they get long.
    if (G.bestSeries.length > 700) {
      G.seriesPointGap *= 2;
      const nb = [], na = [];
      for (let i = 0; i < G.bestSeries.length; i += 2) { nb.push(G.bestSeries[i]); na.push(G.avgSeries[i]); }
      G.bestSeries = nb; G.avgSeries = na;
    }
  }

  function stepMany(n) {
    for (let i = 0; i < n; i++) stepGeneration();
  }

  // -----------------------------------------------------------------------
  // Champion UI
  // -----------------------------------------------------------------------
  function fmt(v, d = 0) { return Number(v).toFixed(d); }

  function updateChampionUI() {
    const c = G.champion;
    if (!c) return;
    els.gen.textContent = String(G.generation);
    els.score.textContent = fmt(c.score, 1);
    els.name.textContent = c.pheno.name;
    const hyLabel = G.hybrid
      ? `${E.CHALLENGES[G.challengeId].icon} ${E.CHALLENGES[G.challengeId].name} × ${E.CHALLENGES[G.hybrid.secondary].icon} ${E.CHALLENGES[G.hybrid.secondary].name} · ${Math.round(G.hybrid.weight * 100)}/${100 - Math.round(G.hybrid.weight * 100)}`
      : `${E.CHALLENGES[G.challengeId].icon} ${E.CHALLENGES[G.challengeId].name}`;
    els.challenge.textContent = hyLabel;
    els.mutRate.textContent = `${(G.evoState.mutRate * 100).toFixed(0)}%`;
    els.stall.textContent = String(G.evoState.stall || 0);
    els.diversity.textContent = `${(E.diversity(G.population) * 100).toFixed(0)}%`;

    // Keep the audible movement in sync with the champion.
    S.setBeat(c.pheno.geno.beat);
    const hasRepeater = !!c.pheno.geno.complications.minuteRepeater;
    els.soundChime.disabled = !hasRepeater;
    S.setChime(G.chimeOn && hasRepeater);

    renderLineage();

    const g = c.pheno.geno;
    const rows = [
      ['Accuracy', `${c.pheno.accuracy} s/day${c.pheno.reliability < 0.85 ? ' ⚠' : ''}`, c.pheno.accuracy <= 1.5 ? 'good' : c.pheno.accuracy <= 4 ? 'mid' : 'bad'],
      ['Effective rate', `${c.pheno.effectiveAccuracy} s/day`, null],
      ['Power reserve', `${c.pheno.powerReserve} h`, c.pheno.powerReserve >= 60 ? 'good' : null],
      ['Reliability', `${(c.pheno.reliability * 100).toFixed(0)}%`, c.pheno.reliability >= 0.8 ? 'good' : null],
      ['Components', `${c.pheno.componentCount}`, null],
      ['Visible parts', `${c.pheno.visibleComponents} (${Math.round(c.pheno.open * 100)}% open)`, c.pheno.open > 0.6 ? 'good' : null],
      ['Thickness', `${c.pheno.thickness} mm`, c.pheno.thickness <= 7 ? 'good' : c.pheno.thickness <= 10 ? 'mid' : 'bad'],
      ['Diameter', `${g.diameter} mm`, null],
      ['Complications', `${c.pheno.compCount} (Σ${c.pheno.compGradeSum})`, c.pheno.compCount >= 5 ? 'good' : null],
      ['Weight', `${c.pheno.weight} g`, null],
      ['Complexity', `${c.pheno.complexity}`, c.pheno.complexity > 40 ? 'bad' : null],
      ['Cost', `CHF ${c.pheno.cost.toLocaleString()}`, null],
    ];
    els.stats.innerHTML = rows.map(([k, v, cls]) =>
      `<div class="stat ${cls || ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

    // Component list
    const base = [
      ['Escapement', D.ESCAPEMENTS[g.escapement].name],
      ['Balance', D.BALANCES[g.balance].name],
      ['Hairspring', D.HAIRSPRINGS[g.hairspring].name],
      ['Beat rate', D.BEATS[g.beat].name],
      ['Barrels', `${g.barrels} × ${D.BARREL.thick.toFixed(2)} mm`],
      ['Train wheels', `${g.trainWheels} × ${D.TRAIN_WHEEL.thick.toFixed(2)} mm`],
      ['Skeletonization', `${g.skeleton}% openwork`],
    ];
    const list = [...base, ...c.pheno.compList.map(comp =>
      [`${comp.name} ${'■'.repeat(comp.grade)}`, `${comp.thick.toFixed(2)} mm · +${comp.cost} CHF`])];
    els.comps.innerHTML = list.map(([k, v]) =>
      `<div class="comp-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

    // Live score breakdown
    const eq = E.CHALLENGES[G.challengeId];
    const w = c.pheno;
    const parts = {
      skeleton: [
        [`Visible parts ×14`, `${w.visibleComponents} × 14 = +${(w.visibleComponents * 14).toFixed(0)}`],
        [`Openness ×30`, `${w.open.toFixed(2)} × 30 = +${(w.open * 30).toFixed(0)}`],
        [`Reserve ×0.15`, `+${(w.powerReserve * 0.15).toFixed(1)}`],
        [`Thickness ×6`, `−${(w.thickness * 6).toFixed(1)}`],
        [`Cost ×0.004`, `−${(w.cost * 0.004).toFixed(1)}`],
      ],
      minimalist: [
        [`Accuracy term`, `${(480 / (1 + Math.abs(w.accuracy))).toFixed(0)}`],
        [`Reliability ×50`, `+${(w.reliability * 50).toFixed(0)}`],
        [`Components ×9`, `−${(w.componentCount * 9).toFixed(0)}`],
        [`Thickness ×14`, `−${(w.thickness * 14).toFixed(1)}`],
        [`Complexity ×1.2`, `−${(w.complexity * 1.2).toFixed(1)}`],
        [`Cost ×0.0025`, `−${(w.cost * 0.0025).toFixed(1)}`],
      ],
      grandComplication: [
        [`Complications ×75`, `+${w.compCount * 75}`],
        [`Grade sum ×22`, `+${w.compGradeSum * 22}`],
        [`Accuracy term`, `+${(40 / (1 + Math.abs(w.accuracy))).toFixed(0)}`],
        [`Reliability ×25`, `+${(w.reliability * 25).toFixed(0)}`],
        [`Thickness ×48`, `−${(w.thickness * 48).toFixed(1)}`],
        [`Components ×1.5`, `−${(w.componentCount * 1.5).toFixed(0)}`],
        [`Cost ×0.002`, `−${(w.cost * 0.002).toFixed(1)}`],
      ],
      chronometer: [
        [`Accuracy term`, `${(600 / (1 + Math.abs(w.effectiveAccuracy))).toFixed(0)}`],
        [`Reliability ×80`, `+${(w.reliability * 80).toFixed(0)}`],
        [`Cost ×0.004`, `−${(w.cost * 0.004).toFixed(1)}`],
        [`Thickness ×8`, `−${(w.thickness * 8).toFixed(1)}`],
      ],
      pocket: [
        [`Reserve ×2.2`, `+${(w.powerReserve * 2.2).toFixed(0)}`],
        [`Reliability ×90`, `+${(w.reliability * 90).toFixed(0)}`],
        [`Cost ×0.003`, `−${(w.cost * 0.003).toFixed(1)}`],
        [`Thickness ×10`, `−${(w.thickness * 10).toFixed(1)}`],
        [`Accuracy ×0.5`, `−${(w.accuracy * 0.5).toFixed(1)}`],
      ],
    };
    const raw = E.CHALLENGES[G.challengeId].score(w);
    const penalty = E.constraintPenalty(w, G.constraints);
    const hy = G.hybrid;
    let hybridRows = '';
    let totalLine = eq.equation;
    if (hy) {
      const s2 = E.CHALLENGES[hy.secondary].score(w);
      const blend = `${Math.round((1 - hy.weight) * 100)}% ${E.CHALLENGES[G.challengeId].name} + ${Math.round(hy.weight * 100)}% ${E.CHALLENGES[hy.secondary].name}`;
      hybridRows = `<div class="sb-row sb-hybrid"><span>primary (${E.CHALLENGES[G.challengeId].name})</span><span>${raw.toFixed(1)}</span></div>`
        + `<div class="sb-row sb-hybrid"><span>secondary (${E.CHALLENGES[hy.secondary].name})</span><span>${s2.toFixed(1)}</span></div>`;
      totalLine = `blended = 100·(${blend}) — rank-fused, so both objectives stay audible`;
    }
    let constraintRows = '';
    if (penalty > 0) {
      constraintRows = `<div class="sb-row sb-penalty"><span>⛔ raw score</span><span>${raw.toFixed(1)}</span></div>`
        + `<div class="sb-row sb-penalty"><span>⛔ constraint penalty</span><span>−${penalty.toFixed(1)}</span></div>`;
    }
    els.scoreBreakdown.innerHTML = hybridRows + constraintRows + parts[G.challengeId]
      .map(([k, v]) => `<div class="sb-row"><span>${k}</span><span>${v}</span></div>`).join('')
      + `<div class="sb-total">${totalLine}${G.constraints.budgetCap ? ` · budget ≤ CHF ${G.constraints.budgetCap.toLocaleString()}` : ''}${G.constraints.thicknessCap ? ` · thickness ≤ ${G.constraints.thicknessCap} mm` : ''}</div>`;
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------
  function draw(now) {
    const t = now / 1000;
    const c = G.champion;
    if (c) {
      const pheno = c.pheno;
      const specials = {
        hourAng: (t / 3600) % (Math.PI * 2),
        minAng: ((t / 60) % 1) * Math.PI * 2,
        secAng: (t % 60) / 60 * Math.PI * 2,
        gmtAng: ((t / 3600) * 1.03) % (Math.PI * 2),
        dateValue: 27,
      };
      R.drawWatchDial(dialCtx, 560, pheno, t, specials);
      R.drawSideProfile(profileCtx, 560, 120, pheno);
    }
    R.drawFitnessChart(chartCtx, 560, 210, G.bestSeries, G.avgSeries, G.generation);
  }

  // -----------------------------------------------------------------------
  // Main loop: evolution stepping (time-budgeted) + render
  // -----------------------------------------------------------------------
  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    G.clock += dt;

    if (G.running && G.speed !== 'pause') {
      G.acc += G.gensPerSecond * dt;
      let n = Math.floor(G.acc);
      G.acc -= n;
      // Time budget: cap at ~7ms of evolution per frame; the rest spills.
      const budgetCapped = Math.min(n, 300);
      if (n > 0) {
        stepMany(budgetCapped);
        if (G.generation !== G.lastGenUI) {
          G.lastGenUI = G.generation;
          updateChampionUI();
        }
        if (budgetCapped < n) G.acc += n - budgetCapped; // spill
      } else {
        G.acc = Math.min(G.acc, G.gensPerSecond * 0.25); // avoid huge debt while paused-ish
      }
    }

    draw(now);
    S.update(now / 1000);
    requestAnimationFrame(frame);
  }

  // -----------------------------------------------------------------------
  // Challenge selection
  // -----------------------------------------------------------------------
  function buildChallenges() {
    const charters = Object.values(E.CHALLENGES);
    els.challenges.innerHTML = charters.map(ch =>
      `<button class="challenge ${ch.id === G.challengeId ? 'active' : ''}" data-id="${ch.id}">
        <span class="ci">${ch.icon}</span>
        <span class="cn">${ch.name}</span>
        <span class="ct">${ch.tagline}</span>
        <code class="ceq">${ch.equation}</code>
      </button>`).join('');
    // Secondary charter options for hybrid blends (all except the primary).
    els.hybridSel.innerHTML = `<option value="">— single charter —</option>`
      + charters.filter(ch => ch.id !== G.challengeId).map(ch =>
        `<option value="${ch.id}">${ch.icon} ${ch.name}</option>`).join('');
    els.challenges.querySelectorAll('.challenge').forEach(btn => {
      btn.addEventListener('click', () => {
        G.challengeId = btn.dataset.id;
        applyCharterChange();
      });
    });
    els.hybridSel.addEventListener('change', onHybridChange);
    els.hybridWeight.addEventListener('input', onHybridChange);
  }

  function onHybridChange() {
    const secondary = els.hybridSel.value;
    const weight = Number(els.hybridWeight.value) / 100;
    if (!secondary) {
      G.hybrid = null;
      els.hybridWeightWrap.hidden = true;
      els.hybridSel.querySelectorAll('option').forEach(o => { o.disabled = o.value === G.challengeId; });
    } else {
      G.hybrid = { primary: G.challengeId, secondary, weight };
      els.hybridWeightWrap.hidden = false;
      els.hybridWeightVal.textContent = String(Math.round(weight * 100));
      G.history.push({ gen: G.generation, name: G.champion?.pheno.name || '—',
        note: `hybrid ${E.CHALLENGES[G.challengeId].name} × ${E.CHALLENGES[secondary].name} ${Math.round(weight * 100)}/${100 - Math.round(weight * 100)}` });
    }
    G.evoState.lastBest = undefined; G.evoState.stall = 0;
    const c = E.championPhenotype(G.population, G.challengeId, G.constraints, G.hybrid);
    G.champion = c;
    G.bestSeries = []; G.avgSeries = [];
    updateChampionUI();
  }

  function applyCharterChange() {
    els.challenges.querySelectorAll('.challenge').forEach(b => b.classList.toggle('active', b.dataset.id === G.challengeId));
    // Keep the hybrid secondary list consistent with the new primary.
    if (G.hybrid && G.hybrid.secondary === G.challengeId) G.hybrid = null;
    els.hybridSel.querySelectorAll('option').forEach(o => { o.disabled = o.value === G.challengeId; });
    if (G.hybrid) G.hybrid.primary = G.challengeId;
    if (G.hybrid) els.hybridWeightVal.textContent = String(Math.round(G.hybrid.weight * 100));
    els.hybridWeightWrap.hidden = !G.hybrid;
    // Re-score current population under the new objective immediately.
    G.evoState.lastBest = undefined; G.evoState.stall = 0;
    const c = E.championPhenotype(G.population, G.challengeId, G.constraints, G.hybrid);
    G.champion = c;
    G.history.push({ gen: G.generation, name: c.pheno.name, note: `re-scored under ${E.CHALLENGES[G.challengeId].name}${G.hybrid ? ` × ${E.CHALLENGES[G.hybrid.secondary].name}` : ''}` });
    G.bestSeries = []; G.avgSeries = [];
    updateChampionUI();
  }

  // -----------------------------------------------------------------------
  // Controls
  // -----------------------------------------------------------------------
  function buildSpeeds() {
    els.speeds.innerHTML = Object.entries(SPEEDS).map(([id, s]) =>
      `<button class="speed ${id === G.speed ? 'active' : ''}" data-id="${id}" title="${id}">${s.label}</button>`).join('');
    els.speeds.querySelectorAll('.speed').forEach(btn => {
      btn.addEventListener('click', () => {
        G.speed = btn.dataset.id;
        G.gensPerSecond = SPEEDS[G.speed].gps;
        els.speeds.querySelectorAll('.speed').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  // -----------------------------------------------------------------------
  // Watchmaker (manual tuning) panel
  // -----------------------------------------------------------------------
  function buildWatchmaker() {
    // Start from scratch or from champion
    const fresh = () => Object.assign(W.randomGenotype(W.mulberry32((Math.random() * 0xffffffff) >>> 0)), { complications: {} });

    G.watchmaker = fresh();

    const box = $('#watchmaker');
    const baseSelect = (rowId, label, options, get, set) => {
      box.querySelector(`#${rowId}`).innerHTML =
        `<label>${label}</label><select data-role="${rowId}">${options.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select>`;
      const sel = box.querySelector(`[data-role="${rowId}"]`);
      sel.value = get(G.watchmaker);
      sel.addEventListener('change', () => { set(G.watchmaker, sel.value); });
    };

    baseSelect('wmEsc', 'Escapement',
      Object.entries(D.ESCAPEMENTS).map(([k, v]) => [k, v.name]),
      g => g.escapement, (g, v) => { g.escapement = v; });
    baseSelect('wmBal', 'Balance',
      Object.entries(D.BALANCES).map(([k, v]) => [k, v.name]),
      g => g.balance, (g, v) => { g.balance = v; });
    baseSelect('wmHs', 'Hairspring',
      Object.entries(D.HAIRSPRINGS).map(([k, v]) => [k, v.name]),
      g => g.hairspring, (g, v) => { g.hairspring = v; });
    baseSelect('wmBeat', 'Beat rate',
      Object.entries(D.BEATS).map(([k, v]) => [String(k), v.name]),
      g => String(g.beat), (g, v) => { g.beat = Number(v); });

    const numeric = (rowId, label, min, max, get, set) => {
      const row = box.querySelector(`#${rowId}`);
      row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="1"><span class="wm-val"></span>`;
      const input = row.querySelector('input'), val = row.querySelector('.wm-val');
      const sync = () => { val.textContent = get(G.watchmaker); };
      input.value = get(G.watchmaker); sync();
      input.addEventListener('input', () => { set(G.watchmaker, Number(input.value)); sync(); });
    };
    numeric('wmBarrels', 'Barrels', 1, 3, g => g.barrels, (g, v) => { g.barrels = v; });
    numeric('wmTrain', 'Train wheels', 3, 9, g => g.trainWheels, (g, v) => { g.trainWheels = v; });
    numeric('wmSkel', 'Skeleton %', 0, 100, g => g.skeleton, (g, v) => { g.skeleton = v; });
    numeric('wmDia', 'Diameter', 28, 42, g => g.diameter, (g, v) => { g.diameter = v; });

    // Complications toggles + grades
    const compBox = box.querySelector('#wmComps');
    compBox.innerHTML = D.COMPLICATION_IDS.map(id => {
      const c = D.COMPLICATIONS[id];
      return `<div class="wm-comp" data-id="${id}">
        <label class="wm-toggle"><input type="checkbox"> ${c.name}</label>
        <select class="wm-grade" disabled>
          ${[1, 2, 3].map(g => `<option value="${g}">grade ${g}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
    const syncComps = () => {
      compBox.querySelectorAll('.wm-comp').forEach(row => {
        const id = row.dataset.id;
        const cb = row.querySelector('input[type=checkbox]');
        const grade = row.querySelector('.wm-grade');
        const v = G.watchmaker.complications[id] || 0;
        cb.checked = v > 0;
        grade.disabled = v === 0;
        grade.value = v || 1;
      });
    };
    compBox.querySelectorAll('.wm-comp').forEach(row => {
      const id = row.dataset.id;
      const cb = row.querySelector('input[type=checkbox]');
      const grade = row.querySelector('.wm-grade');
      cb.addEventListener('change', () => {
        if (cb.checked) G.watchmaker.complications[id] = Number(grade.value);
        else delete G.watchmaker.complications[id];
        grade.disabled = !cb.checked;
      });
      grade.addEventListener('change', () => {
        G.watchmaker.complications[id] = Number(grade.value);
      });
    });

    els.wmLoad.addEventListener('click', () => {
      if (!G.champion) return;
      G.watchmaker = JSON.parse(JSON.stringify(G.champion.geno));
      syncFromWatchmaker(baseSelect, numeric, syncComps);
    });
    els.wmSeed.addEventListener('click', () => seedPopulationFromWatchmaker());

    function syncFromWatchmaker() {
      // Re-run all selects/ranges against the current watchmaker build.
      box.querySelector('[data-role="wmEsc"]').value = G.watchmaker.escapement;
      box.querySelector('[data-role="wmBal"]').value = G.watchmaker.balance;
      box.querySelector('[data-role="wmHs"]').value = G.watchmaker.hairspring;
      box.querySelector('[data-role="wmBeat"]').value = String(G.watchmaker.beat);
      box.querySelector('#wmBarrels input').value = G.watchmaker.barrels;
      box.querySelector('#wmTrain input').value = G.watchmaker.trainWheels;
      box.querySelector('#wmSkel input').value = G.watchmaker.skeleton;
      box.querySelector('#wmDia input').value = G.watchmaker.diameter;
      for (const id of ['wmBarrels', 'wmTrain', 'wmSkel', 'wmDia']) {
        box.querySelector(`#${id} .wm-val`).textContent = G.watchmaker[id];
      }
      syncComps();
    }
  }

  function seedPopulationFromWatchmaker() {
    const base = JSON.parse(JSON.stringify(G.watchmaker));
    const rng = W.mulberry32((Math.random() * 0xffffffff) >>> 0);
    const pop = [base];
    for (let i = 1; i < G.popSize; i++) {
      const child = E.evolvePopulation({
        challengeId: G.challengeId,
        population: [base, W.randomGenotype(rng)],
        elitism: 1, baseMutRate: 0.25, constraints: G.constraints, hybrid: G.hybrid, rng,
      }).population[0];
      pop.push(child);
    }
    G.population = pop;
    G.evoState = { population: pop.slice(), lastBest: undefined, stall: 0, mutRate: 0.08 };
    G.generation = 0;
    G.bestSeries = []; G.avgSeries = [];
    const c = E.championPhenotype(G.population, G.challengeId, G.constraints, G.hybrid);
    G.champion = c;
    updateChampionUI();
  }

  // -----------------------------------------------------------------------
  // Hall of Fame (localStorage)
  // -----------------------------------------------------------------------
  function loadHof() {
    try { G.hof = JSON.parse(localStorage.getItem('watchforge.hof') || '[]'); } catch { G.hof = []; }
  }
  function saveHof() {
    localStorage.setItem('watchforge.hof', JSON.stringify(G.hof));
    renderHof();
  }
  function renderHof() {
    if (!G.hof.length) {
      els.hof.innerHTML = '<div class="hof-empty">No champions saved yet. Evolve one, then press “Save champion”.</div>';
      return;
    }
    els.hof.innerHTML = G.hof.map((h, i) =>
      `<div class="hof-row" data-i="${i}">
        <span class="hof-rank">#${h.rank}</span>
        <span class="hof-main"><b>${h.name}</b><span>${E.CHALLENGES[h.challengeId]?.name || h.challengeId} · ${fmt(h.score, 1)} pts</span></span>
        <span class="hof-stats">${h.pheno.thickness}mm · ${h.pheno.componentCount}p · ${h.pheno.compCount}c · ${h.pheno.accuracy}s/d · ${h.pheno.powerReserve}h</span>
        <button class="hof-del" title="delete">✕</button>
      </div>`).join('');
    els.hof.querySelectorAll('.hof-row').forEach(row => {
      row.addEventListener('click', (ev) => {
        if (ev.target.classList.contains('hof-del')) return;
        const h = G.hof[Number(row.dataset.i)];
        G.challengeId = h.challengeId;
        G.hybrid = h.hybrid ? { ...h.hybrid } : null;
        els.hybridSel.value = G.hybrid ? G.hybrid.secondary : '';
        els.hybridWeight.value = G.hybrid ? String(Math.round(G.hybrid.weight * 100)) : '40';
        els.hybridWeightVal.textContent = G.hybrid ? String(Math.round(G.hybrid.weight * 100)) : '40';
        els.hybridWeightWrap.hidden = !G.hybrid;
        els.challenges.querySelectorAll('.challenge').forEach(b => b.classList.toggle('active', b.dataset.id === G.challengeId));
        // Rebuild the population seeded with the saved champion so evolution continues from it.
        const rng = W.mulberry32((Date.now() >>> 0));
        const pop = [JSON.parse(JSON.stringify(h.geno))];
        for (let i = 1; i < G.popSize; i++) pop.push(W.randomGenotype(rng));
        G.population = pop;
        G.evoState = { population: pop.slice(), lastBest: undefined, stall: 0, mutRate: 0.08 };
        G.generation = 0;
        G.bestSeries = []; G.avgSeries = [];
        G.champion = E.championPhenotype(G.population, G.challengeId, G.constraints, G.hybrid);
        updateChampionUI();
      });
      row.querySelector('.hof-del').addEventListener('click', (ev) => {
        ev.stopPropagation();
        G.hof.splice(Number(row.dataset.i), 1);
        saveHof();
      });
    });
  }

  function saveChampion() {
    const c = G.champion;
    if (!c) return;
    const entry = {
      name: c.pheno.name,
      challengeId: G.challengeId,
      hybrid: G.hybrid ? { ...G.hybrid } : null,
      score: c.score,
      geno: c.geno,
      pheno: {
        thickness: c.pheno.thickness, componentCount: c.pheno.componentCount,
        compCount: c.pheno.compCount, accuracy: c.pheno.accuracy,
        powerReserve: c.pheno.powerReserve, cost: c.pheno.cost,
        visibleComponents: c.pheno.visibleComponents, open: c.pheno.open,
      },
      rank: G.hof.length + 1,
      ts: Date.now(),
    };
    G.hof.push(entry);
    saveHof();
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  function init() {
    els.rngSeed.textContent = String(G.rngSeed);
    buildChallenges();
    buildSpeeds();
    buildWatchmaker();
    loadHof(); renderHof();

    els.popSize.addEventListener('input', () => {
      G.popSize = Number(els.popSize.value);
      els.popSizeVal.textContent = String(G.popSize);
    });
    els.reset.addEventListener('click', () => {
      G.rngSeed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      els.rngSeed.textContent = String(G.rngSeed);
      newPopulation(G.rngSeed);
    });
    els.seedNew.addEventListener('click', () => {
      G.rngSeed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      els.rngSeed.textContent = String(G.rngSeed);
      newPopulation(G.rngSeed);
    });
    els.step.addEventListener('click', () => { stepMany(25); updateChampionUI(); });
    els.saveHof.addEventListener('click', saveChampion);
    els.exportBtn.addEventListener('click', exportSpecSheet);

    els.themePick.value = themeName;
    els.themePick.addEventListener('change', () => {
      themeName = els.themePick.value;
      R.setTheme(themeName);
      try { localStorage.setItem('watchforge.theme', themeName); } catch { /* ignored */ }
    });

    els.soundTick.addEventListener('change', () => {
      G.soundOn = els.soundTick.checked;
      S.setEnabled(G.soundOn);
    });

    const applyConstraints = () => {
      G.constraints.budgetCap = Number(els.budgetCap.value);
      G.constraints.thicknessCap = Number(els.thicknessCap.value);
      // Re-score under the new caps and restart the fitness curve.
      G.evoState.lastBest = undefined; G.evoState.stall = 0;
      const c = E.championPhenotype(G.population, G.challengeId, G.constraints, G.hybrid);
      G.champion = c;
      G.bestSeries = []; G.avgSeries = [];
      G.history.push({ gen: G.generation, name: c.pheno.name, note: 'constraints updated' });
      updateChampionUI();
    };
    els.budgetCap.addEventListener('change', applyConstraints);
    els.thicknessCap.addEventListener('change', applyConstraints);
    els.soundChime.addEventListener('change', () => {
      G.chimeOn = els.soundChime.checked;
      const hasRepeater = G.champion && !!G.champion.pheno.geno.complications.minuteRepeater;
      S.setChime(G.chimeOn && hasRepeater);
      els.soundChime.disabled = !hasRepeater;
    });

    newPopulation(G.rngSeed);
    updateChampionUI();
    requestAnimationFrame(frame);
  }

  // -----------------------------------------------------------------------
  // Spec-sheet export
  // -----------------------------------------------------------------------
  function exportSpecSheet() {
    const c = G.champion;
    if (!c) return;
    const g = c.pheno.geno;
    const p = c.pheno;
    const lines = [
      `# ${p.name}`,
      `**Charter:** ${E.CHALLENGES[G.challengeId].name} — ${E.CHALLENGES[G.challengeId].tagline}`,
      `**Score:** ${c.score.toFixed(1)} at generation ${G.generation}`,
      '',
      '## Spec',
      `- Case diameter: ${g.diameter} mm`,
      `- Movement thickness: ${p.thickness} mm`,
      `- Weight: ${p.weight} g`,
      `- Components: ${p.componentCount} (${p.visibleComponents} visible at ${g.skeleton}% openwork)`,
      `- Complications: ${p.compCount} (grade sum ${p.compGradeSum})`,
      `- Rate: ${p.accuracy} s/day (effective ${p.effectiveAccuracy})`,
      `- Power reserve: ${p.powerReserve} h`,
      `- Reliability: ${(p.reliability * 100).toFixed(0)}%`,
      `- Cost: CHF ${p.cost.toLocaleString()}`,
      '',
      '## Movement',
      `- Escapement: ${D.ESCAPEMENTS[g.escapement].name}`,
      `- Balance: ${D.BALANCES[g.balance].name}`,
      `- Hairspring: ${D.HAIRSPRINGS[g.hairspring].name}`,
      `- Beat: ${D.BEATS[g.beat].name}`,
      `- Barrels: ${g.barrels}`,
      `- Gear train: ${g.trainWheels} wheels`,
      '',
      '## Complications',
      ...(p.compList.length ? p.compList.map(cp => `- ${cp.name} (grade ${cp.grade}): +${cp.cost} CHF, ${cp.thick} mm`) : ['- (none)']),
      '',
      '---',
      '*Evolved in Watch Forge — the mechanical-watch evolution lab.*',
    ];
    const text = lines.join('\n');
    const done = () => {
      els.exportBtn.textContent = '✓ Copied';
      setTimeout(() => { els.exportBtn.textContent = '⧉ Copy spec sheet'; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* clipboard blocked */ }
    document.body.removeChild(ta);
    done();
  }

  init();

  // -----------------------------------------------------------------------
  // Test surface (Playwright / devtools) — keep in sync with the exports.
  // -----------------------------------------------------------------------
  window.WATCH_FORGE = {
    G, W, E, D, S,
    stepGeneration, stepMany, newPopulation, updateChampionUI,
    recordSeries, seedPopulationFromWatchmaker, saveChampion,
    exportSpecSheet, pushLineage, renderLineage,
  };
})();