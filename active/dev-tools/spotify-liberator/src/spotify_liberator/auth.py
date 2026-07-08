"""OAuth 2.0 Authorization Code flow with PKCE for Spotify Web API.

Implements the public-client PKCE flow so users don't need a client secret.
The flow is:

  1. Generate a code_verifier (random 43-128 char string) and code_challenge (SHA-256).
  2. Open the user's browser to the Spotify authorize URL.
  3. Spotify redirects to our local callback HTTP server with a `code`.
  4. Exchange the code (+ verifier) for access_token + refresh_token.
  5. Persist the refresh_token to disk so subsequent runs are headless.

We never persist or print the access_token — we always refresh from the
refresh_token, which is long-lived (Spotify doesn't expire it by default).

Reference: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import json
import os
import secrets
import socketserver
import threading
import time
import urllib.parse
import webbrowser
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import requests

from . import (
    DEFAULT_CALLBACK_HOST,
    DEFAULT_CALLBACK_PORT,
    DEFAULT_REDIRECT_URI,
    SPOTIFY_AUTH_URL,
    SPOTIFY_TOKEN_URL,
)


# ---------------------------------------------------------------------------
# PKCE primitives
# ---------------------------------------------------------------------------


def _b64url_nopad(data: bytes) -> str:
    """Base64url-encode `data` and strip padding (RFC 7636 §4.2)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _write_secret_atomic(path: Path, text: str) -> None:
    """Write `text` to `path` atomically with 0600 perms.

    Creates the file mode 0600 from the start (no chmod-after-write window),
    writes to a temp sibling, then atomically renames over the target so a
    crash mid-write can't corrupt an existing file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # tempfile creates with 0600 by default on POSIX; pass dir= so the rename
    # stays on the same filesystem (atomic on POSIX).
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def make_code_verifier() -> str:
    """Generate a 43-char unreserved-character code_verifier (RFC 7636 §4.1).

    32 bytes of entropy encode to 43 base64url chars (no padding), which is
    the minimum allowed length of 43-128.
    """
    return _b64url_nopad(secrets.token_bytes(32))


def make_code_challenge(verifier: str) -> str:
    """S256 challenge: base64url(sha256(verifier))."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return _b64url_nopad(digest)


# ---------------------------------------------------------------------------
# Callback server
# ---------------------------------------------------------------------------


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    """Single-shot HTTP handler that captures ?code=... or ?error=... and shuts down."""

    # Set by _CallbackState on the server before serve_forever().
    state: "_CallbackState"  # type: ignore[assignment]

    def do_GET(self) -> None:  # noqa: N802 (HTTP verb name)
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_error(404, "Not Found")
            return

        params = urllib.parse.parse_qs(parsed.query)
        self.state.received_params = params
        self.state.received_event.set()

        # Render a tiny success/failure page so the user knows we're done.
        if "error" in params:
            body = self._render_error_page(params["error"][0])
        else:
            body = self._render_success_page()

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # Silence the default stderr access log; we don't want to spam the user.
        return

    @staticmethod
    def _render_success_page() -> bytes:
        return (
            b"<!doctype html><html><body style='font-family:system-ui;"
            b"text-align:center;padding:48px;'>"
            b"<h1 style='color:#1DB954;'>&#10003; Authorized</h1>"
            b"<p>You can close this tab and return to your terminal.</p>"
            b"</body></html>"
        )

    @staticmethod
    def _render_error_page(error: str) -> bytes:
        msg = error.encode("utf-8")
        return (
            b"<!doctype html><html><body style='font-family:system-ui;"
            b"text-align:center;padding:48px;'>"
            b"<h1 style='color:#e22134;'>&#10007; Authorization failed</h1>"
            b"<p>Error: " + msg + b"</p>"
            b"<p>Close this tab and check the terminal output.</p>"
            b"</body></html>"
        )


class _CallbackState:
    """Shared state between the HTTP server thread and the main thread."""

    def __init__(self) -> None:
        self.received_params: dict[str, list[str]] = {}
        self.received_event = threading.Event()


def wait_for_callback(
    host: str = DEFAULT_CALLBACK_HOST,
    port: int = DEFAULT_CALLBACK_PORT,
    timeout: float = 180.0,
    open_browser: Optional[Callable[[str], None]] = webbrowser.open,
) -> dict[str, list[str]]:
    """Spin up a local HTTP server, open the browser to `authorize_url` (caller-supplied),
    and return the parsed query params from the redirect.

    The caller is responsible for constructing `authorize_url` and passing it in via
    `open_browser` — keeping this function focused on the server lifecycle.

    Raises TimeoutError if no callback arrives within `timeout` seconds.
    """
    state = _CallbackState()
    _CallbackHandler.state = state  # type: ignore[assignment]

    class _Server(socketserver.TCPServer):
        allow_reuse_address = True

    try:
        httpd = _Server((host, port), _CallbackHandler)
    except OSError as exc:
        raise RuntimeError(
            f"Could not bind local callback server to {host}:{port}: {exc}. "
            "If another instance is running, close it or set --port to a free port."
        ) from exc

    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    try:
        if not state.received_event.wait(timeout=timeout):
            raise TimeoutError(
                f"No callback received within {timeout:.0f}s. "
                "Did you complete the authorization in your browser?"
            )
        return dict(state.received_params)
    finally:
        httpd.shutdown()
        httpd.server_close()


# ---------------------------------------------------------------------------
# High-level flow
# ---------------------------------------------------------------------------


@dataclass
class TokenSet:
    """In-memory representation of a Spotify token bundle."""

    access_token: str
    refresh_token: Optional[str]
    expires_at: float  # epoch seconds
    scope: str = ""
    token_type: str = "Bearer"

    @property
    def is_expired(self) -> bool:
        # Treat as expired 60s early to avoid races.
        return time.time() >= self.expires_at - 60

    def to_dict(self) -> dict:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "scope": self.scope,
            "token_type": self.token_type,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TokenSet":
        return cls(
            access_token=d["access_token"],
            refresh_token=d.get("refresh_token"),
            expires_at=float(d["expires_at"]),
            scope=d.get("scope", ""),
            token_type=d.get("token_type", "Bearer"),
        )


@dataclass
class ClientConfig:
    """Persistent app-level configuration (client_id + redirect URI)."""

    client_id: str
    redirect_uri: str = DEFAULT_REDIRECT_URI
    scopes: list[str] = field(default_factory=lambda: [
        "user-library-read",
        "playlist-read-private",
        "playlist-read-collaborative",
    ])

    def to_dict(self) -> dict:
        return {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scopes": self.scopes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ClientConfig":
        return cls(
            client_id=d["client_id"],
            redirect_uri=d.get("redirect_uri", DEFAULT_REDIRECT_URI),
            scopes=d.get("scopes", [
                "user-library-read",
                "playlist-read-private",
                "playlist-read-collaborative",
            ]),
        )


# ---------------------------------------------------------------------------
# Authorization URL construction
# ---------------------------------------------------------------------------


def build_authorize_url(
    client_id: str,
    redirect_uri: str,
    scopes: list[str],
    code_challenge: str,
    state: str,
) -> str:
    """Construct the user-facing authorize URL."""
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "code_challenge_method": "S256",
        "code_challenge": code_challenge,
        "scope": " ".join(scopes),
        "state": state,
    }
    return f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"


# ---------------------------------------------------------------------------
# Token exchange
# ---------------------------------------------------------------------------


def exchange_code_for_token(
    code: str,
    code_verifier: str,
    client_id: str,
    redirect_uri: str,
    client_secret: Optional[str] = None,
    timeout: float = 30.0,
) -> TokenSet:
    """Exchange an authorization code for an access + refresh token.

    If `client_secret` is None, we use the public-client PKCE flow
    (Spotify still requires a registered app, just no secret).
    """
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": code_verifier,
    }
    auth = (client_id, client_secret) if client_secret else None

    resp = requests.post(SPOTIFY_TOKEN_URL, data=data, auth=auth, timeout=timeout)
    resp.raise_for_status()
    return _token_from_response(resp.json())


def refresh_access_token(
    refresh_token: str,
    client_id: str,
    client_secret: Optional[str] = None,
    timeout: float = 30.0,
) -> TokenSet:
    """Refresh an access token using a stored refresh_token.

    Spotify rotates the refresh_token on some flows; we keep whatever comes back.
    """
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    auth = (client_id, client_secret) if client_secret else None

    resp = requests.post(SPOTIFY_TOKEN_URL, data=data, auth=auth, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    # Refresh responses don't always include a new refresh_token — keep the old one.
    if "refresh_token" not in payload:
        payload["refresh_token"] = refresh_token
    return _token_from_response(payload)


def _token_from_response(payload: dict) -> TokenSet:
    expires_in = int(payload.get("expires_in", 3600))
    return TokenSet(
        access_token=payload["access_token"],
        refresh_token=payload.get("refresh_token"),
        expires_at=time.time() + expires_in,
        scope=payload.get("scope", ""),
        token_type=payload.get("token_type", "Bearer"),
    )


# ---------------------------------------------------------------------------
# High-level driver: do the full interactive flow
# ---------------------------------------------------------------------------


def do_authorization_flow(
    config: ClientConfig,
    client_secret: Optional[str] = None,
    callback_timeout: float = 180.0,
    open_browser: Optional[Callable[[str], None]] = None,
) -> TokenSet:
    """Run the full PKCE auth flow end-to-end.

    1. Generate verifier + challenge + state.
    2. Spin up local callback server.
    3. Open browser (or print URL if headless).
    4. Exchange code for tokens.
    5. Return the resulting TokenSet.
    """
    verifier = make_code_verifier()
    challenge = make_code_challenge(verifier)
    # `state` is required by Spotify even though we use a single-shot server.
    state_token = secrets.token_urlsafe(16)

    authorize_url = build_authorize_url(
        client_id=config.client_id,
        redirect_uri=config.redirect_uri,
        scopes=config.scopes,
        code_challenge=challenge,
        state=state_token,
    )

    # Parse host/port from redirect_uri for the local server.
    parsed = urllib.parse.urlparse(config.redirect_uri)
    host = parsed.hostname or DEFAULT_CALLBACK_HOST
    port = parsed.port or DEFAULT_CALLBACK_PORT

    opener = open_browser or webbrowser.open
    opened = False
    if opener is not None:
        try:
            opened = bool(opener(authorize_url))
        except Exception:  # noqa: BLE001
            opened = False

    if not opened:
        # Headless fallback — print the URL so the user can click/copy it.
        print(
            "Open this URL in a browser to authorize spotify-liberator:\n"
            f"  {authorize_url}"
        )

    params = wait_for_callback(host=host, port=port, timeout=callback_timeout)

    if "error" in params:
        raise RuntimeError(f"Spotify returned error: {params['error'][0]}")

    if params.get("state", [None])[0] != state_token:
        raise RuntimeError("State mismatch — possible CSRF, refusing to continue.")

    code = params.get("code", [None])[0]
    if not code:
        raise RuntimeError("No authorization code in callback response.")

    return exchange_code_for_token(
        code=code,
        code_verifier=verifier,
        client_id=config.client_id,
        redirect_uri=config.redirect_uri,
        client_secret=client_secret,
    )


# ---------------------------------------------------------------------------
# Disk persistence
# ---------------------------------------------------------------------------


def default_token_path() -> Path:
    """Return the default on-disk token file path (XDG-style)."""
    return Path(os.path.expanduser("~/.config/spotify-liberator")) / "token.json"


def default_config_path() -> Path:
    """Return the default on-disk client config path."""
    return Path(os.path.expanduser("~/.config/spotify-liberator")) / "config.json"


def save_token(token: TokenSet, path: Optional[Path] = None) -> Path:
    """Persist a token set to disk with 0600 perms, atomically.

    The file is created with mode 0600 from the outset (not chmod'd after a
    world-readable write) so the refresh token is never briefly readable by
    other users. The write is atomic (temp file + rename) so an interruption
    can't leave a half-written, corrupt token file.
    """
    p = path or default_token_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    _write_secret_atomic(p, json.dumps(token.to_dict(), indent=2))
    return p


def load_token(path: Optional[Path] = None) -> Optional[TokenSet]:
    """Load a token from disk, or return None if not present / invalid."""
    p = path or default_token_path()
    if not p.exists():
        return None
    try:
        return TokenSet.from_dict(json.loads(p.read_text()))
    except (json.JSONDecodeError, KeyError, ValueError):
        return None


def save_config(config: ClientConfig, path: Optional[Path] = None) -> Path:
    p = path or default_config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    _write_secret_atomic(p, json.dumps(config.to_dict(), indent=2))
    return p


def load_config(path: Optional[Path] = None) -> Optional[ClientConfig]:
    p = path or default_config_path()
    if not p.exists():
        return None
    try:
        return ClientConfig.from_dict(json.loads(p.read_text()))
    except (json.JSONDecodeError, KeyError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Token resolution (cached → refreshed → new flow)
# ---------------------------------------------------------------------------


def get_valid_token(
    config: ClientConfig,
    client_secret: Optional[str] = None,
    token_path: Optional[Path] = None,
) -> TokenSet:
    """Return a valid (non-expired) TokenSet, refreshing or re-authing as needed."""
    cached = load_token(token_path)
    if cached and cached.refresh_token:
        if not cached.is_expired:
            return cached
        # Try to refresh.
        try:
            refreshed = refresh_access_token(
                refresh_token=cached.refresh_token,
                client_id=config.client_id,
                client_secret=client_secret,
            )
            save_token(refreshed, token_path)
            return refreshed
        except requests.RequestException as exc:
            # Refresh failed (revoked, expired, network error, etc.) — fall
            # through to full flow rather than crashing.
            print(f"Refresh failed ({exc}); re-running interactive authorization.")

    # No cached token, or refresh failed — do the full PKCE flow.
    fresh = do_authorization_flow(config, client_secret=client_secret)
    save_token(fresh, token_path)
    return fresh
