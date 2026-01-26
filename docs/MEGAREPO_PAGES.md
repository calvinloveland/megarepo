# Megarepo GitHub Pages

This repository contains an automated static site generator that produces simple, per-subrepo pages and publishes them to the `gh-pages` branch.

What it does
- Discovers subprojects (subrepos) and generates a page for each using either `docs/index.md` or `README.md`.
- Produces `site/<subrepo>/index.html` and a top-level `site/index.html` with links.
- Deploys `site/` to the `gh-pages` branch via GitHub Actions on pushes to `main`/`master` or weekly.

How to add custom docs for a subrepo
- Add or edit `docs/index.md` in the subrepo — the generator prefers `docs/index.md` over `README.md`.

Preview locally

1. Install Python requirements:

```bash
python -m pip install -r scripts/requirements.txt
```

2. Run the builder:

```bash
python scripts/build_pages.py
```

3. Serve locally (from the repo root):

```bash
python -m http.server --directory site 8000
# then open http://localhost:8000
```

Notes
- The generator uses simple heuristics to find subrepos. It looks for directories containing a `README.md` and common project markers like `pyproject.toml`, `package.json`, an explicit `src/` or `tests/` directory, or `docs/`.
- The top-level `site/` is ignored by the repository (added to `.gitignore`) to prevent accidental commits of generated output.
