from pathlib import Path

from super_ultimate_trading_card_game.sim_api import deck_builder_result, human_profiles_result
from super_ultimate_trading_card_game.web import create_app


def _app(tmp_path: Path):
    return create_app({"TESTING": True, "SUTCG_DB_PATH": str(tmp_path / "sutcg.sqlite3")})


def _register(client, tmp_path: Path, name: str = "Calvin Player") -> str:
    response = client.post("/players/register", data={"display_name": name}, follow_redirects=True)
    assert response.status_code == 200
    profiles = human_profiles_result(db_path=tmp_path / "sutcg.sqlite3")
    profile = next(profile for profile in profiles if profile.display_name == name)
    return profile.player_id


def test_web_index_prompts_for_player_name_without_cookie(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert b"Choose your player name" in response.data


def test_web_index_uses_cookie_backed_player_after_registration(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    _register(client, tmp_path, "Calvin Player")
    response = client.get("/")
    assert response.status_code == 200
    assert b"Welcome, Calvin Player" in response.data
    assert b"Create Live Game" not in response.data
    assert b"game-card" in response.data
    assert b"data:image/svg+xml" in response.data
    assert b"/static/card_art/track-lancer-velocity-rare.png" in response.data
    assert b"Rare Alt Art" in response.data
    assert b"Velocity Charge" in response.data


def test_card_gallery_lists_owner_cards(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    response = client.get("/cards?owner_id=alpha")
    assert response.status_code == 200
    assert b"Alpha Atelier Card Gallery" in response.data
    assert b"Track Lancer" in response.data
    assert b"View prints" in response.data


def test_card_detail_shows_standard_and_alternate_art(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    response = client.get("/cards/track-lancer?owner_id=alpha")
    assert response.status_code == 200
    assert b"Track Lancer" in response.data
    assert b"Standard Art" in response.data
    assert b"Velocity Charge" in response.data
    assert b"/static/card_art/track-lancer-velocity-rare.png" in response.data
    assert b"data:image/svg+xml" in response.data


def test_web_can_update_generator_preference(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    _register(client, tmp_path, "Preference Player")
    response = client.post(
        "/preferences",
        data={"preferred_generator": "deterministic"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"deterministic" in response.data


def test_web_can_create_and_advance_live_ai_match(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    _register(client, tmp_path)
    create_response = client.post(
        "/live/create",
        data={
            "mode": "ai-vs-ai",
            "left_owner_id": "alpha",
            "right_owner_id": "beta",
            "generator": "deterministic",
            "seed": "7",
        },
    )
    assert create_response.status_code == 302
    detail_response = client.get(create_response.headers["Location"])
    assert detail_response.status_code == 200
    assert b"Advance one AI round" in detail_response.data
    assert b"Spectator view is active" in detail_response.data
    assert b"Battlefield" in detail_response.data
    assert b"Fast Track" in detail_response.data
    assert b"Slow Track" in detail_response.data
    assert b"ownership-card--flipped" in detail_response.data
    assert b"Alpha Atelier Hand" in detail_response.data
    assert b"Beta Bastion Hand" in detail_response.data
    assert b"hand-fan__card" in detail_response.data
    assert b"battlefield-track__marker" in detail_response.data

    advance_response = client.post(
        create_response.headers["Location"].replace("?viewer_id=alpha", "/advance"),
        data={"viewer_id": "alpha"},
        follow_redirects=True,
    )
    assert advance_response.status_code == 200
    assert b"Battle Log" in advance_response.data


def test_web_can_submit_human_turn(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    player_id = _register(client, tmp_path)
    create_response = client.post(
        "/live/create",
        data={
            "mode": "ai-vs-player",
            "right_owner_id": "alpha",
            "generator": "deterministic",
            "seed": "11",
        },
    )
    assert create_response.status_code == 302
    detail_response = client.get(create_response.headers["Location"])
    assert detail_response.status_code == 200
    assert b"Your Hand" in detail_response.data
    assert b"Lock in turn" in detail_response.data

    submit_response = client.post(
        create_response.headers["Location"].replace(f"?viewer_id={player_id}", "/submit-turn"),
        data={
            "viewer_id": player_id,
            "generate_prompt": "",
            "play_1_card_id": "",
            "play_1_track": "fast",
            "play_2_card_id": "",
            "play_2_track": "slow",
        },
        follow_redirects=True,
    )
    assert submit_response.status_code == 200
    assert b"Battle Log" in submit_response.data


def test_web_player_vs_player_waits_for_both_turns(tmp_path: Path):
    app = _app(tmp_path)
    client_one = app.test_client()
    player_one_id = _register(client_one, tmp_path, "Player One")
    client_two = app.test_client()
    player_two_id = _register(client_two, tmp_path, "Player Two")
    create_response = client_one.post(
        "/live/create",
        data={
            "mode": "player-vs-player",
            "right_owner_id": player_two_id,
            "generator": "deterministic",
            "seed": "12",
        },
    )
    assert create_response.status_code == 302
    first_submit = client_one.post(
        create_response.headers["Location"].replace(f"?viewer_id={player_one_id}", "/submit-turn"),
        data={
            "viewer_id": player_one_id,
            "generate_prompt": "",
            "play_1_card_id": "",
            "play_1_track": "fast",
            "play_2_card_id": "",
            "play_2_track": "slow",
        },
        follow_redirects=True,
    )
    assert first_submit.status_code == 200
    assert b"Waiting for the other seat" in first_submit.data

    second_submit = client_two.post(
        "/live/1/submit-turn",
        data={
            "viewer_id": player_two_id,
            "generate_prompt": "",
            "play_1_card_id": "",
            "play_1_track": "fast",
            "play_2_card_id": "",
            "play_2_track": "slow",
        },
        follow_redirects=True,
    )
    assert second_submit.status_code == 200
    assert b"Battle Log" in second_submit.data


def test_web_pvp_search_waits_then_matches(tmp_path: Path):
    app = _app(tmp_path)
    client_one = app.test_client()
    _register(client_one, tmp_path, "Queue One")
    waiting = client_one.post("/pvp/search", follow_redirects=True)
    assert waiting.status_code == 200
    assert b"Searching for another player" in waiting.data

    client_two = app.test_client()
    player_two_id = _register(client_two, tmp_path, "Queue Two")
    matched = client_two.post("/pvp/search", follow_redirects=False)
    assert matched.status_code == 302
    assert f"viewer_id={player_two_id}".encode() in matched.headers["Location"].encode()

    refresh = client_one.get("/", follow_redirects=True)
    assert refresh.status_code == 200
    assert b"Open match" in refresh.data


def test_web_can_save_deck(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    player_id = _register(client, tmp_path)
    deck_page = client.get(f"/decks/{player_id}")
    assert deck_page.status_code == 200
    assert b"Starter Deck" in deck_page.data
    assert b"data-deck-builder" in deck_page.data
    assert b"data-card-search" in deck_page.data
    assert b"deck_builder.js" in deck_page.data
    assert b"data-slot-drop" in deck_page.data
    deck_data = deck_builder_result(owner_id=player_id, db_path=tmp_path / "sutcg.sqlite3")
    base_card_id = deck_data["owned_bases"][0].card_id
    cards = deck_data["owned_cards"][:6]

    response = client.post(
        f"/decks/{player_id}/save",
        data={
            "name": "Aggro Deck",
            "base_card_id": base_card_id,
            "slot_1": cards[0].card_id,
            "slot_2": cards[1].card_id,
            "slot_3": cards[2].card_id,
            "slot_4": cards[3].card_id,
            "slot_5": cards[4].card_id,
            "slot_6": cards[5].card_id,
            "activate": "on",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"Aggro Deck" in response.data


def test_web_can_generate_card(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    player_id = _register(client, tmp_path)
    response = client.post(
        "/generate-card",
        data={
            "owner_id": player_id,
            "kind": "unit",
            "generator": "deterministic",
            "prompt": "A weird card that does one damage for every e in the enemy name",
            "save": "on",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"add_attack_per_enemy_name_char" in response.data
