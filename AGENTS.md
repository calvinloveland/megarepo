# AGENTS.md

This file translates the repository's Copilot-era guidance into Codex-friendly instructions. Keep it updated when repository workflow or conventions change.

## Start Here

- Read [README.md](README.md) for the monorepo landing page and docs-site link.
- Read [PHILOSOPHY.md](PHILOSOPHY.md) for the durable engineering principles used across the repo.
- When working inside a subproject, prefer the nearest `docs/index.md` and nearest `AGENTS.md` over this root file.
- If a subproject does not yet have `AGENTS.md` but does have `.github/copilot-instructions.md`, treat that file as reference context.

## Documentation Policy

- The repository root `README.md` is a short landing page.
- Canonical project docs live in per-project `docs/` directories.
- Non-root `README.md` files should stay short and point to the web docs.
- The published documentation site ([GitHub Pages](https://calvinloveland.github.io/megarepo/)) is the canonical reference for all project docs.

## Web-Based Work

- The [Megarepo Launcher](https://shsw.dev) (localhost:3001) is the **starting point** for all web-based work.
- Register new web apps in `active/web-apps/launcher/apps.yaml`.
- Update `active/web-apps/launcher/projects.yaml` when adding significant new active projects.
- See `active/web-apps/launcher/README.md` for the full convention.

## Monorepo Scope

- This repo contains active projects, archived projects, shared tooling, and docs.
- Keep changes scoped to the project you are touching.
- Avoid modifying `archive/` unless the user explicitly asks for it.

## Working Style

- Investigate, plan, execute, test.
- Prefer DRY designs. Fix a concept once rather than duplicating it in multiple places.
- Keep functions small and focused.
- Prefer configuration over hardcoded values.
- Use existing helpers, utilities, and shared partials before adding new abstractions.
- Write self-documenting code. Comments should explain why, not restate what the code already says.
- Do not ask the user to do work the agent can do directly.

## Language Preferences

### Python

- Prefer `pyproject.toml`-based configuration.
- Use `pytest` for tests unless the project documents a different workflow.
- Add type hints where they materially improve clarity.
- Prefer `pathlib` over `os.path`.

### JavaScript / TypeScript

- Follow the conventions already present in the project.
- Use the package manager already chosen by the project.

### Nix

- Follow NixOS module conventions.
- Run `nix flake check` when Nix changes warrant it.

## Testing

- Add or update tests when behavior changes.
- Prefer TDD for bug fixes, edge cases, and regressions when practical.
- Run relevant existing tests before finishing work: `pytest` or the project's documented test command.
- Do not ignore failing tests that were introduced by your change.

## Process Management

- Never use broad `pkill` or `killall` commands that might disrupt unrelated editor or tooling processes.
- Prefer specific process patterns or PID-based shutdown.
- When running background services, capture stdout and stderr to log files and store the PID for cleanup.
- Prefer workspace-local caches for browser installs or other large tooling downloads.
- Add `.gitignore` entries before downloading large local artifacts that should not be committed.

## Frontend and Shared UI

- Prefer editing shared partials and common components over duplicating markup or behavior.
- When adding UI state in HTMX-style flows, preserve it across requests where practical.

## Git Workflow

- Commit after each logical unit of work with a concise imperative message.
- Do not batch unrelated changes into a single commit.
- Keep staged changes tightly scoped so review is straightforward.
