import json
from base64 import b64encode
from pathlib import Path

from parambulator.app import ADDRESSED_DIR, FEEDBACK_DIR, PROJECT_ROOT, create_app


def _auth_headers(username: str, password: str) -> dict:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def test_feedback_submission():
    """Test that feedback can be submitted and saved."""
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    
    with app.test_client() as client:
        # Submit feedback
        response = client.post(
            "/feedback",
            json={
                "feedback_text": "This is a test feedback",
                "design": "design_1",
                "timestamp": "2026-02-05T12:00:00.000Z"
            },
            content_type="application/json"
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert data["status"] == "success"
        assert "id" in data
        
        # Verify file was created
        feedback_dir = PROJECT_ROOT / "data" / "feedback"
        feedback_files = list(feedback_dir.glob("feedback_*.json"))
        
        # Should have at least one feedback file (could have more from previous tests)
        assert len(feedback_files) >= 1
        
        # Read the most recent feedback file
        latest_file = max(feedback_files, key=lambda p: p.stat().st_mtime)
        with open(latest_file) as f:
            saved_feedback = json.load(f)
        
        assert saved_feedback["feedback_text"] == "This is a test feedback"
        assert saved_feedback["design"] == "design_1"
        assert "selected_element" not in saved_feedback
        assert "server_timestamp" in saved_feedback


def test_feedback_mark_addressed(monkeypatch):
    """Test that feedback can be marked as addressed and moved."""
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post(
            "/feedback",
            json={
                "feedback_text": "Address me",
                "design": "design_2",
                "timestamp": "2026-02-06T12:00:00.000Z",
            },
            content_type="application/json",
        )

        feedback_id = response.get_json()["id"]
        source_path = FEEDBACK_DIR / f"feedback_{feedback_id}.json"
        assert source_path.exists()

        mark_response = client.post(
            "/feedback/mark-addressed",
            json={"id": feedback_id},
            content_type="application/json",
            headers=_auth_headers("admin", "secret"),
        )
        assert mark_response.status_code == 200

        addressed_path = ADDRESSED_DIR / f"feedback_{feedback_id}.json"
        assert addressed_path.exists()
        assert not source_path.exists()

        with open(addressed_path) as f:
            data = json.load(f)
        assert data["addressed"] is True
        assert "addressed_timestamp" in data


def test_feedback_requires_text():
    """Feedback without text should return a 400 error and not be saved."""
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post(
            "/feedback",
            json={"feedback_text": "", "selected_element": ""},
            content_type="application/json",
        )

        assert response.status_code == 400


def test_feedback_list_requires_auth(monkeypatch):
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        client.post(
            "/feedback",
            json={"feedback_text": "Visible to admins", "design": "design_1"},
            content_type="application/json",
        )

        unauthorized = client.get("/feedback")
        assert unauthorized.status_code == 401

        authorized = client.get(
            "/feedback", headers=_auth_headers("admin", "secret")
        )
        assert authorized.status_code == 200
        payload = authorized.get_json()
        assert isinstance(payload.get("open"), list)
        assert isinstance(payload.get("addressed"), list)
