"""Shared platform services: the on-device LLM and its reference game."""

from __future__ import annotations

from gamebase import registry
from gamebase.config import PROJECT_ROOT

REGISTRY_DIR = PROJECT_ROOT / "registry"


def test_ai_service_is_served(client):
    response = client.get("/static/services/ai.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["Content-Type"].lower()

    body = response.get_data(as_text=True)
    assert "GamebaseAI" in body
    assert "text-generation" in body
    assert "GAMEBASE_AI_RUNTIME" in body
    assert "ai-worker.js" in body
    # Keep the CPU-friendly default models discoverable by games.
    assert "SmolLM2" in body


def test_ai_worker_is_served(client):
    response = client.get("/static/services/ai-worker.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["Content-Type"].lower()

    body = response.get_data(as_text=True)
    assert "text-generation" in body
    assert "onmessage" in body


def test_sdk_exposes_lazy_ai_loader(client):
    body = client.get("/sdk/gamebase.js").get_data(as_text=True)
    assert "async ai(" in body
    assert "/static/services/ai.js" in body


def test_invite_me_in_manifest_is_valid():
    manifest = registry.read_manifest(REGISTRY_DIR / "invite-me-in")
    assert manifest.slug == "invite-me-in"
    # GamebaseAI needs the Cache API, which an opaque-origin sandbox lacks.
    assert manifest.capabilities["sandbox"] == "same-origin"
    assert manifest.leaderboard["label"] == "Night Score"
    assert {achievement["id"] for achievement in manifest.achievements} >= {
        "first-invite",
        "full-house",
    }
    # The LLM is a shared platform service, not a per-game capability.
    assert "service" not in manifest.capabilities
    assert "backend" not in manifest.capabilities


def test_invite_me_in_ships_required_assets():
    game_dir = REGISTRY_DIR / "invite-me-in"
    for name in ("index.html", "game.js", "style.css", "thumbnail.svg"):
        assert (game_dir / name).is_file(), f"missing {name}"

    html = (game_dir / "index.html").read_text(encoding="utf-8")
    assert "/sdk/gamebase.js" in html
    assert "/static/services/ai.js" in html
