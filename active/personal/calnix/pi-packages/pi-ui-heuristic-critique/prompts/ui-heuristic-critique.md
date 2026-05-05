---
description: Critique a UI from screenshots first using practical heuristics and prioritized recommendations
argument-hint: "[screen-or-focus-area]"
---
Critique the UI for: $@

Work screenshot-first.

If screenshots, mockups, or visual artifact paths are available, inspect them before giving advice. Base every important finding on visible evidence from the interface.

If no screenshot or visual artifact is available, say the critique is lower confidence, explain what visual evidence is missing, and still provide the best heuristic critique you can from the available description.

Use practical UI heuristics, especially:

- clarity of primary action and purpose
- information hierarchy and scannability
- spacing, alignment, grouping, and visual rhythm
- contrast, legibility, and accessibility risks
- affordances, signifiers, and perceived clickability
- state handling, feedback, errors, and empty/loading states
- copy quality, labels, and form friction
- density, responsiveness, and likely mobile behavior

Prefer concrete recommendations over generic design advice.

Format the response as:

1. **Overall read** — 2-4 bullets on what the screen communicates well or poorly
2. **What works** — short bullets for strengths worth preserving
3. **Key issues** — a prioritized table with columns:
   - Severity
   - Heuristic
   - Evidence from screenshot or artifact
   - Why it matters
   - Recommended change
4. **Quick wins** — the 3 highest-leverage low-effort fixes
5. **Open questions** — what additional screenshot, state, or context would sharpen the critique
6. **When to A/B test** — note whether two credible remedies should be turned into `ab_test_visuals`, and when `captureRationale: true` would help preserve why the winning remedy was chosen

Keep the tone direct, specific, and useful to someone about to revise the UI.
