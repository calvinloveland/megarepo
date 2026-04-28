from pathlib import Path

from super_ultimate_trading_card_game.sim_api import deck_builder_result
from super_ultimate_trading_card_game.web import create_app


def _app(tmp_path: Path):
    return create_app({"TESTING": True, "SUTCG_DB_PATH": str(tmp_path / "sutcg.sqlite3")})


def test_web_index_renders_live_client(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert b"Create Live Game" in response.data
    assert b"Deck Builder" in response.data


def test_web_can_create_and_advance_live_ai_match(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
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
    create_response = client.post(
        "/live/create",
        data={
            "mode": "ai-vs-player",
            "left_owner_id": "player-one",
            "right_owner_id": "alpha",
            "generator": "deterministic",
            "seed": "11",
        },
    )
    assert create_response.status_code == 302
    detail_response = client.get(create_response.headers["Location"])
    assert detail_response.status_code == 200
    assert b"Viewer Hand" in detail_response.data
    assert b"Lock in turn" in detail_response.data

    submit_response = client.post(
        create_response.headers["Location"].replace("?viewer_id=player-one", "/submit-turn"),
        data={
            "viewer_id": "player-one",
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
    client = app.test_client()
    create_response = client.post(
        "/live/create",
        data={
            "mode": "player-vs-player",
            "left_owner_id": "player-one",
            "right_owner_id": "player-two",
            "generator": "deterministic",
            "seed": "12",
        },
    )
    assert create_response.status_code == 302
    first_submit = client.post(
        create_response.headers["Location"].replace("?viewer_id=player-one", "/submit-turn"),
        data={
            "viewer_id": "player-one",
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

    second_submit = client.post(
        f"/live/1/submit-turn",
        data={
            "viewer_id": "player-two",
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


def test_web_can_save_deck(tmp_path: Path):
    app = _app(tmp_path)
    client = app.test_client()
    deck_page = client.get("/decks/player-one")
    assert deck_page.status_code == 200
    assert b"Starter Deck" in deck_page.data
    deck_data = deck_builder_result(owner_id="player-one", db_path=tmp_path / "sutcg.sqlite3")
    base_card_id = deck_data["owned_bases"][0].card_id
    cards = deck_data["owned_cards"][:6]

    response = client.post(
        "/decks/player-one/save",
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
    response = client.post(
        "/generate-card",
        data={
            "owner_id": "player-one",
            "kind": "unit",
            "generator": "deterministic",
            "prompt": "A weird card that does one damage for every e in the enemy name",
            "save": "on",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"add_attack_per_enemy_name_char" in response.data
