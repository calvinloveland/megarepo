/*
 * Mancala (Kalah) — Gamebase
 *
 * Standard Kalah rules: six pits plus a store per side, sow counter-clockwise
 * and skip the opponent's store, extra turn on landing in your own store, and
 * a capture when you land in your own empty pit (taking the opposite pit too).
 * The game ends when one side is empty; the other side collects the remainder.
 *
 * Opponents: a minimax / alpha-beta AI (depth 6), a local two-player opponent,
 * or an online turn-based match relayed through the Gamebase match API.
 *
 * The pure engine is exposed as the global `MancalaEngine` so it can be
 * exercised headlessly with `node`.
 */
(function (root) {
  "use strict";

  // ── Engine ───────────────────────────────────────────────────────────────
  // The board is a 14-slot ring in physical (counter-clockwise) order:
  //   [0..5]  player 1 pits  ->  [6] player 1 store
  //   [7..12] player 2 pits  ->  [13] player 2 store
  const RING_SIZE = 14;
  const P1_STORE = 6;
  const P2_STORE = 13;
  const P1_PITS = [0, 1, 2, 3, 4, 5];
  const P2_PITS = [7, 8, 9, 10, 11, 12];

  const pitsFor = (player) => (player === 0 ? P1_PITS : P2_PITS);
  const storeFor = (player) => (player === 0 ? P1_STORE : P2_STORE);
  const pitRing = (player, pit) => (player === 0 ? pit : 7 + pit);

  function createGame() {
    const ring = [];
    for (let i = 0; i < RING_SIZE; i++) ring.push(4);
    ring[P1_STORE] = 0;
    ring[P2_STORE] = 0;
    return { ring, turn: 0, over: false, winner: null, extra: false, captured: 0 };
  }

  function cloneGame(game) {
    return {
      ring: game.ring.slice(),
      turn: game.turn,
      over: game.over,
      winner: game.winner,
      extra: false,
      captured: 0,
    };
  }

  function sideCount(ring, player) {
    return pitsFor(player).reduce((sum, index) => sum + ring[index], 0);
  }

  function legalMoves(game) {
    if (game.over) return [];
    const moves = [];
    pitsFor(game.turn).forEach((ringIndex, pit) => {
      if (game.ring[ringIndex] > 0) moves.push(pit);
    });
    return moves;
  }

  function finishIfOver(game) {
    const firstEmpty = sideCount(game.ring, 0) === 0;
    const secondEmpty = sideCount(game.ring, 1) === 0;
    if (firstEmpty) {
      game.over = true;
      game.ring[P2_STORE] += sideCount(game.ring, 1);
    } else if (secondEmpty) {
      game.over = true;
      game.ring[P1_STORE] += sideCount(game.ring, 0);
    }
    if (game.over) {
      const a = game.ring[P1_STORE];
      const b = game.ring[P2_STORE];
      game.winner = a > b ? 0 : b > a ? 1 : -1;
    }
    return game;
  }

  function applyMove(game, pit) {
    const next = cloneGame(game);
    if (next.over) return next;
    const player = next.turn;
    const myStore = storeFor(player);
    const oppStore = storeFor(1 - player);
    const ring = next.ring;

    let pos = pitRing(player, pit);
    let marbles = ring[pos];
    if (marbles <= 0) return next;
    ring[pos] = 0;

    let landed = pos;
    while (marbles > 0) {
      pos = (pos + 1) % RING_SIZE;
      if (pos === oppStore) continue; // skip the opponent's store
      ring[pos] += 1;
      landed = pos;
      marbles -= 1;
    }

    if (pitsFor(player).indexOf(landed) !== -1 && ring[landed] === 1) {
      const opposite = 12 - landed;
      if (ring[opposite] > 0) {
        next.captured = ring[opposite] + 1;
        ring[myStore] += next.captured;
        ring[opposite] = 0;
        ring[landed] = 0;
      }
    }

    finishIfOver(next);
    if (!next.over) {
      next.extra = landed === myStore;
      if (!next.extra) next.turn = 1 - player;
    }
    return next;
  }

  function evaluate(game, ai) {
    const opp = 1 - ai;
    const storeDiff = game.ring[storeFor(ai)] - game.ring[storeFor(opp)];
    const pitDiff = sideCount(game.ring, ai) - sideCount(game.ring, opp);
    return storeDiff * 10 + pitDiff;
  }

  function minimax(game, depth, alpha, beta, ai) {
    if (game.over || depth === 0) return evaluate(game, ai);
    const maximizing = game.turn === ai;
    const moves = legalMoves(game);
    if (moves.length === 0) return evaluate(game, ai);
    let best = maximizing ? -Infinity : Infinity;
    for (const move of moves) {
      const value = minimax(applyMove(game, move), depth - 1, alpha, beta, ai);
      if (maximizing) {
        best = Math.max(best, value);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, value);
        beta = Math.min(beta, best);
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function chooseMove(game, ai, depth) {
    const moves = legalMoves(game);
    if (moves.length === 0) return -1;
    let bestScore = -Infinity;
    let choice = moves[0];
    for (const move of moves) {
      const value = minimax(applyMove(game, move), depth - 1, -Infinity, Infinity, ai);
      if (value > bestScore) {
        bestScore = value;
        choice = move;
      }
    }
    return choice;
  }

  const serializeGame = (game) => ({
    ring: game.ring.slice(),
    turn: game.turn,
    over: game.over,
    winner: game.winner,
  });

  function deserializeGame(state) {
    if (!state || !Array.isArray(state.ring) || state.ring.length !== RING_SIZE) return null;
    return {
      ring: state.ring.slice(),
      turn: state.turn === 1 ? 1 : 0,
      over: Boolean(state.over),
      winner: typeof state.winner === "number" ? state.winner : null,
      extra: false,
      captured: 0,
    };
  }

  root.MancalaEngine = {
    RING_SIZE, P1_STORE, P2_STORE, P1_PITS, P2_PITS,
    createGame, sideCount, legalMoves, applyMove, chooseMove, serializeGame, deserializeGame,
  };

  // ── UI ───────────────────────────────────────────────────────────────────
  if (typeof document === "undefined") return;

  const AI_DEPTH = 6;
  const MODES = ["ai", "local", "online"];
  const MODE_LABELS = {
    ai: "Mode: vs AI",
    local: "Mode: 2-player",
    online: "Mode: Online",
  };

  const els = {
    board: document.getElementById("board"),
    status: document.getElementById("status"),
    tally: document.getElementById("tally"),
    tag: document.getElementById("tag"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
    modeBtn: document.getElementById("mode"),
    resetTally: document.getElementById("reset-tally"),
  };

  const overlay = GameKit.overlay({
    overlay: els.overlay,
    title: els.overlayTitle,
    body: els.overlayBody,
    button: els.overlayBtn,
  });

  const ui = {
    game: createGame(),
    mode: "ai",
    human: 0,
    ai: 1,
    busy: false,
    finished: false,
    moveCount: 0,
    totalCaptured: 0,
    tally: { wins: 0, draws: 0, losses: 0, streak: 0 },
    revision: 0,
  };

  const online = {
    matchId: null,
    myIndex: 0,
    revision: 0,
    stop: null,
    active: false,
  };

  const manualUnlocks = new Set();
  const pitButtons = {};
  const storeButtons = {};

  function buildBoard() {
    els.board.innerHTML = "";
    const addStore = (player, className) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "store " + className;
      button.dataset.role = "store";
      button.dataset.player = String(player);
      button.setAttribute("aria-label", "player " + (player + 1) + " store");
      button.disabled = true;
      els.board.appendChild(button);
      storeButtons[player] = button;
    };
    const addPit = (player, pit) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pit";
      button.dataset.role = "pit";
      button.dataset.player = String(player);
      button.dataset.pit = String(pit);
      button.setAttribute("aria-label", "player " + (player + 1) + " pit " + (pit + 1));
      button.addEventListener("click", () => onPitClick(player, pit));
      els.board.appendChild(button);
      pitButtons[player + "-" + pit] = button;
    };
    const addSpacer = () => {
      const span = document.createElement("span");
      span.className = "spacer";
      els.board.appendChild(span);
    };

    // Top row: opponent store, opponent pits (5..0), player store.
    addStore(1, "opponent-store");
    for (let pit = 5; pit >= 0; pit--) addPit(1, pit);
    addStore(0, "human-store");
    // Bottom row: spacer, player pits (0..5), spacer.
    addSpacer();
    for (let pit = 0; pit < 6; pit++) addPit(0, pit);
    addSpacer();
  }

  function humanControls(player) {
    if (ui.mode === "local") return true;
    if (ui.mode === "online") return player === online.myIndex;
    return player === ui.human;
  }

  function canClickPit(player, pit) {
    if (ui.game.over || ui.busy) return false;
    if (ui.game.turn !== player || !humanControls(player)) return false;
    return ui.game.ring[pitRing(player, pit)] > 0;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function render() {
    const game = ui.game;
    for (let player = 0; player < 2; player++) {
      for (let pit = 0; pit < 6; pit++) {
        const button = pitButtons[player + "-" + pit];
        const count = game.ring[pitRing(player, pit)];
        button.textContent = String(count);
        button.classList.toggle("empty", count === 0);
        button.classList.toggle("active-pit", !game.over && game.turn === player && count > 0 && humanControls(player));
        button.disabled = !canClickPit(player, pit);
      }
      storeButtons[player].textContent = String(game.ring[storeFor(player)]);
      storeButtons[player].disabled = true;
    }
    els.tally.textContent = `W ${ui.tally.wins} · D ${ui.tally.draws} · L ${ui.tally.losses}`;
    renderStatus();
  }

  function renderStatus() {
    if (ui.game.over) {
      if (ui.game.winner === -1) setStatus("Game over — draw.");
      else if (ui.mode === "local") setStatus("Game over — Player " + (ui.game.winner + 1) + " wins!");
      else setStatus(ui.game.winner === ui.human ? "Game over — you win!" : "Game over — you lose.");
      return;
    }
    if (ui.busy) {
      setStatus("AI thinking…");
    } else if (ui.mode === "ai") {
      setStatus(ui.game.turn === ui.human ? "Your move." : "AI to move…");
    } else if (ui.mode === "online") {
      if (!online.matchId) setStatus("Finding an opponent…");
      else if (ui.game.turn === online.myIndex) setStatus("Your move.");
      else setStatus("Waiting for opponent…");
    } else {
      setStatus("Player " + (ui.game.turn + 1) + "'s move.");
    }
  }

  function onPitClick(player, pit) {
    if (!canClickPit(player, pit)) return;
    commitMove(applyMove(ui.game, pit));
  }

  function commitMove(next) {
    ui.moveCount += 1;
    if (next.captured) ui.totalCaptured += next.captured;
    ui.game = next;
    render();
    afterMove();
  }

  function afterMove() {
    if (ui.game.over) {
      finish();
      return;
    }
    if (ui.mode === "ai" && ui.game.turn === ui.ai) scheduleAI();
    if (ui.mode === "online") publishOnline();
  }

  function scheduleAI() {
    if (ui.busy || ui.finished) return;
    ui.busy = true;
    render();
    setTimeout(() => {
      ui.busy = false;
      if (ui.finished || ui.mode !== "ai" || ui.game.turn !== ui.ai) {
        render();
        return;
      }
      const move = chooseMove(ui.game, ui.ai, AI_DEPTH);
      if (move < 0) {
        finish();
        return;
      }
      ui.moveCount += 1;
      const next = applyMove(ui.game, move);
      if (next.captured) ui.totalCaptured += next.captured;
      ui.game = next;
      render();
      if (ui.game.over) {
        finish();
        return;
      }
      if (ui.game.turn === ui.ai) scheduleAI();
      else if (ui.mode === "online") publishOnline();
    }, 320);
  }

  function finish() {
    if (ui.finished) return;
    if (ui.mode === "online" && online.matchId) {
      // Relay the terminal state so the opponent's poll sees the final board.
      try {
        GameKit.online.publish(online.matchId, serializeGame(ui.game), online.revision).catch(() => {});
      } catch (error) { /* offline */ }
    }
    ui.finished = true;
    stopOnlinePoll();
    const game = ui.game;
    const result = game.winner === -1 ? "draw" : game.winner === ui.human ? "win" : "loss";

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
    manualUnlocks.add("first-game");

    const score = result === "win" ? 3 : result === "draw" ? 1 : 0;
    const title = result === "win" ? "You win!" : result === "draw" ? "Draw" : "You lose";
    const margin = Math.abs(game.ring[P1_STORE] - game.ring[P2_STORE]);
    const body = result === "draw"
      ? "Both stores hold " + game.ring[P1_STORE] + " stones."
      : (result === "win" ? "You win by " : "You lose by ") + margin + " stones.";

    overlay.show(title, body, "New game", newGame);
    render();
    persistTally();

    if (ui.mode === "online" && online.matchId) {
      try {
        Gamebase.reportResult(online.matchId, { result }).catch(() => {});
      } catch (error) { /* offline */ }
    }

    try {
      Gamebase.endRun({
        score,
        meta: {
          result,
          mode: ui.mode,
          moves: ui.moveCount,
          captured: ui.totalCaptured,
          streak: ui.tally.streak,
        },
        unlock: Array.from(manualUnlocks),
      }).catch(() => {});
    } catch (error) { /* offline */ }
  }

  function resetGame() {
    ui.game = createGame();
    ui.busy = false;
    ui.finished = false;
    ui.moveCount = 0;
    ui.totalCaptured = 0;
    if (ui.mode !== "online") ui.human = 0;
  }

  function newGame() {
    resetGame();
    overlay.hide();
    render();
    if (ui.mode === "online") startOnline();
  }

  // ── Online ───────────────────────────────────────────────────────────────

  function stopOnlinePoll() {
    if (online.stop) {
      online.stop();
      online.stop = null;
    }
  }

  async function startOnline() {
    stopOnlinePoll();
    online.active = true;
    online.matchId = null;
    resetGame();
    ui.finished = false;
    render();
    setStatus("Finding an opponent…");
    try {
      const match = await GameKit.online.findMatch();
      if (ui.mode !== "online" || !online.active) return;
      if (!match) {
        setStatus("No opponent found — try again.");
        return;
      }
      const me = Gamebase.player;
      online.matchId = match.id;
      online.myIndex = match.players[0].player_id === me.id ? 0 : 1;
      ui.human = online.myIndex;
      online.revision = match.revision || 0;
      const remote = deserializeGame(match.game_state);
      if (remote) ui.game = remote;
      ui.finished = false;
      render();
      if (ui.game.over) {
        finish();
        return;
      }
      online.stop = GameKit.online.poll(online.matchId, onRemoteState, 1500);
    } catch (error) {
      if (ui.mode === "online") setStatus("Matchmaking failed — try again.");
    }
  }

  function onRemoteState(match) {
    if (ui.finished || ui.mode !== "online") return;
    if (typeof match.revision === "number" && match.revision > online.revision) {
      online.revision = match.revision;
    }
    const remote = deserializeGame(match.game_state);
    if (!remote) return;
    ui.game = remote;
    render();
    if (ui.game.over) finish();
  }

  async function publishOnline() {
    if (!online.matchId || ui.finished) return;
    try {
      const saved = await GameKit.online.publish(
        online.matchId,
        serializeGame(ui.game),
        online.revision
      );
      if (saved && typeof saved.revision === "number") online.revision = saved.revision;
    } catch (error) {
      if (error && error.status === 409) {
        try {
          const match = await Gamebase.match(online.matchId);
          if (match) {
            online.revision = match.revision || 0;
            onRemoteState(match);
          }
        } catch (inner) { /* keep playing */ }
      }
    }
  }

  // ── Modes, tally, boot ───────────────────────────────────────────────────

  function setMode(next) {
    ui.mode = next;
    online.active = next === "online";
    stopOnlinePoll();
    resetGame();
    overlay.hide();
    render();
    if (next === "online") startOnline();
  }

  function resetTally() {
    ui.tally = { wins: 0, draws: 0, losses: 0, streak: 0 };
    render();
    persistTally();
  }

  function persistTally() {
    if (!root.Gamebase || !Gamebase.player) return;
    try {
      Gamebase.saveState({ tally: ui.tally }, { revision: ui.revision })
        .then((saved) => {
          if (saved && typeof saved.revision === "number") ui.revision = saved.revision;
        })
        .catch(() => {});
    } catch (error) { /* offline */ }
  }

  GameKit.modeCycle(els.modeBtn, MODES, MODE_LABELS, () => ui.mode, setMode);
  els.newGame.addEventListener("click", newGame);
  els.resetTally.addEventListener("click", resetTally);

  buildBoard();
  render();

  try {
    GameKit.ready({ tagElement: els.tag, onPlayer: async (player) => {
      try {
        const saved = await Gamebase.loadState();
        if (saved && saved.state && saved.state.tally) {
          ui.tally = Object.assign(ui.tally, saved.state.tally);
          ui.revision = saved.revision || 0;
          render();
        }
      } catch (error) { /* no saved state */ }
      try {
        const best = await Gamebase.myBest();
        if (best) els.tag.textContent = player.handle + " · best " + best.best;
      } catch (error) { /* no best yet */ }
    } }).catch(() => {
      els.tag.textContent = "guest";
    });
  } catch (error) {
    els.tag.textContent = "guest";
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
