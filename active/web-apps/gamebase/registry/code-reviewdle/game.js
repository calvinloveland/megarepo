/*
 * Code Reviewdle — Gamebase
 *
 * A client-only daily code-review puzzle. Each day derives one puzzle from a
 * date-seeded index into the bundled bank (puzzles.js). The player selects a
 * line and an issue category; every miss narrows the selectable line window
 * and eliminates a whole issue category, exactly like the original Flask app.
 * Six guesses maximum. Points reward fewer guesses.
 *
 * The pure engine is exposed as `CodeReviewdle` so it can be exercised with
 * `node`; the DOM half only runs in a browser.
 */
(function (root) {
  "use strict";

  const MAX_GUESSES = 6;
  const NEAR_LINE_DISTANCE = 1;
  const LINE_POOL_FRACTIONS = [1.0, 0.72, 0.56, 0.42, 0.3, 0.18, 0.08];
  const LINE_STATUS_EMOJI = { correct: "🟩", near: "🟨", wrong: "⬛" };
  const ISSUE_STATUS_EMOJI = { correct: "🟩", wrong: "⬛" };

  const ISSUE_CATALOG = {
    "Security and trust": [
      "Security check bypass",
      "Authorization bypass",
      "Trust boundary violation",
      "Insecure default",
    ],
    "State and ordering": [
      "Reentrancy",
      "Shared mutable state",
      "Initialization order bug",
      "Stale state update",
    ],
    "Numeric correctness": [
      "Numeric overflow / underflow",
      "Precision loss",
      "Off-by-one",
      "Unit conversion bug",
    ],
    "Control flow": [
      "Wrong conditional logic",
      "Premature exit",
      "Unreachable recovery path",
      "Incorrect loop boundary",
    ],
    "API and validation": [
      "Unchecked return value",
      "Incorrect API usage",
      "Missing null handling",
      "Missing bounds validation",
    ],
    "Resources and lifetime": [
      "Resource leak",
      "Double free / double close",
      "Use after free",
      "Dangling reference",
    ],
  };

  const ISSUE_TYPE_TO_CATEGORY = {};
  Object.keys(ISSUE_CATALOG).forEach((category) => {
    ISSUE_CATALOG[category].forEach((issueType) => {
      ISSUE_TYPE_TO_CATEGORY[issueType] = category;
    });
  });

  const allIssueTypes = () => Object.keys(ISSUE_TYPE_TO_CATEGORY);
  const allIssueCategories = () => Object.keys(ISSUE_CATALOG);

  // ── Pure game rules ──────────────────────────────────────────────────────

  function buildEmptyProgress() {
    return { guesses: [], solved: false, wrongGuesses: 0, eliminated: [] };
  }

  function isOver(progress) {
    return Boolean(progress.solved) || progress.guesses.length >= MAX_GUESSES;
  }

  function feedbackForGuess(puzzle, lineNumber, issueType) {
    const lineDistance = Math.abs(lineNumber - puzzle.answer_line);
    let lineStatus = "wrong";
    if (lineDistance === 0) lineStatus = "correct";
    else if (lineDistance <= NEAR_LINE_DISTANCE) lineStatus = "near";
    const issueStatus = issueType === puzzle.issue_type ? "correct" : "wrong";
    return {
      lineNumber,
      issueType,
      lineStatus,
      issueStatus,
      solved: lineStatus === "correct" && issueStatus === "correct",
    };
  }

  function updatedEliminatedCategories(puzzle, guessedIssueType, existing) {
    const eliminated = existing.slice();
    const allowed = allIssueCategories().filter(
      (category) => category !== puzzle.issue_category && !eliminated.includes(category)
    );
    if (!allowed.length) return eliminated;
    const guessedCategory = ISSUE_TYPE_TO_CATEGORY[guessedIssueType];
    if (guessedCategory !== puzzle.issue_category && !eliminated.includes(guessedCategory)) {
      eliminated.push(guessedCategory);
      return eliminated;
    }
    const fallback = allowed[0];
    if (!eliminated.includes(fallback)) eliminated.push(fallback);
    return eliminated;
  }

  function applyGuess(progress, puzzle, lineNumber, issueType) {
    const updated = {
      guesses: progress.guesses.slice(),
      solved: Boolean(progress.solved),
      wrongGuesses: progress.wrongGuesses | 0,
      eliminated: progress.eliminated.slice(),
    };
    const feedback = feedbackForGuess(puzzle, lineNumber, issueType);
    updated.guesses.push(feedback);
    if (feedback.solved) {
      updated.solved = true;
    } else {
      updated.wrongGuesses += 1;
      updated.eliminated = updatedEliminatedCategories(puzzle, issueType, updated.eliminated);
    }
    return updated;
  }

  function guessesRemaining(progress) {
    return Math.max(0, MAX_GUESSES - progress.guesses.length);
  }

  function targetPoolSize(totalCount, wrongGuesses) {
    const fraction = LINE_POOL_FRACTIONS[Math.min(wrongGuesses, LINE_POOL_FRACTIONS.length - 1)];
    return Math.max(1, Math.min(totalCount, Math.ceil(totalCount * fraction)));
  }

  function centeredWindowBounds(totalCount, answerIndex, targetCount) {
    if (targetCount >= totalCount) return [0, totalCount];
    let startIndex = Math.max(0, answerIndex - Math.floor(targetCount / 2));
    let endIndex = startIndex + targetCount;
    if (endIndex > totalCount) {
      endIndex = totalCount;
      startIndex = endIndex - targetCount;
    }
    return [startIndex, endIndex];
  }

  function selectableLineNumbers(puzzle, progress) {
    const totalCount = puzzle.code.length;
    if (isOver(progress)) {
      const all = [];
      for (let i = 1; i <= totalCount; i++) all.push(i);
      return all;
    }
    const size = targetPoolSize(totalCount, progress.wrongGuesses | 0);
    const [start, end] = centeredWindowBounds(totalCount, puzzle.answer_line - 1, size);
    const lines = [];
    for (let i = start + 1; i <= end; i++) lines.push(i);
    return lines;
  }

  function selectableIssueCategories(progress) {
    if (isOver(progress)) return allIssueCategories();
    const eliminated = new Set(progress.eliminated);
    return allIssueCategories().filter((category) => !eliminated.has(category));
  }

  function selectableIssueTypes(issueTypes, progress) {
    if (isOver(progress)) return issueTypes.slice();
    const allowed = new Set(selectableIssueCategories(progress));
    return issueTypes.filter((issueType) => allowed.has(ISSUE_TYPE_TO_CATEGORY[issueType]));
  }

  function buildShareText(playDate, progress, puzzleUrl) {
    const resultToken = progress.solved ? String(progress.guesses.length) : "X";
    const rows = progress.guesses.map(
      (guess) => LINE_STATUS_EMOJI[guess.lineStatus] + ISSUE_STATUS_EMOJI[guess.issueStatus]
    );
    return [
      `Code Reviewdle ${playDate} ${resultToken}/${MAX_GUESSES}`,
      ...rows,
      "",
      `Try it: ${puzzleUrl}`,
    ].join("\n");
  }

  /** Fewer guesses is worth more; an unsolved round scores nothing. */
  function scoreFor(progress) {
    if (!progress.solved) return 0;
    return (MAX_GUESSES - progress.guesses.length + 1) * 100;
  }

  function ordinalFromDate(date) {
    const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return 719163 + Math.floor(utcMidnight / 86400000);
  }

  function puzzleForDay(date, puzzles) {
    const bank = puzzles || root.CODE_REVIEWDLE_PUZZLES || [];
    if (!bank.length) return null;
    const index = ((ordinalFromDate(date) % bank.length) + bank.length) % bank.length;
    return bank[index];
  }

  const Engine = {
    MAX_GUESSES,
    ISSUE_CATALOG,
    buildEmptyProgress,
    isOver,
    feedbackForGuess,
    applyGuess,
    guessesRemaining,
    selectableLineNumbers,
    selectableIssueCategories,
    selectableIssueTypes,
    buildShareText,
    scoreFor,
    puzzleForDay,
  };
  root.CodeReviewdle = Engine;

  if (typeof document === "undefined") return;

  // ── Minimal syntax highlighting (ported from highlight.py) ───────────────

  const COMMON_KEYWORDS = new Set([
    "return", "if", "else", "for", "while", "break", "continue", "switch",
    "case", "default", "try", "catch", "finally", "throw", "class", "struct",
    "public", "private", "protected", "static", "const", "let", "var",
    "function", "def", "async", "await", "new", "import", "from", "export",
    "package", "extends", "implements", "interface", "void", "int", "short",
    "double", "float", "bool", "boolean", "string", "mapping", "pragma",
    "contract", "event", "external", "view", "payable", "require", "true",
    "false", "null", "None", "goto",
  ]);
  const TYPE_NAMES = new Set([
    "ServerHello", "HashContext", "SignedParams", "ByteBuffer",
    "CommunityVault", "GuidancePacketBuilder",
  ]);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function commentStart(language, line) {
    let inString = false;
    let quote = "";
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inString) {
        if (char === quote && line[index - 1] !== "\\") inString = false;
        continue;
      }
      if (char === "'" || char === '"') {
        inString = true;
        quote = char;
        continue;
      }
      if (language.toLowerCase() === "python" && char === "#") return index;
      if (index + 1 < line.length && line.slice(index, index + 2) === "//") return index;
    }
    return null;
  }

  function consumeStringEnd(text, startIndex) {
    const quote = text[startIndex];
    let index = startIndex + 1;
    while (index < text.length) {
      if (text[index] === quote && text[index - 1] !== "\\") return index + 1;
      index += 1;
    }
    return text.length;
  }

  function wordType(word, text, nextIndex) {
    if (COMMON_KEYWORDS.has(word)) return "keyword";
    if (TYPE_NAMES.has(word) || (/^[A-Z]/.test(word) && word.length > 1)) return "type";
    const tail = text.slice(nextIndex).replace(/^\s+/, "");
    if (tail.startsWith("(")) return "function";
    return "identifier";
  }

  function scanPlainTokens(text) {
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      if (/\s/.test(char)) {
        const start = index;
        while (index < text.length && /\s/.test(text[index])) index += 1;
        tokens.push([text.slice(start, index), "plain"]);
        continue;
      }
      if (char === "'" || char === '"') {
        const end = consumeStringEnd(text, index);
        tokens.push([text.slice(index, end), "string"]);
        index = end;
        continue;
      }
      if (/[0-9]/.test(char)) {
        const start = index;
        while (index < text.length && (/[0-9]/.test(text[index]) || text[index] === "." || text[index] === "x")) {
          index += 1;
        }
        tokens.push([text.slice(start, index), "number"]);
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        const start = index;
        while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) index += 1;
        const word = text.slice(start, index);
        tokens.push([word, wordType(word, text, index)]);
        continue;
      }
      if ("{}[]()".includes(char)) tokens.push([char, "brace"]);
      else if (",;".includes(char)) tokens.push([char, "muted"]);
      else tokens.push([char, "operator"]);
      index += 1;
    }
    return tokens;
  }

  function highlightLine(language, line) {
    const start = commentStart(language, line);
    const tokens = start === null
      ? scanPlainTokens(line)
      : scanPlainTokens(line.slice(0, start)).concat([[line.slice(start), "comment"]]);
    if (!tokens.length) return " ";
    return tokens.map(([text, type]) => (
      type === "plain" ? escapeHtml(text) : `<span class="tok-${type}">${escapeHtml(text)}</span>`
    )).join("");
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  const $ = (selector) => document.querySelector(selector);
  const els = {
    tag: $("#tag"),
    notice: $("#notice"),
    metaLanguage: $("#meta-language"),
    metaGuesses: $("#meta-guesses"),
    metaDate: $("#meta-date"),
    tabTitle: $("#tab-title"),
    tabLanguage: $("#tab-language"),
    statLines: $("#stat-lines"),
    statCategories: $("#stat-categories"),
    statTypes: $("#stat-types"),
    puzzleTitle: $("#puzzle-title"),
    codeBody: $("#code-body"),
    guessForm: $("#guess-form"),
    lineNumber: $("#line-number"),
    issueType: $("#issue-type"),
    guessButton: $("#guess-button"),
    metricLines: $("#metric-lines"),
    metricCategories: $("#metric-categories"),
    metricTypes: $("#metric-types"),
    guessList: $("#guess-list"),
    contextContent: $("#context-content"),
    historyContent: $("#history-content"),
    outcomeFold: $("#outcome-fold"),
    outcomeContent: $("#outcome-content"),
    runOverlay: $("#runOverlay"),
    runOverlayTitle: $("#runOverlayTitle"),
    runOverlayBody: $("#runOverlayBody"),
    runOverlayBtn: $("#runOverlayBtn"),
  };

  const runOverlay = (root.GameKit && root.GameKit.overlay) ? root.GameKit.overlay({
    overlay: els.runOverlay,
    title: els.runOverlayTitle,
    body: els.runOverlayBody,
    button: els.runOverlayBtn,
  }) : null;

  function showRunOverlay(title, body) {
    if (runOverlay) {
      runOverlay.show(title, body, "View breakdown", () => runOverlay.hide());
    } else if (els.runOverlay) {
      els.runOverlayTitle.textContent = title;
      els.runOverlayBody.textContent = body;
      els.runOverlay.hidden = false;
    }
  }

  const ui = {
    puzzle: null,
    dateStr: "",
    progress: Engine.buildEmptyProgress(),
    selectedLine: null,
    selectedIssueType: "",
    error: "",
    revision: 0,
    submitted: false,
    submitMessage: "",
  };

  const pad2 = (value) => String(value).padStart(2, "0");

  function isoDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function setTag(text) {
    if (els.tag) els.tag.textContent = text;
  }

  function setSubmitMessage(message) {
    ui.submitMessage = message;
    const element = document.getElementById("submit-status");
    if (element) element.textContent = message;
  }

  function renderMeta() {
    els.metaLanguage.textContent = ui.puzzle.language;
    els.metaGuesses.textContent = `${Engine.guessesRemaining(ui.progress)}/${Engine.MAX_GUESSES} guesses`;
    els.metaDate.textContent = ui.dateStr;
  }

  function renderNotice() {
    if (ui.error) {
      els.notice.hidden = false;
      els.notice.className = "notice notice-error";
      els.notice.innerHTML = `<strong>Guess not submitted.</strong> <span>${escapeHtml(ui.error)}</span>`;
    } else if (ui.progress.solved) {
      els.notice.hidden = false;
      els.notice.className = "notice notice-success";
      els.notice.innerHTML = "<strong>Solved.</strong> <span>You found the flawed line and the right issue type.</span>";
    } else if (Engine.isOver(ui.progress)) {
      els.notice.hidden = false;
      els.notice.className = "notice notice-warning";
      els.notice.innerHTML = `<strong>Round over.</strong> <span>You used all ${Engine.MAX_GUESSES} guesses. The explanation and share block are below.</span>`;
    } else {
      els.notice.hidden = true;
      els.notice.innerHTML = "";
    }
  }

  function renderTitlebar() {
    els.tabTitle.textContent = ui.puzzle.title;
    els.tabLanguage.textContent = `reviewdle/${ui.puzzle.language.toLowerCase()}`;
    const lineCount = Engine.selectableLineNumbers(ui.puzzle, ui.progress).length;
    const categoryCount = Engine.selectableIssueCategories(ui.progress).length;
    const typeCount = Engine.selectableIssueTypes(allIssueTypes(), ui.progress).length;
    els.statLines.textContent = `${lineCount} lines left`;
    els.statCategories.textContent = `${categoryCount} issue categories left`;
    els.statTypes.textContent = `${typeCount} issue types left`;
  }

  function renderCode() {
    const selectable = new Set(Engine.selectableLineNumbers(ui.puzzle, ui.progress));
    const over = Engine.isOver(ui.progress);
    els.codeBody.innerHTML = ui.puzzle.code.map((line, index) => {
      const lineNumber = index + 1;
      const isSelectable = over || selectable.has(lineNumber);
      const isSelected = ui.selectedLine === lineNumber;
      const isAnswer = over && lineNumber === ui.puzzle.answer_line;
      const classes = [
        "code-row",
        isSelected ? "selected-row" : "",
        isAnswer ? "answer-row" : "",
        isSelectable ? "" : "disabled-row",
      ].filter(Boolean).join(" ");
      return `<tr class="${classes}">
        <td class="line-number-cell">
          <button type="button" class="line-select${isSelected ? " selected" : ""}" data-line="${lineNumber}" aria-label="Select line ${lineNumber}"${isSelectable ? "" : " disabled"}>${pad2(lineNumber)}</button>
        </td>
        <td class="code-cell"><code>${highlightLine(ui.puzzle.language, line)}</code></td>
      </tr>`;
    }).join("");
  }

  function renderInspector() {
    const over = Engine.isOver(ui.progress);
    const allowedLines = Engine.selectableLineNumbers(ui.puzzle, ui.progress);
    const allowedCategories = new Set(Engine.selectableIssueCategories(ui.progress));
    const allowedTypes = new Set(Engine.selectableIssueTypes(allIssueTypes(), ui.progress));

    els.puzzleTitle.textContent = ui.puzzle.title;

    els.lineNumber.innerHTML =
      '<option value="">Choose a remaining line</option>' +
      allowedLines.map((lineNumber) => (
        `<option value="${lineNumber}"${ui.selectedLine === lineNumber ? " selected" : ""}>Line ${lineNumber}</option>`
      )).join("");
    els.lineNumber.disabled = over;

    let issueOptions = '<option value="">Choose a remaining issue type</option>';
    Object.entries(ISSUE_CATALOG).forEach(([category, types]) => {
      if (!allowedCategories.has(category)) return;
      const available = types.filter((issueType) => allowedTypes.has(issueType));
      if (!available.length) return;
      issueOptions += `<optgroup label="${escapeHtml(category)}">`;
      issueOptions += available.map((issueType) => (
        `<option value="${escapeHtml(issueType)}"${ui.selectedIssueType === issueType ? " selected" : ""}>${escapeHtml(issueType)}</option>`
      )).join("");
      issueOptions += "</optgroup>";
    });
    els.issueType.innerHTML = issueOptions;
    els.issueType.disabled = over;
    els.guessButton.disabled = over;

    els.metricLines.textContent = `${allowedLines.length} / ${ui.puzzle.code.length}`;
    els.metricCategories.textContent = `${allowedCategories.size} / ${allIssueCategories().length}`;
    els.metricTypes.textContent = `${allowedTypes.size} / ${allIssueTypes().length}`;

    if (!ui.progress.guesses.length) {
      els.guessList.innerHTML = '<li class="muted small-copy">No guesses yet.</li>';
    } else {
      els.guessList.innerHTML = ui.progress.guesses.slice(-4).reverse().map((guess) => (
        `<li>
          <span class="guess-line">L${guess.lineNumber}</span>
          <span class="status-pill status-${guess.lineStatus}">${guess.lineStatus}</span>
          <span class="guess-issue">${escapeHtml(guess.issueType)}</span>
          <span class="status-pill status-${guess.issueStatus}">${guess.issueStatus}</span>
        </li>`
      )).join("");
    }
  }

  function renderContext() {
    els.contextContent.innerHTML =
      `<p>${escapeHtml(ui.puzzle.summary)}</p>` +
      `<p class="muted">${escapeHtml(ui.puzzle.source_note)}</p>`;
  }

  function renderHistory() {
    if (!ui.progress.guesses.length) {
      els.historyContent.innerHTML = '<p class="muted">No guesses yet.</p>';
      return;
    }
    els.historyContent.innerHTML = `<table class="history-table">
      <thead><tr><th>Line</th><th>Line result</th><th>Issue type</th><th>Issue result</th></tr></thead>
      <tbody>${ui.progress.guesses.map((guess) => (
        `<tr>
          <td>${guess.lineNumber}</td>
          <td><span class="status-pill status-${guess.lineStatus}">${guess.lineStatus}</span></td>
          <td>${escapeHtml(guess.issueType)}</td>
          <td><span class="status-pill status-${guess.issueStatus}">${guess.issueStatus}</span></td>
        </tr>`
      )).join("")}</tbody>
    </table>`;
  }

  function renderOutcome() {
    if (!Engine.isOver(ui.progress)) {
      els.outcomeFold.hidden = true;
      els.outcomeContent.innerHTML = "";
      return;
    }
    els.outcomeFold.hidden = false;
    const points = Engine.scoreFor(ui.progress);
    const shareText = Engine.buildShareText(ui.dateStr, ui.progress, `${location.origin}${location.pathname}`);
    const scoreLine = ui.progress.solved
      ? `Solved in ${ui.progress.guesses.length}/${Engine.MAX_GUESSES} · +${points} points`
      : "Not solved · 0 points";
    els.outcomeContent.innerHTML = `
      <div>
        <h2>Review outcome</h2>
        <p><strong>Correct line:</strong> ${ui.puzzle.answer_line}</p>
        <p><strong>Issue type:</strong> ${escapeHtml(ui.puzzle.issue_type)}</p>
        <p>${escapeHtml(ui.puzzle.explanation)}</p>
        <p><strong>Score:</strong> ${escapeHtml(scoreLine)}</p>
      </div>
      <div>
        <h2>Share your result</h2>
        <p class="muted">Copy this spoiler-light result and invite people to try the same puzzle.</p>
        <textarea id="share-text" class="share-box" readonly>${escapeHtml(shareText)}</textarea>
        <div class="share-actions">
          <button id="copy-share" class="primary-button" type="button">Copy result</button>
          <span id="copy-status" class="muted" aria-live="polite"></span>
        </div>
      </div>
      <p class="submit-status" id="submit-status" aria-live="polite">${escapeHtml(ui.submitMessage)}</p>`;
    const copyButton = document.getElementById("copy-share");
    if (copyButton) copyButton.addEventListener("click", onCopyShare);
  }

  function render() {
    renderMeta();
    renderNotice();
    renderTitlebar();
    renderCode();
    renderInspector();
    renderContext();
    renderHistory();
    renderOutcome();
  }

  async function onCopyShare() {
    const textarea = document.getElementById("share-text");
    if (!textarea) return;
    const status = document.getElementById("copy-status");
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch (error) {
      textarea.focus();
      textarea.select();
      try { document.execCommand("copy"); } catch (ignored) { /* clipboard blocked */ }
    }
    if (status) status.textContent = "Copied.";
  }

  function onLineClick(event) {
    const button = event.target.closest(".line-select");
    if (!button || button.disabled) return;
    ui.selectedLine = Number(button.dataset.line);
    render();
  }

  function onLineChange() {
    ui.selectedLine = els.lineNumber.value ? Number(els.lineNumber.value) : null;
  }

  function onIssueChange() {
    ui.selectedIssueType = els.issueType.value;
  }

  function showError(message) {
    ui.error = message;
    renderNotice();
  }

  async function onGuess(event) {
    event.preventDefault();
    if (Engine.isOver(ui.progress)) return;
    const allowedLines = Engine.selectableLineNumbers(ui.puzzle, ui.progress);
    const allowedTypes = Engine.selectableIssueTypes(allIssueTypes(), ui.progress);
    const lineNumber = ui.selectedLine;
    const issueType = ui.selectedIssueType;
    if (!lineNumber || !allowedLines.includes(lineNumber)) {
      showError("Pick one of the currently selectable line numbers.");
      return;
    }
    if (!issueType || !allowedTypes.includes(issueType)) {
      showError("Pick one of the currently selectable issue types.");
      return;
    }
    ui.error = "";
    ui.progress = Engine.applyGuess(ui.progress, ui.puzzle, lineNumber, issueType);
    ui.selectedLine = null;
    ui.selectedIssueType = "";
    render();
    persistProgress();
    if (Engine.isOver(ui.progress)) {
      await finalizeRound();
    }
  }

  async function finalizeRound() {
    const solved = ui.progress.solved;
    const guesses = ui.progress.guesses.length;
    const points = Engine.scoreFor(ui.progress);
    const title = solved ? `Solved in ${guesses}/${Engine.MAX_GUESSES}` : "Round over";
    const body = solved
      ? `You found the flawed line and classified it. +${points} points.`
      : `Out of guesses. The answer is line ${ui.puzzle.answer_line} — ${ui.puzzle.issue_type}.`;
    showRunOverlay(title, body);
    if (!ui.submitted) await submitRun(points, solved, guesses);
  }

  async function submitRun(points, solved, guesses) {
    if (!root.Gamebase) {
      setSubmitMessage("Gamebase unavailable — score not submitted.");
      return;
    }
    ui.submitted = true;
    setSubmitMessage("Submitting result…");
    try {
      const outcome = await root.Gamebase.endRun({
        score: points,
        meta: {
          solved: solved ? 1 : 0,
          guesses,
          wrong: ui.progress.wrongGuesses,
          language: ui.puzzle.language,
          category: ui.puzzle.issue_category,
          puzzle: ui.puzzle.id,
          date: ui.dateStr,
        },
        unlock: ["first-review"],
      });
      const submission = outcome && outcome.submission;
      const parts = [];
      if (submission) {
        parts.push(`best ${submission.is_personal_best ? "★ " : ""}${submission.score}`);
        if (submission.rank) parts.push(`rank #${submission.rank}`);
      }
      const unlocked = (outcome && outcome.unlocked) || [];
      if (unlocked.length) parts.push("unlocked " + unlocked.map((achievement) => achievement.title).join(", "));
      setSubmitMessage(parts.join(" · ") || "Result recorded.");
    } catch (error) {
      ui.submitted = false;
      setSubmitMessage("Submit failed: " + (error && error.message ? error.message : String(error)));
    }
    persistProgress();
  }

  async function persistProgress() {
    if (!root.Gamebase) return;
    try {
      const saved = await root.Gamebase.saveState({
        puzzleId: ui.puzzle.id,
        progress: ui.progress,
        submitted: ui.submitted,
        submitMessage: ui.submitMessage,
      }, { revision: ui.revision });
      if (saved && typeof saved.revision === "number") ui.revision = saved.revision;
    } catch (error) { /* save is best-effort */ }
  }

  async function loadSaved() {
    try {
      const saved = await root.Gamebase.loadState();
      if (!saved || !saved.state || saved.state.puzzleId !== ui.puzzle.id) return;
      const progress = saved.state.progress || {};
      ui.progress = {
        guesses: Array.isArray(progress.guesses) ? progress.guesses : [],
        solved: Boolean(progress.solved),
        wrongGuesses: progress.wrongGuesses | 0,
        eliminated: Array.isArray(progress.eliminated) ? progress.eliminated : [],
      };
      ui.submitted = Boolean(saved.state.submitted);
      ui.submitMessage = saved.state.submitMessage || "";
      ui.revision = saved.revision || 0;
    } catch (error) { /* no saved state */ }
  }

  async function onPlayerReady(player) {
    setTag(player.handle);
    await loadSaved();
    render();
    try {
      const best = await root.Gamebase.myBest();
      if (best) setTag(`${player.handle} · best ${best.best}`);
    } catch (error) { /* no best yet */ }
  }

  function init() {
    const today = new Date();
    ui.dateStr = isoDate(today);
    ui.puzzle = Engine.puzzleForDay(today);
    if (!ui.puzzle) {
      els.puzzleTitle.textContent = "Puzzle bank failed to load.";
      return;
    }
    render();

    els.guessButton.addEventListener("click", onGuess);
    els.codeBody.addEventListener("click", onLineClick);
    els.lineNumber.addEventListener("change", onLineChange);
    els.issueType.addEventListener("change", onIssueChange);

    if (root.GameKit && root.Gamebase) {
      root.GameKit.ready({ tagElement: els.tag, onPlayer: onPlayerReady })
        .catch(() => setTag("guest"));
    } else if (root.Gamebase) {
      root.Gamebase.ready().then(onPlayerReady).catch(() => setTag("guest"));
    } else {
      setTag("guest");
    }
  }

  init();
})(typeof window !== "undefined" ? window : globalThis);
