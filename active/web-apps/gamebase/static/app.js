/* Platform-side UI: tag gate, ratings, comments, plays, remix/rescan. */
(() => {
  const TOKEN_KEY = "gamebase.token";
  let identityPromise = null;
  let myHandle = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (error) { return null; }
  }

  function storeToken(value) {
    try { localStorage.setItem(TOKEN_KEY, value); } catch (error) { /* ignore */ }
  }

  async function createIdentity(handle) {
    const response = await fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(handle ? { handle: handle } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "could not create identity");
      error.status = response.status;
      throw error;
    }
    storeToken(data.token);
    return data.token;
  }

  // ── Arcade tag gate ──────────────────────────────────────────────────────

  function promptForTag() {
    return new Promise((resolve, reject) => {
      const gate = document.getElementById("tag-gate");
      if (!gate) { createIdentity().then(resolve, reject); return; }

      const inputs = Array.from(gate.querySelectorAll(".tag-slot"));
      const hint = gate.querySelector("#tag-hint");
      const submit = gate.querySelector("#tag-submit");
      const randomButton = gate.querySelector("#tag-random");
      const value = () => inputs.map((input) => input.value.toUpperCase()).join("");
      let busy = false;

      async function submitTag() {
        if (busy) return;
        const tag = value();
        if (tag.length !== 3) { hint.textContent = "Enter 3 characters"; return; }
        busy = true;
        submit.disabled = true;
        hint.textContent = "Connecting…";
        try {
          const created = await createIdentity(tag);
          gate.hidden = true;
          resolve(created);
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

      inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
          input.value = input.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 1);
          if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
          if (value().length === 3) submitTag();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Backspace" && !input.value && index > 0) {
            inputs[index - 1].focus();
            inputs[index - 1].value = "";
          } else if (event.key === "Enter") {
            submitTag();
          }
        });
      });

      submit.addEventListener("click", submitTag);
      if (randomButton) {
        randomButton.addEventListener("click", () => {
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          inputs.forEach((input) => { input.value = chars[Math.floor(Math.random() * chars.length)]; });
          submitTag();
        });
      }
      gate.hidden = false;
      inputs[0].focus();
    });
  }

  function ensureIdentity() {
    if (token()) return Promise.resolve(token());
    if (!identityPromise) identityPromise = promptForTag();
    return identityPromise;
  }

  async function api(path, options) {
    const authToken = await ensureIdentity();
    const opts = options || {};
    const response = await fetch(path, {
      method: opts.method || "GET",
      headers: Object.assign(
        { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
        opts.headers || {}
      ),
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

  // ── Game loading + play count ────────────────────────────────────────────

  function startGames() {
    document.querySelectorAll("iframe[data-src]").forEach((frame) => {
      if (!frame.getAttribute("src")) frame.setAttribute("src", frame.dataset.src);
    });
  }

  async function recordPlay() {
    const meta = document.getElementById("game-meta");
    if (!meta) return;
    try {
      const stats = await api(`/api/games/${meta.dataset.slug}/play`, { method: "POST" });
      const panel = document.querySelector("[data-rating-widget] .play-stat");
      if (panel && stats) panel.textContent = `${stats.plays} play${stats.plays === 1 ? "" : "s"} · ${stats.players} player${stats.players === 1 ? "" : "s"}`;
    } catch (error) {
      /* play counting is best-effort */
    }
  }

  // ── Ratings ──────────────────────────────────────────────────────────────

  function paintStars(panel, value) {
    panel.querySelectorAll(".star-btn").forEach((button, index) => {
      button.classList.toggle("on", index < value);
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
    when.textContent = comment.created_at;
    const remove = document.createElement("button");
    remove.className = "comment-delete";
    remove.dataset.delete = comment.id;
    remove.textContent = "delete";
    remove.hidden = comment.handle !== myHandle;
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
        const comment = await api(`/api/games/${form.dataset.slug}/comments`, {
          method: "POST",
          body: { body },
        });
        const empty = document.getElementById("no-comments");
        if (empty) empty.remove();
        list.prepend(commentNode(comment));
        textarea.value = "";
        status.textContent = "Posted";
        setTimeout(() => { status.textContent = ""; }, 1500);
      } catch (error) {
        status.textContent = error.status === 429 ? "Slow down a moment" : error.message;
      }
    });

    api("/api/me")
      .then((me) => {
        myHandle = me.player && me.player.handle;
        wireDeleteButtons(list);
      })
      .catch(() => {});
  }

  // ── Remix / rescan / copy ────────────────────────────────────────────────

  async function remix(slug, newSlug) {
    return api(`/api/games/${slug}/remix`, { method: "POST", body: { new_slug: newSlug } });
  }

  document.addEventListener("DOMContentLoaded", () => {
    ensureIdentity()
      .then(() => {
        startGames();
        initRating();
        initComments();
        recordPlay();
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
        button.textContent = "Copied!";
        setTimeout(() => { button.textContent = "Copy"; }, 1500);
      } catch (error) {
        console.error("[gamebase] copy failed", error);
      }
    });
  });

  document.querySelectorAll("[data-achievements]").forEach(async (panel) => {
    try {
      const authToken = await ensureIdentity();
      const response = await fetch(`/api/games/${panel.dataset.achievements}/achievements`, {
        headers: { Authorization: "Bearer " + authToken },
      });
      if (!response.ok) return;
      const data = await response.json();
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
