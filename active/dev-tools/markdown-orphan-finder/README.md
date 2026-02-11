# Markdown Orphan Finder

A tool to find orphaned markdown files and isolated islands in a repository.

## What it finds

1. **Orphaned files**: Markdown files that are not linked to by any other markdown file in the repository
2. **Isolated islands**: Groups of markdown files that only link to each other, with no incoming links from outside the group

## Usage

```bash
# Scan current directory
python find_orphans.py

# Scan specific directory
python find_orphans.py /path/to/repo

# Show what orphaned files link to
python find_orphans.py --show-links

# Exclude patterns (can be used multiple times)
python find_orphans.py --exclude "archive/.*" --exclude "node_modules/.*"
```

## Examples

```bash
# Find orphans in the megarepo root
cd /home/calvin/code/megarepo
python active/dev-tools/markdown-orphan-finder/find_orphans.py

# Find orphans excluding archive directory
python active/dev-tools/markdown-orphan-finder/find_orphans.py --exclude "^archive/"
```

## How it works

The tool:
1. Scans for all `.md` and `.markdown` files in the repository
2. Parses each file to extract links to other markdown files
3. Builds a directed graph of file linkages
4. Identifies orphaned nodes (files with no incoming links)
5. Finds isolated connected components (islands that have no external incoming links)

## Use cases

- **Documentation maintenance**: Find documentation that's not integrated into your doc structure
- **Cleanup**: Identify old markdown files that may be outdated or unused
- **Link checking**: Ensure all important docs are discoverable through navigation
- **Architecture review**: Understand the structure of your documentation

## Limitations

- Only detects markdown-to-markdown links (not links from code, HTML, etc.)
- Requires links to use relative paths
- Does not check if linked files actually exist (only existing files are analyzed)
