"""Catalog, page rendering, and hosted game asset tests."""

from __future__ import annotations

from conftest import create_player, write_game


def test_api_lists_games(client):
    response = client.get("/api/games")
    assert response.status_code == 200
    slugs = {game["slug"] for game in response.get_json()["games"]}
    assert {"test-game", "time-trial"} <= slugs


def test_game_detail_includes_versions_and_lineage(client):
    response = client.get("/api/games/test-game")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["title"] == "Test Game"
    assert payload["versions"][0]["version"] == "1.0.0"
    assert payload["lineage"] == []


def test_missing_game_returns_404(client):
    assert client.get("/api/games/nope").status_code == 404


def test_index_page_renders_games(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert "Test Game" in body
    assert "Time Trial" in body


def test_game_page_renders_play_frame(client):
    response = client.get("/g/test-game")
    assert response.status_code == 200
    assert "/play/test-game/" in response.get_data(as_text=True)


def test_games_are_sandboxed_strictly_by_default(client):
    body = client.get("/g/test-game").get_data(as_text=True)
    assert 'sandbox="allow-scripts allow-pointer-lock"' in body
    assert "allow-same-origin" not in body


def test_games_can_opt_into_same_origin(client, registry_dir):
    write_game(
        registry_dir,
        "legacy-game",
        "slug: legacy-game\ntitle: Legacy Game\nversion: 1.0.0\n"
        "capabilities:\n  sandbox: same-origin\n",
    )
    body = client.get("/g/legacy-game").get_data(as_text=True)
    assert "allow-same-origin" in body


def test_play_serves_entry_and_assets(client):
    entry = client.get("/play/test-game/")
    assert entry.status_code == 200
    assert "text/html" in entry.headers["Content-Type"]

    asset = client.get("/play/test-game/logic.js")
    assert asset.status_code == 200
    assert "game logic" in asset.get_data(as_text=True)


def test_play_blocks_path_traversal(client):
    response = client.get("/play/test-game/..%2f..%2fconfig.py")
    assert response.status_code == 404


def test_sdk_is_served(client):
    response = client.get("/sdk/gamebase.js")
    assert response.status_code == 200
    assert "Gamebase" in response.get_data(as_text=True)


def test_agent_guide_is_served_as_markdown(client):
    response = client.get("/agent.md")
    assert response.status_code == 200
    assert "text/markdown" in response.headers["Content-Type"]
    assert "game.yaml" in response.get_data(as_text=True)


def test_add_a_game_page_links_the_agent_guide(client):
    response = client.get("/create")
    assert response.status_code == 200
    assert "/agent.md" in response.get_data(as_text=True)


def test_llms_txt_points_at_the_guide(client):
    response = client.get("/llms.txt")
    assert response.status_code == 200
    assert "/agent.md" in response.get_data(as_text=True)


def test_healthz(client):
    assert client.get("/healthz").get_json() == {"status": "ok"}


def test_theme_setting_adds_stylesheet(tmp_path, registry_dir):
    from conftest import make_settings
    from gamebase.app import create_app

    application = create_app(make_settings(tmp_path, registry_dir, theme="playful"))
    application.config.update(TESTING=True)
    with application.test_client() as themed:
        body = themed.get("/").get_data(as_text=True)
    assert "/static/themes/playful.css" in body
