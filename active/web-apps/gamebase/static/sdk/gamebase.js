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
 * Identity is an httpOnly session cookie set by the platform, so it is the
 * same player across every game and is not readable by game JavaScript.
 */
(function (global) {
  "use strict";

  const listeners = {};
  const LEGACY_TOKEN_KEY = "gamebase.token";
  let playerPromise = null;
  let cachedPlayer = null;
  let playArmed = false;

  function apiBase() {
    if (global.GAMEBASE_API_BASE) return global.GAMEBASE_API_BASE.replace(/\/$/, "");
    return "/api";
  }

  function slugFromLocation() {
    if (global.GAMEBASE_SLUG) return global.GAMEBASE_SLUG;
    const match = global.location.pathname.match(/\/play\/([^/]+)/);
    return match ? match[1] : null;
  }

  // An opaque-origin sandbox cannot fetch the API or touch localStorage; those
  // games talk to the host page over postMessage instead.
  const SANDBOXED = (function () {
    try {
      void global.localStorage.length; // throws SecurityError when sandboxed
    } catch (error) {
      return true;
    }
    try {
      return String(global.location.origin) === "null" || String(global.origin) === "null";
    } catch (error) {
      return true;
    }
  })();

  let rpcCounter = 0;
  const rpcPending = new Map();

  if (typeof global.addEventListener === "function") {
    global.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.__gamebase !== true || message.id === undefined) return;
      const pending = rpcPending.get(message.id);
      if (!pending) return;
      rpcPending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.data);
      } else {
        const error = new Error(message.error || "request failed");
        error.status = message.status;
        if (typeof message.retryAfter === "number") error.retryAfter = message.retryAfter;
        pending.reject(error);
      }
    });
  }

  function rpc(path, method, body) {
    return new Promise((resolve, reject) => {
      const id = "gb-" + (++rpcCounter) + "-" + Math.random().toString(36).slice(2);
      rpcPending.set(id, { resolve: resolve, reject: reject });
      try {
        global.parent.postMessage({ __gamebase: true, id: id, path: path, method: method, body: body }, "*");
      } catch (error) {
        rpcPending.delete(id);
        reject(error);
        return;
      }
      setTimeout(() => {
        if (rpcPending.has(id)) {
          rpcPending.delete(id);
          reject(new Error("gamebase request timed out"));
        }
      }, 20000);
    });
  }

  function clearLegacyToken() {
    try {
      global.localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch (error) {
      /* ignore */
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
    if (SANDBOXED) {
      return rpc(apiBase() + path, (opts.method || "GET").toUpperCase(), opts.body);
    }
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const response = await fetch(apiBase() + path, {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      keepalive: Boolean(opts.keepalive),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = (payload && payload.error) || response.statusText;
      const error = new Error(message);
      error.status = response.status;
      if (payload && typeof payload.retry_after_seconds === "number") {
        error.retryAfter = payload.retry_after_seconds;
      }
      throw error;
    }
    return payload;
  }

  async function fetchIdentity(handle) {
    const payload = await request("/identity", {
      method: "POST",
      body: handle ? { handle: handle } : {},
    });
    cachedPlayer = payload.player;
    emit("ready", cachedPlayer);
    return cachedPlayer;
  }

  async function fetchMe() {
    const payload = await request("/me");
    cachedPlayer = payload.player;
    emit("ready", cachedPlayer);
    return cachedPlayer;
  }

  /** Record a play the first time the player actually interacts with the game. */
  function armPlay() {
    if (playArmed || typeof document === "undefined") return;
    playArmed = true;
    const fire = () => {
      document.removeEventListener("pointerdown", fire);
      document.removeEventListener("keydown", fire);
      document.removeEventListener("touchstart", fire);
      Gamebase.play().catch(() => {});
    };
    document.addEventListener("pointerdown", fire, { once: true });
    document.addEventListener("keydown", fire, { once: true });
    document.addEventListener("touchstart", fire, { once: true });
  }

  /** Resolve the current player, creating a guest identity on first use. */
  function ready(handle) {
    if (!playerPromise) {
      clearLegacyToken();
      playerPromise = fetchMe()
        .catch((error) => {
          if (error && error.status === 401) return fetchIdentity(handle);
          throw error;
        })
        .then((player) => {
          armPlay();
          return player;
        })
        .catch((error) => {
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

  function authHeaders(extra) {
    return Object.assign({}, extra || {});
  }

  function parseSseChunk(chunk) {
    let event = "message";
    const dataLines = [];
    chunk.split("\n").forEach((line) => {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    });
    let data = null;
    if (dataLines.length) {
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch (error) {
        data = null;
      }
    }
    return { event: event, data: data };
  }

  /** Stream matchmaking via server-sent events. Throws if the stream is unusable. */
  async function streamMatch(slug, timeoutMs) {
    if (SANDBOXED) throw new Error("streaming unavailable in sandbox");
    const response = await fetch(
      apiBase() + "/games/" + slug + "/matchmaking/stream?timeout=" + Math.ceil(timeoutMs / 1000),
      { headers: authHeaders({ Accept: "text/event-stream" }) }
    );
    if (!response.ok || !response.body || !response.body.getReader) {
      throw new Error("match stream unavailable");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const parsed = parseSseChunk(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed.event === "done") {
          const ticket = parsed.data && parsed.data.ticket;
          return ticket && ticket.match ? ticket.match : null;
        }
        if (parsed.event === "timeout") return null;
      }
    }
    return null;
  }

  /** Derive the WebSocket URL for a realtime token (works inside the sandbox). */
  function realtimeUrl(info) {
    const secure = String(global.location.protocol) === "https:";
    const host = global.location.host;
    const path = info.path || "/api/rt?token=" + encodeURIComponent(info.token);
    return (secure ? "wss://" : "ws://") + host + path;
  }

  function openRealtimeChannel(matchId, initialInfo) {
    const handlers = {};
    let info = initialInfo;
    let socket = null;
    let closed = false;

    const channel = {
      matchId: matchId,
      connected: false,
      players: [],
      send(data) {
        if (socket && socket.readyState === 1) socket.send(JSON.stringify(data));
      },
      on(event, callback) {
        (handlers[event] = handlers[event] || []).push(callback);
        return () => {
          handlers[event] = handlers[event].filter((fn) => fn !== callback);
        };
      },
      close() {
        closed = true;
        if (socket) socket.close();
      },
    };

    function emit(event, detail) {
      (handlers[event] || []).forEach((fn) => {
        try {
          fn(detail);
        } catch (error) {
          console.error("[gamebase] realtime listener failed", error);
        }
      });
    }

    function connect() {
      if (typeof WebSocket === "undefined") {
        emit("error", new Error("WebSocket unavailable"));
        return;
      }
      socket = new WebSocket(realtimeUrl(info));
      socket.addEventListener("open", () => {
        channel.connected = true;
        emit("open");
      });
      socket.addEventListener("message", (event) => {
        let data = null;
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        if (data && data.t === "roster") {
          channel.players = data.players || [];
          emit("roster", channel.players);
        }
        emit("message", data);
      });
      socket.addEventListener("close", () => {
        channel.connected = false;
        emit("close");
        if (closed) return;
        request("/matches/" + matchId + "/rt-token", { method: "POST" })
          .then((fresh) => {
            info = fresh;
            setTimeout(connect, 500);
          })
          .catch(() => {});
      });
    }

    connect();
    return channel;
  }

  /** Where the match `players[0]` is the host, so games can pick an authority. */
  function matchHostId(match) {
    return match && match.players && match.players[0] ? match.players[0].player_id : null;
  }

  /**
   * Peer-to-peer data channels signalled through the match room, with a relay
   * fallback. Once any data channel opens, messages stop touching the server —
   * for a host-authoritative game the host simulates and peers just send input.
   */
  function openPeerMesh(matchId, match, options) {
    const opts = options || {};
    let players = match.players || [];
    const myId = cachedPlayer ? cachedPlayer.id : null;
    let hostId = matchHostId(match);
    let knownRoster = myId ? [myId] : [];
    const handlers = {};
    const connections = new Map(); // peerId -> { pc, remoteSet, pending }
    const channels = new Map(); // peerId -> RTCDataChannel
    const iceServers = opts.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
    const useP2P = !opts.relayOnly && typeof global.RTCPeerConnection === "function";
    let signal = null;
    let closed = false;
    let mode = useP2P ? "connecting" : "relay";

    function emit(event, detail) {
      (handlers[event] || []).forEach((callback) => {
        try {
          callback(detail);
        } catch (error) {
          console.error("[gamebase] peers listener failed", error);
        }
      });
    }

    function setMode(next) {
      if (mode === next) return;
      mode = next;
      emit("modechange", { mode: mode });
    }

    /** Deterministic host election: the earliest seated player still present. */
    function recomputeHost() {
      const remaining = players.filter((player) => knownRoster.includes(player.player_id));
      const elected = remaining.length ? remaining[0].player_id : hostId;
      if (elected && elected !== hostId) {
        const previous = hostId;
        hostId = elected;
        emit("hostchange", { hostId: hostId, previousHostId: previous, isHost: hostId === myId });
      }
    }

    function sendSignal(message) {
      if (signal && signal.connected) signal.send(message);
    }

    function emitData(peerId, raw) {
      let data = null;
      try {
        data = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch (error) {
        return;
      }
      // Match the relay's shape: the message object itself, with `from` added.
      if (data && typeof data === "object" && !data.from) data.from = peerId;
      emit("message", data);
    }

    function bindChannel(peerId, channel) {
      channels.set(peerId, channel);
      channel.addEventListener("open", () => {
        if (mode !== "p2p") setMode("p2p");
        emit("open", { peerId: peerId });
      });
      channel.addEventListener("message", (event) => emitData(peerId, event.data));
      channel.addEventListener("close", () => {
        channels.delete(peerId);
        emit("close", { peerId: peerId, transport: "p2p" });
        if (!channels.size && !closed) setMode(signal && signal.connected ? "relay" : "closed");
      });
    }

    function newConnection(peerId, initiator) {
      const record = { pc: new global.RTCPeerConnection({ iceServers: iceServers }), remoteSet: false, pending: [] };
      connections.set(peerId, record);
      record.pc.addEventListener("icecandidate", (event) => {
        if (event.candidate) sendSignal({ t: "p2p", to: peerId, kind: "ice", candidate: event.candidate });
      });
      if (initiator) {
        const channel = record.pc.createDataChannel("gamebase", { ordered: opts.ordered !== false });
        bindChannel(peerId, channel);
        record.pc.addEventListener("negotiationneeded", async () => {
          try {
            const offer = await record.pc.createOffer();
            await record.pc.setLocalDescription(offer);
            sendSignal({ t: "p2p", to: peerId, kind: "offer", sdp: record.pc.localDescription });
          } catch (error) {
            /* fall back to the relay */
          }
        });
      } else {
        record.pc.addEventListener("datachannel", (event) => bindChannel(peerId, event.channel));
      }
      return record;
    }

    async function flushCandidates(record) {
      record.remoteSet = true;
      const queued = record.pending.splice(0);
      for (const candidate of queued) {
        try {
          await record.pc.addIceCandidate(candidate);
        } catch (error) {
          /* ignore */
        }
      }
    }

    async function onSignal(message) {
      const peerId = message.from;
      if (!peerId || (message.to && message.to !== myId)) return;
      try {
        if (message.kind === "offer") {
          const record = connections.get(peerId) || newConnection(peerId, false);
          await record.pc.setRemoteDescription(message.sdp);
          await flushCandidates(record);
          const answer = await record.pc.createAnswer();
          await record.pc.setLocalDescription(answer);
          sendSignal({ t: "p2p", to: peerId, kind: "answer", sdp: record.pc.localDescription });
        } else if (message.kind === "answer") {
          const record = connections.get(peerId);
          if (!record) return;
          await record.pc.setRemoteDescription(message.sdp);
          await flushCandidates(record);
        } else if (message.kind === "ice" && message.candidate) {
          const record = connections.get(peerId);
          if (!record) return;
          if (record.remoteSet) await record.pc.addIceCandidate(message.candidate);
          else record.pending.push(message.candidate);
        }
      } catch (error) {
        console.warn("[gamebase] peer signalling failed", error);
      }
    }

    function offerToKnownPeers() {
      if (hostId !== myId || !useP2P) return;
      players.forEach((player) => {
        const peerId = player.player_id;
        if (peerId === myId || !knownRoster.includes(peerId)) return;
        const existing = connections.get(peerId);
        if (existing) {
          const state = existing.pc.connectionState;
          if (state !== "failed" && state !== "closed") return;
          connections.delete(peerId);
        }
        newConnection(peerId, true);
      });
    }

    const api = {
      get matchId() {
        return matchId;
      },
      get hostId() {
        return hostId;
      },
      get isHost() {
        return hostId === myId;
      },
      get mode() {
        return mode;
      },
      get connected() {
        return Boolean(channels.size) || Boolean(signal && signal.connected);
      },
      get peerIds() {
        return Array.from(channels.keys());
      },
      send(data, to) {
        const serialized = JSON.stringify(data);
        if (to) {
          const channel = channels.get(to);
          if (channel && channel.readyState === "open") {
            try {
              channel.send(serialized);
            } catch (error) {
              /* ignore */
            }
            return;
          }
        } else if (channels.size) {
          let delivered = false;
          channels.forEach((channel) => {
            if (channel.readyState === "open") {
              try {
                channel.send(serialized);
                delivered = true;
              } catch (error) {
                /* ignore */
              }
            }
          });
          if (delivered) return;
        }
        if (signal && signal.connected) signal.send({ t: "data", data: data, to: to || null });
      },
      on(event, callback) {
        (handlers[event] = handlers[event] || []).push(callback);
      },
      close() {
        closed = true;
        connections.forEach((record) => {
          try {
            record.pc.close();
          } catch (error) {
            /* ignore */
          }
        });
        connections.clear();
        channels.clear();
        if (signal) signal.close();
      },
    };

    const timeout = setTimeout(() => {
      if (!channels.size && mode === "connecting") setMode(signal && signal.connected ? "relay" : "closed");
    }, opts.timeout || 8000);

    request("/matches/" + matchId + "/rt-token", { method: "POST" })
      .then((info) => {
        signal = openRealtimeChannel(matchId, info);
        signal.on("open", () => { if (mode === "connecting") offerToKnownPeers(); });
        signal.on("roster", async (rosterIds) => {
          if (Array.isArray(rosterIds) && rosterIds.length) knownRoster = rosterIds;
          try {
            const latest = await request("/matches/" + matchId);
            players = latest.players || players;
          } catch (error) {
            /* keep the known players */
          }
          recomputeHost();
          offerToKnownPeers();
          emit("roster", knownRoster);
        });
        signal.on("message", (message) => {
          if (!message) return;
          if (message.t === "p2p") return void onSignal(message);
          if (message.t !== "data" || !message.from) return;
          const addressed = message.to ? message.to === myId : mode !== "p2p";
          if (addressed) emitData(message.from, JSON.stringify(message.data));
        });
        signal.on("close", () => {
          if (!channels.size) setMode("closed");
        });
      })
      .catch(() => {
        clearTimeout(timeout);
        setMode(typeof global.RTCPeerConnection === "function" ? "relay" : "closed");
        emit("error", new Error("realtime unavailable"));
      });

    return api;
  }

  /** Shared score/meta/unlock submission for endRun() and checkpoint(). */
  async function runCheckpoint(result, eventName) {
    const run = result || {};
    const raw = run.score;
    const score = typeof raw === "number" ? raw : raw != null ? Number(raw) : null;
    let submission = null;
    let unlocked = [];
    if (score !== null && !Number.isNaN(score)) {
      submission = await Gamebase.submitScore(score, run.meta || {}, {
        unlock: run.unlock,
        keepalive: run.keepalive,
      });
      unlocked = (submission.unlocked || []).slice();
    } else if (run.meta || run.unlock) {
      const progress = await Gamebase.progress(run.meta || {}, run.unlock);
      unlocked = progress.unlocked || [];
    }
    const outcome = { score: score, submission: submission, unlocked: unlocked };
    emit(eventName, outcome);
    if (unlocked.length) emit("unlocked", unlocked);
    return outcome;
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
    async myBest() {
      await ready();
      const slug = requireSlug();
      const payload = await request("/games/" + slug + "/my-best");
      return payload.best === null ? null : payload;
    },
    /** Best score, rank, points, and achievement state for this game in one call. */
    async myProgress() {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/me");
    },
    /** Rate the game 1–5 stars; resolves to the new average/count. */
    async rate(stars) {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/rating", { method: "POST", body: { rating: stars } });
    },
    async rating() {
      const slug = requireSlug();
      return request("/games/" + slug + "/rating");
    },
    async comments(limit) {
      const slug = requireSlug();
      const query = limit ? "?limit=" + encodeURIComponent(limit) : "";
      const payload = await request("/games/" + slug + "/comments" + query);
      return payload.comments;
    },
    async comment(body) {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/comments", { method: "POST", body: { body: body } });
    },
    /** Record a play for the popularity ranking (the host page calls this too). */
    async play() {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/play", { method: "POST" });
    },
    async submitScore(score, meta, options) {
      await ready();
      const slug = requireSlug();
      const opts = options || {};
      const body = { score: score, meta: meta || {} };
      if (opts.unlock && opts.unlock.length) body.unlock = opts.unlock;
      const attempt = () =>
        request("/games/" + slug + "/scores", { method: "POST", body: body, keepalive: opts.keepalive });
      try {
        return await attempt();
      } catch (error) {
        // A run that dies faster than the rate limit should not be silently
        // lost: wait out a short cooldown and retry exactly once.
        const retryable = error.status === 429 && typeof error.retryAfter === "number" && error.retryAfter <= 15;
        if (!retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.ceil(error.retryAfter * 1000) + 50));
        return attempt();
      }
    },
    async achievements() {
      await ready();
      const slug = requireSlug();
      const payload = await request("/games/" + slug + "/achievements");
      return payload.achievements;
    },
    async unlock(achievementIds) {
      await ready();
      const slug = requireSlug();
      // Always resolves to the list of newly unlocked definitions, whether the
      // caller passed one id or many.
      if (!Array.isArray(achievementIds)) {
        const payload = await request(
          "/games/" + slug + "/achievements/" + encodeURIComponent(achievementIds),
          { method: "POST" }
        );
        return payload.unlocked ? [payload.unlocked] : [];
      }
      if (achievementIds.length === 0) return [];
      const payload = await request("/games/" + slug + "/achievements", {
        method: "POST",
        body: { ids: achievementIds },
      });
      return payload.unlocked || [];
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
    /**
     * Open a real-time channel for an action game. The match must already exist
     * (use findMatch/waitForMatch), and the returned channel relays messages to
     * the other members: `channel.send(obj)` / `channel.on("message", cb)`.
     */
    async joinRealtime(matchId) {
      await ready();
      const info = await request("/matches/" + matchId + "/rt-token", { method: "POST" });
      return openRealtimeChannel(matchId, info);
    },
    async match(matchId) {
      return request("/matches/" + matchId);
    },
    /** The host of a match is players[0]; a host-authoritative game runs here. */
    async hostId(matchId) {
      return matchHostId(await request("/matches/" + matchId));
    },
    /** Connect peers directly (WebRTC) with a relay fallback. */
    async connectPeers(matchId, options) {
      await ready();
      const match = await request("/matches/" + matchId);
      return openPeerMesh(matchId, match, options);
    },
    /** Host action for lobby-style tables: seat everyone currently waiting. */
    async startMatch() {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/matchmaking/start", { method: "POST" });
    },
    /**
     * Publish shared turn-based state to a match (members only). Pass the last
     * `revision` you saw to avoid clobbering a simultaneous opponent move.
     */
    async updateMatch(matchId, state, revision) {
      await ready();
      const body = { state: state };
      if (typeof revision === "number") body.revision = revision;
      return request("/matches/" + matchId + "/state", { method: "PUT", body: body });
    },
    async reportResult(matchId, result) {
      await ready();
      return request("/matches/" + matchId + "/result", {
        method: "POST",
        body: { result: result || {} },
      });
    },
    /**
     * Standard end-of-run handoff: submit the score (which also evaluates
     * score/count/meta/distinct achievements server-side), unlock any extra
     * manual ones, and emit a `runended` event.
     */
    async endRun(result) {
      return runCheckpoint(result, "runended");
    },
    /**
     * Like endRun but for continuous games: a periodic checkpoint, not a
     * terminal run. Emits `checkpoint` instead of `runended`.
     */
    async checkpoint(result) {
      return runCheckpoint(result, "checkpoint");
    },
    /**
     * Announce a milestone without a score. Evaluates meta/distinct criteria
     * and unlocks any manual ids. Backs the push hook for idle/tycoon games.
     */
    async progress(meta, unlock) {
      await ready();
      const slug = requireSlug();
      const payload = await request("/games/" + slug + "/progress", {
        method: "POST",
        body: { meta: meta || {}, unlock: unlock || [] },
      });
      if (payload.unlocked && payload.unlocked.length) emit("unlocked", payload.unlocked);
      return payload;
    },
    /** Persist an opaque save blob. Pass `revision` to guard concurrent tabs. */
    async saveState(state, options) {
      await ready();
      const slug = requireSlug();
      const opts = options || {};
      const body = { state: state, schema_version: opts.schemaVersion || 1 };
      if (typeof opts.revision === "number") body.revision = opts.revision;
      return request("/games/" + slug + "/state", {
        method: "PUT",
        body: body,
        keepalive: opts.keepalive,
      });
    },
    async loadState() {
      await ready();
      const slug = requireSlug();
      const payload = await request("/games/" + slug + "/state");
      return payload.state === null ? null : payload;
    },
    async clearState() {
      await ready();
      const slug = requireSlug();
      return request("/games/" + slug + "/state", { method: "DELETE" });
    },
    /** The player's recovery code, for continuing on another device. */
    async recoveryCode() {
      await ready();
      const payload = await request("/me/recovery");
      return payload.code;
    },
    /** Adopt an existing player on this device using a recovery code. */
    async recover(code) {
      const payload = await request("/identity/recover", { method: "POST", body: { code: code } });
      cachedPlayer = payload.player;
      playerPromise = Promise.resolve(cachedPlayer);
      emit("ready", cachedPlayer);
      return cachedPlayer;
    },
    /**
     * Inject a minimal best/rank/unlock chip so ports don't each re-invent it.
     * Returns `{element, update, remove}`.
     */
    mountHud(options) {
      const opts = Object.assign({ best: null, rank: null }, options || {});
      const element = document.createElement("div");
      element.id = "gamebase-hud";
      element.setAttribute("aria-live", "polite");
      element.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 9px;" +
        "border-radius:7px;background:rgba(10,14,23,.72);color:#9aa7bd;" +
        "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;" +
        "max-width:80vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      (document.body || document.documentElement).appendChild(element);

      function render(extra) {
        const parts = [];
        if (cachedPlayer && cachedPlayer.handle) parts.push(cachedPlayer.handle);
        if (opts.best != null) parts.push("best " + opts.best);
        if (opts.rank) parts.push("#" + opts.rank);
        if (extra) parts.push(extra);
        element.textContent = parts.join(" · ");
      }

      function applyOutcome(outcome) {
        if (outcome.submission) {
          if (outcome.submission.score != null) opts.best = outcome.submission.score;
          if (outcome.submission.rank) opts.rank = outcome.submission.rank;
        }
        render(outcome.unlocked.length ? "unlocked " + outcome.unlocked.map((a) => a.title).join(", ") : undefined);
      }

      const unsubscribers = [
        on("ready", () => render()),
        on("runended", applyOutcome),
        on("checkpoint", applyOutcome),
        on("unlocked", (unlocked) => render("unlocked " + unlocked.map((a) => a.title).join(", "))),
      ];
      render();
      return {
        element: element,
        update(next) {
          Object.assign(opts, next || {});
          render();
        },
        remove() {
          unsubscribers.forEach((unsubscribe) => unsubscribe());
          element.remove();
        },
      };
    },
    /**
     * Wait for an opponent. Polls by default so a long queue does not hold a
     * server thread; pass `{stream: true}` to use the SSE push endpoint.
     */
    async waitForMatch(options) {
      const opts = options || {};
      const timeout = opts.timeout || 60000;
      const slug = requireSlug();
      if (opts.stream && typeof fetch !== "undefined") {
        try {
          return await streamMatch(slug, timeout);
        } catch (error) {
          /* stream unavailable — fall back to polling */
        }
      }
      const interval = opts.interval || 1500;
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
