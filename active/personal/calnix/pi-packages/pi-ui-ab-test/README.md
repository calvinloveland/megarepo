# pi-ui-ab-test

Pi extension that gives the model an interactive A/B testing workflow for UI and visual changes.

## What it does

- adds an `ab_test_visuals` tool the model can call
- nudges the model to create two concrete visual variants for UI/design/image-look requests
- displays both options in an interactive picker
- shows clearer selection controls (`1/A`, `2/B`, or `Enter` for the highlighted option)
- uses a full-screen custom TUI for image previews instead of an overlay, because pi's overlay compositor is text-oriented and does not reliably preserve inline image rows
- keeps both option previews visible in the picker so screenshot-based visual debugging can capture A and B at the same time
- keeps per-option preview slots isolated so Kitty/Ghostty-style terminals do not leave stacked images behind when the focused variant cycles through multiple previews
- returns the user's chosen variant so the model can continue with the winning look
- can optionally ask for a short post-selection rationale so later polish can reuse why the user preferred the winning option

## How the model should use it

When working on a UI or visual change, the model should:

1. create two variants, `A` and `B`
2. optionally generate or save preview images/screenshots for each variant
3. call `ab_test_visuals` with:
   - a title/question
   - labels and summaries for both variants
   - relevant artifact paths
   - preview image paths when available
   - `captureRationale: true` when the user's explanation will help the next iteration
4. continue with the chosen variant after the tool returns the user's preference and optional rationale

## Screenshot-first workflow

This package works best inside a screenshot-first review loop:

1. save baseline and candidate screenshots under `artifacts/`
2. attach those screenshots to `ab_test_visuals` via `imagePaths`
3. use `captureRationale: true` when the follow-up polish depends on why the user chose A or B
4. keep the winning screenshot as the new baseline for the next visual pass

For the broader repo-local workflow, see `../../pi-skills/pi-extension-testing/references/visual-feedback-workflow.md`.

## Local test

```bash
cd pi-packages/pi-ui-ab-test
node --test tests/ab-test-utils.test.mjs tests/ab-test-layout.test.mjs tests/ab-test-rationale.test.mjs
pi -e .
```

## Install from local path

```bash
pi install ./pi-packages/pi-ui-ab-test
```
