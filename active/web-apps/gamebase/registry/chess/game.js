/*
 * Chess — Gamebase
 *
 * A self-contained standard-rules chess engine plus a clickable DOM board and
 * an alpha-beta AI. The engine is pure and attaches itself to the global as
 * `ChessEngine` so it can be exercised outside the browser.
 */
(function (root) {
  "use strict";

  // ----- Piece encoding -----------------------------------------------------
  // board values: 0 empty, else type*2 + color
  const EMPTY = 0;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 0, BLACK = 1;

  const pc = (type, color) => type * 2 + color;
  const ptype = (p) => p >> 1;
  const pcolor = (p) => p & 1;

  const KNIGHT_DIRS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const DIAG_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTH_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const sq = (f, r) => r * 8 + f;
  const fileOf = (s) => s & 7;
  const rankOf = (s) => s >> 3;

  // Piece-square tables (values from White's perspective, index 0 = a8).
  const PST = {};
  PST[PAWN] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ];
  PST[KNIGHT] = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ];
  PST[BISHOP] = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ];
  PST[ROOK] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ];
  PST[QUEEN] = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ];
  PST[KING] = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ];

  const PIECE_VALUE = { [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 0 };

  const FEN_TO_PIECE = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
  const START_BOARD = [
    "rnbqkbnr",
    "pppppppp",
    "........",
    "........",
    "........",
    "........",
    "PPPPPPPP",
    "RNBQKBNR",
  ];

  // ----- State --------------------------------------------------------------
  function createState() {
    const board = new Int16Array(64);
    for (let r = 0; r < 8; r++) {
      const row = START_BOARD[r];
      for (let f = 0; f < 8; f++) {
        const ch = row[f];
        if (ch === ".") continue;
        const type = FEN_TO_PIECE[ch.toLowerCase()];
        const color = ch === ch.toUpperCase() ? WHITE : BLACK;
        board[sq(f, r)] = pc(type, color);
      }
    }
    return {
      board,
      turn: WHITE,
      castling: { wk: true, wq: true, bk: true, bq: true },
      ep: -1,
      halfmove: 0,
      fullmove: 1,
      undoStack: [],
      keys: [],
    };
  }

  function cloneState(st) {
    return {
      board: st.board.slice(),
      turn: st.turn,
      castling: Object.assign({}, st.castling),
      ep: st.ep,
      halfmove: st.halfmove,
      fullmove: st.fullmove,
      undoStack: [],
      keys: st.keys.slice(),
    };
  }

  function positionKey(st) {
    let key = "";
    for (let i = 0; i < 64; i++) key += String.fromCharCode(48 + st.board[i]);
    key += st.turn ? "b" : "w";
    key += `${st.castling.wk ? "K" : ""}${st.castling.wq ? "Q" : ""}${st.castling.bk ? "k" : ""}${st.castling.bq ? "q" : ""}`;
    key += st.ep >= 0 ? String.fromCharCode(48 + st.ep) : "-";
    return key;
  }

  function findKing(board, color) {
    const target = pc(KING, color);
    for (let i = 0; i < 64; i++) if (board[i] === target) return i;
    return -1;
  }

  // ----- Attack detection ---------------------------------------------------
  function isAttacked(board, square, byColor) {
    const f = fileOf(square), r = rankOf(square);

    // Pawns: an attacker sits one rank "behind" the square relative to its march.
    const pawnRow = byColor === WHITE ? r + 1 : r - 1;
    if (pawnRow >= 0 && pawnRow < 8) {
      for (const df of [-1, 1]) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const p = board[sq(nf, pawnRow)];
        if (p && pcolor(p) === byColor && ptype(p) === PAWN) return true;
      }
    }

    // Knights.
    for (const [df, dr] of KNIGHT_DIRS) {
      const nf = f + df, nr = r + dr;
      if (!onBoard(nf, nr)) continue;
      const p = board[sq(nf, nr)];
      if (p && pcolor(p) === byColor && ptype(p) === KNIGHT) return true;
    }

    // King.
    for (const [df, dr] of KING_DIRS) {
      const nf = f + df, nr = r + dr;
      if (!onBoard(nf, nr)) continue;
      const p = board[sq(nf, nr)];
      if (p && pcolor(p) === byColor && ptype(p) === KING) return true;
    }

    // Diagonal sliders.
    for (const [df, dr] of DIAG_DIRS) {
      let nf = f + df, nr = r + dr;
      while (onBoard(nf, nr)) {
        const p = board[sq(nf, nr)];
        if (p) {
          if (pcolor(p) === byColor) {
            const t = ptype(p);
            if (t === BISHOP || t === QUEEN) return true;
          }
          break;
        }
        nf += df;
        nr += dr;
      }
    }

    // Orthogonal sliders.
    for (const [df, dr] of ORTH_DIRS) {
      let nf = f + df, nr = r + dr;
      while (onBoard(nf, nr)) {
        const p = board[sq(nf, nr)];
        if (p) {
          if (pcolor(p) === byColor) {
            const t = ptype(p);
            if (t === ROOK || t === QUEEN) return true;
          }
          break;
        }
        nf += df;
        nr += dr;
      }
    }

    return false;
  }

  function inCheck(st, color) {
    const k = findKing(st.board, color);
    if (k < 0) return false;
    return isAttacked(st.board, k, color ^ 1);
  }

  // ----- Move generation ----------------------------------------------------
  function pushPawnMove(moves, from, to, piece, flag, extra) {
    const m = {
      from,
      to,
      piece,
      captured: 0,
      flag: flag || "normal",
      promo: 0,
      capturedSq: -1,
    };
    if (extra) Object.assign(m, extra);
    moves.push(m);
  }

  function addPromotions(moves, from, to, piece, flag, capturedSq, captured) {
    for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
      moves.push({
        from, to, piece,
        captured: captured || 0,
        flag: flag || "normal",
        promo,
        capturedSq: capturedSq === undefined ? -1 : capturedSq,
      });
    }
  }

  function pseudoMoves(st) {
    const board = st.board;
    const us = st.turn;
    const them = us ^ 1;
    const moves = [];

    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (!p || pcolor(p) !== us) continue;
      const t = ptype(p);
      const f = fileOf(s), r = rankOf(s);

      if (t === PAWN) {
        const dir = us === WHITE ? -1 : 1;
        const startRank = us === WHITE ? 6 : 1;
        const promoRank = us === WHITE ? 0 : 7;
        const oneR = r + dir;
        if (onBoard(f, oneR) && board[sq(f, oneR)] === EMPTY) {
          if (oneR === promoRank) addPromotions(moves, s, sq(f, oneR), p, "normal");
          else pushPawnMove(moves, s, sq(f, oneR), p, "normal");
          if (r === startRank) {
            const twoR = r + 2 * dir;
            if (board[sq(f, twoR)] === EMPTY) pushPawnMove(moves, s, sq(f, twoR), p, "double");
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df, nr = r + dir;
          if (!onBoard(nf, nr)) continue;
          const to = sq(nf, nr);
          const q = board[to];
          if (q && pcolor(q) === them) {
            if (nr === promoRank) addPromotions(moves, s, to, p, "normal", -1, q);
            else pushPawnMove(moves, s, to, p, "normal", { captured: q });
          } else if (to === st.ep && q === EMPTY) {
            pushPawnMove(moves, s, to, p, "ep", { capturedSq: sq(nf, r) });
          }
        }
        continue;
      }

      if (t === KNIGHT || t === KING) {
        const dirs = t === KNIGHT ? KNIGHT_DIRS : KING_DIRS;
        for (const [df, dr] of dirs) {
          const nf = f + df, nr = r + dr;
          if (!onBoard(nf, nr)) continue;
          const to = sq(nf, nr);
          const q = board[to];
          if (q && pcolor(q) === us) continue;
          pushPawnMove(moves, s, to, p, "normal", { captured: q || 0 });
        }
        if (t === KING) addCastling(st, moves, s, us);
        continue;
      }

      const dirs = t === BISHOP ? DIAG_DIRS : t === ROOK ? ORTH_DIRS : DIAG_DIRS.concat(ORTH_DIRS);
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (onBoard(nf, nr)) {
          const to = sq(nf, nr);
          const q = board[to];
          if (!q) {
            pushPawnMove(moves, s, to, p, "normal");
          } else {
            if (pcolor(q) === them) pushPawnMove(moves, s, to, p, "normal", { captured: q });
            break;
          }
          nf += df;
          nr += dr;
        }
      }
    }
    return moves;
  }

  function addCastling(st, moves, kingSq, us) {
    const board = st.board;
    const opp = us ^ 1;
    if (us === WHITE) {
      if (kingSq !== 60) return;
      if (st.castling.wk && !board[61] && !board[62]) {
        if (!isAttacked(board, 60, opp) && !isAttacked(board, 61, opp) && !isAttacked(board, 62, opp)) {
          moves.push({ from: 60, to: 62, piece: pc(KING, WHITE), captured: 0, flag: "castle-k", promo: 0, capturedSq: -1 });
        }
      }
      if (st.castling.wq && !board[59] && !board[58] && !board[57]) {
        if (!isAttacked(board, 60, opp) && !isAttacked(board, 59, opp) && !isAttacked(board, 58, opp)) {
          moves.push({ from: 60, to: 58, piece: pc(KING, WHITE), captured: 0, flag: "castle-q", promo: 0, capturedSq: -1 });
        }
      }
    } else {
      if (kingSq !== 4) return;
      if (st.castling.bk && !board[5] && !board[6]) {
        if (!isAttacked(board, 4, opp) && !isAttacked(board, 5, opp) && !isAttacked(board, 6, opp)) {
          moves.push({ from: 4, to: 6, piece: pc(KING, BLACK), captured: 0, flag: "castle-k", promo: 0, capturedSq: -1 });
        }
      }
      if (st.castling.bq && !board[3] && !board[2] && !board[1]) {
        if (!isAttacked(board, 4, opp) && !isAttacked(board, 3, opp) && !isAttacked(board, 2, opp)) {
          moves.push({ from: 4, to: 2, piece: pc(KING, BLACK), captured: 0, flag: "castle-q", promo: 0, capturedSq: -1 });
        }
      }
    }
  }

  // ----- Make / unmake ------------------------------------------------------
  function makeMove(st, m) {
    const board = st.board;
    const us = pcolor(m.piece);
    const undo = {
      castling: Object.assign({}, st.castling),
      ep: st.ep,
      halfmove: st.halfmove,
      fullmove: st.fullmove,
      captured: 0,
    };

    if (m.flag === "ep") {
      undo.captured = board[m.capturedSq];
      board[m.capturedSq] = EMPTY;
    } else if (board[m.to]) {
      undo.captured = board[m.to];
    }

    board[m.to] = m.promo ? pc(m.promo, us) : m.piece;
    board[m.from] = EMPTY;

    if (m.flag === "castle-k") {
      if (us === WHITE) { board[61] = board[63]; board[63] = EMPTY; }
      else { board[5] = board[7]; board[7] = EMPTY; }
    } else if (m.flag === "castle-q") {
      if (us === WHITE) { board[59] = board[56]; board[56] = EMPTY; }
      else { board[3] = board[0]; board[0] = EMPTY; }
    }

    // Castling rights.
    const c = st.castling;
    if (ptype(m.piece) === KING) {
      if (us === WHITE) { c.wk = false; c.wq = false; }
      else { c.bk = false; c.bq = false; }
    }
    if (m.from === 63 || m.to === 63) c.wk = false;
    if (m.from === 56 || m.to === 56) c.wq = false;
    if (m.from === 7 || m.to === 7) c.bk = false;
    if (m.from === 0 || m.to === 0) c.bq = false;

    st.ep = m.flag === "double" ? (m.from + m.to) / 2 : -1;
    st.halfmove = ptype(m.piece) === PAWN || undo.captured ? 0 : st.halfmove + 1;
    if (us === BLACK) st.fullmove += 1;
    st.turn = us ^ 1;
    st.undoStack.push(undo);
    return undo;
  }

  function unmakeMove(st, m) {
    const undo = st.undoStack.pop();
    const board = st.board;
    const us = pcolor(m.piece);

    board[m.from] = m.piece;
    board[m.to] = undo.captured || EMPTY;
    if (m.flag === "ep") {
      board[m.capturedSq] = undo.captured;
      board[m.to] = EMPTY;
    }

    if (m.flag === "castle-k") {
      if (us === WHITE) { board[63] = board[61]; board[61] = EMPTY; }
      else { board[7] = board[5]; board[5] = EMPTY; }
    } else if (m.flag === "castle-q") {
      if (us === WHITE) { board[56] = board[59]; board[59] = EMPTY; }
      else { board[0] = board[3]; board[3] = EMPTY; }
    }

    st.castling = undo.castling;
    st.ep = undo.ep;
    st.halfmove = undo.halfmove;
    st.fullmove = undo.fullmove;
    st.turn = us;
  }

  function legalMoves(st) {
    const us = st.turn;
    const pseudo = pseudoMoves(st);
    const out = [];
    for (const m of pseudo) {
      makeMove(st, m);
      const k = findKing(st.board, us);
      if (k >= 0 && !isAttacked(st.board, k, us ^ 1)) out.push(m);
      unmakeMove(st, m);
    }
    return out;
  }

  // ----- Game status --------------------------------------------------------
  function insufficientMaterial(board) {
    const minors = [];
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p || ptype(p) === KING) continue;
      const t = ptype(p);
      if (t !== BISHOP && t !== KNIGHT) return false; // pawn/rook/queen can mate
      minors.push({ type: t, color: pcolor(p), square: i });
    }
    if (minors.length === 0) return true;                 // K vs K
    if (minors.length === 1) return true;                 // K+minor vs K
    if (
      minors.length === 2 &&
      minors[0].type === BISHOP &&
      minors[1].type === BISHOP &&
      minors[0].color !== minors[1].color
    ) {
      // K+B vs K+B is a draw only when the bishops share a square colour.
      const colour = (square) => (Math.floor(square / 8) + (square % 8)) % 2;
      return colour(minors[0].square) === colour(minors[1].square);
    }
    // K+B+B, K+N+N, etc. are not automatic draws — mate is still possible.
    return false;
  }

  function repetitionCount(st) {
    if (st.keys.length === 0) return 1;
    const current = st.keys[st.keys.length - 1];
    let count = 0;
    for (const k of st.keys) if (k === current) count++;
    return count;
  }

  // Result is reported for the side that just moved (`st.turn` is the loser of
  // the initiative). Returns null while the game is live.
  function gameStatus(st) {
    const moves = legalMoves(st);
    if (moves.length === 0) {
      if (inCheck(st, st.turn)) {
        return { over: true, reason: "checkmate", winner: st.turn ^ 1 };
      }
      return { over: true, reason: "stalemate", winner: -1 };
    }
    if (st.halfmove >= 100) return { over: true, reason: "fifty-move", winner: -1 };
    if (repetitionCount(st) >= 3) return { over: true, reason: "threefold", winner: -1 };
    if (insufficientMaterial(st.board)) return { over: true, reason: "insufficient", winner: -1 };
    return null;
  }

  // ----- Evaluation & search ------------------------------------------------
  function evaluate(st) {
    let score = 0;
    const board = st.board;
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const t = ptype(p);
      const color = pcolor(p);
      const tableIndex = color === WHITE ? i : i ^ 56;
      const value = PIECE_VALUE[t] + (PST[t] ? PST[t][tableIndex] : 0);
      score += color === WHITE ? value : -value;
    }
    return st.turn === WHITE ? score : -score;
  }

  const MATE = 100000;

  function orderMoves(moves) {
    moves.sort((a, b) => scoreMove(b) - scoreMove(a));
  }

  function scoreMove(m) {
    let s = 0;
    if (m.captured) s += 10 * PIECE_VALUE[ptype(m.captured)] - PIECE_VALUE[ptype(m.piece)];
    if (m.promo) s += PIECE_VALUE[m.promo];
    return s;
  }

  function quiesce(st, alpha, beta, depth) {
    const stand = evaluate(st);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha;

    const moves = legalMoves(st).filter((m) => m.captured || m.flag === "ep" || m.promo);
    orderMoves(moves);
    for (const m of moves) {
      makeMove(st, m);
      const val = -quiesce(st, -beta, -alpha, depth - 1);
      unmakeMove(st, m);
      if (val >= beta) return beta;
      if (val > alpha) alpha = val;
    }
    return alpha;
  }

  function negamax(st, depth, alpha, beta, ply) {
    const moves = legalMoves(st);
    if (moves.length === 0) {
      return inCheck(st, st.turn) ? -MATE + ply : 0;
    }
    if (st.halfmove >= 100 || repetitionCount(st) >= 3 || insufficientMaterial(st.board)) return 0;
    if (depth <= 0) return quiesce(st, alpha, beta, 4);

    orderMoves(moves);
    let best = -Infinity;
    for (const m of moves) {
      makeMove(st, m);
      const val = -negamax(st, depth - 1, -beta, -alpha, ply + 1);
      unmakeMove(st, m);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestMove(st, depth) {
    const moves = legalMoves(st);
    if (moves.length === 0) return null;
    orderMoves(moves);
    let alpha = -Infinity;
    let bestScore = -Infinity;
    let candidates = [];
    for (const m of moves) {
      makeMove(st, m);
      const val = -negamax(st, depth - 1, -Infinity, -alpha, 1);
      unmakeMove(st, m);
      if (val > bestScore + 0.5) {
        bestScore = val;
        candidates = [m];
        if (val > alpha) alpha = val;
      } else if (Math.abs(val - bestScore) <= 0.5) {
        candidates.push(m);
      }
    }
    return candidates[Math.floor(Math.random() * candidates.length)] || moves[0];
  }

  const ENGINE = {
    WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    pc, ptype, pcolor, sq, fileOf, rankOf,
    createState, cloneState, positionKey, legalMoves, pseudoMoves,
    makeMove, unmakeMove, inCheck, isAttacked, findKing, gameStatus,
    evaluate, bestMove, insufficientMaterial, repetitionCount,
  };

  root.ChessEngine = ENGINE;

  // ----- UI -----------------------------------------------------------------
  if (typeof document === "undefined") return;

  const GLYPH = {
    [pc(KING, WHITE)]: "\u2654", [pc(QUEEN, WHITE)]: "\u2655", [pc(ROOK, WHITE)]: "\u2656",
    [pc(BISHOP, WHITE)]: "\u2657", [pc(KNIGHT, WHITE)]: "\u2658", [pc(PAWN, WHITE)]: "\u2659",
    [pc(KING, BLACK)]: "\u265A", [pc(QUEEN, BLACK)]: "\u265B", [pc(ROOK, BLACK)]: "\u265C",
    [pc(BISHOP, BLACK)]: "\u265D", [pc(KNIGHT, BLACK)]: "\u265E", [pc(PAWN, BLACK)]: "\u265F",
  };

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    tag: document.getElementById("tag"),
    capturedWhite: document.getElementById("captured-white"),
    capturedBlack: document.getElementById("captured-black"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    promo: document.getElementById("promo"),
    promoOptions: document.getElementById("promo-options"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    sideBtn: document.getElementById("side"),
    undoBtn: document.getElementById("undo"),
  };

  const ui = {
    st: createState(),
    selected: -1,
    legalForSelected: [],
    lastMove: null,
    mode: "ai",           // "ai" | "human"
    humanColor: WHITE,    // in AI mode
    busy: false,
    finished: false,
    moveCount: 0,
    captured: [],         // captured piece codes in order
  };
  ui.st.keys.push(positionKey(ui.st));

  let squareEls = [];

  function buildBoard() {
    els.board.innerHTML = "";
    squareEls = [];
    for (let s = 0; s < 64; s++) {
      const f = fileOf(s), r = rankOf(s);
      const div = document.createElement("div");
      div.className = "sq " + ((f + r) % 2 === 0 ? "light" : "dark");
      div.dataset.sq = String(s);
      div.setAttribute("role", "gridcell");
      div.addEventListener("click", () => onSquareClick(s));
      els.board.appendChild(div);
      squareEls.push(div);
    }
  }

  function render() {
    const st = ui.st;
    const checkColor = inCheck(st, st.turn) ? st.turn : -1;
    const kingSq = checkColor >= 0 ? findKing(st.board, checkColor) : -1;
    for (let s = 0; s < 64; s++) {
      const el = squareEls[s];
      const p = st.board[s];
      el.className = "sq " + (((fileOf(s) + rankOf(s)) % 2 === 0) ? "light" : "dark");
      el.innerHTML = "";
      if (p) {
        const span = document.createElement("span");
        span.className = "piece " + (pcolor(p) === WHITE ? "w" : "b");
        span.textContent = GLYPH[p];
        el.appendChild(span);
      }
      if (ui.lastMove && (s === ui.lastMove.from || s === ui.lastMove.to)) el.classList.add("last");
      if (s === ui.selected) el.classList.add("sel");
      if (s === kingSq) el.classList.add("check");
      if (ui.legalForSelected.some((m) => m.to === s)) {
        const marker = document.createElement("span");
        marker.className = p || ui.legalForSelected.find((m) => m.to === s && m.flag === "ep") ? "ring" : "dot";
        el.appendChild(marker);
      }
    }
    renderCaptured();
    renderStatus();
  }

  function renderCaptured() {
    const whiteLost = ui.captured.filter((p) => pcolor(p) === WHITE).map((p) => GLYPH[p]).join("");
    const blackLost = ui.captured.filter((p) => pcolor(p) === BLACK).map((p) => GLYPH[p]).join("");
    els.capturedWhite.textContent = whiteLost;
    els.capturedBlack.textContent = blackLost;
  }

  function sideName(c) { return c === WHITE ? "White" : "Black"; }

  function renderStatus() {
    if (ui.finished) {
      els.status.textContent = ui.finishedText || "Game over";
      return;
    }
    const st = ui.st;
    const check = inCheck(st, st.turn) ? " — check!" : "";
    if (ui.mode === "ai") {
      if (st.turn === ui.humanColor) els.status.textContent = `Your move (${sideName(st.turn)})${check}`;
      else els.status.textContent = `AI thinking…${check}`;
    } else {
      els.status.textContent = `${sideName(st.turn)} to move${check}`;
    }
  }

  function onSquareClick(s) {
    if (ui.busy || ui.finished) return;
    const st = ui.st;
    if (ui.mode === "ai" && st.turn !== ui.humanColor) return;
    const p = st.board[s];
    if (p && pcolor(p) === st.turn) {
      ui.selected = s;
      ui.legalForSelected = legalMoves(st).filter((m) => m.from === s);
      render();
      return;
    }
    const move = ui.legalForSelected.find((m) => m.to === s);
    if (move) {
      if (move.promo) {
        askPromotion(move);
      } else {
        applyMove(move);
      }
    } else {
      ui.selected = -1;
      ui.legalForSelected = [];
      render();
    }
  }

  function askPromotion(move) {
    ui.promo.hidden = false;
    els.promoOptions.innerHTML = "";
    const color = pcolor(move.piece);
    for (const type of [QUEEN, ROOK, BISHOP, KNIGHT]) {
      const btn = document.createElement("button");
      btn.textContent = GLYPH[pc(type, color)];
      btn.setAttribute("aria-label", ["", "", "knight", "bishop", "rook", "queen"][type] || "piece");
      btn.addEventListener("click", () => {
        ui.promo.hidden = true;
        applyMove(Object.assign({}, move, { promo: type }));
      });
      els.promoOptions.appendChild(btn);
    }
  }

  function applyMove(move) {
    const st = ui.st;
    const wasCastle = move.flag === "castle-k" || move.flag === "castle-q";
    const wasPromo = Boolean(move.promo);
    const capturedPiece = move.flag === "ep" ? st.board[move.capturedSq] : st.board[move.to];
    makeMove(st, move);
    st.keys.push(positionKey(st));
    ui.lastMove = { from: move.from, to: move.to };
    ui.selected = -1;
    ui.legalForSelected = [];
    ui.moveCount += 1;
    ui.moveHistory.push(move);
    if (capturedPiece) ui.captured.push(capturedPiece);

    if (wasCastle && pcolor(move.piece) === ui.humanColor) manualUnlocks.add("castled");
    if (wasPromo && pcolor(move.piece) === ui.humanColor) manualUnlocks.add("promoted");

    render();
    finishIfOver();
    if (!ui.finished && ui.mode === "ai" && st.turn !== ui.humanColor) {
      scheduleAI();
    }
  }

  const manualUnlocks = new Set();

  function scheduleAI() {
    ui.busy = true;
    renderStatus();
    setTimeout(() => {
      if (ui.finished) { ui.busy = false; return; }
      const move = bestMove(ui.st, 3);
      ui.busy = false;
      if (!move) { finishIfOver(); return; }
      applyMove(move);
    }, 60);
  }

  function finishIfOver() {
    if (ui.finished) return;
    const status = gameStatus(ui.st);
    if (!status) return;
    ui.finished = true;
    let result;
    let title;
    let body;
    if (status.reason === "checkmate") {
      if (ui.mode === "ai") {
        if (status.winner === ui.humanColor) { result = "win"; title = "Checkmate — you win!"; }
        else { result = "loss"; title = "Checkmate — AI wins"; }
      } else {
        result = status.winner === WHITE ? "win" : "loss";
        title = `Checkmate — ${sideName(status.winner)} wins`;
      }
      body = "The king has nowhere to run.";
    } else {
      result = "draw";
      title = "Draw";
      body = {
        stalemate: "Stalemate — no legal moves.",
        "fifty-move": "Drawn by the fifty-move rule.",
        threefold: "Drawn by threefold repetition.",
        insufficient: "Drawn — insufficient material.",
      }[status.reason] || "Drawn.";
    }

    // In AI mode a win for the human is the only "win"; if the human plays
    // Black, a black win still counts as the human's win.
    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    manualUnlocks.add("first-move");
    ui.finishedText = title;
    showOverlay(title, body);
    render();

    const unlock = Array.from(manualUnlocks);
    Gamebase.endRun({
      score,
      meta: {
        result,
        mode: ui.mode,
        moves: ui.moveCount,
        reason: status.reason,
        color: ui.mode === "ai" ? sideName(ui.humanColor).toLowerCase() : "white",
      },
      unlock,
    }).catch((err) => console.warn("[chess] endRun failed", err));
  }

  function showOverlay(title, body) {
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    els.overlay.hidden = false;
  }

  function newGame() {
    ui.st = createState();
    ui.st.keys.push(positionKey(ui.st));
    ui.selected = -1;
    ui.legalForSelected = [];
    ui.lastMove = null;
    ui.busy = false;
    ui.finished = false;
    ui.finishedText = "";
    ui.moveCount = 0;
    ui.captured = [];
    manualUnlocks.clear();
    els.overlay.hidden = true;
    els.promo.hidden = true;
    render();
    if (ui.mode === "ai" && ui.st.turn !== ui.humanColor) scheduleAI();
  }

  function undo() {
    if (ui.busy) return;
    if (ui.st.undoStack.length === 0) return;
    // Pop the last ply, then keep popping AI plies so control returns to the
    // human when playing against the AI.
    popMove();
    if (ui.mode === "ai") {
      while (ui.st.undoStack.length && ui.st.turn !== ui.humanColor) popMove();
    }
    ui.finished = false;
    ui.finishedText = "";
    els.overlay.hidden = true;
    ui.selected = -1;
    ui.legalForSelected = [];
    render();
  }

  function popMove() {
    const st = ui.st;
    if (st.undoStack.length === 0) return;
    // Reconstruct the move from the stack is not stored, so regenerate legal
    // moves and find the one matching the resulting position.
    // Simpler: we keep our own move list.
    const m = ui.moveHistory.pop();
    if (!m) return;
    unmakeMove(st, m);
    if (st.keys.length) st.keys.pop();
    if (ui.captured.length && (m.captured || m.flag === "ep")) ui.captured.pop();
    ui.moveCount = Math.max(0, ui.moveCount - 1);
    ui.lastMove = ui.moveHistory.length ? { from: ui.moveHistory[ui.moveHistory.length - 1].from, to: ui.moveHistory[ui.moveHistory.length - 1].to } : null;
  }

  ui.moveHistory = [];

  function setMode(next) {
    ui.mode = next;
    els.modeBtn.textContent = next === "ai" ? "Mode: vs AI" : "Mode: 2-player";
    els.sideBtn.hidden = next !== "ai";
    newGame();
  }

  function toggleSide() {
    ui.humanColor = ui.humanColor === WHITE ? BLACK : WHITE;
    els.sideBtn.textContent = "Play: " + sideName(ui.humanColor);
    newGame();
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);
  els.modeBtn.addEventListener("click", () => setMode(ui.mode === "ai" ? "human" : "ai"));
  els.sideBtn.addEventListener("click", toggleSide);
  els.undoBtn.addEventListener("click", undo);

  // Keyboard: arrow keys move a focus cursor, Enter selects/plays.
  let focusSq = 52; // e2-ish
  document.addEventListener("keydown", (e) => {
    const map = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 };
    if (map[e.key] !== undefined) {
      const target = focusSq + map[e.key];
      if (target >= 0 && target < 64 && Math.abs(fileOf(target) - fileOf(focusSq)) <= 1) {
        squareEls[focusSq].classList.remove("focus");
        focusSq = target;
        squareEls[focusSq].classList.add("focus");
        e.preventDefault();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      onSquareClick(focusSq);
      e.preventDefault();
    }
  });

  buildBoard();
  render();

  Gamebase.ready()
    .then((player) => {
      els.tag.textContent = player.handle;
      return Gamebase.myBest();
    })
    .then((best) => {
      if (best) els.tag.textContent = (Gamebase.player && Gamebase.player.handle ? Gamebase.player.handle + " · " : "") + "best " + best.best;
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[chess] Gamebase offline", err);
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
