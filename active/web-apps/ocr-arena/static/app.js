// OCR Arena frontend — vanilla JS, no build step.
// Loads the book list, renders cards, and orchestrates the
// POST /api/runs + poll loop that streams progress to the user.

const $ = (id) => document.getElementById(id);

const STAGE_LABELS = {
  ocr: "OCR",
  cleanup: "Cleanup",
  metrics: "Metrics",
  epub: "EPUB",
};

const state = {
  books: [],
  currentRun: null, // { id, bookId, bookTitle, status, ... }
  pollHandle: null,
};

async function loadBooks() {
  const res = await fetch("/api/books");
  const payload = await res.json();
  state.books = payload.books || [];
  renderBooks();
}

function renderBooks() {
  const root = $("books");
  if (state.books.length === 0) {
    root.innerHTML =
      '<p style="color:var(--fg-faint)">No benchmark books found. ' +
      'Check that the manifest at <code>data/benchmark-corpus-v3/manifest.json</code> exists.</p>';
    return;
  }
  root.innerHTML = "";
  for (const book of state.books) {
    const card = document.createElement("article");
    card.className = "card";
    const gutenberg = book.gutenberg_id
      ? `<span><b>PG</b> #${book.gutenberg_id}</span>`
      : "";
    card.innerHTML = `
      <h3>${escapeHtml(book.title)}</h3>
      <div class="meta">
        ${gutenberg}
        <span><b>${book.page_count}</b> page${book.page_count === 1 ? "" : "s"}</span>
        <span><b>${book.reference_word_count.toLocaleString()}</b> ref words</span>
      </div>
      <button class="run-btn" data-book-id="${escapeAttr(book.id)}">Run pipeline</button>
    `;
    card.querySelector("button").addEventListener("click", () => startRun(book));
    root.appendChild(card);
  }
}

async function startRun(book) {
  // Disable all run buttons while a run is in flight to avoid pile-up.
  for (const btn of document.querySelectorAll(".run-btn")) {
    btn.disabled = true;
  }

  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_id: book.id }),
  });
  if (!res.ok) {
    alert("Failed to start run: " + (await res.text()));
    for (const btn of document.querySelectorAll(".run-btn")) btn.disabled = false;
    return;
  }
  const payload = await res.json();
  state.currentRun = payload.run;
  showRunPanel();
  startPolling();
}

function showRunPanel() {
  const run = state.currentRun;
  $("run-panel").hidden = false;
  $("run-title").textContent = `Run: ${run.book_title}`;
  setStatus(run.status);
  $("run-metrics").hidden = true;
  $("run-downloads").hidden = true;
  $("run-log").textContent = "";
  renderStages(run.stages || []);
  $("run-close").onclick = closeRunPanel;
}

function closeRunPanel() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
  state.currentRun = null;
  $("run-panel").hidden = true;
  for (const btn of document.querySelectorAll(".run-btn")) btn.disabled = false;
}

function setStatus(status) {
  const badge = $("run-status");
  badge.textContent = status;
  badge.className = "badge " + status;
}

function renderStages(stages) {
  const root = $("run-stages");
  root.innerHTML = "";
  for (const stage of stages) {
    const li = document.createElement("li");
    li.className = stage.status;
    const label = STAGE_LABELS[stage.name] || stage.name;
    li.innerHTML = `
      <span class="stage-name">${escapeHtml(label)}</span>
      <span class="stage-detail">${escapeHtml(stage.detail || "—")}</span>
    `;
    root.appendChild(li);
  }
}

function startPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = setInterval(pollRun, 700);
  pollRun();
}

async function pollRun() {
  if (!state.currentRun) return;
  const res = await fetch(`/api/runs/${state.currentRun.id}`);
  if (!res.ok) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
    return;
  }
  const payload = await res.json();
  const run = payload.run;
  state.currentRun = run;
  setStatus(run.status);
  renderStages(run.stages || []);
  $("run-log").textContent = (run.log_lines || []).join("\n");
  $("run-log").scrollTop = $("run-log").scrollHeight;

  if (run.status === "done") {
    finishRun(run);
  } else if (run.status === "error") {
    finishRun(run);
  }
}

function finishRun(run) {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
  setStatus(run.status);
  if (run.status === "done" && run.metrics) {
    $("m-char").textContent = (run.metrics.char_accuracy * 100).toFixed(2) + "%";
    $("m-word").textContent = (run.metrics.word_accuracy * 100).toFixed(2) + "%";
    $("m-words").textContent = (run.metrics.ref_word_count || 0).toLocaleString();
    $("m-outwords").textContent = (run.metrics.word_count || 0).toLocaleString();
    $("run-metrics").hidden = false;
    $("run-downloads").hidden = false;
    $("dl-ocr").href = `/download/${run.id}/ocr`;
    $("dl-epub").href = `/download/${run.id}/epub`;
    $("dl-metrics").href = `/download/${run.id}/metrics`;
  } else if (run.status === "error") {
    $("run-log").textContent += `\n\n[error] ${run.error}`;
  }
  for (const btn of document.querySelectorAll(".run-btn")) btn.disabled = false;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}

loadBooks().catch((err) => {
  $("books").innerHTML = `<p style="color:var(--bad)">Failed to load books: ${escapeHtml(err.message)}</p>`;
});
