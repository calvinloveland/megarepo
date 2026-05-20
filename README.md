# Megarepo

A consolidated monorepo for active projects, archived experiments, shared tooling, and repository-level documentation.

## Documentation

Canonical documentation now lives on the GitHub Pages site:

- https://calvinloveland.github.io/megarepo/

Use the web docs for project overviews, repository reference docs, and migrated long-form documentation.

## Repository Layout

- `active/` — maintained projects grouped by area
- `archive/` — historical projects and reference material
- `docs/` — repository-wide source docs for the web site
- `ideas/` — project concepts and brainstorming notes
- `meta/` — repository analysis and maintenance notes
- `scripts/` — automation and documentation tooling

## Contributing

- Start with the web docs: https://calvinloveland.github.io/megarepo/
- Read [PHILOSOPHY.md](PHILOSOPHY.md) for the repo's durable engineering principles.
- Use `python scripts/build_docs_site.py && mkdocs serve` to preview the docs site locally.
