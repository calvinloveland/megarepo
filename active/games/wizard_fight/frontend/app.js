import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

const SOCKET_URL = window.WIZARD_FIGHT_SOCKET_URL || "http://localhost:5055";

const state = {
  lobbyId: null,
  playerId: null,
  mode: "player",
  spells: [],
  researchRemaining: null,
  gameState: null,
  started: false,
  wizardName: null,
};

const socket = io(SOCKET_URL, { autoConnect: false });

const lobbyIdEl = document.getElementById("lobby-id");
const playerIdEl = document.getElementById("player-id");
const wizardNameEl = document.getElementById("wizard-name");
const wiz0HpEl = document.getElementById("wiz0-hp");
const wiz0ManaEl = document.getElementById("wiz0-mana");
const wiz1HpEl = document.getElementById("wiz1-hp");
const wiz1ManaEl = document.getElementById("wiz1-mana");
const wizard0NameEl = document.getElementById("wizard-0-name");
const wizard1NameEl = document.getElementById("wizard-1-name");
const castBaselineBtn = document.getElementById("cast-baseline");
const researchInput = document.getElementById("research-input");
const researchButton = document.getElementById("research-button");
const researchStatus = document.getElementById("research-status");
const spectateInput = document.getElementById("spectate-input");
const spectateButton = document.getElementById("spectate-button");
const spellList = document.getElementById("spell-list");
const timeEl = document.getElementById("time");
const unitCountEl = document.getElementById("unit-count");
const lanesEl = document.getElementById("lanes");
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

const BASELINE_SPELL = {
  spec: {
    name: "Summon Flying Monkey",
    mana_cost: 15,
  },
  design: {
    description: "Summons a fast flying monkey to pressure the enemy wizard.",
  },
};

const WIZARD_NAME_COOKIE = "wizard_name";
const WIZARD_NAME_MAX = 24;

function getCookie(name) {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

function setCookie(name, value, days = 365) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function normalizeWizardName(name) {
  if (!name) return "";
  return name.trim().slice(0, WIZARD_NAME_MAX);
}

function ensureWizardName() {
  if (state.mode === "cvc" || state.mode === "spectator") {
    return;
  }
  let name = normalizeWizardName(getCookie(WIZARD_NAME_COOKIE));
  if (!name) {
    const response = window.prompt("Choose your wizard name", "Arcane Adept");
    name = normalizeWizardName(response || "");
  }
  if (!name) {
    name = "Wandering Wizard";
  }
  state.wizardName = name;
  setCookie(WIZARD_NAME_COOKIE, name);
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response));
  });
}

function renderHud() {
  lobbyIdEl.textContent = state.lobbyId ?? "-";
  playerIdEl.textContent = state.playerId ?? "-";
  if (wizardNameEl) {
    wizardNameEl.textContent = state.wizardName ?? "-";
  }
  if (modeStatus) {
    modeStatus.textContent = `Mode: ${state.mode}`;
  }

  if (!state.gameState) return;
  const w0Health = state.gameState.wizards?.[0]?.health;
  const w1Health = state.gameState.wizards?.[1]?.health;
  wiz0HpEl.textContent = Number.isFinite(w0Health) ? Math.max(0, w0Health).toFixed(1) : "-";
  wiz0ManaEl.textContent = state.gameState.wizards?.[0]?.mana?.toFixed(1) ?? "-";
  wiz1HpEl.textContent = Number.isFinite(w1Health) ? Math.max(0, w1Health).toFixed(1) : "-";
  wiz1ManaEl.textContent = state.gameState.wizards?.[1]?.mana?.toFixed(1) ?? "-";
  timeEl.textContent = state.gameState.time_seconds?.toFixed(2) ?? "-";
  unitCountEl.textContent = state.gameState.units?.length ?? 0;
  if (wizard0NameEl || wizard1NameEl) {
    const fallback0 = "Wizard 0";
    const fallback1 = "Wizard 1";
    let name0 = fallback0;
    let name1 = fallback1;
    if (state.mode === "pvc" && state.playerId === 0) {
      name0 = state.wizardName ?? fallback0;
      name1 = "CPU";
    } else if (state.mode === "pvc" && state.playerId === 1) {
      name0 = "CPU";
      name1 = state.wizardName ?? fallback1;
    } else if (state.mode === "pvp") {
      if (state.playerId === 0) {
        name0 = state.wizardName ?? fallback0;
      } else if (state.playerId === 1) {
        name1 = state.wizardName ?? fallback1;
      }
    }
    if (wizard0NameEl) wizard0NameEl.textContent = name0;
    if (wizard1NameEl) wizard1NameEl.textContent = name1;
  }
}

function describeSpell(spell) {
  const design = spell?.design || {};
  if (design.description) {
    return design.description;
  }
  if (design.intended_use) {
    return design.intended_use;
  }
  if (design.theme) {
    return design.theme;
  }
  const prompt = design.prompt || spell?.prompt;
  return prompt ? `Prompt: ${prompt}` : "No description available.";
}

function formatManaCost(spell) {
  const cost = spell?.spec?.mana_cost;
  if (Number.isFinite(cost)) {
    return `Mana ${cost}`;
  }
  return "Mana -";
}

function renderSpellbook() {
  spellList.innerHTML = "";
  const playerMode = state.mode === "pvp" || state.mode === "pvc";
  const entries = [BASELINE_SPELL, ...state.spells];
  entries.forEach((spell, index) => {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "spell-info";

    const titleRow = document.createElement("div");
    titleRow.className = "spell-title-row";

    const name = document.createElement("strong");
    name.textContent = spell.spec?.name ?? `Spell ${index + 1}`;

    const mana = document.createElement("span");
    mana.className = "spell-cost";
    mana.textContent = formatManaCost(spell);

    titleRow.appendChild(name);
    titleRow.appendChild(mana);

    const description = document.createElement("div");
    description.className = "spell-meta";
    description.textContent = describeSpell(spell);

    li.title = description.textContent;

    info.appendChild(titleRow);
    info.appendChild(description);

    const button = document.createElement("button");
    if (index === 0) {
      button.textContent = "Baseline";
      button.disabled = true;
    } else {
      button.textContent = "Cast";
      button.disabled = !playerMode;
      button.addEventListener("click", () => castSpell(index - 1));
    }
    li.appendChild(info);
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
  if (!lanesEl) return;
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
  ensureWizardName();
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
  ensureWizardName,
};

const allowAutoBootstrap =
  document.body && document.body.dataset.autoBootstrap === "true";

socket.on("connect", () => {
  if (allowAutoBootstrap && !state.started && gameScreen && !gameScreen.classList.contains("hidden")) {
    ensureWizardName();
    bootstrap();
  }
  if (allowAutoBootstrap && typeof tick === "function" && gameScreen) {
    setInterval(tick, 200);
  }
});
