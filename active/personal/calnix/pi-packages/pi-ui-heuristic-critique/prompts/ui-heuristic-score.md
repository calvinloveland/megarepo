---
description: Score a UI from screenshots first using a fixed heuristic rubric with severity counts and concrete evidence
argument-hint: "[screen-or-focus-area]"
---
Score the UI for: $@

Work screenshot-first.

If screenshots, mockups, or visual artifact paths are available, inspect them before scoring. Base every issue on visible evidence from the interface. If no screenshot or visual artifact is available, say the score is lower confidence, explain what evidence is missing, and still provide the best rubric-based assessment you can.

Use this fixed severity scale only:

Severity order: `blocker | major | minor | nit`

- `blocker` — prevents task completion, creates severe confusion, or introduces major accessibility risk
- `major` — substantially harms clarity, trust, or task flow
- `minor` — noticeable quality issue that should be cleaned up soon
- `nit` — polish item with low user impact

Use this heuristic rubric:

- clarity of purpose and primary action
- hierarchy and scannability
- spacing, alignment, and grouping
- affordance and interaction cues
- accessibility and legibility
- state handling and feedback
- copy and form friction
- density and responsiveness risk

Format the response as:

1. **Score summary**
   - Overall score: `0-100`
   - Confidence: `high | medium | low`
   - Severity counts: `blocker=X, major=Y, minor=Z, nit=W`
2. **Top issues** — a prioritized table with columns:
   - Severity
   - Heuristic
   - Evidence from screenshot or artifact
   - Impact
   - Recommended change
3. **Quick wins** — the 3 most leverage-positive improvements
4. **Ship decision** — choose one:
   - `ready`
   - `ready with nits`
   - `needs revision`
   - `blocked`
   and explain why in 2-4 bullets
5. **When to A/B test** — note whether two credible remedies should become `ab_test_visuals` options, and when `captureRationale: true` would help preserve why the winning remedy was chosen

Scoring guidance:

- Start from 100 and subtract for real user-facing problems.
- A single blocker should usually prevent a `ready` decision.
- Do not inflate precision; if evidence is weak, lower confidence instead of pretending certainty.
- Prefer a smaller number of well-supported issues over a long list of speculative ones.
