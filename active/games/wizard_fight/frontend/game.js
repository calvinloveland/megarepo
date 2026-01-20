const { socket, emitWithAck, state } = window.wizardFight || {};

async function bootstrapGame() {
  if (!emitWithAck) return;
  if (state.started) return;
  state.started = true;
  const lobbyResponse = await emitWithAck("create_lobby", { seed: 7, mode: state.mode });
  state.lobbyId = lobbyResponse.lobby_id;
  if (state.mode !== "cvc") {
    const joinResponse = await emitWithAck("join_lobby", { lobby_id: state.lobbyId });
    state.playerId = joinResponse.player_id;
  }
  const initial = await emitWithAck("get_state", { lobby_id: state.lobbyId });
  state.gameState = initial.state;
  renderAll();
}

let _tickInterval = null;
function startTickLoop() {
  if (_tickInterval) return;
  _tickInterval = setInterval(async () => {
    if (!state.lobbyId) return;
    const response = await emitWithAck("step", { lobby_id: state.lobbyId, steps: 1 });
    state.gameState = response.state;
    if (response.new_spells && response.new_spells.length > 0) {
      state.spells.push(...response.new_spells);
    }
    if (state.playerId !== null && response.researching) {
      state.researchRemaining = response.researching[state.playerId] ?? null;
    }
    renderAll();
  }, 200);
}

async function castBaselineLocal() {
  if (!emitWithAck || !state.lobbyId) return;
  const response = await emitWithAck("cast_baseline", { lobby_id: state.lobbyId });
  state.gameState = response.state ?? state.gameState;
  renderAll();
}

async function researchSpellLocal(prompt) {
  if (!emitWithAck || !state.lobbyId || !prompt) return;
  await emitWithAck("research_spell", {
    lobby_id: state.lobbyId,
    prompt,
  });
  renderAll();
}

async function castSpellLocal(index) {
  if (!emitWithAck || !state.lobbyId) return;
  const response = await emitWithAck("cast_spell", {
    lobby_id: state.lobbyId,
    spell_index: index,
  });
  state.gameState = response.state ?? state.gameState;
  renderAll();
}

// Attach UI hooks if present on this page
const castBaselineBtn = document.getElementById("cast-baseline");
const researchInput = document.getElementById("research-input");
const researchButton = document.getElementById("research-button");
const spectateInput = document.getElementById("spectate-input");
const spectateButton = document.getElementById("spectate-button");

if (castBaselineBtn) castBaselineBtn.addEventListener("click", castBaselineLocal);
if (researchButton && researchInput) researchButton.addEventListener("click", () => researchSpellLocal(researchInput.value.trim()));
if (spectateButton && spectateInput) spectateButton.addEventListener("click", async () => {
  state.mode = "spectator";
  state.lobbyId = spectateInput.value.trim();
  const response = await emitWithAck("get_state", { lobby_id: state.lobbyId });
  state.gameState = response.state;
  renderAll();
});

socket?.on("connect", () => {
  if (!state.started && document.getElementById("game-screen") && !document.getElementById("game-screen").classList.contains("hidden")) {
    bootstrapGame();
  }
  startTickLoop();
});

// Export for debug/testing
window.gameModule = {
  bootstrapGame,
  startTickLoop,
  castBaselineLocal,
  researchSpellLocal,
  castSpellLocal,
};
