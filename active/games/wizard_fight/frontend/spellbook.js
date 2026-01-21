const { emitWithAck, state } = window.wizardFight || {};

function describeSpell(spell) {
  const design = spell?.design || {};
  if (design.intended_use) {
    return design.intended_use;
  }
  if (design.theme) {
    return design.theme;
  }
  const prompt = design.prompt || spell?.prompt;
  return prompt ? `Prompt: ${prompt}` : "No description available.";
}

function formatManaCost(spell) {
  const cost = spell?.spec?.mana_cost;
  if (Number.isFinite(cost)) {
    return `Mana ${cost}`;
  }
  return "Mana -";
}

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
      const info = document.createElement("div");
      info.className = "spell-info";

      const titleRow = document.createElement("div");
      titleRow.className = "spell-title-row";

      const name = document.createElement("strong");
      name.textContent = spell.name || "Unknown Spell";

      const mana = document.createElement("span");
      mana.className = "spell-cost";
      mana.textContent = formatManaCost(spell);

      titleRow.appendChild(name);
      titleRow.appendChild(mana);

      const description = document.createElement("div");
      description.className = "spell-meta";
      description.textContent = describeSpell(spell);

      info.appendChild(titleRow);
      info.appendChild(description);
      li.appendChild(info);
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
