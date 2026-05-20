# Web Documentation Migration Plan

## Decision Summary

Move the megarepo from README-first documentation to a GitHub Pages-hosted documentation site, with markdown in the repo as the source of truth.

Recommended stack:

- **MkDocs + Material for MkDocs** for the web site
- **GitHub Pages** for hosting
- **GitHub Actions Pages deploy** for publishing
- **Per-project `docs/` directories** for docs that stay close to the code
- **Short README stubs** outside the repo root only where GitHub directory landing pages still need a pointer

This keeps docs browsable on the web, searchable, and structured, without making documentation editing depend on a separate CMS.

## Why change from the current setup

The repo already has a simple static-site flow:

- `scripts/build_pages.py`
- `site/` output
- `.github/workflows/publish-pages.yml`

That setup is useful as a bridge, but it is still fundamentally **README-driven**. For the migration you described, the main gaps are:

- no real information architecture beyond directory discovery
- no first-class section nav or nested project nav
- no built-in search
- no good long-form docs UX for multi-page projects
- no explicit distinction between canonical docs and convenience READMEs
- the current site depends on README presence, which is exactly what you want to move away from

## Recommended target architecture

### 1. Canonical docs live in markdown, but not in project READMEs

Use markdown files in the repo as the source of truth, but make the canonical entry point for each project:

- `<project>/docs/index.md`
- optional supporting pages in `<project>/docs/`

Examples:

- `active/dev-tools/full-auto-ci/docs/index.md`
- `active/web-apps/vernissage/docs/index.md`
- `active/personal/calnix/docs/index.md`

This keeps docs next to the code they describe.

### 2. Root-level site source handles shared docs and navigation

Keep the existing root `docs/` directory for repo-wide docs:

- repo overview
- contributor guides
- philosophy
- conventions
- generated indexes
- migration status

The web site should combine:

- root repo docs from `docs/`
- project docs discovered from `*/docs/`

### 3. README strategy

#### Root `README.md`
Keep it, but shorten it into a landing page that:

- explains what the megarepo is
- links to the published docs site
- links to a contributor quickstart
- links to the most important top-level areas

#### All other project `README.md` files
Replace long-form READMEs with one of these two approaches:

1. **Preferred during migration:** keep a very short stub README that links to the canonical docs page
2. **Later optional cleanup:** remove the stub if you decide GitHub directory landing pages are not worth preserving

Recommended stub format:

```md
# <Project Name>

Canonical docs live at:
- https://<org>.github.io/<repo>/<path>/

Local source docs live in:
- `docs/`
```

I would not delete subproject READMEs immediately. GitHub renders them when browsing folders, and losing that completely makes the repo harder to navigate.

## Recommended documentation structure

### Repo-wide docs

```text
docs/
  index.md
  getting-started.md
  contributing.md
  philosophy.md
  architecture/
  reference/
  migration/
```

### Project docs

```text
active/dev-tools/full-auto-ci/
  docs/
    index.md
    architecture.md
    development.md
    operations.md
```

### Published site URLs

Use a predictable URL pattern based on repo paths:

- `/` → repo home
- `/projects/active/dev-tools/full-auto-ci/`
- `/projects/active/web-apps/vernissage/`
- `/projects/active/personal/calnix/`

That makes README stubs and generated indexes easy to build.

## Site generator recommendation

### Recommended: MkDocs Material

Why this is the best fit here:

- markdown-native
- excellent navigation for a large doc tree
- built-in search
- good dark mode and mobile defaults
- low operational overhead on GitHub Pages
- easy to keep docs in git review flow

Suggested baseline features:

- search
- section nav
- edit-on-GitHub links
- generated project index
- last-updated dates if useful
- callouts/admonitions for warnings and operational notes

### Why not keep only the current custom generator

You could extend `scripts/build_pages.py`, but that path turns into rebuilding a docs platform:

- nav management
- page hierarchy
- search
- theming
- content metadata
- edit links
- markdown extensions

MkDocs already solves those problems.

## Hosting plan

### Recommended GitHub Pages deployment model

Use the official GitHub Pages Actions flow instead of publishing a `gh-pages` branch manually.

Recommended workflow shape:

1. checkout repo
2. install docs dependencies
3. build site into `site/`
4. upload pages artifact
5. deploy with `actions/deploy-pages`

Benefits:

- less branch-management overhead
- more standard GitHub Pages setup
- simpler permissions model
- easier to reason about than a force-updated `gh-pages` branch

If you want to keep the existing `gh-pages` branch flow initially, that is fine for phase 1. I would still plan to move to the official Pages deployment once the docs site is stable.

## Migration phases

### Phase 0: inventory and rules

Goal: define what counts as a real project doc and what should be excluded.

Tasks:

- inventory real repo READMEs to migrate
- exclude generated/vendor/cache paths (`archive/`, `node_modules/`, `.venv/`, `.pytest_cache/`, artifacts)
- classify pages by type:
  - repo index
  - area index
  - project home
  - operational runbook
  - fixture/test-only notes
- define the canonical doc template for projects

Output:

- migration inventory file
- doc template for project home pages
- list of paths intentionally left alone

### Phase 1: docs platform bootstrap

Goal: stand up the new site without changing every project yet.

Tasks:

- add `mkdocs.yml`
- add docs dependencies
- create root site home page
- create generated project index page
- create a sync/build step that pulls project `docs/` pages into the published site
- add GitHub Pages workflow
- publish a first working docs site

Output:

- live GitHub Pages site
- root docs home page
- generated project index

### Phase 2: pilot migration

Goal: migrate a representative sample before doing the full repo.

Recommended pilot set:

- one simple Python project
- one larger web app
- one infra/config project
- one area index page

Example candidates:

- `active/dev-tools/full-auto-ci`
- `active/web-apps/vernissage`
- `active/personal/calnix`
- `active/dev-tools/README.md` → area docs page

Tasks:

- move README content into `docs/index.md` and supporting pages
- replace project README with a short stub
- verify links, nav, and search
- refine the project docs template

Output:

- proven migration pattern
- stub README format
- confirmed site IA before bulk migration

### Phase 3: bulk migration

Goal: move the rest of the active repo from README-first to docs-first.

Recommended order:

1. root and top-level area pages
2. active projects
3. shared tooling/docs/meta sections
4. optional personal/internal sections
5. archive only if explicitly desired later

Tasks:

- create `docs/index.md` for each in-scope project
- split very long READMEs into multiple pages where it helps
- replace project READMEs with stubs
- update cross-links to point at docs URLs or local `docs/` paths
- add redirects where needed for renamed pages

### Phase 4: cleanup and policy enforcement

Goal: prevent regression back to README-first docs.

Tasks:

- retire or repurpose `scripts/build_pages.py`
- remove README-driven assumptions from docs generation
- add a docs lint/check in CI
- add a policy note to `AGENTS.md` and contributor docs:
  - root README is a landing page
  - project docs belong in `docs/`
  - project README files are stubs only
- optionally add a checker that flags oversized non-root READMEs

## Implementation details worth deciding up front

### A. Where navigation metadata lives

Pick one:

1. **Generated from repo structure** — lowest maintenance, less curated
2. **Single docs manifest file** — more control, more maintenance
3. **Per-project frontmatter metadata** — good balance

Recommendation: start with **generated structure + lightweight per-project metadata**.

Useful metadata fields:

- title
- summary
- status
- tags
- owner
- repo path
- docs landing path

### B. How to handle long project READMEs

Some existing READMEs are probably doing multiple jobs at once:

- overview
- architecture
- local dev setup
- deployment/runbook
- troubleshooting
- roadmap

Do not move those into one giant `docs/index.md` page. Split them.

Recommended page breakdown:

- `docs/index.md` — overview
- `docs/development.md` — local setup and workflows
- `docs/architecture.md` — design and structure
- `docs/operations.md` — deploy/runbook
- `docs/troubleshooting.md` — known failures and fixes

### C. What stays out of the site

Do not automatically publish everything with a `README.md`.

Exclude by default:

- `archive/`
- generated artifacts
- fixture directories
- caches
- vendored dependencies
- tool download directories
- test-only helper folders unless intentionally documented

### D. Local author workflow

Target author workflow should be simple:

```bash
python -m pip install -r docs/requirements.txt
mkdocs serve
```

or if using uv:

```bash
uv run mkdocs serve
```

Contributors should edit markdown in place next to the project code, preview locally, and let Actions publish on merge.

## Acceptance criteria

The migration is successful when:

- root `README.md` is a short landing page linking to the docs site
- non-root project docs are canonical in `docs/` pages, not READMEs
- the docs site has search, nav, and stable URLs
- each active project has a docs landing page
- cross-links no longer depend on README paths
- GitHub Pages publishes automatically from CI
- there is a documented policy preventing drift back to long-form project READMEs

## Suggested first implementation slice

If you want to do this incrementally, the first concrete slice should be:

1. add MkDocs config
2. publish a basic GitHub Pages site
3. convert the root repo docs home
4. migrate one area page and 3 representative projects
5. replace only those READMEs with stubs
6. confirm the structure works before bulk migration

That gives you a safe pilot without committing to a repo-wide rewrite in one pass.

## Recommendation

Use **MkDocs Material on GitHub Pages**, keep docs **in markdown inside the repo**, move canonical project docs to **per-project `docs/` directories**, keep the **root README as a short landing page**, and replace other READMEs with **short link stubs during migration**.

That gets you the web-based documentation setup you want without losing repo-local editing, code review visibility, or GitHub folder discoverability.
