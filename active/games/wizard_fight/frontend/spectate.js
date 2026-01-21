(function () {
  const {
    socket: wfSocket,
    emitWithAck: wfEmitWithAck,
    state: wfState,
  } = window.wizardFight || {};

  const modeEl = document.getElementById("spectate-mode");
  const lobbyEl = document.getElementById("spectate-lobby");
  const ticksEl = document.getElementById("spectate-ticks");
  const researchEl = document.getElementById("spectate-research");
  const logEl = document.getElementById("spectate-log");
  const laneEl = document.getElementById("lane");
  const unitsEl = document.getElementById("units");

  const TICK_MS = 200;
  const STEPS_PER_TICK = Math.max(
    1,
    Number(window.WIZARD_FIGHT_STEPS_PER_TICK || 6)
  );

  let tickCount = 0;
  let tickInterval = null;
  let lastResearching = {};
  let lastPrompts = {};
  let lastResearchingKeys = new Set();
  let lastSpellCount = 0;

  function pushLog(message) {
    if (!logEl) return;
    const li = document.createElement("li");
    const stamp = new Date().toLocaleTimeString();
    li.textContent = `[${stamp}] ${message}`;
    logEl.prepend(li);
    const items = logEl.querySelectorAll("li");
    if (items.length > 50) {
      items[items.length - 1].remove();
    }
  }

  function updateStatus() {
    if (modeEl) modeEl.textContent = wfState?.mode ?? "-";
    if (lobbyEl) lobbyEl.textContent = wfState?.lobbyId ?? "-";
    if (ticksEl) ticksEl.textContent = String(tickCount);
    if (researchEl) {
      researchEl.innerHTML = "";
      const entries = [0, 1].map((id) => ({
        id,
        remaining: lastResearching[id],
        prompt: lastPrompts[id],
      }));
      entries.forEach((entry) => {
        const li = document.createElement("li");
        if (entry.remaining === undefined) {
          li.textContent = `CPU ${entry.id}: idle`;
        } else {
          li.textContent = `CPU ${entry.id}: ${entry.prompt || "researching"} (${entry.remaining.toFixed(1)}s)`;
        }
        researchEl.appendChild(li);
      });
    }
  }

  function syncLogFromResearch() {
    const currentKeys = new Set(Object.keys(lastResearching));
    for (const key of currentKeys) {
      if (!lastResearchingKeys.has(key)) {
        const prompt = lastPrompts[key] || "researching";
        pushLog(`CPU ${key} started research: ${prompt}`);
      }
    }
    for (const key of lastResearchingKeys) {
      if (!currentKeys.has(key)) {
        pushLog(`CPU ${key} completed research`);
      }
    }
    lastResearchingKeys = currentKeys;
  }

  function syncLogFromSpells() {
    const spellCount = Array.isArray(wfState?.spells) ? wfState.spells.length : 0;
    if (spellCount > lastSpellCount) {
      const newCount = spellCount - lastSpellCount;
      pushLog(`New spells discovered: ${newCount}`);
    }
    lastSpellCount = spellCount;
  }

  function renderArena() {
    if (!laneEl || !unitsEl || !wfState?.gameState) return;
    unitsEl.innerHTML = "";
    const laneWidth = Math.max(laneEl.clientWidth, 1200);
    const leftMargin = 60;
    const rightMargin = 60;

    wfState.gameState.units.forEach((unit) => {
      const ratio = unit.position / 100;
      const x = leftMargin + ratio * (laneWidth - leftMargin - rightMargin);
      const div = document.createElement("div");
      div.className = "unit";
      div.textContent = unit.owner_id === 0 ? "🐒" : "🐵";
      div.style.left = `${x}px`;
      unitsEl.appendChild(div);
    });
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
      lastResearching = response.researching || {};
      lastPrompts = response.researching_prompts || {};
      if (response.new_spells && response.new_spells.length > 0) {
        pushLog(`New spells discovered: ${response.new_spells.length}`);
      }
      syncLogFromResearch();
      syncLogFromSpells();
      updateStatus();
      renderArena();
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
    lastResearching = response.researching || {};
    lastPrompts = response.researching_prompts || {};
    syncLogFromResearch();
    syncLogFromSpells();
    updateStatus();
    renderArena();
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
