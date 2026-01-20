const { socket: wfSocket, emitWithAck, state, renderAll } = window.wizardFight || {};

const debugPanel = {
  socket: document.getElementById("dbg-socket"),
  mode: document.getElementById("dbg-mode"),
  lobby: document.getElementById("dbg-lobby"),
  player: document.getElementById("dbg-player"),
  ticks: document.getElementById("dbg-ticks"),
  lastTick: document.getElementById("dbg-last-tick"),
  units: document.getElementById("dbg-units"),
  w0: document.getElementById("dbg-w0"),
  w1: document.getElementById("dbg-w1"),
};

let tickCount = 0;

function logDebug(event, payload = {}) {
  const stamp = new Date().toISOString();
  console.log(`[wizard-fight][${stamp}] ${event}`, payload);
}

function renderDebugPanel() {
  if (!debugPanel.socket) return;
  debugPanel.socket.textContent = wfSocket?.connected ? "connected" : "disconnected";
  debugPanel.mode.textContent = state.mode ?? "-";
  debugPanel.lobby.textContent = state.lobbyId ?? "-";
  debugPanel.player.textContent = state.playerId ?? "-";
  debugPanel.ticks.textContent = String(tickCount);
  debugPanel.lastTick.textContent = new Date().toLocaleTimeString();
  const units = state.gameState?.units ?? [];
  debugPanel.units.textContent = String(units.length);
  const w0 = state.gameState?.wizards?.[0];
  const w1 = state.gameState?.wizards?.[1];
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
  if (!emitWithAck) return;
  if (state.started) return;
  state.started = true;
  state.mode = getModeFromQuery();
  logDebug("bootstrap_start", { mode: state.mode });
  const lobbyResponse = await emitWithAck("create_lobby", { seed: 7, mode: state.mode });
  logDebug("create_lobby_response", lobbyResponse);
  state.lobbyId = lobbyResponse.lobby_id;
  if (state.mode !== "cvc") {
    const joinResponse = await emitWithAck("join_lobby", { lobby_id: state.lobbyId });
    logDebug("join_lobby_response", joinResponse);
    state.playerId = joinResponse.player_id;
  }
  const initial = await emitWithAck("get_state", { lobby_id: state.lobbyId });
  logDebug("initial_state", initial);
  state.gameState = initial.state;
  renderAll();
  renderDebugPanel();
}

let _tickInterval = null;
function startTickLoop() {
  if (_tickInterval) return;
  _tickInterval = setInterval(async () => {
    if (!state.lobbyId) return;
    const response = await emitWithAck("step", { lobby_id: state.lobbyId, steps: 1 });
    tickCount += 1;
    logDebug("tick", { tickCount, response });
    state.gameState = response.state;
    if (response.new_spells && response.new_spells.length > 0) {
      state.spells.push(...response.new_spells);
    }
    if (state.playerId !== null && response.researching) {
      state.researchRemaining = response.researching[state.playerId] ?? null;
    }
    renderAll();
    renderDebugPanel();
  }, 200);
  logDebug("tick_loop_started");
}

async function castBaselineLocal() {
  if (!emitWithAck || !state.lobbyId) return;
  logDebug("cast_baseline", { lobby_id: state.lobbyId });
  const response = await emitWithAck("cast_baseline", { lobby_id: state.lobbyId });
  logDebug("cast_baseline_response", response);
  state.gameState = response.state ?? state.gameState;
  renderAll();
  renderDebugPanel();
}

async function researchSpellLocal(prompt) {
  if (!emitWithAck || !state.lobbyId || !prompt) return;
  logDebug("research_spell", { lobby_id: state.lobbyId, prompt });
  await emitWithAck("research_spell", {
    lobby_id: state.lobbyId,
    prompt,
  });
  renderAll();
  renderDebugPanel();
}

async function castSpellLocal(index) {
  if (!emitWithAck || !state.lobbyId) return;
  logDebug("cast_spell", { lobby_id: state.lobbyId, spell_index: index });
  const response = await emitWithAck("cast_spell", {
    lobby_id: state.lobbyId,
    spell_index: index,
  });
  logDebug("cast_spell_response", response);
  state.gameState = response.state ?? state.gameState;
  renderAll();
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
  state.mode = "spectator";
  state.lobbyId = spectateInput.value.trim();
  logDebug("spectate", { lobby_id: state.lobbyId });
  const response = await emitWithAck("get_state", { lobby_id: state.lobbyId });
  logDebug("spectate_state", response);
  state.gameState = response.state;
  renderAll();
  renderDebugPanel();
});

wfSocket?.on("connect", () => {
  logDebug("socket_connected", { socketId: wfSocket.id });
  if (!state.started && document.getElementById("game-screen")) {
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
