# drop

A tiny drag-and-drop file receiver for the homelab.

Open the page on your phone or laptop, drop or pick a file, and it
lands in `data/uploads/` on the server. CSV, JSON, and text files get
an instant in-browser preview; images render directly. No accounts, no
friction.

**LAN-only by design** — there is no public URL. See
[`docs/index.md#security`](docs/index.md#security) for why and how to
add a public URL safely.

- **LAN access**: <http://<host-lan-ip>:5111>
- **Local dev**: <http://localhost:5111>
- **Launcher's project page**: appears in the [Megarepo Launcher](https://shsw.dev) automatically

## Documentation

Canonical documentation lives at:
- [Web docs](https://calvinloveland.github.io/megarepo/projects/active/web-apps/drop/)
- Local source: [`docs/index.md`](docs/index.md)

## Quick start

```bash
cd active/web-apps/drop
python -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python -m drop
```

Open <http://localhost:5111> and drop a file.

## Tests

```bash
.venv/bin/pytest tests/
```

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `5111` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (0.0.0.0 so phones on the LAN can reach it) |
| `FLASK_DEBUG` | `false` | Enable Flask debug mode |
