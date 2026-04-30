---
name: pi-package-gallery
description: Search and browse the public pi.dev package gallery for extensions, skills, prompts, themes, and packages. Use when the user wants to discover or shortlist third-party Pi packages.
---

# Pi Package Gallery Search

Use this skill when the user asks to browse, search, or shortlist third-party Pi extensions, skills, prompts, themes, or packages from the public gallery at `https://pi.dev/packages`.

This skill gives you a repeatable way to fetch the gallery directly from pi.dev instead of guessing package names.

## What this skill does

- Fetches package entries from `https://pi.dev/packages`
- Filters by type (`extension`, `skill`, `prompt`, `theme`, `package`)
- Searches package names, descriptions, authors, and gallery search text
- Prints install commands, package pages, npm links, and repo links

## Script

Use the helper script:

```bash
~/.pi/agent/skills/pi-package-gallery/scripts/fetch_pi_packages.py
```

## Common commands

List the top extension entries from the first page:

```bash
~/.pi/agent/skills/pi-package-gallery/scripts/fetch_pi_packages.py --type extension --pages 1 --limit 20
```

Search for a keyword across extensions:

```bash
~/.pi/agent/skills/pi-package-gallery/scripts/fetch_pi_packages.py --type extension --search autopilot --pages 5 --limit 20
```

Search all package types:

```bash
~/.pi/agent/skills/pi-package-gallery/scripts/fetch_pi_packages.py --search footer --pages 5 --limit 20
```

Get JSON for further processing:

```bash
~/.pi/agent/skills/pi-package-gallery/scripts/fetch_pi_packages.py --type extension --search model --pages 5 --json
```

## Recommended workflow

1. Ask what kind of package the user wants (`extension`, `skill`, etc.).
2. Run the script with `--search` terms taken from the user's request.
3. Review the top results.
4. If needed, open package pages or repos with `curl` / `read` / `bash` for more detail.
5. Present the best candidates with:
   - package name
   - one-line description
   - install command
   - repo link
6. If the user wants one installed, use `pi install ...` or edit `settings.json` as appropriate.

## Notes

- The pi.dev gallery is paginated, so increase `--pages` if needed.
- The gallery includes package cards with different types. Some entries are umbrella `package` bundles rather than a single extension.
- The script is HTML-scrape based, so if pi.dev markup changes, update the parser in `scripts/fetch_pi_packages.py`.
