# Scripts

This directory contains build scripts, automation utilities, and tooling for the entire megarepo.

## Contents

- **build_pages.py** - Generates the static documentation site from project READMEs and documentation
- **check_supply_chain.py** - Fails on common supply-chain regressions such as unpinned CI actions and runtime install patterns
- **requirements.in** / **requirements.txt** - Source and locked Python dependencies for scripts in this directory

## Usage

### Building the Static Site

The `build_pages.py` script generates the static site in the `site/` directory:

```bash
python build_pages.py
```

This script:

- Collects project information from all directories
- Generates index pages and navigation
- Outputs HTML to `site/` for static hosting
- Updates `docs/MEGAREPO_PAGES.md` with page references

### Running Scripts

To run any of these scripts, ensure dependencies are installed:

```bash
pip install -r requirements.txt
python <script_name>.py
```

## Adding New Scripts

When adding new scripts:

1. Add top-level Python dependencies to `requirements.in`
2. Regenerate the locked `requirements.txt`
3. Keep scripts simple and focused on a single task
4. Add documentation comments at the top of the script
5. Update this README if the script is user-facing

## See Also

- [../site/README.md](../site/README.md) - Generated static site output
- [../docs/README.md](../docs/README.md) - Documentation for the repository
- [../docs/MEGAREPO_PAGES.md](../docs/MEGAREPO_PAGES.md) - Static site generation documentation
- [../README.md](../README.md) - Repository root
