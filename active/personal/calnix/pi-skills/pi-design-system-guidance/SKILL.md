---
name: pi-design-system-guidance
description: Apply reusable design-system guidance for Pi UI work so changes stay consistent, accessible, and aligned with shared components.
---

# Pi Design System Guidance

Use this skill when you are:

- implementing or refining a Pi TUI or other UI flow
- reviewing layout, spacing, hierarchy, or interaction-state changes
- deciding whether to extend a shared UI primitive instead of adding page-specific styling
- preparing two concrete UI directions so the user can choose a preferred look

## Companion prompt package

If the prompt package is installed, start with:

```text
/design-system-guidance <ui-task>
```

That reusable prompt applies the same guidance in package form so you can invoke it quickly during UI tasks.

## Recommended workflow

1. Read the nearest `README.md`, `AGENTS.md`, and the relevant UI files.
2. Inventory existing shared components, partials, layout helpers, theme tokens, and state patterns before inventing anything new.
3. Reuse or extend shared building blocks wherever practical.
4. Check the design against the checklist in [references/checklist.md](references/checklist.md).
5. If screenshots or visual artifacts exist, inspect them before deciding that the design system needs to change.
6. If the user is choosing a visual direction, create two concrete variants and use `ab_test_visuals` before you finalize the winning option.
7. When the winning rationale will help the next revision, set `captureRationale: true` in `ab_test_visuals`.
8. Verify accessibility basics, responsive behavior, and all key states before finishing.

## What good outcomes look like

- one consistent visual language instead of isolated one-off fixes
- clear primary and secondary actions
- complete state coverage for loading, empty, error, disabled, hover, and focus paths
- layouts that still work at narrow widths and with longer labels or dynamic content
- concise implementation notes that explain the design rationale and remaining design debt

## Common reminders

- prefer editing shared components or partials over duplicating markup
- preserve semantic structure and keyboard access
- keep focus visibility and contrast strong enough to survive theme variation
- avoid introducing exceptions when a token or shared primitive would solve the same problem more durably
- treat screenshots and A/B comparisons as decision tools, not substitutes for accessibility checks

## Reference

Use [references/checklist.md](references/checklist.md) as the compact review list before you finish a UI task.

For the broader screenshot-first review loop, including baseline/final captures and A/B review guidance, see [`../pi-extension-testing/references/visual-feedback-workflow.md`](../pi-extension-testing/references/visual-feedback-workflow.md).
