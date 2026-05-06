# Pi Hiring Harness

A Pi package that turns the current Pi session into a **CEO agent** that can solicit job applications from specialist workers, rank them against a budget, and optionally execute the winning hires.

This is the first implementation pass of the `ideas/agent_hiring_framework.md` concept.

## What It Does

The package adds a `hire_workers` tool to Pi.

The active Pi model acts as the CEO:
- it defines the goal and jobs
- the tool asks worker agents to submit structured applications
- the tool ranks applicants using predicted success, confidence, cost, and risk
- it can enforce budget limits before execution
- optionally, it executes the top-ranked hire for each job
- optionally, it sends the deliverable to a reviewer worker
- it returns and can persist a run ledger with predicted and actual spend

## MVP Scope

Current implementation includes:
- worker discovery from builtin, user, and project worker profiles
- structured application generation through isolated Pi subprocesses
- simple budget-aware scoring and auto-selection
- optional execution of the selected worker
- optional reviewer pass after execution
- budget enforcement that can skip execution when remaining budget is too low
- persisted run ledgers under `.pi/hiring-runs/`
- project scaffolding command for worker profile templates
- helper commands for listing workers and inspecting the last run
- automated tests for parsing, discovery, budget normalization, scoring, and ledger persistence helpers

Current implementation does **not** yet include:
- recursive delegation
- learning from historical runs
- bandit/Bayesian hiring policies
- persistent calibration updates back into worker profiles

## Installation in Pi

From this project directory:

```bash
pi -e .
```

Or install it as a local package in Pi settings:

```bash
pi install .
```

## First-Time Setup

Scaffold editable worker profiles into the current repo:

```text
/hiring-init
```

That creates `.pi/workers/` with starter profiles for:
- researcher
- implementer
- reviewer
- risk-manager

Edit those files to set:
- `model`
- `input_price_per_million`
- `output_price_per_million`
- tool access
- role prompt details

The builtin worker profiles are intentionally conservative starter templates. Real budget-aware runs are much better once you customize project-local workers.

## Worker Profiles

Worker profiles live in markdown files with frontmatter.

Search order:
- builtin package workers
- `~/.pi/agent/workers/*.md`
- nearest `.pi/workers/*.md`

Later sources override earlier ones when names match.

Example:

```md
---
name: implementer
description: Mid-cost worker for surgical code changes
role: implementer
model: claude-sonnet-4-5
tools: read,edit,bash
input_price_per_million: 3.00
output_price_per_million: 15.00
---

You implement focused changes.
Prefer small diffs, preserve existing style, and explain residual risks.
```

## Tool Usage

### Hiring round only

Ask the CEO model to use the tool with a budget and jobs:

```text
Use hire_workers with a $1.20 budget for two jobs:
1. investigate why the parser fails on nested arrays
2. implement a fix once the likely cause is clear
Only use user-level workers.
```

### Direct execution

```text
Use hire_workers in run mode for this goal with a $0.80 budget:
- reproduce the parser failure
- explain the bug
- patch it in one file
```

### Typical parameter shape

```json
{
  "budgetUsd": 0.8,
  "mode": "run",
  "workerScope": "user",
  "enforceBudget": true,
  "persistLedger": true,
  "reviewMode": "selected",
  "reviewerWorkerName": "reviewer",
  "jobs": [
    {
      "id": "investigate",
      "objective": "Reproduce the parser failure and identify the most likely root cause.",
      "acceptanceCriteria": "Return the failing path, suspected function, and concrete evidence.",
      "preferredRole": "researcher",
      "maxBudgetUsd": 0.25
    },
    {
      "id": "patch",
      "objective": "Implement the smallest safe fix for the parser bug.",
      "acceptanceCriteria": "Change as little code as possible and describe remaining risks.",
      "preferredRole": "implementer",
      "maxBudgetUsd": 0.35
    }
  ]
}
```

## Budget and Ledger Behavior

By default:
- `enforceBudget` is `true`
- `persistLedger` is `true`
- persisted ledgers go to `.pi/hiring-runs/`
- `reviewMode` is `none`

When budget enforcement is enabled, the harness can still spend budget on the application round, but it will skip executing a selected worker if the predicted execution spend exceeds the remaining budget.

Each persisted ledger contains:
- a compact summary
- the full tool details object
- per-job selected hires
- actual resume, execution, and review spend
- warnings and skip reasons

## Security Model

Project-local workers are repo-controlled prompts.

If `workerScope` includes project workers, the extension asks for confirmation before using them when Pi has an interactive UI. This follows the same trust model used by Pi's subagent example.

## Commands

### `/hiring-init`

Copies starter worker profiles into `.pi/workers/` without overwriting existing files.

### `/hiring-workers`

Lists the worker profiles visible from the current cwd, including builtin, user, and project-local sources.

### `/hiring-last-run`

Shows the latest persisted hiring ledger summary from `.pi/hiring-runs/`.

## Demo / Report Generation

Render a standalone HTML report from a persisted hiring ledger:

```bash
node scripts/render-demo.js \
  --ledger /path/to/.pi/hiring-runs/20260506-213936.json \
  --workspace /path/to/workspace \
  --output /path/to/hiring-demo.html \
  --title "Hiring Run Demo"
```

The report includes:
- stage-by-stage narrative
- candidate rankings
- expandable resumes/applications
- selected-worker reasoning
- execution summary
- final artifact previews

## Development

```bash
npm test
node --check extensions/index.js
node --check scripts/render-demo.js
pi -e .
```

## Design Notes

This package is implemented as a Pi extension package rather than a standalone agent runtime.

That means it can reuse Pi for:
- tool execution
- model selection per worker
- isolated subprocess runs
- JSON event streaming
- user/project-local prompt discovery

The subprocess orchestration pattern is adapted from Pi's upstream subagent example:
- `examples/extensions/subagent/index.ts`
- `examples/extensions/subagent/agents.ts`

## Next Likely Steps

- add calibration tracking for overconfident workers
- add deterministic validation hooks for tests/linters per job
- support recruiter-generated applications from capability cards
- compare package performance against single-model and static-router baselines
- add historical performance weighting to worker selection
