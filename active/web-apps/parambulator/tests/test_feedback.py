import json
from pathlib import Path

from parambulator.app import PROJECT_ROOT, create_app


def test_feedback_submission():
    """Test that feedback can be submitted and saved."""
    app = create_app()
    app.config["TESTING"] = True
    
    with app.test_client() as client:
        # Submit feedback
        response = client.post(
            "/feedback",
            json={
                "feedback_text": "This is a test feedback",
                "selected_element": "button#test-button",
                "page_url": "http://localhost:5000/",
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
        assert saved_feedback["selected_element"] == "button#test-button"
        assert "server_timestamp" in saved_feedback
