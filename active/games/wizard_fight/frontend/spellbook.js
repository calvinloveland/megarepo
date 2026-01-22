const { emitWithAck, state } = window.wizardFight || {};

function describeSpell(spell) {
  const design = spell?.design || {};
  if (design.description) {
    return design.description;
  }
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

const listEl = document.getElementById("spellbook-list");
const sortSelect = document.getElementById("spellbook-sort");
const groupToggle = document.getElementById("spellbook-group");
let spellbookCache = [];

function getSpellDamage(spell) {
  const design = spell?.design || {};
  const spec = spell?.spec || {};
  let total = 0;

  if (Array.isArray(spec.projectiles)) {
    total += spec.projectiles.reduce(
      (sum, proj) => sum + (Number(proj.damage) || 0),
      0,
    );
  }

  if (Array.isArray(spec.spawn_units)) {
    total += spec.spawn_units.reduce(
      (sum, unit) => sum + (Number(unit.damage) || 0),
      0,
    );
  }

  if (Array.isArray(spec.effects)) {
    total += spec.effects.reduce(
      (sum, effect) => sum + (Number(effect.magnitude) || 0),
      0,
    );
  }

  if (typeof design.damage_hint === "number") {
    total = Math.max(total, design.damage_hint);
  }

  return total;
}

function sortSpells(spells) {
  const mode = sortSelect?.value || "latest";
  const sorted = [...spells];

  if (mode === "mana-asc") {
    sorted.sort((a, b) => (a.spec?.mana_cost || 0) - (b.spec?.mana_cost || 0));
  } else if (mode === "mana-desc") {
    sorted.sort((a, b) => (b.spec?.mana_cost || 0) - (a.spec?.mana_cost || 0));
  } else if (mode === "damage-desc") {
    sorted.sort((a, b) => getSpellDamage(b) - getSpellDamage(a));
  } else if (mode === "damage-asc") {
    sorted.sort((a, b) => getSpellDamage(a) - getSpellDamage(b));
  } else if (mode === "name") {
    sorted.sort((a, b) =>
      (a.spec?.name || "").localeCompare(b.spec?.name || ""),
    );
  }

  return sorted;
}

function groupSpells(spells) {
  const grouped = new Map();
  spells.forEach((spell) => {
    const key = (spell.spec?.name || "").toLowerCase();
    if (!key) {
      return;
    }
    const entry = grouped.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      grouped.set(key, { spell, count: 1 });
    }
  });
  return Array.from(grouped.values());
}

function renderSpellbook(spells) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!spells.length) {
    const li = document.createElement("li");
    li.textContent = "No spells researched yet.";
    listEl.appendChild(li);
    return;
  }

  const sorted = sortSpells(spells);
  const entries = groupToggle?.checked
    ? groupSpells(sorted)
    : sorted.map((spell) => ({ spell, count: 1 }));

  entries.forEach(({ spell, count }) => {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "spell-info";

    const titleRow = document.createElement("div");
    titleRow.className = "spell-title-row";

    const name = document.createElement("strong");
    name.textContent = spell.spec?.name || "Unknown Spell";

    if (count > 1) {
      const badge = document.createElement("span");
      badge.className = "spell-count";
      badge.textContent = `x${count}`;
      name.appendChild(badge);
    }

    const mana = document.createElement("span");
    mana.className = "spell-cost";
    mana.textContent = formatManaCost(spell);

    titleRow.appendChild(name);
    titleRow.appendChild(mana);

    const description = document.createElement("div");
    description.className = "spell-meta";
    description.textContent = describeSpell(spell);

    li.title = description.textContent;

    info.appendChild(titleRow);
    info.appendChild(description);
    li.appendChild(info);
    listEl.appendChild(li);
  });
}

async function loadSpellbookPage() {
  if (!listEl || !emitWithAck) return;
  listEl.innerHTML = "";
  try {
    const response = await fetch(`${window.WIZARD_FIGHT_SOCKET_URL || 'http://localhost:5055'}/spellbook`);
    const payload = await response.json();
    spellbookCache = payload.spells || [];
    renderSpellbook(spellbookCache);
  } catch (err) {
    const li = document.createElement("li");
    li.textContent = "Failed to load spellbook.";
    listEl.appendChild(li);
  }
}

function attachControls() {
  if (sortSelect) {
    sortSelect.addEventListener("change", () => renderSpellbook(spellbookCache));
  }
  if (groupToggle) {
    groupToggle.addEventListener("change", () => renderSpellbook(spellbookCache));
  }
}

// Wire back button
const spellbookBack = document.getElementById("spellbook-back");
if (spellbookBack) spellbookBack.addEventListener("click", () => window.location.href = "/");

// Auto-load if on page
if (document.getElementById("spellbook-screen")) {
  attachControls();
  loadSpellbookPage();
}

window.spellbookModule = { loadSpellbookPage };
