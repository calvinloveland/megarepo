# Visual Feedback Workflow

Use this workflow when a Pi change is visual, screenshot-sensitive, or hard to judge from code alone.

This is the preferred repo-local loop for:

- TUI layout changes
- overlay and image-preview bugs
- spacing, clipping, borders, and alignment issues
- A/B visual comparisons
- post-fix verification after UI polish work

## Why this workflow exists

Frontend and TUI work often fails in ways that code review does not catch:

- spacing feels off even though dimensions look plausible in code
- borders clip or wrap at certain terminal widths
- inline images stack incorrectly
- a refactor preserves logic but regresses layout

So the agent should not stop at code changes. It should create a visual feedback loop.

## Recommended artifact set

Store visual artifacts under `artifacts/` and keep names explicit.

Good defaults:

- `artifacts/ui-baseline.png`
- `artifacts/ui-variant-a.png`
- `artifacts/ui-variant-b.png`
- `artifacts/ui-final.png`
- `artifacts/pi-tui.log`
- `artifacts/ui-regression/baseline.png`
- `artifacts/ui-regression/current.png`
- `artifacts/ui-regression/diff.png`
- `artifacts/ui-regression/diff.json`
- `artifacts/ui-regression/report.md`

## Capture commands

Capture the focused Pi window:

```bash
./pi-skills/pi-extension-testing/scripts/capture_pi_window.py artifacts/ui-baseline.png
```

Capture a specific Pi window by title fragment:

```bash
./pi-skills/pi-extension-testing/scripts/capture_pi_window.py --title pi-debug artifacts/ui-variant-a.png
```

Capture a raw ANSI log alongside the screenshot when rendering behavior matters:

```bash
PI_TUI_WRITE_LOG=artifacts/pi-tui.log pi -e ./pi-packages/<name>
```

Compare two screenshots directly:

```bash
./pi-skills/pi-extension-testing/scripts/compare_pi_screenshots.py artifacts/ui-regression/baseline.png artifacts/ui-regression/current.png
```

Create or update a no-user-input regression artifact bundle:

```bash
./pi-skills/pi-extension-testing/scripts/ui_regression_loop.py --output-dir artifacts/ui-regression --skip-judge
```

## Workflow

1. **Capture a baseline**
   - save a screenshot before changing the UI when possible
   - this makes regressions and improvements much easier to judge
2. **Implement one visual change set**
   - keep the delta small enough that the screenshot tells a clear story
3. **Capture the result**
   - use `capture_pi_window.py` to save the rendered pixels
4. **Review the screenshot**
   - note the top 1-2 issues only
   - avoid broad, vague critique when a focused fix will do
5. **If two directions are plausible, create A and B**
   - save both screenshots
   - call `ab_test_visuals` with both `imagePaths`
   - when follow-up polish will depend on the user's reasoning, set `captureRationale: true`
6. **Polish the winner**
   - use the selected variant and any captured rationale to guide final refinement
7. **Capture the final state**
   - save a final screenshot after the winning polish pass
8. **When you want a repeatable automated artifact set, use the regression loop**
   - baseline/current/diff/report stay together under `artifacts/ui-regression/`
   - this is the best starting point for later machine judging or subagent-driven polish

## A/B comparison notes

When using `ab_test_visuals`:

- keep both previews visible when possible
- attach the changed file paths as `artifactPaths`
- attach screenshot paths as `imagePaths`
- ask for rationale if the user's explanation will help the next revision

Example tool call shape:

```text
ab_test_visuals(
  title: "Header refinement",
  question: "Which direction feels clearer?",
  captureRationale: true,
  optionA: { ... imagePaths: ["artifacts/ui-variant-a.png"] },
  optionB: { ... imagePaths: ["artifacts/ui-variant-b.png"] }
)
```

## Review heuristics for screenshots

When looking at a screenshot, prioritize:

1. hierarchy and clarity
2. spacing and alignment
3. clipping/truncation/wrapping
4. state visibility and affordance
5. contrast and legibility

## Keep the loop tight

Do not accumulate many unrelated visual changes before taking another screenshot.

A tight loop is better:

- change
- capture
- review
- fix
- capture again

That gives the agent actual visual evidence instead of guessing from code.
