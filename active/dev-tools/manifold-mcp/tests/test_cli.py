from __future__ import annotations

import json

from manifold_mcp.cli import EXPECTED_TOOLS, UPSTREAM_PACKAGE, print_config


def test_print_config_mentions_upstream_package(capsys):
    assert print_config() == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["mcpServers"]["manifold"]["args"] == ["-y", UPSTREAM_PACKAGE]
    assert payload["expected_tools"] == EXPECTED_TOOLS
