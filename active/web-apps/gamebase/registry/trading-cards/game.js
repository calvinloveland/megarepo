/*
 * Trading Cards — Gamebase
 *
 * A faithful, client-only port of active/games/super_ultimate_trading_card_game.
 * The Python engine is a two-track lane battler: each round every player gains
 * card points and draws cards, plays up to two units onto the FAST or SLOW
 * track, then units advance, engage on contact, and deal damage to the enemy
 * base. A match ends when a base reaches 0 HP, or after the round limit when
 * the player with the higher base HP wins (ties draw).
 *
 * Combat is deterministic: units trade damage simultaneously, keywords
 * (Defender, Ranged, Healing, Charge, Flying) and passives (fortify, berserk,
 * income_boost, heal_base, heal_self) all resolve exactly as in the source, and
 * a small declarative ability system covers the source's scripted abilities.
 *
 * The pure engine is exposed as `TradingCardsEngine` / `module.exports` for
 * headless node use.
 */
(function (root) {
  "use strict";

  // ── Engine ────────────────────────────────────────────────────────────────

  const TRACK_LENGTH = 10;
  const FAST_STEP = 5;
  const SLOW_STEP = 2;
  const DRAW_COUNT = 3;
  const PLAYS_PER_ROUND = 2;
  const STARTING_CP = 0;
  const MAX_ROUNDS = 18;

  const BASE_DEF = { name: "Prototype Bastion", short: "Bastion", emoji: "\uD83C\uDFF0", hp: 24, attack: 2, income: 2, passive: { type: "none", magnitude: 0 } };

  // A real card set drawn from the source's starter pool plus its two
  // artifact cards and a few faithful additions.
  const CARD_POOL = {
    brick_wall: { name: "Brick Wall Beetle", short: "Beetle", emoji: "\uD83E\uDEB2", hp: 8, attack: 1, cpc: 3, speed: 1, keywords: ["Defender"], passive: { type: "fortify", magnitude: 1 }, text: "Defender. Takes 1 less damage." },
    vine_cleric: { name: "Vine Cleric", short: "Cleric", emoji: "\uD83C\uDF3F", hp: 4, attack: 1, cpc: 2, speed: 1, keywords: ["Healing"], passive: { type: "heal_base", magnitude: 1 }, text: "Heals your base 1 each round." },
    gold_sprite: { name: "Gold Sprite", short: "Sprite", emoji: "\u2728", hp: 3, attack: 1, cpc: 2, speed: 1, keywords: [], passive: { type: "income_boost", magnitude: 1 }, text: "+1 card point each round." },
    track_lancer: { name: "Track Lancer", short: "Lancer", emoji: "\uD83D\uDDE1\uFE0F", hp: 4, attack: 3, cpc: 2, speed: 1, keywords: [], text: "Reliable attacker." },
    track_archer: { name: "Track Archer", short: "Archer", emoji: "\uD83C\uDFF9", hp: 3, attack: 2, cpc: 3, speed: 1, keywords: ["Ranged"], text: "Ranged: supports the frontline." },
    sky_hawk: { name: "Sky Hawk", short: "Hawk", emoji: "\uD83E\uDD85", hp: 3, attack: 3, cpc: 4, speed: 2, keywords: ["Flying"], text: "Flying: bypasses grounded blockers." },
    phoenix: { name: "Sky Phoenix Sniper", short: "Phoenix", emoji: "\uD83D\uDD25", hp: 4, attack: 5, cpc: 5, speed: 2, keywords: ["Flying"], ability: { event: "combat", addAttack: 1 }, text: "Flying. +1 attack in combat." },
    medic: { name: "Clockwork Field Medic", short: "Medic", emoji: "\u2699\uFE0F", hp: 5, attack: 3, cpc: 4, speed: 1, keywords: ["Healing"], ability: { event: "round_start", healAlly: 2 }, text: "Heals a wounded ally 2 each round." },
    charger: { name: "Charge Runner", short: "Runner", emoji: "\u26A1", hp: 3, attack: 4, cpc: 3, speed: 1, keywords: ["Charge"], text: "Charge: attacks the round it is played." },
    mirror_shield: { name: "Mirror Shield", short: "Mirror", emoji: "\uD83D\uDEE1\uFE0F", hp: 6, attack: 1, cpc: 3, speed: 1, keywords: ["Defender"], ability: { event: "combat", reduceIncoming: 1, reflect: 2 }, text: "Defender. -1 damage, reflects 2." },
    siege_beast: { name: "Siege Beast", short: "Siege", emoji: "\uD83D\uDC17", hp: 5, attack: 4, cpc: 4, speed: 1, keywords: [], ability: { event: "attack_base", addBaseDamage: 2 }, text: "+2 base damage when attacking a base." },
    forest_guardian: { name: "Forest Guardian", short: "Guardian", emoji: "\uD83C\uDF33", hp: 7, attack: 2, cpc: 4, speed: 1, keywords: ["Defender"], passive: { type: "fortify", magnitude: 1 }, text: "Defender. Fortified." },
  };

  for (const key of Object.keys(CARD_POOL)) {
    const def = CARD_POOL[key];
    if (!def.keywords) def.keywords = [];
    if (!def.passive) def.passive = { type: "none", magnitude: 0 };
  }

  const DECK_RECIPE = [
    "brick_wall", "brick_wall", "vine_cleric", "gold_sprite", "track_lancer",
    "track_lancer", "track_archer", "sky_hawk", "phoenix", "medic", "charger",
    "mirror_shield", "siege_beast", "forest_guardian",
  ];

  function gpos(unit) {
    return unit.owner === 0 ? unit.position : TRACK_LENGTH - unit.position;
  }

  function setGpos(unit, value) {
    const clamped = Math.max(0, Math.min(TRACK_LENGTH, value));
    unit.position = unit.owner === 0 ? clamped : TRACK_LENGTH - clamped;
  }

  function trackStep(track) {
    return track === "fast" ? FAST_STEP : SLOW_STEP;
  }

  function rngNext(state) {
    let a = state.rng.a | 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    state.rng.a = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(list, state) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rngNext(state) * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function addLog(state, message) {
    state.log.push(message);
    if (state.log.length > 120) state.log.splice(0, state.log.length - 120);
  }

  function makePlayer(index) {
    return {
      id: index,
      name: index === 0 ? "You" : "Rival",
      baseHp: BASE_DEF.hp,
      baseMaxHp: BASE_DEF.hp,
      cp: STARTING_CP,
      deck: DECK_RECIPE.slice(),
      hand: [],
      discard: [],
      base: Object.assign({}, BASE_DEF),
    };
  }

  function createMatch(seed, difficulty) {
    const state = {
      seed: seed >>> 0,
      rng: { a: (seed >>> 0) || 1 },
      difficulty: difficulty || "normal",
      round: 0,
      phase: "playing",
      winner: null,
      reason: "",
      board: [],
      nextId: 1,
      log: [],
      playsLeft: [PLAYS_PER_ROUND, PLAYS_PER_ROUND],
      players: [makePlayer(0), makePlayer(1)],
    };
    shuffle(state.players[0].deck, state);
    shuffle(state.players[1].deck, state);
    startRound(state);
    return state;
  }

  function drawCards(state, player, count) {
    const pl = state.players[player];
    for (let i = 0; i < count; i++) {
      if (pl.deck.length === 0) {
        if (pl.discard.length === 0) return;
        pl.deck = pl.discard.slice().reverse();
        pl.discard = [];
      }
      pl.hand.push(pl.deck.shift());
    }
  }

  function healBestAlly(state, player, amount, sourceId) {
    const allies = state.board.filter((unit) => unit.owner === player && unit.hp > 0 && unit.hp < unit.maxHp && unit.id !== sourceId);
    if (allies.length) {
      allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      const target = allies[0];
      target.hp = Math.min(target.maxHp, target.hp + amount);
      addLog(state, `A medic heals ${CARD_POOL[target.key].name} for ${amount}.`);
      return;
    }
    const pl = state.players[player];
    if (pl.baseHp < pl.baseMaxHp) {
      pl.baseHp = Math.min(pl.baseMaxHp, pl.baseHp + amount);
      addLog(state, `A medic heals ${pl.name}'s base for ${amount}.`);
    }
  }

  function applyIncomeAndHealing(state) {
    for (const player of [0, 1]) {
      const pl = state.players[player];
      let income = pl.base.income;
      if (pl.base.passive.type === "income_boost") income += Math.max(1, pl.base.passive.magnitude);
      if (pl.base.passive.type === "heal_base") pl.baseHp = Math.min(pl.baseMaxHp, pl.baseHp + Math.max(1, pl.base.passive.magnitude));
      for (const unit of state.board.filter((item) => item.owner === player && item.hp > 0)) {
        const def = CARD_POOL[unit.key];
        if (def.passive.type === "income_boost") income += Math.max(1, def.passive.magnitude);
        if (def.passive.type === "heal_base") pl.baseHp = Math.min(pl.baseMaxHp, pl.baseHp + Math.max(1, def.passive.magnitude));
        if (def.passive.type === "heal_self") unit.hp = Math.min(unit.maxHp, unit.hp + Math.max(1, def.passive.magnitude));
        if (def.ability && def.ability.event === "round_start" && def.ability.healAlly) {
          healBestAlly(state, player, def.ability.healAlly, unit.id);
        }
      }
      pl.cp += income;
      addLog(state, `${pl.name} gains ${income} card points.`);
    }
  }

  function startRound(state) {
    state.round += 1;
    state.playsLeft = [PLAYS_PER_ROUND, PLAYS_PER_ROUND];
    addLog(state, `=== Round ${state.round} ===`);
    applyIncomeAndHealing(state);
    drawCards(state, 0, DRAW_COUNT);
    drawCards(state, 1, DRAW_COUNT);
    state.aiPlays = chooseAiPlays(state, 1, state.difficulty);
  }

  function playCard(state, player, key, track, stationary) {
    if (state.phase !== "playing" || state.winner !== null) return { ok: false, error: "The match is over." };
    if (state.playsLeft[player] <= 0) return { ok: false, error: "No plays left this round." };
    const pl = state.players[player];
    const def = CARD_POOL[key];
    if (!def) return { ok: false, error: "Unknown card." };
    const index = pl.hand.indexOf(key);
    if (index < 0) return { ok: false, error: "That card is not in hand." };
    if (def.cpc > pl.cp) return { ok: false, error: "Not enough card points." };
    pl.hand.splice(index, 1);
    pl.cp -= def.cpc;
    state.playsLeft[player] -= 1;
    const isDefender = def.keywords.includes("Defender");
    const unit = {
      id: state.nextId++,
      key,
      owner: player,
      track: track === "slow" ? "slow" : "fast",
      position: 0,
      stationary: Boolean(stationary && isDefender),
      enteredRound: state.round,
      hp: def.hp,
      maxHp: def.hp,
      attack: def.attack,
      engagedWith: null,
    };
    state.board.push(unit);
    addLog(state, `${pl.name} plays ${def.emoji} ${def.name} ${unit.stationary ? "as a defender" : "on the " + unit.track + " track"}.`);
    return { ok: true, unit };
  }

  function enemiesInPath(state, mover, target) {
    const enemyOwner = 1 - mover.owner;
    const enemies = state.board.filter(
      (unit) => unit.owner === enemyOwner && unit.track === mover.track && unit.hp > 0 && unit.engagedWith === null
    );
    if (!enemies.length) return [];
    const mp = gpos(mover);
    let candidates;
    if (mover.owner === 0) candidates = enemies.filter((unit) => mp < gpos(unit) && gpos(unit) <= target);
    else candidates = enemies.filter((unit) => target <= gpos(unit) && gpos(unit) < mp);
    candidates.sort((a, b) => gpos(a) - gpos(b));
    if (mover.owner !== 0) candidates.reverse();
    return candidates;
  }

  function canBlock(attacker, blocker) {
    const attackDef = CARD_POOL[attacker.key];
    const blockDef = CARD_POOL[blocker.key];
    if (attackDef.keywords.includes("Flying")) {
      return (
        blockDef.keywords.includes("Flying") ||
        blockDef.keywords.includes("Intercept") ||
        blockDef.passive.type === "intercept_flying"
      );
    }
    return true;
  }

  function moveCards(state) {
    const ordered = state.board.slice().sort((a, b) => {
      if (a.track !== b.track) return a.track === "fast" ? -1 : 1;
      return gpos(a) - gpos(b);
    });
    for (const unit of ordered) {
      if (unit.hp <= 0 || unit.stationary || unit.engagedWith !== null) continue;
      const def = CARD_POOL[unit.key];
      const step = trackStep(unit.track) * Math.max(1, def.speed);
      const current = gpos(unit);
      const target = unit.owner === 0 ? Math.min(TRACK_LENGTH, current + step) : Math.max(0, current - step);
      const enemy = enemiesInPath(state, unit, target).find((candidate) => canBlock(unit, candidate));
      if (enemy) {
        setGpos(unit, gpos(enemy));
        unit.engagedWith = enemy.id;
        enemy.engagedWith = unit.id;
        addLog(state, `${def.name} engages ${CARD_POOL[enemy.key].name} on the ${unit.track} track.`);
        continue;
      }
      setGpos(unit, target);
    }
  }

  function canAttack(unit, round) {
    if (unit.hp <= 0) return false;
    return unit.enteredRound < round || CARD_POOL[unit.key].keywords.includes("Charge");
  }

  function effectiveAttack(unit) {
    let attack = unit.attack;
    const def = CARD_POOL[unit.key];
    if (def.passive.type === "berserk" && unit.hp <= Math.max(1, Math.floor(def.hp / 2))) {
      attack += Math.max(1, def.passive.magnitude);
    }
    return attack;
  }

  function abilityRuntime(unit, event) {
    const runtime = { attackBonus: 0, baseDamageBonus: 0, incomingReduction: 0, reflect: 0 };
    const ability = CARD_POOL[unit.key].ability;
    if (!ability || ability.event !== event) return runtime;
    if (event === "combat") {
      if (ability.addAttack) runtime.attackBonus += ability.addAttack;
      if (ability.reduceIncoming) runtime.incomingReduction += ability.reduceIncoming;
      if (ability.reflect) runtime.reflect += ability.reflect;
    }
    if (event === "attack_base" && ability.addBaseDamage) runtime.baseDamageBonus += ability.addBaseDamage;
    return runtime;
  }

  function mitigatedDamage(target, raw, scriptedReduction) {
    let damage = raw;
    const def = CARD_POOL[target.key];
    if (def.passive.type === "fortify") damage -= Math.max(1, def.passive.magnitude);
    damage -= scriptedReduction || 0;
    return Math.max(0, damage);
  }

  function rangedSupporters(state, frontline) {
    const fg = gpos(frontline);
    return state.board.filter((unit) => {
      if (unit.hp <= 0 || unit.owner !== frontline.owner || unit.track !== frontline.track) return false;
      if (unit.id === frontline.id || unit.engagedWith !== null) return false;
      if (!CARD_POOL[unit.key].keywords.includes("Ranged")) return false;
      return frontline.owner === 0 ? gpos(unit) < fg : gpos(unit) > fg;
    });
  }

  function resolveEngagements(state, round) {
    const processed = new Set();
    for (const unit of state.board.slice()) {
      if (unit.hp <= 0 || unit.engagedWith === null || processed.has(unit.id)) continue;
      const enemy = state.board.find((item) => item.id === unit.engagedWith);
      if (!enemy || enemy.hp <= 0) {
        unit.engagedWith = null;
        continue;
      }
      processed.add(unit.id);
      processed.add(enemy.id);
      let leftDamage = 0;
      let rightDamage = 0;
      let unitRuntime = { attackBonus: 0, incomingReduction: 0, reflect: 0 };
      let enemyRuntime = { attackBonus: 0, incomingReduction: 0, reflect: 0 };
      if (canAttack(unit, round)) {
        unitRuntime = abilityRuntime(unit, "combat");
        leftDamage += effectiveAttack(unit) + unitRuntime.attackBonus;
      }
      if (canAttack(enemy, round)) {
        enemyRuntime = abilityRuntime(enemy, "combat");
        rightDamage += effectiveAttack(enemy) + enemyRuntime.attackBonus;
      }
      for (const supporter of rangedSupporters(state, unit)) {
        if (canAttack(supporter, round)) leftDamage += effectiveAttack(supporter);
      }
      for (const supporter of rangedSupporters(state, enemy)) {
        if (canAttack(supporter, round)) rightDamage += effectiveAttack(supporter);
      }
      const enemyTaken = mitigatedDamage(enemy, leftDamage, enemyRuntime.incomingReduction);
      const unitTaken = mitigatedDamage(unit, rightDamage, unitRuntime.incomingReduction);
      enemy.hp -= enemyTaken;
      unit.hp -= unitTaken;
      if (unitRuntime.reflect > 0 && unitTaken > 0 && enemy.hp > 0) enemy.hp -= unitRuntime.reflect;
      if (enemyRuntime.reflect > 0 && enemyTaken > 0 && unit.hp > 0) unit.hp -= enemyRuntime.reflect;
      addLog(
        state,
        `${CARD_POOL[unit.key].name} and ${CARD_POOL[enemy.key].name} trade ${leftDamage}/${rightDamage} damage.`
      );
    }
  }

  function attackersAtBase(state, defenderId, track) {
    return state.board.filter((unit) => {
      if (unit.hp <= 0 || unit.track !== track || unit.engagedWith !== null) return false;
      if (defenderId === 1 && unit.owner === 0 && gpos(unit) >= TRACK_LENGTH) return true;
      if (defenderId === 0 && unit.owner === 1 && gpos(unit) <= 0) return true;
      return false;
    });
  }

  function resolveBaseAttacks(state, round) {
    for (const defenderId of [0, 1]) {
      for (const track of ["fast", "slow"]) {
        const attackers = attackersAtBase(state, defenderId, track).filter((unit) => canAttack(unit, round));
        if (!attackers.length) continue;
        const target = attackers.slice().sort((a, b) => effectiveAttack(b) - effectiveAttack(a))[0];
        let total = 0;
        for (const attacker of attackers) {
          const runtime = abilityRuntime(attacker, "attack_base");
          total += effectiveAttack(attacker) + runtime.attackBonus + runtime.baseDamageBonus;
        }
        const defender = state.players[defenderId];
        defender.baseHp -= total;
        const counter = defender.base.attack;
        target.hp -= counter;
        addLog(state, `${defender.name}'s base takes ${total} damage on the ${track} track and counters for ${counter}.`);
      }
    }
  }

  function cleanup(state) {
    const deadIds = new Set(state.board.filter((unit) => unit.hp <= 0).map((unit) => unit.id));
    if (!deadIds.size) return;
    for (const unit of state.board) {
      if (unit.engagedWith !== null && deadIds.has(unit.engagedWith)) unit.engagedWith = null;
    }
    for (const unit of state.board) {
      if (deadIds.has(unit.id)) addLog(state, `${CARD_POOL[unit.key].name} is destroyed.`);
    }
    state.board = state.board.filter((unit) => unit.hp > 0);
  }

  function checkWinner(state) {
    const p0 = state.players[0].baseHp <= 0;
    const p1 = state.players[1].baseHp <= 0;
    if (p0 && p1) {
      state.winner = "draw";
      state.reason = "both bases fell";
    } else if (p0) {
      state.winner = 1;
      state.reason = "your base fell";
    } else if (p1) {
      state.winner = 0;
      state.reason = "rival base fell";
    } else if (state.round >= MAX_ROUNDS) {
      const diff = state.players[0].baseHp - state.players[1].baseHp;
      state.winner = diff > 0 ? 0 : diff < 0 ? 1 : "draw";
      state.reason = "round limit";
    }
    if (state.winner !== null) state.phase = "over";
    return state.winner !== null;
  }

  function discardHand(state, player) {
    const pl = state.players[player];
    pl.discard.push.apply(pl.discard, pl.hand);
    pl.hand = [];
  }

  function scoreCard(state, player, key) {
    const def = CARD_POOL[key];
    const me = state.players[player];
    const foe = state.players[1 - player];
    let score = def.attack * 2 + def.hp + def.speed + def.passive.magnitude * 3 - def.cpc * 0.8;
    if (def.keywords.includes("Flying") || def.keywords.includes("Charge")) score += 3;
    if (def.keywords.includes("Ranged")) score += 2;
    if (def.keywords.includes("Defender")) score += 1;
    if (def.ability) score += 2;
    if (me.baseHp < 12 && def.keywords.includes("Defender")) score += 4;
    if (foe.baseHp < 12 && (def.keywords.includes("Flying") || def.keywords.includes("Charge"))) score += 4;
    return score;
  }

  function mostThreatenedTrack(state, player) {
    const scores = { fast: 0, slow: 0 };
    for (const unit of state.board.filter((item) => item.owner === 1 - player && item.hp > 0)) {
      const threat = player === 0 ? TRACK_LENGTH - gpos(unit) : gpos(unit);
      scores[unit.track] += Math.max(0.5, threat);
    }
    return scores.fast >= scores.slow ? "fast" : "slow";
  }

  function chooseTrack(state, player, def, stationary) {
    if (stationary) return mostThreatenedTrack(state, player);
    if (def.keywords.includes("Flying") || def.keywords.includes("Charge")) return "fast";
    if (def.keywords.includes("Ranged")) return "slow";
    return "fast";
  }

  function chooseAiPlays(state, player, difficulty) {
    const me = state.players[player];
    const foe = state.players[1 - player];
    if (state.playsLeft[player] <= 0) return [];
    const playable = me.hand.filter((key) => CARD_POOL[key].cpc <= me.cp);
    if (!playable.length) return [];
    if (difficulty === "easy") {
      const key = playable[Math.floor(rngNext(state) * playable.length)];
      const def = CARD_POOL[key];
      const stationary = def.keywords.includes("Defender") && rngNext(state) < 0.5;
      return [{ key, track: rngNext(state) < 0.5 ? "fast" : "slow", stationary }];
    }
    const scored = playable.map((key) => ({ key, score: scoreCard(state, player, key) })).sort((a, b) => b.score - a.score);
    const plays = [];
    let cp = me.cp;
    for (const item of scored) {
      if (plays.length >= PLAYS_PER_ROUND) break;
      const def = CARD_POOL[item.key];
      if (def.cpc > cp) continue;
      const stationary = def.keywords.includes("Defender") && (me.baseHp <= foe.baseHp || difficulty === "hard");
      plays.push({ key: item.key, track: chooseTrack(state, player, def, stationary), stationary });
      cp -= def.cpc;
    }
    return plays;
  }

  function resolveRound(state, difficulty, bothAI) {
    if (state.phase !== "playing") return;
    if (bothAI) {
      for (const play of chooseAiPlays(state, 0, difficulty)) playCard(state, 0, play.key, play.track, play.stationary);
    }
    const aiPlays = state.aiPlays || chooseAiPlays(state, 1, difficulty);
    for (const play of aiPlays) playCard(state, 1, play.key, play.track, play.stationary);
    discardHand(state, 0);
    discardHand(state, 1);
    addLog(state, "-- Resolution --");
    moveCards(state);
    resolveEngagements(state, state.round);
    resolveBaseAttacks(state, state.round);
    cleanup(state);
    if (!checkWinner(state)) startRound(state);
  }

  function simulate(seed, difficulty) {
    const state = createMatch(seed, difficulty);
    let guard = 0;
    while (state.phase === "playing" && guard < MAX_ROUNDS + 2) {
      resolveRound(state, difficulty || "normal", true);
      guard += 1;
    }
    return state;
  }

  const Engine = {
    TRACK_LENGTH,
    MAX_ROUNDS,
    BASE_DEF,
    CARD_POOL,
    DECK_RECIPE,
    gpos,
    createMatch,
    playCard,
    resolveRound,
    chooseAiPlays,
    simulate,
    checkWinner,
  };
  root.TradingCardsEngine = Engine;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;

  // ── UI ────────────────────────────────────────────────────────────────────

  if (typeof document === "undefined") return;

  const MODES = ["easy", "normal", "hard"];
  const MODE_LABELS = { easy: "AI: Easy", normal: "AI: Normal", hard: "AI: Hard" };

  const els = {
    tag: document.getElementById("tag"),
    record: document.getElementById("record"),
    status: document.getElementById("status"),
    hp0: document.getElementById("hp0"),
    hp1: document.getElementById("hp1"),
    hp0text: document.getElementById("hp0-text"),
    hp1text: document.getElementById("hp1-text"),
    trackFast: document.getElementById("track-fast"),
    trackSlow: document.getElementById("track-slow"),
    round: document.getElementById("round"),
    cp: document.getElementById("cp"),
    plays: document.getElementById("plays"),
    hand: document.getElementById("hand"),
    playbar: document.getElementById("playbar"),
    selectedName: document.getElementById("selected-name"),
    defend: document.getElementById("defend"),
    cancelPlay: document.getElementById("cancel-play"),
    resolve: document.getElementById("resolve"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    log: document.getElementById("log"),
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
    difficulty: "normal",
    selected: null,
    finished: false,
    tally: { wins: 0, losses: 0, draws: 0, streak: 0 },
    revision: 0,
    manualUnlocks: new Set(),
  };

  function renderBase() {
    if (!ui.state) return;
    const p0 = ui.state.players[0];
    const p1 = ui.state.players[1];
    els.hp0.style.width = Math.max(0, (p0.baseHp / p0.baseMaxHp) * 100) + "%";
    els.hp1.style.width = Math.max(0, (p1.baseHp / p1.baseMaxHp) * 100) + "%";
    els.hp0text.textContent = Math.max(0, p0.baseHp) + "/" + p0.baseMaxHp;
    els.hp1text.textContent = Math.max(0, p1.baseHp) + "/" + p1.baseMaxHp;
  }

  function renderTrack(container, track) {
    container.innerHTML = "";
    if (!ui.state) return;
    for (const unit of ui.state.board.filter((item) => item.track === track && item.hp > 0)) {
      const def = CARD_POOL[unit.key];
      const el = document.createElement("div");
      el.className = "tc-unit p" + unit.owner + (unit.engagedWith !== null ? " engaged" : "");
      el.style.left = (Engine.gpos(unit) / TRACK_LENGTH) * 100 + "%";
      el.dataset.instance = String(unit.id);
      el.dataset.owner = String(unit.owner);
      el.dataset.track = track;
      el.title = def.name + " — " + (def.text || "");
      el.innerHTML =
        `<span class="u-name">${def.emoji} ${GameKit.escapeHtml(def.short)}</span>` +
        `<span class="u-stats"><b>${unit.attack}</b>/<b>${Math.max(0, unit.hp)}</b></span>`;
      container.appendChild(el);
    }
  }

  function renderHand() {
    els.hand.innerHTML = "";
    if (!ui.state) return;
    const me = ui.state.players[0];
    const playable = ui.state.phase === "playing" && ui.state.playsLeft[0] > 0 && ui.state.winner === null;
    for (const key of me.hand) {
      const def = CARD_POOL[key];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tc-card" + (ui.selected === key ? " selected" : "");
      button.dataset.card = key;
      button.disabled = !playable || def.cpc > me.cp;
      button.title = def.text || "";
      const keywords = def.keywords.concat(def.passive.type !== "none" ? [def.passive.type.replace(/_/g, " ")] : []);
      button.innerHTML =
        `<div class="row"><span class="name">${GameKit.escapeHtml(def.name)}</span><span class="cost">${def.cpc}</span></div>` +
        `<div class="row"><span class="stats">${def.attack}<span class="hp">/${def.hp}</span></span><span>${def.emoji}</span></div>` +
        (keywords.length ? `<span class="kw">${GameKit.escapeHtml(keywords.join(" \u00b7 "))}</span>` : "") +
        (def.text ? `<span class="txt">${GameKit.escapeHtml(def.text)}</span>` : "");
      els.hand.appendChild(button);
    }
  }

  function renderPlaybar() {
    if (ui.selected && CARD_POOL[ui.selected]) {
      els.playbar.hidden = false;
      els.selectedName.textContent = CARD_POOL[ui.selected].name;
      els.defend.hidden = !CARD_POOL[ui.selected].keywords.includes("Defender");
    } else {
      els.playbar.hidden = true;
    }
  }

  function renderLog() {
    if (!ui.state) {
      els.log.textContent = "";
      return;
    }
    els.log.innerHTML = ui.state.log
      .map((line) => (line.indexOf("===") === 0 || line.indexOf("--") === 0 ? `<span class="round">${GameKit.escapeHtml(line)}</span>` : GameKit.escapeHtml(line)))
      .join("\n");
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setStatus() {
    if (!ui.state) {
      els.status.textContent = "Shuffling decks…";
      return;
    }
    if (ui.state.phase === "over") {
      const winner = ui.state.winner;
      els.status.textContent =
        winner === "draw" ? "The match ends in a draw." : winner === 0 ? "You win the match!" : "The rival wins the match.";
      return;
    }
    const me = ui.state.players[0];
    const playable = me.hand.filter((key) => CARD_POOL[key].cpc <= me.cp).length;
    els.status.textContent =
      playable > 0
        ? `Round ${ui.state.round} — play up to ${ui.state.playsLeft[0]} card(s), then resolve.`
        : `Round ${ui.state.round} — no affordable cards; resolve to continue.`;
  }

  function render() {
    renderBase();
    renderTrack(els.trackFast, "fast");
    renderTrack(els.trackSlow, "slow");
    renderHand();
    renderPlaybar();
    renderLog();
    setStatus();
    if (ui.state) {
      els.round.textContent = "Round " + ui.state.round;
      els.cp.textContent = "CP " + ui.state.players[0].cp;
      els.plays.textContent = "Plays left " + ui.state.playsLeft[0];
    }
    els.resolve.disabled = !ui.state || ui.state.phase !== "playing" || ui.state.winner !== null;
  }

  function onHandClick(event) {
    const card = event.target.closest(".tc-card");
    if (!card || card.disabled) return;
    ui.selected = ui.selected === card.dataset.card ? null : card.dataset.card;
    render();
  }

  function onPlaybarClick(event) {
    const button = event.target.closest("[data-play]");
    if (!button || !ui.selected || !ui.state) return;
    const action = button.dataset.play;
    if (action === "defend") {
      const result = Engine.playCard(ui.state, 0, ui.selected, "slow", true);
      if (!result.ok) els.status.textContent = result.error;
      else ui.selected = null;
      render();
      return;
    }
    const track = action === "slow" ? "slow" : "fast";
    const result = Engine.playCard(ui.state, 0, ui.selected, track, false);
    if (!result.ok) els.status.textContent = result.error;
    else ui.selected = null;
    render();
  }

  function onResolve() {
    if (!ui.state || ui.state.phase !== "playing" || ui.state.winner !== null) return;
    ui.selected = null;
    Engine.resolveRound(ui.state, ui.difficulty, false);
    render();
    if (ui.state.phase === "over") finish();
  }

  function usedFlying() {
    if (!ui.state) return 0;
    const boardFlying = ui.state.board.some((unit) => unit.owner === 0 && CARD_POOL[unit.key].keywords.includes("Flying"));
    const discardFlying = ui.state.players[0].discard.some((key) => CARD_POOL[key].keywords.includes("Flying"));
    return boardFlying || discardFlying ? 1 : 0;
  }

  function finish() {
    if (ui.finished) return;
    ui.finished = true;
    const winner = ui.state.winner;
    let result;
    if (winner === "draw") result = "draw";
    else result = winner === 0 ? "win" : "loss";

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
    ui.manualUnlocks.add("first-battle");

    const baseHp = Math.max(0, ui.state.players[0].baseHp);
    const score = result === "win" ? baseHp : 0;
    const title = result === "win" ? "Victory!" : result === "draw" ? "Draw" : "Defeat";
    const body =
      result === "win"
        ? `The rival bastion falls. You held ${baseHp} base HP.`
        : result === "draw"
          ? "Both bastions stand at the end — a draw."
          : "Your bastion has fallen. Rebuild and try again.";
    overlay.show(title, body, "New battle", newGame);
    render();

    persistTally();

    Gamebase.endRun({
      score,
      meta: {
        result,
        streak: ui.tally.streak,
        rounds: ui.state.round,
        baseHp,
        usedFlying: usedFlying(),
      },
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[trading-cards] endRun failed", err));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  function randomSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  function newGame() {
    ui.finished = false;
    ui.selected = null;
    ui.manualUnlocks = new Set();
    overlay.hide();
    ui.state = Engine.createMatch(randomSeed(), ui.difficulty);
    render();
  }

  function setMode(mode) {
    ui.difficulty = mode;
    GameKit.localStore.set("trading-cards.difficulty", mode);
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
      .catch((err) => console.warn("[trading-cards] saveState failed", err));
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
      .catch((err) => console.warn("[trading-cards] loadState failed", err));
    Gamebase.myBest()
      .then((best) => {
        if (best) els.tag.textContent = player.handle + " · best " + best.best;
      })
      .catch(() => {});
  }

  els.hand.addEventListener("click", onHandClick);
  els.playbar.addEventListener("click", onPlaybarClick);
  els.resolve.addEventListener("click", onResolve);
  els.newGame.addEventListener("click", newGame);
  els.cancelPlay.addEventListener("click", () => {
    ui.selected = null;
    render();
  });
  GameKit.modeCycle(els.modeBtn, MODES, MODE_LABELS, () => ui.difficulty, setMode);

  const storedDifficulty = GameKit.localStore.get("trading-cards.difficulty", "normal");
  ui.difficulty = MODES.includes(storedDifficulty) ? storedDifficulty : "normal";
  els.modeBtn.textContent = MODE_LABELS[ui.difficulty];
  refreshRecord();
  newGame();

  GameKit.ready({ tagElement: els.tag, onPlayer }).catch(() => {
    els.tag.textContent = "guest";
  });

  root.TradingCards = {
    get state() {
      return ui.state;
    },
    engine: Engine,
    newGame,
    setMode,
    resolve: onResolve,
    render,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
