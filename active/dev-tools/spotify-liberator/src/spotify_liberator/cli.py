"""Command-line entry point for spotify-liberator.

Subcommands:

  setup       Configure your Spotify client_id (and optional client_secret).
              Writes ~/.config/spotify-liberator/config.json.

  auth        Run the interactive OAuth flow. Usually called automatically on
              first export — only use this if you want to pre-warm the token.

  export      Export Liked Songs (and optionally playlists) to JSON/CSV/M3U.
              The default writes all three formats into ./exports/.

  status      Show what spotify-liberator knows about (config, token, expiry).

  logout      Delete the locally cached refresh_token.

Exit codes:
  0  success
  1  user / config error
  2  Spotify API error
  3  unexpected error
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

from . import (
    __version__,
    DEFAULT_CONFIG_DIR,
    DEFAULT_REDIRECT_URI,
)
from .api import (
    SpotifyAPIError,
    SpotifyClient,
    normalize_liked_track,
    normalize_playlist,
    normalize_playlist_track,
)
from .auth import (
    ClientConfig,
    default_config_path,
    default_token_path,
    do_authorization_flow,
    get_valid_token,
    load_config,
    load_token,
    save_config,
    save_token,
)
from .exporter import LikedSongsExport, PlaylistExport


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def _info(msg: str) -> None:
    print(f"\033[1;36m[*]\033[0m {msg}", file=sys.stderr)


def _ok(msg: str) -> None:
    print(f"\033[1;32m[+]\033[0m {msg}", file=sys.stderr)


def _warn(msg: str) -> None:
    print(f"\033[1;33m[!]\033[0m {msg}", file=sys.stderr)


def _err(msg: str) -> None:
    print(f"\033[1;31m[-]\033[0m {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_config(args: argparse.Namespace) -> ClientConfig:
    """Load the on-disk client config, or error out with guidance."""
    cfg_path = Path(args.config) if args.config else default_config_path()
    cfg = load_config(cfg_path)
    if cfg is None:
        _err(f"No config found at {cfg_path}.")
        _err("Run `spotify-liberator setup` first, or set SPOTIFY_CLIENT_ID.")
        sys.exit(1)
    return cfg


def _resolve_client_secret(args: argparse.Namespace) -> Optional[str]:
    """Client secret is optional (public-client PKCE flow doesn't need one)."""
    if args.client_secret:
        return args.client_secret
    return os.environ.get("SPOTIFY_CLIENT_SECRET")


def _refresh_via_token(token_path: Path, config: ClientConfig, client_secret: Optional[str]):
    """Return a callable that refreshes the access token, for use as `on_unauthorized`."""
    def _do() -> object:
        token = get_valid_token(config, client_secret=client_secret, token_path=token_path)
        return token
    return _do


def _make_client(
    config: ClientConfig,
    client_secret: Optional[str],
    token_path: Path,
) -> SpotifyClient:
    token = get_valid_token(config, client_secret=client_secret, token_path=token_path)
    client = SpotifyClient(
        token=token,
        on_unauthorized=lambda: get_valid_token(
            config, client_secret=client_secret, token_path=token_path,
        ),
    )
    return client


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_setup(args: argparse.Namespace) -> int:
    """Configure the Spotify client_id and optional client_secret."""
    cfg_path = Path(args.config) if args.config else default_config_path()

    client_id = args.client_id or os.environ.get("SPOTIFY_CLIENT_ID")
    if not client_id:
        _err("Missing --client-id (or SPOTIFY_CLIENT_ID env var).")
        _err("")
        _err("To get one:")
        _err("  1. Go to https://developer.spotify.com/dashboard")
        _err("  2. Create an app (any name, e.g. 'spotify-liberator')")
        _err("  3. In 'App settings', add this Redirect URI:")
        _err(f"       {args.redirect_uri}")
        _err("  4. Copy the Client ID (and Client Secret if you want a confidential client)")
        return 1

    scopes = [s.strip() for s in args.scopes.split(",") if s.strip()]
    cfg = ClientConfig(
        client_id=client_id,
        redirect_uri=args.redirect_uri,
        scopes=scopes,
    )
    save_config(cfg, cfg_path)
    _ok(f"Saved config to {cfg_path}")
    return 0


def cmd_auth(args: argparse.Namespace) -> int:
    """Run the interactive OAuth flow and cache a refresh token."""
    cfg = _resolve_config(args)
    client_secret = _resolve_client_secret(args)
    token_path = Path(args.token) if args.token else default_token_path()

    _info(f"Authorizing against redirect URI: {cfg.redirect_uri}")
    _info("A browser window will open. If it doesn't, copy the printed URL.")
    token = do_authorization_flow(cfg, client_secret=client_secret)
    save_token(token, token_path)
    _ok(f"Saved token to {token_path}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    """Export Liked Songs (and optionally playlists)."""
    cfg = _resolve_config(args)
    client_secret = _resolve_client_secret(args)
    token_path = Path(args.token) if args.token else default_token_path()

    output_dir = Path(args.output_dir).expanduser()
    formats = [f.lower() for f in args.formats.split(",") if f.strip()]
    if not formats:
        _err("No --formats specified.")
        return 1

    try:
        client = _make_client(cfg, client_secret, token_path)
    except Exception as exc:  # noqa: BLE001
        _err(f"Authorization failed: {exc}")
        return 1

    # ---- Liked Songs ------------------------------------------------------
    if args.liked:
        _info("Fetching current user profile...")
        user = client.get_current_user()
        _info(f"Hello, {user.get('display_name') or user.get('id')}")

        _info("Fetching Liked Songs (this can take a while for large libraries)...")
        liked_raw = list(client.iter_liked_songs())
        _info(f"Fetched {len(liked_raw)} liked tracks")
        liked_norm = [normalize_liked_track(e) for e in liked_raw]

        export = LikedSongsExport(user=user, tracks=liked_norm)
        written = export.write(
            output_dir=output_dir,
            base_name=args.liked_basename,
            formats=formats,
            m3u_with_metadata=not args.no_m3u_metadata,
        )
        for p in written:
            _ok(f"Wrote {p}")

    # ---- Playlists --------------------------------------------------------
    if args.playlists:
        _info("Fetching your playlists...")
        playlists_raw = list(client.iter_user_playlists())
        _info(f"Found {len(playlists_raw)} playlists")
        for pl in playlists_raw:
            pl_id = pl.get("id")
            pl_name = pl.get("name") or pl_id
            _info(f"  - {pl_name} ({pl_id})")
            norm_pl = normalize_playlist(pl)
            try:
                track_entries = list(client.iter_playlist_tracks(pl_id))
            except SpotifyAPIError as exc:
                _warn(f"    Skipped: {exc}")
                continue
            norm_tracks = [normalize_playlist_track(e) for e in track_entries]
            export = PlaylistExport(playlist=norm_pl, tracks=norm_tracks)
            written = export.write(
                output_dir=output_dir,
                formats=formats,
                m3u_with_metadata=not args.no_m3u_metadata,
            )
            for p in written:
                _ok(f"Wrote {p}")

    _ok("Export complete.")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Show current config and token status."""
    cfg_path = Path(args.config) if args.config else default_config_path()
    token_path = Path(args.token) if args.token else default_token_path()

    cfg = load_config(cfg_path)
    tok = load_token(token_path)

    print(f"Config path : {cfg_path}  ({'present' if cfg else 'missing'})")
    if cfg:
        print(f"  client_id  : {cfg.client_id}")
        print(f"  redirect   : {cfg.redirect_uri}")
        print(f"  scopes     : {', '.join(cfg.scopes)}")

    print(f"Token path  : {token_path}  ({'present' if tok else 'missing'})")
    if tok:
        from datetime import datetime, timezone
        expires_dt = datetime.fromtimestamp(tok.expires_at, tz=timezone.utc)
        remaining = int(tok.expires_at - __import__('time').time())
        status = "valid" if not tok.is_expired else "expired (will refresh on next export)"
        print(f"  status     : {status}")
        print(f"  expires    : {expires_dt.isoformat()} (in {remaining}s)")
        print(f"  scope      : {tok.scope or '(unknown)'}")
    return 0


def cmd_logout(args: argparse.Namespace) -> int:
    """Delete the locally cached refresh token."""
    token_path = Path(args.token) if args.token else default_token_path()
    if token_path.exists():
        token_path.unlink()
        _ok(f"Deleted {token_path}")
    else:
        _info("No token file to delete.")
    return 0


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="spotify-liberator",
        description="Export your Spotify Liked Songs and playlists to portable, open formats.",
        epilog="Your music, your data.",
    )
    parser.add_argument(
        "--version", action="version", version=f"spotify-liberator {__version__}",
    )
    parser.add_argument(
        "--config",
        help=f"Path to client config JSON (default: {DEFAULT_CONFIG_DIR}/config.json)",
    )
    parser.add_argument(
        "--token",
        help="Path to token cache JSON (default: ~/.config/spotify-liberator/token.json)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    # setup
    p_setup = sub.add_parser(
        "setup",
        help="Configure your Spotify app credentials (client_id, optional client_secret).",
    )
    p_setup.add_argument(
        "--client-id",
        help="Spotify app Client ID. Falls back to SPOTIFY_CLIENT_ID env var.",
    )
    p_setup.add_argument(
        "--redirect-uri",
        default=DEFAULT_REDIRECT_URI,
        help=f"OAuth redirect URI registered in your Spotify app (default: {DEFAULT_REDIRECT_URI})",
    )
    p_setup.add_argument(
        "--scopes",
        default="user-library-read,playlist-read-private,playlist-read-collaborative",
        help="Comma-separated OAuth scopes.",
    )
    p_setup.set_defaults(func=cmd_setup)

    # auth
    p_auth = sub.add_parser("auth", help="Run interactive OAuth flow and cache a token.")
    p_auth.add_argument(
        "--client-secret",
        help="Spotify app Client Secret (optional with PKCE). Falls back to SPOTIFY_CLIENT_SECRET.",
    )
    p_auth.set_defaults(func=cmd_auth)

    # export
    p_export = sub.add_parser("export", help="Export Liked Songs and/or playlists.")
    p_export.add_argument(
        "--output-dir", "-o",
        default="./exports",
        help="Output directory (default: ./exports)",
    )
    p_export.add_argument(
        "--formats",
        default="json,csv,m3u",
        help="Comma-separated formats: json, csv, m3u (default: json,csv,m3u)",
    )
    p_export.add_argument(
        "--liked", action="store_true", default=True,
        help="Export Liked Songs (default: on).",
    )
    p_export.add_argument(
        "--no-liked", dest="liked", action="store_false",
        help="Skip Liked Songs export.",
    )
    p_export.add_argument(
        "--liked-basename", default="liked_songs",
        help="Base filename for Liked Songs outputs (default: liked_songs)",
    )
    p_export.add_argument(
        "--playlists", action="store_true", default=False,
        help="Also export all of your playlists.",
    )
    p_export.add_argument(
        "--no-m3u-metadata", action="store_true", default=False,
        help="Omit #EXTINF metadata in M3U output (URIs only).",
    )
    p_export.add_argument(
        "--client-secret",
        help="Spotify app Client Secret. Falls back to SPOTIFY_CLIENT_SECRET.",
    )
    p_export.set_defaults(func=cmd_export)

    # status
    p_status = sub.add_parser("status", help="Show current config and token status.")
    p_status.set_defaults(func=cmd_status)

    # logout
    p_logout = sub.add_parser("logout", help="Delete the locally cached refresh token.")
    p_logout.set_defaults(func=cmd_logout)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args) or 0
    except KeyboardInterrupt:
        _err("Interrupted.")
        return 130
    except SpotifyAPIError as exc:
        _err(str(exc))
        return 2
    except Exception as exc:  # noqa: BLE001
        _err(f"Unexpected error: {exc}")
        if os.environ.get("SPOTIFY_LIBERATOR_DEBUG"):
            raise
        return 3


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
