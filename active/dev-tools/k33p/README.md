# k33p

**Status:** early implementation — TUI viewer + CAS + CLI

Typed version control where monorepos are the first-class citizen and every
channel is content-addressed, scoped, and projected through role-based views.

This is the implementation. The design lives at
[`ideas/k33p/design.html`](../../../ideas/k33p/design.html).

## What works today

- Parse `k33p.yaml` manifests (project, channels, views, roles, subprojects, daemon)
- Parse `k33p.lock` files (with toolchain block)
- Project model with subprojects and per-subproject channel scoping
- A TUI viewer that browses the project structure
- **Content-addressed store** — PUT, GET, HAS, DELETE by SHA-256 hash, zlib-compressed, sharded like git's `.git/objects/`
- **`k33p init`** — create new projects with boilerplate manifests + store
- **`k33p clone`** — clone from file:// transport
- **`k33p sync`** — pull updates from upstream sources
- **`k33p import --from-git`** — import any git repo as a k33p project
- **`k33p daemon`** — auto-commit with file watching, debounce, and snapshot commits
- **`k33p info`** — print project summary
- **`k33p store`** — CAS operations (put, get, stats, ls)
- **Transports**: FileTransport (local), GitTransport (git CLI), OCITransport (OCI registries via stdlib)
- Example manifests under `examples/`

## What does not work yet

- Migration tools (`k33p split`, `k33p convert`)
- Live channel pointer updates
- Multi-tenancy primitives
- `k33p://` transport (peer-to-peer)

## Quick start

```bash
# Create a new project
nix-shell -p python3Packages.python python3Packages.pyyaml python3Packages.textual \
  --run "python -m k33p init my-project --dir /tmp/my-project"

# View project info
nix-shell -p python3Packages.python python3Packages.pyyaml python3Packages.textual \
  --run "python -m k33p info /tmp/my-project"

# Store a file in the CAS
nix-shell -p python3Packages.python python3Packages.pyyaml python3Packages.textual \
  --run "python -m k33p store put /tmp/my-project some-file.txt"

# Launch the TUI
nix-shell -p python3Packages.python python3Packages.pyyaml python3Packages.textual \
  --run "python -m k33p tui examples/megarepo"
```

## CLI Reference

| Command | Description |
|---|---|
| `k33p init <name>` | Create a new k33p project |
| `k33p clone <source> [target]` | Clone a project from a local directory |
| `k33p sync [path]` | Pull updates from upstream sources |
| `k33p import --from-git <url> [target]` | Import a git repository |
| `k33p daemon [path]` | Run the auto-commit daemon |
| `k33p tui [path]` | Launch the TUI viewer (default) |
| `k33p info [path]` | Show project summary |
| `k33p store put <path> <file>` | Store a file in the CAS |
| `k33p store get <path> <hash>` | Retrieve an object from the CAS |
| `k33p store stats <path>` | Show CAS statistics |
| `k33p store ls <path>` | List objects in the CAS |
| `k33p version` | Print version |

Backward-compatible: `k33p <path>` launches the TUI (same as `k33p tui <path>`).

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
| `1`–`5` | Switch role |
| `n` | Next subproject |
| `q` | Quit |

## Layout

```
src/k33p/
├── __about__.py
├── __init__.py
├── __main__.py
├── cli.py          # `k33p` CLI dispatcher + subcommand handlers
├── manifest.py     # k33p.yaml parser + validator
├── lock.py         # k33p.lock parser
├── project.py      # Project + Subproject model
├── store.py        # Content-addressed store (CAS)
├── channels.py     # Channel type definitions
├── refs.py         # Ref + Pointer types
└── tui/
    ├── __init__.py
    └── app.py      # Textual TUI
```

See [`docs/index.md`](docs/index.md) for the published project page.
202 tests, all passing.
