/* Platform-side UI: arcade tag gate, remix/rescan actions, achievement state. */
(() => {
  const TOKEN_KEY = "gamebase.token";
  let identityPromise = null;

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

      function fillRandom() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        inputs.forEach((input) => {
          input.value = chars[Math.floor(Math.random() * chars.length)];
        });
        submitTag();
      }

      async function submitTag() {
        if (busy) return;
        const tag = value();
        if (tag.length !== 3) {
          hint.textContent = "Enter 3 characters";
          return;
        }
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
      if (randomButton) randomButton.addEventListener("click", fillRandom);
      gate.hidden = false;
      inputs[0].focus();
    });
  }

  function ensureIdentity() {
    if (token()) return Promise.resolve(token());
    if (!identityPromise) identityPromise = promptForTag();
    return identityPromise;
  }

  function startGames() {
    document.querySelectorAll("iframe[data-src]").forEach((frame) => {
      if (!frame.getAttribute("src")) frame.setAttribute("src", frame.dataset.src);
    });
  }

  // ── Game / catalog actions ───────────────────────────────────────────────

  async function remix(slug, newSlug) {
    const authToken = await ensureIdentity();
    const response = await fetch(`/api/games/${slug}/remix`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ new_slug: newSlug }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "remix failed");
    return data;
  }

  document.addEventListener("DOMContentLoaded", () => {
    ensureIdentity()
      .then(startGames)
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
        const authToken = await ensureIdentity();
        const response = await fetch("/api/rescan", {
          method: "POST",
          headers: { Authorization: "Bearer " + authToken },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "rescan failed");
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
