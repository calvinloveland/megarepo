from momos.app import (
    build_grocery_list,
    build_snapshot,
    create_app,
    extract_action_items,
    parse_calendar_entries,
    parse_kids,
)


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
    assert "Family Snapshot" in html
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
