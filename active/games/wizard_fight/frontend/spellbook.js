const { emitWithAck, state } = window.wizardFight || {};

async function loadSpellbookPage() {
  const listEl = document.getElementById("spellbook-list");
  if (!listEl || !emitWithAck) return;
  listEl.innerHTML = "";
  try {
    const response = await fetch(`${window.WIZARD_FIGHT_SOCKET_URL || 'http://localhost:5055'}/spellbook`);
    const payload = await response.json();
    const spells = payload.spells || [];
    if (spells.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No spells researched yet.";
      listEl.appendChild(li);
      return;
    }
    spells.forEach((spell) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <strong>${spell.name}</strong>
          <div class="spell-meta">Prompt: ${spell.prompt}</div>
        </div>
      `;
      listEl.appendChild(li);
    });
  } catch (err) {
    const li = document.createElement("li");
    li.textContent = "Failed to load spellbook.";
    listEl.appendChild(li);
  }
}

// Wire back button
const spellbookBack = document.getElementById("spellbook-back");
if (spellbookBack) spellbookBack.addEventListener("click", () => window.location.href = "/");

// Auto-load if on page
if (document.getElementById("spellbook-screen")) {
  loadSpellbookPage();
}

window.spellbookModule = { loadSpellbookPage };
