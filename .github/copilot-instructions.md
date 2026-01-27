# Copilot Instructions for Megarepo

This is a living document and must be kept continuously updated to stay correct.

Read PHILOSOPHY.md

## Commit After Every Change

**CRITICAL**: After completing ANY code change, file creation, or modification, you MUST create a git commit with a descriptive message. Do not batch changes—commit immediately after each logical unit of work.

```bash
git add -A && git commit -m "Descriptive message here"
```

Commit messages should be:

- Present tense, imperative mood ("Add feature" not "Added feature")
- Concise but descriptive
- Reference the project/area if relevant (e.g., "full-auto-ci: Add timeout configuration")

## Project Context

This is a monorepo containing multiple projects organized as:

- `active/dev-tools/` - Development tools and CI utilities
- `active/games/` - Game projects and AI experiments
- `active/bots/` - Discord and automation bots
- `active/personal/` - Personal configurations (NixOS)
- `archive/` - Legacy and archived projects (generally don't modify)

## Language & Framework Preferences

### Python (Most Projects)

- Python 3.8+ for compatibility
- Use `pyproject.toml` for project configuration
- pytest for testing
- Type hints where they add clarity
- Prefer pathlib over os.path

### JavaScript/TypeScript (VS Code Extensions)

- Follow existing project conventions
- Use the project's existing package manager

### Nix (calnix)

- Follow NixOS module conventions
- Test changes with `nix flake check`

## Code Style

- Keep functions small and focused
- Prefer composition over inheritance
- Configuration over hardcoded values
- Write self-documenting code; comments explain _why_

## Testing

- Write tests for new functionality
- Run existing tests before committing: `pytest` or project-specific test command
- Don't break existing tests

## Process Management

**NEVER use broad pkill/killall commands** that could kill unrelated processes:
- ❌ `pkill python` - kills LSP servers, debuggers, other tools
- ❌ `pkill node` - kills VS Code extensions, other services
- ✅ Use specific patterns: `pkill -f "python app.py"` or `pkill -f "specific-script"`
- ✅ Use PIDs when available: `kill $PID`
- ✅ Use process groups or save PIDs to files for cleanup

**Be more careful when stopping processes** and avoid disrupting the editor or tooling.

**Never ask the user to do something you can do yourself.**

## Development Philosophy

See [PHILOSOPHY.md](./PHILOSOPHY.md) for detailed principles, but key points:

1. Automate repetitive tasks
2. Use ratchets for incremental improvement
3. Plain text and simple formats
4. Ship working code, polish later
5. Reproducible environments

## When Working on Specific Projects

Before making changes to a project, check for:

- `README.md` for project-specific instructions
- `pyproject.toml` or `package.json` for dependencies
- Existing code style and patterns

## Running dev servers and background tests (Playwright / Vite) ✅

- Prefer non-interactive background runs for dev servers and browser test installs when possible. Use `nohup` or an equivalent background start and capture logs and PID for management.
  - Example (background start):
    ```bash
    cd active/games/powder_play/frontend
    nohup npm run dev -- --host 127.0.0.1 > devserver.log 2>&1 & echo $! > devserver.pid
    tail -n +1 -f devserver.log
    ```
  - Stop the server cleanly using the PID: `kill $(cat devserver.pid)`

- When installing Playwright browsers in CI or in a workspace without a persistent user cache, set a workspace-local browser path and run install non-interactively:
  ```bash
  export PLAYWRIGHT_BROWSERS_PATH=$PWD/../../.playwright_browsers
  PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH npx playwright install --with-deps
  ```
  This avoids permission issues with system caches and keeps browser binaries contained in the repo workspace.

- Always capture logs to files when running background tasks. This prevents interactive TTY prompts and preserves diagnostics.

- Use non-interactive test runners in CI (Playwright headless, `npx playwright test --config=playwright.config.ts --reporter=list`) and ensure the dev server is reachable before running e2e tests (poll `http://127.0.0.1:5173` or check `devserver.log` for a ready message).

- When automating from Copilot, start processes with background mode and avoid interactive shells: use the `run_in_terminal` tool with `isBackground=true` and redirect stdout/stderr to logs. Report progress and provide logs/paths in PRs.

- When permission errors occur during browser install, create a workspace-owned cache directory (example: `/workspaces/megarepo/.playwright_browsers`) and set `PLAYWRIGHT_BROWSERS_PATH` accordingly before running `npx playwright install`.
