# OCR Arena

Web demo for the [`full-auto-de-pdf`](https://github.com/calvinloveland/megarepo/tree/main/active/dev-tools/full-auto-de-pdf) OCR → EPUB3 pipeline.

Pick a book from the bundled benchmark corpus, click **Run pipeline**, and watch the pipeline process the scan in real time. When it finishes, download the OCR text, the EPUB3, and the accuracy report.

- **Public demo**: <https://ocr.shsw.dev> (when deployed)
- **Local dev**: `http://localhost:5110`
- **Launcher's project page**: appears in the [Megarepo Launcher](https://shsw.dev) automatically

## Role in the Megarepo

`full-auto-de-pdf` is the underlying OCR/cleanup/EPUB toolkit (Python library + CLI). **OCR Arena** is the *demo frontend* for that toolkit — a small Flask app that exposes the pipeline through a browser so non-CLI users can:

- Browse the 8-book benchmark corpus
- Trigger the pipeline on a chosen book
- Watch per-stage progress (OCR → cleanup → metrics → EPUB)
- Download the OCR text, EPUB, and metrics JSON

The two projects are decoupled: the toolkit can be used standalone from the CLI, and the demo can be replaced or extended without touching the toolkit.

## How it works

1. The Flask backend reads the 8-book `benchmark-corpus-v3` manifest bundled with `full-auto-de-pdf`.
2. When the user picks a book, the backend spawns a background thread that runs the full pipeline:
   - **OCR** — Tesseract with the `scan` preprocess stack and `--predict-preprocess-mode`
   - **Cleanup** — per-page text corrections (operator-curated and language-model based)
   - **Metrics** — char + word accuracy against the bundled reference text
   - **EPUB** — packs the OCR'd text into a valid EPUB3 with chapter nav
3. Progress and logs are polled by the frontend every 700 ms.
4. When the run completes, three download links appear: OCR text, EPUB, and a JSON metrics report.

## Running locally

```bash
cd active/web-apps/ocr-arena
pip install -e ../full-auto-de-pdf  # install the library it wraps
pip install -e .
PORT=5110 python -m ocr_arena.app
```

Open <http://localhost:5110>.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `5110` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |

The benchmark corpus path is derived from the repo root (`active/dev-tools/full-auto-de-pdf/data/benchmark-corpus-v3/manifest.json`). If the manifest is missing, the book grid shows a message instead of failing the page.

## Files

```
active/web-apps/ocr-arena/
├── pyproject.toml           # Package metadata + entry point
├── README.md
├── docs/
│   └── index.md             # This file
├── src/ocr_arena/
│   ├── __init__.py
│   └── app.py               # Flask app + background runner
├── templates/
│   └── index.html           # Single-page UI
└── static/
    ├── app.css              # Dark monospace theme
    ├── app.js               # Book grid + run polling
    └── favicon.svg
```

## Adding to the Megarepo Launcher

The launcher auto-discovers every directory under `active/`, but to expose the app under a subdomain (e.g. `ocr.shsw.dev`) add an entry to `active/web-apps/launcher/apps.yaml`:

```yaml
- id: ocr-arena
  name: OCR Arena
  description: Pick a book, watch the full-auto-de-pdf pipeline OCR it
  icon: 📖
  subdomain: ocr
  path: ../ocr-arena
  type: flask
  port: 5110
  module: ocr_arena.app
  env:
    PORT: "5110"
```

Then add a Cloudflare Tunnel ingress rule for `ocr.shsw.dev` → `http://localhost:5110`.

## Deploying under `ocr.shsw.dev`

1. **Cloudflare Tunnel** — add an ingress rule to
   `~/.cloudflared/config.yml` (or your shared tunnel config):
   ```yaml
   - hostname: ocr.shsw.dev
     service: http://127.0.0.1:5110
   ```
   Reload the tunnel: `pkill -HUP -f cloudflared || (pkill cloudflared && nohup cloudflared tunnel --config ~/.cloudflared/config.yml run &)`.

2. **Public hostname** — in the Cloudflare Zero Trust dashboard
   (`Networks → Tunnels → <your tunnel> → Public Hostname`), add:
   - Subdomain: `ocr`
   - Domain: `shsw.dev`
   - Service: `http://localhost:5110`

   This is the step that actually creates the public DNS record; the
   tunnel config alone won't make `ocr.shsw.dev` resolve until the
   hostname is registered.

3. **Verify** — once the tunnel is running and the public hostname
   is in place, `curl https://ocr.shsw.dev/healthz` should return
   `{"books_loaded":8,"ok":true}`.
