---
name: pi-ui-heuristic-critique
description: Guide Pi through screenshot-first heuristic UI critiques. Use when reviewing screenshots, mockups, or UI captures and you want prioritized, evidence-based feedback instead of vague design opinions.
---

# Pi UI Heuristic Critique

Use this skill when the task is to critique a UI rather than immediately implement it.

## When to use it

Use this skill for:

- screenshots of local or deployed UIs
- design mockups and handoff images
- before/after comparisons for UI changes
- focused review of a form, dashboard, table, onboarding step, modal, or settings page

This skill works best when the user can provide a screenshot, image path, or other visual artifact.

## How to use it

1. Prefer the companion prompt template when it is available:
   ```text
   /ui-heuristic-critique [screen-or-focus-area]
   ```
2. Ask for or inspect screenshots first before giving code-level advice.
3. Ground every major issue in visible evidence from the UI.
4. Prioritize issues by user impact and clarity, not by personal style preferences.
5. If the critique suggests two credible remedies, convert them into `ab_test_visuals` options instead of pretending there is only one obvious answer.
6. When the explanation behind the winning remedy will matter later, set `captureRationale: true` in `ab_test_visuals`.
7. End with concrete fixes and any missing states or screenshots needed for a sharper critique.

If no screenshot is available, say that confidence is lower, explain what is missing, and give the best critique you can from the available description.

## What good output looks like

A strong critique should include:

- a short overall read of the screen
- strengths worth preserving
- prioritized issues with severity, heuristic, evidence, impact, and recommendation
- quick wins
- open questions or missing states to review next

## Reference

For the heuristic checklist and screenshot-first workflow, see [references/ui-heuristic-critique.md](references/ui-heuristic-critique.md).

For the broader capture/review loop used in this repo, see [`../pi-extension-testing/references/visual-feedback-workflow.md`](../pi-extension-testing/references/visual-feedback-workflow.md).
