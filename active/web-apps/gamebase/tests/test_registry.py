"""Registry, remix lineage, scaffolding, and publish tests."""

from __future__ import annotations

from conftest import auth, create_player, write_game


def test_remix_copies_files_and_records_lineage(client, registry_dir):
    token, _ = create_player(client, handle="remixer")
    response = client.post(
        "/api/games/test-game/remix",
        json={"new_slug": "test-game-remix"},
        headers=auth(token),
    )
    assert response.status_code == 201
    manifest = response.get_json()
    assert manifest["remix_of"] == "test-game"
    assert manifest["version"] == "0.1.0"
    assert manifest["author"] == "remixer"

    remix_dir = registry_dir / "test-game-remix"
    assert (remix_dir / "logic.js").read_text(encoding="utf-8") == "// game logic\n"

    detail = client.get("/api/games/test-game-remix").get_json()
    assert detail["lineage"] == ["test-game"]
    assert client.get("/play/test-game-remix/").status_code == 200


def test_remix_requires_authentication_and_unique_slug(client):
    assert client.post("/api/games/test-game/remix", json={"new_slug": "x-remix"}).status_code == 401

    token, _ = create_player(client, handle="dup")
    first = client.post(
        "/api/games/test-game/remix", json={"new_slug": "dup-remix"}, headers=auth(token)
    )
    assert first.status_code == 201
    second = client.post(
        "/api/games/test-game/remix", json={"new_slug": "dup-remix"}, headers=auth(token)
    )
    assert second.status_code == 400


def test_scaffold_creates_a_playable_game(client):
    response = client.post(
        "/create",
        data={"slug": "my-game", "title": "My Game", "author": "me", "description": "Fresh"},
    )
    assert response.status_code == 302
    detail = client.get("/api/games/my-game")
    assert detail.status_code == 200
    assert detail.get_json()["title"] == "My Game"
    assert client.get("/play/my-game/").status_code == 200


def test_scaffold_rejects_invalid_slug(client):
    response = client.post("/create", data={"slug": "Bad Slug", "title": "Nope"})
    assert response.status_code == 400


def test_scan_skips_invalid_game_directories(client, registry_dir):
    broken = registry_dir / "broken"
    broken.mkdir()
    (broken / "game.yaml").write_text("slug: not-a-match\ntitle: Broken\n", encoding="utf-8")

    health = client.post("/api/rescan").get_json()
    assert "broken" not in health["games"]

    # A directory without a manifest is ignored entirely.
    write_game(registry_dir, "valid-game", "slug: valid-game\ntitle: Valid\nversion: 1.0.0")
    health = client.post("/api/rescan").get_json()
    assert "valid-game" in health["games"]


def test_publish_records_new_version(client, registry_dir):
    token, _ = create_player(client, handle="publisher")
    manifest_path = registry_dir / "test-game" / "game.yaml"
    manifest_path.write_text(
        manifest_path.read_text(encoding="utf-8").replace("version: 1.0.0", "version: 1.1.0"),
        encoding="utf-8",
    )
    response = client.post(
        "/api/games/test-game/publish",
        json={"changelog": "Buffed the orb"},
        headers=auth(token),
    )
    assert response.status_code == 200
    versions = client.get("/api/games/test-game").get_json()["versions"]
    assert versions[0]["version"] == "1.1.0"
    assert versions[0]["changelog"] == "Buffed the orb"
