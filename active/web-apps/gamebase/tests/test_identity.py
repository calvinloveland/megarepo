"""Identity and session tests."""

from __future__ import annotations

import re

from conftest import auth, create_player


def test_generated_identity_is_a_three_character_tag(client):
    _, player = create_player(client)
    assert re.fullmatch(r"[A-Z0-9]{3}", player["handle"])


def test_lowercase_tag_is_normalized_to_uppercase(client):
    _, player = create_player(client, handle="abc")
    assert player["handle"] == "ABC"


def test_duplicate_tag_conflicts(client):
    create_player(client, handle="XYZ")
    duplicate = client.post("/api/identity", json={"handle": "xyz"})
    assert duplicate.status_code == 409


def test_create_identity_returns_token_and_player(client):
    token, player = create_player(client)
    assert token
    assert player["handle"]
    assert player["is_guest"] == 1


def test_identity_with_handle_and_duplicate_conflict(client):
    token, player = create_player(client, handle="calvin")
    assert player["handle"] == "calvin"
    assert token

    duplicate = client.post("/api/identity", json={"handle": "calvin"})
    assert duplicate.status_code == 409


def test_me_requires_token(client):
    assert client.get("/api/me").status_code == 401


def test_me_returns_player_and_empty_achievements(client):
    token, player = create_player(client, handle="profile-test")
    response = client.get("/api/me", headers=auth(token))
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["player"]["handle"] == "profile-test"
    assert payload["points"] == 0
    assert payload["achievements"] == []


def test_bogus_token_is_rejected(client):
    assert client.get("/api/me", headers=auth("not-a-token")).status_code == 401
