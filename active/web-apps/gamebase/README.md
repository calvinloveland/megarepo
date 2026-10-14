# Gamebase

🕹️ **Hosting and platform services for AI-created web games.**

Gamebase is a self-hosted arcade: drop a folder with a `game.yaml` manifest plus
your HTML/JS, and you get identity, high scores, achievements, matchmaking, and
one-click remixing for free.

## Quick start

```bash
cd active/web-apps/gamebase
nix-shell                     # Flask + PyYAML + pytest
PYTHONPATH=src PORT=5121 python3 -m gamebase
```

Then open <http://localhost:5121>. In the megarepo launcher, Gamebase is
registered as the 🕹️ **Gamebase** app (subdomain `games`, port `5121`).

## Documentation

Canonical documentation lives with the project:

- [`docs/index.md`](docs/index.md) — concepts, game manifest format, SDK, REST API, CLI, workflow

## Tests

```bash
cd active/web-apps/gamebase
PYTHONPATH=src python3 -m pytest -q
```

or through the repo check runner:

```bash
python scripts/check_all.py gamebase
```
