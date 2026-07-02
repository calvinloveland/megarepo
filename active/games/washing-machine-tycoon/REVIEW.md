# Washing Machine Tycoon — Code Review (Tracks fixed/unfixed)

**Legend:** ✅ Fixed | 🔴 OPEN Critical | 🟠 OPEN Major | 🟡 OPEN Moderate | 🟢 OPEN Minor

A thorough audit of the codebase (≈5,900 lines) plus headless Playwright
probes confirming the worst bugs. Findings are grouped by severity.

---

## 🔴 CRITICAL BUGS (gameplay-breaking)

### ✅ 1. Failure probability is catastrophically over-tuned — every machine fails ~30× in its first 2 months

**Evidence (headless probe, ~175 game days on Medium):**
```
First machine: {"serial":"WM-00000001","ageDays":53,"loadsCompleted":53,"failures":31,"customerType":"family"}
Global:        166 active machines, 952 total failures, 44 pending claims, 908 resolved
```
A *family* customer does 15 loads/week. In 53 game days that's ~114 real loads.
The machine has logged **31 failures** — it fails on roughly 1 of every 4 loads.

**Root cause** — `SIM.systemFailures` (simulation.js):
```js
let prob = failureDef.baseRate * machine.loadsCompleted * wearMultiplier;
```
`prob` accumulates against **cumulative loads**, not per-load. The formula
grows without bound as the machine ages. Combined with 10 failure types each
rolling independently, a machine has near-100% chance of ≥1 failure per tick.
The `prob > 0.00001` guard doesn't help because the cumulative term
dominates almost immediately.

**Fix:** Failure probability must be **per-tick (per-load), not cumulative**.
```js
const loadsToday = custType ? custType.loadsPerWeek / 7 : 0.3;
const prob = failureDef.baseRate * wearMultiplier * (1 - opt.durability*0.7)
           / getEffectiveQualityMultiplier() * Math.max(1, ageYears*0.3);
if (Math.random() < prob * loadsToday) { ... fail ... }
```

This is the single biggest reason the game feels punishing and the Service
department is instantly overwhelmed.

---

### ✅ 2. Auto-resolved claims vastly outnumber pending claims — players can't actually make warranty decisions

**Evidence:** 908 resolved vs 44 pending after ~3 seconds. `SIM.systemWarrantyService`
auto-assigns and auto-resolves claims within days, so by the time a player
navigates to Service Department the claim is already gone. The "Manual
Resolution" buttons in `UI.renderServiceDept` are reachable only if
`claim.status === 'open'`, which almost never persists.

**Root cause:** `SIM.systemWarrantyService` assigns a tech after `daysOpen > 1`
and schedules resolution ~2–5 days later, every tick. Resolution is
automatic and instant.

**Fix:** Auto-resolution should only happen for *out-of-warranty* or
*overdue* claims. In-warranty claims should wait for explicit player action
(or at minimum give the player a configurable "auto-resolve policy").

---

### ✅ 3. `SIM.resolveClaim` ignores the player's chosen resolution — all 4 buttons do the same thing

`UI.renderServiceDept` renders 4 buttons (Repair / Discount / Replace /
Decline), but every one calls:
```js
SIM.resolveClaim(window.gameState.company.pendingClaims.find(c=>c.id==='${claim.id}'))
```
`SIM.resolveClaim` takes no resolution argument — it **guesses** via
`Math.random()`. The player's choice is discarded entirely.

**Fix:** `resolveClaim(claim, forcedResolution)` and pass the chosen action
from each button.

---

### ✅ 4. Repair cost is multiplied by the **bearings** supplier cost multiplier for every claim

`SIM.resolveClaim`:
```js
cost *= getSupplierCostMultiplier(G.company.suppliers.bearings || 'nationalSupplier');
```
A pump-blockage claim is billed using the bearing supplier's cost. Wrong key
for most failure types (should use `claim.componentSource`).

---

### ✅ 5. Choice-event effects partially dropped

`SIM.resolveChoiceEvent` applies `reputation` and `cash` but ignores
`technicians`, `customerSatisfaction`, and `marketShare` — whereas
`_applyEventEffects` handles all of them. Choice events with those fields
(e.g. "skilledLabor" grants +2 technicians) silently do nothing.

---

### ✅ 6. `UI.startGame` uses native `confirm()` which is blocked by headless/iframe contexts

`UI.startGame` calls `confirm('📂 Saved game found!...')`. In the Cloudflare
tunnel iframe and in browsers with dialog suppression, this throws or hangs
the boot path. The Playwright test only passes because it installs a
`page.on('dialog')` handler.

**Fix:** Replace with the in-DOM modal pattern already used for events.

---

### ✅ 7. `marketShare` event effect is mis-applied as reputation

`SIM._applyEventEffects`:
```js
if (effects.marketShare) {
  G.company.reputation = Math.min(100, G.company.reputation + effects.marketShare);
}
```
注释 says "Small bonus to player's effective market presence" but it
manipulates reputation, not market share. The "Acquisition Opportunity"
event claims +2 market share but boosts reputation instead.

---

## 🟠 MAJOR ISSUES

### ✅ 8. `UI.render()` rebuilds the **entire DOM of all 7 screens** on every animation frame (~60fps)

`UI.gameLoop` → `UI.render()` → `renderTopBar + renderDashboard +
renderDesignStudio + renderFactory + renderMachineBrowser + renderServiceDept
+ renderMarket + renderResearch`, each doing `el.innerHTML = html`.

Consequences:
- ** destroys DOM focus every frame.** Typing in the model-name input,
  adjusting a slider, or typing in the machine search box is reset on the
  next frame because the element is replaced. This is why sliders and
  search feel broken.
- **Type/click is fight-the-clock.** `oninput="UI.render()"` on the design
  cost calculator re-renders the form, losing focus mid-keystroke.
- **Performance** collapses with a large machine fleet — the Machine
  Browser rebuilds 100 rows × 60fps.

**Fix:** Render only the active screen (or use a dirty-flag / diffing
approach). At minimum, gate each `renderX` on `UI.currentScreen === 'x'`
and only update the topbar every frame.

---

### ✅ 9. Machine Browser search filter self-destructs

`renderMachineBrowser` reads the search/filter inputs:
```js
const search = (document.getElementById('machine-search')?.value || '').toLowerCase();
```
But `render()` rebuilds `#machine-search` from scratch every frame, so the
value is always empty when read (the user's keystroke triggers `UI.render`
which wipes the field before the value is captured). Search is non-functional.

(Same root cause as #8 — affects Factory sliders, Market/Research budget
sliders, and the design cost display too.)

---

### 10. `UI.calcMarketShare` is called ~60×/second and may not match the AI share formula

Used on dashboard + market view every frame. The AI competitors' `marketShare`
is set in `SIM.systemSales` from `score/totalScore`, while the player's share
is computed by `UI.calcMarketShare` from cumulative `machinesSold`. The two
formulas are **inconsistent** — player share and AI shares may not sum to
100%, and the dashboard share can disagree with the market view.

**Fix:** Have a single source of truth (`SIM.systemSales` should record the
player's share, not just AI's).

---

### 11. Player can't set a retail price that the market will accept — no price-demand signal

`SIM.systemSales` player score:
```js
Math.max(0, 100 - avgPrice / 10) * 0.2
```
A $499 machine scores `100 - 49.9 = 50`. The formula has no concept of
*profitability* — selling at $1 wins market share. There's also no per-model
pricing: the player sets one price at design time and the AI competes per-model,
but the player's "avg price" washes out any premium strategy.

---

## 🟡 MODERATE BUGS

### 12. `factoryFlood` and several events ignore their own `requiresModels`

Negative events like `factoryFlood`, `supplyDisruption`, `componentShortage`
don't set `requiresModels:true`, so they can fire on day 365 of a brand-new
game with no models. Minor, but kills a new player's first impression.

---

### ✅ 13. Yearly P&L in the charts is double-counted for some expense categories

`handleYearEnd` deducts tech/marketing/R&D annually, **and** `systemFinance`
deducts them daily (`technicians*5` daily overhead + `marketingBudget/30` +
`researchSpending/30`). The annual block then hits again at year rollover
→ expenses are counted twice for those line items.

**Fix:** Remove the duplicate annual deductions in `handleYearEnd` (the daily
system already accrues them).

---

### 14. `systemAging` loads are probabilistic per day, not per-load

```js
if (Math.random() < loadsPerDay) { machine.loadsCompleted++; }
```
A "family" at 15 loads/week → `loadsPerDay ≈ 2.14`, so `Math.random() < 2.14`
is **always true** → exactly 1 load/day, capping at 365/year. Real families
do ~780 loads/year. This distorts the wear economy (and feeds bug #1).

**Fix:** `loadsCompleted += Math.floor(loadsPerDay) + (Math.random() < loadsPerDay%1 ? 1 : 0)`.

---

### 15. `SIM.systemWarrantyService` emergency dispatch ignores tech availability

```js
if (claim.daysOpen > 14 && claim.status === 'open') {
  claim.assignedTech = true; ...
```
It sets `assignedTech = true` and schedules resolution even with **zero**
technicians in the region. Hiring techs has no gameplay effect on resolution
speed because the emergency path bypasses it.

---

### ✅ 16. Replaced machines get `ageDays = 0` and `loadsCompleted = 0` but keep their `failures` history

`SIM.resolveClaim` reset:
```js
machine.currentStatus = 'active';
machine.loadsCompleted = 0;
machine.ageDays = 0;
```
The `failures[]` array is untouched, so the Machine Browser shows a "0-day-old"
machine with 30 historical failures — confuses the failure-rate display and
the "longevityMilestone" event logic.

---

### 17. `companyAddModel` doesn't reset `isActive` for superseded models — no product lifecycle

Models stay `isActive: true` forever. A 1970 plastic-drum model keeps
"competing" for the player's sales allocation in 2020. There's no retire/
discontinue action, so old models pollute the factory dropdown and dilute
`avgModelQuality`/`avgPrice`.

---

### 18. Save format has no migration path

`loadGame` restores `G` by direct assignment and patches a few missing
fields with `|| []`. If the schema changes (counter names, nested objects,
`_setupState`, `_lastYearRevenue`), old saves silently break or lose data.
No version check, no upgrade function.

---

### 19. `G._lastYearRevenue` / `_lastYearExpenses` are not saved

They're set on `G` at runtime and saved in `G`, but `loadGame` doesn't
restore `_lastYear*` explicitly — they come back as-is from the blob, but if
the save predates them they're `undefined` and the first year-end chart
snapshot computes `NaN`.

---

### 🔴 20. Tech unlocks are purely cosmetic — no gameplay effect (still OPEN)

`systemTechUnlocks` adds the tech *name* to `unlockedTechs` and logs a
message, but **nothing checks `unlockedTechs`**. Components are gated by
`yearAvailable` directly in `data.js`. The "Research level" number and the
"Technology Timeline" view are flavor only. R&D spending does nothing
meaningful.

---

### ✅ 21. Regulations are announced but never enforced

`systemRegulations` pushes the regulation and logs "your machines must meet
new noise standards!" but no system checks compliance. Old, non-compliant
models continue to sell. The "RoHS", "smartGrid", "partsMandate" effects
are stored as strings and never parsed.

---

## 🟢 MINOR / POLISH ISSUES

### 22. No favicon → 404 (harmless but noisy in the error console / Cloudflare logs)

### 23. The Machine Browser only shows the last 100 machines (`slice(-100)`) — no pagination. With a real fleet (thousands) you can never find old units.

### 24. `formatDate` uses `day % 30.4` for day-of-month, so "Jan 31" never appears and months drift.

### 25. Speed control (1x/5x/30x) is a tiny topbar span with no visual affordance — users won't discover it.

### 26. No keyboard shortcut for pause/resume.

### 27. `localStorage` quota (~5MB) will be exceeded once `activeMachines` reaches a few thousand — full machine objects are serialized. Needs compaction (drop disposed machines, cap array length) or IndexedDB.

### 28. No "New Game" / "Reset" button anywhere. Once a save exists you can only overwrite via difficulty modal.

### 29. Setup guide "Go there →" buttons call `UI.showScreen(...); UI.hideSetupGuide();` — once hidden, the only way back is the topbar "📋 Guide" button, which is easy to miss.

### 30. The Help / "How to Play" overlay has no entry point visible in the topbar. It's only reachable from the Dashboard "Quick Actions → How to Play" button.

### 31. `start.sh` watchdog has no PID file or log rotation; if two instances start they fight for the port.

### 32. `server.mjs` returns `text/plain` for 404s but sends `Cache-Control` only on 200s — 404s are cacheable by Cloudflare (the documented "4-hour outage" risk).

### 33. `index.html` references `?v=3` — bumping the version requires a manual edit. A build-time hash or `Date.now()` gate would be safer.

### 34. Inline `onclick="..."` handlers everywhere rely on globals. Works, but is fragile and hard to test. (Architectural, not urgent.)

### 35. `SOUND._ambienceLFO` is started but its ramp-down in `stopAmbience` races with the 600ms timeout — can leaving a dangling oscillator if toggled rapidly.

### 36. `AI._adjustProduction` compares `ai.marketShare - comp.marketShare` but `ai.marketShare` is set from the *previous* tick's `comp.marketShare` — they're nearly identical, so production barely adjusts. The "AI adapts" claim is weak.

### 37. The competitor "Last Model" column in Market view shows the *year introduced* (`info.model = ai.currentModel.yearIntroduced`) not the model name — confusing.

---

## 🧪 TEST SUITE NOTES

`setup-flow.spec.mjs` passes 34/34 but it **works around** several real bugs
by calling `page.evaluate` to mutate `window.gameState` directly (e.g. setting
`line.active = true` and `line.modelId` manually). This means the test does
**not** exercise the actual UI buttons for starting production. A honest
end-to-end test (clicking the real Start button) would currently fail because
the setup-guide overlay intercepts clicks (fixed in CSS via
`pointer-events: none` on `.paused-indicator`, but the setup-guide overlay
itself still covers the factory when visible).

The probe also confirmed:
- Speed control **does** affect tick rate (good: 106 ticks/2s@30x vs 93@1x —
  though the ratio should be 30:1, so the speed implementation is throttled
  by something, likely the per-tick work in `systemSales`/`systemFailures`).

---

## Suggested fix order (impact × ease)

1. **Bug #1** (failure rate cumulative) — fixes the core "everything breaks"
   feel. ~15 min.
2. **Bug #3** (resolveClaim ignores player choice) — makes Service playable. ~10 min.
3. **Bug #2** (auto-resolve太快) — let in-warranty claims wait for player. ~20 min.
4. **Issue #8/#9** (render every frame destroys inputs) — biggest UX win. ~1–2 hrs.
5. **Bug #13** (double expense counting) — fixes the P&L charts. ~10 min.
6. **Bug #7** (marketShare→reputation) — ~5 min.
7. **Bug #6** (confirm() blocking) — replace with modal. ~20 min.
8. **Issue #11** (no per-model pricing / profitability) — design decision. ~1 hr.
9. **Issue #20/#21** (tech & regulations are cosmetic) — make them matter. ~2 hrs.
10. **Issue #17** (model lifecycle) — add Retire action. ~30 min.