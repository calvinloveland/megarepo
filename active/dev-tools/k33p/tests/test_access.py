"""Tests for multi-tenancy / access control primitives."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from k33p.access import (
    AccessEntry,
    PermissionConfig,
    cmd_grant,
    cmd_permissions,
    cmd_revoke,
    format_permissions,
    parse_access_config,
)


@pytest.fixture
def project_dir() -> Path:
    """Create a project with a basic manifest."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "k33p.yaml").write_text("""\
project: multi-tenant
type: monorepo
channels:
  src:
    type: source
    transport: git+https://example.com/org/repo
    visibility: public
    history: full
  private:
    type: secrets
    transport: file:///tmp/nonexistent
    visibility: team
    scope: monorepo
subprojects:
  games:
    path: active/games/
    description: Game subprojects
  docs:
    path: docs/
    description: Documentation site
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
  maintainer:  { view: default, publish: [src] }
""")
        (root / ".k33p" / "store").mkdir(parents=True, exist_ok=True)
        yield root


class TestParseAccessConfig:
    def test_no_access_section(self) -> None:
        config = parse_access_config({"project": "test"})
        assert len(config.entries) == 0

    def test_parse_permissions_section(self) -> None:
        data = {
            "project": "test",
            "permissions": {
                "grants": [
                    {"to": "games-team", "role": "write", "subproject": "games"},
                    {"to": "sre-team", "role": "read"},
                ],
            },
        }
        config = parse_access_config(data)
        assert len(config.entries) == 2
        assert config.entries[0].subject == "games-team"
        assert config.entries[0].role == "write"
        assert config.entries[0].subproject == "games"
        assert config.entries[1].subject == "sre-team"
        assert config.entries[1].role == "read"
        assert config.entries[1].subproject is None

    def test_parse_access_section(self) -> None:
        data = {
            "project": "test",
            "access": {
                "grants": [
                    {"to": "team@org.com", "role": "admin"},
                ],
            },
        }
        config = parse_access_config(data)
        assert len(config.entries) == 1


class TestFormatPermissions:
    def test_format_read(self) -> None:
        lines = format_permissions([AccessEntry("team", "read")])
        assert len(lines) == 1
        assert "team" in lines[0]
        assert "read" in lines[0]

    def test_format_with_subproject(self) -> None:
        lines = format_permissions([
            AccessEntry("games-team", "admin", subproject="games"),
        ])
        assert "games-team" in lines[0]
        assert "games" in lines[0]

    def test_empty(self) -> None:
        assert format_permissions([]) == []


class TestCmdGrant:
    def test_grant_read(self, project_dir: Path) -> None:
        rc = cmd_grant(str(project_dir), "games-team", role="read",
                       subproject="games")
        assert rc == 0
        # Verify it was written
        yaml_text = (project_dir / "k33p.yaml").read_text()
        assert "games-team" in yaml_text
        assert "games" in yaml_text

    def test_grant_duplicate(self, project_dir: Path) -> None:
        cmd_grant(str(project_dir), "team@org.com", role="read")
        rc = cmd_grant(str(project_dir), "team@org.com", role="read")
        assert rc == 1  # duplicate

    def test_grant_invalid_role(self, project_dir: Path) -> None:
        rc = cmd_grant(str(project_dir), "team", role="superadmin")
        assert rc == 1

    def test_grant_admin(self, project_dir: Path) -> None:
        rc = cmd_grant(str(project_dir), "admin@org.com", role="admin")
        assert rc == 0
        yaml_text = (project_dir / "k33p.yaml").read_text()
        assert "admin" in yaml_text


class TestCmdRevoke:
    def test_revoke_existing(self, project_dir: Path) -> None:
        cmd_grant(str(project_dir), "team@org.com", role="read")
        rc = cmd_revoke(str(project_dir), "team@org.com")
        assert rc == 0

    def test_revoke_nonexistent(self, project_dir: Path) -> None:
        rc = cmd_revoke(str(project_dir), "nonexistent@org.com")
        assert rc == 1

    def test_revoke_specific_role(self, project_dir: Path) -> None:
        cmd_grant(str(project_dir), "multi@org.com", role="read")
        cmd_grant(str(project_dir), "multi@org.com", role="write")
        rc = cmd_revoke(str(project_dir), "multi@org.com", role="read")
        assert rc == 0
        # The write grant should remain
        rc2 = cmd_revoke(str(project_dir), "multi@org.com", role="write")
        assert rc2 == 0


class TestCmdPermissions:
    def test_list_permissions(self, project_dir: Path) -> None:
        rc = cmd_permissions(str(project_dir))
        assert rc == 0

    def test_list_with_grants(self, project_dir: Path) -> None:
        cmd_grant(str(project_dir), "games-team", role="write")
        rc = cmd_permissions(str(project_dir))
        assert rc == 0
