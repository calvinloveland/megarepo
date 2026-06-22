# k33p

**Status:** early implementation · TUI viewer + CAS + CLI

A typed version-control system where monorepos are the first-class citizen
and every channel is content-addressed, scoped, and projected through role-based
views. A k33p project is a monorepo with one or more subprojects; a "single
project" is a degenerate monorepo with one subproject at the root path.

## Reading

- The canonical design lives at [`ideas/k33p/design.html`](../../../ideas/k33p/design.html) (HTML, ~2,350 lines).
- This page is about the implementation, not the design.

## Current status

The implementation has a working TUI viewer, a content-addressed store,
and a CLI with `init`, `clone`, `sync`, `import`, `daemon`, `info`, `store`,
`tui`, and `version` subcommands.

| Component | Status |
|---|---|
| `k33p.yaml` parser | ✅ done |
| `k33p.lock` parser | ✅ done (signatures parsed, not yet verified) |
| Project + subproject model | ✅ done |
| View resolution (extends chain) | ✅ done |
| Role + subproject switching | ✅ done |
| TUI (Textual) | ✅ done |
| Content-addressed store (CAS) | ✅ done (put, get, has, delete, stats) |
| `k33p init` | ✅ done |
| `k33p clone` | ✅ done (file:// transport) |
| `k33p sync` | ✅ done (file://, git+https://, oci+https://) |
| `k33p import --from-git` | ✅ done (any git repo) |
| `k33p daemon` | ✅ done (auto-commit with polling watcher) |
| `k33p info` | ✅ done |
| `k33p store` subcommands | ✅ done (put, get, stats, ls) |
| `k33p tui` | ✅ done |
| FileTransport | ✅ done |
| GitTransport | ✅ done (git CLI) |
| OCITransport | ✅ done (stdlib HTTP) |
| Pointer updates | ✅ done (set, list, rate-limited, signed) |
| Migration tools (`split`, `convert`) | ❌ not yet |
| Multi-tenancy primitives | ❌ not yet |

## Architecture

```
src/k33p/
├── __about__.py     # version
├── __init__.py
├── __main__.py      # `python -m k33p` entry
├── cli.py           # CLI dispatcher + subcommand handlers
├── channels.py      # ChannelConfig + ChannelType enum
├── refs.py          # Ref + Pointer + parse_ref_string
├── manifest.py      # k33p.yaml parser + validator
├── lock.py          # k33p.lock parser
├── project.py       # Project + ProjectView (the in-memory model)
├── store.py         # Content-addressed store (put, get, has, delete, stats, ls)
├── transport.py     # Transport abstraction + FileTransport (clone)
└── tui/
    ├── __init__.py
    └── app.py       # K33pApp (Textual)
```

The dependency direction: `cli` → `tui` → `project` → `manifest` + `lock` + `store`.
The data model (`manifest`, `lock`, `refs`, `channels`) has no upward dependencies
on the UI; it's plain dataclasses that the TUI reads from.

## Store layout

Objects live in `.k33p/store/` and are sharded by the first two hex
characters of their SHA-256 hash (like git's `.git/objects/`):

```
.k33p/store/
├── ab/
│   ├── cdef1234...   # zlib-compressed object
│   └── 56789012...
└── cd/
    └── ...
```

Each object file contains the zlib-compressed concatenation of:

    <kind> <size>\0<raw content>

Supported kinds: `blob`, `tree`, `commit`, `manifest`, `secret`, `artifact`, `pointer`.

## CLI Reference

| Command | Description |
|---|---|
| `k33p init <name>` | Create a new k33p project |
| `k33p tui [path]` | Launch the TUI viewer (default) |
| `k33p info [path]` | Show project summary |
| `k33p store put <path> <file>` | Store a file in the CAS |
| `k33p store get <path> <hash>` | Retrieve an object from the CAS |
| `k33p store stats <path>` | Show CAS statistics |
| `k33p store ls <path>` | List objects in the CAS |
| `k33p version` | Print version |

Backward-compatible: `k33p <path>` launches the TUI (same as `k33p tui <path>`).

## Running the TUI

```bash
# from the project directory
nix-shell -p python3Packages.textual python3Packages.pyyaml \
  --run "PYTHONPATH=src python -m k33p examples/megarepo"

# or with a specific role
nix-shell -p python3Packages.textual python3Packages.pyyaml \
  --run "PYTHONPATH=src python -m k33p tui examples/coolproject --role=maintainer"

# or just print the project info
nix-shell -p python3Packages.textual python3Packages.pyyaml \
  --run "PYTHONPATH=src python -m k33p info examples/megarepo"
```

## TUI key bindings

| Key | Action |
|---|---|
| `o` | Overview |
| `c` | Channels |
| `s` | Subprojects |
| `v` | Views |
| `r` | Roles |
| `l` | Lock |
| `t` | Store |
| `1`–`5` | Switch role (end-user, developer, maintainer, ci, auditor) |
| `n` | Next subproject |
| `q` | Quit |

## What this is not

The project does not yet:

- fetch from transports (git, OCI, `k33p://`)
- run the daemon (auto-commit, hooks)
- perform migrations

Those are v0.1+ of the implementation.

## Layout

- `src/k33p/` — the package
- `tests/` — pytest tests (202 tests, all passing)
- `examples/` — example `k33p.yaml` files (single project and monorepo)
- `docs/index.md` — this page
- `scripts/snapshot_tui.py` — headless TUI snapshot tool
