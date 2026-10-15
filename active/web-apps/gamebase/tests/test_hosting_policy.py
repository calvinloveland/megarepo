"""Platform hosting rule: a game is a static client with no always-on backend.

Games may only talk to the Gamebase platform through the SDK. They must not call
off-platform services, load third-party scripts, open their own sockets, or
declare a backend capability. This test enforces that on the whole registry so a
future port cannot quietly reintroduce a per-game server.
"""

from __future__ import annotations

import re
from pathlib import Path

from gamebase import registry
from gamebase.config import PROJECT_ROOT

REGISTRY_DIR = PROJECT_ROOT / "registry"
SCANNED_SUFFIXES = {".js", ".mjs", ".html", ".css"}

OFF_PLATFORM_PATTERNS = [
    re.compile(r"""fetch\(\s*['"`]https?://"""),
    re.compile(r"""fetch\(\s*['"`]//"""),
    re.compile(r"""new\s+WebSocket\s*\(\s*['"`]wss?://"""),
    re.compile(r"\bXMLHttpRequest\b"),
    re.compile(r"\bimportScripts\s*\("),
    re.compile(r"""<script[^>]+src\s*=\s*['"]https?://""", re.IGNORECASE),
    re.compile(r"""<link[^>]+href\s*=\s*['"]https?://""", re.IGNORECASE),
    re.compile(r"""@import[^;{]*https?://""", re.IGNORECASE),
    re.compile(r"""url\(\s*['"]?https?://""", re.IGNORECASE),
]

DISALLOWED_CAPABILITIES = {"backend", "server", "service", "database", "proxy"}


def test_no_game_calls_an_off_platform_service():
    offenders = []
    for path in sorted(REGISTRY_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SCANNED_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in OFF_PLATFORM_PATTERNS:
            if pattern.search(text):
                offenders.append(f"{path.relative_to(PROJECT_ROOT)}: {pattern.pattern}")
    assert not offenders, (
        "games must not call off-platform services or load third-party resources:\n"
        + "\n".join(sorted(set(offenders)))
    )


def test_no_game_declares_a_backend_capability():
    declared = []
    for manifest in registry.scan_games(REGISTRY_DIR).values():
        bad = DISALLOWED_CAPABILITIES & set(manifest.capabilities)
        if bad:
            declared.append(f"{manifest.slug}: {sorted(bad)}")
    assert not declared, (
        "games may not declare a backend/service capability — run that logic on the "
        "host client or peer-to-peer instead:\n" + "\n".join(declared)
    )
