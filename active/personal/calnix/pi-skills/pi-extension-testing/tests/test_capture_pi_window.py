from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from capture_pi_window import find_matching_window, format_grim_geometry  # type: ignore[import-not-found]


def test_find_matching_window_prefers_focused_window() -> None:
    tree = {
        "nodes": [
            {
                "name": "workspace",
                "nodes": [
                    {
                        "name": "kitty general",
                        "focused": False,
                        "pid": 111,
                        "app_id": "kitty",
                        "rect": {"x": 5, "y": 10, "width": 700, "height": 500},
                        "nodes": [],
                        "floating_nodes": [],
                    },
                    {
                        "name": "pi debug",
                        "focused": True,
                        "pid": 222,
                        "app_id": "kitty",
                        "rect": {"x": 25, "y": 30, "width": 900, "height": 700},
                        "nodes": [],
                        "floating_nodes": [],
                    },
                ],
                "floating_nodes": [],
            }
        ],
        "floating_nodes": [],
    }

    window = find_matching_window(tree, focused=True)

    assert window is not None
    assert window["name"] == "pi debug"


def test_find_matching_window_can_match_title_or_pid() -> None:
    tree = {
        "nodes": [
            {
                "name": "workspace",
                "nodes": [
                    {
                        "name": "pi-review",
                        "focused": False,
                        "pid": 333,
                        "app_id": "foot",
                        "rect": {"x": 1, "y": 2, "width": 300, "height": 400},
                        "nodes": [],
                        "floating_nodes": [],
                    }
                ],
                "floating_nodes": [],
            }
        ],
        "floating_nodes": [],
    }

    assert find_matching_window(tree, title_substring="review")["pid"] == 333
    assert find_matching_window(tree, pid=333)["name"] == "pi-review"


def test_format_grim_geometry_uses_sway_rect_format() -> None:
    assert format_grim_geometry({"x": 12, "y": 34, "width": 640, "height": 480}) == "12,34 640x480"
