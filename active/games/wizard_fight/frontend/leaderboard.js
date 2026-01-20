const { state } = window.wizardFight || {};

async function loadLeaderboardPage() {
  const listEl = document.getElementById("leaderboard-list");
  const metricLobbies = document.getElementById("metric-lobbies");
  const metricResearched = document.getElementById("metric-researched");
  const metricCast = document.getElementById("metric-cast");
  if (!listEl) return;
  listEl.innerHTML = "";
  try {
    const response = await fetch(`${window.WIZARD_FIGHT_SOCKET_URL || 'http://localhost:5055'}/leaderboard`);
    const payload = await response.json();
    const entries = payload.top_spells || [];
    if (entries.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No leaderboard data yet.";
      listEl.appendChild(li);
    } else {
      entries.forEach((entry) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <div>
            <strong>${entry.name}</strong>
            <div class="spell-meta">Research count: ${entry.count}</div>
          </div>
        `;
        listEl.appendChild(li);
      });
    }
    if (payload.metrics) {
      if (metricLobbies) metricLobbies.textContent = payload.metrics.lobbies_created ?? 0;
      if (metricResearched) metricResearched.textContent = payload.metrics.spells_researched ?? 0;
      if (metricCast) metricCast.textContent = payload.metrics.spells_cast ?? 0;
    }
  } catch (err) {
    const li = document.createElement("li");
    li.textContent = "Failed to load leaderboard.";
    listEl.appendChild(li);
  }
}

const leaderboardBack = document.getElementById("leaderboard-back");
if (leaderboardBack) leaderboardBack.addEventListener("click", () => window.location.href = "/");

if (document.getElementById("leaderboard-screen")) {
  loadLeaderboardPage();
}

window.leaderboardModule = { loadLeaderboardPage };
