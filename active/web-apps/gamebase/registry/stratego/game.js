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
    log: document.getElementById("log"),
  };

  const ui = {
    st: createState(),
    phase: "setup",         // setup | battle | over
    selected: -1,
    validMoves: [],
    swapSel: -1,
    busy: false,
    history: [],
    stats: { bombsDefused: 0, spyKills: 0 },
    finishedText: "",
  };
  const manualUnlocks = new Set();

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

  function render() {
    const st = ui.st;
    for (let s = 0; s < 100; s++) {
      const el = cellEls[s];
      const c = idxFile(s), r = idxRank(s);
      let cls = "cell " + ((c + r) % 2 === 0 ? "a" : "b");
      if (isLake(c, r)) cls += " lake";
      el.className = cls;
      el.innerHTML = "";

      const p = st.board[s];
      if (p) {
        if (p.owner === HUMAN || p.revealed) {
          const tile = document.createElement("div");
          const base = p.owner === HUMAN ? "own" : "enemy revealed";
          tile.className = "tile " + base + (p.owner === HUMAN ? " " + rankClass(p.rank) : "");
          tile.textContent = pieceLabel(p.rank);
          el.appendChild(tile);
          if (p.owner === HUMAN && ui.phase === "setup") el.classList.add("own");
        } else {
          const tile = document.createElement("div");
          tile.className = "tile enemy";
          tile.textContent = "\u25A0";
          el.appendChild(tile);
        }
        if (p.owner === HUMAN && (ui.phase === "setup" || (ui.phase === "battle" && st.turn === HUMAN))) el.classList.add("own");
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
    const st = ui.st;
    let human = 0, ai = 0;
    for (const p of st.pieces) {
      if (!p.alive) continue;
      if (p.owner === HUMAN) human++;
      else ai++;
    }
    els.counts.textContent = `you ${human} · AI ${ai}`;
  }

  function renderStatus() {
    if (ui.phase === "setup") {
      els.status.textContent = "Deploy your army, then Start battle";
    } else if (ui.phase === "over") {
      els.status.textContent = ui.finishedText || "Game over";
    } else if (ui.busy || ui.st.turn !== HUMAN) {
      els.status.textContent = "AI thinking…";
    } else {
      els.status.textContent = "Your move";
    }
  }

  function renderLog() {
    const log = ui.st.log;
    els.log.innerHTML = "";
    for (const entry of log.slice(-40)) {
      const li = document.createElement("li");
      li.textContent = entry.text;
      if (entry.cls) li.className = entry.cls;
      els.log.appendChild(li);
    }
    els.log.scrollTop = els.log.scrollHeight;
  }

  function updateControls() {
    const setup = ui.phase === "setup";
    const battle = ui.phase === "battle";
    els.shuffle.disabled = !setup;
    els.start.disabled = !setup;
    els.undo.disabled = setup || ui.history.length === 0;
  }

  function onCellClick(s) {
    if (ui.phase === "setup") {
      const p = ui.st.board[s];
      if (p && p.owner === HUMAN) {
        if (ui.swapSel < 0) ui.swapSel = s;
        else if (ui.swapSel === s) ui.swapSel = -1;
        else { swapPieces(ui.swapSel, s); ui.swapSel = -1; }
        render();
      }
      return;
    }
    if (ui.phase !== "battle" || ui.busy || ui.st.turn !== HUMAN) return;

    const p = ui.st.board[s];
    if (p && p.owner === HUMAN) {
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
    ui.history.push({ state: snapshot(ui.st), stats: Object.assign({}, ui.stats) });
    const info = applyMove(ui.st, move);
    recordBattle(info);
    ui.selected = -1;
    ui.validMoves = [];
    updateControls();
    render();
    if (ui.st.over) { endGame(); return; }
    ui.busy = true;
    renderStatus();
    setTimeout(aiTurn, 130);
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
    const attackerIsHuman = info.attacker.owner === HUMAN;
    const prefix = attackerIsHuman ? "You" : "AI";
    const victimPrefix = attackerIsHuman ? "AI" : "your";
    const aLabel = pieceLabel(info.attacker.rank);
    const dLabel = pieceLabel(info.defender.rank);

    let outcome;
    let cls = "";
    if (res.flag) {
      outcome = attackerIsHuman ? "CAPTURE THE FLAG!" : "capture your flag!";
      cls = attackerIsHuman ? "win" : "bad";
    } else if (res.defused) {
      outcome = "defuse the Bomb";
      cls = attackerIsHuman ? "win" : "bad";
    } else if (res.spyKill) {
      outcome = "Spy kills the Marshal!";
      cls = attackerIsHuman ? "win" : "bad";
    } else if (res.attackerDies && res.defenderDies) {
      outcome = "both destroyed";
    } else if (res.attackerDies) {
      outcome = `${victimPrefix} ${dLabel} survives`;
      cls = attackerIsHuman ? "bad" : "win";
    } else {
      outcome = `capture ${victimPrefix} ${dLabel}`;
      cls = attackerIsHuman ? "win" : "bad";
    }

    ui.st.log.push({ text: `${prefix} ${aLabel} \u2694 ${victimPrefix} ${dLabel}: ${outcome}`, cls });

    if (attackerIsHuman) {
      if (res.defused) ui.stats.bombsDefused += 1;
      if (res.spyKill) { ui.stats.spyKills += 1; manualUnlocks.add("spy-master"); }
      if (res.flag) manualUnlocks.add("flag-bearer");
    }
  }

  function endGame() {
    ui.phase = "over";
    const st = ui.st;
    let result, title, body;
    if (st.draw) {
      result = "draw";
      title = "Draw";
      body = "No battle for 300 plies.";
    } else if (st.winner === HUMAN) {
      result = "win";
      title = "Victory!";
      body = st.flagCaptured === HUMAN ? "You captured the flag." : "The AI has no legal moves left.";
    } else {
      result = "loss";
      title = "Defeat";
      body = st.flagCaptured === AI ? "Your flag was captured." : "You have no legal moves left.";
    }
    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    manualUnlocks.add("first-battle");
    ui.finishedText = title;
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
    updateControls();
    render();

    Gamebase.endRun({
      score,
      meta: {
        result,
        moves: st.moveCount,
        bombsDefused: ui.stats.bombsDefused,
        spyKills: ui.stats.spyKills,
        flagCaptured: st.flagCaptured === HUMAN ? 1 : 0,
      },
      unlock: Array.from(manualUnlocks),
    }).catch((err) => console.warn("[stratego] endRun failed", err));
  }

  function newGame() {
    ui.st = createState();
    ui.phase = "setup";
    ui.selected = -1;
    ui.validMoves = [];
    ui.swapSel = -1;
    ui.busy = false;
    ui.history = [];
    ui.stats = { bombsDefused: 0, spyKills: 0 };
    manualUnlocks.clear();
    ui.finishedText = "";
    els.overlay.hidden = true;
    updateControls();
    render();
  }

  function startBattle() {
    if (ui.phase !== "setup") return;
    ui.phase = "battle";
    ui.swapSel = -1;
    ui.st.turn = HUMAN;
    updateControls();
    render();
  }

  function shufflePlayer() {
    if (ui.phase !== "setup") return;
    setupArmy(ui.st, HUMAN);
    ui.swapSel = -1;
    render();
  }

  function undo() {
    if (ui.phase !== "battle" || ui.busy || ui.history.length === 0) return;
    const snap = ui.history.pop();
    ui.st = snap.state;
    ui.stats = snap.stats;
    ui.selected = -1;
    ui.validMoves = [];
    ui.phase = "battle";
    els.overlay.hidden = true;
    updateControls();
    render();
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.start.addEventListener("click", startBattle);
  els.shuffle.addEventListener("click", shufflePlayer);
  els.undo.addEventListener("click", undo);

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
