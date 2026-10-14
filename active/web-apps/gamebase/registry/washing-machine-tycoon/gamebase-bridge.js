/**
 * Gamebase bridge for Washing Machine Tycoon.
 *
 * This port is unusual for Gamebase: the game never ends. It is a continuous
 * tycoon simulation with its own `localStorage` save (game.js:saveGame). Since
 * this port was written the platform gained a per-player state API
 * (`Gamebase.saveState`/`loadState`), but the game still owns its save; this
 * bridge only mirrors *progress checkpoints* to the leaderboard.
 *
 * Score: `company.totalMachinesSold` — a cumulative, monotonic counter, so the
 * platform's "keep each player's best" rule lines up with the game's meaning.
 * `meta` carries cash / reputation / models / year / difficulty so server-side
 * `criteria.type: meta` achievements are evaluated from the same submission.
 *
 * Submission policy (rate-friendly, no spam):
 *   - once per in-game year end (`SIM.handleYearEnd`)
 *   - when a tracked meta threshold is newly crossed (checked periodically)
 *   - on `visibilitychange`/`pagehide` so leaving the page flushes the latest
 *   - at most one network submission per MIN_SUBMIT_INTERVAL_MS; later
 *     checkpoints collapse into a single "latest state" flush.
 *
 * The game owns the DOM. This bridge injects its own fixed-position chip and
 * never rewrites game markup.
 */
(function () {
  "use strict";

  const MIN_SUBMIT_INTERVAL_MS = 6000; // comfortably above the 3s server limit
  const MILESTONE_CHECK_EVERY_TICKS = 30; // cheap: ~2s of frames

  // Mirrors of the thresholds declared in game.yaml. Kept as "highest crossed
  // value" markers so a peak (e.g. cash) that later recedes is still submitted.
  const META_MILESTONES = {
    totalMachinesSold: [1, 100, 1000, 10000],
    cash: [100000, 1000000, 10000000],
    reputation: [60, 80, 95],
    models: [5, 10],
    year: [1946, 1950, 1960, 1970, 1980, 1990, 2000],
  };

  let chipEl = null;
  let bestScore = null;
  let rank = null;
  let unlockedFlash = "";

  let pending = null; // latest snapshot waiting for a rate-friendly flush
  let flushTimer = null;
  let lastSubmitAt = 0;
  let lastSubmittedScore = -Infinity;
  let inFlight = false;
  let identityReady = false;

  const submittedMilestones = new Set();
  const manualUnlocksSent = new Set();
  let tickCounter = 0;

  function state() {
    return window.gameState || null;
  }

  // ── Chip (bridge-owned DOM) ──────────────────────────────────────────────

  function ensureChip() {
    if (chipEl && document.body && document.body.contains(chipEl)) return chipEl;
    const style = document.createElement("style");
    style.textContent =
      "#gamebase-chip{position:fixed;left:12px;bottom:12px;z-index:4000;" +
      "font:11px/1.4 system-ui,sans-serif;color:#cde3ff;background:rgba(10,20,35,.82);" +
      "border:1px solid rgba(90,160,255,.45);border-radius:8px;padding:6px 9px;" +
      "max-width:60vw;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.35)}" +
      "#gamebase-chip .gb-flash{display:block;color:#ffd76a;margin-top:2px}";
    document.head.appendChild(style);
    chipEl = document.createElement("div");
    chipEl.id = "gamebase-chip";
    chipEl.setAttribute("aria-live", "polite");
    (document.body || document.documentElement).appendChild(chipEl);
    return chipEl;
  }

  function renderChip() {
    const el = ensureChip();
    const parts = [];
    const player = typeof Gamebase !== "undefined" && Gamebase.player;
    if (player && player.handle) parts.push(player.handle);
    parts.push(bestScore === null ? "best —" : "best " + bestScore);
    if (rank) parts.push("#" + rank);
    el.textContent = "Gamebase · " + parts.join(" · ");
    if (unlockedFlash) {
      const flash = document.createElement("span");
      flash.className = "gb-flash";
      flash.textContent = "🏆 " + unlockedFlash;
      el.appendChild(flash);
    }
  }

  function flashUnlocked(titles) {
    unlockedFlash = "Unlocked: " + titles.join(", ");
    renderChip();
    setTimeout(() => {
      unlockedFlash = "";
      renderChip();
    }, 8000);
  }

  // ── Snapshot / milestone bookkeeping ─────────────────────────────────────

  function snapshot() {
    const g = state();
    if (!g || !g.company) return null;
    const c = g.company;
    const totalMachinesSold = Math.max(0, Math.floor(c.totalMachinesSold || 0));
    return {
      score: totalMachinesSold,
      meta: {
        // Round before sending: meta comparisons are numeric on the server.
        cash: Math.round(c.cash || 0),
        reputation: Math.round((c.reputation || 0) * 10) / 10,
        totalMachinesSold: totalMachinesSold,
        models: (c.models || []).length,
        year: g.year,
        difficulty: g.difficulty,
      },
    };
  }

  function crossedMilestones(meta) {
    const crossed = [];
    for (const key of Object.keys(META_MILESTONES)) {
      const value = meta[key];
      if (typeof value !== "number") continue;
      for (const threshold of META_MILESTONES[key]) {
        if (value >= threshold) crossed.push(key + ":" + threshold);
      }
    }
    if (meta.difficulty === "nightmare") crossed.push("difficulty:nightmare");
    return crossed;
  }

  function hasUnsubmittedMilestone(meta) {
    return crossedMilestones(meta).some((key) => !submittedMilestones.has(key));
  }

  function collectManualUnlocks() {
    const g = state();
    const ids = [];
    if (g && g.company && g.company.name && g.company.name !== "Your Brand") {
      if (!manualUnlocksSent.has("brand-new")) ids.push("brand-new");
    }
    return ids;
  }

  // ── Submission scheduling ────────────────────────────────────────────────

  function queueCheckpoint() {
    const snap = snapshot();
    if (!snap) return;
    const improved = snap.score > lastSubmittedScore;
    const milestone = hasUnsubmittedMilestone(snap.meta);
    if (!improved && !milestone && !pending) return;
    if (!improved && !milestone) return;
    pending = snap;
    const since = Date.now() - lastSubmitAt;
    if (since >= MIN_SUBMIT_INTERVAL_MS) {
      flush(false);
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush(false);
      }, MIN_SUBMIT_INTERVAL_MS - since);
    }
  }

  async function flush(force) {
    if (inFlight) return;
    const snap = pending || snapshot();
    if (!snap) return;
    const since = Date.now() - lastSubmitAt;
    if (!force && since < MIN_SUBMIT_INTERVAL_MS) {
      pending = snap;
      return;
    }
    // On unload, only force once the server's own cooldown has likely passed;
    // a 429 here cannot be retried because the page is going away.
    if (force && since < 3500) {
      pending = snap;
      return;
    }
    // Never submit an empty company: no score and nothing worth reporting.
    if (snap.score <= 0 && !hasUnsubmittedMilestone(snap.meta)) {
      pending = null;
      return;
    }

    pending = null;
    inFlight = true;
    lastSubmitAt = Date.now();

    const manual = collectManualUnlocks();
    try {
      const outcome = await Gamebase.checkpoint({
        score: snap.score,
        meta: snap.meta,
        unlock: manual,
        keepalive: force,
      });
      const submission = outcome.submission || {};
      if (submission.is_personal_best && submission.score != null) {
        bestScore = submission.score;
      } else if (bestScore === null && submission.score != null) {
        bestScore = submission.score;
      }
      if (submission.rank) rank = submission.rank;
      lastSubmittedScore = Math.max(lastSubmittedScore, snap.score);
      crossedMilestones(snap.meta).forEach((key) => submittedMilestones.add(key));
      manual.forEach((id) => manualUnlocksSent.add(id));

      const titles = (outcome.unlocked || []).map((a) => a.title);
      if (titles.length) flashUnlocked(titles);
      else renderChip();
    } catch (error) {
      // SDK already retries one short 429. For anything else, keep the latest
      // state pending and back off; the game must keep playing regardless.
      pending = snapshot();
      console.warn("[gamebase] checkpoint submit failed", error);
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flush(false);
        }, 15000);
      }
    } finally {
      inFlight = false;
    }
  }

  function finalFlush() {
    const snap = snapshot();
    if (snap) pending = snap;
    // keepalive:true lets the browser keep this request alive through unload.
    flush(true);
  }

  // ── Game hooks ───────────────────────────────────────────────────────────

  function installHooks() {
    if (typeof SIM === "undefined") return false;

    if (typeof SIM.handleYearEnd === "function") {
      const originalYearEnd = SIM.handleYearEnd;
      SIM.handleYearEnd = function () {
        const result = originalYearEnd.apply(this, arguments);
        queueCheckpoint(); // one meaningful checkpoint per in-game year
        return result;
      };
    }

    if (typeof SIM.tick === "function") {
      const originalTick = SIM.tick;
      SIM.tick = function () {
        const result = originalTick.apply(this, arguments);
        tickCounter++;
        if (tickCounter % MILESTONE_CHECK_EVERY_TICKS === 0) queueCheckpoint();
        return result;
      };
    }
    return true;
  }

  function installLifecycleHooks() {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") finalFlush();
    });
    window.addEventListener("pagehide", finalFlush);
    window.addEventListener("beforeunload", finalFlush);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  async function init() {
    installLifecycleHooks();
    installHooks();
    // The game boots after DOMContentLoaded, so retry hooks once in case this
    // bridge somehow ran before simulation.js.
    if (typeof SIM === "undefined") {
      document.addEventListener("DOMContentLoaded", installHooks, { once: true });
    }

    if (typeof Gamebase === "undefined") {
      renderChip();
      const el = ensureChip();
      el.textContent = "Gamebase · SDK unavailable";
      return;
    }
    try {
      await Gamebase.ready();
      identityReady = true;
      const progress = await Gamebase.myProgress();
      if (progress) {
        if (progress.best != null) bestScore = progress.best;
        if (progress.rank) rank = progress.rank;
        lastSubmittedScore = typeof progress.best === "number" ? progress.best : lastSubmittedScore;
      }
      renderChip();
    } catch (error) {
      console.warn("[gamebase] identity unavailable; progress will not sync", error);
      const el = ensureChip();
      el.textContent = "Gamebase · offline";
    }
  }

  init();
})();
