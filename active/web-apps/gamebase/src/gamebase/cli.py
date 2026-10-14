"""Command-line tools for creating, pushing, and pulling Gamebase games.

    gamebase serve                 # run the platform
    gamebase list                  # list games in the local registry
    gamebase new <slug> --title …  # scaffold a playable game
    gamebase publish <slug>        # sync + record a version from local disk
    gamebase push ./my-game        # publish a local folder to a running server
    gamebase pull <slug>           # download a game's manifest + files

The CLI reuses the same registry code as the web app, so there is exactly one
definition of what a game is.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from . import models, registry
from .config import Settings
from .db import connect, init_db

DEFAULT_SERVER = "http://localhost:5121"


def _serve(args: argparse.Namespace) -> int:
    from .app import create_app

    app = create_app()
    port = args.port or int(os.environ.get("PORT", "5120"))
    app.run(host=args.host, port=port, debug=args.debug)
    return 0


def _list(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    games = registry.scan_games(settings.registry_dir)
    if not games:
        print(f"No games found in {settings.registry_dir}")
        return 0
    for manifest in games.values():
        print(f"{manifest.slug:24s} v{manifest.version:8s} {manifest.title}")
    return 0


def _new(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    try:
        manifest = registry.scaffold_game(
            settings.registry_dir,
            args.slug,
            title=args.title or args.slug.replace("-", " ").title(),
            author=args.author or "",
            description=args.description or "",
            template_dir=settings.project_root / "templates_scaffold",
        )
    except registry.ManifestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    connection = connect(settings.database_path)
    init_db(connection)
    models.sync_registry(connection, settings.registry_dir)
    print(f"Created {manifest.slug} at {manifest.path}")
    return 0


def _publish(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    try:
        manifest = registry.read_manifest(settings.registry_dir / args.slug)
    except registry.ManifestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    connection = connect(settings.database_path)
    init_db(connection)
    models.sync_registry(connection, settings.registry_dir)
    models.record_version(connection, manifest, args.changelog or "Update")
    print(f"Published {manifest.slug} v{manifest.version}")
    return 0


# ── Remote push/pull ────────────────────────────────────────────────────────


def _server_url(args: argparse.Namespace) -> str:
    return (args.url or os.environ.get("GAMEBASE_URL") or DEFAULT_SERVER).rstrip("/")


def _http_json(url: str, method: str, payload: dict | None, token: str | None) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body or b"{}")
        except json.JSONDecodeError:
            return error.code, {"error": body.decode("utf-8", "replace")}


def _resolve_token(server: str, explicit: str | None) -> str:
    token = explicit or os.environ.get("GAMEBASE_TOKEN")
    if token:
        return token
    status, payload = _http_json(f"{server}/api/identity", "POST", {}, None)
    if status >= 400 or "token" not in payload:
        raise RuntimeError(payload.get("error", "could not obtain an identity token"))
    return payload["token"]


def _collect_files(directory: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Split a game folder into text files and base64-encoded binary assets."""
    text: dict[str, str] = {}
    binary: dict[str, str] = {}
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(directory)
        if any(part in registry.IGNORED_DIRS for part in relative.parts):
            continue
        if path.name == registry.MANIFEST_NAME:
            continue
        suffix = path.suffix.lower()
        if suffix in registry.TEXT_EXTENSIONS:
            text[relative.as_posix()] = path.read_text(encoding="utf-8")
        elif suffix in registry.BINARY_EXTENSIONS:
            binary[relative.as_posix()] = base64.b64encode(path.read_bytes()).decode("ascii")
    return text, binary


def _push(args: argparse.Namespace) -> int:
    directory = Path(args.directory).resolve()
    try:
        manifest = registry.read_manifest(directory)
        files, binary = _collect_files(directory)
    except (registry.ManifestError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    server = _server_url(args)
    try:
        token = _resolve_token(server, args.token)
    except (RuntimeError, urllib.error.URLError) as error:
        print(f"error: cannot reach {server}: {error}", file=sys.stderr)
        return 1

    status, payload = _http_json(
        f"{server}/api/games",
        "POST",
        {
            "manifest": manifest.to_dict(),
            "files": files,
            "binary": binary,
            "changelog": args.changelog or "Push",
        },
        token,
    )
    if status >= 400:
        print(f"error: {payload.get('error', 'push failed')}", file=sys.stderr)
        return 1
    action = "Updated" if status == 200 else "Created"
    assets = f" ({len(binary)} binary)" if binary else ""
    print(f"{action} {payload['slug']} v{payload['version']} on {server}{assets}")
    return 0


def _pull(args: argparse.Namespace) -> int:
    server = _server_url(args)
    token = args.token or os.environ.get("GAMEBASE_TOKEN")
    status, payload = _http_json(f"{server}/api/games/{args.slug}/files", "GET", None, token)
    if status >= 400:
        print(f"error: {payload.get('error', 'pull failed')}", file=sys.stderr)
        return 1

    output = Path(args.out or args.slug).resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = registry.manifest_from_dict(payload["manifest"])
    registry.write_manifest(output, manifest)
    for relative, content in payload["files"].items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    for relative, encoded in (payload.get("binary") or {}).items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(encoded))
    print(f"Pulled {payload['slug']} ({len(payload['files'])} files) into {output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gamebase", description="Gamebase platform tools")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the web platform")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=None)
    serve.add_argument("--debug", action="store_true")
    serve.set_defaults(func=_serve)

    sub.add_parser("list", help="list games in the registry").set_defaults(func=_list)

    new = sub.add_parser("new", help="scaffold a new game")
    new.add_argument("slug")
    new.add_argument("--title")
    new.add_argument("--author")
    new.add_argument("--description")
    new.set_defaults(func=_new)

    publish = sub.add_parser("publish", help="record a new version from local disk")
    publish.add_argument("slug")
    publish.add_argument("--changelog")
    publish.set_defaults(func=_publish)

    push = sub.add_parser("push", help="publish a local game folder to a running server")
    push.add_argument("directory")
    push.add_argument("--url", help="server base URL (default: $GAMEBASE_URL or localhost:5121)")
    push.add_argument("--token", help="API token (default: $GAMEBASE_TOKEN or a new guest identity)")
    push.add_argument("--changelog")
    push.set_defaults(func=_push)

    pull = sub.add_parser("pull", help="download a game's manifest and files")
    pull.add_argument("slug")
    pull.add_argument("--out", help="output directory (default: ./<slug>)")
    pull.add_argument("--url")
    pull.add_argument("--token")
    pull.set_defaults(func=_pull)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
