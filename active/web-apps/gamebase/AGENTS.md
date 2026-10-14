# Gamebase — project instructions

Gamebase is a self-hosted arcade for AI-created web games, with Steam-like
platform services (identity, leaderboards, achievements, matchmaking) and a
folder-based game registry that is trivial to remix.

## Layout

- `src/gamebase/` — Flask app, SQLite models, registry, CLI
  - `app.py` — application factory (`create_app`) and request DB lifecycle
  - `api.py` — JSON REST API mounted at `/api`
  - `views.py` — server-rendered pages (catalog, game, player, create)
  - `registry.py` — the on-disk `game.yaml` contract; scan/scaffold/remix
  - `models.py` — all SQL queries; takes an explicit `sqlite3.Connection`
  - `db.py` — schema and connection helpers
- `templates/` — Jinja templates for the platform UI
- `static/` — platform CSS/JS and `sdk/gamebase.js`
- `templates_scaffold/blank/` — the starter game used by `scaffold_game`
- `registry/` — published games (each a folder with `game.yaml`)
- `tests/` — pytest suite

## Conventions

- Python is not on `PATH` on this host. Use `nix-shell` (see `shell.nix`) or
  `PYTHONPATH=src python3 -m pytest`.
- One definition of "game": `registry.py`. The web app, CLI, and scaffold all
  go through it. Do not duplicate manifest parsing.
- Keep SQL in `models.py`; keep `registry.py` free of database imports.
- Scores and achievements are validated server-side using manifest-declared
  limits and criteria. Never trust a client-submitted score blindly.
- The registry directory is configurable via `GAMEBASE_REGISTRY_DIR`. Tests
  build throwaway registries in `tmp_path`.

## Checks

```bash
cd active/web-apps/gamebase && PYTHONPATH=src python3 -m pytest -q
python scripts/check_all.py gamebase
```

Add or update tests whenever API behavior changes.
