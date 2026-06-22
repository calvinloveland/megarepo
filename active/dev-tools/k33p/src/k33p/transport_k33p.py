"""k33p:// transport — serve and fetch objects over HTTP.

The k33p peer-to-peer transport allows hosts to share store objects
over HTTP.  A daemon or ``k33p serve`` process listens on a port and
answers ``GET /<hash>`` requests, returning stored objects.  Clients
use ``k33p://host:port/<hash>`` URLs to fetch objects from peers.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from k33p.store import ContentStore
from k33p.transport import Transport, TransportError


# ── HTTP server ──────────────────────────────────────────────────────────


def serve_store(
    store_path: str | Path,
    host: str = "127.0.0.1",
    port: int = 8734,
) -> None:
    """Start an HTTP server that serves store objects.

    Serves on ``http://<host>:<port>/<hash>`` — returns the object
    as a JSON response with hash, kind, size, and base64-encoded content.

    Args:
        store_path: Path to the store directory.
        host: Host to bind to (default: 127.0.0.1).
        port: Port to listen on (default: 8734).
    """
    import base64
    from http.server import HTTPServer, BaseHTTPRequestHandler

    store = ContentStore(Path(store_path))

    class StoreHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = self.path.lstrip("/")
            if not path or len(path) != 64 or not all(c in "0123456789abcdef" for c in path.lower()):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"invalid hash")
                return

            data = store.get(path)
            if data is None:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"not found")
                return

            kind = store.get_kind(path) or "blob"
            response = json.dumps({
                "hash": path,
                "kind": kind,
                "size": len(data),
                "content": base64.b64encode(data).decode(),
            }).encode()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: N802
            print(f"  k33p serve: {args[0]} {args[1]} {args[2]}")

    server = HTTPServer((host, port), StoreHandler)
    print(f"k33p serve: listening on http://{host}:{port}")
    print(f"  store: {store_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nk33p serve: shutting down")
        server.server_close()


# ── HTTP client transport ────────────────────────────────────────────────


class K33pTransport(Transport):
    """Transport that fetches objects from a remote k33p peer via HTTP.

    Supports ``k33p://host:port`` URLs.  Objects are fetched via
    ``GET /<hash>`` and cached in the local store.
    """

    @classmethod
    def supports(cls, source: str) -> bool:
        return source.lower().startswith("k33p://")

    def _parse_url(self) -> tuple[str, int]:
        """Parse source into ``(host, port)``.

        Defaults to port 8734 if not specified.
        """
        url = self.source
        if url.lower().startswith("k33p://"):
            url = url[7:]  # strip k33p://
        # Remove trailing path/slash
        url = url.rstrip("/")
        if ":" in url:
            host, port_str = url.split(":", 1)
            try:
                port = int(port_str)
            except ValueError:
                port = 8734
        else:
            host = url
            port = 8734
        return host, port

    def fetch(self, store: ContentStore) -> int:
        """Fetch all available objects from a k33p peer.

        For the MVP, this requires knowing which hashes to fetch.
        With no remote listing API yet, we only fetch specific objects
        on demand.  This transport is primarily used by ``k33p get``.
        """
        # In the MVP, fetch is a no-op for listing.
        # Individual objects are fetched via get().
        return 0

    def get_object(
        self, store: ContentStore, hash_str: str,
    ) -> bytes | None:
        """Fetch a single object by hash from the remote peer.

        Returns the raw content, or None if not found.
        """
        import base64

        host, port = self._parse_url()
        url = f"http://{host}:{port}/{hash_str}"

        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                content_b64 = data.get("content", "")
                kind = data.get("kind", "blob")
                content = base64.b64decode(content_b64)
                # Store in local cache
                store.put(content, kind=kind)
                return content
        except (urllib.error.URLError, json.JSONDecodeError, KeyError) as e:
            raise TransportError(f"failed to fetch {hash_str} from {url}: {e}") from e
