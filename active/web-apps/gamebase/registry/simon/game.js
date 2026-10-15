/*
 * Simon — Gamebase
 *
 * Four pads, one growing sequence. Watch the pads light up, then repeat them
 * in order. Every correct round adds one step. One mistake ends the run.
 * Score is 100 points per completed round.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  const els = {
    pads: Array.from(document.querySelectorAll(".pad")),
    score: document.getElementById("score"),
    round: document.getElementById("round"),
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
    sequence: [],
    inputIndex: 0,
    completed: 0,
    round: 0,
    score: 0,
    best: 0,
    over: false,
    submitted: false,
    inputEnabled: false,
    token: 0,
    manualUnlocks: new Set(),
  };

  let audioCtx = null;
  const PAD_FREQS = [329.63, 261.63, 392.0, 196.0];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function beep(pad, duration) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = PAD_FREQS[pad] || 440;
      gain.gain.value = 0.07;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      osc.start(now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.stop(now + duration + 0.02);
    } catch (error) {
      /* audio is a nicety, never a failure */
    }
  }

  function setLit(pad, on) {
    const el = els.pads[pad];
    if (el) el.classList.toggle("lit", on);
  }

  function updateHud() {
    els.score.textContent = String(ui.score);
    els.round.textContent = String(ui.round);
    els.best.textContent = String(ui.best);
  }

  async function beginRound(token) {
    ui.inputEnabled = false;
    ui.sequence.push(Math.floor(Math.random() * 4));
    ui.round = ui.sequence.length;
    ui.inputIndex = 0;
    updateHud();
    els.status.textContent = "Watch the sequence…";
    await sleep(650);
    if (token !== ui.token || ui.over) return;
    for (let i = 0; i < ui.sequence.length; i++) {
      if (token !== ui.token || ui.over) return;
      const pad = ui.sequence[i];
      setLit(pad, true);
      beep(pad, 0.18);
      await sleep(420);
      setLit(pad, false);
      await sleep(160);
    }
    if (token !== ui.token || ui.over) return;
    ui.inputEnabled = true;
    const steps = ui.sequence.length;
    els.status.textContent = "Your turn — repeat " + steps + (steps === 1 ? " step." : " steps.");
  }

  function completeRound() {
    ui.inputEnabled = false;
    ui.completed += 1;
    ui.score = ui.completed * 100;
    ui.manualUnlocks.add("first-round");
    if (ui.round >= 15) ui.manualUnlocks.add("endurance");
    updateHud();
    els.status.textContent = "Correct!";
    const token = ui.token;
    (async () => {
      await sleep(650);
      if (token !== ui.token || ui.over) return;
      beginRound(token);
    })();
  }

  function gameOver() {
    ui.over = true;
    ui.inputEnabled = false;
    if (ui.round >= 15) ui.manualUnlocks.add("endurance");
    els.overlayTitle.textContent = "Game over";
    els.overlayBody.textContent = "You reached round " + ui.round + " with a score of " + ui.score + ".";
    els.overlay.hidden = false;
    updateHud();
    if (ui.submitted) return;
    ui.submitted = true;
    Gamebase.endRun({
      score: ui.score,
      meta: { round: ui.round, completed: ui.completed },
      unlock: Array.from(ui.manualUnlocks),
    }).catch((err) => console.warn("[simon] endRun failed", err));
  }

  function pressPad(pad) {
    if (!ui.inputEnabled || ui.over || pad < 0 || pad > 3) return;
    setLit(pad, true);
    beep(pad, 0.12);
    setTimeout(() => setLit(pad, false), 220);
    if (ui.sequence[ui.inputIndex] === pad) {
      ui.inputIndex += 1;
      if (ui.inputIndex >= ui.sequence.length) completeRound();
    } else {
      els.status.textContent = "Wrong pad!";
      gameOver();
    }
  }

  function newGame() {
    ui.token += 1;
    ui.sequence = [];
    ui.inputIndex = 0;
    ui.completed = 0;
    ui.round = 0;
    ui.score = 0;
    ui.over = false;
    ui.submitted = false;
    ui.inputEnabled = false;
    ui.manualUnlocks = new Set();
    els.pads.forEach((pad) => pad.classList.remove("lit"));
    els.overlay.hidden = true;
    updateHud();
    beginRound(ui.token);
  }

  els.pads.forEach((el) => {
    el.addEventListener("click", () => pressPad(Number(el.dataset.pad)));
  });

  const KEY_PADS = {
    "1": 0, "2": 1, "3": 2, "4": 3,
    q: 0, w: 1, a: 2, s: 3,
    Q: 0, W: 1, A: 2, S: 3,
  };
  window.addEventListener("keydown", (event) => {
    const pad = KEY_PADS[event.key];
    if (pad === undefined) return;
    event.preventDefault();
    pressPad(pad);
  });

  els.newGame.addEventListener("click", newGame);
  els.overlayBtn.addEventListener("click", newGame);

  updateHud();
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
        updateHud();
      }
    })
    .catch((err) => {
      els.tag.textContent = "guest";
      console.warn("[simon] Gamebase offline", err);
    });
})();
