# Supply chain review - 2026-05-04

## Scope

This is a static repo review of supply-chain exposure across machine config, CI/CD, container build/deploy paths, and application dependency management.

I inspected:

- repository manifests and lockfiles
- GitHub Actions workflows
- Dockerfiles and selected Kubernetes manifests
- devcontainer bootstrap scripts
- the Nix-based machine config in `active/personal/calnix/`

This is **not** a full CVE scan, host forensics pass, or network/service audit.

## Executive summary

Your strongest supply-chain controls are in the **Nix-managed machine layer** (`active/personal/calnix/`), where you already have a `flake.lock`, hash-pinned external downloads, and one explicit auto-update suppression for Copilot CLI.

Your weakest controls are in the **app deployment and Python dependency layers**:

1. **Some Kubernetes workloads download source from GitHub `main` at runtime and install dependencies on pod boot.**
2. **Python projects are almost entirely unlocked**: 21/21 `pyproject.toml` projects found in `active/` have no adjacent lockfile.
3. **Several projects use broad version ranges or direct VCS dependencies** that are not pinned to immutable commits.
4. **CI workflows and container bases are version-pinned only loosely** (`@v4`, `node:20-bookworm-slim`, `python:3.12-slim`) rather than pinned to immutable SHAs/digests.
5. **Tracked vendored `node_modules` content exists in git** (`7156` tracked files), which increases review blind spots and stale dependency risk.

## What is already good

### 1. Nix machine config is the best-hardened area

`active/personal/calnix/flake.nix` and `active/personal/calnix/flake.lock` provide a much better baseline than ad-hoc host installs:

- flake inputs are locked
- several external fetches are content-hashed
- the custom Copilot CLI wrapper adds `--no-auto-update`
- the Pi agent harness tarball is pinned by version and hash

This is the right direction for machine hardening.

### 2. Most JS apps with real dependencies have lockfiles

Examples:

- `active/web-apps/vernissage/package-lock.json`
- `active/dev-tools/browser-error-logger/package-lock.json`
- `active/bots/broomsweeper_solver/package-lock.json`

That is materially better than bare `npm install` without a lockfile.

### 3. `npm ci` is used in some higher-value paths

Examples:

- `.github/workflows/vernissage-container.yml`
- `active/web-apps/vernissage/Dockerfile`
- `active/dev-tools/hivemind-llm/frontend/Dockerfile`

## Findings

## Critical: runtime source fetch and install in Kubernetes

### Affected files

- `active/web-apps/parambulator/k8s/parambulator.yaml`
- `active/web-apps/momos/k8s/cozi.yaml`
- `active/web-apps/sub-day-generator/k8s/sub-day-generator.yaml`

### What happens

These manifests download `https://github.com/calvinloveland/megarepo/archive/refs/heads/main.tar.gz` at runtime, unpack it in the pod, and run `pip install` inside the live workload.

In practice this means the running app is **not** tied to:

- a reviewed image digest
- a signed release artifact
- a specific git commit in the deployment manifest
- a frozen dependency graph

It also means a GitHub compromise, branch protection failure, malicious commit, or accidental bad push to `main` can become a production code change without a normal image-build promotion step.

### Why this matters

This is the single biggest supply-chain weakness in the repo.

It bypasses most normal controls:

- CI validation becomes advisory instead of authoritative
- image scanning becomes incomplete
- rollback fidelity gets worse
- provenance is weak because the pod mutates itself after scheduling

### Recommended mitigation

**Priority P0**

- Stop downloading source in pods.
- Build immutable images in CI or on a controlled builder.
- Reference those images by digest in Kubernetes.
- Move all dependency installation into the image build.
- If hot reload is needed for development, keep it strictly out of production manifests.

## High: runtime package installation inside workloads

### Affected files

- `active/bots/openclaw/k8s/openclaw.yaml`
- `active/web-apps/parambulator/k8s/parambulator.yaml`
- `active/web-apps/momos/k8s/cozi.yaml`
- `active/web-apps/sub-day-generator/k8s/sub-day-generator.yaml`
- several Dockerfiles using floating distro repos during `apt-get install`

### What happens

Examples include:

- `npm install -g "openclaw@2026.3.24"` inside the pod
- `apt-get install chromium` inside the pod when missing
- `pip install "Flask>=2.3" ...` in app bootstrap logic

### Why this matters

Even when a package version is specified, install-time behavior still depends on:

- current registry contents
- current apt repository state
- live mirrors
- install scripts executed by package managers

This creates a mutable runtime supply chain.

### Recommended mitigation

**Priority P1**

- Prebake all system and language dependencies into images.
- Avoid `apt-get` and package-manager installs in entrypoints and pod scripts.
- For Node and Python, install from lockfiles during image build only.
- Prefer distro/Nix-managed browsers over ad-hoc runtime installs.

## High: Python dependency management is largely unlocked

### Inventory

In `active/`, I found:

- **21 Python projects with `pyproject.toml`**
- **21/21 without an adjacent lockfile** (`poetry.lock`, `uv.lock`, `Pipfile.lock`, etc.)

Representative examples with broad version ranges:

- `active/dev-tools/full-auto-ci/pyproject.toml`
- `active/web-apps/parambulator/pyproject.toml`
- `active/dev-tools/hivemind-llm/coordinator/pyproject.toml`
- `active/games/wizard_fight/pyproject.toml`

There are also unlocked bare requirements files:

- `active/bots/CryptoRoleBot/requirements.txt`
- `scripts/requirements.txt`

### Why this matters

`>=` ranges without a lockfile mean installs are time-dependent. Two installs a week apart may resolve different transitive trees.

That weakens:

- reproducibility
- incident response
- rollback confidence
- reviewability of dependency drift

### Recommended mitigation

**Priority P1**

Adopt one Python locking approach repo-wide or by project family:

- `uv lock`
- `pip-tools` with compiled, hashed requirements
- Poetry/PDM lockfiles

For deployable apps, prefer:

- pinned top-level versions
- a committed lockfile
- `pip install --require-hashes` for production builds where practical

At minimum, start with the deployable apps:

- `active/web-apps/parambulator`
- `active/web-apps/momos`
- `active/web-apps/sub-day-generator`
- `active/dev-tools/hivemind-llm/coordinator`

## High: direct Git dependencies are not immutable

### Affected files

- `active/dev-tools/operationalize/pyproject.toml`
  - `lazy_ci @ git+https://github.com/calvinloveland/lazy_ci.git`
- `active/games/vroomon/pyproject.toml`
  - `full_auto_ci @ git+https://github.com/calvinloveland/full-auto-ci.git`

### Why this matters

Direct VCS dependencies without commit SHAs mean installs follow whatever that repository currently serves for the default ref.

That is better than an untrusted package name typo, but still weaker than:

- publishing signed versioned artifacts
- pinning an exact commit hash
- vendoring a reviewed internal library as a local workspace dependency

### Recommended mitigation

**Priority P1**

- Replace direct git dependencies with published versioned packages, or
- pin to an exact commit SHA, or
- convert to local workspace/internal package references inside the monorepo

## Medium-high: GitHub Actions are not commit-SHA pinned

### Affected files

- `.github/workflows/publish-pages.yml`
- `.github/workflows/vernissage-container.yml`
- `active/dev-tools/full-auto-ci/.github/workflows/ci.yml`
- `active/games/conway_game_of_war/.github/workflows/main.yml`

### What I saw

Representative usage includes:

- `actions/checkout@v4`
- `actions/setup-node@v4`
- `actions/setup-python@v4`
- `docker/build-push-action@v6`
- `peaceiris/actions-gh-pages@v4`

### Why this matters

Major-version tags are normal, but they are not immutable. A compromised action publisher or malicious retag could affect your CI.

The risk is highest for third-party actions like `peaceiris/actions-gh-pages`.

### Recommended mitigation

**Priority P1**

- Pin actions to full commit SHAs.
- Keep a small allowlist of approved actions.
- Minimize workflow token permissions per job.
- For release jobs, prefer OIDC + short-lived credentials over long-lived secrets.

## Medium-high: container bases are tag-pinned, not digest-pinned

### Affected files

- `active/web-apps/vernissage/Dockerfile`
- `active/web-apps/parambulator/Dockerfile`
- `active/web-apps/momos/Dockerfile`
- `active/web-apps/sub-day-generator/Dockerfile`
- `active/dev-tools/hivemind-llm/frontend/Dockerfile`
- `active/dev-tools/hivemind-llm/coordinator/Dockerfile`

### What I saw

Examples:

- `FROM node:20-bookworm-slim`
- `FROM python:3.12-slim`
- `FROM nginx:alpine`

### Why this matters

These tags drift over time. That is good for patch intake, but bad for reproducibility and provenance unless you intentionally manage rebuild cadence.

### Recommended mitigation

**Priority P1/P2**

- Pin base images by digest.
- Rebuild on a schedule to ingest patched digests intentionally.
- Scan images during CI with Trivy/Grype.
- Generate SBOMs with Syft or equivalent.

## Medium: tracked `node_modules` in git

### Evidence

`git ls-files '*/node_modules/*'` returned **7156 tracked files**.

The most visible case is under:

- `active/dev-tools/browser-error-logger/node_modules/`

### Why this matters

Checked-in dependency trees create several problems:

- reviewers stop noticing malicious or accidental dependency drift
- stale or locally-generated artifacts linger in git history
- integrity comes from git state rather than lockfile + clean install
- it becomes harder to prove what is source vs generated vendor content

### Recommended mitigation

**Priority P2**

- Remove tracked `node_modules` from git.
- Keep lockfiles, not installed trees.
- Add a CI guard that fails if `node_modules/`, `.venv/`, `.next/`, or test-runtime bundles become tracked.

## Medium: devcontainer bootstrap is broad and network-heavy

### Affected file

- `.devcontainer/post-create.sh`

### What happens

The script upgrades pip, installs shared tools globally, then installs many projects in editable mode, and runs `npm install` for extension dependencies.

### Why this matters

This is mainly a **developer workstation** supply-chain concern:

- many projects resolve dependencies during environment bootstrap
- most Python projects have no lockfile
- `npm install` is less deterministic than `npm ci`
- one compromised dependency can poison a shared dev environment

### Recommended mitigation

**Priority P2**

- Split the devcontainer into smaller profiles or opt-in project bootstraps.
- Use lockfiles everywhere before bulk installation.
- Prefer `npm ci` when a lockfile exists.
- Consider a Nix-based dev shell for more of the repo instead of mixed pip/npm bootstrap.

## Medium: wildcard peer dependency policy in published Pi packages

### Representative file

- `active/personal/calnix/pi-packages/pi-subagents/package.json`

### What I saw

Wildcard peer dependencies such as:

- `"@mariozechner/pi-agent-core": "*"`
- `"@mariozechner/pi-ai": "*"`
- `"typebox": "*"`

### Why this matters

This is not an immediate exploit path, but it broadens the range of upstream versions the package may consume, making behavior less predictable and review less precise.

### Recommended mitigation

**Priority P3**

- Replace `*` with tested semver ranges.
- Publish compatibility policy alongside package releases.

## Low-medium: missing routine dependency and artifact security automation

I did **not** find evidence of active repo-level automation for:

- Dependabot or Renovate
- `pip-audit`, `osv-scanner`, or similar in CI
- `npm audit`/`audit-ci` in CI
- image scanning in CI
- SBOM generation
- signed build provenance / attestations

### Recommended mitigation

**Priority P2**

Add lightweight automation first:

1. Dependabot or Renovate for lockfile PRs
2. `pip-audit` for Python apps
3. `npm audit --production` or `audit-ci` for deployable JS apps
4. Trivy/Grype for container images
5. SBOM generation for release images

## Prioritized mitigation plan

## Phase 1 - close the biggest holes

1. Remove runtime GitHub source download from production pods.
2. Remove runtime `pip install`, `npm install`, and `apt-get install` from production startup flows.
3. Pin GitHub Actions to commit SHAs.
4. Lock Python dependencies for deployable apps first.

## Phase 2 - make builds reproducible

1. Pin Docker base images by digest.
2. Replace direct git dependencies with pinned internal/package releases.
3. Remove tracked `node_modules` from git.
4. Switch devcontainer installs from best-effort mutable bootstrap to lockfile-backed installs.

## Phase 3 - add continuous detection

1. Add Dependabot/Renovate.
2. Add Python, Node, and image vulnerability scanning in CI.
3. Generate SBOMs for release artifacts.
4. Add provenance/attestation for built images if your deployment path matures.

## Machine hardening recommendations

Because your machine layer already uses Nix, the best machine-level move is to **lean harder into Nix and less into ad-hoc package managers**:

- prefer Nix-managed developer tools over `pip install`/`npm install -g`
- avoid global installs on the host where possible
- keep auto-updating CLIs disabled unless updates are centrally reviewed
- isolate build/deploy credentials from daily-use shells
- prefer immutable image builds over host-initiated in-cluster mutation
- keep browser/tool downloads in workspace-local caches, not shared global mutable state

## Bottom line

If you only do three things, do these:

1. **Stop pods from downloading code from GitHub `main` at runtime.**
2. **Adopt lockfiles for Python deployables and build from them.**
3. **Pin CI actions and container bases to immutable identifiers.**

Those three changes would remove most of the highest-leverage supply-chain risk currently visible in the repo.
