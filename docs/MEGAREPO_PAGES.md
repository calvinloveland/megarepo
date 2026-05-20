# Megarepo Web Docs and Pages

The megarepo documentation site is built from repository markdown and published to GitHub Pages.

## Current setup

- `scripts/migrate_readmes_to_docs.py` migrates in-scope `README.md` files into per-directory `docs/index.md` pages and rewrites the original README files into short pointer stubs.
- `scripts/build_docs_site.py` stages repository docs into `.docs-site/` for publishing.
- `mkdocs.yml` configures MkDocs Material to render the staged markdown into the final static site.
- `.github/workflows/publish-pages.yml` builds the site and deploys `site/` to GitHub Pages.

## Canonical documentation rules

- The repository root `README.md` stays as a short landing page.
- Non-root `README.md` files are convenience pointers for GitHub folder browsing, not the canonical docs.
- Canonical project docs live in per-project `docs/` directories.
- Root-level repository docs live in `docs/`.

## Preview locally

Install the docs tooling:

```bash
python -m pip install -r docs/requirements.txt
```

Build the staged docs tree and render the site:

```bash
python scripts/build_docs_site.py
mkdocs build
```

Serve locally:

```bash
mkdocs serve
```

## Output directories

- `.docs-site/` is generated staging input for MkDocs.
- `site/` is generated static output for GitHub Pages.

Both are generated artifacts and should not be edited by hand.

## Notes

The older `scripts/build_pages.py` README-driven static-site flow remains in the repository as legacy tooling, but the MkDocs-based GitHub Pages site is now the primary documentation path.
