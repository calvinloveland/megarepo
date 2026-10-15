/*
 * Memory Match — Gamebase
 *
 * Eight emoji pairs face down in a 4x4 grid. Flip two cards at a time; a pair
 * stays face up, a mismatch turns back. Score rewards efficiency: fewer moves
 * and less time means a higher score.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const SYMBOLS = ["🍎", "🍌", "🍇", "🍒", "🍑", "🍍", "🥝", "🍉"];
  const PAIRS = SYMBOLS.length;

  const els = {
    board: document.getElementById("board"),
    score: document.getElementById("score"),
    moves: document.getElementById("moves"),
    time: document.getElementById("time"),
    best: document.getElementById("best"),
    tag: document.getElementById("tag"),
    status: document.getElementById("status"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayBody: document.getElementById("overlay-body"),
    overlayBtn: document.getElementById("overlay-btn"),
    newGame: document.getElementById("new-game"),
  };

  const ui = {
    cards: [],
    nodes: [],
    firstIndex: null,
    lock: false,
    moves: 0,
    matchedPairs: 0,
    best: 0,
    startedAt: 0,
    elapsed: 0,
    timerId: null,
    over: false,
    submitted: false,
    manualUnlocks: new Set(),
  };

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  function buildDeck() {
    const deck = [];
    SYMBOLS.forEach((symbol, id) => {
      deck.push({ symbol: symbol, id: id, flipped: false, matched: false });
      deck.push({ symbol: symbol, id: id, flipped: false, matched: false });
    });
    return shuffle(deck);
  }

  function buildBoard() {
    els.board.innerHTML = "";
    ui.nodes = [];
    ui.cards.forEach((card, index) => {
      const button = document.createElement("button");
      button.className = "card";
      button.type = "button";
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", "Hidden card");
      button.dataset.index = String(index);

      const inner = document.createElement("div");
      inner.className = "card-inner";

      const back = document.createElement("div");
      back.className = "card-face card-back";
      back.textContent = "?";

      const front = document.createElement("div");
      front.className = "card-face card-front";
      front.textContent = card.symbol;

      inner.appendChild(back);
      inner.appendChild(front);
      button.appendChild(inner);
      button.addEventListener("click", () => flipCard(index));
      els.board.appendChild(button);
      ui.nodes.push(button);
    });
  }

  function renderCard(index) {
    const card = ui.cards[index];
    const node = ui.nodes[index];
    node.classList.toggle("flipped", card.flipped);
    node.classList.toggle("matched", card.matched);
    node.setAttribute(
      "aria-label",
      card.matched ? card.symbol + " matched" : card.flipped ? card.symbol : "Hidden card"
    );
    node.disabled = card.matched;
  }

  function renderHud() {
    els.score.textContent = String(scoreValue());
    els.moves.textContent = String(ui.moves);
    els.time.textContent = ui.elapsed + "s";
    els.best.textContent = String(ui.best);
  }

  function scoreValue() {
    if (ui.over && typeof ui.finalScore === "number") return ui.finalScore;
    return Math.max(0, Math.round(1000 - (ui.moves - PAIRS) * 15 - ui.elapsed * 2));
  }

  function startTimer() {
    if (ui.timerId) return;
    ui.startedAt = Date.now();
    ui.timerId = setInterval(() => {
      ui.elapsed = Math.floor((Date.now() - ui.startedAt) / 1000);
      renderHud();
    }, 250);
  }

  function stopTimer() {
    if (ui.timerId) clearInterval(ui.timerId);
    ui.timerId = null;
  }

  function flipCard(index) {
    if (ui.lock || ui.over) return;
    const card = ui.cards[index];
    if (card.flipped || card.matched) return;
    if (!ui.startedAt) startTimer();

    card.flipped = true;
    renderCard(index);

    if (ui.firstIndex === null) {
      ui.firstIndex = index;
      els.status.textContent = "Pick a second card.";
      return;
    }

    const first = ui.firstIndex;
    ui.firstIndex = null;
    ui.moves += 1;
    renderHud();

    if (ui.cards[first].symbol === card.symbol) {
      ui.cards[first].matched = true;
      card.matched = true;
      ui.matchedPairs += 1;
      renderCard(first);
      renderCard(index);
      if (ui.matchedPairs === PAIRS) {
        win();
      } else {
        els.status.textContent = "Match! " + (PAIRS - ui.matchedPairs) + " pairs left.";
      }
      return;
    }

    ui.lock = true;
    els.status.textContent = "No match.";
    window.setTimeout(() => {
      ui.cards[first].flipped = false;
      ui.cards[index].flipped = false;
      renderCard(first);
      renderCard(index);
      ui.lock = false;
      els.status.textContent = "Pick a second card.";
    }, 760);
  }

  function win() {
    ui.over = true;
    stopTimer();
    ui.elapsed = Math.floor((Date.now() - ui.startedAt) / 1000);
    ui.finalScore = Math.max(0, Math.round(1000 - (ui.moves - PAIRS) * 15 - ui.elapsed * 2));
    ui.manualUnlocks.add("first-clear");
    if (ui.moves === PAIRS) ui.manualUnlocks.add("flawless");
    if (ui.finalScore > ui.best) ui.best = ui.finalScore;
    renderHud();
    els.status.textContent = "Board cleared!";
    els.overlayTitle.textContent = "Cleared!";
    els.overlayBody.textContent = "Score " + ui.finalScore + " · " + ui.moves +
      " moves · " + ui.elapsed + "s.";
    els.overlay.hidden = false;

    if (ui.submitted) return;
    ui.submitted = true;
    Gamebase.endRun({
      score: ui.finalScore,
      meta: { moves: ui.moves, seconds: ui.elapsed, pairs: PAIRS },
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[memory] endRun failed", err));
  }

  function newGame() {
    stopTimer();
    ui.cards = buildDeck();
    ui.firstIndex = null;
    ui.lock = false;
    ui.moves = 0;
    ui.matchedPairs = 0;
    ui.startedAt = 0;
    ui.elapsed = 0;
    ui.finalScore = 0;
    ui.over = false;
    ui.submitted = false;
    ui.manualUnlocks = new Set();
    els.overlay.hidden = true;
    els.status.textContent = "Find all " + PAIRS + " pairs.";
    buildBoard();
    renderHud();
  }

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);

  newGame();

  Gamebase.ready()
    .then((player) => {
      els.tag.textContent = player.handle;
      return Gamebase.myBest();
    })
    .then((best) => {
      if (best && best.best != null) {
        ui.best = best.best;
        if (Gamebase.player) els.tag.textContent = Gamebase.player.handle + " · best " + best.best;
        renderHud();
      }
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[memory] Gamebase offline", err);
    });
})();
