document.addEventListener("DOMContentLoaded", () => {
  const builder = document.querySelector("[data-deck-builder]");
  if (!builder) {
    return;
  }

  const baseInput = builder.querySelector("[data-base-input]");
  const basePreview = builder.querySelector("[data-base-preview]");
  const basePoolCards = [...builder.querySelectorAll(".deck-pool-card[data-card-type='base']")];
  const cardPool = document.querySelector("[data-card-pool]");
  const cardPoolCards = cardPool ? [...cardPool.querySelectorAll(".deck-pool-card[data-card-type='card']")] : [];
  const slotInputs = [...builder.querySelectorAll("[data-slot-input]")];
  const slotPreviews = [...builder.querySelectorAll("[data-slot-preview]")];
  const cardMarkup = new Map(cardPoolCards.map((card) => [card.dataset.cardId, card.innerHTML]));
  const baseMarkup = new Map(basePoolCards.map((card) => [card.dataset.cardId, card.innerHTML]));

  function placeholder(text) {
    return `<p class="deck-dropzone__placeholder">${text}</p>`;
  }

  function assignedMarkup(cardId, type, html, instance) {
    return `<div class="deck-assigned-card" draggable="true" data-card-instance="${instance}" data-card-id="${cardId}" data-card-type="${type}">${html}</div>`;
  }

  function updateSlot(slotIndex, cardId) {
    const input = builder.querySelector(`[data-slot-input="${slotIndex}"]`);
    const preview = builder.querySelector(`[data-slot-preview="${slotIndex}"]`);
    if (!input || !preview) {
      return;
    }
    input.value = cardId || "";
    preview.innerHTML = cardId ? assignedMarkup(cardId, "card", cardMarkup.get(cardId) || "", "slot") : placeholder("Drop a card here");
  }

  function updateBase(cardId) {
    if (!baseInput || !basePreview) {
      return;
    }
    baseInput.value = cardId || "";
    basePreview.innerHTML = cardId ? assignedMarkup(cardId, "base", baseMarkup.get(cardId) || "", "base") : placeholder("Drop a base card here");
  }

  function payloadForDragTarget(target) {
    const source = target.closest("[data-card-id]");
    if (!source) {
      return null;
    }
    return {
      cardId: source.dataset.cardId || "",
      cardType: source.dataset.cardType || "card",
      instance: source.dataset.cardInstance || "pool",
      fromSlot: source.closest("[data-slot-index]")?.dataset.slotIndex || "",
    };
  }

  document.addEventListener("dragstart", (event) => {
    const payload = payloadForDragTarget(event.target);
    if (!payload || !event.dataTransfer) {
      return;
    }
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = payload.cardType === "base" ? "copyMove" : "copyMove";
  });

  function readPayload(event) {
    const raw = event.dataTransfer?.getData("text/plain");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function bindDropzone(dropzone) {
    dropzone.addEventListener("dragover", (event) => {
      const payload = readPayload(event);
      if (!payload) {
        return;
      }
      const expected = dropzone.dataset.dropType;
      if (payload.cardType !== expected) {
        return;
      }
      event.preventDefault();
      dropzone.classList.add("deck-dropzone--active");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("deck-dropzone--active");
    });

    dropzone.addEventListener("drop", (event) => {
      const payload = readPayload(event);
      dropzone.classList.remove("deck-dropzone--active");
      if (!payload) {
        return;
      }
      const expected = dropzone.dataset.dropType;
      if (payload.cardType !== expected) {
        return;
      }
      event.preventDefault();
      if (expected === "base") {
        updateBase(payload.cardId);
        return;
      }
      const slotIndex = dropzone.dataset.slotDrop;
      if (!slotIndex) {
        return;
      }
      if (payload.instance === "slot" && payload.fromSlot && payload.fromSlot !== slotIndex) {
        const targetInput = builder.querySelector(`[data-slot-input="${slotIndex}"]`);
        const targetCard = targetInput?.value || "";
        updateSlot(slotIndex, payload.cardId);
        updateSlot(payload.fromSlot, targetCard);
        return;
      }
      updateSlot(slotIndex, payload.cardId);
    });
  }

  builder.querySelectorAll("[data-drop-type]").forEach(bindDropzone);

  builder.querySelectorAll("[data-clear-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSlot(button.dataset.clearSlot, "");
    });
  });

  builder.querySelector("[data-clear-base]")?.addEventListener("click", () => {
    updateBase("");
  });

  const searchInput = document.querySelector("[data-card-search]");
  const keywordFilter = document.querySelector("[data-card-keyword-filter]");
  const sortSelect = document.querySelector("[data-card-sort]");

  function applyFiltersAndSort() {
    if (!cardPool) {
      return;
    }
    const searchValue = (searchInput?.value || "").trim().toLowerCase();
    const keywordValue = (keywordFilter?.value || "").trim().toLowerCase();
    const sortValue = sortSelect?.value || "name-asc";

    for (const card of cardPoolCards) {
      const matchesSearch =
        !searchValue ||
        (card.dataset.cardName || "").includes(searchValue) ||
        (card.dataset.cardTheme || "").includes(searchValue);
      const matchesKeyword = !keywordValue || (card.dataset.cardKeywords || "").includes(keywordValue);
      card.hidden = !(matchesSearch && matchesKeyword);
    }

    const visibleCards = cardPoolCards.filter((card) => !card.hidden);
    const comparators = {
      "name-asc": (left, right) => (left.dataset.cardName || "").localeCompare(right.dataset.cardName || ""),
      "name-desc": (left, right) => (right.dataset.cardName || "").localeCompare(left.dataset.cardName || ""),
      "cpc-asc": (left, right) => Number(left.dataset.cardCpc || "99") - Number(right.dataset.cardCpc || "99"),
      "cpc-desc": (left, right) => Number(right.dataset.cardCpc || "99") - Number(left.dataset.cardCpc || "99"),
      "attack-desc": (left, right) => Number(right.dataset.cardAttack || "0") - Number(left.dataset.cardAttack || "0"),
      "hp-desc": (left, right) => Number(right.dataset.cardHp || "0") - Number(left.dataset.cardHp || "0"),
      "speed-desc": (left, right) => Number(right.dataset.cardSpeed || "0") - Number(left.dataset.cardSpeed || "0"),
    };
    const compare = comparators[sortValue] || comparators["name-asc"];
    visibleCards.sort(compare).forEach((card) => cardPool.appendChild(card));
  }

  searchInput?.addEventListener("input", applyFiltersAndSort);
  keywordFilter?.addEventListener("change", applyFiltersAndSort);
  sortSelect?.addEventListener("change", applyFiltersAndSort);
  applyFiltersAndSort();

  if (!baseInput?.value) {
    updateBase("");
  }
  slotInputs.forEach((input) => {
    if (!input.value) {
      updateSlot(input.dataset.slotInput, "");
    }
  });
});
