# Manifold MCP

This project is the repo-local integration point for Manifold MCP support.

## Upstream choice

The repo currently adopts the external server at:

- `bmorphism/manifold-mcp-server`

That upstream server already covers broad Manifold operations, including search, market lookup, trading, liquidity actions, and user lookups, so this repo does **not** reimplement a second full MCP server right now.

## What lives here

- config/launcher helpers for local MCP client setup
- an expected tool catalog for downstream projects
- lightweight validation that the chosen upstream install/env shape matches what this repo expects

## Quickstart

```bash
cd active/dev-tools/manifold-mcp
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
manifold-mcp print-config
```

## Testing

```bash
pytest -q
```
