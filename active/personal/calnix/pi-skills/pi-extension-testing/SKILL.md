---
name: pi-extension-testing
description: Build and run a repeatable test plan for Pi extensions and Pi packages. Use when creating, debugging, refactoring, or publishing Pi extensions so testing is more systematic than ad-hoc node --test plus manual reloads.
---

# Pi Extension Testing

Use this skill when working on Pi extensions or Pi packages that expose extensions.

This skill provides a better testing system than a one-off `node --test ...` command:

1. **resource discovery** — confirm which extension entrypoints Pi will actually load
2. **pure automated tests** — run discovered Node and Python tests
3. **import auditing** — catch broken relative imports between extension files and helper modules
4. **deployment link auditing** — catch stale `~/.pi/agent/extensions` symlinks when you are dogfooding local extensions
5. **coverage gap detection** — flag packages that expose extensions but still have no automated Node or Python tests
6. **visual capture support** — take real screenshots of a running Pi window for TUI and overlay debugging under Sway/Wayland
7. **live smoke guidance** — finish with `pi -e ...` or `/reload` only after the automated checks are clean

## Helper script

Use the planning script:

```bash
./pi-skills/pi-extension-testing/scripts/extension_test_plan.py <target>
```

`<target>` can be either:

- a Pi package directory, like `./pi-packages/pi-tdd-mode`
- a single extension file, like `~/.pi/agent/extensions/tdd-mode.ts`

## Common commands

Build a test plan for a package:

```bash
./pi-skills/pi-extension-testing/scripts/extension_test_plan.py ./pi-packages/pi-tdd-mode
```

Run the discovered automated checks:

```bash
./pi-skills/pi-extension-testing/scripts/extension_test_plan.py ./pi-packages/pi-tdd-mode --run
```

Get JSON for further scripting:

```bash
./pi-skills/pi-extension-testing/scripts/extension_test_plan.py ./pi-packages/pi-tdd-mode --json
```

Audit against a custom extensions directory:

```bash
./pi-skills/pi-extension-testing/scripts/extension_test_plan.py ./pi-packages/pi-tdd-mode --global-extensions-dir ~/.pi/agent/extensions
```

Capture the currently focused Pi window as a real PNG screenshot under Sway:

```bash
./pi-skills/pi-extension-testing/scripts/capture_pi_window.py artifacts/pi-focused-window.png
```

Capture a specific Pi debug window by title fragment:

```bash
./pi-skills/pi-extension-testing/scripts/capture_pi_window.py --title pi-debug artifacts/pi-debug-window.png
```

Compare a baseline and current screenshot and write `diff.png` + `diff.json`:

```bash
./pi-skills/pi-extension-testing/scripts/compare_pi_screenshots.py artifacts/ui-regression/baseline.png artifacts/ui-regression/current.png
```

Run the screenshot regression loop that captures, diffs, and writes `report.md`:

```bash
./pi-skills/pi-extension-testing/scripts/ui_regression_loop.py --output-dir artifacts/ui-regression --skip-judge
```

## Recommended workflow

1. Read the target package `README.md` and `package.json`.
2. Run the planner script to discover the extension entrypoints, test files, import issues, and symlink issues.
3. Fix any import or link drift before trusting manual smoke tests.
4. Run the discovered automated checks.
5. Only after the automated checks pass, do a live smoke pass with one of:
   - `pi -e ./pi-packages/<name>`
   - `/reload` in an already-running Pi session
6. If the bug involved the TUI or a specific command/tool flow, capture a real screenshot with `capture_pi_window.py` and, when useful, pair it with a raw ANSI log via `PI_TUI_WRITE_LOG=/tmp/pi-tui.log pi ...`.
7. If there are two plausible visual directions, save both screenshots and use `ab_test_visuals`; when the winner's explanation will matter later, set `captureRationale: true`.
8. If you need a repeatable no-user-input artifact bundle, run `ui_regression_loop.py` so baseline/current/diff/report files land under one directory.
9. Manually verify the exact interaction that changed.

## Testing design principles

When improving an extension, prefer this structure:

- keep the extension entrypoint thin
- move logic into importable helper modules (`*.mjs`) whenever possible
- cover helper modules with Node tests first
- add small compatibility helpers when extension reloads might see stale modules
- treat `pi -e ...` and `/reload` as smoke tests, not as the only tests
- when using global symlinks in `~/.pi/agent/extensions`, audit them explicitly after adding new helper modules

## What the planner catches

The helper script currently checks for:

- extension entrypoints declared in `package.json -> pi.extensions`
- fallback discovery from a conventional `extensions/` directory
- Node tests under `tests/*.test.*`
- Python tests under `tests/test_*.py`
- broken relative imports like `./helper.mjs`
- mismatched symlink targets in `~/.pi/agent/extensions`
- extension packages that still have zero automated tests, so you can treat that as a testing debt item before trusting smoke-only validation

## Visual debugging notes

For visual extension debugging on this machine, the most practical screenshot method is:

- use `swaymsg -t get_tree -r` to find the Pi window rectangle
- use `grim -g "x,y widthxheight" output.png` to capture the real rendered pixels

The bundled `capture_pi_window.py` helper wraps that flow.

This is better than `tmux capture-pane` when you need to debug:

- overlay positioning
- borders and spacing
- theme colors
- status bars
- clipping or truncation artifacts

`tmux capture-pane` is still useful for text/log comparison, but it is not a pixel screenshot.

For the full screenshot-first review loop, including baseline/final captures and A/B comparison guidance, see [references/visual-feedback-workflow.md](references/visual-feedback-workflow.md).

## Limits

The planner does **not** replace real interaction testing.

You still need manual smoke checks for:

- status bar / TUI rendering
- extension lifecycle behavior across `/reload`
- multi-turn agent behavior
- provider-specific or model-specific effects
- anything that depends on an actual live Pi session

## Extra reference

See [references/testing-system.md](references/testing-system.md) for the rationale behind the testing layers and how to use this skill while developing Pi extensions.

See [references/visual-feedback-workflow.md](references/visual-feedback-workflow.md) for the practical screenshot capture and visual review loop.
