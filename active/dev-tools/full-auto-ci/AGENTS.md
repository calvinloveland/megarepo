# AGENTS.md

Project-local guidance for `active/dev-tools/full-auto-ci`.

## Project Snapshot

- Full Auto CI automates cloning repositories, running lint and tests, and storing results.
- The main entrypoint flow is `main.py` into `src/cli.py`.
- Core behavior is centered in `src/service.py`.

## Key Modules

- `CIService` coordinates config, git tracking, worker threads, and queued test runs.
- `GitTracker` persists repository metadata in SQLite and shells out to system `git`.
- `ToolRunner` runs enabled analyzers sequentially. Current built-ins include pylint, coverage, and lizard.

## Data and Side Effects

- SQLite defaults to `~/.fullautoci/database.sqlite`.
- Git clones default to `~/.fullautoci/repos/<id>_<name>`.
- Tests should usually mock subprocess, filesystem, and thread-heavy paths to avoid real network or git side effects.

## API and Queue Caveats

- `src/api.py` only exposes real Flask routes when optional API extras are installed.
- Webhook handling depends on exact repository URL matching.
- Keep the queue field mismatch in mind: some helpers enqueue `repository_id` and `commit_hash`, while workers expect `repo_id` and `commit`.

## Testing and Local Workflow

- Run `pytest` from the project root.
- When testing service and tool code, patch `subprocess.run`, `os.chdir`, and git-facing helpers to avoid real execution.
- Service start paths spawn background threads in-process; tests should avoid hanging on real thread loops.
- Coverage workflows require the `coverage` CLI unless explicitly stubbed.

## Configuration

- Config loads from `~/.fullautoci/config.yml`.
- Default values live in `src/config.py`.
- Tool enablement, coverage commands, timeouts, and ratchet behavior are all configuration-driven. Prefer extending config over hardcoding behavior.

## Known Gaps

- Database schema expectations are not fully aligned across all surfaces.
- Some git and webhook paths assume Unix-style home directories.
- Thread loops log broad exceptions, so silent failures may need extra instrumentation during debugging.

## Workflow Note

- Commit after each completed logical task with a concise imperative message.
