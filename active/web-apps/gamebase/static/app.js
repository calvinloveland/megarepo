/* Platform-side UI: tag gate, identity chip, ratings, comments, plays, remix. */
(() => {
  let sessionPromise = null;
  let myHandle = null;

  async function fetchJson(path, options) {
    const opts = options || {};
    const response = await fetch(path, {
      method: opts.method || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
      credentials: "same-origin",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function api(path, options) {
    await ensureIdentity();
    return fetchJson(path, options);
  }

  // ── Identity (httpOnly cookie) ───────────────────────────────────────────

  async function createIdentity(handle) {
    return fetchJson("/api/identity", {
      method: "POST",
      body: handle ? { handle: handle } : {},
    });
  }

  function setBackgroundInert(value) {
    ["header.site-header", "main", "footer.site-footer"].forEach((selector) => {
      const element = document.querySelector(selector);
      if (!element) return;
      if (value) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
    });
  }

  function promptForTag() {
    return new Promise((resolve, reject) => {
      const gate = document.getElementById("tag-gate");
      if (!gate) { createIdentity().then((data) => resolve(data.player), reject); return; }

      const inputs = Array.from(gate.querySelectorAll(".tag-slot"));
      const hint = gate.querySelector("#tag-hint");
      const submit = gate.querySelector("#tag-submit");
      const randomButton = gate.querySelector("#tag-random");
      const guestButton = gate.querySelector("#tag-guest");
      const value = () => inputs.map((input) => input.value.toUpperCase()).join("");
      let busy = false;

      function close() {
        gate.hidden = true;
        gate.removeEventListener("keydown", onKey);
        setBackgroundInert(false);
      }

      async function makeIdentity(handle) {
        if (busy) return;
        if (handle === undefined && value().length !== 3) {
          hint.textContent = "Enter 3 characters";
          return;
        }
        busy = true;
        submit.disabled = true;
        hint.textContent = "Connecting…";
        try {
          const data = await createIdentity(handle);
          close();
          resolve(data.player);
        } catch (error) {
          busy = false;
          submit.disabled = false;
          hint.textContent = error.status === 409 ? "Tag in use — try another" : (error.message || "Error");
          gate.classList.add("shake");
          setTimeout(() => gate.classList.remove("shake"), 400);
          inputs.forEach((input) => { input.value = ""; });
          inputs[0].focus();
        }
      }

      function onKey(event) {
        if (event.key === "Escape") { event.preventDefault(); makeIdentity(null); return; }
        if (event.key !== "Tab") return;
        const focusable = Array.from(gate.querySelectorAll("input, button")).filter((el) => !el.disabled);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }

      inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
          input.value = input.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 1);
          if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
          if (value().length === 3) makeIdentity();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Backspace" && !input.value && index > 0) {
            inputs[index - 1].focus();
            inputs[index - 1].value = "";
          } else if (event.key === "Enter") {
            makeIdentity();
          }
        });
      });

      submit.addEventListener("click", () => makeIdentity());
      guestButton.addEventListener("click", () => makeIdentity(null));
      randomButton.addEventListener("click", () => {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        inputs.forEach((input) => { input.value = chars[Math.floor(Math.random() * chars.length)]; });
        makeIdentity();
      });

      gate.hidden = false;
      setBackgroundInert(true);
      gate.addEventListener("keydown", onKey);
      inputs[0].focus();
    });
  }

  function ensureIdentity() {
    if (!sessionPromise) {
      sessionPromise = fetchJson("/api/session")
        .then((data) => (data.authenticated ? data.player : promptForTag()))
        .catch(() => promptForTag());
    }
    return sessionPromise;
  }

  function renderIdentityChip(player) {
    const chip = document.getElementById("identity-chip");
    const panel = document.getElementById("identity-panel");
    if (!chip || !player) return;
    myHandle = player.handle;
    chip.hidden = false;
    chip.textContent = player.handle;

    chip.addEventListener("click", async () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      chip.setAttribute("aria-expanded", String(opening));
      if (!opening) return;
      try {
        const { code } = await fetchJson("/api/me/recovery");
        document.getElementById("identity-recovery").textContent = code;
      } catch (error) {
        document.getElementById("identity-recovery").textContent = "unavailable";
      }
    });

    const logout = document.getElementById("identity-logout");
    if (logout) {
      logout.addEventListener("click", async () => {
        try { await fetchJson("/api/logout", { method: "POST" }); } catch (error) { /* ignore */ }
        window.location.reload();
      });
    }
  }

  // ── Game loading ─────────────────────────────────────────────────────────

  function startGames() {
    document.querySelectorAll("iframe[data-src]").forEach((frame) => {
      if (!frame.getAttribute("src")) frame.setAttribute("src", frame.dataset.src);
    });
  }

  // ── Ratings ──────────────────────────────────────────────────────────────

  function paintStars(panel, value) {
    panel.querySelectorAll(".star-btn").forEach((button, index) => {
      const selected = index < value;
      button.classList.toggle("on", selected);
      button.setAttribute("aria-checked", String(selected));
    });
  }

  function initRating() {
    const panel = document.querySelector("[data-rating-widget]");
    if (!panel) return;
    const slug = panel.dataset.slug;
    panel.querySelectorAll(".star-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const result = await api(`/api/games/${slug}/rating`, {
            method: "POST",
            body: { rating: Number(button.dataset.value) },
          });
          paintStars(panel, result.your_rating || 0);
          panel.querySelector("#rating-average").textContent = result.average.toFixed(1);
          panel.querySelector("#rating-count").textContent = result.count;
          panel.querySelector("#rating-yours").textContent = "· you rated " + result.your_rating;
        } catch (error) {
          console.error("[gamebase] rating failed", error);
        }
      });
    });
    api(`/api/games/${slug}/rating`)
      .then((rating) => {
        paintStars(panel, rating.your_rating || 0);
        panel.querySelector("#rating-average").textContent = rating.average.toFixed(1);
        panel.querySelector("#rating-count").textContent = rating.count;
        if (rating.your_rating) panel.querySelector("#rating-yours").textContent = "· you rated " + rating.your_rating;
      })
      .catch(() => {});
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  function commentNode(comment) {
    const node = document.createElement("div");
    node.className = "comment";
    node.dataset.commentId = comment.id;
    node.dataset.handle = comment.handle;

    const head = document.createElement("div");
    head.className = "comment-head";
    const who = document.createElement("a");
    who.href = "/players/" + comment.handle;
    who.textContent = comment.handle;
    const when = document.createElement("span");
    when.className = "muted small";
    when.textContent = comment.created_at_human || comment.created_at;
    const remove = document.createElement("button");
    remove.className = "comment-delete";
    remove.dataset.delete = comment.id;
    remove.textContent = "delete";
    remove.hidden = !comment.is_me;
    remove.addEventListener("click", async () => {
      try {
        await api("/api/comments/" + remove.dataset.delete, { method: "DELETE" });
        node.remove();
      } catch (error) {
        console.error("[gamebase] delete comment failed", error);
      }
    });
    head.append(who, when, remove);

    const body = document.createElement("div");
    body.className = "comment-body";
    body.textContent = comment.body;
    node.append(head, body);
    return node;
  }

  function wireDeleteButtons(list) {
    list.querySelectorAll(".comment").forEach((node) => {
      const remove = node.querySelector(".comment-delete");
      if (!remove) return;
      remove.hidden = node.dataset.handle !== myHandle;
      remove.addEventListener("click", async () => {
        try {
          await api("/api/comments/" + remove.dataset.delete, { method: "DELETE" });
          node.remove();
        } catch (error) {
          console.error("[gamebase] delete comment failed", error);
        }
      });
    });
  }

  function initComments() {
    const form = document.querySelector("[data-comment-form]");
    const list = document.getElementById("comments-list");
    if (!form || !list) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const textarea = form.querySelector("textarea");
      const status = document.getElementById("comment-status");
      const body = textarea.value.trim();
      if (!body) return;
      status.textContent = "Posting…";
      try {
        await api(`/api/games/${form.dataset.slug}/comments`, { method: "POST", body: { body } });
        textarea.value = "";
        status.textContent = "Posted";
        await refreshLive();
        setTimeout(() => { status.textContent = ""; }, 1500);
      } catch (error) {
        status.textContent = error.status === 429 ? "Slow down a moment" : error.message;
      }
    });

    wireDeleteButtons(list);
  }

  // ── Remix / rescan / copy / search ───────────────────────────────────────

  async function remix(slug, newSlug) {
    return api(`/api/games/${slug}/remix`, { method: "POST", body: { new_slug: newSlug } });
  }

  // ── Sandboxed-game broker (postMessage RPC) ──────────────────────────────

  function proxyAllowed(path, method, slug) {
    const pathname = path.split("?")[0];
    const scope = "/api/games/" + slug + "/";
    if (pathname.startsWith(scope)) {
      const sub = pathname.slice(scope.length);
      const allowed = [
        "leaderboard", "my-best", "me", "rating", "comments",
        "achievements", "state", "scores", "progress", "play", "matchmaking",
      ];
      return allowed.some((name) => sub === name || sub.startsWith(name + "/"));
    }
    if (pathname === "/api/session" || pathname === "/api/me") return method === "GET";
    if (pathname === "/api/identity") return method === "POST";
    if (/^\/api\/matches\/[A-Za-z0-9_-]+\/result$/.test(pathname)) return method === "POST";
    if (/^\/api\/matches\/[A-Za-z0-9_-]+\/state$/.test(pathname)) return method === "PUT";
    if (/^\/api\/matches\/[A-Za-z0-9_-]+\/rt-token$/.test(pathname)) return method === "POST";
    if (/^\/api\/matches\/[A-Za-z0-9_-]+$/.test(pathname)) return method === "GET";
    if (/^\/api\/comments\/\d+$/.test(pathname)) return method === "DELETE";
    return false;
  }

  function initGameBroker() {
    const meta = document.getElementById("game-meta");
    const frame = document.querySelector("iframe.play-frame");
    if (!meta || !frame || meta.dataset.sandbox !== "strict") return;
    const slug = meta.dataset.slug;

    window.addEventListener("message", async (event) => {
      if (!frame.contentWindow || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (!message || message.__gamebase !== true || message.id === undefined) return;
      const reply = (payload) =>
        frame.contentWindow.postMessage(Object.assign({ __gamebase: true, id: message.id }, payload), "*");

      const method = (message.method || "GET").toUpperCase();
      const path = message.path;
      if (typeof path !== "string" || !proxyAllowed(path, method, slug)) {
        reply({ ok: false, status: 403, error: "request not allowed from a game" });
        return;
      }
      try {
        const response = await fetch(path, {
          method: method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: message.body !== undefined && message.body !== null ? JSON.stringify(message.body) : undefined,
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) reply({ ok: true, status: response.status, data: data });
        else reply({ ok: false, status: response.status, error: data.error || response.statusText, retryAfter: data.retry_after_seconds });
      } catch (error) {
        reply({ ok: false, status: 0, error: String(error) });
      }
    });
  }

  // ── Live panels (leaderboard, achievements, rating, plays, comments) ─────

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function renderLeaderboard(entries) {
    const body = document.getElementById("leaderboard-body");
    if (!body) return;
    body.innerHTML = entries
      .map((entry) =>
        `<tr><td class="rank">${entry.rank}</td>` +
        `<td><a href="/players/${encodeURIComponent(entry.handle)}">${escapeHtml(entry.handle)}</a></td>` +
        `<td class="value">${escapeHtml(entry.score)}</td></tr>`
      )
      .join("");
    const table = document.getElementById("leaderboard-table");
    const empty = document.getElementById("leaderboard-empty");
    if (table) table.hidden = entries.length === 0;
    if (empty) empty.hidden = entries.length > 0;
  }

  function renderAchievements(list) {
    const body = document.getElementById("achievements-body");
    if (!body) return;
    body.innerHTML = list
      .map((achievement) => {
        const hidden = achievement.hidden && !achievement.unlocked;
        return (
          `<div class="achievement${achievement.unlocked ? " unlocked" : ""}" data-achievement="${escapeHtml(achievement.id)}">` +
          `<span class="icon" aria-hidden="true">${hidden ? "❓" : escapeHtml(achievement.icon)}</span>` +
          `<span><span class="title">${escapeHtml(hidden ? "Hidden achievement" : achievement.title)}</span>` +
          `<span class="desc">${escapeHtml(achievement.description)}</span></span>` +
          `<span class="points">${escapeHtml(achievement.points)}p</span></div>`
        );
      })
      .join("");
    const empty = document.getElementById("achievements-empty");
    if (empty) empty.hidden = list.length > 0;
  }

  function renderComments(comments) {
    const list = document.getElementById("comments-list");
    if (!list) return;
    list.innerHTML = "";
    if (!comments.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.id = "no-comments";
      empty.textContent = "No comments yet — be the first.";
      list.appendChild(empty);
      return;
    }
    comments.forEach((comment) => list.appendChild(commentNode(comment)));
  }

  function applyLiveState(payload) {
    if (!payload || !payload.slug) return;
    renderLeaderboard(payload.leaderboard || []);
    renderAchievements(payload.achievements || []);
    renderComments(payload.comments || []);
    if (payload.rating) {
      const average = document.getElementById("rating-average");
      const count = document.getElementById("rating-count");
      const yours = document.getElementById("rating-yours");
      if (average) average.textContent = Number(payload.rating.average).toFixed(1);
      if (count) count.textContent = payload.rating.count;
      if (yours && payload.rating.your_rating) yours.textContent = "· you rated " + payload.rating.your_rating;
      const panel = document.querySelector("[data-rating-widget]");
      if (panel) paintStars(panel, payload.rating.your_rating || 0);
    }
    if (payload.stats) {
      const play = document.querySelector(".play-stat");
      if (play) {
        play.textContent =
          payload.stats.plays + (payload.stats.plays === 1 ? " play · " : " plays · ") +
          payload.stats.players + (payload.stats.players === 1 ? " player" : " players");
      }
    }
  }

  /** Subscribe to a live stream, falling back to polling if SSE is unavailable. */
  function subscribeLive(eventPath, pollPath, onState) {
    const poll = () => {
      setInterval(async () => {
        try {
          onState(await fetchJson(pollPath));
        } catch (error) {
          /* keep the last known state */
        }
      }, 5000);
    };
    if (typeof EventSource !== "undefined") {
      const source = new EventSource(eventPath);
      source.addEventListener("state", (event) => {
        try {
          onState(JSON.parse(event.data));
        } catch (error) {
          /* ignore malformed frame */
        }
      });
      source.addEventListener("error", () => {
        source.close();
        poll();
      });
      return source;
    }
    poll();
    return null;
  }

  // ── Catalog live (ratings + play counts) ─────────────────────────────────

  function paintCard(card, rating, stats) {
    const filled = Math.round(rating.average);
    card.querySelectorAll(".card-rating .star").forEach((star, index) => {
      star.classList.toggle("on", index < filled);
    });
    const text = card.querySelector(".card-rating-text");
    if (text) text.textContent = Number(rating.average).toFixed(1) + " (" + rating.count + ")";
    const plays = card.querySelector(".card-plays");
    if (plays) plays.textContent = stats.plays + " ▶";
    card.dataset.plays = String(stats.plays);
  }

  function applyCatalogState(payload) {
    if (!payload || !payload.games) return;
    Object.entries(payload.games).forEach(([slug, info]) => {
      document.querySelectorAll(`.card[data-slug="${slug}"]`).forEach((card) => paintCard(card, info.rating, info.stats));
    });
    const byPlays = (a, b) => Number(b.dataset.plays) - Number(a.dataset.plays);
    const grid = document.querySelector('.grid[data-sort="popular"]');
    if (grid) Array.from(grid.querySelectorAll(".card")).sort(byPlays).forEach((card) => grid.appendChild(card));
    const rail = document.querySelector(".rail-row");
    if (rail) Array.from(rail.querySelectorAll(".card")).sort(byPlays).forEach((card) => rail.appendChild(card));
  }

  function initCatalogLive() {
    if (!document.querySelector('.card[data-slug]')) return;
    subscribeLive("/api/catalog/events", "/api/catalog/stats", applyCatalogState);
  }

  // ── Player profile live ──────────────────────────────────────────────────

  function renderPlayerAchievements(list) {
    const grid = document.getElementById("player-achievements");
    if (!grid) return;
    grid.innerHTML = list
      .map((achievement) =>
        '<article class="card"><div class="achievement unlocked">' +
        `<span class="icon" aria-hidden="true">${escapeHtml(achievement.icon || "🏆")}</span>` +
        `<span><span class="title">${escapeHtml(achievement.title || achievement.achievement_id)}</span>` +
        `<span class="desc">${escapeHtml(achievement.description || "")}</span></span></div>` +
        `<p class="small"><a href="/g/${encodeURIComponent(achievement.slug)}">${escapeHtml(achievement.game_title || achievement.slug)}</a></p></article>`
      )
      .join("");
    const empty = document.getElementById("player-achievements-empty");
    if (empty) empty.hidden = list.length > 0;
  }

  function renderPlayerRatings(list) {
    const panel = document.getElementById("player-ratings");
    if (!panel) return;
    const rows = list
      .map((rating) => {
        const filled = Math.round(rating.rating);
        const stars = Array.from({ length: 5 }, (_, index) => `<span class="star${index < filled ? " on" : ""}" aria-hidden="true">★</span>`).join("");
        return `<p class="small" style="margin: 6px 0;"><a href="/g/${encodeURIComponent(rating.slug)}">${escapeHtml(rating.title || rating.slug)}</a> — <span class="stars-mini" role="img" aria-label="${rating.rating} out of 5">${stars}</span></p>`;
      })
      .join("");
    panel.innerHTML = "<h2>Ratings</h2>" + rows;
    panel.hidden = list.length === 0;
  }

  function renderPlayerComments(list) {
    const panel = document.getElementById("player-comments");
    if (!panel) return;
    const rows = list
      .map((comment) =>
        `<div class="comment"><div class="comment-head"><a href="/g/${encodeURIComponent(comment.slug)}">${escapeHtml(comment.title || comment.slug)}</a>` +
        `<span class="muted small">${escapeHtml(comment.created_at_human || comment.created_at)}</span></div>` +
        `<div class="comment-body">${escapeHtml(comment.body)}</div></div>`
      )
      .join("");
    panel.innerHTML = "<h2>Comments</h2>" + rows;
    panel.hidden = list.length === 0;
  }

  function applyPlayerState(payload) {
    if (!payload || !payload.handle) return;
    renderPlayerAchievements(payload.achievements || []);
    renderPlayerRatings(payload.ratings || []);
    renderPlayerComments(payload.comments || []);
    const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    setText("player-achievement-count", (payload.achievements || []).length);
    setText("player-points", payload.points);
    setText("player-rating-count", (payload.ratings || []).length);
    setText("player-comment-count", (payload.comments || []).length);
  }

  function initPlayerLive() {
    const meta = document.getElementById("player-meta");
    if (!meta) return;
    const handle = encodeURIComponent(meta.dataset.handle);
    subscribeLive(`/api/players/${handle}/events`, `/api/players/${handle}/live`, applyPlayerState);
  }

  let liveSlug = null;

  async function refreshLive() {
    if (!liveSlug) return;
    try {
      applyLiveState(await fetchJson(`/api/games/${liveSlug}/live`));
    } catch (error) {
      /* keep the last known state */
    }
  }

  function initGameLive() {
    const meta = document.getElementById("game-meta");
    if (!meta) return;
    liveSlug = meta.dataset.slug;
    subscribeLive(`/api/games/${liveSlug}/events`, `/api/games/${liveSlug}/live`, applyLiveState);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initGameBroker();
    ensureIdentity()
      .then((player) => {
        renderIdentityChip(player);
        startGames();
        initRating();
        initComments();
        initGameLive();
        initCatalogLive();
        initPlayerLive();
      })
      .catch((error) => console.error("[gamebase] identity unavailable", error));
  });

  document.querySelectorAll("[data-remix-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const slug = form.dataset.remixForm;
      const newSlug = form.new_slug.value.trim();
      const status = document.getElementById("remix-status");
      if (!newSlug) return;
      status.textContent = "Creating remix…";
      try {
        const manifest = await remix(slug, newSlug);
        status.textContent = "Created " + manifest.slug + " — opening…";
        window.location.href = "/g/" + manifest.slug;
      } catch (error) {
        status.textContent = "Error: " + error.message;
      }
    });
  });

  document.querySelectorAll("[data-remix]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slug = button.dataset.remix;
      const newSlug = window.prompt("New slug for the remix:", slug + "-remix");
      if (!newSlug) return;
      button.disabled = true;
      button.textContent = "Remixing…";
      try {
        const manifest = await remix(slug, newSlug.trim());
        window.location.href = "/g/" + manifest.slug;
      } catch (error) {
        window.alert("Remix failed: " + error.message);
        button.disabled = false;
        button.textContent = "Remix";
      }
    });
  });

  document.querySelectorAll("[data-rescan]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Scanning…";
      try {
        await api("/api/rescan", { method: "POST" });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Rescan failed";
        console.error("[gamebase] rescan failed", error);
      }
    });
  });

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        const original = button.textContent;
        button.textContent = "Copied!";
        setTimeout(() => { button.textContent = original; }, 1500);
      } catch (error) {
        console.error("[gamebase] copy failed", error);
      }
    });
  });

  const search = document.getElementById("catalog-search");
  if (search) {
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      document.querySelectorAll(".grid .card").forEach((card) => {
        const text = card.textContent.toLowerCase();
        card.style.display = !query || text.includes(query) ? "" : "none";
      });
    });
  }

  document.querySelectorAll("[data-achievements]").forEach(async (panel) => {
    try {
      const data = await fetchJson(`/api/games/${panel.dataset.achievements}/achievements`);
      data.achievements
        .filter((achievement) => achievement.unlocked)
        .forEach((achievement) => {
          const element = panel.querySelector(`[data-achievement="${achievement.id}"]`);
          if (element) element.classList.add("unlocked");
        });
    } catch (error) {
      /* identity or network unavailable — leave achievements locked */
    }
  });
})();
