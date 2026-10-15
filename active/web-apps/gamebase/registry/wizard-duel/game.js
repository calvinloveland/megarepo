/*
 * Wizard Duel — Gamebase
 *
 * A turn-based adaptation of active/games/wizard_fight. The Python source is a
 * realtime lane battler driven by a spell DSL (damage, shield, heal, mana,
 * summons, environment effects). This port keeps the spell economy and the
 * spell effects, then resolves them as a Hearthstone-style turn duel:
 *
 *   - each wizard ramps mana (+1 max per turn, refilled) and draws a card;
 *   - spells cost mana and are resolved from a 20-card deck;
 *   - summoned minions occupy one of three lanes and clash each turn;
 *   - reduce the enemy wizard to 0 health to win.
 *
 * Modes: vs AI, local 2-player hot-seat, and online turn-based matchmaking
 * (state relayed through the Gamebase match API).
 *
 * The pure engine is exposed as `WizardDuelEngine` / `module.exports` so it can
 * be exercised headlessly with node.
 */
(function (root) {
  "use strict";

  // ── Engine ────────────────────────────────────────────────────────────────

  const START_HP = 30;
  const MAX_MANA = 10;
  const HAND_LIMIT = 7;
  const LANES = 3;
  const MAX_TURNS = 60;

  const SPELL_INFO = {
    bolt: { name: "Arcane Bolt", emoji: "\u2728", cost: 2, target: "enemy", damage: 4, text: "Deal 4 damage to a wizard or minion." },
    fireball: { name: "Fireball", emoji: "\uD83D\uDD25", cost: 4, target: "enemy", damage: 6, text: "Deal 6 damage to a wizard or minion." },
    wind: { name: "Wind Push", emoji: "\uD83C\uDF2A\uFE0F", cost: 3, target: "enemy-minion", damage: 3, text: "Deal 3 damage to an enemy minion and freeze it." },
    frost: { name: "Frost Mist", emoji: "\u2744\uFE0F", cost: 3, target: "none", aoe: 2, text: "Deal 2 damage to all enemy minions and freeze them." },
    stoneskin: { name: "Stone Skin", emoji: "\uD83D\uDEE1\uFE0F", cost: 2, target: "none", shield: 5, text: "Gain 5 shield." },
    heal: { name: "Healing Light", emoji: "\uD83D\uDC9A", cost: 2, target: "none", heal: 6, text: "Restore 6 health to your wizard." },
    research: { name: "Mana Research", emoji: "\uD83D\uDD2E", cost: 1, target: "none", mana: 2, draw: 1, text: "Gain 2 mana and draw a card." },
    spellbook: { name: "Spellbook", emoji: "\uD83D\uDCD6", cost: 1, target: "none", draw: 2, text: "Draw 2 cards." },
    monkey: { name: "Summon Flying Monkey", emoji: "\uD83D\uDC12", cost: 3, target: "lane", summon: { name: "Flying Monkey", emoji: "\uD83D\uDC12", attack: 3, hp: 3 } },
    sprite: { name: "Summon Arcane Sprite", emoji: "\uD83E\uDDDA", cost: 1, target: "lane", summon: { name: "Arcane Sprite", emoji: "\uD83E\uDDDA", attack: 1, hp: 1 } },
    golem: { name: "Summon Stone Golem", emoji: "\uD83D\uDDFF", cost: 5, target: "lane", summon: { name: "Stone Golem", emoji: "\uD83D\uDDFF", attack: 5, hp: 6 } },
    rally: { name: "Rally", emoji: "\uD83D\uDD3A", cost: 1, target: "ally-minion", buff: { attack: 2, hp: 2 }, text: "Give a friendly minion +2/+2." },
  };

  const DECK_LIST = [
    "bolt", "bolt", "bolt",
    "frost", "frost",
    "fireball",
    "stoneskin", "stoneskin",
    "heal", "heal",
    "research", "research",
    "spellbook",
    "monkey", "monkey", "monkey",
    "sprite", "sprite",
    "golem",
    "rally",
  ];

  function hashSeed(value) {
    const text = String(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function playerName(side) {
    return "Wizard " + (side + 1);
  }

  function createGame(seed) {
    const rand = mulberry32(seed >>> 0);
    const players = [0, 1].map(() => {
      const deck = shuffle(DECK_LIST.slice(), rand);
      return {
        hp: START_HP,
        maxHp: START_HP,
        mana: 0,
        maxMana: 0,
        shield: 0,
        deck,
        hand: [],
        discard: [],
        board: [],
      };
    });
    const state = {
      turn: 0,
      turnCount: 0,
      winner: null,
      players,
      nextMinion: 1,
      stats: { damageDealt: [0, 0], hpLost: [0, 0] },
      log: [],
    };
    draw(state, 0, 3);
    draw(state, 1, 3);
    startTurn(state);
    return state;
  }

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function addLog(state, message) {
    state.log.push(message);
    if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
  }

  function draw(state, player, count) {
    const pl = state.players[player];
    for (let i = 0; i < count; i++) {
      if (pl.deck.length === 0) {
        if (pl.discard.length === 0) return;
        pl.deck = pl.discard.slice().reverse();
        pl.discard = [];
      }
      const key = pl.deck.shift();
      if (pl.hand.length < HAND_LIMIT) {
        pl.hand.push(key);
      } else {
        pl.discard.push(key);
      }
    }
  }

  function getMinion(state, player, lane) {
    if (!state.players[player]) return null;
    return state.players[player].board.find((minion) => minion.lane === lane && minion.hp > 0) || null;
  }

  function summon(state, player, lane, spec) {
    const minion = {
      id: state.nextMinion++,
      lane,
      name: spec.name,
      emoji: spec.emoji,
      attack: spec.attack,
      hp: spec.hp,
      maxHp: spec.hp,
      frozen: false,
    };
    state.players[player].board.push(minion);
    return minion;
  }

  function damageWizard(state, victim, amount) {
    const pl = state.players[victim];
    let remaining = amount;
    if (pl.shield > 0) {
      const absorbed = Math.min(pl.shield, remaining);
      pl.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      pl.hp -= remaining;
      state.stats.hpLost[victim] += remaining;
    }
  }

  function removeDead(state) {
    for (const pl of state.players) {
      const dead = pl.board.filter((minion) => minion.hp <= 0);
      if (dead.length) {
        for (const minion of dead) addLog(state, `${minion.name} is destroyed.`);
        pl.board = pl.board.filter((minion) => minion.hp > 0);
      }
    }
  }

  function resolveMinions(state, player) {
    const enemy = 1 - player;
    const lanes = state.players[player].board.slice().sort((a, b) => a.lane - b.lane);
    for (const minion of lanes) {
      if (minion.hp <= 0) continue;
      if (minion.frozen) {
        minion.frozen = false;
        addLog(state, `${minion.name} is frozen and cannot attack.`);
        continue;
      }
      const foe = getMinion(state, enemy, minion.lane);
      if (foe) {
        foe.hp -= minion.attack;
        addLog(state, `${minion.name} strikes ${foe.name} for ${minion.attack}.`);
      } else {
        damageWizard(state, enemy, minion.attack);
        addLog(state, `${minion.name} strikes ${playerName(enemy)} for ${minion.attack}.`);
      }
    }
  }

  function checkWinner(state) {
    const dead0 = state.players[0].hp <= 0;
    const dead1 = state.players[1].hp <= 0;
    if (dead0 && dead1) state.winner = "draw";
    else if (dead0) state.winner = 1;
    else if (dead1) state.winner = 0;
    else if (state.turnCount >= MAX_TURNS) {
      const h0 = state.players[0].hp;
      const h1 = state.players[1].hp;
      state.winner = h0 > h1 ? 0 : h1 > h0 ? 1 : "draw";
    }
    return state.winner;
  }

  function startTurn(state) {
    if (state.winner !== null) return;
    const player = state.turn;
    const pl = state.players[player];
    pl.maxMana = Math.min(MAX_MANA, pl.maxMana + 1);
    pl.mana = pl.maxMana;
    state.turnCount += 1;
    draw(state, player, 1);
    addLog(state, `— Turn ${state.turnCount}: ${playerName(player)} (${pl.mana} mana) —`);
    resolveMinions(state, player);
    removeDead(state);
    checkWinner(state);
  }

  function endTurn(state) {
    if (state.winner !== null) return;
    state.turn = 1 - state.turn;
    startTurn(state);
  }

  function isValidTarget(state, player, key, target) {
    const info = SPELL_INFO[key];
    if (!info) return false;
    if (info.target === "none") return true;
    if (!target || typeof target !== "object") return false;
    const enemy = 1 - player;
    if (info.target === "enemy") {
      if (target.kind === "wizard") return target.player === enemy;
      if (target.kind === "minion") return target.player === enemy && Boolean(getMinion(state, enemy, target.lane));
      return false;
    }
    if (info.target === "enemy-minion") {
      return target.kind === "minion" && target.player === enemy && Boolean(getMinion(state, enemy, target.lane));
    }
    if (info.target === "ally-minion") {
      return target.kind === "minion" && target.player === player && Boolean(getMinion(state, player, target.lane));
    }
    if (info.target === "lane") {
      return target.kind === "lane" && target.lane >= 0 && target.lane < LANES && !getMinion(state, player, target.lane);
    }
    return false;
  }

  function applySpell(state, player, key, target) {
    const info = SPELL_INFO[key];
    const enemy = 1 - player;
    const pl = state.players[player];
    if (key === "bolt" || key === "fireball") {
      state.stats.damageDealt[player] += info.damage;
      if (target.kind === "wizard") {
        damageWizard(state, target.player, info.damage);
        addLog(state, `${playerName(player)} casts ${info.name} for ${info.damage}.`);
      } else {
        const minion = getMinion(state, target.player, target.lane);
        if (minion) {
          minion.hp -= info.damage;
          addLog(state, `${playerName(player)} casts ${info.name} at ${minion.name} for ${info.damage}.`);
        }
      }
      return;
    }
    if (key === "wind") {
      const minion = getMinion(state, target.player, target.lane);
      if (minion) {
        minion.hp -= info.damage;
        minion.frozen = true;
        state.stats.damageDealt[player] += info.damage;
        addLog(state, `${playerName(player)} casts ${info.name} at ${minion.name} for ${info.damage} and freezes it.`);
      }
      return;
    }
    if (key === "frost") {
      let hit = 0;
      for (const minion of state.players[enemy].board) {
        if (minion.hp > 0) {
          minion.hp -= info.aoe;
          minion.frozen = true;
          hit += 1;
          state.stats.damageDealt[player] += info.aoe;
        }
      }
      addLog(state, `${playerName(player)} casts ${info.name}, chilling ${hit} minion(s).`);
      return;
    }
    if (key === "stoneskin") {
      pl.shield += info.shield;
      addLog(state, `${playerName(player)} casts ${info.name} for ${info.shield} shield.`);
      return;
    }
    if (key === "heal") {
      const before = pl.hp;
      pl.hp = Math.min(pl.maxHp, pl.hp + info.heal);
      addLog(state, `${playerName(player)} casts ${info.name} and restores ${pl.hp - before}.`);
      return;
    }
    if (key === "research") {
      pl.mana += info.mana;
      draw(state, player, info.draw);
      addLog(state, `${playerName(player)} casts ${info.name} (+${info.mana} mana, draw ${info.draw}).`);
      return;
    }
    if (key === "spellbook") {
      draw(state, player, info.draw);
      addLog(state, `${playerName(player)} casts ${info.name} (draw ${info.draw}).`);
      return;
    }
    if (info.summon) {
      const minion = summon(state, player, target.lane, info.summon);
      addLog(state, `${playerName(player)} summons ${minion.emoji} ${minion.name} in lane ${target.lane + 1}.`);
      return;
    }
    if (key === "rally") {
      const minion = getMinion(state, target.player, target.lane);
      if (minion) {
        minion.attack += info.buff.attack;
        minion.maxHp += info.buff.hp;
        minion.hp += info.buff.hp;
        addLog(state, `${playerName(player)} rallies ${minion.name} (+${info.buff.attack}/+${info.buff.hp}).`);
      }
    }
  }

  function castSpell(state, player, handIndex, target) {
    if (state.winner !== null) return { ok: false, error: "The duel is over." };
    if (state.turn !== player) return { ok: false, error: "It is not your turn." };
    const pl = state.players[player];
    if (handIndex < 0 || handIndex >= pl.hand.length) return { ok: false, error: "Choose a spell." };
    const key = pl.hand[handIndex];
    const info = SPELL_INFO[key];
    if (!info) return { ok: false, error: "Unknown spell." };
    if (pl.mana < info.cost) return { ok: false, error: "Not enough mana." };
    if (!isValidTarget(state, player, key, target)) return { ok: false, error: "Invalid target." };
    pl.mana -= info.cost;
    pl.hand.splice(handIndex, 1);
    pl.discard.push(key);
    applySpell(state, player, key, target || { kind: "none" });
    removeDead(state);
    checkWinner(state);
    return { ok: true, key };
  }

  // ── AI ───────────────────────────────────────────────────────────────────

  function aiChooseAction(state, player) {
    if (state.turn !== player || state.winner !== null) return { type: "end" };
    const me = state.players[player];
    const enemy = 1 - player;
    const foe = state.players[enemy];
    const playable = me.hand
      .map((key, index) => ({ key, index, info: SPELL_INFO[key] }))
      .filter((card) => card.info && card.info.cost <= me.mana);
    if (playable.length === 0) return { type: "end" };

    const enemyMinions = foe.board.filter((minion) => minion.hp > 0);
    const ownMinions = me.board.filter((minion) => minion.hp > 0);
    const face = { kind: "wizard", player: enemy };

    const directDamage = playable.filter((card) => card.info.damage && card.info.target === "enemy");
    const totalFace = directDamage.reduce((sum, card) => sum + card.info.damage, 0);
    if (directDamage.length && totalFace >= foe.hp + foe.shield) {
      return { type: "cast", index: directDamage[0].index, target: face };
    }

    const threat = enemyMinions.slice().sort((a, b) => b.attack - a.attack || b.hp - a.hp)[0];
    if (threat && threat.attack >= 3) {
      const single = playable
        .filter((card) => card.info.damage && (card.info.target === "enemy" || card.info.target === "enemy-minion") && card.info.damage >= threat.hp)
        .sort((a, b) => a.info.cost - b.info.cost)[0];
      if (single) {
        return { type: "cast", index: single.index, target: { kind: "minion", player: enemy, lane: threat.lane } };
      }
      const combined = playable.filter((card) => card.info.damage && (card.info.target === "enemy" || card.info.target === "enemy-minion"));
      const combinedTotal = combined.reduce((sum, card) => sum + card.info.damage, 0);
      if (combined.length && combinedTotal >= threat.hp) {
        return { type: "cast", index: combined[0].index, target: { kind: "minion", player: enemy, lane: threat.lane } };
      }
    }

    if (me.hp <= Math.floor(START_HP * 0.45)) {
      const heal = playable.find((card) => card.key === "heal");
      if (heal) return { type: "cast", index: heal.index, target: { kind: "none" } };
    }

    const openLanes = [];
    for (let lane = 0; lane < LANES; lane++) {
      if (!ownMinions.some((minion) => minion.lane === lane)) openLanes.push(lane);
    }
    if (openLanes.length) {
      const summons = playable
        .filter((card) => card.info.target === "lane")
        .sort((a, b) => b.info.cost - a.info.cost || b.info.summon.attack - a.info.summon.attack);
      if (summons.length) {
        const threatened = openLanes.find((lane) => enemyMinions.some((minion) => minion.lane === lane));
        const lane = threatened !== undefined ? threatened : openLanes.includes(1) ? 1 : openLanes[0];
        return { type: "cast", index: summons[0].index, target: { kind: "lane", lane } };
      }
    }

    if (me.hand.length <= 3) {
      const drawSpell = playable.find((card) => card.key === "spellbook") || playable.find((card) => card.key === "research");
      if (drawSpell) return { type: "cast", index: drawSpell.index, target: { kind: "none" } };
    }

    if (ownMinions.length) {
      const rally = playable.find((card) => card.key === "rally");
      const best = ownMinions.slice().sort((a, b) => b.attack - a.attack)[0];
      if (rally && best) return { type: "cast", index: rally.index, target: { kind: "minion", player, lane: best.lane } };
    }

    const stoneskin = playable.find((card) => card.key === "stoneskin");
    if (stoneskin && (enemyMinions.length > 0 || me.hp <= Math.floor(START_HP * 0.6))) {
      return { type: "cast", index: stoneskin.index, target: { kind: "none" } };
    }

    const frost = playable.find((card) => card.key === "frost");
    if (frost && enemyMinions.length >= 2) return { type: "cast", index: frost.index, target: { kind: "none" } };

    if (directDamage.length) return { type: "cast", index: directDamage[0].index, target: face };

    const free = playable.find((card) => card.info.target === "none");
    if (free) return { type: "cast", index: free.index, target: { kind: "none" } };

    const wind = playable.find((card) => card.key === "wind") || playable.find((card) => card.info.target === "enemy-minion");
    if (wind && enemyMinions.length) {
      return { type: "cast", index: wind.index, target: { kind: "minion", player: enemy, lane: enemyMinions[0].lane } };
    }

    return { type: "end" };
  }

  function simulate(seed, maxActions) {
    const state = createGame(seed);
    let guard = 0;
    while (state.winner === null && guard < (maxActions || 4000)) {
      const action = aiChooseAction(state, state.turn);
      if (action.type === "end") {
        endTurn(state);
      } else {
        const result = castSpell(state, state.turn, action.index, action.target);
        if (!result.ok) endTurn(state);
      }
      guard += 1;
    }
    return state;
  }

  const Engine = {
    START_HP,
    MAX_MANA,
    LANES,
    SPELL_INFO,
    DECK_LIST,
    hashSeed,
    createGame,
    clone,
    castSpell,
    endTurn,
    startTurn,
    aiChooseAction,
    isValidTarget,
    getMinion,
    simulate,
    checkWinner,
  };
  root.WizardDuelEngine = Engine;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;

  // ── UI ────────────────────────────────────────────────────────────────────

  if (typeof document === "undefined") return;

  const MODES = ["ai", "local", "online"];
  const MODE_LABELS = { ai: "Mode: vs AI", local: "Mode: 2-player", online: "Mode: Online" };

  const els = {
    tag: document.getElementById("tag"),
    record: document.getElementById("record"),
    status: document.getElementById("status"),
    top: document.getElementById("player-top"),
    bottom: document.getElementById("player-bottom"),
    nameTop: document.getElementById("name-top"),
    nameBottom: document.getElementById("name-bottom"),
    statTop: document.getElementById("stat-top"),
    statBottom: document.getElementById("stat-bottom"),
    handTop: document.getElementById("hand-top"),
    handBottom: document.getElementById("hand-bottom"),
    board: document.getElementById("board"),
    endTurn: document.getElementById("end-turn"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    log: document.getElementById("log"),
    hint: document.getElementById("hint"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
  };

  const overlay = GameKit.overlay({
    overlay: els.overlay,
    title: els.overlayTitle,
    body: els.overlayBody,
    button: els.overlayBtn,
  });

  const ui = {
    state: null,
    mode: "ai",
    busy: false,
    finished: false,
    pending: null,
    bottomSide: 0,
    tally: { wins: 0, draws: 0, losses: 0, streak: 0 },
    revision: 0,
    aiToken: 0,
    manualUnlocks: new Set(),
  };

  const online = {
    matchId: null,
    myId: null,
    myIndex: 0,
    revision: 0,
    stopPoll: null,
  };
  let publishChain = Promise.resolve();

  function activeSide() {
    return ui.state ? ui.state.turn : 0;
  }

  function localSide() {
    if (ui.mode === "online") return online.myIndex;
    return 0;
  }

  function faceUp(side) {
    if (ui.mode === "local") return true;
    return side === localSide();
  }

  function canAct(side) {
    if (!ui.state || ui.finished || ui.busy || ui.state.winner !== null) return false;
    if (ui.mode === "ai") return side === 0 && ui.state.turn === 0;
    if (ui.mode === "online") return side === online.myIndex && ui.state.turn === side;
    return ui.state.turn === side;
  }

  function displayName(side) {
    if (ui.mode === "ai") return side === 0 ? "You" : "Rival AI";
    if (ui.mode === "online") return side === online.myIndex ? "You" : "Opponent";
    return playerName(side);
  }

  function setStatus() {
    if (!ui.state) {
      els.status.textContent = ui.mode === "online" ? "Finding an opponent…" : "Preparing the duel…";
      return;
    }
    if (ui.finished || ui.state.winner !== null) {
      const winner = ui.state.winner;
      els.status.textContent = winner === "draw" ? "The duel ends in a draw." : `${displayName(winner)} wins the duel.`;
      return;
    }
    if (ui.mode === "ai" && ui.state.turn === 1) {
      els.status.textContent = "The rival wizard is scheming…";
      return;
    }
    if (ui.mode === "online" && ui.state.turn !== online.myIndex) {
      els.status.textContent = "Waiting for your opponent…";
      return;
    }
    const pl = ui.state.players[ui.state.turn];
    const side = ui.state.turn;
    els.status.textContent = `${displayName(side)} to move · ${pl.mana}/${pl.maxMana} mana`;
  }

  function statLine(player) {
    const shield = player.shield > 0 ? ` · <span class="shield">\uD83D\uDEE1 ${player.shield}</span>` : "";
    return `<b>${Math.max(0, player.hp)}/${player.maxHp}</b> hp · <b>${player.mana}/${player.maxMana}</b> mana${shield}`;
  }

  function buildCard(key, index, side) {
    const info = SPELL_INFO[key];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wd-card";
    button.dataset.cardIndex = String(index);
    button.dataset.side = String(side);
    const enabled = canAct(side);
    button.disabled = !enabled;
    if (ui.pending && ui.pending.side === side && ui.pending.index === index) button.classList.add("selected");
    button.title = info.text || "";
    button.innerHTML =
      `<span class="cost">${info.cost}</span>` +
      `<span class="emoji">${info.emoji}</span>` +
      `<span class="cname">${GameKit.escapeHtml(info.name.replace("Summon ", ""))}</span>`;
    return button;
  }

  function renderHand(side, container) {
    container.innerHTML = "";
    if (!ui.state) return;
    const player = ui.state.players[side];
    if (!faceUp(side)) {
      for (let i = 0; i < player.hand.length; i++) {
        const back = document.createElement("div");
        back.className = "wd-cardback";
        container.appendChild(back);
      }
      return;
    }
    player.hand.forEach((key, index) => {
      container.appendChild(buildCard(key, index, side));
    });
  }

  function minionValidTarget(side, lane) {
    if (!ui.pending) return false;
    const target = ui.pending.info.target;
    const active = ui.pending.side;
    if (target === "enemy") return side !== active && Boolean(Engine.getMinion(ui.state, side, lane));
    if (target === "enemy-minion") return side !== active && Boolean(Engine.getMinion(ui.state, side, lane));
    if (target === "ally-minion") return side === active && Boolean(Engine.getMinion(ui.state, side, lane));
    return false;
  }

  function renderMinion(minion, side) {
    const valid = minionValidTarget(side, minion.lane);
    const el = document.createElement("div");
    el.className = "wd-minion p" + side + (minion.frozen ? " frozen" : "") + (valid ? " targetable" : "");
    el.dataset.side = String(side);
    el.dataset.lane = String(minion.lane);
    if (valid) el.dataset.targetable = "1";
    el.innerHTML =
      `<div class="mname">${minion.emoji} ${GameKit.escapeHtml(minion.name)}</div>` +
      `<div class="mstats"><b>${minion.attack}</b>/<b>${minion.hp}</b>${minion.frozen ? " \u2744" : ""}</div>`;
    return el;
  }

  function renderBoard() {
    els.board.innerHTML = "";
    if (!ui.state) return;
    for (let lane = 0; lane < LANES; lane++) {
      const laneEl = document.createElement("div");
      laneEl.className = "wd-lane";
      const top = Engine.getMinion(ui.state, 1 - ui.bottomSide, lane);
      const bottom = Engine.getMinion(ui.state, ui.bottomSide, lane);
      laneEl.appendChild(slotFor(lane, 1 - ui.bottomSide, top));
      laneEl.appendChild(slotFor(lane, ui.bottomSide, bottom));
      els.board.appendChild(laneEl);
    }
  }

  function slotFor(lane, side, minion) {
    if (minion) return renderMinion(minion, side);
    const el = document.createElement("div");
    el.className = "wd-slot";
    el.dataset.lane = String(lane);
    const canSummon =
      ui.pending && ui.pending.info.target === "lane" && ui.pending.side === side && !Engine.getMinion(ui.state, side, lane);
    if (canSummon) {
      el.classList.add("targetable");
      el.dataset.targetable = "1";
      el.textContent = "summon";
    } else {
      el.textContent = "\u00b7";
    }
    return el;
  }

  function renderPlayers() {
    const topSide = 1 - ui.bottomSide;
    const bottomSide = ui.bottomSide;
    els.top.dataset.wizard = String(topSide);
    els.bottom.dataset.wizard = String(bottomSide);
    els.nameTop.textContent = displayName(topSide);
    els.nameBottom.textContent = displayName(bottomSide);
    if (ui.state) {
      els.statTop.innerHTML = statLine(ui.state.players[topSide]);
      els.statBottom.innerHTML = statLine(ui.state.players[bottomSide]);
    } else {
      els.statTop.textContent = "—";
      els.statBottom.textContent = "—";
    }
    els.top.classList.toggle("active", ui.state && ui.state.turn === topSide && ui.state.winner === null);
    els.bottom.classList.toggle("active", ui.state && ui.state.turn === bottomSide && ui.state.winner === null);
    const enemyTargetable = ui.pending && ui.pending.info.target === "enemy" && ui.pending.side !== topSide;
    const bottomTargetable = ui.pending && ui.pending.info.target === "enemy" && ui.pending.side !== bottomSide;
    els.top.classList.toggle("targetable", Boolean(enemyTargetable));
    els.bottom.classList.toggle("targetable", Boolean(bottomTargetable));
    renderHand(topSide, els.handTop);
    renderHand(bottomSide, els.handBottom);
  }

  function renderLog() {
    if (!ui.state) {
      els.log.textContent = "";
      return;
    }
    els.log.innerHTML = ui.state.log
      .map((line) => (line.startsWith("—") ? `<span class="turn">${GameKit.escapeHtml(line)}</span>` : GameKit.escapeHtml(line)))
      .join("\n");
    els.log.scrollTop = els.log.scrollHeight;
  }

  function render() {
    ui.bottomSide = localSide();
    renderPlayers();
    renderBoard();
    setStatus();
    renderLog();
    els.endTurn.disabled = !canEnd();
    els.endTurn.textContent = ui.mode === "online" && ui.state && ui.state.turn !== online.myIndex ? "Waiting…" : "End Turn";
  }

  function canEnd() {
    if (!ui.state || ui.finished || ui.busy || ui.state.winner !== null) return false;
    if (ui.mode === "ai") return ui.state.turn === 0;
    if (ui.mode === "online") return ui.state.turn === online.myIndex;
    return true;
  }

  function checkAndFinish() {
    if (ui.state && ui.state.winner !== null && !ui.finished) {
      finish(ui.state.winner);
      return true;
    }
    return false;
  }

  function advanceTurn() {
    ui.pending = null;
    Engine.endTurn(ui.state);
    render();
    if (ui.mode === "online") publishOnline();
    if (checkAndFinish()) return;
    if (ui.mode === "ai" && ui.state.turn === 1) runAi();
  }

  function onEndTurn() {
    if (!canEnd()) return;
    advanceTurn();
  }

  function onCardClick(event) {
    const card = event.target.closest(".wd-card");
    if (!card || card.disabled) return;
    const side = Number(card.dataset.side);
    const index = Number(card.dataset.cardIndex);
    if (!canAct(side)) return;
    const key = ui.state.players[side].hand[index];
    const info = SPELL_INFO[key];
    if (!info) return;
    if (ui.pending && ui.pending.side === side && ui.pending.index === index) {
      ui.pending = null;
      render();
      return;
    }
    if (info.target === "none") {
      doCast(side, index, { kind: "none" });
      return;
    }
    ui.pending = { side, index, key, info };
    render();
  }

  function onBoardClick(event) {
    const minionEl = event.target.closest(".wd-minion");
    if (minionEl && minionEl.dataset.targetable === "1") {
      doCast(ui.pending.side, ui.pending.index, {
        kind: "minion",
        player: Number(minionEl.dataset.side),
        lane: Number(minionEl.dataset.lane),
      });
      return;
    }
    const slotEl = event.target.closest(".wd-slot");
    if (slotEl && slotEl.dataset.targetable === "1" && ui.pending && ui.pending.info.target === "lane") {
      doCast(ui.pending.side, ui.pending.index, { kind: "lane", lane: Number(slotEl.dataset.lane) });
    }
  }

  function onWizardClick(side) {
    if (!ui.pending) return;
    if (ui.pending.info.target !== "enemy") return;
    if (side === ui.pending.side) return;
    doCast(ui.pending.side, ui.pending.index, { kind: "wizard", player: side });
  }

  function doCast(side, index, target) {
    if (!canAct(side)) return;
    const result = Engine.castSpell(ui.state, side, index, target);
    ui.pending = null;
    if (!result.ok) {
      els.status.textContent = result.error;
      render();
      return;
    }
    render();
    if (ui.mode === "online" && ui.state.winner !== null) publishOnline();
    checkAndFinish();
  }

  function runAi() {
    if (ui.mode !== "ai" || !ui.state || ui.state.winner !== null || ui.state.turn !== 1) return;
    ui.busy = true;
    render();
    const token = ++ui.aiToken;
    const step = () => {
      if (token !== ui.aiToken) return;
      if (!ui.state || ui.state.winner !== null || ui.state.turn !== 1) {
        ui.busy = false;
        render();
        return;
      }
      const action = Engine.aiChooseAction(ui.state, 1);
      if (action.type === "end") {
        ui.busy = false;
        ui.pending = null;
        Engine.endTurn(ui.state);
        render();
        checkAndFinish();
        return;
      }
      const result = Engine.castSpell(ui.state, 1, action.index, action.target);
      if (!result.ok) {
        ui.busy = false;
        Engine.endTurn(ui.state);
        render();
        checkAndFinish();
        return;
      }
      render();
      if (ui.state.winner !== null) {
        ui.busy = false;
        render();
        checkAndFinish();
        return;
      }
      setTimeout(step, 420);
    };
    setTimeout(step, 480);
  }

  function finish(winner) {
    if (ui.finished) return;
    ui.finished = true;
    cancelOnlinePoll();
    const side = localSide();
    let result;
    if (winner === "draw") result = "draw";
    else if (ui.mode === "local") result = winner === 0 ? "win" : "loss";
    else result = winner === side ? "win" : "loss";

    if (result === "win") {
      ui.tally.wins += 1;
      ui.tally.streak += 1;
    } else if (result === "draw") {
      ui.tally.draws += 1;
      ui.tally.streak = 0;
    } else {
      ui.tally.losses += 1;
      ui.tally.streak = 0;
    }
    ui.manualUnlocks.add("first-duel");

    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    const title = result === "win" ? "Victory!" : result === "draw" ? "Draw" : "Defeat";
    const body =
      result === "win"
        ? "Your rival's tower falls. The duel is yours."
        : result === "draw"
          ? "Both wizards stand spent — a draw."
          : "You are out of health. Better luck next duel.";
    overlay.show(title, body, "New duel", newGame);
    render();

    persistTally();

    const run = {
      score,
      meta: {
        result,
        streak: ui.tally.streak,
        mode: ui.mode,
        turns: ui.state.turnCount,
        hpLost: ui.state.stats.hpLost[side],
        damageDealt: ui.state.stats.damageDealt[side],
        maxMana: ui.state.players[side].maxMana,
      },
      unlock: Array.from(ui.manualUnlocks),
    };
    if (ui.mode === "online" && online.matchId) {
      GameKit.finish(online.matchId, { result }, run);
    } else {
      Gamebase.endRun(run).catch((err) => console.warn("[wizard-duel] endRun failed", err));
    }
  }

  // ── Online ────────────────────────────────────────────────────────────────

  function cancelOnlinePoll() {
    if (online.stopPoll) {
      online.stopPoll();
      online.stopPoll = null;
    }
  }

  async function startOnline() {
    cancelOnlinePoll();
    ui.aiToken += 1;
    ui.busy = true;
    ui.finished = false;
    ui.pending = null;
    ui.state = null;
    online.matchId = null;
    online.revision = 0;
    publishChain = Promise.resolve();
    overlay.hide();
    render();
    try {
      const match = await GameKit.online.findMatch(120000);
      if (ui.mode !== "online") return;
      if (!match) {
        ui.busy = false;
        els.status.textContent = "No opponent found — try again.";
        return;
      }
      online.matchId = match.id;
      online.myId = GameKit.playerId();
      online.myIndex = match.players[0] && match.players[0].player_id === online.myId ? 0 : 1;
      online.revision = match.revision || 0;
      ui.state = Engine.createGame(Engine.hashSeed(match.id));
      ui.busy = false;
      render();
      if (online.myIndex === 0) {
        await publishOnline();
      }
      online.stopPoll = GameKit.online.poll(online.matchId, onRemote, 1500);
    } catch (error) {
      ui.busy = false;
      els.status.textContent = "Matchmaking failed: " + (error && error.message ? error.message : error);
      render();
    }
  }

  function onRemote(match) {
    if (!match) return;
    if ((match.revision || 0) <= online.revision) return;
    online.revision = match.revision || 0;
    const gameState = match.game_state;
    if (gameState && Array.isArray(gameState.players) && gameState.players.length === 2) {
      const wasFinished = ui.finished;
      ui.state = gameState;
      render();
      if (!wasFinished) checkAndFinish();
    }
  }

  function publishOnline() {
    if (ui.mode !== "online" || !online.matchId || !ui.state) return publishChain;
    const snapshot = JSON.parse(JSON.stringify(ui.state));
    const matchId = online.matchId;
    publishChain = publishChain.then(async () => {
      try {
        const saved = await GameKit.online.publish(matchId, snapshot, online.revision);
        if (saved && typeof saved.revision === "number") online.revision = saved.revision;
      } catch (error) {
        if (error && error.status === 409) {
          try {
            const match = await Gamebase.match(online.matchId);
            if (match) {
              online.revision = match.revision || 0;
              if (match.game_state && Array.isArray(match.game_state.players)) {
                ui.state = match.game_state;
                render();
                checkAndFinish();
              }
            }
          } catch (inner) {
            /* ignore */
          }
        } else {
          console.warn("[wizard-duel] publish failed", error);
        }
      }
    });
    return publishChain;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  function randomSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  function newGame() {
    cancelOnlinePoll();
    ui.aiToken += 1;
    ui.finished = false;
    ui.busy = false;
    ui.pending = null;
    ui.manualUnlocks = new Set();
    overlay.hide();
    if (ui.mode === "online") {
      startOnline();
      return;
    }
    ui.state = Engine.createGame(randomSeed());
    render();
    if (ui.mode === "ai" && ui.state.turn === 1) runAi();
  }

  function setMode(mode) {
    ui.mode = mode;
    GameKit.localStore.set("wizard-duel.mode", mode);
    newGame();
  }

  function refreshRecord() {
    els.record.textContent = `W${ui.tally.wins} · D${ui.tally.draws} · L${ui.tally.losses}`;
  }

  function persistTally() {
    refreshRecord();
    if (!root.Gamebase || !Gamebase.player) return;
    Gamebase.saveState({ tally: ui.tally }, { revision: ui.revision })
      .then((saved) => {
        if (saved && typeof saved.revision === "number") ui.revision = saved.revision;
      })
      .catch((err) => console.warn("[wizard-duel] saveState failed", err));
  }

  function onPlayer(player) {
    if (!player) return;
    els.tag.textContent = player.handle;
    Gamebase.loadState()
      .then((saved) => {
        if (saved && saved.state && saved.state.tally) {
          ui.tally = Object.assign(ui.tally, saved.state.tally);
          ui.revision = saved.revision || 0;
          refreshRecord();
        }
      })
      .catch((err) => console.warn("[wizard-duel] loadState failed", err));
    Gamebase.myBest()
      .then((best) => {
        if (best) els.tag.textContent = player.handle + " · best " + best.best;
      })
      .catch(() => {});
  }

  els.board.addEventListener("click", onBoardClick);
  els.handTop.addEventListener("click", onCardClick);
  els.handBottom.addEventListener("click", onCardClick);
  els.top.addEventListener("click", () => onWizardClick(Number(els.top.dataset.wizard)));
  els.bottom.addEventListener("click", () => onWizardClick(Number(els.bottom.dataset.wizard)));
  els.endTurn.addEventListener("click", onEndTurn);
  els.newGame.addEventListener("click", newGame);
  GameKit.modeCycle(els.modeBtn, MODES, MODE_LABELS, () => ui.mode, setMode);

  const storedMode = GameKit.localStore.get("wizard-duel.mode", "ai");
  ui.mode = MODES.includes(storedMode) ? storedMode : "ai";
  els.modeBtn.textContent = MODE_LABELS[ui.mode];
  refreshRecord();
  newGame();

  GameKit.ready({ tagElement: els.tag, onPlayer }).catch(() => {
    els.tag.textContent = "guest";
  });

  root.WizardDuel = {
    get state() {
      return ui.state;
    },
    get mode() {
      return ui.mode;
    },
    get online() {
      return { matchId: online.matchId, myIndex: online.myIndex, revision: online.revision };
    },
    engine: Engine,
    newGame,
    setMode,
    endTurn: onEndTurn,
    doCast,
    render,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
