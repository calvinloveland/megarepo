# k33p

**Status:** early implementation — TUI viewer

Typed version control where monorepos are the first-class citizen and every
channel is content-addressed, scoped, and projected through role-based views.

This is the implementation. The design lives at
[`ideas/k33p/design.html`](../../../ideas/k33p/design.html).

## What works today

- Parse `k33p.yaml` manifests (project, channels, views, roles, subprojects, daemon)
- Parse `k33p.lock` files (with toolchain block)
- Project model with subprojects and per-subproject channel scoping
- A TUI viewer that browses the project structure
- Example manifests under `examples/`

## What does not work yet

- Actually fetching from transports (git, OCI, k33p://) — manifest is read-only
- The content-addressed store (`.k33p/store/`) — referenced but not implemented
- The k33p daemon (auto-commit, hooks)
- Migration tools (`k33p import`, `k33p split`, `k33p convert`)
- Live channel pointer updates
- Multi-tenancy primitives

## Running the TUI

```bash
# from this directory
nix-shell -p python3Packages.textual python3Packages.pyyaml --run "python -m k33p examples/megarepo"

# or with a specific manifest
nix-shell -p python3Packages.textual python3Packages.pyyaml --run "python -m k33p examples/coolproject"
```

## Layout

```
src/k33p/
├── __about__.py
├── __init__.py
├── __main__.py
├── cli.py          # `k33p` command entry point
├── manifest.py     # k33p.yaml parser + validator
├── lock.py         # k33p.lock parser
├── project.py      # Project + Subproject model
├── store.py        # Content-addressed store (skeleton)
├── channels.py     # Channel type definitions
├── refs.py         # Ref + Pointer types
└── tui/
    ├── __init__.py
    └── app.py      # Textual TUI
```

See [`docs/index.md`](docs/index.md) for the published project page.
