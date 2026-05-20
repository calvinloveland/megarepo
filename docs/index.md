# Megarepo Documentation

Welcome to the web documentation home for the megarepo.

This site is now the canonical place for repository and project documentation. Long-form project READMEs have been migrated into web docs pages, while in-repo `README.md` files outside the repository root are short pointer stubs for GitHub directory browsing.

## Start Here

- [Projects](projects/) — migrated docs for active areas, projects, packages, and repo sections
- [Repository Reference](repository/) — repo-wide philosophy, plans, migration notes, and reference docs
- [Web Docs Migration Plan](repository/WEB_DOCS_MIGRATION_PLAN/) — the plan behind the migration
- [GitHub Repository](https://github.com/calvinloveland/megarepo) — source code and pull requests

## Repository Shape

- `active/` — maintained projects grouped by area
- `archive/` — historical material kept in the repo, but intentionally not migrated into the main web docs
- `docs/` — repository-wide source documentation for this site
- `ideas/` — brainstorming and project ideas
- `meta/` — repo analysis and maintenance notes
- `scripts/` — automation and docs build tooling

## Documentation Conventions

- The repository root `README.md` is a short landing page.
- Canonical project docs live in per-project `docs/` directories.
- The published documentation site is built from repository markdown and deployed to GitHub Pages.
- Archive content is intentionally excluded from the main docs site unless migrated on purpose later.

## Working on the Docs Site

To preview the site locally:

```bash
python -m pip install -r docs/requirements.txt
python scripts/build_docs_site.py
mkdocs serve
```

The staging step builds `.docs-site/`, and MkDocs renders that staged content into the final static site.
