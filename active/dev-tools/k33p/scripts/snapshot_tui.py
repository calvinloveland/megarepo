"""Snapshot the TUI to text files for visual review.

Runs the TUI in headless mode, captures the rendered main panel for
each view (overview, channels, subprojects, views, roles, lock), and
writes them to a snapshots/ directory. Useful for verifying what the
TUI looks like without running a real terminal.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add src/ to sys.path so this script works without installing
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from k33p.project import load_project
from k33p.tui.app import DetailPanel, K33pApp


ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"
SNAPSHOTS = ROOT / "snapshots"


VIEWS = [
    ("overview", "o", "Active view: developer"),
    ("channels", "c", "Channels"),
    ("subprojects", "s", "Subprojects"),
    ("views", "v", "Views"),
    ("roles", "r", "Roles"),
    ("lock", "l", "Lock"),
]


async def snapshot_project(name: str, project_path: Path) -> None:
    project = load_project(project_path)
    app = K33pApp(project)
    print(f"\n=== {name} ({project_path}) ===")
    SNAPSHOTS.mkdir(exist_ok=True)
    project_dir = SNAPSHOTS / name
    project_dir.mkdir(exist_ok=True)

    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        for view_name, key, _ in VIEWS:
            await pilot.press(key)
            await pilot.pause()
            main = app.query_one("#main", DetailPanel)
            rendered = main.render()
            text = str(rendered) if rendered is not None else ""
            out = project_dir / f"{view_name}.txt"
            out.write_text(text, encoding="utf-8")
            print(f"  wrote {out.relative_to(ROOT)} ({len(text)} chars)")
            # print first 5 lines for quick visual check
            lines = text.splitlines()
            for line in lines[:3]:
                print(f"    | {line}")
            if len(lines) > 3:
                print(f"    | ... ({len(lines) - 3} more lines)")


async def main() -> None:
    await snapshot_project("megarepo", EXAMPLES / "megarepo")
    await snapshot_project("coolproject", EXAMPLES / "coolproject")


if __name__ == "__main__":
    asyncio.run(main())
