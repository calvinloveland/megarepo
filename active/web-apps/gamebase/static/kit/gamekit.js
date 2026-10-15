/*
 * Gamebase shared game kit — optional JS helpers every game was re-writing.
 *
 *   <script src="/sdk/gamebase.js"></script>
 *   <script src="/static/kit/gamekit.js"></script>
 *
 * Nothing here is required: it is a small toolbox over the SDK. Use whatever
 * parts help and ignore the rest.
 */
(function (global) {
  "use strict";

  const GameKit = {};

  GameKit.escapeHtml = function (value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  };

  /** localStorage that never throws (sandboxed games have none). */
  GameKit.localStore = {
    get(key, fallback) {
      try {
        const raw = global.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        global.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        /* ignore */
      }
    },
  };

  GameKit.setTag = function (element, player) {
    if (element && player) element.textContent = player.handle;
  };

  /** Resolve the player, set the tag chip, and run a callback. */
  GameKit.ready = function (options) {
    const opts = options || {};
    return global.Gamebase.ready().then((player) => {
      GameKit.setTag(opts.tagElement, player);
      if (opts.onPlayer) opts.onPlayer(player);
      return player;
    });
  };

  /** Wrap an overlay's title/body/button so games stop repeating the wiring. */
  GameKit.overlay = function (elements) {
    return {
      show(title, body, buttonLabel, onButton) {
        elements.title.textContent = title;
        elements.body.textContent = body || "";
        if (buttonLabel) {
          elements.button.hidden = false;
          elements.button.textContent = buttonLabel;
          elements.button.onclick = onButton || null;
        } else {
          elements.button.hidden = true;
        }
        elements.overlay.hidden = false;
      },
      hide() {
        elements.overlay.hidden = true;
      },
    };
  };

  /** Cycle a single button through modes (ai -> local -> online, etc.). */
  GameKit.modeCycle = function (button, modes, labels, getMode, setMode) {
    button.textContent = labels[getMode()];
    button.addEventListener("click", () => {
      const index = modes.indexOf(getMode());
      const next = modes[(index + 1) % modes.length];
      setMode(next);
      button.textContent = labels[next];
    });
  };

  /** Matchmaking + realtime wrappers shared by online games. */
  GameKit.online = {
    async findMatch(timeout = 120000) {
      await global.Gamebase.ready();
      await global.Gamebase.findMatch();
      return global.Gamebase.waitForMatch({ timeout });
    },
    realtime(matchId) {
      return global.Gamebase.joinRealtime(matchId);
    },
    publish(matchId, state, revision) {
      return global.Gamebase.updateMatch(matchId, state, revision);
    },
    /** Poll a turn-based match and call `onState(match)` when it advances. */
    poll(matchId, onState, intervalMs = 1500) {
      let revision = -1;
      let stopped = false;
      async function tick() {
        if (stopped) return;
        try {
          const match = await global.Gamebase.match(matchId);
          if (match && (match.revision || 0) > revision) {
            revision = match.revision || 0;
            onState(match);
          }
        } catch (error) {
          /* keep polling */
        }
        if (!stopped) setTimeout(tick, intervalMs);
      }
      tick();
      return () => { stopped = true; };
    },
  };

  /** Report a match result and submit the run in one call. */
  GameKit.finish = function (matchId, result, run) {
    if (matchId) global.Gamebase.reportResult(matchId, result).catch(() => {});
    return global.Gamebase.endRun(run).catch(() => {});
  };

  GameKit.playerId = function () {
    return global.Gamebase.player ? global.Gamebase.player.id : null;
  };

  global.GameKit = GameKit;
})(typeof window !== "undefined" ? window : globalThis);
