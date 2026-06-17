# drop

A tiny drag-and-drop file receiver for the homelab.

Open the page on your phone or laptop, drop or pick a file, and it
lands in `data/uploads/` on the server. CSV, JSON, and text files get
an instant in-browser preview; images render directly. No accounts, no
friction.

- **LAN access**: <http://haswell.lan:5111> (or whatever the host's LAN IP is — see "Finding the URL" below)
- **Local dev**: <http://localhost:5111>
- **Public URL**: **none by design.** This app is LAN-only. See [Security](#security) below for why and how to add a public URL safely.

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

- No login. The threat model is "trusted devices on my LAN," not "the
  open internet."
- No database. The whole index is a JSON file with atomic writes.
- No JavaScript build step. The frontend is ~200 lines of vanilla JS
  that any developer can read in 5 minutes.
- No Docker, no nginx, no certs. Flask's dev server is fine for a
  single-user app on a trusted LAN.

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
On this host the LAN IP is currently `192.168.1.168` (it can change —
check before you walk over to the phone).

## Security

This app is **intentionally unauthenticated** and **LAN-only by design**.
There is no `drop.shsw.dev` Cloudflare tunnel ingress rule, and the
launcher's `apps.yaml` deliberately omits the `subdomain` field. The
HTTP server binds to `0.0.0.0:5111` so any device on the local network
can reach it, but the public internet cannot.

### Threat model

**In scope** (this is what the app defends against):
- Path traversal via crafted file IDs (`storage.read_file_bytes` rejects
  anything that isn't a 32-char lowercase hex string).
- Per-file DoS via huge uploads (Flask's `MAX_CONTENT_LENGTH` rejects
  anything over `MAX_UPLOAD_MB`).
- Total-storage DoS (uploads are rejected once `MAX_TOTAL_STORAGE_MB`
  is reached).
- Concurrent index corruption (`_index_lock` + atomic write).
- Crash mid-write (the index is written via tmp + `os.replace`).

**Out of scope** (this is what LAN-only relies on):
- Authentication. The app trusts whoever can reach the port.
- Rate limiting. A misbehaving LAN client could fill the disk with
  small files faster than you can delete them.
- Audit log. There is no record of who uploaded what beyond the
  `added_at` timestamp.
- TLS. The HTTP server is plaintext. On a trusted Wi-Fi network this
  is fine; on a public / open network, a snooper can see the bytes.

### If you ever want to expose it publicly

Do **both** of these — neither alone is sufficient:

1. **Add a Cloudflare tunnel ingress rule** for `drop.shsw.dev` pointing
   at `http://127.0.0.1:5111`. The Cloudflare edge handles TLS.
2. **Put an auth layer in front of it.** The two reasonable options:
   - **Cloudflare Access** (recommended) — email-OTP, SSO, or device
     posturing via the Cloudflare Zero Trust dashboard. No app changes
     needed.
   - **A reverse proxy with basic auth** (e.g. Caddy or nginx) — simpler
     but less ergonomic on phones.

   Without step 2, the app becomes a free file-upload service for the
   entire internet, which fills the 5 GB quota with junk and
   potentially runs you out of disk faster than the periodic cleanup
   can keep up.

### On changing `HOST`

`HOST=0.0.0.0` is required for the LAN-only mode to work. If you ever
tighten the bind (e.g. to `192.168.1.168` to scope it to a single NIC),
the app will only be reachable from that IP. Don't switch it to
`127.0.0.1` unless you're sure you only need loopback access — the
launcher's own `127.0.0.1` health check would still work, but your
phone wouldn't be able to reach it without going through the tunnel.
