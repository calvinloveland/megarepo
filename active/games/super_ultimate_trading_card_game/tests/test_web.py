from pathlib import Path

from super_ultimate_trading_card_game.web import create_app


def test_web_index_renders(tmp_path: Path):
    app = create_app({"TESTING": True, "SUTCG_DB_PATH": str(tmp_path / "sutcg.sqlite3")})
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert b"Run Match" in response.data


def test_web_can_run_match_and_show_detail(tmp_path: Path):
    app = create_app({"TESTING": True, "SUTCG_DB_PATH": str(tmp_path / "sutcg.sqlite3")})
    client = app.test_client()
    response = client.post(
        "/run-match",
        data={"left_id": "alpha", "right_id": "beta", "generator": "deterministic", "seed": "7"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"Battle Log" in response.data
    assert b"alpha" in response.data or b"beta" in response.data


def test_web_can_generate_card(tmp_path: Path):
    app = create_app({"TESTING": True, "SUTCG_DB_PATH": str(tmp_path / "sutcg.sqlite3")})
    client = app.test_client()
    response = client.post(
        "/generate-card",
        data={
            "owner_id": "alpha",
            "kind": "unit",
            "generator": "deterministic",
            "prompt": "A weird card that does one damage for every e in the enemy name",
            "save": "on",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"add_attack_per_enemy_name_char" in response.data
