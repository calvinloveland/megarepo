# Pi Extension Testing System

This skill uses a layered testing model.

## Layer 1: package/resource discovery

Before running any tests, confirm what Pi will load:

- `package.json -> pi.extensions`
- conventional `extensions/` fallback
- actual extension filenames

This avoids testing helper modules while forgetting the real entrypoint Pi loads.

## Layer 2: pure automated tests

Prefer tests that do not require an interactive Pi session:

- Node tests for helper modules and state machines
- Python tests for local support scripts
- focused tests for parsing, status labels, routing, filtering, and transforms

These are the fastest and most stable tests.

## Layer 3: import and packaging audit

Extension work often breaks because the extension entrypoint imports a new helper file but the live environment never got that helper copied or symlinked.

That means import auditing and symlink auditing are first-class checks, not afterthoughts.

## Layer 4: coverage-gap detection

If an extension package has entrypoints but no automated tests at all, that is an important result.

Treat it as a testing debt signal:

- do not confuse a clean import audit with real coverage
- record that the package is smoke-test-only right now
- prefer adding at least one fast automated test before relying on manual reload checks

## Layer 5: live smoke testing

Only after the automated checks are clean should you do live smoke testing with:

- `pi -e <package>`
- `/reload`
- the exact slash command, tool, or UI flow that changed

## Layer 6: visual capture

For TUI and overlay bugs, keep a real screenshot path in the workflow.

On this machine the best current path is:

- query the Sway tree for the target Pi window rectangle
- capture the actual pixels with `grim`

That is exactly what `scripts/capture_pi_window.py` automates.

For the full screenshot-first review loop, including baseline/final captures and A/B comparison guidance, see [visual-feedback-workflow.md](visual-feedback-workflow.md).

Use pixel screenshots when debugging:

- overlay alignment
- clipping
- colors
- borders
- status/footer rendering

Pair screenshots with raw ANSI logs when needed:

```bash
PI_TUI_WRITE_LOG=/tmp/pi-tui.log pi -e ./pi-packages/<name>
```

## Why this is better

A lot of Pi extension bugs are not logic bugs. They are:

- wrong file discovered
- helper file missing
- stale symlink in `~/.pi/agent/extensions`
- package manifest drift
- manual `/reload` testing done without any fast automated checks first

This skill makes those problems visible much earlier.
