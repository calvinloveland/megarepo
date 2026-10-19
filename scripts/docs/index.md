# Scripts

This directory contains build scripts, automation utilities, and tooling for the entire megarepo.

## Contents

- **build_docs_site.py** - Stages repository and project markdown into `.docs-site/` for MkDocs
- **migrate_readmes_to_docs.py** - Migrates in-scope `README.md` files into canonical `docs/index.md` pages and replaces the original README files with web-doc stubs
- **build_pages.py** - Legacy README-driven static-site generator retained for reference
- **check_supply_chain.py** - Fails on common supply-chain regressions such as unpinned CI actions and runtime install patterns
- **sync_pi_credentials.py** - Copies a pi API key from a local file into `~/.pi/agent/auth.json` on remote hosts (merges, keeps other providers, verifies the write)
- **requirements.in** / **requirements.txt** - Source and locked Python dependencies for legacy scripts in this directory

## Usage

### Building the documentation site

```bash
python -m pip install -r docs/requirements.txt
python build_docs_site.py
mkdocs build
```

### Migrating README files into docs directories

```bash
python migrate_readmes_to_docs.py
```

### Running other scripts

```bash
pip install -r requirements.txt
python <script_name>.py
```

### Propagating a pi API key to other machines

The key is read from a file, never from the command line, so it stays out of
shell history and process listings:

```bash
python scripts/sync_pi_credentials.py --key-file .secrets/opencodekey.txt \
    --hosts haswell,thinker --dry-run   # then drop --dry-run
```

Hosts must be reachable over non-interactive ssh. Each host's `auth.json` is
backed up before it is rewritten, other providers are left untouched, and the
result is re-read to confirm the key landed.

## Notes

- `.docs-site/` and `site/` are generated outputs.
- The MkDocs site is the canonical documentation build path.
- `build_pages.py` remains available as legacy tooling during the transition.

## See Also

- [../docs/index.md](../../docs/index.md) - Web docs home
- [../docs/MEGAREPO_PAGES.md](../../docs/MEGAREPO_PAGES.md) - Documentation site build details
- [../README.md](../../README.md) - Repository root landing page
