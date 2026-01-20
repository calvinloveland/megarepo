const SOCKET_URL = window.WIZARD_FIGHT_SOCKET_URL || "http://localhost:5055";

const state = {
  lobbyId: null,
  playerId: null,
  mode: "player",
  spells: [],
  researchRemaining: null,
  gameState: null,
  started: false,
};

const socket = window.io(SOCKET_URL, { autoConnect: false });

const lobbyIdEl = document.getElementById("lobby-id");
const playerIdEl = document.getElementById("player-id");
const wiz0HpEl = document.getElementById("wiz0-hp");
const wiz0ManaEl = document.getElementById("wiz0-mana");
const wiz1HpEl = document.getElementById("wiz1-hp");
const wiz1ManaEl = document.getElementById("wiz1-mana");
const castBaselineBtn = document.getElementById("cast-baseline");
const researchInput = document.getElementById("research-input");
const researchButton = document.getElementById("research-button");
const researchStatus = document.getElementById("research-status");
const spectateInput = document.getElementById("spectate-input");
const spectateButton = document.getElementById("spectate-button");
const spellList = document.getElementById("spell-list");
const timeEl = document.getElementById("time");
const unitCountEl = document.getElementById("unit-count");
const laneEl = document.getElementById("lane");
const unitsEl = document.getElementById("units");
const titleScreen = document.getElementById("title-screen");
const gameScreen = document.getElementById("game-screen");
const spellbookScreen = document.getElementById("spellbook-screen");
const leaderboardScreen = document.getElementById("leaderboard-screen");
const titleButtons = document.querySelectorAll("[data-action]");
const modeStatus = document.getElementById("mode-status");
const spellbookBack = document.getElementById("spellbook-back");
const spellbookList = document.getElementById("spellbook-list");
const leaderboardBack = document.getElementById("leaderboard-back");
const leaderboardList = document.getElementById("leaderboard-list");
const metricLobbies = document.getElementById("metric-lobbies");
const metricResearched = document.getElementById("metric-researched");
const metricCast = document.getElementById("metric-cast");

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response));
  });
}

function renderHud() {
  lobbyIdEl.textContent = state.lobbyId ?? "-";
  playerIdEl.textContent = state.playerId ?? "-";
  if (modeStatus) {
    modeStatus.textContent = `Mode: ${state.mode}`;
  }

  if (!state.gameState) return;
  wiz0HpEl.textContent = state.gameState.wizards?.[0]?.health?.toFixed(1) ?? "-";
  wiz0ManaEl.textContent = state.gameState.wizards?.[0]?.mana?.toFixed(1) ?? "-";
  wiz1HpEl.textContent = state.gameState.wizards?.[1]?.health?.toFixed(1) ?? "-";
  wiz1ManaEl.textContent = state.gameState.wizards?.[1]?.mana?.toFixed(1) ?? "-";
  timeEl.textContent = state.gameState.time_seconds?.toFixed(2) ?? "-";
  unitCountEl.textContent = state.gameState.units?.length ?? 0;
}

function renderSpellbook() {
  spellList.innerHTML = "";
  if (state.spells.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No researched spells yet.";
    spellList.appendChild(li);
    return;
  }

  state.spells.forEach((spell, index) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = spell.spec?.name ?? `Spell ${index + 1}`;
    const button = document.createElement("button");
    button.textContent = "Cast";
    button.disabled = state.mode !== "player";
    button.addEventListener("click", () => castSpell(index));
    li.appendChild(name);
    li.appendChild(button);
    spellList.appendChild(li);
  });
}

function renderResearch() {
  if (state.researchRemaining && state.researchRemaining > 0) {
    researchStatus.textContent = `Research completes in ${state.researchRemaining.toFixed(1)}s`;
  } else {
    researchStatus.textContent = "";
  }
  const playerMode = state.mode === "pvp" || state.mode === "pvc";
  researchButton.disabled = !playerMode || !!state.researchRemaining;
  castBaselineBtn.disabled = !playerMode;
}

function renderArena() {
  if (!state.gameState) return;
  unitsEl.innerHTML = "";
  const laneWidth = Math.max(laneEl.clientWidth, 1200);
  const leftMargin = 60;
  const rightMargin = 60;

  state.gameState.units.forEach((unit) => {
    const ratio = unit.position / 100;
    const x = leftMargin + ratio * (laneWidth - leftMargin - rightMargin);
    const div = document.createElement("div");
    div.className = "unit";
    div.textContent = unit.owner_id === 0 ? "🐒" : "🐵";
    div.style.left = `${x}px`;
    unitsEl.appendChild(div);
  });
}

function renderAll() {
  renderHud();
  renderResearch();
  renderSpellbook();
  renderArena();
}

async function bootstrap() {
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

async function tick() {
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
}

async function castBaseline() {
  if (!state.lobbyId) return;
  const response = await emitWithAck("cast_baseline", { lobby_id: state.lobbyId });
  state.gameState = response.state ?? state.gameState;
  renderAll();
}

async function researchSpell() {
  if (!state.lobbyId || !researchInput.value.trim()) return;
  await emitWithAck("research_spell", {
    lobby_id: state.lobbyId,
    prompt: researchInput.value.trim(),
  });
  researchInput.value = "";
  renderAll();
}

async function castSpell(index) {
  if (!state.lobbyId) return;
  const response = await emitWithAck("cast_spell", {
    lobby_id: state.lobbyId,
    spell_index: index,
  });
  state.gameState = response.state ?? state.gameState;
  renderAll();
}

async function spectateLobby() {
  if (!spectateInput.value.trim()) return;
  state.mode = "spectator";
  state.lobbyId = spectateInput.value.trim();
  const response = await emitWithAck("get_state", { lobby_id: state.lobbyId });
  state.gameState = response.state;
  renderAll();
}

function startMode(mode) {
  state.mode = mode;
  titleScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  spellbookScreen.classList.add("hidden");
  leaderboardScreen.classList.add("hidden");
  renderAll();
  if (socket.connected) {
    bootstrap();
  } else {
    socket.connect();
  }
}

function showSpellbook() {
  titleScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
  spellbookScreen.classList.remove("hidden");
  leaderboardScreen.classList.add("hidden");
  loadSpellbook();
}

function showLeaderboard() {
  titleScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
  spellbookScreen.classList.add("hidden");
  leaderboardScreen.classList.remove("hidden");
  loadLeaderboard();
}

function showTitle() {
  titleScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
  spellbookScreen.classList.add("hidden");
  leaderboardScreen.classList.add("hidden");
}

async function loadSpellbook() {
  spellbookList.innerHTML = "";
  try {
    const response = await fetch(`${SOCKET_URL}/spellbook`);
    const payload = await response.json();
    const spells = payload.spells || [];
    if (spells.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No spells researched yet.";
      spellbookList.appendChild(li);
      return;
    }
    spells.forEach((spell) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <strong>${spell.name}</strong>
          <div class="spell-meta">Prompt: ${spell.prompt}</div>
        </div>
      `;
      spellbookList.appendChild(li);
    });
  } catch (error) {
    const li = document.createElement("li");
    li.textContent = "Failed to load spellbook.";
    spellbookList.appendChild(li);
  }
}

async function loadLeaderboard() {
  leaderboardList.innerHTML = "";
  try {
    const response = await fetch(`${SOCKET_URL}/leaderboard`);
    const payload = await response.json();
    const entries = payload.top_spells || [];
    if (entries.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No leaderboard data yet.";
      leaderboardList.appendChild(li);
    } else {
      entries.forEach((entry) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <div>
            <strong>${entry.name}</strong>
            <div class="spell-meta">Research count: ${entry.count}</div>
          </div>
        `;
        leaderboardList.appendChild(li);
      });
    }
    if (payload.metrics) {
      metricLobbies.textContent = payload.metrics.lobbies_created ?? 0;
      metricResearched.textContent = payload.metrics.spells_researched ?? 0;
      metricCast.textContent = payload.metrics.spells_cast ?? 0;
    }
  } catch (error) {
    const li = document.createElement("li");
    li.textContent = "Failed to load leaderboard.";
    leaderboardList.appendChild(li);
  }
}

if (castBaselineBtn) castBaselineBtn.addEventListener("click", castBaseline);
if (researchButton) researchButton.addEventListener("click", researchSpell);
if (spectateButton) spectateButton.addEventListener("click", spectateLobby);

titleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "pvp") {
      startMode("pvp");
    } else if (action === "pvc") {
      startMode("pvc");
    } else if (action === "cvc") {
      startMode("cvc");
    } else if (action === "spellbook") {
      showSpellbook();
    } else if (action === "leaderboard") {
      showLeaderboard();
    }
  });
});

if (spellbookBack) spellbookBack.addEventListener("click", showTitle);
if (leaderboardBack) leaderboardBack.addEventListener("click", showTitle);

// Expose helpers for page-specific scripts
window.wizardFight = {
  socket,
  emitWithAck,
  state,
  renderAll,
};

socket.on("connect", () => {
  if (!state.started && gameScreen && !gameScreen.classList.contains("hidden")) {
    bootstrap();
  }
  if (typeof tick === "function" && gameScreen) {
    setInterval(tick, 200);
  }
});
