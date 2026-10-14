"""Push/pull publishing API tests — the agent-facing create/update path."""

from __future__ import annotations

from conftest import auth, create_player


def _manifest(slug: str, **overrides) -> dict:
    manifest = {
        "slug": slug,
        "title": slug.replace("-", " ").title(),
        "version": "1.0.0",
        "entry": "index.html",
        "capabilities": {"leaderboard": {"order": "desc", "min": 0, "max": 100}},
    }
    manifest.update(overrides)
    return manifest


def _files(**overrides) -> dict:
    files = {
        "index.html": "<!doctype html><title>pushed</title>",
        "game.js": "console.log('hi');",
    }
    files.update(overrides)
    return files


def test_push_creates_a_playable_game(client):
    token, player = create_player(client, handle="publisher")
    response = client.post(
        "/api/games",
        json={"manifest": _manifest("pushed-game"), "files": _files(), "changelog": "First push"},
        headers=auth(token),
    )
    assert response.status_code == 201
    assert response.get_json()["author"] == "publisher"

    assert client.get("/api/games/pushed-game").status_code == 200
    assert client.get("/play/pushed-game/game.js").status_code == 200
    page = client.get("/g/pushed-game")
    assert page.status_code == 200
    assert "pushed" in client.get("/play/pushed-game/").get_data(as_text=True)


def test_push_updates_existing_game_and_records_version(client, registry_dir):
    token, _ = create_player(client, handle="updater")
    client.post("/api/games", json={"manifest": _manifest("live-game"), "files": _files()}, headers=auth(token))

    updated = client.post(
        "/api/games",
        json={
            "manifest": _manifest("live-game", version="1.1.0"),
            "files": _files(**{"game.js": "console.log('v2');"}),
            "changelog": "Faster controls",
        },
        headers=auth(token),
    )
    assert updated.status_code == 200
    assert (registry_dir / "live-game" / "game.js").read_text(encoding="utf-8") == "console.log('v2');"

    versions = client.get("/api/games/live-game").get_json()["versions"]
    assert [v["version"] for v in versions] == ["1.1.0", "1.0.0"]
    assert versions[0]["changelog"] == "Faster controls"


def test_push_requires_authentication(client):
    response = client.post("/api/games", json={"manifest": _manifest("nope"), "files": _files()})
    assert response.status_code == 401


def test_push_rejects_unsafe_paths_and_types(client):
    token, _ = create_player(client, handle="attacker")
    traversal = client.post(
        "/api/games",
        json={"manifest": _manifest("attack-1"), "files": _files(**{"../evil.js": "boom"})},
        headers=auth(token),
    )
    assert traversal.status_code == 400

    unsupported = client.post(
        "/api/games",
        json={"manifest": _manifest("attack-2"), "files": _files(**{"malware.exe": "boom"})},
        headers=auth(token),
    )
    assert unsupported.status_code == 400


def test_push_requires_the_declared_entry_file(client):
    token, _ = create_player(client, handle="missing-entry")
    response = client.post(
        "/api/games",
        json={"manifest": _manifest("no-entry"), "files": {"game.js": "console.log(1);"}},
        headers=auth(token),
    )
    assert response.status_code == 400
    assert "entry" in response.get_json()["error"]


def test_push_preserves_remix_lineage_on_update(client, registry_dir):
    token, _ = create_player(client, handle="lineage-publisher")
    remixed = client.post(
        "/api/games/test-game/remix", json={"new_slug": "lineage-game"}, headers=auth(token)
    )
    assert remixed.status_code == 201

    # Updating without an explicit remix_of must not orphan the lineage.
    response = client.post(
        "/api/games",
        json={"manifest": _manifest("lineage-game", version="0.2.0"), "files": _files()},
        headers=auth(token),
    )
    assert response.status_code == 200
    detail = client.get("/api/games/lineage-game").get_json()
    assert detail["remix_of"] == "test-game"
    assert detail["lineage"] == ["test-game"]


def test_pull_returns_manifest_and_files(client):
    token, _ = create_player(client, handle="puller")
    client.post(
        "/api/games",
        json={"manifest": _manifest("pull-me"), "files": _files()},
        headers=auth(token),
    )
    payload = client.get("/api/games/pull-me/files").get_json()
    assert payload["manifest"]["slug"] == "pull-me"
    assert set(payload["files"]) == {"index.html", "game.js"}
    assert "pushed" in payload["files"]["index.html"]


def test_pull_missing_game_returns_404(client):
    assert client.get("/api/games/ghost/files").status_code == 404
