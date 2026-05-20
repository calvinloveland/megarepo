# pi-tdd-mode

Pi extension that adds a Test-Driven Development mode for coding tasks.

## What it does

- adds `test_register`, `tdd_complete`, and `admit_failure` tools while TDD mode is enabled
- nudges the model to follow a TDD loop whenever TDD mode is enabled
- injects an extra hidden per-turn reminder telling the model to register the failing test before implementation
- supports `/tdd on|off|toggle|status`
- disables autopilot mode when TDD mode is activated
- requires a registered failing test run before `tdd_complete` can finish with `status: "done"`
- requires a passing test command before `tdd_complete` can finish with `status: "done"`
- requires at least one listed test file to have been created or modified during the current run
- updates the status bar from active to red registered to green after a successful `tdd_complete`

## TDD workflow enforced by the mode

When enabled, the model is instructed to:

1. write or update tests first
2. call `test_register` with a test command that currently fails
3. implement code to pass the tests
4. clean up / refactor the code
5. rerun the tests
6. finish with `tdd_complete`

If the model cannot honestly follow that workflow, it can terminate the turn with `admit_failure` instead of pretending the TDD steps happened.

The `test_register` tool validates:

- `testCommand` must be provided
- listed `testFiles` must exist
- at least one listed test file must have changed during the current run
- the `testCommand` must fail with a non-zero exit code

The `tdd_complete` tool validates:

- a successful `test_register` call happened earlier in the current run
- `status: "done"` must include a `testCommand`
- listed `testFiles` must exist
- at least one listed test file must have changed during the current run
- the `testCommand` must exit with code `0`

If validation fails, the tool does **not** terminate the run and instead returns the failure details so the model must keep working.

## Commands

```text
/tdd on
/tdd off
/tdd toggle
/tdd status
```

## Local test

```bash
cd pi-packages/pi-tdd-mode
node --test tests/tdd-run-state.test.mjs tests/tdd-run-state-compat.test.mjs tests/tdd-mode-utils.test.mjs tests/tdd-tool-state.test.mjs
pi -e .
```

## Install from local path

```bash
pi install ./pi-packages/pi-tdd-mode
```
