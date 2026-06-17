"""Generate small browser-renderable previews for common file types.

We deliberately keep the previews tiny — just enough for the user to
confirm "yes, this is the right file." For large files we truncate
rather than fail.
"""

from __future__ import annotations

import csv
import io
import json

from . import MAX_PREVIEW_BYTES, MAX_PREVIEW_ROWS


# Type-classification helpers ----------------------------------------------------

_TEXTY_MIME_PREFIXES = ("text/",)
_TEXTY_EXTENSIONS = {
    ".txt", ".md", ".log", ".csv", ".tsv", ".json", ".xml", ".html", ".htm",
    ".yaml", ".yml", ".ini", ".cfg", ".conf", ".py", ".js", ".ts", ".css",
    ".sh", ".bash", ".zsh", ".sql", ".env", ".toml", ".rb", ".go", ".rs",
    ".java", ".c", ".h", ".cpp", ".hpp", ".swift", ".kt", ".dart",
}
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}


def is_csv(content_type: str, filename: str) -> bool:
    """True if the file is CSV or TSV based on its MIME type or filename."""
    return (
        content_type in ("text/csv", "application/csv", "application/vnd.ms-excel")
        or filename.lower().endswith((".csv", ".tsv"))
    )


def is_json(content_type: str, filename: str) -> bool:
    """True if the file is JSON based on its MIME type or filename."""
    return (
        content_type == "application/json"
        or filename.lower().endswith(".json")
    )


_TEXTY_MIME_EXACT = {
    "application/json",
    "application/xml",
    "application/x-yaml",
}


def is_texty(content_type: str, filename: str) -> bool:
    """True if the file is plain text / source code / markup we can render in a <pre>."""
    if any(content_type.startswith(p) for p in _TEXTY_MIME_PREFIXES):
        return True
    if content_type in _TEXTY_MIME_EXACT:
        return True
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in _TEXTY_EXTENSIONS)


def is_image(content_type: str, filename: str) -> bool:
    """True if the file is an image the browser can render directly."""
    if content_type.startswith("image/"):
        return True
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in _IMAGE_EXTENSIONS)


# Preview generators -------------------------------------------------------------


def preview_csv(data: bytes) -> dict:
    """Decode a CSV (or TSV) and return headers + first N rows as a JSON-safe dict."""
    # Sniff the dialect; fall back to comma. Skip bad lines rather than failing.
    sample = data[:8192].decode("utf-8", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        # pylint: disable=too-few-public-methods
        class _Dialect(csv.excel):
            """Fallback dialect used when csv.Sniffer can't guess."""
            delimiter = ","
        # pylint: enable=too-few-public-methods
        dialect = _Dialect()
    text = data[:MAX_PREVIEW_BYTES].decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text), dialect=dialect)
    try:
        header = next(reader)
    except StopIteration:
        return {"headers": [], "rows": [], "truncated": False, "total_rows": 0}

    rows: list[list[str]] = []
    total = 0
    for i, row in enumerate(reader):
        if i >= MAX_PREVIEW_ROWS:
            # Approximate the remaining row count from newlines.
            remaining = max(0, data.count(b"\n") - len(rows) - 1)
            return {
                "headers": header,
                "rows": rows,
                "truncated": True,
                "total_rows": len(rows) + remaining,
            }
        rows.append(row)
        total = i + 1

    return {
        "headers": header,
        "rows": rows,
        "truncated": False,
        "total_rows": total,
    }


def preview_json(data: bytes) -> dict:
    """Decode JSON and return a truncated, pretty-printed preview."""
    text = data[:MAX_PREVIEW_BYTES].decode("utf-8", errors="replace")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"Invalid JSON: {exc.msg} at line {exc.lineno}"}

    pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
    if len(pretty) > MAX_PREVIEW_BYTES:
        pretty = pretty[:MAX_PREVIEW_BYTES] + "\n…(truncated)"
    return {"ok": True, "preview": pretty, "parsed_type": type(parsed).__name__}


def preview_text(data: bytes) -> str:
    """Return a UTF-8 text preview, lossy-decoded if necessary."""
    if len(data) > MAX_PREVIEW_BYTES:
        data = data[:MAX_PREVIEW_BYTES] + b"\n...(truncated)"
    return data.decode("utf-8", errors="replace")


def preview_for(content_type: str, filename: str, data: bytes) -> dict:
    """Return a JSON-safe preview dict for any file.

    The shape is: {"kind": "csv"|"json"|"text"|"image"|"binary",
                   ...kind-specific-fields}
    """
    if is_csv(content_type, filename):
        result = preview_csv(data)
        result["kind"] = "csv"
        return result
    if is_json(content_type, filename):
        result = preview_json(data)
        result["kind"] = "json"
        return result
    if is_texty(content_type, filename):
        return {"kind": "text", "preview": preview_text(data)}
    if is_image(content_type, filename):
        # Images are previewed by the browser via the raw /files/<id> URL —
        # we don't base64 them, just return the kind so the UI knows.
        return {"kind": "image"}
    return {"kind": "binary", "size_bytes": len(data)}
