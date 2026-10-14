"""Shared pytest fixtures: an isolated registry, database, and Flask client."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SRC = PACKAGE_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from gamebase.app import create_app  # noqa: E402
from gamebase.config import PROJECT_ROOT, Settings  # noqa: E402


def write_game(registry_dir: Path, slug: str, manifest: str, *, entry: str = "index.html") -> Path:
    game_dir = registry_dir / slug
    game_dir.mkdir(parents=True, exist_ok=True)
    (game_dir / "game.yaml").write_text(manifest, encoding="utf-8")
    (game_dir / entry).write_text("<!doctype html><title>game</title>", encoding="utf-8")
    (game_dir / "logic.js").write_text("// game logic\n", encoding="utf-8")
    return game_dir


TEST_GAME_MANIFEST = """
slug: test-game
title: Test Game
description: A game used by the test suite.
author: tester
version: 1.0.0
entry: index.html
tags: [arcade]
capabilities:
  leaderboard:
    order: desc
    min: 0
    max: 1000
    label: Score
  achievements:
    - id: reach-10
      title: Reach 10
      points: 10
      criteria:
        type: score
        gte: 10
    - id: grinder
      title: Grinder
      points: 5
      criteria:
        type: count
        gte: 2
    - id: level-five
      title: Level Five
      points: 12
      criteria:
        type: meta
        key: level
        gte: 5
    - id: secret
      title: Secret
      hidden: true
  matchmaking:
    players: 2
    mode: duel
""".strip()

TIME_TRIAL_MANIFEST = """
slug: time-trial
title: Time Trial
description: Lower is better.
author: tester
version: 2.0.0
capabilities:
  leaderboard:
    order: asc
    min: 0
    max: 9999
    label: Time
""".strip()


@pytest.fixture()
def registry_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "registry"
    directory.mkdir()
    write_game(directory, "test-game", TEST_GAME_MANIFEST)
    write_game(directory, "time-trial", TIME_TRIAL_MANIFEST)
    return directory


def make_settings(tmp_path: Path, registry_dir: Path, **overrides) -> Settings:
    defaults = dict(
        project_root=PROJECT_ROOT,
        registry_dir=registry_dir,
        database_path=tmp_path / "gamebase.sqlite3",
        template_dir=PROJECT_ROOT / "templates",
        static_dir=PROJECT_ROOT / "static",
        score_rate_limit_seconds=0.0,
    )
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.fixture()
def settings(tmp_path: Path, registry_dir: Path) -> Settings:
    return make_settings(tmp_path, registry_dir)


@pytest.fixture()
def app(settings: Settings):
    application = create_app(settings)
    application.config.update(TESTING=True)
    return application


@pytest.fixture()
def client(app):
    with app.test_client() as test_client:
        yield test_client


def create_player(client, handle: str | None = None):
    response = client.post("/api/identity", json={"handle": handle} if handle else {})
    assert response.status_code == 201, response.get_json()
    payload = response.get_json()
    return payload["token"], payload["player"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
