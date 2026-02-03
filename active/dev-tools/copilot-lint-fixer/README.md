# Copilot Lint Fixer

Copilot SDK powered tool that walks Python files, runs `pylint`, extracts one issue per file, and asks Copilot to fix it.

## Setup

This repo's devcontainer can include a helper venv with `github-copilot-sdk`:

- `source /home/vscode/.venv-copilot/bin/activate`
- `pip install -e .`

Or create a local venv in this folder and install:

- `pip install -e .`

## Usage

Run against a folder or a single file:

- `copilot-lint-fixer .`
- `copilot-lint-fixer fixtures/linty_math.py`

Common flags:

- `--max-files 25`
- `--max-fixes 5`
- `--issue-index 0`
- `--dry-run`
- `--pylint-args --disable=C0114,C0115`

## Environment

These environment variables follow the Wizard Fight Copilot backend pattern:

- `COPILOT_LINT_FIXER_MODEL` (default: `raptor-mini`)
- `COPILOT_LINT_FIXER_TIMEOUT` (default: `20` seconds)
- `COPILOT_LINT_FIXER_CLI_URL` (optional)
- `COPILOT_LINT_FIXER_ALLOW_PREMIUM` (default: `false`)

## Fixtures

Intentional lint fixtures live in `fixtures/`. They are designed to trigger `pylint` warnings for testing the tool.
