const state = window.__DASHBOARD_INITIAL_STATE__ || {
  overview: {},
  artifacts: [],
  workers: [],
  plan: { exists: false },
};

const artifactListEl = document.getElementById("artifact-list");
const artifactDetailEl = document.getElementById("artifact-detail");
const workerGridEl = document.getElementById("worker-grid");
const overviewStatsEl = document.getElementById("overview-stats");
const searchEl = document.getElementById("artifact-search");
const kindFilterEl = document.getElementById("artifact-kind-filter");

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function badge(label, className = "") {
  return `<span class="badge ${className}">${label}</span>`;
}

function renderOverview() {
  const overview = state.overview || {};
  const cards = [
    ["Artifacts", overview.totalArtifacts ?? 0],
    ["Runs", overview.runCount ?? 0],
    ["Traces", overview.traceCount ?? 0],
    ["Avg edge", formatPercent(overview.averageExpectedEdge)],
    ["Avg confidence", formatPercent(overview.averageConfidence)],
    ["Latest capture", formatTime(overview.latestCaptureTimeMs)],
  ];
  overviewStatsEl.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="stat-card">
          <div class="stat-label">${label}</div>
          <div class="stat-value">${value}</div>
        </div>
      `,
    )
    .join("");
}

function artifactMatchesFilters(artifact) {
  const query = (searchEl.value || "").trim().toLowerCase();
  const kind = kindFilterEl.value;
  const haystack = `${artifact.question || ""} ${artifact.marketId || ""} ${artifact.fileName || ""}`.toLowerCase();
  if (kind !== "all" && artifact.kind !== kind) return false;
  if (!query) return true;
  return haystack.includes(query);
}

function renderArtifacts() {
  const artifacts = (state.artifacts || []).filter(artifactMatchesFilters);
  if (artifacts.length === 0) {
    artifactListEl.innerHTML = `<div class="empty-state">No artifacts match the current filters.</div>`;
    return;
  }
  artifactListEl.innerHTML = artifacts
    .map(
      (artifact) => `
        <article class="artifact-card" data-artifact-id="${artifact.id}">
          <div class="artifact-title">${artifact.question || artifact.fileName}</div>
          <div class="badges">
            ${badge(artifact.kind, artifact.kind)}
            ${artifact.variant ? badge(artifact.variant) : ""}
            ${artifact.action ? badge(artifact.action, artifact.action) : ""}
            ${artifact.executionStatus ? badge(artifact.executionStatus, artifact.executionStatus) : ""}
          </div>
          <div class="artifact-meta">
            <div>
              <div class="meta-label">Market</div>
              <div class="meta-value">${artifact.marketId || "—"}</div>
            </div>
            <div>
              <div class="meta-label">Captured</div>
              <div class="meta-value">${formatTime(artifact.capturedTimeMs)}</div>
            </div>
            <div>
              <div class="meta-label">Market probability</div>
              <div class="meta-value">${formatPercent(artifact.marketProbability)}</div>
            </div>
            <div>
              <div class="meta-label">Target probability</div>
              <div class="meta-value">${formatPercent(artifact.targetProbability)}</div>
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  for (const card of artifactListEl.querySelectorAll(".artifact-card")) {
    card.addEventListener("click", async () => {
      const artifactId = card.dataset.artifactId;
      await selectArtifact(artifactId);
    });
  }
}

function renderWorkers() {
  const workers = state.workers || [];
  if (workers.length === 0) {
    workerGridEl.innerHTML = `<div class="empty-state">No project-local workers found.</div>`;
    return;
  }
  workerGridEl.innerHTML = workers
    .map(
      (worker) => `
        <article class="worker-card">
          <div class="worker-name">
            <h3>${worker.name}</h3>
            <span class="worker-role">${worker.role}</span>
          </div>
          <p class="muted">${worker.description || "No description"}</p>
          <div class="worker-meta">
            ${(worker.tools || []).map((tool) => badge(tool)).join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderDetail(detail) {
  const summary = detail.summary || {};
  const payload = detail.payload || {};
  const decision = payload.decision || {};
  const recommendation = payload.recommendation || {};
  const metrics = payload.metrics || {};
  const execution = payload.execution_result || {};
  const bundle = payload.bundle || payload;
  const policy = decision.policy || {};
  const inputs = decision.evaluated_inputs || [];
  const rationale = decision.rationale || recommendation.reasons || [];
  const phaseOneOutputs = (payload.phaseOne && payload.phaseOne.outputs) || {};
  const phaseTwoOutputs = (payload.phaseTwo && payload.phaseTwo.outputs) || {};

  artifactDetailEl.classList.remove("empty-state");
  artifactDetailEl.innerHTML = `
    <div class="detail-title-row">
      <div>
        <h3>${summary.question || summary.fileName}</h3>
        <p class="muted">${summary.marketId || "No market id"} · ${summary.fileName}</p>
      </div>
      <div class="badges">
        ${summary.kind ? badge(summary.kind, summary.kind) : ""}
        ${summary.variant ? badge(summary.variant) : ""}
        ${summary.action ? badge(summary.action, summary.action) : ""}
        ${summary.executionStatus ? badge(summary.executionStatus, summary.executionStatus) : ""}
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card"><div class="label">Market probability</div><div class="value">${formatPercent(summary.marketProbability)}</div></div>
      <div class="metric-card"><div class="label">Target probability</div><div class="value">${formatPercent(summary.targetProbability)}</div></div>
      <div class="metric-card"><div class="label">Confidence</div><div class="value">${formatPercent(summary.confidence)}</div></div>
      <div class="metric-card"><div class="label">Bet amount</div><div class="value">${formatNumber(summary.betAmount)}</div></div>
      <div class="metric-card"><div class="label">Expected edge</div><div class="value">${formatPercent(summary.expectedEdge)}</div></div>
      <div class="metric-card"><div class="label">Exploitability</div><div class="value">${formatPercent(summary.exploitability)}</div></div>
    </div>

    <div class="detail-grid">
      <section class="block">
        <h3>Market snapshot</h3>
        <ul class="list">
          <li><strong>Captured:</strong> ${formatTime(summary.capturedTimeMs)}</li>
          <li><strong>Comments:</strong> ${summary.commentCount ?? 0}</li>
          <li><strong>Actors:</strong> ${summary.actorCount ?? 0}</li>
          <li><strong>Volume:</strong> ${formatNumber(summary.volume)}</li>
          <li><strong>Liquidity:</strong> ${formatNumber(summary.liquidity)}</li>
        </ul>
      </section>

      <section class="block">
        <h3>Policy</h3>
        <ul class="list">
          <li><strong>Allowed bet size:</strong> ${formatNumber(policy.allowed_bet_size)}</li>
          <li><strong>Capability scale:</strong> ${formatPercent(policy.capability_scale)}</li>
          <li><strong>Adversarial pressure:</strong> ${formatPercent(policy.adversarial_pressure)}</li>
          <li><strong>Should trade:</strong> ${policy.should_trade === undefined ? "—" : String(policy.should_trade)}</li>
          <li><strong>Execution:</strong> ${execution.status || summary.executionStatus || "—"}</li>
        </ul>
      </section>
    </div>

    <section class="block">
      <h3>Rationale</h3>
      ${rationale.length ? `<ul class="list">${rationale.map((item) => `<li>${item}</li>`).join("")}</ul>` : `<p class="muted">No rationale recorded.</p>`}
    </section>

    ${Object.keys(phaseOneOutputs).length || Object.keys(phaseTwoOutputs).length ? `
      <section class="block">
        <h3>Agent review rounds</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Phase</th><th>Job</th><th>Worker</th><th>Parsed output</th></tr></thead>
            <tbody>
              ${Object.entries(phaseOneOutputs).map(([jobId, output]) => `<tr><td>Phase 1</td><td>${jobId}</td><td>${output.selectedWorker || "—"}</td><td><pre>${JSON.stringify(output.parsed || {}, null, 2)}</pre></td></tr>`).join("")}
              ${Object.entries(phaseTwoOutputs).map(([jobId, output]) => `<tr><td>Phase 2</td><td>${jobId}</td><td>${output.selectedWorker || "—"}</td><td><pre>${JSON.stringify(output.parsed || {}, null, 2)}</pre></td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>
    ` : ""}

    <section class="block">
      <h3>Metrics</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            ${Object.entries(metrics)
              .map(([key, value]) => `<tr><td>${key}</td><td>${typeof value === "number" ? formatNumber(value, 4) : JSON.stringify(value)}</td></tr>`)
              .join("") || `<tr><td colspan="2" class="muted">No metrics recorded.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="block">
      <h3>Evaluated inputs</h3>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Signal</th>
              <th>Trust</th>
              <th>Intelligence</th>
              <th>Skepticism</th>
              <th>Weight</th>
              <th>Excerpt</th>
            </tr>
          </thead>
          <tbody>
            ${inputs.length
              ? inputs
                  .map(
                    (input) => `
                      <tr>
                        <td>${input.username || input.user_id || "—"}</td>
                        <td>${formatPercent(input.signal_probability)}</td>
                        <td>${formatPercent(input.trust_score)}</td>
                        <td>${formatPercent(input.intelligence_score)}</td>
                        <td>${formatPercent(input.skepticism)}</td>
                        <td>${formatPercent(input.effective_weight)}</td>
                        <td>${input.text_excerpt || "—"}</td>
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="7" class="muted">This artifact does not include evaluated inputs.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="block">
      <h3>Raw execution summary</h3>
      <pre>${JSON.stringify(execution, null, 2) || "{}"}</pre>
    </section>
  `;
}

async function selectArtifact(artifactId) {
  for (const card of artifactListEl.querySelectorAll(".artifact-card")) {
    card.classList.toggle("is-active", card.dataset.artifactId === artifactId);
  }
  artifactDetailEl.classList.add("empty-state");
  artifactDetailEl.textContent = "Loading artifact detail…";
  const response = await fetch(`/api/artifacts/${artifactId}`);
  if (!response.ok) {
    artifactDetailEl.textContent = `Failed to load artifact ${artifactId}.`;
    return;
  }
  renderDetail(await response.json());
}

function bindFilters() {
  for (const element of [searchEl, kindFilterEl]) {
    element.addEventListener("input", renderArtifacts);
    element.addEventListener("change", renderArtifacts);
  }
}

function boot() {
  renderOverview();
  renderArtifacts();
  renderWorkers();
  bindFilters();
  const firstArtifact = (state.artifacts || [])[0];
  if (firstArtifact) {
    selectArtifact(firstArtifact.id);
  }
}

boot();
