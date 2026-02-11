#!/usr/bin/env bash
# Convenience wrapper to run markdown orphan finder on the megarepo

cd "$(dirname "$0")/../../.."
python active/dev-tools/markdown-orphan-finder/find_orphans.py . --exclude "^archive/" --exclude "^\.venv" "$@"
