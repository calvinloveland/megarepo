const { emitWithAck, state } = window.wizardFight || {};

async function spectatePageInit() {
  const spectateInput = document.getElementById("spectate-input");
  const spectateButton = document.getElementById("spectate-button");
  if (!spectateInput || !spectateButton || !emitWithAck) return;
  spectateButton.addEventListener("click", async () => {
    if (!spectateInput.value.trim()) return;
    state.mode = "spectator";
    state.lobbyId = spectateInput.value.trim();
    const response = await emitWithAck("get_state", { lobby_id: state.lobbyId });
    state.gameState = response.state;
    renderAll();
  });
}

if (document.getElementById("spectate-screen")) {
  spectatePageInit();
}

window.spectateModule = { spectatePageInit };
