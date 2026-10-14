"""Command-line tools for creating and publishing Gamebase games.

    gamebase serve                 # run the platform
    gamebase list                  # list games in the registry
    gamebase new <slug> --title …  # scaffold a playable game
    gamebase publish <slug>        # sync + record a version from disk

The CLI deliberately shares the same registry code the web app uses, so there
is exactly one definition of what a game is.
"""

from __future__ import annotations

import argparse
import sys

from . import models, registry
from .config import Settings
from .db import connect, init_db


def _serve(args: argparse.Namespace) -> int:
    import os

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

    publish = sub.add_parser("publish", help="record a new version from disk")
    publish.add_argument("slug")
    publish.add_argument("--changelog")
    publish.set_defaults(func=_publish)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
