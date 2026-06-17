# k33p

**Status:** design draft, v0.1

A typed version-control system for the real shape of a modern project. A k33p project is a typed collection of content channels — public source, private content, third-party dependencies, and built artifacts — each with its own transport, access rules, and definition of "history." Users materialize the channels their role needs (end-user, developer, maintainer, ci, auditor); nothing more, nothing less.

## Reading

The design doc is a long-form HTML document with diagrams, scenarios, and a comparison against git, OCI, package managers, and Nix.

- [**Open the design doc →**](../design.html)

## Key design moves

- **Four first-class channels:** `src`, `private`, `deps`, `artifacts`. Each has its own transport, access policy, and history policy. Secrets are structurally incompatible with the public channel.
- **History is per-channel.** `src@full` for maintainers, `src@shallow` for developers, `private@none` always, `deps@lockfile`, `artifacts@ring(10)`.
- **Roles are bundles, not permissions.** `k33p role use maintainer` is the user-facing knob; the role decides which channels materialize.
- **k33p wraps git for `src`.** `k33p git <args>` passes through; migration cost is near zero.
- **Signed build manifests** link `(src commit, dep lock, env hash) → (artifact hash)`. Provenance for free.
- **Content-addressed partial mirrors** make offline / reproducible environments a first-class concern.

## What this folder is

- `design.html` — the long-form design doc (self-contained, dark theme, ~1,200 lines)
- `docs/index.md` — this stub, which makes the project visible in the published site
