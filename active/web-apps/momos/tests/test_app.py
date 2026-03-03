import json
from base64 import b64encode

from momos.app import (
    ADDRESSED_DIR,
    FEEDBACK_DIR,
    LANDING_STYLES,
    build_grocery_list,
    build_snapshot,
    create_app,
    extract_action_items,
    parse_calendar_entries,
    parse_kids,
)


def _auth_headers(username: str, password: str) -> dict:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def test_index_lists_landing_styles():
    app = create_app()
    app.testing = True
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "COZI: THE FAMILY OPERATING SYSTEM" in html
    for style in LANDING_STYLES.values():
        assert style["name"] in html


def test_each_landing_style_route_renders():
    app = create_app()
    app.testing = True
    client = app.test_client()
    for style_name, style in LANDING_STYLES.items():
        response = client.get(f"/landing/{style_name}")
        assert response.status_code == 200
        assert style["headline"] in response.get_data(as_text=True)


def test_extract_action_items_finds_due_dates():
    actions = extract_action_items(
        "Please sign and return permission slip by Friday. Bring snacks tomorrow."
    )
    assert len(actions) == 2
    assert actions[0]["due"] == "Friday"


def test_parse_calendar_entries_defaults_owner():
    entries = parse_calendar_entries("2026-03-08 | Piano recital")
    assert entries[0]["responsible"] == "Unassigned"


def test_build_grocery_list_detects_gaps():
    grocery = build_grocery_list(
        [{"item": "Milk", "current": 0, "minimum": 1}, {"item": "Bread", "current": 1, "minimum": 1}]
    )
    assert grocery == [{"item": "Milk", "needed": 1}]


def test_parse_kids_tracks_sizes():
    kids = parse_kids("Ava | shirt: M | shoes: 4Y")
    assert kids[0]["name"] == "Ava"
    assert "shirt: M" in kids[0]["sizes"]


def test_generate_route_renders_snapshot():
    app = create_app()
    app.testing = True
    client = app.test_client()
    response = client.post(
        "/generate",
        data={
            "school_emails_text": "Please sign permission slip by Friday.",
            "calendar_text": "2026-03-08 | Soccer practice | Dad",
            "pantry_text": "Milk | 0 | 1",
            "reminders_text": "2026-03-08 | Send form",
            "kids_text": "Ava | shirt: M | shoes: 4Y",
        },
    )
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Cozi Family Snapshot" in html
    assert "Soccer practice" in html
    assert "Milk (need 1)" in html


def test_build_snapshot_merges_due_actions_into_reminders():
    snapshot = build_snapshot(
        {
            "school_emails_text": "Refill medicine by March 10.",
            "calendar_text": "",
            "pantry_text": "",
            "reminders_text": "",
            "kids_text": "",
        }
    )
    assert any(reminder["when"] == "March 10" for reminder in snapshot["reminders"])


def test_feedback_submission_creates_file():
    app = create_app()
    app.testing = True
    client = app.test_client()
    response = client.post(
        "/feedback",
        json={
            "feedback_text": "Cozi feedback",
            "design": "cozi-workspace",
            "page_path": "/workspace",
            "page_title": "Cozi Workspace",
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    feedback_id = response.get_json()["id"]
    path = FEEDBACK_DIR / f"feedback_{feedback_id}.json"
    assert path.exists()
    with open(path, encoding="utf-8") as file_handle:
        data = json.load(file_handle)
    assert data["feedback_text"] == "Cozi feedback"
    assert data["app"] == "Cozi"
    assert data["page_path"] == "/workspace"
    assert data["page_title"] == "Cozi Workspace"
    path.unlink(missing_ok=True)


def test_feedback_list_requires_admin_auth(monkeypatch):
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    app = create_app()
    app.testing = True
    client = app.test_client()
    response = client.post(
        "/feedback",
        json={"feedback_text": "Needs review"},
        content_type="application/json",
    )
    feedback_id = response.get_json()["id"]
    unauthorized = client.get("/feedback")
    assert unauthorized.status_code == 401
    authorized = client.get("/feedback", headers=_auth_headers("admin", "secret"))
    assert authorized.status_code == 200
    open_ids = {entry["id"] for entry in authorized.get_json()["open"]}
    assert feedback_id in open_ids
    (FEEDBACK_DIR / f"feedback_{feedback_id}.json").unlink(missing_ok=True)
    (ADDRESSED_DIR / f"feedback_{feedback_id}.json").unlink(missing_ok=True)
