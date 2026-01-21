(function () {
  const {
    socket: wfSocket,
    emitWithAck: wfEmitWithAck,
    state: wfState,
  } = window.wizardFight || {};

  const modeEl = document.getElementById("spectate-mode");
  const lobbyEl = document.getElementById("spectate-lobby");
  const ticksEl = document.getElementById("spectate-ticks");

  const TICK_MS = 200;
  const STEPS_PER_TICK = Math.max(
    1,
    Number(window.WIZARD_FIGHT_STEPS_PER_TICK || 6)
  );

  let tickCount = 0;
  let tickInterval = null;

  function updateStatus() {
    if (modeEl) modeEl.textContent = wfState?.mode ?? "-";
    if (lobbyEl) lobbyEl.textContent = wfState?.lobbyId ?? "-";
    if (ticksEl) ticksEl.textContent = String(tickCount);
  }

  function getModeFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    return mode === "cvc" ? "cvc" : "spectator";
  }

  async function ensureLobby() {
    if (!wfEmitWithAck || !wfState) return;
    if (wfState.lobbyId) return;
    wfState.mode = getModeFromQuery();
    if (wfState.mode === "cvc") {
      const lobbyResponse = await wfEmitWithAck("create_lobby", { seed: 7, mode: "cvc" });
      wfState.lobbyId = lobbyResponse.lobby_id;
    }
    updateStatus();
  }

  function startTickLoop() {
    if (tickInterval) return;
    tickInterval = setInterval(async () => {
      if (!wfEmitWithAck || !wfState?.lobbyId) return;
      const response = await wfEmitWithAck("step", {
        lobby_id: wfState.lobbyId,
        steps: STEPS_PER_TICK,
      });
      tickCount += 1;
      wfState.gameState = response.state;
      updateStatus();
    }, TICK_MS);
  }

  async function spectateManual() {
    const spectateInput = document.getElementById("spectate-input");
    if (!wfEmitWithAck || !wfState || !spectateInput) return;
    const lobbyId = spectateInput.value.trim();
    if (!lobbyId) return;
    wfState.mode = "spectator";
    wfState.lobbyId = lobbyId;
    const response = await wfEmitWithAck("get_state", { lobby_id: lobbyId });
    wfState.gameState = response.state;
    updateStatus();
  }

  function bindSpectateControls() {
    const spectateInput = document.getElementById("spectate-input");
    const spectateButton = document.getElementById("spectate-button");
    if (!spectateInput || !spectateButton) return;
    spectateButton.addEventListener("click", spectateManual);
  }

  function init() {
    if (!document.getElementById("spectate-screen")) return;
    bindSpectateControls();
    updateStatus();
    wfSocket?.on("connect", async () => {
      await ensureLobby();
      startTickLoop();
    });
    if (wfSocket && !wfSocket.connected) {
      wfSocket.connect();
    }
  }

  init();
})();
