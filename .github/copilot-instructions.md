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
