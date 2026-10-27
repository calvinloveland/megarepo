# Review — “Make the case” (ammo-compare)

**Reviewed:** `origin/main` @ `813c034f`, the case-maker work synced from the 1337book host
(`c898461a` export script → `cf9a78f9` feature → `4c2fde69`, `813c034f` follow-ups).

> **Branch note (resolved).** The project briefly existed in two incompatible lines after
> `e68586b9`: the `data/cartridges.js` + `lib/schema.js` / `lib/relationships.js` rewrite
> (214 cartridges, 2026-10-21, unpushed) and this one (`data/ammo.js` + silhouettes,
> trajectory, designers, Case; 295 loads, 2026-10-25). This line was adopted as `main` — it is
> newer, has more coverage, more tests (49 unit + 79 browser), and the feature under review.
> The other line is preserved on branch `ammo-compare/schema-line` (`b4c2c436`); its unique
> features (CSV export, column presets, shift-click secondary sort) are listed under
> “Still to port” at the end.

## Verdict

The feature is well built: the math is precomputed offline, the browser only re-evaluates
stored weights, generator/browser parity is enforced by a test, and the documentation is
better than most. Every claim I could check in the docs is numerically correct.

The weak point is the **fallback path**: 191 of the 295 loads get it as their default view, and
it is presented in a way that contradicts the feature's own copy and the design doc. Two of
the cases I captured read as a bug. Details in P1 below.

## What I verified

| Check | Result |
|---|---|
| `node --test tests/*.test.mjs` | 49/49 pass |
| `tests/interaction.check.mjs` against Chromium 148 headless | 79/79 pass |
| `python3 tools/build-cases.py` regeneration | byte-identical to the checked-in `data/cases.js`; **11 m 30 s** |
| Docs counts (295 loads, 284/11/64/208/12 per scope, 874 load/scope results, 104 auto-feasible, 68 priced / 227 unpriced, 270 designers) | all exact |
| Stored ranks reproduced with the browser percentile math | 874/874, 0 mismatches |
| “No weighting can win” verdicts re-derived with the max-margin LP (32 sampled) | max margin ≤ 0 in every case (9mm/all −0.00102, .380/all −0.02521, .380/centerfire −0.01520, `22-hornet`/rifle exactly 0) |
| Fallback rank quality (16 sampled one-hot cases × 6 000 random Dirichlet weightings) | stored rank never beaten — the search is not leaving ranks on the table |

So: the numbers are sound, the artifact is reproducible, and the fallback is not
under-optimizing. The defects are in presentation and integration.

## P1 — the fallback shows a 100 % single-column weighting

659 of the 874 load/scope results are infeasible. **172 of them (26 %) come back as a
one-hot weight vector**, and 76 of the 191 auto-selected cases (40 %) are one-hot. The
column that carries the weight is almost always cost (92) or recoil (65), because the
max-margin LP's optimum is a simplex vertex.

Two user-visible consequences:

1. **`6.5×55mm`** → `closest found #30 of 208`, weights `Low cost 100 %`, margin −0.5676.
   The table becomes a price sort (5.45×39, 7.62×39, .223, .30 Carbine…); the selected load
   is not on screen. The panel note says “No non-negative weighting … puts 6.5×55mm first”
   while displaying a weighting that is 100 % one column.

   ![6.5×55mm closest case is a 100 % cost weighting](images/case-fallback-cost-only.png)
2. The panel footer in the same box still reads “Weights are chosen to be as even as
   possible…”, which is only true for the feasible branch (`tools/build-cases.py` step 2).
   For the fallback the doc says “closest weights found”, but nothing tells the reader that
   the result is a corner of the simplex.

Not a math bug — I could not find a better rank for any sampled case — but as a feature it
does not do what it says for 40 % of loads.

**Suggested fix (pick one):**

- Keep the table untouched when `feasible === false`; show the weights, the rank, and the
  rows still ahead in the panel only. This matches the doc's own framing (“the panel shows …
  the rows still ahead when the case loses”).
- Or keep the takeover, but add the weighted score (and rank) per row in case mode, and mark
  degenerate weightings explicitly, e.g. “Ties for #1 only if all the weight is on effective
  range”. `rankCase` can expose that with a `degenerate` / `maxWeight` field.

Also worth a generator change if you keep the corner: after the Dirichlet search, run one
max-entropy refinement constrained to `d_j·w ≤ 0` for every competitor that is *not* above
under the chosen weights. That preserves the rank and spreads the weights wherever the
rank region has interior. Two caveats I hit while prototyping it:

- for the rank-1 ties the region really is a single vertex (pistol: 16 of 22 stayed one-hot),
  so this only helps the rank ≥ 2 cases;
- you must re-verify `rank_of()` **after** the 8-decimal rounding — naive refinement moved
  4 of 22 pistol results from rank 2/3/5 to 3/5/7 because a constraint that was exactly 0
  went slightly negative. Add ~1e-7 slack to the constraints and re-check, the same way
  `build_scope` already re-checks `feasible` after `normalized()`.

## P1 — the selected row is pinned above rows that tie with it

`visibleRows()` sorts by score and then hoists the selected id on an exact tie. For a
rank-1 *infeasible* result that means the load is displayed first even though dozens of rows
score identically:

- `.44 Magnum` / pistol: `No strict weighting · tied for #1`, weights `Eff. range 100 %`,
  **29 other pistol loads tie at exactly the same score** (.38 Super, .357 SIG, 10 mm Auto,
  .357 Magnum, .41 Magnum, .45 Colt…), and .44 Magnum is hoisted above all of them.

  ![.44 Magnum tied for #1 on effective range, hoisted above 29 equal scores](images/case-tie-pinned.png)

- The design doc promises the opposite: “it never silently forces the selected row to the
  top.”

The note also says “No strict weighting separates .44 Magnum from the next load; the table
shows the tie” without naming a single tied load.

**Suggested fix:** don't hoist on ties (use the `rankCase` order), and add `tiedWith` to
`rankCase` so the note can say “ties with .38 Super, .357 SIG, 10 mm Auto and 26 others on
effective range”.

## P2 — the controls contradict the table while a case is active

`startCase()` sets `category = 'all'`, so the chip row shows **“All 295” pressed** while the
table shows the case scope (e.g. 208 rifle loads, 64 pistol loads). Both screenshots above
show this. The chips are disabled, so the reader cannot correct it, and the summary line and
the panel both say something different again.

**Suggested fix:** in case mode either hide the chip row, or render the active chip from the
case scope (“Rifle 208”) so the control state matches the table.

## P2 — keyboard focus is lost when a case starts

`startCase()` → `render()` replaces `tbody.innerHTML`, destroying the button that was
activated, then calls `scrollIntoView()` on the panel. Focus falls back to `<body>`, so the
next Tab starts from the top of the document. `toggleRow()` already solves this pattern
(`next?.focus({ preventScroll: true })`); the case flow should do the same — move focus to
the scope `<select>` (or the “Clear case” button).

Two smaller a11y items in the same area:

- `scrollIntoView({ behavior: 'smooth' })` ignores `prefers-reduced-motion`;
- `#case-status` is `aria-live`, but `#case-note` (the actual explanation) is not.

## P2 — two implementations of the same ordering

`visibleRows()` (app.js) and `rankCase()` (lib/case.js) both score every row and sort them,
with **different tie-breaks** (selected-first vs. name). They already disagree: for
`.44 Magnum` the table starts with .44 Magnum, while `rankCase().sorted` starts with
`.221 Remington Fireball`. Per `AGENTS.md` (“fix a concept once”), `visibleRows()` should
return `rankCase(...).sorted.map((entry) => entry.row)`; `rankCase` already returns the
sorted list, and `caseScore` / `percentileScores` would then only be needed inside the
library.

## P2 — the feature is outside the repo's check runner

`scripts/check_all.py` has no `ammo-compare` entry, so `npm test` (49 tests) never runs in
the repo-wide check pass. The interaction check also cannot run on a stock calnix host: the
docs say `google-chrome`, and neither `google-chrome` nor `chromium` is on `PATH` here. What
works on haswell (verified):

```sh
nix-shell -p chromium --run '
  (node server.mjs > /tmp/srv.log 2>&1 &) ;
  (chromium --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 \
     --user-data-dir=/tmp/ammo-chrome about:blank > /tmp/chrome.log 2>&1 &) ;
  sleep 6 ; APP_URL=http://localhost:5113/ node tests/interaction.check.mjs'
```

Suggest adding that to `docs/index.md#tests` and adding
`{"name": "ammo-compare", "script": "check_web_app", "args": ["ammo-compare"]}` (or a small
`check_ammo.py`) to `scripts/check_all.py`.

## P3 — smaller items

- **Generator ergonomics.** 11 m 30 s for a full regeneration, and the only way to verify the
  checked-in file is to regenerate it. Add `--scope <name>` for iteration and `--check` to
  diff against the checked-in file. `max_margin` is solved per load (874 LPs, up to 294
  constraints each) and the Dirichlet batch is 19 000 × k per infeasible case — both are
  vectorizable.
- **Silent skip.** `build_scope()` does `continue` when `max_margin` returns `None`, which
  would drop a load from `cases.js` and make `autoCaseFor()` return `null` (the Case button
  would then do nothing). `raise` instead; the tests would catch it, but loudly.
- **Payload.** `data/cases.js` is 137 KB (33 KB gzipped) and is a static import, so it is
  parsed on every page load even when Case is never used. `await import('./lib/case.js')` on
  the first Case click would remove it from the critical path.
- **Doc wording.** “If the gap is below 0.0001, there is no strict case” is not the same
  claim as “no weighting can win” — `FEASIBLE_EPS` is a robustness threshold, not the
  definition of strictness. In the data it makes no difference (every sampled infeasible
  verdict had max margin ≤ 0), so this is a wording fix: “no case with a margin large enough
  to survive rounding”.
- **“Still ahead” caps at three.** For `6.5×55` the note names 3 of the 29 loads ahead.
  “Still ahead: 5.45×39mm, 7.62×39, .223 Rem and 26 others” would be honest.
- **Collinearity.** Velocity, energy, power factor, and bullet weight are functions of two
  underlying variables, so the eight weights are not independent importances. The doc hints
  at this (“least-contrived weighting”) but could say it once, plainly.
- **Expansion state.** `startCase()` clears `expanded` and `clearCase()` does not restore it;
  `previous` also does not capture it.
- **Dead surface.** `rankCase()` returns `sorted` and `percentiles`; app.js uses only `rank`
  and `blockers`. Either use them (see P2 above) or drop them.

## What is good and should not be lost in a merge

- Derived-only math with a single implementation (`lib/ballistics.js`, `lib/trajectory.js`),
  and the generator importing the *same* model through `tools/export-case-rows.mjs` instead
  of re-implementing it in Python.
- The generator/browser parity test: recomputing all 874 stored ranks and margins with the
  browser math is the right guard, and it also catches most data drift.
- Honest framing of the fallback (“closest found”, never “wins”), and no invented prices.
- Offline-only tests, no runtime dependencies, CDP instead of Playwright.
- The documentation states its own caveats (typical loads, independent maxima, pattern-limited
  shot, estimated BCs, degenerate cost weighting) — rare and worth preserving.

## Still to port from `ammo-compare/schema-line`

These exist only on the archived branch and are worth bringing over when there is appetite:

- **CSV export of the current view** (`lib/csv.js` there) — built from the same column schema,
  so it cannot drift from what is on screen.
- **Column show/hide with presets** (`lib/schema.js` presets) and **shift-click secondary
  sort** (`lib/table.js`) — the reference grid is 12 columns wide and sheds them only by
  viewport width today.
- **Unit-aware tooltips on unlabelled quantity cells**, which that line added last
  (`b7beaf72`); this line labels every cell inline instead.

Not worth porting: its relationship-graph derivation engine. This line already derives energy,
power factor, momentum, trajectory, and geometry from stored primitives in
`lib/ballistics.js`, `lib/trajectory.js`, and `lib/cartridge-svg.js`, with SAAMI/C.I.P.
validation behind the silhouettes; a second derivation graph would duplicate the concept.

## Status of these findings

Applied in the commits that follow this review:

| Finding | Fix |
|---|---|
| P1 single-column fallback | `dominantCriterion()` in `lib/case.js`; the panel note now says “This is not an even argument: Low cost carries 100 % of the weight”, and the panel footer explains that the fallback optimises rank, not balance. The generator is unchanged, so the ranks and the 104/295 figure are untouched. |
| P1 tie hoisted to the top | `rankCase()` returns `tiedWith`; `visibleRows()` now returns `rankCase(...).sorted`, so the selected row keeps its place among its ties and the note names them (“.38 Super, .357 SIG, 10mm Auto and 26 others”). The table scroller moves to the selected row so it stays visible without reordering the evidence. |
| P2 controls contradict the table | In case mode the chip row marks the case's category (or nothing for centerfire) instead of a stale “All 295”. |
| P2 focus lost on start | `startCase()` focuses the “Compare against” menu after rendering, and honours `prefers-reduced-motion` for both scrolls. |
| P2 duplicated ordering | `visibleRows()` delegates to `rankCase()`; `scopeRows` / `caseScore` are no longer imported by `app.js`. |
| P2 outside the check runner | `scripts/check_all.py ammo-compare` runs `check_web_app.py ammo-compare` (new `check_node_static` checker: `node --check` over every module plus the unit suite). The docs show the `nix-shell -p chromium` invocation for the browser suite. |

Still open, deliberately: the generator-side max-entropy refinement (P1, second bullet), the
`--check` / `--scope` flags, the 11 m regeneration time, the eager 33 KB gzip of
`data/cases.js`, and the feature ports listed above. Tests now cover the two honesty rules:
`tests/cases.test.mjs` (51 unit tests) and `tests/interaction.check.mjs` (90 browser checks,
including the tie disclosure, the one-column disclosure, chip state, focus, and the
scroll-into-view behaviour).

### One model gap the .380 example exposes

`recoil` is the only criterion still hand-typed rather than derived: a 1–5 dot
score that puts 28 of the 64 pistol loads at 2/5, .380 ACP and 9mm Luger among
them. It is also the criterion buyers weigh most, so the Case feature can only
give it 3.7 % of the weight without the data arguing back. Deriving free recoil
from momentum and a stated reference gun mass per category (≈10 oz pocket pistol,
≈17 oz compact, ≈30 oz full size) would break the tie, make the .380-vs-9mm
trade-off visible, and give the weighting something real to optimise — the same
“derive, never store” rule the rest of the table already follows.

### Follow-up: recoil and legality (after the review)

The review's last open item — "recoil is the only hand-typed column" — turned out
to be load-bearing, and closing it exposed a real bug.

**Recoil is now derived** (`lib/recoil.js`): impulse `gr × fps / 7000`, free
recoil `impulse² / (2 · gun lb · 32.174)`, one reference gun mass per class
(5 lb rimfire, 2 lb pistol, 8 lb rifle, 7.5 lb shotgun), dot levels from fixed
bounds (`0.5 / 2 / 5 / 12 ft·lb`). The hand-typed 1–5 field is gone from all 295
rows and a test fails if one comes back.

The first regeneration then produced `.357 Magnum` “tied for first” with **all 63
other pistol loads**. Cause: recoil energy is momentum squared over twice the gun
mass, so inside a class — where the reference mass is fixed — recoil and power
factor are the same measurement, and weighting both creates a null direction that
scores every load identically. An SVD of the centred percentile matrix confirmed
it was the only null direction in every category scope.

Fixes, all in the generator plus one regression test:

- `powerFactor` is no longer a Case criterion (it stays a displayed column).
- `best_effort_weights()` rejects candidates whose scores barely spread
  (`MIN_SPREAD = 1e-3`).
- `tests/cases.test.mjs` asserts **every** stored weighting spreads its
  comparison set, which is the guard that would have caught this immediately.

Effect on the data: 114/295 loads have a strict case (was 104), rank-1 ties fell
from 160 to 14, one-hot fallbacks from 172/659 to 67/639. The `.380 ACP` case now
leads on recoil (27 %) rather than compact case (59 %), which matches how people
actually describe the choice, and `.45 ACP` can now make its case against all
loads instead of only pistols.

**Legality is in the table** (`data/legality.js`, `lib/legality.js`): rules per
(jurisdiction, statutory test) plus exceptions where a diameter rule and the
statute disagree, a `MX`/`IT`/`CA` badge on restricted rows, the statute in the
row detail, and a “Legal for civilians in” filter. It is deliberately **not** a
Case criterion — it is a gate, not a preference — and case mode parks and
restores the filter rather than narrowing a rank the weights were not solved for.
`tests/legality.test.mjs` pins the two cases that justify the overlay: .380 ACP
is unrestricted where 9mm is not, and .38 Special is unrestricted where .357
Magnum is not.

Suite sizes after this work: 68 unit tests, 118 browser checks.

### Follow-up: generator tooling (after the review)

The review's P3 item — "the only way to verify the checked-in file is to
regenerate it, which takes 11 minutes" — is now closed, and the time had grown to
about 27 minutes once recoil became continuous:

- `--scope <name>` re-solves one comparison set and merges it into the checked-in
  file, recomputing every load's `auto` scope and the scope counts from the
  combined results. Pistols take ~35 s. Rebuilding a scope with no data change
  reproduces the checked-in bytes exactly, which is verified in this commit.
- `--check` solves (all scopes, or one with `--scope`) and exits 1 with the list
  of stale loads instead of writing. Perturbing `.380 ACP`'s velocity by 20 fps
  makes `--check --scope pistol` report 31 stale loads in 35 seconds.

`tools/export-case-rows.mjs` also stopped emitting `powerFactor`, which the
generator no longer reads.

### Follow-up: fewest factors (after the review)

The Case feature originally solved for the *most even* weighting that wins. That
is the wrong objective for the thing the panel claims to do: a case is an
argument, and the strongest argument is the one that needs the fewest
assumptions. "It is the cheapest" beats "it is cheapest, softest and lightest".

`tools/build-cases.py` now searches subsets by size — every single criterion, then
every pair, and so on, each with its own max-margin LP — and stops at the first
size that yields a strict win. Weight is then split as evenly as possible *inside*
that subset, so a two-column case does not collapse onto one of them. The fallback
for loads that cannot win gets a greedy pass that drops columns the closest case
does not need.

The payload carries `factors` per result, the status line reads
`#1 of 284 centerfire loads · 1 factor`, and the panel lists the columns it does
not use. Each used column is then *checked* to be load-bearing by re-ranking with
that column removed; the note only claims it when the check passes.

| Load | Set | Result | Factors | Columns |
|---|---|---|---|---|
| `9mm Luger` | centerfire | #1 | 1 | cost 100 % |
| `.223 Rem` | all | #1 | 2 | cost 71 %, range 29 % |
| `.50 BMG` | all | #1 | 2 | energy 50 %, cost 50 % |
| `.380 ACP` | pistol | #1 | 3 | compact case 51 %, cost 28 %, bullet 21 % |
| `.45 ACP` | all | #1 | 4 | cost 54 %, bullet 19 %, range 14 %, recoil 13 % |

Across the 235 feasible results the median is 2 factors; only 15 need more than
five. Feasibility did not change (114/295 auto-selected, as before).

Two tests pin the objective: `factors` must match the non-zero weights, and for
every strict win, removing any one of its columns must lose first place. The
second is a necessary condition for minimality, and it is what caught the one
case where the search's notion of "wins" (margin ≥ 1e-4) differed from the
browser's (rank 1), which is why `rankCase()` now returns `margin` and
`lib/case.js` exports the same `FEASIBLE_EPS` the generator uses.

One consequence worth stating plainly: the minimal case for .380 ACP is not the
recoil story. Recoil alone puts it 12th of 64 and does not separate it from the
other light-kicking pistols, so the search never needs it; the fewest-assumption
argument is "small, cheap, heavy for its size". Both are true, and the docs now
say which one the panel is making.

### Follow-up: jurisdiction-scoped cases

Legality was a filter; the Case feature could not use it. Now it can: the
generator emits one comparison set per jurisdiction the overlay covers, built
from `restrictedIn` in the exported rows — i.e. from `data/legality.js`, not a
second copy of the rules — and `lib/case.js` resolves those scope keys through
`matchesJurisdiction`, so membership means the same thing in both directions.

| Set | Rows | Feasible cases |
|---|---:|---:|
| Loads legal in Mexico | 149 | 53 |
| Loads legal in Italy | 293 | 65 |
| Loads legal in Canada | 289 | 63 |

Starting a case while the jurisdiction filter is active opens the panel in that
set — the filter asks "what may I own here", and the case answers "here is the
best argument among those". A load restricted there is never offered the set
(9mm's menu is all / centerfire / pistol / Canada). `auto` deliberately ignores
jurisdiction sets: a jurisdiction is a filter the reader applies, not a breadth
level, so a load that cannot win anywhere still reports its broadest base set.

The payoff is an honest, slightly uncomfortable result: `.380 ACP` wins its
pistol case (3 factors) and then **cannot** win among Mexican-legal loads — rank
4 of 149 — because the 9mm it is usually measured against is not in that set,
and the .22/.25/.32 rounds beat it on compactness and cost. The panel says
"closest found #4" rather than pretending. That is the difference between "the
best pocket pistol" and "the best cartridge you can legally buy in Mexico", and
the feature now tells them apart.

Scope metadata is derived end to end: the generator's `SCOPES` grows from the
exported jurisdiction list, `--scope mx` rebuilds just that set (~17 s), and
`tests/cases.test.mjs` asserts each jurisdiction scope's count against
`matchesJurisdiction` over the dataset, so the two can never drift.

### Follow-up: the docs now check themselves

Every regeneration moved numbers that `docs/index.md` and `README.md` quote —
strict-case counts, scope sizes, single-column fallbacks, the `.380 ACP` split.
Keeping them in sync by hand failed repeatedly during this work, so
`tests/docs.test.mjs` now reads both documents and asserts the claims against the
data:

- coverage (designers, priced/unpriced, published ballistic coefficients),
- the SAAMI/C.I.P. drawing count and the row count it covers,
- every row of the comparison-set table, with jurisdiction counts checked
  against `matchesJurisdiction` rather than the payload alone,
- strict-case / tie / single-column-fallback statistics,
- the illustrative case table (load, set, result, factor count),
- the `.380 ACP` walkthrough, including the three ablation ranks,
- the `.44 Magnum` tie count.

It found three stale claims on its first run: the drawing count said 39
cartridges when there are 35 distinct drawings covering 42 rows, the tie count
said 14 when it had become 15, and the single-column fallback count said 75 of
639 when jurisdiction scopes had made it 115 of 1189. Those are exactly the
numbers a reader would trust.
