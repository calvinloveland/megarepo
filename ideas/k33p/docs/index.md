# k33p

**Status:** design draft, v0.3

A typed version-control system where **monorepos are the first-class citizen** and every channel is content-addressed, scoped, and projected through role-based views. A k33p project is a monorepo with one or more subprojects; a "single project" is a degenerate monorepo with one subproject at the root path. Subprojects have their own secrets, dependencies, artifacts, and lockfile — all scoped to their path within the monorepo. Users pull just the slice they need (`k33p clone megarepo/powder_play`) and materialize exactly the channels their role (end-user, developer, maintainer, ci, auditor) subscribes to.

## Reading

The design doc is a long-form HTML document with diagrams, scenarios, and a comparison against git, OCI, package managers, and Nix.

- [**Open the design doc →**](../design.html)

## Key design moves

- **Monorepos are the first-class citizen.** Subprojects are path-scoped slices with their own `k33p.yaml` (or inherited), their own view, their own channels, and their own lockfile. The other channels are scoped to each subproject via a `scope:` key.
- **Content-addressed store** shared by all channels. Dedup, trustless mirrors, and object-level addressing fall out for free.
- **Five channel types:** `src`, `private`, `deps`, `artifacts`, `live`. The `live` channel is the only mutable one — signed, rate-limited, auditable pointer updates.
- **Per-role views, no required on-disk layout.** A `developer` view puts deps at `./node_modules`; a `ci` view puts them at `./.k33p/vendored/`; an `end-user` view doesn't materialize deps at all.
- **History is per-channel.** `src@full` for maintainers, `src@shallow` for developers, `private@none` always, `deps@lockfile`, `artifacts@ring(10)`.
- **Roles are bundles, not permissions.** `k33p role use maintainer` is the user-facing knob; the role decides which channels materialize.
- **k33p daemon** watches src paths, debounces edits, auto-commits, signs, optionally pushes. Declarative config in `k33p.yaml`.
- **k33p wraps git for `src`.** `k33p git <args>` passes through; migration cost is near zero.
- **Signed build manifests** with explicit `toolchain` block (compiler, build system, linker, codegen, env hash) link `(src commit, dep lock, toolchain) → (artifact hash)`. Provenance for free.
- **Content-addressed partial mirrors** make offline / reproducible environments a first-class concern.
- **Multi-tenancy** with orgs → teams → sub-teams and cascading permissions, scoped to subprojects.
- **IPFS-like trustless mirrors** — any peer can serve content by hash; verification is local.

## What this folder is

- `design.html` — the long-form design doc (self-contained, dark theme, ~2,350 lines)
- `docs/index.md` — this stub, which makes the project visible in the published site
