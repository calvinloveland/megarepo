/**
 * Gamebase SDK — one file that gives a web game identity, high scores,
 * achievements, and matchmaking against the Gamebase platform.
 *
 * Include it from a game served at /play/<slug>/:
 *
 *   <script src="/sdk/gamebase.js"></script>
 *   <script>
 *     const player = await Gamebase.ready();
 *     await Gamebase.submitScore(1200, { level: 3 });
 *     await Gamebase.unlock("first-blood");
 *     const match = await Gamebase.findMatch();
 *   </script>
 *
 * Identity is a bearer token kept in localStorage, so the same browser keeps
 * the same player across games on the platform.
 */
(function (global) {
  "use strict";

  const TOKEN_KEY = "gamebase.token";
  const listeners = {};
  let playerPromise = null;
  let cachedPlayer = null;

  function apiBase() {
    if (global.GAMEBASE_API_BASE) return global.GAMEBASE_API_BASE.replace(/\/$/, "");
    return "/api";
  }

  function slugFromLocation() {
    if (global.GAMEBASE_SLUG) return global.GAMEBASE_SLUG;
    const match = global.location.pathname.match(/\/play\/([^/]+)/);
    return match ? match[1] : null;
  }

  function token() {
    try {
      return global.localStorage.getItem(TOKEN_KEY);
    } catch (error) {
      return null;
    }
  }

  function storeToken(value) {
    try {
      global.localStorage.setItem(TOKEN_KEY, value);
    } catch (error) {
      /* private mode — identity will not persist */
    }
  }

  function emit(event, detail) {
    (listeners[event] || []).forEach((callback) => {
      try {
        callback(detail);
      } catch (error) {
        console.error("[gamebase] listener failed", error);
      }
    });
  }

  function on(event, callback) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(callback);
    return () => {
      listeners[event] = listeners[event].filter((item) => item !== callback);
    };
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const current = token();
    if (current) headers.Authorization = "Bearer " + current;
    const response = await fetch(apiBase() + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = (payload && payload.error) || response.statusText;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function fetchIdentity(handle) {
    const payload = await request("/identity", {
      method: "POST",
      body: handle ? { handle: handle } : {},
    });
    storeToken(payload.token);
    cachedPlayer = payload.player;
    emit("ready", cachedPlayer);
    return cachedPlayer;
  }

  async function withToken() {
    const payload = await request("/me");
    cachedPlayer = payload.player;
    emit("ready", cachedPlayer);
    return cachedPlayer;
  }

  /** Resolve the current player, creating a guest identity on first use. */
  function ready(handle) {
    if (!playerPromise) {
      playerPromise = (token() ? withToken() : fetchIdentity(handle)).catch(async (error) => {
        // A stale or revoked token should not permanently break the game.
        if (error && error.status === 401) {
          storeToken("");
          playerPromise = null;
          return fetchIdentity(handle);
        }
        playerPromise = null;
        throw error;
      });
    }
    return playerPromise;
  }

  function requireSlug(explicit) {
    const slug = explicit || slugFromLocation();
    if (!slug) throw new Error("Gamebase could not determine the game slug");
    return slug;
  }

  const Gamebase = {
    version: "0.1.0",
    ready,
    on,
    configure(options) {
      if (options && options.slug) global.GAMEBASE_SLUG = options.slug;
    },
    get player() {
      return cachedPlayer;
    },
    async leaderboard(limit) {
      const slug = requireSlug();
      const query = limit ? "?limit=" + encodeURIComponent(limit) : "";
      const payload = await request("/games/" + slug + "/leaderboard" + query);
      return payload.leaderboard;
    },
    async submitScore(score, meta) {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/scores", {
        method: "POST",
        body: { score: score, meta: meta || {} },
      });
    },
    async achievements() {
      await ready();
      const slug = requireSlug();
      const payload = await request("/games/" + slug + "/achievements");
      return payload.achievements;
    },
    async unlock(achievementId) {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/achievements/" + encodeURIComponent(achievementId), {
        method: "POST",
      });
    },
    async findMatch() {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/matchmaking", { method: "POST" });
    },
    async matchStatus() {
      await ready();
      const slug = requireSlug();
      const payload = await request("/games/" + slug + "/matchmaking");
      return payload.ticket;
    },
    async cancelMatch() {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/matchmaking", { method: "DELETE" });
    },
    async match(matchId) {
      return request("/matches/" + matchId);
    },
    async reportResult(matchId, result) {
      await ready();
      return request("/matches/" + matchId + "/result", {
        method: "POST",
        body: { result: result || {} },
      });
    },
    /** Poll matchmaking until an opponent joins. */
    async waitForMatch(options) {
      const opts = options || {};
      const interval = opts.interval || 1000;
      const timeout = opts.timeout || 60000;
      const started = Date.now();
      for (;;) {
        const ticket = await Gamebase.matchStatus();
        if (ticket && ticket.status === "matched" && ticket.match) return ticket.match;
        if (ticket && ticket.status === "cancelled") return null;
        if (Date.now() - started > timeout) return null;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
  };

  global.Gamebase = Gamebase;
})(typeof window !== "undefined" ? window : globalThis);
