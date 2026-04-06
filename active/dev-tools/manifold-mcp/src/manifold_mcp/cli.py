from __future__ import annotations

import argparse
import json
import os
import sys


UPSTREAM_PACKAGE = "manifold-mcp-server"
UPSTREAM_REPOSITORY = "https://github.com/bmorphism/manifold-mcp-server"
EXPECTED_TOOLS = [
    "search_markets",
    "get_market",
    "get_user",
    "place_bet",
    "sell_shares",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Helpers for the adopted upstream Manifold MCP server")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("print-config", help="Print a Claude/Cline style MCP config snippet")
    subparsers.add_parser("doctor", help="Validate expected env and upstream assumptions")
    return parser


def _print(payload: object) -> None:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True))
    sys.stdout.write("\n")


def print_config() -> int:
    payload = {
        "mcpServers": {
            "manifold": {
                "command": "npx",
                "args": ["-y", UPSTREAM_PACKAGE],
                "env": {
                    "MANIFOLD_API_KEY": "${MANIFOLD_API_KEY}",
                },
            }
        },
        "upstream_repository": UPSTREAM_REPOSITORY,
        "expected_tools": EXPECTED_TOOLS,
    }
    _print(payload)
    return 0


def doctor() -> int:
    payload = {
        "upstream_package": UPSTREAM_PACKAGE,
        "upstream_repository": UPSTREAM_REPOSITORY,
        "has_api_key": bool(os.environ.get("MANIFOLD_API_KEY")),
        "expected_tools": EXPECTED_TOOLS,
    }
    _print(payload)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "print-config":
        return print_config()
    if args.command == "doctor":
        return doctor()
    raise SystemExit(2)


if __name__ == "__main__":
    raise SystemExit(main())
