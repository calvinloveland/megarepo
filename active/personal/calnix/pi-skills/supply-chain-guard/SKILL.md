---
name: supply-chain-guard
description: Audit and harden repos against common supply-chain regressions such as unpinned CI actions, runtime installs in production manifests, missing lockfiles for deployables, and tracked vendor directories.
---

# Supply Chain Guard

Use this skill when you are:

- hardening a machine or repo against supply-chain attacks
- reviewing CI/CD, container, or dependency hygiene
- preparing a project for public deployment
- adding guardrails so the same issues do not come back

## Goals

This skill is designed to prevent a few high-leverage failure modes:

1. **runtime code fetch in production**
2. **runtime package installation in pods or entrypoints**
3. **mutable CI dependencies**
4. **deployables without lockfiles**
5. **vendored install artifacts checked into git**
6. **direct git dependencies that are not pinned to immutable commits**

## Recommended workflow

1. Read the nearest `README.md` and `AGENTS.md`.
2. Inventory package manifests, lockfiles, workflows, Dockerfiles, and Kubernetes manifests.
3. Run any existing repo guard script first.
4. Fix the highest-risk runtime paths before lower-risk cleanup.
5. Add or update an automated guard so the repo fails fast next time.
6. Document the deployment path so humans stop reintroducing mutable bootstrap steps.

## Priority order

### P0

- remove runtime GitHub source downloads from production manifests
- remove `pip install`, `npm install`, and `apt-get install` from production startup flows
- replace them with prebuilt images or prebuilt machine packages

### P1

- pin GitHub Actions to full commit SHAs
- add lockfiles for deployable apps
- pin direct git dependencies to exact commit SHAs or replace them with published/internal packages
- stop shipping `:latest` as the only production promotion path when immutable tags are available

### P2

- remove tracked `node_modules/`, `.venv/`, `.next/`, and test harness bundles from git
- move dev bootstrap scripts toward lockfile-backed installs
- add CI checks for the guardrails you just introduced

## Concrete checks to run

Use fast searches first:

```bash
rg -n "archive/refs/heads/main.tar.gz|pip install|npm install|apt-get install" active .github scripts .devcontainer -g '!**/node_modules/**'
rg -n "uses:\s*[^@\s]+@v[0-9]+|uses:\s*[^@\s]+@main|uses:\s*[^@\s]+@master" .github active -g '*.yml' -g '*.yaml'
git ls-files '*/node_modules/*' '*/.venv/*' '*/.next/*' '*/.vscode-test/*'
rg -n "git\+https://" active scripts -g 'pyproject.toml' -g 'requirements*.txt'
```

Then inspect deployables specifically:

- Dockerfiles
- Kubernetes manifests
- deployment helper scripts
- app lockfiles
- CI workflows that build or publish artifacts

## Recommended fixes

### Runtime fetch/install

Prefer:

- image builds in CI or a controlled builder
- image references updated by deployment scripts
- immutable tags or digests for the rolled deployment

Avoid:

- branch tarball downloads in pods
- self-updating app containers
- package-manager installs in container entrypoints

### Python apps

Prefer:

- a committed lockfile for deployable apps
- `pip install --require-hashes -r requirements.lock`
- `pip install --no-deps .` after locked dependencies are installed
- test-only dependencies moved out of runtime dependencies

### JavaScript apps

Prefer:

- committed lockfiles
- `npm ci` instead of `npm install` when a lockfile exists
- no checked-in `node_modules`

### CI workflows

Prefer:

- actions pinned to full SHAs
- least-privilege permissions per job
- explicit build steps for deployable images
- a dedicated guard workflow that fails on regression

## Guardrails to add after the fix

A good repo-level guard should catch at least:

- unpinned action refs
- tracked vendor/install directories
- runtime source download/install markers in production manifests
- missing lockfiles for deployables
- direct git dependencies without pinned SHAs

## Deliverables

When you use this skill, try to leave behind:

1. the actual hardening change
2. a repeatable check script or CI workflow
3. updated deployment docs
4. a short report listing remaining exceptions

## Practical note

If the repo already has a purpose-built guard script, use it instead of inventing a fresh ad-hoc checklist. The goal is a durable automated safety net, not a one-time manual audit.

## Reference

See [references/checklist.md](references/checklist.md) for a compact implementation checklist you can reuse during future audits.
