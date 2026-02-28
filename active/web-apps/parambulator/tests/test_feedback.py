import json
from base64 import b64encode
from pathlib import Path
from uuid import uuid4

import pytest

from parambulator.app import (
    ADDRESSED_DIR,
    FEEDBACK_DIR,
    PROJECT_ROOT,
    _parse_int,
    create_app,
    parse_layout_from_form,
    parse_form,
    sanitize_design,
)
from parambulator.scoring import seat_constraint_statuses


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
        assert saved_feedback["selected_element"] is None
        assert "server_timestamp" in saved_feedback
        assert saved_feedback["addressed"] is False
        assert saved_feedback["addressed_by_commit"] is None


def test_feedback_submission_remains_open_until_marked_addressed(monkeypatch):
    """Test that a newly submitted feedback item is not auto-addressed."""
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        submit_response = client.post(
            "/feedback",
            json={
                "feedback_text": "Should stay open",
                "design": "design_1",
                "timestamp": "2026-02-06T12:00:00.000Z",
            },
            content_type="application/json",
        )
        feedback_id = submit_response.get_json()["id"]

        list_response = client.get("/feedback", headers=_auth_headers("admin", "secret"))
        assert list_response.status_code == 200
        payload = list_response.get_json()
        open_ids = {entry["id"] for entry in payload["open"]}
        addressed_ids = {entry["id"] for entry in payload["addressed"]}
        assert feedback_id in open_ids
        assert feedback_id not in addressed_ids

        source_path = FEEDBACK_DIR / f"feedback_{feedback_id}.json"
        with open(source_path) as f:
            data = json.load(f)
        assert data["addressed"] is False
        assert data["addressed_by_commit"] is None
        assert "addressed_timestamp" not in data


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
            json={"id": feedback_id, "addressed_by_commit": "abc1234"},
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
        assert data["addressed_by_commit"] == "abc1234"
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


def test_generate_response_scripts_are_htmx_reswap_safe():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post("/generate", data={})

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "var BASE_COLUMNS = ['name', 'reading_level', 'talkative', 'iep_front', 'avoid', 'must_sit_by'];" in html
    assert "var layoutGrid = [];" in html
    assert 'id="pinned_seats_json"' in html


def test_generate_response_includes_layout_student_seat_counts():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post("/generate", data={})

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'id="layout-seat-student-count"' in html
    assert "window.updateLayoutCounts = updateLayoutCounts;" in html
    assert 'id="layout-template-controls"' in html
    assert 'id="layout-template-select"' in html
    assert 'id="layout-template-preview"' in html
    assert "var LAYOUT_TEMPLATES = {" in html
    assert 'id="onboarding-tutorial"' in html
    assert "function initializeOnboardingTutorial()" in html


def test_generate_response_includes_conflict_panel_markup():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post("/generate", data={})

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'id="chart-advanced-panel"' in html
    assert 'id="chart-conflicts-panel"' in html
    assert 'id="print-chart-btn"' in html
    assert "window.print()" in html


def test_generate_response_includes_people_tab_priority_ux_markers():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post("/generate", data={})

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'id="people-student-count"' in html
    assert 'id="add-person-bottom-btn"' in html
    assert 'id="column-type-help"' in html
    assert 'id="scoring-settings-panel"' in html
    assert 'id="constraint-config-list"' in html
    assert "initializeConstraintReordering()" in html
    assert "parseAvoidList(value)" in html
    assert "focusNextStudentRow(" in html
    assert 'id="col-type-must_sit_by"' in html
    assert "Must sit by" in html
    assert 'id="reading-level-enabled"' in html
    assert "onReadingLevelToggleChange()" in html
    assert 'id="constraint-priority-mode"' in html
    assert 'id="col-priority-avoid"' in html
    assert "config.__priority_mode = priorityMode;" in html


def test_generate_response_positions_undo_redo_above_feedback_button():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post("/generate", data={})

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "fixed bottom-24 left-6 z-40 flex gap-2 md:bottom-6 md:left-24" in html


def test_parse_form_preserves_reading_and_avoid_values_with_spaced_csv():
    form_data = parse_form(
        {
            "people_table": (
                "name, reading_level, talkative, iep_front, avoid\n"
                "Avery, high, no, no, Blake\n"
                "Blake, low, no, no, Avery"
            ),
            "rows": "1",
            "cols": "2",
            "iterations": "10",
        }
    )

    people = form_data["people"]
    assert people[0].reading_level == "high"
    assert people[0].avoid == ["Blake"]
    assert people[1].reading_level == "low"
    assert people[1].avoid == ["Avery"]

    statuses = seat_constraint_statuses(form_data["chart"], people, rows=1, cols=2)
    assert statuses[0][0][0]["label"] == "Reading mix"
    assert statuses[0][0][0]["status"] == "met"


def test_parse_form_rejects_unknown_avoid_names():
    with pytest.raises(ValueError, match="Unknown avoid-list names"):
        parse_form(
            {
                "people_table": (
                    "name, reading_level, talkative, iep_front, avoid\n"
                    "Avery, high, no, no, Missing Student"
                ),
                "rows": "1",
                "cols": "1",
            }
        )


def test_parse_form_rejects_unknown_must_sit_by_names():
    with pytest.raises(ValueError, match="Unknown must-sit-by names"):
        parse_form(
            {
                "people_table": (
                    "name, reading_level, talkative, iep_front, avoid, must_sit_by\n"
                    "Avery, high, no, no, , Missing Student"
                ),
                "rows": "1",
                "cols": "1",
            }
        )


def test_parse_form_defaults_to_reading_level_disabled_config():
    form_data = parse_form({})
    column_config = json.loads(form_data["column_config"])
    assert column_config["__priority_mode"] == "weight"
    reading_level_config = column_config["reading_level"]
    assert reading_level_config["type"] == "ignore"
    assert float(reading_level_config["weight"]) == 0.0


def test_sanitize_design_blocks_invalid_template_names():
    assert sanitize_design("design_3") == "design_3"
    assert sanitize_design("design_6") == "design_6"
    assert sanitize_design("design_7") == "design_7"
    assert sanitize_design("military") == "design_6"
    assert sanitize_design("nge") == "design_7"
    assert sanitize_design("../../partials/_feedback") == "design_1"
    assert sanitize_design("design_999") == "design_1"


def test_parse_form_invalid_design_falls_back_to_default():
    form_data = parse_form({"design": "../../../etc/passwd"})
    assert form_data["design"] == "design_1"


def test_generate_response_includes_military_and_nge_design_buttons():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.post("/generate", data={})

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "6 • Military" in html
    assert "7 • NGE" in html


def test_parse_form_applies_priority_mode_to_scoring_weights():
    column_config = {
        "__priority_mode": "priority",
        "reading_level": {"type": "mix", "weight": 0.5, "priority": 5},
        "talkative": {"type": "avoid", "weight": 0.1, "priority": 1},
        "iep_front": {"type": "directional", "weight": 0.1, "priority": 2},
        "avoid": {"type": "avoid", "weight": 0.1, "priority": 3},
        "must_sit_by": {"type": "group", "weight": 0.1, "priority": 4},
    }
    form_data = parse_form({"column_config": json.dumps(column_config)})
    scoring_weights = form_data["scoring_weights"]
    assert scoring_weights["talkative_spacing"] > scoring_weights["reading_mix"]
    assert scoring_weights["iep_front"] > scoring_weights["must_sit_by"]


def test_save_and_load_routes_round_trip():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    save_name = f"coverage-{uuid4().hex[:8]}"
    save_path = PROJECT_ROOT / "data" / "saves" / f"{save_name}.json"
    save_path.unlink(missing_ok=True)

    try:
        with app.test_client() as client:
            save_response = client.post("/save", data={"save_name": save_name})
            assert save_response.status_code == 200
            assert save_path.exists()
            save_html = save_response.get_data(as_text=True)
            assert "Saved as" in save_html
            assert save_name in save_html

            load_response = client.get(f"/load?name={save_name}")
            assert load_response.status_code == 200
            load_html = load_response.get_data(as_text=True)
            assert "Loaded" in load_html
            assert save_name in load_html
    finally:
        save_path.unlink(missing_ok=True)


def test_load_route_returns_404_for_missing_save():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.get("/load?name=missing-coverage-save")

    assert response.status_code == 404


def test_feedback_requires_admin_credentials_to_be_configured(monkeypatch):
    monkeypatch.delenv("FEEDBACK_ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("FEEDBACK_ADMIN_PASSWORD", raising=False)
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        response = client.get("/feedback")

    assert response.status_code == 503


def test_feedback_rejects_invalid_payload_and_length_limits():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        invalid_type = client.post("/feedback", json=[], content_type="application/json")
        assert invalid_type.status_code == 400
        assert "Invalid feedback payload" in invalid_type.get_data(as_text=True)

        too_long_text = client.post(
            "/feedback",
            json={"feedback_text": "x" * 5001, "selected_element": ""},
            content_type="application/json",
        )
        assert too_long_text.status_code == 400
        assert "must be < 5000" in too_long_text.get_data(as_text=True)

        too_long_element = client.post(
            "/feedback",
            json={"feedback_text": "valid", "selected_element": "y" * 501},
            content_type="application/json",
        )
        assert too_long_element.status_code == 400
        assert "Selected element must be < 500 characters" in too_long_element.get_data(
            as_text=True
        )


def test_mark_addressed_validates_input_and_not_found(monkeypatch):
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False

    with app.test_client() as client:
        missing_identifiers = client.post(
            "/feedback/mark-addressed",
            json={},
            content_type="application/json",
            headers=_auth_headers("admin", "secret"),
        )
        assert missing_identifiers.status_code == 400

        too_long_commit = client.post(
            "/feedback/mark-addressed",
            json={"id": "abc", "addressed_by_commit": "z" * 201},
            content_type="application/json",
            headers=_auth_headers("admin", "secret"),
        )
        assert too_long_commit.status_code == 400

        not_found = client.post(
            "/feedback/mark-addressed",
            json={"id": "not-a-real-feedback-id"},
            content_type="application/json",
            headers=_auth_headers("admin", "secret"),
        )
        assert not_found.status_code == 404


def test_parse_layout_from_form_supports_hidden_value_and_checkbox_formats():
    value_layout = parse_layout_from_form(
        {
            "layout_cell_0_0_value": "1",
            "layout_cell_0_1_value": "0",
            "layout_cell_1_0_value": "0",
            "layout_cell_1_1_value": "1",
        },
        rows=2,
        cols=2,
    )
    assert value_layout == [[True, False], [False, True]]

    checkbox_layout = parse_layout_from_form(
        {"layout_cell_0_0": "on", "layout_cell_1_1": "on"},
        rows=2,
        cols=2,
    )
    assert checkbox_layout == [[True, False], [False, True]]


def test_parse_int_clamps_and_falls_back():
    assert _parse_int("not-an-int", 5) == 5
    assert _parse_int("-3", 5, min_val=1, max_val=10) == 1
    assert _parse_int("99", 5, min_val=1, max_val=10) == 10
