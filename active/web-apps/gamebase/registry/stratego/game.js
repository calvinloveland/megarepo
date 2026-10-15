/*
 * Stratego — Gamebase
 *
 * Full 10x10 Stratego with hidden information. The human commands the bottom
 * army (rows 6-9), the AI the top (rows 0-3). Ranks are hidden until a battle
 * reveals them. Movement is orthogonal; Scouts move like rooks; Bombs and the
 * Flag are immovable; Miners defuse Bombs; the Spy kills the Marshal. A
 * heuristic AI reasons with a belief distribution over the ranks it has not
 * yet seen, so it never peeks at hidden pieces.
 */
(function (root) {
  "use strict";

  // Owners: AI defends the top, HUMAN the bottom.
  const AI = 0, HUMAN = 1;

  const MARSHAL = 10, GENERAL = 9, COLONEL = 8, MAJOR = 7, CAPTAIN = 6;
  const LIEUTENANT = 5, SERGEANT = 4, MINER = 3, SCOUT = 2, SPY = 1;
  const BOMB = 0, FLAG = -1;

  const FACTIONS = { [AI]: "AI", [HUMAN]: "your" };

  const ARMY = [
    { rank: MARSHAL, count: 1 },
    { rank: GENERAL, count: 1 },
    { rank: COLONEL, count: 2 },
    { rank: MAJOR, count: 3 },
    { rank: CAPTAIN, count: 4 },
    { rank: LIEUTENANT, count: 4 },
    { rank: SERGEANT, count: 4 },
    { rank: MINER, count: 5 },
    { rank: SCOUT, count: 8 },
    { rank: SPY, count: 1 },
    { rank: BOMB, count: 6 },
    { rank: FLAG, count: 1 },
  ];

  // Value of a piece, used by the AI's material/risk model.
  const VALUE = {
    [MARSHAL]: 100, [GENERAL]: 80, [COLONEL]: 60, [MAJOR]: 45, [CAPTAIN]: 35,
    [LIEUTENANT]: 28, [SERGEANT]: 22, [MINER]: 30, [SCOUT]: 15, [SPY]: 35,
    [BOMB]: 20, [FLAG]: 1000,
  };

  const onBoard = (c, r) => c >= 0 && c < 10 && r >= 0 && r < 10;
  const idx = (c, r) => r * 10 + c;
  const idxFile = (s) => s % 10;
  const idxRank = (s) => Math.floor(s / 10);

  function isLake(c, r) {
    return (r === 4 || r === 5) && (c === 2 || c === 3 || c === 6 || c === 7);
  }

  let nextId = 1;

  function makeArmy(owner) {
    const pieces = [];
    for (const { rank, count } of ARMY) {
      for (let i = 0; i < count; i++) {
        pieces.push({ id: nextId++, owner, rank, alive: true, revealed: false, pos: -1 });
      }
    }
    return pieces;
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function placePiece(st, piece, square) {
    st.board[square] = piece;
    piece.pos = square;
    piece.alive = true;
  }

  function setupArmy(st, owner) {
    const rows = owner === AI ? [0, 1, 2, 3] : [6, 7, 8, 9];
    const backRow = owner === AI ? 0 : 9;
    const backTwo = owner === AI ? [0, 1] : [8, 9];

    const allSquares = [];
    for (const r of rows) for (let c = 0; c < 10; c++) allSquares.push(idx(c, r));
    for (const s of allSquares) st.board[s] = null;

    const pieces = st.pieces.filter((p) => p.owner === owner);
    for (const p of pieces) { p.alive = true; p.revealed = false; p.pos = -1; }

    const pool = shuffleArray(allSquares.slice());
    const flag = pieces.find((p) => p.rank === FLAG);
    const bombs = pieces.filter((p) => p.rank === BOMB);
    const rest = shuffleArray(pieces.filter((p) => p.rank !== FLAG && p.rank !== BOMB));

    const flagRowSquares = shuffleArray(pool.filter((s) => idxRank(s) === backRow));
    const actualFlagSquare = flagRowSquares[0];
    remove(pool, actualFlagSquare);
    placePiece(st, flag, actualFlagSquare);

    shuffleArray(pool);
    const bombPool = shuffleArray(pool.filter((s) => backTwo.includes(idxRank(s))));
    for (const bomb of bombs) {
      const square = bombPool.pop();
      remove(pool, square);
      placePiece(st, bomb, square);
    }

    for (const piece of rest) {
      const square = pool.pop();
      if (square === undefined) break;
      placePiece(st, piece, square);
    }
  }

  function remove(arr, value) {
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1);
  }

  function createState() {
    const pieces = makeArmy(AI).concat(makeArmy(HUMAN));
    const board = new Array(100).fill(null);
    const st = {
      board, pieces, turn: HUMAN, moveCount: 0, halfmove: 0, battleCount: 0,
      over: false, winner: null, draw: false, flagCaptured: null, lastMove: null, log: [],
    };
    setupArmy(st, AI);
    setupArmy(st, HUMAN);
    return st;
  }

  function snapshot(st) {
    const map = new Map();
    const pieces = st.pieces.map((p) => {
      const copy = { id: p.id, owner: p.owner, rank: p.rank, alive: p.alive, revealed: p.revealed, pos: p.pos };
      map.set(p.id, copy);
      return copy;
    });
    const board = st.board.map((p) => (p ? map.get(p.id) : null));
    return {
      board, pieces, turn: st.turn, moveCount: st.moveCount, halfmove: st.halfmove,
      battleCount: st.battleCount, over: st.over, winner: st.winner, draw: st.draw,
      flagCaptured: st.flagCaptured, lastMove: st.lastMove ? { from: st.lastMove.from, to: st.lastMove.to } : null,
      log: st.log.slice(),
    };
  }

  // --- Movement -------------------------------------------------------------
  function movesForPiece(st, p) {
    const moves = [];
    if (!p || !p.alive || p.rank === BOMB || p.rank === FLAG || p.pos < 0) return moves;
    const board = st.board;
    const c0 = idxFile(p.pos), r0 = idxRank(p.pos);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    const trySquare = (c, r, allowContinue) => {
      if (!onBoard(c, r) || isLake(c, r)) return false;
      const to = idx(c, r);
      const occupant = board[to];
      if (!occupant) {
        moves.push({ from: p.pos, to, attack: false });
        return allowContinue;
      }
      if (occupant.owner !== p.owner) {
        moves.push({ from: p.pos, to, attack: true });
      }
      return false;
    };

    if (p.rank === SCOUT) {
      for (const [dc, dr] of dirs) {
        let c = c0 + dc, r = r0 + dr;
        while (onBoard(c, r)) {
          const cont = trySquare(c, r, true);
          if (!cont) break;
          c += dc;
          r += dr;
        }
      }
    } else {
      for (const [dc, dr] of dirs) trySquare(c0 + dc, r0 + dr, false);
    }
    return moves;
  }

  function allMoves(st) {
    const out = [];
    for (const p of st.pieces) {
      if (p.owner !== st.turn || !p.alive) continue;
      for (const m of movesForPiece(st, p)) out.push(m);
    }
    return out;
  }

  // --- Battle resolution ----------------------------------------------------
  function resolveBattle(attacker, defender) {
    if (defender.rank === FLAG) return { attackerDies: false, defenderDies: true, flag: true };
    if (defender.rank === BOMB) {
      if (attacker.rank === MINER) return { attackerDies: false, defenderDies: true, defused: true };
      return { attackerDies: true, defenderDies: false };
    }
    if (attacker.rank === SPY) {
      if (defender.rank === MARSHAL) return { attackerDies: false, defenderDies: true, spyKill: true };
      return { attackerDies: true, defenderDies: false };
    }
    if (attacker.rank > defender.rank) return { attackerDies: false, defenderDies: true };
    if (attacker.rank < defender.rank) return { attackerDies: true, defenderDies: false };
    return { attackerDies: true, defenderDies: true };
  }

  function applyMove(st, move) {
    const board = st.board;
    const attacker = board[move.from];
    const info = { from: move.from, to: move.to, attack: move.attack, attacker, defender: null, result: null };

    if (!move.attack) {
      board[move.to] = attacker;
      board[move.from] = null;
      attacker.pos = move.to;
      st.halfmove += 1;
    } else {
      const defender = board[move.to];
      info.defender = defender;
      attacker.revealed = true;
      defender.revealed = true;
      const res = resolveBattle(attacker, defender);
      info.result = res;

      board[move.from] = null;
      if (res.defenderDies) { defender.alive = false; defender.pos = -1; }
      if (res.attackerDies) { attacker.alive = false; attacker.pos = -1; }

      if (!res.attackerDies) {
        board[move.to] = attacker;
        attacker.pos = move.to;
      } else if (res.defenderDies) {
        board[move.to] = null;
      }
      st.halfmove = 0;
      st.battleCount += 1;
      if (res.flag) {
        st.flagCaptured = attacker.owner;
        st.over = true;
        st.winner = attacker.owner;
      }
    }

    st.lastMove = { from: move.from, to: move.to };
    st.moveCount += 1;
    if (!st.over) {
      st.turn = st.turn ^ 1;
      checkEnd(st);
    }
    return info;
  }

  function checkEnd(st) {
    if (st.over) return;
    if (st.halfmove >= 300) {
      st.over = true;
      st.winner = null;
      st.draw = true;
      return;
    }
    if (allMoves(st).length === 0) {
      st.over = true;
      st.winner = st.turn ^ 1;
    }
  }

  // --- AI -------------------------------------------------------------------
  function battleValue(ar, dr, flagScore) {
    if (flagScore === undefined) flagScore = 400;
    if (dr === FLAG) return flagScore;
    if (dr === BOMB) return ar === MINER ? VALUE[BOMB] : -VALUE[ar];
    if (ar === SPY) return dr === MARSHAL ? VALUE[MARSHAL] : -VALUE[SPY];
    if (ar > dr) return VALUE[dr];
    if (ar < dr) return -VALUE[ar];
    return VALUE[dr] - VALUE[ar];
  }

  function belief(st) {
    const counts = {};
    let total = 0;
    for (const p of st.pieces) {
      if (p.owner === HUMAN && p.alive && !p.revealed) {
        counts[p.rank] = (counts[p.rank] || 0) + 1;
        total += 1;
      }
    }
    return { counts, total };
  }

  function expectedAttack(st, attackerRank, defender) {
    if (defender.owner === AI || defender.revealed) {
      return battleValue(attackerRank, defender.rank, 100000);
    }
    const { counts, total } = belief(st);
    if (total === 0) return battleValue(attackerRank, defender.rank);

    // The defender is one of the unseen pieces: average over the belief.
    let sum = 0;
    for (const key of Object.keys(counts)) {
      sum += battleValue(attackerRank, Number(key)) * counts[key];
    }
    return sum / total;
  }

  function threatPenalty(st, aiPiece, targetSquare) {
    let penalty = 0;
    for (const q of st.pieces) {
      if (q.owner !== HUMAN || !q.alive || !q.revealed || q.rank === BOMB || q.rank === FLAG) continue;
      for (const mv of movesForPiece(st, q)) {
        if (mv.to === targetSquare && mv.attack) {
          if (battleValue(q.rank, aiPiece.rank) > 0) penalty = Math.max(penalty, VALUE[aiPiece.rank] * 0.5);
        }
      }
    }
    return penalty;
  }

  function knownFlagSquare(st) {
    for (const p of st.pieces) {
      if (p.owner === HUMAN && p.alive && p.revealed && p.rank === FLAG) return p.pos;
    }
    return -1;
  }

  function aiChoose(st) {
    const moves = allMoves(st);
    if (moves.length === 0) return null;
    const flagSquare = knownFlagSquare(st);
    const flagC = flagSquare >= 0 ? idxFile(flagSquare) : -1;
    const flagR = flagSquare >= 0 ? idxRank(flagSquare) : -1;

    let best = null;
    let bestScore = -Infinity;
    for (const move of moves) {
      const piece = st.board[move.from];
      let score;
      if (move.attack) {
        const target = st.board[move.to];
        score = expectedAttack(st, piece.rank, target);
      } else {
        score = (idxRank(move.to) - idxRank(move.from)) * 2.2; // AI advances downward
        if (piece.rank === SCOUT) score += 3.5;
        if (piece.rank === MINER) score += 1.5;
        if (piece.rank === MARSHAL) score -= 1.5;
        if (piece.rank === SPY) score -= 0.5;
        score += Math.random() * 1.6;
      }

      if (flagC >= 0) {
        const before = Math.abs(idxFile(move.from) - flagC) + Math.abs(idxRank(move.from) - flagR);
        const after = Math.abs(idxFile(move.to) - flagC) + Math.abs(idxRank(move.to) - flagR);
        score += (before - after) * 2;
      }

      score -= threatPenalty(st, piece, move.to);
      // Small preference for attacking with a cheaper piece when outcomes tie.
      if (best === null || score > bestScore + 0.001) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  // --- Labels ---------------------------------------------------------------
  function pieceLabel(rank) {
    if (rank === FLAG) return "F";
    if (rank === BOMB) return "B";
    if (rank === SPY) return "S";
    return String(rank);
  }

  function rankClass(rank) {
    if (rank === FLAG) return "rank-flag";
    if (rank === BOMB) return "rank-bomb";
    if (rank === SPY) return "rank-spy";
    if (rank >= 8) return "rank-high";
    return "";
  }

  root.StrategoEngine = {
    AI, HUMAN, MARSHAL, GENERAL, COLONEL, MAJOR, CAPTAIN, LIEUTENANT, SERGEANT,
    MINER, SCOUT, SPY, BOMB, FLAG, VALUE, ARMY,
    createState, snapshot, setupArmy, isLake, idx, idxFile, idxRank,
    movesForPiece, allMoves, resolveBattle, applyMove, checkEnd, aiChoose,
    belief, battleValue, expectedAttack, pieceLabel, rankClass,
  };

  // --- UI -------------------------------------------------------------------
  if (typeof document === "undefined") return;

  // The host (match.players[0]) always commands the bottom army and moves
  // first; the guest commands the top army.
  const HOST_SIDE = HUMAN, GUEST_SIDE = AI;
  const MODES = ["ai", "local", "online"];
  const MODE_LABELS = {
    ai: "Mode: vs AI",
    local: "Mode: 2-player",
    online: "Mode: Online",
  };

  const cellsEl = document.getElementById("board");
  const els = {
    status: document.getElementById("status"),
    tag: document.getElementById("tag"),
    counts: document.getElementById("counts"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    shuffle: document.getElementById("shuffle"),
    start: document.getElementById("start"),
    undo: document.getElementById("undo"),
    mode: document.getElementById("mode"),
    log: document.getElementById("log"),
  };

  const ui = {
    st: createState(),
    mode: "ai",             // ai | local | online
    phase: "setup",         // setup | battle | over
    setupSide: HUMAN,       // local hot-seat: side currently deploying
    viewerSide: HUMAN,      // local hot-seat: side whose pieces are face-up
    selected: -1,
    validMoves: [],
    swapSel: -1,
    busy: false,
    history: [],
    stats: { bombsDefused: 0, spyKills: 0 },
    finishedText: "",
  };
  const manualUnlocks = new Set();
  let overlayAction = null;

  // Online relay bookkeeping. The relayed state is a single shared JSON blob;
  // only the player whose turn it is writes to it.
  const online = {
    matchId: null,
    myId: null,
    hostId: null,
    guestId: null,
    opponentId: null,
    isHost: false,
    mySide: null,
    revision: 0,
    armyReady: false,
    reported: false,
    active: false,
    searchPhase: "finding", // finding | waiting | matched
    pollTimer: null,
    generation: 0, // bumped on reset so stale matchmaking promises bail out
  };

  let cellEls = [];

  function buildBoard() {
    cellsEl.innerHTML = "";
    cellEls = [];
    for (let s = 0; s < 100; s++) {
      const c = idxFile(s), r = idxRank(s);
      const div = document.createElement("div");
      div.className = "cell " + ((c + r) % 2 === 0 ? "a" : "b") + (isLake(c, r) ? " lake" : "");
      div.dataset.sq = String(s);
      div.addEventListener("click", () => onCellClick(s));
      cellsEl.appendChild(div);
      cellEls.push(div);
    }
  }

  // Which army the local player is allowed to see/command. AI mode always
  // views the bottom army; local hot-seat flips with the pass-screen; online
  // is fixed to the side assigned at matchmaking.
  function viewerSide() {
    if (ui.mode === "online") return online.mySide != null ? online.mySide : HUMAN;
    if (ui.mode === "local") return ui.viewerSide;
    return HUMAN;
  }

  function activeSetupSide() {
    if (ui.mode === "local") return ui.setupSide;
    return viewerSide();
  }

  function myTurn() {
    if (ui.phase !== "battle" || ui.busy) return false;
    if (ui.mode === "ai") return ui.st.turn === HUMAN;
    if (ui.mode === "online") return Boolean(online.matchId) && ui.st.turn === online.mySide;
    if (ui.mode === "local") return ui.viewerSide != null && ui.st.turn === ui.viewerSide;
    return false;
  }

  function ownerName(owner) {
    if (ui.mode === "online") return owner === online.mySide ? "You" : "Opponent";
    if (ui.mode === "local") return owner === HUMAN ? "Player 1" : "Player 2";
    return owner === HUMAN ? "You" : "AI";
  }

  function render() {
    const st = ui.st;
    const viewer = viewerSide();
    let interactive = null;
    if (ui.phase === "setup") interactive = activeSetupSide();
    else if (ui.phase === "battle" && myTurn()) interactive = viewer;

    for (let s = 0; s < 100; s++) {
      const el = cellEls[s];
      const c = idxFile(s), r = idxRank(s);
      let cls = "cell " + ((c + r) % 2 === 0 ? "a" : "b");
      if (isLake(c, r)) cls += " lake";
      el.className = cls;
      el.innerHTML = "";

      const p = st.board[s];
      if (p) {
        const mine = viewer != null && p.owner === viewer;
        if (mine || p.revealed) {
          const tile = document.createElement("div");
          const base = mine ? "own" : "enemy revealed";
          tile.className = "tile " + base + (mine ? " " + rankClass(p.rank) : "");
          tile.textContent = pieceLabel(p.rank);
          el.appendChild(tile);
        } else {
          // Hidden opponents are face-down; ranks only appear after a battle.
          const tile = document.createElement("div");
          tile.className = "tile enemy";
          tile.textContent = "\u25A0";
          el.appendChild(tile);
        }
        if (p.owner === interactive) el.classList.add("own");
      }

      if (ui.lastMoveOk(s)) el.classList.add("last");
      if (s === ui.selected) el.classList.add("sel");
      if (ui.phase === "setup" && s === ui.swapSel) el.classList.add("swap");

      const mv = ui.validMoves.find((m) => m.to === s);
      if (mv) {
        const marker = document.createElement("span");
        marker.className = mv.attack ? "atk" : "dot";
        el.appendChild(marker);
      }
    }
    renderCounts();
    renderStatus();
    renderLog();
  }

  ui.lastMoveOk = function (s) {
    const lm = ui.st.lastMove;
    return lm && (s === lm.from || s === lm.to);
  };

  function renderCounts() {
    let human = 0, ai = 0;
    for (const p of ui.st.pieces) {
      if (!p.alive) continue;
      if (p.owner === HUMAN) human++; else ai++;
    }
    if (ui.mode === "local") {
      els.counts.textContent = `P1 ${human} \u00b7 P2 ${ai}`;
    } else if (ui.mode === "online") {
      const mine = online.mySide === HUMAN ? human : ai;
      const theirs = online.mySide === HUMAN ? ai : human;
      els.counts.textContent = `you ${mine} \u00b7 opponent ${theirs}`;
    } else {
      els.counts.textContent = `you ${human} \u00b7 AI ${ai}`;
    }
  }

  function renderStatus() {
    if (ui.phase === "setup") {
      if (ui.mode === "online") {
        if (!online.matchId) {
          els.status.textContent = online.searchPhase === "waiting" ? "Waiting for an opponent\u2026" : "Finding an opponent\u2026";
        } else if (!online.armyReady) {
          els.status.textContent = "Deploy your army, then Ready";
        } else {
          els.status.textContent = "Waiting for opponent\u2026";
        }
      } else if (ui.mode === "local") {
        els.status.textContent = ui.setupSide === HUMAN ? "Player 1: deploy your army" : "Player 2: deploy your army";
      } else {
        els.status.textContent = "Deploy your army, then Start battle";
      }
    } else if (ui.phase === "over") {
      els.status.textContent = ui.finishedText || "Game over";
    } else if (ui.mode === "online") {
      els.status.textContent = ui.st.turn === online.mySide ? "Your move" : "Waiting for opponent\u2026";
    } else if (ui.mode === "local") {
      els.status.textContent = (ui.st.turn === HUMAN ? "Player 1" : "Player 2") + "'s move";
    } else if (ui.busy || ui.st.turn !== HUMAN) {
      els.status.textContent = "AI thinking\u2026";
    } else {
      els.status.textContent = "Your move";
    }
  }

  function logText(entry) {
    const res = entry.result;
    const aLabel = pieceLabel(entry.attacker.rank);
    const dLabel = pieceLabel(entry.defender.rank);
    let outcome;
    if (res.flag) outcome = "CAPTURE THE FLAG!";
    else if (res.defused) outcome = "defuses the Bomb";
    else if (res.spyKill) outcome = "Spy kills the Marshal!";
    else if (res.attackerDies && res.defenderDies) outcome = "both destroyed";
    else if (res.attackerDies) outcome = `${ownerName(entry.defender.owner)} ${dLabel} survives`;
    else outcome = `captures ${ownerName(entry.defender.owner)} ${dLabel}`;
    return `${ownerName(entry.attacker.owner)} ${aLabel} \u2694 ${ownerName(entry.defender.owner)} ${dLabel}: ${outcome}`;
  }

  function logClass(entry) {
    const viewer = viewerSide();
    if (viewer == null) return "";
    const res = entry.result;
    if (res.attackerDies && res.defenderDies) return "";
    return entry.attacker.owner === viewer ? "win" : "bad";
  }

  function renderLog() {
    els.log.innerHTML = "";
    for (const entry of ui.st.log.slice(-40)) {
      const li = document.createElement("li");
      if (entry && entry.type === "battle") {
        li.textContent = logText(entry);
        const cls = logClass(entry);
        if (cls) li.className = cls;
      } else if (entry && entry.text) {
        li.textContent = entry.text;
        if (entry.cls) li.className = entry.cls;
      }
      els.log.appendChild(li);
    }
    els.log.scrollTop = els.log.scrollHeight;
  }

  function updateControls() {
    const setup = ui.phase === "setup";
    const onlineLocked = ui.mode === "online" && online.armyReady;
    els.shuffle.disabled = !setup || onlineLocked;
    els.start.disabled = !setup || onlineLocked;
    els.undo.disabled = setup || ui.history.length === 0 || ui.mode !== "ai";
    els.start.textContent = setup ? (ui.mode === "ai" ? "Start battle" : "Ready") : "Start battle";
  }

  function onCellClick(s) {
    if (ui.phase === "setup") {
      if (ui.mode === "online" && online.armyReady) return;
      const side = activeSetupSide();
      const p = ui.st.board[s];
      if (p && p.owner === side) {
        if (ui.swapSel < 0) ui.swapSel = s;
        else if (ui.swapSel === s) ui.swapSel = -1;
        else { swapPieces(ui.swapSel, s); ui.swapSel = -1; }
        render();
      }
      return;
    }
    if (ui.phase !== "battle" || !myTurn()) return;

    const p = ui.st.board[s];
    if (p && p.owner === viewerSide()) {
      ui.selected = s;
      ui.validMoves = movesForPiece(ui.st, p);
      render();
      return;
    }
    const mv = ui.validMoves.find((m) => m.to === s);
    if (mv) humanMove(mv);
    else { ui.selected = -1; ui.validMoves = []; render(); }
  }

  function swapPieces(a, b) {
    const st = ui.st;
    const pa = st.board[a], pb = st.board[b];
    st.board[a] = pb; st.board[b] = pa;
    if (pa) pa.pos = b;
    if (pb) pb.pos = a;
  }

  function humanMove(move) {
    if (ui.mode === "ai") {
      ui.history.push({ state: snapshot(ui.st), stats: Object.assign({}, ui.stats) });
    }
    const info = applyMove(ui.st, move);
    recordBattle(info);
    ui.selected = -1;
    ui.validMoves = [];
    updateControls();
    render();
    if (ui.mode === "online") {
      // Publish even when this move ended the game so the opponent learns.
      publishPlay();
      if (ui.st.over) endGame();
      return;
    }
    if (ui.st.over) { endGame(); return; }
    if (ui.mode === "ai") {
      ui.busy = true;
      renderStatus();
      setTimeout(aiTurn, 130);
    } else if (ui.mode === "local") {
      handoff(ui.st.turn, null);
    }
  }

  function aiTurn() {
    if (ui.st.over) { ui.busy = false; return; }
    const move = aiChoose(ui.st);
    if (!move) { ui.busy = false; checkEnd(ui.st); if (ui.st.over) endGame(); return; }
    const info = applyMove(ui.st, move);
    recordBattle(info);
    ui.busy = false;
    updateControls();
    render();
    if (ui.st.over) endGame();
  }

  function recordBattle(info) {
    if (!info.attack) return;
    const res = info.result;
    ui.st.log.push({
      type: "battle",
      attacker: { owner: info.attacker.owner, rank: info.attacker.rank },
      defender: { owner: info.defender.owner, rank: info.defender.rank },
      result: {
        attackerDies: !!res.attackerDies,
        defenderDies: !!res.defenderDies,
        flag: !!res.flag,
        defused: !!res.defused,
        spyKill: !!res.spyKill,
      },
    });

    if (info.attacker.owner === viewerSide()) {
      if (res.defused) ui.stats.bombsDefused += 1;
      if (res.spyKill) { ui.stats.spyKills += 1; manualUnlocks.add("spy-master"); }
      if (res.flag) manualUnlocks.add("flag-bearer");
    }
  }

  function showOverlay(title, body, buttonText, action) {
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlayBtn.textContent = buttonText;
    els.overlay.hidden = false;
    overlayAction = action;
  }

  function hideOverlay() {
    els.overlay.hidden = true;
    overlayAction = null;
  }

  // Hot-seat pass screen: hide every rank until the next player confirms.
  function handoff(side, then) {
    ui.viewerSide = null;
    const name = side === HUMAN ? "Player 1 (bottom)" : "Player 2 (top)";
    showOverlay("Pass the device", "Hand the device to " + name + ", then press Ready.", "Ready", () => {
      hideOverlay();
      ui.viewerSide = side;
      if (then) then();
      render();
    });
  }

  function endGame() {
    if (ui.phase === "over") return;
    ui.phase = "over";
    stopOnlinePolling();
    const st = ui.st;
    const viewer = ui.mode === "online" ? online.mySide : HUMAN;
    let result, title, body;
    if (st.draw) {
      result = "draw";
      title = "Draw";
      body = "No battle for 300 plies.";
    } else {
      const won = st.winner === viewer;
      result = won ? "win" : "loss";
      if (ui.mode === "local") {
        title = (st.winner === HUMAN ? "Player 1" : "Player 2") + " wins!";
        body = st.flagCaptured != null ? "Flag captured." : "No legal moves left.";
      } else if (won) {
        title = "Victory!";
        body = st.flagCaptured === viewer ? "You captured the flag." : "The opponent has no legal moves left.";
      } else {
        title = "Defeat";
        body = st.flagCaptured != null ? "Your flag was captured." : "You have no legal moves left.";
      }
    }
    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    manualUnlocks.add("first-battle");
    ui.finishedText = title;
    showOverlay(title, body, "New game", null);
    updateControls();
    render();

    if (ui.mode === "online" && online.matchId && !online.reported) {
      online.reported = true;
      Gamebase.reportResult(online.matchId, { result }).catch((err) => console.warn("[stratego] reportResult failed", err));
    }
    Gamebase.endRun({
      score,
      meta: {
        result,
        mode: ui.mode,
        moves: st.moveCount,
        bombsDefused: ui.stats.bombsDefused,
        spyKills: ui.stats.spyKills,
        flagCaptured: st.flagCaptured === viewer ? 1 : 0,
      },
      unlock: Array.from(manualUnlocks),
    }).catch((err) => console.warn("[stratego] endRun failed", err));
  }

  function newGame() {
    stopOnlinePolling();
    onlineReset();
    ui.st = createState();
    ui.phase = "setup";
    ui.setupSide = HUMAN;
    ui.viewerSide = HUMAN;
    ui.selected = -1;
    ui.validMoves = [];
    ui.swapSel = -1;
    ui.busy = false;
    ui.history = [];
    ui.stats = { bombsDefused: 0, spyKills: 0 };
    manualUnlocks.clear();
    ui.finishedText = "";
    hideOverlay();
    updateControls();
    render();
    if (ui.mode === "online") startOnline();
  }

  function startBattle() {
    if (ui.phase !== "setup") return;
    if (ui.mode === "online") {
      publishSetupArmy();
      return;
    }
    if (ui.mode === "local") {
      ui.swapSel = -1;
      if (ui.setupSide === HUMAN) {
        // Player 2 still has to deploy; pass the device without resetting.
        handoff(AI, () => { ui.setupSide = AI; });
        return;
      }
      ui.phase = "battle";
      ui.st.turn = HUMAN;
      updateControls();
      handoff(HUMAN, null);
      return;
    }
    ui.phase = "battle";
    ui.swapSel = -1;
    ui.st.turn = HUMAN;
    updateControls();
    render();
  }

  function shufflePlayer() {
    if (ui.phase !== "setup") return;
    if (ui.mode === "online" && online.armyReady) return;
    setupArmy(ui.st, activeSetupSide());
    ui.swapSel = -1;
    render();
  }

  function undo() {
    if (ui.mode !== "ai") return;
    if (ui.phase !== "battle" || ui.busy || ui.history.length === 0) return;
    const snap = ui.history.pop();
    ui.st = snap.state;
    ui.stats = snap.stats;
    ui.selected = -1;
    ui.validMoves = [];
    ui.phase = "battle";
    hideOverlay();
    updateControls();
    render();
  }

  // ── Online ────────────────────────────────────────────────────────────────
  //
  // Hidden-information caveat: the relay is a single shared JSON object, so
  // resolving battles requires shipping every piece's rank through it. A
  // determined player could read the opposing ranks from devtools. This is an
  // accepted casual-play limitation; a production build would use per-player
  // blind writes or a server-side rules engine.

  function onlineReset() {
    stopOnlinePolling();
    online.matchId = null;
    online.myId = null;
    online.hostId = null;
    online.guestId = null;
    online.opponentId = null;
    online.isHost = false;
    online.mySide = null;
    online.revision = 0;
    online.armyReady = false;
    online.reported = false;
    online.active = false;
    online.searchPhase = "finding";
    online.generation = (online.generation || 0) + 1;
  }

  function stopOnlinePolling() {
    if (online.pollTimer) {
      clearTimeout(online.pollTimer);
      online.pollTimer = null;
    }
  }

  function serializeArmy(owner) {
    return ui.st.pieces
      .filter((p) => p.owner === owner)
      .map((p) => ({ id: p.id, owner: p.owner, rank: p.rank, alive: p.alive, revealed: p.revealed, pos: p.pos }));
  }

  function serializeGame() {
    const st = ui.st;
    return {
      phase: "play",
      pieces: st.pieces.map((p) => ({ id: p.id, owner: p.owner, rank: p.rank, alive: p.alive, revealed: p.revealed, pos: p.pos })),
      turn: st.turn,
      moveCount: st.moveCount,
      halfmove: st.halfmove,
      battleCount: st.battleCount,
      over: st.over,
      winner: st.winner,
      draw: st.draw,
      flagCaptured: st.flagCaptured,
      lastMove: st.lastMove ? { from: st.lastMove.from, to: st.lastMove.to } : null,
      log: st.log,
    };
  }

  // Deterministic merge of the two published armies into a playable state.
  // Host army first so both clients agree on piece ids.
  function combineArmies(state) {
    const armies = (state && state.armies) || {};
    const groups = [
      { list: armies[online.hostId], owner: HOST_SIDE },
      { list: armies[online.guestId], owner: GUEST_SIDE },
    ];
    const pieces = [];
    let nid = 1;
    for (const group of groups) {
      if (!Array.isArray(group.list)) continue;
      for (const p of group.list) {
        pieces.push({
          id: nid++,
          owner: typeof p.owner === "number" ? p.owner : group.owner,
          rank: p.rank,
          alive: p.alive !== false,
          revealed: !!p.revealed,
          pos: typeof p.pos === "number" ? p.pos : -1,
        });
      }
    }
    const board = new Array(100).fill(null);
    for (const p of pieces) if (p.alive && p.pos >= 0) board[p.pos] = p;
    return { board, pieces };
  }

  function bothArmies(state) {
    const armies = state && state.armies;
    return Boolean(
      armies &&
      Array.isArray(armies[online.hostId]) &&
      Array.isArray(armies[online.guestId])
    );
  }

  function stateFromPieces(data) {
    const pieces = (data.pieces || []).map((p) => ({
      id: p.id,
      owner: p.owner,
      rank: p.rank,
      alive: p.alive !== false,
      revealed: !!p.revealed,
      pos: typeof p.pos === "number" ? p.pos : -1,
    }));
    const board = new Array(100).fill(null);
    for (const p of pieces) if (p.alive && p.pos >= 0) board[p.pos] = p;
    return {
      board,
      pieces,
      turn: typeof data.turn === "number" ? data.turn : HOST_SIDE,
      moveCount: data.moveCount || 0,
      halfmove: data.halfmove || 0,
      battleCount: data.battleCount || 0,
      over: !!data.over,
      winner: typeof data.winner === "number" ? data.winner : null,
      draw: !!data.draw,
      flagCaptured: typeof data.flagCaptured === "number" ? data.flagCaptured : null,
      lastMove: data.lastMove ? { from: data.lastMove.from, to: data.lastMove.to } : null,
      log: Array.isArray(data.log) ? data.log : [],
    };
  }

  function applyPlayState(state) {
    if (!state || !Array.isArray(state.pieces)) return;
    if (ui.phase === "over") return; // never un-finish a completed game
    ui.st = stateFromPieces(state);
    ui.phase = "battle";
    ui.selected = -1;
    ui.validMoves = [];
    ui.swapSel = -1;
    ui.history = [];
    updateControls();
    render();
    if (ui.st.over) endGame();
  }

  // Show the opponent's face-down army once it arrives during setup.
  function applySetupPreview(state) {
    if (!state || !state.armies) return;
    const guestArmy = state.armies[online.guestId];
    const hostArmy = state.armies[online.hostId];
    if (!Array.isArray(hostArmy) || !Array.isArray(guestArmy)) return;
    const base = combineArmies(state);
    ui.st = {
      board: base.board,
      pieces: base.pieces,
      turn: HOST_SIDE,
      moveCount: 0,
      halfmove: 0,
      battleCount: 0,
      over: false,
      winner: null,
      draw: false,
      flagCaptured: null,
      lastMove: null,
      log: Array.isArray(state.log) ? state.log : [],
    };
    ui.phase = "setup";
  }

  // Publish this player's own army without clobbering the opponent's half.
  async function publishSetupArmy() {
    if (ui.mode !== "online" || !online.matchId || online.armyReady) return;
    online.armyReady = true;
    ui.selected = -1;
    ui.validMoves = [];
    ui.swapSel = -1;
    updateControls();
    renderStatus();
    const army = serializeArmy(online.mySide);
    for (let attempt = 0; attempt < 6; attempt++) {
      let match;
      try {
        match = await Gamebase.match(online.matchId);
      } catch (error) {
        console.warn("[stratego] setup fetch failed", error);
        online.armyReady = false;
        updateControls();
        return;
      }
      if (!match) { online.armyReady = false; updateControls(); return; }
      online.revision = match.revision || 0;
      const current = match.game_state && typeof match.game_state === "object" ? match.game_state : {};
      if (current.phase === "play") {
        applyPlayState(current);
        return;
      }
      const merged = Object.assign({}, current);
      merged.phase = "setup";
      merged.armies = Object.assign({}, current.armies);
      merged.armies[online.myId] = army;
      try {
        const saved = await Gamebase.updateMatch(online.matchId, merged, online.revision);
        if (saved && typeof saved.revision === "number") online.revision = saved.revision;
        if (bothArmies(merged)) finalizeSetup(merged);
        return;
      } catch (error) {
        if (error.status === 409) continue; // refetch and re-merge
        console.warn("[stratego] publishSetup failed", error);
        online.armyReady = false;
        updateControls();
        return;
      }
    }
  }

  // Both armies are in: promote the relayed state to the play schema.
  async function finalizeSetup(baseState) {
    if (!bothArmies(baseState)) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const base = combineArmies(baseState);
      const play = {
        phase: "play",
        pieces: base.pieces,
        turn: HOST_SIDE,
        moveCount: 0,
        halfmove: 0,
        battleCount: 0,
        over: false,
        winner: null,
        draw: false,
        flagCaptured: null,
        lastMove: null,
        log: [],
      };
      try {
        const saved = await Gamebase.updateMatch(online.matchId, play, online.revision);
        if (saved && typeof saved.revision === "number") online.revision = saved.revision;
        applyPlayState(play);
        return;
      } catch (error) {
        if (error.status === 409) {
          const match = await Gamebase.match(online.matchId).catch(() => null);
          if (!match) return;
          online.revision = match.revision || 0;
          if (match.game_state && match.game_state.phase === "play") {
            applyPlayState(match.game_state);
            return;
          }
          if (bothArmies(match.game_state)) { baseState = match.game_state; continue; }
        }
        console.warn("[stratego] finalize setup failed", error);
        return;
      }
    }
  }

  async function startOnline() {
    stopOnlinePolling();
    onlineReset();
    const generation = online.generation;
    online.active = true;
    online.searchPhase = "finding";
    ui.phase = "setup";
    ui.st = createState();
    ui.selected = -1;
    ui.validMoves = [];
    ui.swapSel = -1;
    ui.busy = false;
    ui.history = [];
    render();
    try {
      await Gamebase.findMatch();
      if (ui.mode !== "online" || !online.active || online.generation !== generation) return;
      online.searchPhase = "waiting";
      renderStatus();
      const match = await Gamebase.waitForMatch({ timeout: 120000 });
      if (ui.mode !== "online" || !online.active || online.generation !== generation) return;
      if (!match) {
        els.status.textContent = "No opponent found \u2014 try again.";
        return;
      }
      const me = Gamebase.player;
      online.matchId = match.id;
      online.myId = me.id;
      online.hostId = match.players[0].player_id;
      online.guestId = (match.players.find((p) => p.player_id !== online.hostId) || {}).player_id || null;
      online.isHost = online.hostId === me.id;
      online.opponentId = online.isHost ? online.guestId : online.hostId;
      online.mySide = online.isHost ? HOST_SIDE : GUEST_SIDE;
      online.searchPhase = "matched";
      online.revision = match.revision || 0;
      const state = match.game_state || {};
      if (state.phase === "play") {
        applyPlayState(state);
        pollOnline();
        return;
      }
      // Wait for this player to arrange their army and press Ready before
      // merging it into the relayed setup state.
      render();
      pollOnline();
    } catch (error) {
      els.status.textContent = "Matchmaking failed: " + error.message;
    }
  }

  async function publishPlay() {
    if (ui.mode !== "online" || !online.matchId) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const saved = await Gamebase.updateMatch(online.matchId, serializeGame(), online.revision);
        if (saved && typeof saved.revision === "number") online.revision = saved.revision;
        return;
      } catch (error) {
        if (error.status === 409) {
          const match = await Gamebase.match(online.matchId).catch(() => null);
          if (!match) return;
          online.revision = match.revision || 0;
          if (match.game_state && match.game_state.phase === "play") {
            applyPlayState(match.game_state);
            return;
          }
          continue;
        }
        console.warn("[stratego] publishPlay failed", error);
        return;
      }
    }
  }

  async function pollOnline() {
    if (ui.mode !== "online" || !online.matchId || !online.active || ui.phase === "over") return;
    try {
      const match = await Gamebase.match(online.matchId);
      if (match && (match.revision || 0) > online.revision) {
        online.revision = match.revision || 0;
        const state = match.game_state || {};
        if (state.phase === "play") {
          applyPlayState(state);
        } else if (state.phase === "setup") {
          if (online.armyReady) applySetupPreview(state);
          if (bothArmies(state) && ui.phase === "setup") finalizeSetup(state);
          else render();
        }
      }
    } catch (error) {
      /* keep polling */
    }
    if (ui.mode === "online" && online.active && ui.phase !== "over") {
      online.pollTimer = setTimeout(pollOnline, 1500);
    }
  }

  // ── Mode + controls ──────────────────────────────────────────────────────

  function setMode(next) {
    ui.mode = next;
    els.mode.textContent = MODE_LABELS[next];
    if (next !== "online") {
      online.active = false;
      stopOnlinePolling();
    }
    newGame();
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", () => {
    if (overlayAction) {
      const action = overlayAction;
      overlayAction = null;
      action();
    } else {
      newGame();
    }
  });
  els.start.addEventListener("click", startBattle);
  els.shuffle.addEventListener("click", shufflePlayer);
  els.undo.addEventListener("click", undo);
  els.mode.addEventListener("click", () => {
    const index = MODES.indexOf(ui.mode);
    setMode(MODES[(index + 1) % MODES.length]);
  });

  // Expose a small read-only inspector for Playwright smoke tests (repo
  // convention for vanilla-JS games).
  root.StrategoGame = {
    state() {
      return {
        mode: ui.mode,
        phase: ui.phase,
        turn: ui.st.turn,
        over: ui.st.over,
        winner: ui.st.winner,
        moveCount: ui.st.moveCount,
        matchId: online.matchId,
        mySide: online.mySide,
      };
    },
    pieces() {
      return ui.st.pieces.map((p) => [p.id, p.owner, p.pos, p.alive ? 1 : 0, p.revealed ? 1 : 0]);
    },
    legalMoves() {
      return myTurn() ? allMoves(ui.st) : [];
    },
  };

  buildBoard();
  updateControls();
  render();

  Gamebase.ready()
    .then((player) => {
      els.tag.textContent = player.handle;
      return Gamebase.myBest();
    })
    .then((best) => {
      if (best && Gamebase.player) els.tag.textContent = Gamebase.player.handle + " · best " + best.best;
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[stratego] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
