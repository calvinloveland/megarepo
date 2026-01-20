const SOCKET_URL = window.WIZARD_FIGHT_SOCKET_URL || "http://localhost:5055";

const state = {
  lobbyId: null,
  playerId: null,
  mode: "player",
  spells: [],
  researchRemaining: null,
  gameState: null,
};

const socket = window.io(SOCKET_URL, { autoConnect: true });

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
const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response));
  });
}

function renderHud() {
  lobbyIdEl.textContent = state.lobbyId ?? "-";
  playerIdEl.textContent = state.playerId ?? "-";

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
  researchButton.disabled = state.mode !== "player" || !!state.researchRemaining;
  castBaselineBtn.disabled = state.mode !== "player";
}

function renderArena() {
  if (!state.gameState) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1b1d2a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#3d4160";
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  const wizardPositions = [20, canvas.width - 20];
  [0, 1].forEach((wizardId) => {
    ctx.fillStyle = wizardId === 0 ? "#7f8cff" : "#ff7f8c";
    ctx.beginPath();
    ctx.arc(wizardPositions[wizardId], canvas.height / 2, 10, 0, Math.PI * 2);
    ctx.fill();
  });

  state.gameState.units.forEach((unit) => {
    const ratio = unit.position / 100;
    const x = 30 + ratio * (canvas.width - 60);
    ctx.fillStyle = unit.owner_id === 0 ? "#ffd66e" : "#6effd6";
    ctx.beginPath();
    ctx.arc(x, canvas.height / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function renderAll() {
  renderHud();
  renderResearch();
  renderSpellbook();
  renderArena();
}

async function bootstrap() {
  const lobbyResponse = await emitWithAck("create_lobby", { seed: 7 });
  state.lobbyId = lobbyResponse.lobby_id;
  const joinResponse = await emitWithAck("join_lobby", { lobby_id: state.lobbyId });
  state.playerId = joinResponse.player_id;
  const initial = await emitWithAck("get_state", { lobby_id: state.lobbyId });
  state.gameState = initial.state;
  renderAll();
}

async function tick() {
  if (!state.lobbyId) return;
  if (state.mode !== "player") return;
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

castBaselineBtn.addEventListener("click", castBaseline);
researchButton.addEventListener("click", researchSpell);
spectateButton.addEventListener("click", spectateLobby);

socket.on("connect", () => {
  bootstrap();
  setInterval(tick, 200);
});
