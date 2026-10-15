"""Star ratings, comments, play counts, and catalog sorting."""

from __future__ import annotations

from conftest import auth, create_player, write_game

RATING = "/api/games/test-game/rating"
COMMENTS = "/api/games/test-game/comments"
PLAY = "/api/games/test-game/play"


def test_rating_aggregates_and_updates(client):
    first, _ = create_player(client, handle="AAA")
    second, _ = create_player(client, handle="BBB")
    client.post(RATING, json={"rating": 5}, headers=auth(first))
    client.post(RATING, json={"rating": 3}, headers=auth(second))

    payload = client.get(RATING, headers=auth(first)).get_json()
    assert payload["count"] == 2
    assert payload["average"] == 4.0
    assert payload["your_rating"] == 5

    # Re-rating replaces the previous value rather than adding a vote.
    client.post(RATING, json={"rating": 1}, headers=auth(first))
    updated = client.get(RATING, headers=auth(first)).get_json()
    assert updated["count"] == 2
    assert updated["average"] == 2.0
    assert updated["your_rating"] == 1


def test_rating_validation_and_auth(client, app):
    token, _ = create_player(client, handle="CCC")
    for bad in (0, 6, "x", 2.5, True):
        response = client.post(RATING, json={"rating": bad}, headers=auth(token))
        assert response.status_code == 400, bad
    with app.test_client() as anonymous:
        assert anonymous.post(RATING, json={"rating": 5}).status_code == 401


def test_comments_round_trip_and_ownership(client):
    author, _ = create_player(client, handle="AAA")
    other, _ = create_player(client, handle="BBB")

    created = client.post(COMMENTS, json={"body": "great game"}, headers=auth(author))
    assert created.status_code == 201
    comment = created.get_json()
    assert comment["handle"] == "AAA"
    assert comment["is_me"] is True

    mine = client.get(COMMENTS, headers=auth(author)).get_json()["comments"]
    assert mine[0]["body"] == "great game" and mine[0]["is_me"] is True
    theirs = client.get(COMMENTS, headers=auth(other)).get_json()["comments"]
    assert theirs[0]["is_me"] is False

    # Only the author can delete their comment.
    assert client.delete(f"/api/comments/{comment['id']}", headers=auth(other)).status_code == 404
    assert client.delete(f"/api/comments/{comment['id']}", headers=auth(author)).status_code == 200
    assert client.get(COMMENTS).get_json()["comments"] == []


def test_comment_validation_and_rate_limit(client):
    token, _ = create_player(client, handle="DDD")
    assert client.post(COMMENTS, json={"body": "   "}, headers=auth(token)).status_code == 400
    assert client.post(COMMENTS, json={"body": "x" * 501}, headers=auth(token)).status_code == 400

    assert client.post(COMMENTS, json={"body": "hello"}, headers=auth(token)).status_code == 201
    second = client.post(COMMENTS, json={"body": "again"}, headers=auth(token))
    assert second.status_code == 429
    assert "Retry-After" in second.headers


def test_plays_are_counted_per_player(client, app):
    first, _ = create_player(client, handle="AAA")
    second, _ = create_player(client, handle="BBB")
    client.post(PLAY, headers=auth(first))
    client.post(PLAY, headers=auth(first))
    stats = client.post(PLAY, headers=auth(second)).get_json()
    assert stats == {"plays": 3, "players": 2}
    with app.test_client() as anonymous:
        assert anonymous.post(PLAY).status_code == 401


def test_api_games_include_rating_and_stats(client):
    token, _ = create_player(client, handle="EEE")
    client.post(RATING, json={"rating": 4}, headers=auth(token))
    client.post(PLAY, headers=auth(token))

    games = client.get("/api/games").get_json()["games"]
    game = next(entry for entry in games if entry["slug"] == "test-game")
    assert game["rating"]["count"] == 1
    assert game["rating"]["average"] == 4.0
    assert game["stats"]["plays"] == 1


def test_catalog_sort_by_popularity(client, registry_dir):
    write_game(registry_dir, "zzz-game", "slug: zzz-game\ntitle: Zzz Game\nversion: 1.0.0")
    token, _ = create_player(client, handle="FFF")
    client.post("/api/games/zzz-game/play", headers=auth(token))

    popular = client.get("/?sort=popular").get_data(as_text=True)
    alphabetical = client.get("/?sort=az").get_data(as_text=True)
    assert popular.index("Zzz Game") < popular.index("Time Trial")
    assert alphabetical.index("Zzz Game") > alphabetical.index("Time Trial")


def test_catalog_pages_render_for_every_sort(client):
    for sort in ("az", "popular", "rated", "new", "bogus"):
        assert client.get(f"/?sort={sort}").status_code == 200
