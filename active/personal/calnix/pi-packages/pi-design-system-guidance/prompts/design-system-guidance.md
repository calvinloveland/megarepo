---
description: Apply reusable design-system guidance to a Pi UI task
argument-hint: "[ui-task]"
---
Apply the following design-system guidance to this Pi UI task: $@

1. Inspect the repo first for existing shared UI primitives, layout patterns, tokens, and partials.
2. Reuse or extend those shared pieces instead of adding one-off markup, styling, or duplicate interaction patterns.
3. Keep visual hierarchy clear: identify the primary action, secondary actions, supporting metadata, and page title or heading.
4. Keep spacing, typography, border radius, icon usage, and color roles consistent with the surrounding product.
5. Design all important states: default, hover, focus, active, disabled, loading, empty, error, and success.
6. Preserve semantic structure, keyboard access, visible focus states, sufficient contrast, and reduced-motion-friendly behavior.
7. Check responsiveness so layouts and controls still work at narrow widths and with long labels.
8. If screenshots or visual artifacts are available, use them to derive the current design language before proposing changes.
9. If the user is choosing a look or layout direction, build two concrete variants and use `ab_test_visuals` before finalizing.
10. When the user's explanation of the winning variant will help the next iteration, set `captureRationale: true` in `ab_test_visuals`.
11. Prefer small composable changes to shared components over isolated page-specific exceptions.
12. Before finishing, self-review for consistency, accessibility, responsiveness, and shared-component reuse.

When you finish, include:
- a short rationale for the design choices
- the files changed
- any remaining design debt or follow-up ideas
