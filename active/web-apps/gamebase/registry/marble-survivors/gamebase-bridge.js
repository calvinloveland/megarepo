/**
 * Gamebase bridge for Blood Marble — Gyro Survivors.
 *
 * Keeps the port's game logic untouched: `game.js` calls
 * `window.onGamebaseGameOver(stats)` from its `gameOver()` function and this
 * file forwards the run to the Gamebase platform. Achievements are evaluated
 * server-side from the run metadata, so a single score submission is enough.
 * If the platform or identity is unavailable, the game keeps playing and the
 * status line degrades politely.
 */
(function () {
  "use strict";

  const statusEl = document.getElementById("gamebase-status");

  let bestScore = null;
  let rank = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function renderStatus(extra) {
    const parts = [];
    if (Gamebase.player && Gamebase.player.handle) parts.push(Gamebase.player.handle);
    if (bestScore !== null) parts.push("best " + bestScore);
    if (rank) parts.push("#" + rank);
    if (extra) parts.push(extra);
    setStatus(parts.length ? parts.join(" · ") : "");
  }

  async function init() {
    if (typeof Gamebase === "undefined") {
      setStatus("Gamebase SDK unavailable");
      return;
    }
    try {
      await Gamebase.ready();
      const best = await Gamebase.myBest();
      if (best) {
        bestScore = best.best;
        rank = best.rank;
      }
      renderStatus();
    } catch (error) {
      setStatus("Offline — scores will not be saved");
    }
  }

  async function recordRun(run) {
    if (typeof Gamebase === "undefined") return;
    setStatus("Saving score " + run.score + "…");

    let result;
    try {
      result = await Gamebase.submitScore(run.score, {
        level: run.level,
        kills: run.kills,
        survival_seconds: run.survivalTime,
      });
    } catch (error) {
      setStatus("Could not save score: " + (error && error.message ? error.message : error));
      return;
    }

    bestScore = result.score;
    if (result.rank) rank = result.rank;

    // Score, count, and meta criteria are all evaluated server-side, so the
    // submission response already lists everything this run unlocked.
    const unlocked = (result.unlocked || []).map((achievement) => achievement.title);
    renderStatus(unlocked.length ? "unlocked " + unlocked.join(", ") : undefined);
  }

  // Called by game.js's gameOver(). Never let a platform error break the game.
  window.onGamebaseGameOver = function (run) {
    Promise.resolve()
      .then(() => recordRun(run))
      .catch((error) => console.error("[gamebase] game-over handling failed", error));
  };

  init();
})();
