# Bandcamp Matcher

Cross-reference a Spotify export CSV against Bandcamp to find which of your Liked Songs are available for legal, DRM-free download.

## Quick start

```bash
cd active/dev-tools/bandcamp-matcher
python -m venv .venv
.venv/bin/pip install -e .
.venv/bin/bandcamp-matcher /path/to/liked.csv
```

Output: a JSON report, a filtered CSV of unmatched tracks, and a terminal summary.

## Docs

Full docs at [`docs/index.md`](docs/index.md).
