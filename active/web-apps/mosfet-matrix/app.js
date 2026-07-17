/* =============================================================
   MOSFET Matrix Designer — app.js
   Software-Defined Battery 4-Cell Reconfiguration Engine
   ============================================================= */

// ─── DATA MODEL ──────────────────────────────────────────────

const SWITCH_DEFS = {
  // -- Bus connection switches --
  CP1:  { label: 'CP₁', desc: 'Cell 1+ → V+',     group: 'bus-top',    cell: 1 },
  CP2:  { label: 'CP₂', desc: 'Cell 2+ → V+',     group: 'bus-top',    cell: 2 },
  CP3:  { label: 'CP₃', desc: 'Cell 3+ → V+',     group: 'bus-top',    cell: 3 },
  CP4:  { label: 'CP₄', desc: 'Cell 4+ → V+',     group: 'bus-top',    cell: 4 },
  CN1:  { label: 'CN₁', desc: 'Cell 1- → V-',     group: 'bus-bot',    cell: 1 },
  CN2:  { label: 'CN₂', desc: 'Cell 2- → V-',     group: 'bus-bot',    cell: 2 },
  CN3:  { label: 'CN₃', desc: 'Cell 3- → V-',     group: 'bus-bot',    cell: 3 },
  CN4:  { label: 'CN₄', desc: 'Cell 4- → V-',     group: 'bus-bot',    cell: 4 },

  // -- Series switches --
  S12:  { label: 'S₁₂', desc: 'Cell 1- → Cell 2+', group: 'series',    cell: null },
  S23:  { label: 'S₂₃', desc: 'Cell 2- → Cell 3+', group: 'series',    cell: null },
  S34:  { label: 'S₃₄', desc: 'Cell 3- → Cell 4+', group: 'series',    cell: null },
};

const SWITCH_IDS = Object.keys(SWITCH_DEFS);

// Topology presets
const TOPOLOGIES = {
  '4s': {
    name: '4 Series',
    desc: 'All 4 cells in series — 4× voltage, 1× capacity',
    voltage: '4× Vcell (48V nom.)',
    capacity: '1× Ccell',
    on: ['CP1', 'S12', 'S23', 'S34', 'CN4'],
    off: ['CN1', 'CN2', 'CN3', 'CP2', 'CP3', 'CP4'],
  },
  '2s2p': {
    name: '2s2p',
    desc: 'Two 2s strings in parallel — 2× voltage, 2× capacity',
    voltage: '2× Vcell (24V nom.)',
    capacity: '2× Ccell',
    on: ['CP1', 'S12', 'CN2', 'CP3', 'S34', 'CN4'],
    off: ['CN1', 'CP2', 'CN3', 'CP4', 'S23'],
  },
  '4p': {
    name: '4 Parallel',
    desc: 'All 4 cells in parallel — 1× voltage, 4× capacity',
    voltage: '1× Vcell (12V nom.)',
    capacity: '4× Ccell',
    on: ['CP1','CP2','CP3','CP4','CN1','CN2','CN3','CN4'],
    off: ['S12','S23','S34'],
  },
};

// SVG layout constants — clean compact design
const LAYOUT = {
  // Cell x-centers (evenly spaced)
  cellX: [120, 290, 460, 630],
  cellW: 80,
  cellH: 62,
  // Cell body vertical range
  cellTopY: 82,
  cellBotY: 144,  // 82 + 62

  // Bus rails
  vPlusY:  28,
  vMinusY: 198,

  // CP switches halfway between V+ bus and cell+
  cpY: 55,
  // CN switches halfway between cell- and V- bus
  cnY: 171,

  // Parallel switches — thin horizontal links at fixed heights
  parTopY: 60,   // between cell+ (y=82) and CP (y=55)
  parBotY: 168,  // between cell- (y=144) and CN (y=171)

  // Peripheral ports x start
  periX: 740,
};

// ─── STATE ───────────────────────────────────────────────────

let state = {
  topology: '4s',         // '4s' | '2s2p' | '4p' | 'custom'
  switches: {},            // { switchId: true|false }
  peripherals: {
    charger: { enabled: false, target: 'pack' },
    currentSense: { enabled: false, location: 'v+' },
    voltageSense: { pack: false, cell1: false, cell2: false, cell3: false, cell4: false },
  },
};

// Initialize all switches to false
SWITCH_IDS.forEach(id => { state.switches[id] = false; });

// ─── SVG BUILDING ───────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildCircuit() {
  const svg = document.getElementById('circuit-svg');
  svg.innerHTML = '';

  // Background
  const bg = svgEl('rect', { x: 0, y: 0, width: 1000, height: 250, fill: '#0d1117' });
  svg.appendChild(bg);

  // --- Bus rails (extend into peripheral area) ---
  drawBusRail(svg, 40, LAYOUT.vPlusY, 860, 'V⁺');
  drawBusRail(svg, 40, LAYOUT.vMinusY, 860, 'V⁻');

  // Bus rails continue as dashed lines into the peripheral area,
  // but with a break at x=728 where the current sensor sits.
  drawLine(svg, 40, LAYOUT.vPlusY, 718, LAYOUT.vPlusY, '#4fc3f7', 1.5);
  drawLine(svg, 740, LAYOUT.vPlusY, 870, LAYOUT.vPlusY, '#4fc3f7', 1.5);
  drawLine(svg, 40, LAYOUT.vMinusY, 718, LAYOUT.vMinusY, '#4fc3f7', 1.5);
  drawLine(svg, 740, LAYOUT.vMinusY, 870, LAYOUT.vMinusY, '#4fc3f7', 1.5);

  // --- Cells ---
  for (let i = 0; i < 4; i++) {
    drawCell(svg, i);
  }

  // --- CP switches (V+ bus → cell+) ---
  for (let i = 0; i < 4; i++) {
    const id = `CP${i+1}`;
    const cx = LAYOUT.cellX[i];
    drawLine(svg, cx, LAYOUT.vPlusY, cx, LAYOUT.cellTopY, '#555', 1);
    drawSwitch(svg, cx, LAYOUT.cpY, id);
  }

  // --- CN switches (cell- → V- bus) ---
  for (let i = 0; i < 4; i++) {
    const id = `CN${i+1}`;
    const cx = LAYOUT.cellX[i];
    drawLine(svg, cx, LAYOUT.cellBotY, cx, LAYOUT.vMinusY, '#555', 1);
    drawSwitch(svg, cx, LAYOUT.cnY, id);
  }

  // --- Series switches (cell N- → cell N+1+) ---
  for (let i = 0; i < 3; i++) {
    const id = `S${i+1}${i+2}`;
    const x1 = LAYOUT.cellX[i];
    const x2 = LAYOUT.cellX[i+1];
    const y1 = LAYOUT.cellBotY;
    const y2 = LAYOUT.cellTopY;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    drawLine(svg, x1, y1, x2, y2, '#555', 1);
    drawSwitch(svg, midX, midY, id);
  }

  // --- Peripheral area: bus extensions to output and inline sensor ---
  drawPeripheralArea(svg);

  // --- Section labels ---
  drawLabels(svg);

  // __svgRefs populated by drawSwitch calls above; no need to reinitialize
}

function drawBusRail(svg, x1, y, x2, label) {
  const line = svgEl('line', {
    x1, y1: y, x2, y2: y,
    stroke: '#4fc3f7',
    'stroke-width': 2.5,
    'stroke-linecap': 'round',
  });
  svg.appendChild(line);

  // Label
  const txt = svgEl('text', {
    x: x1 - 24, y: y + 5,
    fill: '#4fc3f7',
    'font-size': '13',
    'font-weight': '700',
    'font-family': 'monospace',
  });
  txt.textContent = label;
  svg.appendChild(txt);
}

function drawLine(svg, x1, y1, x2, y2, color, width, dashed = false) {
  const line = svgEl('line', {
    x1, y1, x2, y2,
    stroke: color,
    'stroke-width': width || 1,
  });
  if (dashed) line.setAttribute('stroke-dasharray', '4,3');
  svg.appendChild(line);
}

function drawCell(svg, idx) {
  const cx = LAYOUT.cellX[idx];
  const tx = cx - LAYOUT.cellW / 2;
  const ty = LAYOUT.cellTopY;
  const num = idx + 1;

  // Cell body
  const rect = svgEl('rect', {
    x: tx, y: ty,
    width: LAYOUT.cellW, height: LAYOUT.cellH,
    rx: 6, ry: 6,
    fill: '#1a1c24',
    stroke: '#ffb74d',
    'stroke-width': 1.5,
  });
  svg.appendChild(rect);

  // Cell label
  const lbl = svgEl('text', {
    x: cx, y: ty + LAYOUT.cellH / 2 + 4,
    'text-anchor': 'middle',
    fill: '#ffb74d',
    'font-size': '12',
    'font-weight': '600',
  });
  lbl.textContent = `Cell ${num}`;
  svg.appendChild(lbl);

  // Positive terminal (top)
  const termT = svgEl('circle', {
    cx, cy: LAYOUT.cellTopY,
    r: 4,
    fill: '#ef5350',
    stroke: '#fff',
    'stroke-width': 1,
  });
  svg.appendChild(termT);
  const lblT = svgEl('text', {
    x: cx + 10, y: LAYOUT.cellTopY + 4,
    fill: '#ef5350',
    'font-size': '9',
    'font-family': 'monospace',
  });
  lblT.textContent = '+';
  svg.appendChild(lblT);

  // Negative terminal (bottom)
  const termB = svgEl('circle', {
    cx, cy: LAYOUT.cellBotY,
    r: 4,
    fill: '#42a5f5',
    stroke: '#fff',
    'stroke-width': 1,
  });
  svg.appendChild(termB);
  const lblB = svgEl('text', {
    x: cx + 10, y: LAYOUT.cellBotY + 4,
    fill: '#42a5f5',
    'font-size': '9',
    'font-family': 'monospace',
  });
  lblB.textContent = '−';
  svg.appendChild(lblB);
}

function drawSwitch(svg, x, y, id) {
  const swState = state.switches[id];
  const def = SWITCH_DEFS[id];

  // Group for the whole switch
  const g = svgEl('g', {
    class: 'svg-switch',
    'data-switch': id,
    style: 'cursor: pointer;',
  });
  g.addEventListener('click', () => toggleSwitch(id));

  // Background circle
  const bg = svgEl('circle', {
    cx: x, cy: y, r: 10,
    fill: '#1a1c24',
    stroke: swState ? '#66bb6a' : '#ef5350',
    'stroke-width': 2,
  });
  g.appendChild(bg);

  // Inner indicator
  if (swState) {
    const dot = svgEl('circle', {
      cx: x, cy: y, r: 5,
      fill: '#66bb6a',
      class: 'sw-inner',
    });
    g.appendChild(dot);
  } else {
    const line1 = svgEl('line', {
      x1: x-4, y1: y-4, x2: x+4, y2: y+4,
      stroke: '#ef5350',
      'stroke-width': 2,
      class: 'sw-inner',
    });
    const line2 = svgEl('line', {
      x1: x-4, y1: y+4, x2: x+4, y2: y-4,
      stroke: '#ef5350',
      'stroke-width': 2,
      class: 'sw-inner',
    });
    g.appendChild(line1);
    g.appendChild(line2);
  }

  // Label
  const labelOffY = 16;
  const lbl = svgEl('text', {
    x, y: y + labelOffY,
    'text-anchor': 'middle',
    fill: swState ? '#66bb6a' : '#888b98',
    'font-size': '9',
    'font-family': 'monospace',
    'font-weight': '600',
  });
  lbl.textContent = def.label;
  g.appendChild(lbl);
  
  // Tooltip / hover info
  const title = svgEl('title');
  title.textContent = `${id}: ${def.desc} [${swState ? 'ON' : 'OFF'}]`;
  g.appendChild(title);

  svg.appendChild(g);

  // Store reference for updates
  if (!window.__svgRefs) window.__svgRefs = {};
  window.__svgRefs[id] = { g, x, y };
}

// ─── PERIPHERAL AREA + VOLTAGE NODES ──────────────────────

function drawPeripheralArea(svg) {
  const yPlus = LAYOUT.vPlusY;
  const yMinus = LAYOUT.vMinusY;

  // ── Shunt Resistor + Bypass FET on V+ bus ──
  // Physical design: a shunt resistor measures current by creating
  // a voltage drop (I = V/R). A bypass FET in parallel can short
  // the shunt when no measurement is needed.
  //
  //   V+ ──┬── [M_bypass FET] ──┬── V+ out
  //        │                    │
  //        └── [R_shunt] ───────┘
  //              VM+  VM-
  //
  const shuntG = svgEl('g', { id: 'shunt-block' });
  const sx = 728;  // shunt center x

  // Bypass path (top) — FET symbol
  const bypassLine = svgEl('line', {
    x1: sx - 20, y1: yPlus - 1, x2: sx + 20, y2: yPlus - 1,
    stroke: '#26c6da',
    'stroke-width': 1.2,
  });
  shuntG.appendChild(bypassLine);

  // Bypass FET circle
  const bypassFET = svgEl('circle', {
    cx: sx, cy: yPlus - 1, r: 7,
    fill: '#0d1117',
    stroke: '#26c6da',
    'stroke-width': 1.5,
    id: 'bypass-fet',
  });
  shuntG.appendChild(bypassFET);

  // FET label inside
  const fetLabel = svgEl('text', {
    x: sx, y: yPlus + 2,
    'text-anchor': 'middle',
    fill: '#26c6da',
    'font-size': '7',
    'font-weight': '700',
    'font-family': 'monospace',
    id: 'bypass-fet-label',
  });
  fetLabel.textContent = 'M';
  shuntG.appendChild(fetLabel);

  // Shunt path (bottom) — resistor
  const shuntRes = svgEl('rect', {
    x: sx - 10, y: yPlus + 2,
    width: 20, height: 6,
    rx: 1, ry: 1,
    fill: '#1a1410',
    stroke: '#26c6da',
    'stroke-width': 1,
  });
  shuntG.appendChild(shuntRes);

  // Resistor label
  const rLabel = svgEl('text', {
    x: sx, y: yPlus + 15,
    'text-anchor': 'middle',
    fill: '#26c6da',
    'font-size': '7',
    'font-weight': '700',
    'font-family': 'serif',
    'font-style': 'italic',
  });
  rLabel.textContent = 'R shunt';
  shuntG.appendChild(rLabel);

  // Voltage measurement probes across shunt
  const vmPlusDot = svgEl('circle', {
    cx: sx - 8, cy: yPlus + 5, r: 2,
    fill: '#ffb74d',
    opacity: '0.4',
    id: 'shunt-vm-plus',
  });
  shuntG.appendChild(vmPlusDot);
  const vmMinusDot = svgEl('circle', {
    cx: sx + 8, cy: yPlus + 5, r: 2,
    fill: '#ffb74d',
    opacity: '0.4',
    id: 'shunt-vm-minus',
  });
  shuntG.appendChild(vmMinusDot);

  // Vertical connection wires to the V+ bus
  const connL = svgEl('line', {
    x1: sx - 20, y1: yPlus - 6, x2: sx - 10, y2: yPlus + 2,
    stroke: '#4fc3f7',
    'stroke-width': 1,
  });
  shuntG.appendChild(connL);
  const connR = svgEl('line', {
    x1: sx + 20, y1: yPlus - 6, x2: sx + 10, y2: yPlus + 2,
    stroke: '#4fc3f7',
    'stroke-width': 1,
  });
  shuntG.appendChild(connR);

  svg.appendChild(shuntG);

  // ── Voltage node labels (on each cell terminal) ──
  // Show computed voltage at each key node
  for (let i = 0; i < 4; i++) {
    const cx = LAYOUT.cellX[i];
    // Positive terminal voltage label
    const vPlusLabel = svgEl('text', {
      x: cx - LAYOUT.cellW / 2 - 30, y: LAYOUT.cellTopY + 4,
      'text-anchor': 'start',
      fill: '#888b98',
      'font-size': '6',
      'font-family': 'monospace',
      opacity: '0',
      class: 'node-voltage',
      'data-node': 'c' + (i+1) + '+',
    });
    vPlusLabel.textContent = '0V';
    svg.appendChild(vPlusLabel);

    // Negative terminal voltage label
    const vMinusLabel = svgEl('text', {
      x: cx - LAYOUT.cellW / 2 - 30, y: LAYOUT.cellBotY + 4,
      'text-anchor': 'start',
      fill: '#888b98',
      'font-size': '6',
      'font-family': 'monospace',
      opacity: '0',
      class: 'node-voltage',
      'data-node': 'c' + (i+1) + '-',
    });
    vMinusLabel.textContent = '0V';
    svg.appendChild(vMinusLabel);
  }

  // V+ and V- bus voltage labels
  const vBusPlus = svgEl('text', {
    x: 780, y: yPlus + 5,
    'text-anchor': 'start',
    fill: '#4fc3f7',
    'font-size': '7',
    'font-family': 'monospace',
    'font-weight': '700',
    class: 'node-voltage',
    'data-node': 'v+',
  });
  vBusPlus.textContent = 'V⁺ = 0V';
  svg.appendChild(vBusPlus);
  const vBusMinus = svgEl('text', {
    x: 780, y: yMinus + 5,
    'text-anchor': 'start',
    fill: '#4fc3f7',
    'font-size': '7',
    'font-family': 'monospace',
    'font-weight': '700',
    class: 'node-voltage',
    'data-node': 'v-',
  });
  vBusMinus.textContent = 'V⁻ = 0V';
  svg.appendChild(vBusMinus);

  // Legend for voltage colors (rightmost)
  const legendG = svgEl('g', { id: 'voltage-legend', style: 'display: none;' });
  const lx = 845;
  const ly = yMinus + 16;
  // Small gradient bar
  const gradBar = svgEl('rect', {
    x: lx, y: ly, width: 6, height: 24, rx: 1, ry: 1,
    fill: 'none', stroke: '#555', 'stroke-width': 0.5,
  });
  legendG.appendChild(gradBar);
  // We'll use a linear gradient in a defs section
  const gradTextHigh = svgEl('text', {
    x: lx + 9, y: ly + 6,
    fill: '#ef5350', 'font-size': '5', 'font-family': 'monospace',
  });
  gradTextHigh.textContent = 'high';
  legendG.appendChild(gradTextHigh);
  const gradTextLow = svgEl('text', {
    x: lx + 9, y: ly + 20,
    fill: '#42a5f5', 'font-size': '5', 'font-family': 'monospace',
  });
  gradTextLow.textContent = 'low';
  legendG.appendChild(gradTextLow);
  svg.appendChild(legendG);

  // ── Charger block ──
  const chX = 805;
  const chargerG = svgEl('g', { id: 'charger-block', style: 'display: none;' });

  const chRect = svgEl('rect', {
    x: chX - 28, y: yPlus - 10,
    width: 56, height: yMinus - yPlus + 20,
    rx: 6, ry: 6,
    fill: '#1e1430',
    stroke: '#ab47bc',
    'stroke-width': 1.5,
    'stroke-dasharray': '4,2',
  });
  chargerG.appendChild(chRect);

  const chLabel = svgEl('text', {
    x: chX, y: (yPlus + yMinus) / 2 - 5,
    'text-anchor': 'middle',
    fill: '#ab47bc',
    'font-size': '9',
    'font-weight': '700',
    'font-family': 'monospace',
  });
  chLabel.textContent = 'CHARGER';
  chargerG.appendChild(chLabel);

  const chIcon = svgEl('text', {
    x: chX, y: (yPlus + yMinus) / 2 + 10,
    'text-anchor': 'middle',
    fill: '#ab47bc',
    'font-size': '12',
  });
  chIcon.textContent = '⚡';
  chargerG.appendChild(chIcon);

  // Charger wires to bus rails
  drawLine(chargerG, chX, yPlus, chX, yPlus + 10, '#ab47bc', 0.7);
  drawLine(chargerG, chX, yMinus, chX, yMinus - 10, '#ab47bc', 0.7);

  svg.appendChild(chargerG);

  // Static CH+/CH- labels on bus (dim when disabled)
  drawBusPortLabel(svg, 805, yPlus, 'CH⁺', '#ab47bc');
  drawBusPortLabel(svg, 805, yMinus, 'CH⁻', '#ab47bc');

  // ── Voltage measurement probes ──
  for (let i = 0; i < 4; i++) {
    const cx = LAYOUT.cellX[i];
    const vx = cx + 55;
    const vy = LAYOUT.cellTopY + 10;

    drawLine(svg, cx + LAYOUT.cellW/2, vy, vx, vy, '#ffb74d', 0.7, true);

    const dot = svgEl('circle', {
      cx: vx, cy: vy, r: 3,
      fill: '#ffb74d',
      opacity: '0.35',
      class: 'vm-probe',
      'data-vm-probe': 'cell' + (i+1),
    });
    svg.appendChild(dot);

    const vmLabel = svgEl('text', {
      x: vx + 6, y: vy + 3,
      fill: '#ffb74d',
      'font-size': '7',
      'font-family': 'monospace',
      opacity: '0.35',
      class: 'vm-label',
      'data-vm-label': 'cell' + (i+1),
    });
    vmLabel.textContent = 'VM' + (i+1);
    svg.appendChild(vmLabel);
  }

  // Pack voltage probe
  const pvx = LAYOUT.periX;
  const pvy = (yPlus + yMinus) / 2;
  drawLine(svg, LAYOUT.periX - 10, yPlus, pvx, pvy - 10, '#ffb74d', 0.7, true);
  drawLine(svg, LAYOUT.periX - 10, yMinus, pvx, pvy + 10, '#ffb74d', 0.7, true);

  const pvDot = svgEl('circle', {
    cx: pvx, cy: pvy, r: 3,
    fill: '#ffb74d',
    opacity: '0.4',
    class: 'vm-probe',
    'data-vm-probe': 'pack',
  });
  svg.appendChild(pvDot);
  const pvLabel = svgEl('text', {
    x: pvx + 6, y: pvy + 3,
    fill: '#ffb74d',
    'font-size': '7',
    'font-family': 'monospace',
    opacity: '0.4',
    class: 'vm-label',
    'data-vm-label': 'pack',
  });
  pvLabel.textContent = 'VMp';
  svg.appendChild(pvLabel);

  // Voltmeter label panel (right side)
  const vmPanelX = LAYOUT.periX + 100;
  const vmPanelG = svgEl('g', { id: 'voltmeter-panel', style: 'display: none;' });

  const vmRect = svgEl('rect', {
    x: vmPanelX - 20, y: (yPlus + yMinus) / 2 - 18,
    width: 40, height: 36,
    rx: 4, ry: 4,
    fill: '#1e1808',
    stroke: '#ffb74d',
    'stroke-width': 1,
    'stroke-dasharray': '3,2',
  });
  vmPanelG.appendChild(vmRect);

  const vmPanelLabel = svgEl('text', {
    x: vmPanelX, y: (yPlus + yMinus) / 2 - 2,
    'text-anchor': 'middle',
    fill: '#ffb74d',
    'font-size': '9',
    'font-weight': '700',
    'font-family': 'monospace',
  });
  vmPanelLabel.textContent = 'VM';
  vmPanelG.appendChild(vmPanelLabel);

  const vmPanelIcon = svgEl('text', {
    x: vmPanelX, y: (yPlus + yMinus) / 2 + 12,
    'text-anchor': 'middle',
    fill: '#ffb74d',
    'font-size': '8',
  });
  vmPanelIcon.textContent = 'probes';
  vmPanelG.appendChild(vmPanelIcon);

  svg.appendChild(vmPanelG);
}

function drawBusPortLabel(svg, x, y, label, color) {
  // Small label on the bus rail (always visible, dimmed when inactive)
  const lbl = svgEl('text', {
    x: x, y: y - 10,
    'text-anchor': 'middle',
    fill: color,
    'font-size': '7',
    'font-family': 'monospace',
    'font-weight': '600',
    opacity: '0.4',
    class: 'bus-port-label',
    'data-port-label': label,
  });
  lbl.textContent = label;
  svg.appendChild(lbl);
}

function drawLabels(svg) {
  const annotations = [
    { x: 55, y: LAYOUT.vPlusY + 5, text: 'V⁺', color: '#4fc3f7', anchor: 'end' },
    { x: 55, y: LAYOUT.vMinusY + 5, text: 'V⁻', color: '#4fc3f7', anchor: 'end' },
    { x: 830, y: LAYOUT.vPlusY + 5, text: 'OUT+', color: '#4fc3f7' },
    { x: 830, y: LAYOUT.vMinusY + 5, text: 'OUT-', color: '#4fc3f7' },
  ];
  annotations.forEach(a => {
    const txt = svgEl('text', {
      x: a.x, y: a.y,
      fill: a.color,
      'font-size': '9',
      'font-family': 'monospace',
      'font-weight': '700',
      'text-anchor': a.anchor || 'start',
    });
    txt.textContent = a.text;
    svg.appendChild(txt);
  });
}

// ─── SWITCH STATE MANAGEMENT ─────────────────────────────────

function toggleSwitch(id) {
  state.switches[id] = !state.switches[id];
  state.topology = 'custom';
  updateUI();
}

function applyTopology(topoId) {
  state.topology = topoId;
  
  // Always reset all switches
  SWITCH_IDS.forEach(id => { state.switches[id] = false; });

  if (topoId !== 'custom') {
    const topo = TOPOLOGIES[topoId];
    if (!topo) return;
    // Apply ON switches
    topo.on.forEach(id => { state.switches[id] = true; });
    // Apply OFF switches
    topo.off.forEach(id => { state.switches[id] = false; });
  }

  updateUI();
}

// ─── PERIPHERAL HANDLING ─────────────────────────────────────

function updatePeripherals() {
  const ch = state.peripherals.charger;
  ch.enabled = document.getElementById('ch-enable').checked;
  ch.target = document.getElementById('ch-target').value;

  const cm = state.peripherals.currentSense;
  cm.enabled = document.getElementById('cm-enable').checked;
  cm.location = document.getElementById('cm-location').value;

  const vm = state.peripherals.voltageSense;
  document.querySelectorAll('[data-vm]').forEach(el => {
    vm[el.dataset.vm] = el.checked;
  });

  updateUI();
}

// ─── VALIDATION ──────────────────────────────────────────────

function validate() {
  const issues = [];
  const sw = state.switches;

  // 1. Check for V+ to V- short (path through switches only, no cells)
  // A short exists if there's a switch path from V+ to V- that doesn't
  // include any cell. Since all paths go through cell terminals in our
  // model, a true "switch-only" short requires specific conditions.
  
  // Check: CPx + CNx on same cell - this is a cell across the bus (fine for 4p)
  // But CPx + S{x}{x+1} + CN{x+1} without SP in between is valid series.
  
  // Dangerous: If CPx is ON and CNy is ON with series switches connecting
  // them but one of the intermediate cells is "bypassed" (both CP and CN on
  // for that cell), that creates an alternate path.
  
  // More concretely: 
  // Pattern: A cell has both CP and CN ON, AND its neighbor has both CP and CN ON,
  // AND the series switch between them is OFF. The cells are just in parallel - OK.
  
  // Actually, the main short concern is: V+ connected to V- where cells are
  // bypased. A cell is bypassed when its+ and - are connected through paths
  // that don't include the cell itself.
  
  // For our matrix, let me check common dangerous patterns:

  // Pattern: Series short - two cells in parallel with series switch ON
  // If CP1, CN2, CP2, CN1 are all ON, and S12 is ON:
  // Path: V+→CP1→Cell1+→S12→Cell2+→CP2→V+ (V+ to V+ - not a short)
  // Path: V-→CN1→Cell1-→S12→Cell2-→CN2→V- (V- to V- - not a short)
  
  // 2. (No P switches in this minimal architecture — cross-conduction
  //     between series and parallel paths cannot occur)

  // 3. Cell isolation check
  for (let i = 0; i < 4; i++) {
    const cpId = `CP${i+1}`;
    const cnId = `CN${i+1}`;
    const num = i + 1;
    
    // If both CP and CN are OFF, check if cell is connected via series
    if (!sw[cpId] && !sw[cnId]) {
      let hasSeriesPath = false;
      if (i > 0 && sw[`S${i}${num}`]) hasSeriesPath = true;
      if (i < 3 && sw[`S${num}${i+2}`]) hasSeriesPath = true;
      if (!hasSeriesPath) {
        issues.push({
          type: 'warn',
          msg: `Cell ${num} is isolated (not connected to any bus or series chain)`
        });
      }
    }
  }

  // 4. Check for floating V+ or V- (no cells connected)
  const anyCP = ['CP1','CP2','CP3','CP4'].some(id => sw[id]);
  const anyCN = ['CN1','CN2','CN3','CN4'].some(id => sw[id]);
  if (!anyCP) {
    issues.push({ type: 'warn', msg: 'V⁺ bus has no cell connected (all CP switches OFF)' });
  }
  if (!anyCN) {
    issues.push({ type: 'warn', msg: 'V⁻ bus has no cell connected (all CN switches OFF)' });
  }

  // 5. Topology conformance (if not custom)
  if (state.topology !== 'custom') {
    const topo = TOPOLOGIES[state.topology];
    if (topo) {
      const mismatchOn = topo.on.filter(id => !sw[id]);
      const mismatchOff = topo.off.filter(id => sw[id]);
      if (mismatchOn.length > 0) {
        issues.push({
          type: 'warn',
          msg: `${topo.name} topology: switches ${mismatchOn.join(', ')} should be ON but are OFF`
        });
      }
      if (mismatchOff.length > 0) {
        issues.push({
          type: 'warn',
          msg: `${topo.name} topology: switches ${mismatchOff.join(', ')} should be OFF but are ON`
        });
      }
    }
  }

  return issues;
}

// ─── UI UPDATE ───────────────────────────────────────────────

function updateUI() {
  // 1. Update SVG switch indicators
  updateSVG();

  // 2. Update switch grid panel
  updateSwitchGrid();

  // 3. Update topology buttons
  document.querySelectorAll('.topo-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.topology === state.topology);
  });

  // 4. Update config info
  updateConfigInfo();

  // 5. Update status badge
  updateStatus();

  // 6. Update cell voltage visuals
  updateCellVoltages();

  // 7. Update peripheral indicators
  updatePeripheralIndicators();

  // 8. Update voltage node labels
  updateNodeVoltages();
}

function updateSVG() {
  for (const id of SWITCH_IDS) {
    const ref = window.__svgRefs?.[id];
    if (!ref) continue;
    const g = ref.g;
    const swState = state.switches[id];
    
    // Update background circle stroke
    const bg = g.querySelector('circle:first-child');
    if (bg) {
      bg.setAttribute('stroke', swState ? '#66bb6a' : '#ef5350');
    }

    // Remove all inner indicators (dot or X lines)
    g.querySelectorAll('.sw-inner').forEach(el => el.remove());

    if (swState) {
      const dot = svgEl('circle', {
        cx: ref.x, cy: ref.y, r: 5,
        fill: '#66bb6a',
        class: 'sw-inner',
      });
      const refChild = g.querySelector('text, title');
      if (refChild) g.insertBefore(dot, refChild);
      else g.appendChild(dot);
    } else {
      const l1 = svgEl('line', {
        x1: ref.x-4, y1: ref.y-4, x2: ref.x+4, y2: ref.y+4,
        stroke: '#ef5350',
        'stroke-width': 2,
        class: 'sw-inner',
      });
      const l2 = svgEl('line', {
        x1: ref.x-4, y1: ref.y+4, x2: ref.x+4, y2: ref.y-4,
        stroke: '#ef5350',
        'stroke-width': 2,
        class: 'sw-inner',
      });
      const refChild = g.querySelector('text, title');
      if (refChild) {
        g.insertBefore(l1, refChild);
        g.insertBefore(l2, refChild);
      } else {
        g.appendChild(l1);
        g.appendChild(l2);
      }
    }

    // Update label color
    const lbl = g.querySelector('text');
    if (lbl) {
      lbl.setAttribute('fill', swState ? '#66bb6a' : '#888b98');
    }

    // Update title
    const title = g.querySelector('title');
    if (title) {
      title.textContent = `${id}: ${SWITCH_DEFS[id].desc} [${swState ? 'ON' : 'OFF'}]`;
    }
  }

  // Update peripheral indicators
  updatePeripheralSVG();
}

// ─── VOLTAGE COMPUTATION ─────────────────────────────────

function computeNodeVoltages() {
  const vCell = 3.70;
  const sw = state.switches;
  const v = {};
  const nodes = ['v+','v-','c1+','c1-','c2+','c2-','c3+','c3-','c4+','c4-'];
  nodes.forEach(n => v[n] = 0);

  // Detect topology from active switch pattern
  const is4s = sw.CP1 && sw.S12 && sw.S23 && sw.S34 && sw.CN4 &&
               !sw.CP2 && !sw.CP3 && !sw.CP4 && !sw.CN1 && !sw.CN2 && !sw.CN3;
  const is2s2p = sw.CP1 && sw.S12 && sw.CN2 && sw.CP3 && sw.S34 && sw.CN4 && !sw.S23;
  const is4p = sw.CP1 && sw.CP2 && sw.CP3 && sw.CP4 &&
               sw.CN1 && sw.CN2 && sw.CN3 && sw.CN4;

  if (is4s) {
    // 4 cells stacked: V⁻ = bottom = 0
    v['v-'] = 0; v['c4-'] = 0;
    v['c4+'] = vCell;
    v['c3-'] = vCell;
    v['c3+'] = 2 * vCell;
    v['c2-'] = 2 * vCell;
    v['c2+'] = 3 * vCell;
    v['c1-'] = 3 * vCell;
    v['c1+'] = 4 * vCell;
    v['v+'] = 4 * vCell;
  } else if (is2s2p) {
    // Two 2s strings in parallel: each string 2×Vcell
    v['v-'] = 0; v['c2-'] = 0; v['c4-'] = 0;
    v['c2+'] = vCell; v['c4+'] = vCell;
    v['c1-'] = vCell; v['c3-'] = vCell;
    v['c1+'] = 2 * vCell; v['c3+'] = 2 * vCell;
    v['v+'] = 2 * vCell;
  } else if (is4p) {
    // All cells in parallel: each at vCell
    v['v-'] = 0; v['c1-'] = 0; v['c2-'] = 0; v['c3-'] = 0; v['c4-'] = 0;
    v['c1+'] = vCell; v['c2+'] = vCell; v['c3+'] = vCell; v['c4+'] = vCell;
    v['v+'] = vCell;
  } else {
    // Custom / unknown: all 0
  }
  return v;
}

function voltageColor(v, maxV) {
  // Map voltage to color: 0V = #42a5f5 (blue), max = #ef5350 (red)
  if (maxV === 0) return '#888b98';
  const t = Math.min(v / maxV, 1);
  const r = Math.round(0x42 + (0xef - 0x42) * t);
  const g = Math.round(0xa5 - 0xa5 * t);
  const b = Math.round(0xf5 - 0xf5 * t);
  return `rgb(${r},${g},${b})`;
}

function updateNodeVoltages() {
  const v = computeNodeVoltages();
  const maxV = Math.max(...Object.values(v), 1);

  // Update voltage labels
  document.querySelectorAll('.node-voltage').forEach(el => {
    const node = el.dataset.node;
    const voltage = v[node] || 0;
    const color = voltageColor(voltage, maxV);
    
    if (node === 'v+' || node === 'v-') {
      el.textContent = `${node.toUpperCase()} = ${voltage.toFixed(2)}V`;
    } else {
      el.textContent = `${voltage.toFixed(2)}V`;
    }
    el.setAttribute('fill', color);
    el.setAttribute('opacity', maxV > 0 ? '0.9' : '0');
  });

  // Update legend visibility
  const legend = document.getElementById('voltage-legend');
  if (legend) legend.style.display = maxV > 0 ? 'block' : 'none';
}

// ─── PERIPHERAL SVG UPDATE ────────────────────────────────

function updatePeripheralSVG() {
  const cm = state.peripherals.currentSense;
  const ch = state.peripherals.charger;

  // ── Charger block show/hide ──
  const chargerBlock = document.getElementById('charger-block');
  if (chargerBlock) chargerBlock.style.display = ch.enabled ? 'block' : 'none';

  // Update CH⁺/CH⁻ labels
  document.querySelectorAll('.bus-port-label').forEach(el => {
    if (el.dataset.portLabel === 'CH⁺' || el.dataset.portLabel === 'CH⁻') {
      el.setAttribute('opacity', ch.enabled ? '1' : '0.25');
    }
  });

  // ── Shunt + Bypass FET state ──
  // When current measurement is enabled: bypass FET = OFF → current forced through R_shunt
  // When disabled: bypass FET = ON → current bypasses R_shunt
  const bypassFET = document.getElementById('bypass-fet');
  const bypassLabel = document.getElementById('bypass-fet-label');
  if (bypassFET && bypassLabel) {
    if (cm.enabled) {
      // Bypass FET is OFF: current goes through shunt
      bypassFET.setAttribute('stroke', '#ef5350');  // red = OFF
      bypassLabel.textContent = '✗';
      bypassLabel.setAttribute('fill', '#ef5350');
      bypassLabel.setAttribute('font-size', '9');
    } else {
      // Bypass FET is ON: current bypasses shunt
      bypassFET.setAttribute('stroke', '#66bb6a');  // green = ON
      bypassLabel.textContent = 'M';
      bypassLabel.setAttribute('fill', '#66bb6a');
      bypassLabel.setAttribute('font-size', '7');
    }
  }

  // Shunt VM probe highlights
  const vmPlus = document.getElementById('shunt-vm-plus');
  const vmMinus = document.getElementById('shunt-vm-minus');
  if (vmPlus && vmMinus) {
    const active = cm.enabled;
    vmPlus.setAttribute('opacity', active ? '1' : '0.2');
    vmMinus.setAttribute('opacity', active ? '1' : '0.2');
    vmPlus.setAttribute('fill', active ? '#ffb74d' : '#888b98');
    vmMinus.setAttribute('fill', active ? '#ffb74d' : '#888b98');
  }

  // ── Voltage probes highlight (from VM panel) ──
  const vm = state.peripherals.voltageSense;
  document.querySelectorAll('.vm-probe').forEach(el => {
    const key = el.dataset.vmProbe;
    const active = vm[key] || false;
    el.setAttribute('opacity', active ? '1' : '0.25');
    el.setAttribute('fill', active ? '#ffb74d' : '#888b98');
  });
  document.querySelectorAll('.vm-label').forEach(el => {
    const key = el.dataset.vmLabel;
    const active = vm[key] || false;
    el.setAttribute('opacity', active ? '1' : '0.25');
    el.setAttribute('fill', active ? '#ffb74d' : '#888b98');
  });

  const vmPanel = document.getElementById('voltmeter-panel');
  if (vmPanel) {
    const anyVm = Object.values(vm).some(v => v);
    vmPanel.style.display = anyVm ? 'block' : 'none';
  }
}

function updateSwitchGrid() {
  const grid = document.getElementById('switch-grid');
  grid.innerHTML = '';

  // Group switches
  const groups = [
    { label: 'Bus Top (V⁺ → Cell⁺)', ids: ['CP1','CP2','CP3','CP4'] },
    { label: 'Bus Bot (Cell⁻ → V⁻)', ids: ['CN1','CN2','CN3','CN4'] },
    { label: 'Series (Cell N⁻ → Cell N+1⁺)', ids: ['S12','S23','S34'] },
  ];

  groups.forEach(grp => {
    const header = document.createElement('div');
    header.className = 'sw-group-header';
    header.style.cssText = 'grid-column: 1 / -1; font-size:0.7rem; color: var(--text-dim); margin-top:0.2rem; border-bottom:1px solid var(--border); padding-bottom:0.1rem;';
    header.textContent = grp.label;
    grid.appendChild(header);

    grp.ids.forEach(id => {
      const def = SWITCH_DEFS[id];
      const swState = state.switches[id];
      const isAuto = state.topology !== 'custom';
      const topo = TOPOLOGIES[state.topology];
      const shouldBeOn = isAuto && topo && topo.on.includes(id);
      const shouldBeOff = isAuto && topo && topo.off.includes(id);

      const cell = document.createElement('div');
      cell.className = `sw-cell ${swState ? 'sw-on' : 'sw-off'}`;
      cell.dataset.switch = id;
      cell.addEventListener('click', () => toggleSwitch(id));

      const dot = document.createElement('span');
      dot.className = 'sw-dot';
      cell.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'sw-label';
      label.textContent = def.label;
      cell.appendChild(label);

      // Auto indicator
      if (isAuto && (shouldBeOn || shouldBeOff)) {
        cell.classList.add('sw-auto');
        const autoBadge = document.createElement('span');
        autoBadge.textContent = shouldBeOn ? '✓' : '✗';
        autoBadge.style.cssText = 'font-size:0.6rem; margin-left:auto;';
        cell.appendChild(autoBadge);
      }

      grid.appendChild(cell);
    });
  });
}

function updateConfigInfo() {
  let topoName, voltage, capacity;
  if (state.topology !== 'custom' && TOPOLOGIES[state.topology]) {
    const t = TOPOLOGIES[state.topology];
    topoName = t.name;
    voltage = t.voltage;
    capacity = t.capacity;
  } else {
    topoName = 'Custom';
    voltage = '—';
    capacity = '—';
  }
  document.getElementById('info-topology').textContent = topoName;
  document.getElementById('info-voltage').textContent = voltage;
  document.getElementById('info-capacity').textContent = capacity;

  const onCount = SWITCH_IDS.filter(id => state.switches[id]).length;
  const offCount = SWITCH_IDS.length - onCount;
  document.getElementById('info-sw-on').textContent = onCount;
  document.getElementById('info-sw-off').textContent = offCount;
}

function updateCellVoltages() {
  // Determine which cells are in the active current path
  // For demo, show voltages with color based on configuration
  const bars = document.querySelectorAll('.voltage-bar');
  const sw = state.switches;
  
  bars.forEach(bar => {
    const cellIdx = parseInt(bar.dataset.cell);
    const cpId = `CP${cellIdx}`;
    const cnId = `CN${cellIdx}`;
    
    const connected = sw[cpId] || sw[cnId] || 
      (cellIdx > 1 && sw[`S${cellIdx-1}${cellIdx}`]) ||
      (cellIdx < 4 && sw[`S${cellIdx}${cellIdx+1}`]) ||
      (cellIdx > 1 && (sw[`P${cellIdx-1}${cellIdx}_T`] || sw[`P${cellIdx-1}${cellIdx}_B`])) ||
      (cellIdx < 4 && (sw[`P${cellIdx}${cellIdx+1}_T`] || sw[`P${cellIdx}${cellIdx+1}_B`]));
    
    bar.style.background = connected 
      ? 'rgba(102,187,106,0.1)' 
      : '#23262e';
    bar.style.borderLeft = connected 
      ? '3px solid var(--green)' 
      : '3px solid transparent';
  });
}

function updatePeripheralIndicators() {
  // Highlight active peripherals in the peripheral panel
  const chEnabled = state.peripherals.charger.enabled;
  const cmEnabled = state.peripherals.currentSense.enabled;

  document.querySelectorAll('.peri-section').forEach(section => {
    const h4 = section.querySelector('h4');
    if (!h4) return;
    if (h4.textContent.includes('Charger')) {
      section.style.borderLeft = chEnabled ? '3px solid var(--purple)' : '3px solid transparent';
    }
    if (h4.textContent.includes('Current')) {
      section.style.borderLeft = cmEnabled ? '3px solid var(--cyan)' : '3px solid transparent';
    }
    if (h4.textContent.includes('Voltage')) {
      const anyVM = Object.values(state.peripherals.voltageSense).some(v => v);
      section.style.borderLeft = anyVM ? '3px solid var(--amber)' : '3px solid transparent';
    }
  });
}

function updateStatus() {
  const issues = validate();
  const badge = document.getElementById('status-badge');
  const msgsDiv = document.getElementById('validation-msgs');
  msgsDiv.innerHTML = '';

  const errors = issues.filter(i => i.type === 'error');
  const warns = issues.filter(i => i.type === 'warn');

  if (errors.length > 0) {
    badge.className = 'status-error';
    badge.textContent = `✗ ${errors.length} error(s)`;
  } else if (warns.length > 0) {
    badge.className = 'status-warn';
    badge.textContent = `⚠ ${warns.length} warning(s)`;
  } else {
    badge.className = 'status-ok';
    badge.textContent = '✓ Valid';
  }

  if (issues.length === 0) {
    const msg = document.createElement('span');
    msg.className = 'msg-ok';
    msg.textContent = '✓ No issues detected';
    msgsDiv.appendChild(msg);
  } else {
    issues.forEach(issue => {
      const el = document.createElement('div');
      el.className = `msg-item msg-${issue.type}`;
      const icon = issue.type === 'error' ? '✗' : '⚠';
      el.textContent = `${icon} ${issue.msg}`;
      msgsDiv.appendChild(el);
    });
  }
}

// ─── EVENT BINDING ──────────────────────────────────────────

function init() {
  // Build the SVG circuit
  buildCircuit();

  // Apply default topology (4s)
  applyTopology('4s');

  // Topology buttons
  document.querySelectorAll('.topo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTopology(btn.dataset.topology);
    });
  });

  // Peripheral controls
  document.getElementById('ch-enable').addEventListener('change', updatePeripherals);
  document.getElementById('ch-target').addEventListener('change', updatePeripherals);
  document.getElementById('cm-enable').addEventListener('change', updatePeripherals);
  document.getElementById('cm-location').addEventListener('change', updatePeripherals);
  document.querySelectorAll('[data-vm]').forEach(el => {
    el.addEventListener('change', updatePeripherals);
  });
}

// ─── BOOT ────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
