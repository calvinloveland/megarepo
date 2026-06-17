"""drop — a tiny drag-and-drop file receiver.

Designed to be reached from any device on the local network (or via the
shsw.dev Cloudflare tunnel). Users open the page, drop or pick a file,
and the file lands in `data/uploads/` on the server with a metadata
index. CSV/JSON/text files get a quick preview in the browser.
"""

from __future__ import annotations

from pathlib import Path

__version__ = "0.1.0"

# Project paths are computed at import time so storage.py and app.py
# both see the same canonical locations.
_APP_DIR = Path(__file__).resolve().parent           # src/drop/
PROJECT_ROOT = _APP_DIR.parent.parent                # active/web-apps/drop
DATA_DIR = PROJECT_ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
INDEX_FILE = DATA_DIR / "index.json"

# Configurable limits.
MAX_UPLOAD_MB = 100                  # per-file upload cap
MAX_PREVIEW_BYTES = 256 * 1024       # how much of a file to send back for preview
MAX_PREVIEW_ROWS = 50                # rows to show for CSV previews
MAX_TOTAL_STORAGE_MB = 5 * 1024      # total storage cap across all uploads
