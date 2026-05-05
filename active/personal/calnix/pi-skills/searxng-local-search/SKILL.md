---
name: searxng-local-search
description: Search the web from bash through the local SearXNG instance installed by calnix. Use when you need internet search results, documentation lookups, or fact-finding outside the repo. Prefer ripgrep/read for workspace files; use this skill for external web discovery.
---

# SearXNG Local Search

Use this skill when the task needs web search, not repo search.

This machine has a localhost-only SearXNG service exposed through the `searx-search` helper command.

## When to use it

Use this skill for:

- finding official docs for a library, API, tool, or error message
- checking recent public web information
- finding issue threads, discussions, or examples outside the local repo
- discovering likely URLs before fetching a page with `curl`

Do **not** use this skill when the answer should come from the local workspace. For repo code and docs, prefer:

- `rg`
- `find`
- `read`

## Commands

Basic search:

```bash
searx-search "SearXNG JSON API format"
```

Machine-readable JSON:

```bash
searx-search --json "nix flake check no-build"
```

Fetch one returned page after you identify the best URL:

```bash
curl -L https://docs.example.com/page
```

## Recommended workflow

1. Start with a focused query in `searx-search`.
2. Review the top hits and pick the most authoritative source.
3. Fetch the selected page with `curl` if you need details beyond the snippet.
4. Summarize the result for the user, citing the page title and URL when useful.
5. If the question is partly local and partly external, combine this skill with repo search.

## Search tips

- Prefer queries with product name + exact concept, e.g. `"nixos searxng json format"`.
- Search for exact error text in quotes when debugging.
- If results are noisy, add source hints like `docs`, `github`, `discussion`, or the package name.
- Use `--json` when you want structured output for further scripting.

## Troubleshooting

If `searx-search` fails:

- confirm the local service is running:

  ```bash
  systemctl status searx.service --no-pager
  ```

- confirm the helper works directly:

  ```bash
  searx-search "test query"
  ```

The local instance is expected at `http://127.0.0.1:8888` and is provided by calnix.
