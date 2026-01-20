(function () {
  const {
    socket: wfSocket,
    emitWithAck: wfEmitWithAck,
    state: wfState,
    renderAll: wfRenderAll,
  } = window.wizardFight || {};

const debugPanel = {
  socket: document.getElementById("dbg-socket"),
  mode: document.getElementById("dbg-mode"),
  lobby: document.getElementById("dbg-lobby"),
  player: document.getElementById("dbg-player"),
  ticks: document.getElementById("dbg-ticks"),
  lastTick: document.getElementById("dbg-last-tick"),
  researching: document.getElementById("dbg-researching"),
  newSpells: document.getElementById("dbg-new-spells"),
  units: document.getElementById("dbg-units"),
  w0: document.getElementById("dbg-w0"),
  w1: document.getElementById("dbg-w1"),
};

let tickCount = 0;
let lastResearching = {};
let lastNewSpells = 0;

function logDebug(event, payload = {}) {
  const stamp = new Date().toISOString();
  console.log(`[wizard-fight][${stamp}] ${event}`, payload);
}

function renderDebugPanel() {
  if (!debugPanel.socket) return;
  debugPanel.socket.textContent = wfSocket?.connected ? "connected" : "disconnected";
  debugPanel.mode.textContent = wfState?.mode ?? "-";
  debugPanel.lobby.textContent = wfState?.lobbyId ?? "-";
  debugPanel.player.textContent = wfState?.playerId ?? "-";
  debugPanel.ticks.textContent = String(tickCount);
  debugPanel.lastTick.textContent = new Date().toLocaleTimeString();
  if (debugPanel.researching) {
    debugPanel.researching.textContent = JSON.stringify(lastResearching);
  }
  if (debugPanel.newSpells) {
    debugPanel.newSpells.textContent = String(lastNewSpells);
  }
  const units = wfState?.gameState?.units ?? [];
  debugPanel.units.textContent = String(units.length);
  const w0 = wfState?.gameState?.wizards?.[0];
  const w1 = wfState?.gameState?.wizards?.[1];
  debugPanel.w0.textContent = w0 ? `${w0.health.toFixed(1)} / ${w0.mana.toFixed(1)}` : "-";
  debugPanel.w1.textContent = w1 ? `${w1.health.toFixed(1)} / ${w1.mana.toFixed(1)}` : "-";
}

function getModeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "pvp" || mode === "pvc" || mode === "cvc") {
    return mode;
  }
  return "pvp";
}

async function bootstrapGame() {
  if (!wfEmitWithAck || !wfState) return;
  if (wfState.started) return;
  wfState.started = true;
  wfState.mode = getModeFromQuery();
  logDebug("bootstrap_start", { mode: wfState.mode });
  const lobbyResponse = await wfEmitWithAck("create_lobby", { seed: 7, mode: wfState.mode });
  logDebug("create_lobby_response", lobbyResponse);
  wfState.lobbyId = lobbyResponse.lobby_id;
  if (wfState.mode !== "cvc") {
    const joinResponse = await wfEmitWithAck("join_lobby", { lobby_id: wfState.lobbyId });
    logDebug("join_lobby_response", joinResponse);
    wfState.playerId = joinResponse.player_id;
  }
  const initial = await wfEmitWithAck("get_state", { lobby_id: wfState.lobbyId });
  logDebug("initial_state", initial);
  wfState.gameState = initial.state;
  wfRenderAll?.();
  renderDebugPanel();
}

let _tickInterval = null;
const TICK_MS = 200;
const STEPS_PER_TICK = Math.max(
  1,
  Number(window.WIZARD_FIGHT_STEPS_PER_TICK || 6)
);
function startTickLoop() {
  if (_tickInterval) return;
  _tickInterval = setInterval(async () => {
    if (!wfState?.lobbyId) return;
    const response = await wfEmitWithAck("step", {
      lobby_id: wfState.lobbyId,
      steps: STEPS_PER_TICK,
    });
    tickCount += 1;
    logDebug("tick", { tickCount, steps: STEPS_PER_TICK, response });
    lastResearching = response.researching || {};
    lastNewSpells = response.new_spells ? response.new_spells.length : 0;
    wfState.gameState = response.state;
    if (response.new_spells && response.new_spells.length > 0) {
      wfState.spells.push(...response.new_spells);
    }
    if (wfState.playerId !== null && response.researching) {
      wfState.researchRemaining = response.researching[wfState.playerId] ?? null;
    }
    wfRenderAll?.();
    renderDebugPanel();
  }, TICK_MS);
  logDebug("tick_loop_started");
}

async function castBaselineLocal() {
  if (!wfEmitWithAck || !wfState?.lobbyId) return;
  logDebug("cast_baseline", { lobby_id: wfState.lobbyId });
  const response = await wfEmitWithAck("cast_baseline", { lobby_id: wfState.lobbyId });
  logDebug("cast_baseline_response", response);
  wfState.gameState = response.state ?? wfState.gameState;
  wfRenderAll?.();
  renderDebugPanel();
}

async function researchSpellLocal(prompt) {
  if (!wfEmitWithAck || !wfState?.lobbyId || !prompt) return;
  logDebug("research_spell", { lobby_id: wfState.lobbyId, prompt });
  await wfEmitWithAck("research_spell", {
    lobby_id: wfState.lobbyId,
    prompt,
  });
  wfRenderAll?.();
  renderDebugPanel();
}

async function castSpellLocal(index) {
  if (!wfEmitWithAck || !wfState?.lobbyId) return;
  logDebug("cast_spell", { lobby_id: wfState.lobbyId, spell_index: index });
  const response = await wfEmitWithAck("cast_spell", {
    lobby_id: wfState.lobbyId,
    spell_index: index,
  });
  logDebug("cast_spell_response", response);
  wfState.gameState = response.state ?? wfState.gameState;
  wfRenderAll?.();
  renderDebugPanel();
}

// Attach UI hooks if present on this page
const castBaselineBtn = document.getElementById("cast-baseline");
const researchInput = document.getElementById("research-input");
const researchButton = document.getElementById("research-button");
const spectateInput = document.getElementById("spectate-input");
const spectateButton = document.getElementById("spectate-button");

if (castBaselineBtn) castBaselineBtn.addEventListener("click", castBaselineLocal);
if (researchButton && researchInput) {
  researchButton.addEventListener("click", () => researchSpellLocal(researchInput.value.trim()));
}
if (spectateButton && spectateInput) spectateButton.addEventListener("click", async () => {
  if (!wfState) return;
  wfState.mode = "spectator";
  wfState.lobbyId = spectateInput.value.trim();
  logDebug("spectate", { lobby_id: wfState.lobbyId });
  const response = await wfEmitWithAck("get_state", { lobby_id: wfState.lobbyId });
  logDebug("spectate_state", response);
  wfState.gameState = response.state;
  wfRenderAll?.();
  renderDebugPanel();
});

wfSocket?.on("connect", () => {
  logDebug("socket_connected", { socketId: wfSocket.id });
  if (!wfState?.started && document.getElementById("game-screen")) {
    bootstrapGame();
  }
  startTickLoop();
});

wfSocket?.on("disconnect", (reason) => {
  logDebug("socket_disconnected", { reason });
  renderDebugPanel();
});

// Kick off connection when landing on the game page.
if (wfSocket && !wfSocket.connected) {
  logDebug("socket_connecting");
  wfSocket.connect();
}

renderDebugPanel();

  // Export for debug/testing
  window.gameModule = {
    bootstrapGame,
    startTickLoop,
    castBaselineLocal,
    researchSpellLocal,
    castSpellLocal,
  };
})();
