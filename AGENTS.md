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
- The old GitHub Pages site has been removed to avoid billing costs. Build the docs locally with `python scripts/build_docs.py` or serve them with `python scripts/build_docs.py --serve`.
- Canonical project docs are at `docs/` or per-project `docs/index.md`.

## Web-Based Work

- The [Megarepo Launcher](https://shsw.dev) (localhost:3001) is the **starting point** for all web-based work.
- Register new web apps in `active/web-apps/launcher/apps.yaml`. This is the **only** app registry — there is no `projects.yaml` (that stale reference has caused repeated dead ends; ignore it).
- For significant new active projects, also add per-project `docs/index.md` so the docs site stays current.
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
- The `edit` tool matches `oldText` byte-for-byte, including whitespace and newlines. If a match fails, re-read the exact region and retry with the precise text rather than guessing — whitespace mismatches are a top cause of wasted edit cycles.

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

## On-Demand Checks (replaces old GitHub Actions)

All CI workflows have been removed. Run checks locally with `scripts/check_all.py`:

```
python scripts/check_all.py                  # all checks
python scripts/check_all.py --list           # list checks
python scripts/check_all.py supply-chain pi-package  # specific checks
python scripts/check_all.py --skip docker    # all except docker
```

Individual scripts:
- `scripts/check_supply_chain.py` — supply-chain guardrails
- `scripts/check_pi_package.py` — pi-autopilot-complete tests
- `scripts/check_web_app.py thermofluid` — thermofluid sandbox checks
- `scripts/check_web_app.py vernissage` — vernissage lint/build/test
- `scripts/build_docker.py` — build web-app Docker images
- `scripts/build_docs.py` — build MkDocs docs site

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
- Background servers are reaped between tool calls: systemd `KillUserProcesses` kills anything spawned in one bash invocation once that call returns. To run a server and tests against it, start the server and run the test in the **same** bash call (e.g. `node server.js & sleep 1 && pytest ...`), or fully detach with `nohup`/`setsid` and capture the PID + logs.
- Prefer systemd **user** timers over cron for periodic maintenance tasks (Docker prune, Nix GC, cache cleanup, Warden checks).

## Secrets and Credentials

- Never accept API tokens or secrets pasted into chat. Have the user place them in a gitignored `.secrets/` file (or a deploy-guide password field) that scripts read from disk. Pasting credentials in chat is a recurring near-miss.
- Use `git check-ignore --stdin` to batch-check whether scanned paths are ignored; it respects root + nested `.gitignore` files and negation patterns.

## NixOS / Environment Gotchas

These recur across many past sessions on this host — check here first before debugging.

- **Python is not on PATH.** Bare `python3` / `python` is the single most common failure on this NixOS host (`python3: command not found`). Run Python via `nix-shell -p python3 --run "..."`, a project `.venv/bin/python3`, or `nix run`. Apply this to `pytest`, `scripts/*.py`, and any ad-hoc Python before first invocation.
- **No non-interactive `sudo`.** The agent shell has no TTY, so `sudo` fails with "a terminal is required to read the password". For root tasks (`nixos-rebuild switch`, `systemctl`, disk cleanup), prepare the exact command/script and ask the user to run it. The `warden` user already has `Defaults:warden !requiretty` + `NOPASSWD` configured for approved maintenance commands.
- **Playwright/Chromium on NixOS.** Do not let Playwright download its own browser. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the Nix-managed Chromium (resolve it from the Nix store). Generic dynamically-linked Linux binaries often do not run on NixOS without patching.
- **Web search.** Use the local `searx-search` CLI (SearXNG at `localhost:8888`, no API keys needed) for external lookups; there is also a `searxng-local-search` skill. Prefer ripgrep/`read` for workspace files.
- **Nix store corruption.** If `nixos-rebuild` fails with missing `.drv` files (GC'd but still referenced), recover with `nixos-rebuild switch --repair --no-reexec`. Heavy Nix builds (e.g. PyTorch) can exceed the default 300s command timeout — request a longer timeout or pre-build inside a `nix-shell`.
- **Git push from headless machines.** `git push` may fail on SSH/publickey or HTTPS credential prompts. Use a deploy key or configured credential helper rather than attempting interactive auth from the agent.

## Frontend and Shared UI

- Prefer editing shared partials and common components over duplicating markup or behavior.
- When adding UI state in HTMX-style flows, preserve it across requests where practical.
- For browser error visibility, reuse the inline floating error-reporter pattern from `active/games/vroomon/electron/src/renderer/error-logger.ts` instead of reinventing it per app (Conway, marble-survivors, and thermofluid all adopt this pattern).
- For vanilla-JS games that Playwright tests inspect, explicitly export state to `window.*` at the end of the file — top-level `const` does not create globals in browsers.
- New web games in this repo follow a consistent shape: vanilla JS + Canvas 2D, no frameworks or build step, a single JS file for game logic, registered in the launcher, with a project `AGENTS.md` and `docs/index.md`.

## Git Workflow

- Commit after each logical unit of work with a concise imperative message.
- Do not batch unrelated changes into a single commit.
- Keep staged changes tightly scoped so review is straightforward.

## Complete Tool Convention

When the autopilot extension is active, the `complete` tool uses a required `futureWork: string[]` field instead of a `status` enum:

- `futureWork` with items → each item is queued as a follow-up task; agent keeps working.
- `futureWork: []` → task is truly complete. Run terminates.
- Use `summary` for a brief log of what was accomplished.

Do NOT use the old `status` field. The extension overrides the built-in `complete` tool.

See `active/personal/calnix/pi-packages/pi-autopilot-complete/docs/index.md` for details.
