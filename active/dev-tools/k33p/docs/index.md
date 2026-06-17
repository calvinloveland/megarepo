# k33p

**Status:** early implementation · MVP TUI viewer

A typed version-control system where monorepos are the first-class citizen
and every channel is content-addressed, scoped, and projected through role-based
views. A k33p project is a monorepo with one or more subprojects; a "single
project" is a degenerate monorepo with one subproject at the root path.

## Reading

- The canonical design lives at [`ideas/k33p/design.html`](../../../ideas/k33p/design.html) (HTML, ~2,350 lines).
- This page is about the implementation, not the design.

## What's in the MVP

The MVP is a **viewer**, not a tool that modifies state. It loads a
`k33p.yaml` (and optional `k33p.lock`) and renders a TUI that lets you
browse the project structure.

| Component | Status |
|---|---|
| `k33p.yaml` parser | ✅ done |
| `k33p.lock` parser | ✅ done (signatures parsed, not yet verified) |
| Project + subproject model | ✅ done |
| View resolution (extends chain) | ✅ done |
| Role + subproject switching | ✅ done |
| TUI (Textual) | ✅ done |
| Content-addressed store stats | ✅ done (read-only) |
| `k33p init / clone / sync` | ❌ not yet |
| Actual git / OCI fetching | ❌ not yet |
| Daemon (auto-commit, hooks) | ❌ not yet |
| Migration tools (`import`, `split`, `convert`) | ❌ not yet |
| Live channel pointer updates | ❌ not yet |
| Multi-tenancy primitives | ❌ not yet |

## Architecture

```
src/k33p/
├── __about__.py     # version
├── __init__.py
├── __main__.py      # `python -m k33p` entry
├── cli.py           # argparse CLI → launches TUI
├── channels.py      # ChannelConfig + ChannelType enum
├── refs.py          # Ref + Pointer + parse_ref_string
├── manifest.py      # k33p.yaml parser + validator
├── lock.py          # k33p.lock parser
├── project.py       # Project + ProjectView (the in-memory model)
├── store.py         # ContentStore skeleton (stats, listing)
└── tui/
    ├── __init__.py
    └── app.py       # K33pApp (Textual)
```

The dependency direction: `cli` → `tui` → `project` → `manifest` + `lock` + `store`.
The data model (`manifest`, `lock`, `refs`, `channels`) has no upward dependencies
on the UI; it's plain dataclasses that the TUI reads from.

## Running the TUI

```bash
# from the project directory
nix-shell -p python3Packages.textual python3Packages.pyyaml \
  --run "python -m k33p examples/megarepo"

# or with a specific role
nix-shell -p python3Packages.textual python3Packages.pyyaml \
  --run "python -m k33p examples/coolproject --role=maintainer"

# or just print the parsed manifest
python -m k33p examples/megarepo --print-manifest --no-tui
```

## TUI key bindings

| Key | Action |
|---|---|
| `o` | Overview |
| `c` | Channels |
| `s` | Subprojects (monorepo) |
| `v` | Views |
| `r` | Roles |
| `l` | Lock |
| `t` | Store |
| `1`–`5` | Switch role (end-user, developer, maintainer, ci, auditor) |
| `n` | Next subproject |
| `q` | Quit |

## What this is not

This MVP is a viewer. It does not yet:

- fetch from transports (git, OCI, `k33p://`)
- write to the project state
- run the daemon
- perform migrations

Those are v0.1+ of the implementation. The design doc describes all of them
in detail; the MVP gives us a foundation to build them on top of.

## Layout

- `src/k33p/` — the package
- `tests/` — pytest tests for the parser and project model
- `examples/` — example `k33p.yaml` files (single project and monorepo)
- `docs/index.md` — this page
