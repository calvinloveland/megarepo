# AGENTS.md — drop

A tiny drag-and-drop file receiver that runs on the homelab and is
reachable from any device on the LAN or via the shsw.dev Cloudflare tunnel.

## Start here

- Read [`README.md`](README.md) and [`docs/index.md`](docs/index.md) for the
  high-level tour and the `drop.shsw.dev` deploy steps.

## Role in the megarepo

- **No dependencies** beyond Flask — there is no database, no auth, no
  background workers. The whole app is a single Flask process plus a
  JSON index file on disk.
- **Bound to 0.0.0.0** (not 127.0.0.1) so phones on the LAN can reach it
  without going through the tunnel. The Cloudflare tunnel still works
  because the tunnel talks to the loopback port.
- **Manages itself**: the launcher's watchdog will restart the app if the
  port stops accepting connections, because the app ships a `.venv/bin/python3`.

## Conventions

- **Linter**: `pylint --rcfile=pyproject.toml src/drop/`
- **Tests**: `.venv/bin/pytest tests/` — 73 tests covering storage, preview
  classification, CSV/JSON/text/binary previews, and Flask endpoints.
- **Storage layout** (created automatically on first run):
  - `data/index.json` — atomic-write JSON list of file metadata
  - `data/uploads/<32-char-hex>` — the raw bytes; the ID is a UUID4 hex
- **Path constants** are defined once in `drop/__init__.py` and re-imported
  in `storage.py` and `app.py`. Tests override them via
  `tests/conftest.py::tmp_data_dir` (which uses `monkeypatch.setattr` on
  every module that captured a `from . import ...` reference).
- **No build step** for the frontend — vanilla JS in `static/app.js`,
  vanilla CSS in `static/app.css`, Jinja2 template in
  `templates/index.html`.

## Where to extend

- **New preview kind** (e.g. PDF, audio waveform): add a `is_X()` +
  `preview_X()` pair in `preview.py`, then add a case in `preview_for()`
  and a matching case in `app.js::renderPreview`.
- **New endpoint**: add a route inside `create_app()` in `app.py`. The
  app factory pattern makes per-test app customization easy.
- **Larger uploads**: bump `MAX_UPLOAD_MB` in `__init__.py`. The
  `MAX_CONTENT_LENGTH` config is set from that constant in `create_app()`.
- **Per-user storage**: swap the `data/index.json` for SQLite — the
  `storage.py` interface (`add_file`, `list_files`, `get_file`,
  `delete_file`, `read_file_bytes`) is small enough to reimplement
  without breaking callers.

## Touch points if dependencies change

- `Flask` ≥ 3.0 is required for the new `app.json` behavior and the
  `MAX_CONTENT_LENGTH` config key. If Flask is downgraded, update
  `create_app()` to use the older `app.config['MAX_CONTENT_LENGTH']`
  access pattern.
- The `xml.etree.ElementTree`-free CSV sniffer in `preview.py` uses
  `csv.Sniffer` from the stdlib — no third-party dependency.
