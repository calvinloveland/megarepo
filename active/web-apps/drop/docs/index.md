# drop

A tiny drag-and-drop file receiver for the homelab.

Open the page on your phone or laptop, drop or pick a file, and it
lands in `data/uploads/` on the server. CSV, JSON, and text files get
an instant in-browser preview; images render directly. No accounts, no
friction.

- **Public demo**: <https://drop.shsw.dev> (when the Cloudflare tunnel is set up)
- **LAN access**: <http://haswell.lan:5111> (or whatever the host's LAN IP is — see "Finding the URL" below)
- **Local dev**: <http://localhost:5111>
- **Launcher's project page**: appears in the [Megarepo Launcher](https://shsw.dev) automatically

![drop UI](https://placehold.co/600x400/0f172a/38bdf8?text=📥+drop+UI)

## What it does

- **Drag-and-drop upload** with tap-to-select fallback (the file input is
  inside the dropzone `<label>`, so iOS Safari and Android Chrome both
  trigger the native file picker).
- **Multiple files per drop** — upload one or twenty in a single gesture.
- **Per-file progress bar** powered by `XMLHttpRequest.upload.onprogress`
  (the Fetch API doesn't expose upload progress).
- **In-browser previews** for:
  - **CSV / TSV** — pretty-printed table with sticky headers, auto-detects
    the delimiter via `csv.Sniffer`, shows the first 50 rows with a
    "and N more" hint when truncated.
  - **JSON** — pretty-printed, with a clear error if the file is invalid.
  - **Text / code** — shown in a monospace box.
  - **Images** — rendered directly via the raw `/files/<id>` URL.
  - **Anything else** — falls back to a "Binary file — no preview" message
    with a download link.
- **Persistent storage** — files survive page reload and app restarts.
- **List view** with file size, age ("3h ago"), and per-file actions
  (preview / download / delete).
- **Storage cap** (default 5 GB total, 100 MB per file) to keep a runaway
  upload from filling the disk. Override via env vars in `apps.yaml`.

## Why it exists

Most "upload files to my server" tools are heavyweight (Nextcloud, Seafile,
Syncthing). For a single user with a homelab, that's overkill. This is
the minimal thing that works:

- No login. The threat model is "trusted devices on my LAN / my own
  Cloudflare tunnel," not "the open internet."
- No database. The whole index is a JSON file with atomic writes.
- No JavaScript build step. The frontend is ~200 lines of vanilla JS
  that any developer can read in 5 minutes.
- No Docker, no nginx, no certs. Flask's dev server is fine for a
  single-user app, and the existing Cloudflare tunnel handles HTTPS.

## Architecture

```
┌────────────────────────────────────────┐
│  Browser (phone, laptop, etc.)         │
│  - Drag/drop or tap-to-select          │
│  - Posts to /api/files (multipart)     │
│  - Polls /api/files every 5s           │
│  - Renders previews from JSON          │
└──────────────┬─────────────────────────┘
               │ HTTP
               ▼
┌────────────────────────────────────────┐
│  drop.app (Flask, port 5111)           │
│  - /          → static SPA             │
│  - /api/*     → JSON API               │
│  - /files/*   → raw bytes (download)   │
│                                        │
│  storage.py:                           │
│    - data/index.json (atomic write)    │
│    - data/uploads/<uuid-hex>           │
│                                        │
│  preview.py:                           │
│    - CSV: csv.Sniffer + 50-row cap     │
│    - JSON: json.dumps(..., indent=2)   │
│    - text: utf-8 decode with replace   │
└────────────────────────────────────────┘
```

## Running locally

```bash
cd active/web-apps/drop
python -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python -m drop
```

Open <http://localhost:5111>.

## Running via the Launcher

The app is registered in `active/web-apps/launcher/apps.yaml` under the id
`drop`, with the subdomain `drop` and port `5111`. The launcher starts it
on demand and the watchdog restarts it if the port goes down.

```bash
# Start
curl -X POST http://localhost:3001/api/start/drop

# Stop
curl -X POST http://localhost:3001/api/stop/drop

# Status
curl http://localhost:3001/api/status/drop

# Logs
tail -f /home/calvin/megarepo/active/web-apps/launcher/logs/drop.log
```

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `5111` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address. `0.0.0.0` is required so phones on the LAN can reach the app. The Cloudflare tunnel still works because the tunnel talks to the loopback port. |
| `FLASK_DEBUG` | `false` | Enable Flask debug mode |

| Constant | Default | Where |
|----------|---------|-------|
| `MAX_UPLOAD_MB` | 100 | per-file upload cap |
| `MAX_TOTAL_STORAGE_MB` | 5120 (5 GB) | total storage cap |
| `MAX_PREVIEW_BYTES` | 256 KB | how much of a file to feed the previewer |
| `MAX_PREVIEW_ROWS` | 50 | CSV rows shown in the preview table |

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/status` | Server version, storage usage, file count |
| `GET` | `/api/files` | List all stored files (newest first) |
| `POST` | `/api/files` | Upload one or more files (multipart, field name `file`) |
| `GET` | `/api/files/<id>` | Get one file's metadata |
| `GET` | `/api/files/<id>/preview` | Get a small preview (CSV/JSON/text/binary) |
| `DELETE` | `/api/files/<id>` | Delete a file and its bytes |
| `GET` | `/files/<id>` | Raw bytes (used for image previews) |
| `GET` | `/files/<id>/download` | Raw bytes with `Content-Disposition: attachment` |

All `/api/*` endpoints return JSON of the shape `{"ok": true, ...}` or
`{"ok": false, "error": "..."}`. Non-API 404s return plain text.

## Finding the URL from your phone

If you're on the same Wi-Fi as the host, the URL is:

```
http://<host-lan-ip>:5111
```

Find the LAN IP with `hostname -I` or `ip -4 addr show | grep inet`.
For a Cloudflare-tunneled public URL, set up the `drop` subdomain in the
tunnel config (see `active/web-apps/launcher/SHSW_DEV_DEPLOYMENT.md`).

## Security notes

This app is intentionally unauthenticated. Do not expose it to the
public internet without putting something in front of it:

- A Cloudflare tunnel with an Access policy is the easiest option.
- A reverse proxy with basic auth is the second-easiest.
- If you must expose it directly, the worst-case blast radius is
  "someone fills your 5 GB quota with junk." Files are not executable
  and the upload path is sandboxed by Flask's `MAX_CONTENT_LENGTH`.

The path-traversal guard in `storage.read_file_bytes` rejects any file
ID that isn't a 32-char lowercase hex string, so a malicious client
can't `GET /files/../../etc/passwd`.
