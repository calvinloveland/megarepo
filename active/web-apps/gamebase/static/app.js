/* Platform-side UI: shared identity, remix actions, and achievement state. */
(() => {
  const TOKEN_KEY = "gamebase.token";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (error) { return null; }
  }

  function storeToken(value) {
    try { localStorage.setItem(TOKEN_KEY, value); } catch (error) { /* ignore */ }
  }

  async function ensureIdentity() {
    let existing = token();
    if (existing) return existing;
    const response = await fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("could not create identity");
    const data = await response.json();
    storeToken(data.token);
    return data.token;
  }

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
        const response = await fetch("/api/rescan", { method: "POST" });
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
