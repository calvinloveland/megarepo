"""Security and input-validation regressions.

Covers the fixes driven by the platform-infra audit: game ownership,
secret-free player payloads, request validation, HTML-vs-JSON errors,
security headers, and stale-game reconciliation.
"""

from __future__ import annotations

import shutil

from conftest import auth, create_player

SCORES = "/api/games/test-game/scores"


def _manifest(slug: str, **overrides) -> dict:
    manifest = {"slug": slug, "title": slug.title(), "version": "1.0.0", "entry": "index.html"}
    manifest.update(overrides)
    return manifest


def _minimal_files() -> dict:
    return {"index.html": "<!doctype html><title>x</title>"}


def _push(client, token, slug, **overrides):
    return client.post(
        "/api/games",
        json={"manifest": _manifest(slug, **overrides), "files": _minimal_files()},
        headers=auth(token),
    )


def test_only_the_owner_can_overwrite_a_published_game(client):
    owner, _ = create_player(client, handle="OWN")
    other, _ = create_player(client, handle="OTH")

    assert _push(client, owner, "owned-game").status_code == 201
    intruder = _push(client, other, "owned-game", title="Hijacked")
    assert intruder.status_code == 403
    assert _push(client, owner, "owned-game", title="Mine").status_code == 200


def test_disk_managed_games_cannot_be_published_by_guests(client, registry_dir, monkeypatch):
    monkeypatch.setenv("GAMEBASE_ADMIN_TOKEN", "admin-secret")
    token, _ = create_player(client, handle="GST")

    assert client.post("/api/games/test-game/publish", json={}, headers=auth(token)).status_code == 403
    admin = client.post(
        "/api/games/test-game/publish",
        json={"changelog": "ok"},
        headers={**auth(token), "X-Admin-Token": "admin-secret"},
    )
    assert admin.status_code == 200


def test_player_payloads_never_include_the_recovery_secret(client):
    created = client.post("/api/identity", json={"handle": "SEC"}).get_json()
    assert "recovery_secret" not in created["player"]

    me = client.get("/api/me", headers=auth(created["token"])).get_json()
    assert "recovery_secret" not in me["player"]

    recovered = client.post("/api/identity/recover", json={"code": created["recovery_code"]}).get_json()
    assert "recovery_secret" not in recovered["player"]


def test_meta_must_be_a_mapping(client):
    token, _ = create_player(client, handle="MET")
    assert client.post(SCORES, json={"score": 1, "meta": "not-a-dict"}, headers=auth(token)).status_code == 400
    progress = client.post(
        "/api/games/test-game/progress", json={"meta": ["nope"]}, headers=auth(token)
    )
    assert progress.status_code == 400


def test_invalid_manifest_numbers_return_400(client):
    token, _ = create_player(client, handle="NUM")
    bad_points = _push(
        client,
        token,
        "bad-points",
        capabilities={"achievements": [{"id": "x", "title": "X", "points": "abc"}]},
    )
    assert bad_points.status_code == 400

    bad_players = _push(client, token, "bad-mm", capabilities={"matchmaking": {"players": "two"}})
    assert bad_players.status_code == 400

    bad_max = _push(client, token, "bad-max", capabilities={"leaderboard": {"max": {"nope": 1}}})
    assert bad_max.status_code == 400


def test_unknown_unlock_id_does_not_break_a_score(client):
    token, _ = create_player(client, handle="UNK")
    response = client.post(
        SCORES, json={"score": 5, "unlock": ["does-not-exist"]}, headers=auth(token)
    )
    assert response.status_code == 201


def test_compound_all_criteria_requires_every_condition(client):
    token, _ = create_player(client, handle="ALL")
    partial = client.post(
        SCORES, json={"score": 1, "meta": {"result": "loss", "level": 9}}, headers=auth(token)
    ).get_json()
    assert "combo" not in {achievement["id"] for achievement in partial["unlocked"]}

    both = client.post(
        SCORES, json={"score": 1, "meta": {"result": "win", "level": 5}}, headers=auth(token)
    ).get_json()
    assert "combo" in {achievement["id"] for achievement in both["unlocked"]}


def test_browser_404_is_html_and_api_404_is_json(client):
    page = client.get("/g/does-not-exist", headers={"Accept": "text/html"})
    assert page.status_code == 404
    assert "text/html" in page.headers["Content-Type"]

    api = client.get("/api/games/does-not-exist")
    assert api.status_code == 404
    assert "application/json" in api.headers["Content-Type"]


def test_security_headers_are_present(client):
    response = client.get("/")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "Referrer-Policy" in response.headers


def test_removed_games_are_reconciled_out_of_the_catalog(client, registry_dir):
    token, _ = create_player(client, handle="DEL")
    assert _push(client, token, "temp-game").status_code == 201
    assert client.get("/api/games/temp-game").status_code == 200

    shutil.rmtree(registry_dir / "temp-game")
    # Auto-rescan on the next request drops the phantom entry.
    assert client.get("/api/games/temp-game").status_code == 404
