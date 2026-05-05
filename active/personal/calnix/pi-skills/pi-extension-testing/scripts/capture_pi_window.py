#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True)


def walk_windows(node: dict[str, Any]) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    if node.get("pid") and isinstance(node.get("rect"), dict):
        windows.append(node)
    for child in node.get("nodes", []) or []:
        windows.extend(walk_windows(child))
    for child in node.get("floating_nodes", []) or []:
        windows.extend(walk_windows(child))
    return windows


def find_matching_window(
    tree: dict[str, Any],
    *,
    focused: bool = False,
    title_substring: str | None = None,
    pid: int | None = None,
) -> dict[str, Any] | None:
    windows = walk_windows(tree)
    if focused:
        for window in windows:
            if window.get("focused"):
                return window
    if title_substring:
        lowered = title_substring.lower()
        for window in windows:
            title = str(window.get("name") or "").lower()
            app_id = str(window.get("app_id") or "").lower()
            if lowered in title or lowered in app_id:
                return window
    if pid is not None:
        for window in windows:
            if int(window.get("pid") or -1) == pid:
                return window
    return None


def format_grim_geometry(rect: dict[str, Any]) -> str:
    return f"{int(rect['x'])},{int(rect['y'])} {int(rect['width'])}x{int(rect['height'])}"


def capture_window(output_path: Path, *, geometry: str) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = run(["grim", "-g", geometry, str(output_path)])
    if result.returncode != 0:
        sys.stderr.write(result.stderr or result.stdout)
    return result.returncode


def load_sway_tree() -> dict[str, Any]:
    result = run(["swaymsg", "-t", "get_tree", "-r"])
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "swaymsg get_tree failed")
    return json.loads(result.stdout)


def default_output_path() -> Path:
    return Path("artifacts") / "pi-window.png"


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture a screenshot of a running Pi window under Sway using grim")
    parser.add_argument("output", nargs="?", default=str(default_output_path()), help="Output PNG path")
    parser.add_argument("--focused", action="store_true", help="Capture the currently focused window")
    parser.add_argument("--title", help="Capture the first window whose title or app_id contains this substring")
    parser.add_argument("--pid", type=int, help="Capture the window for a specific process id")
    parser.add_argument("--print-geometry", action="store_true", help="Print the matched grim geometry before capturing")
    args = parser.parse_args()

    if not args.focused and not args.title and args.pid is None:
        args.focused = True

    tree = load_sway_tree()
    window = find_matching_window(tree, focused=args.focused, title_substring=args.title, pid=args.pid)
    if window is None:
        sys.stderr.write("No matching Sway window found.\n")
        return 2

    geometry = format_grim_geometry(window["rect"])
    if args.print_geometry:
        print(geometry)

    output_path = Path(args.output).expanduser().resolve()
    return capture_window(output_path, geometry=geometry)


if __name__ == "__main__":
    raise SystemExit(main())
