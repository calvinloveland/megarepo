import json
from base64 import b64encode

from sub_day_generator.app import (
    ADDRESSED_DIR,
    FEEDBACK_DIR,
    build_plan,
    create_app,
    parse_periods,
    parse_student_notes,
)


def _auth_headers(username: str, password: str) -> dict:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def test_parse_periods_with_pipe_format():
    rows = parse_periods("8:00-8:30 | Math | Warmup\n9:00-9:30 | Reading | Group work")
    assert rows[0]["time"] == "8:00-8:30"
    assert rows[0]["subject"] == "Math"
    assert rows[1]["activity"] == "Group work"


def test_parse_student_notes_handles_missing_note():
    rows = parse_student_notes("Avery | Front row\nJordan")
    assert rows[0] == {"name": "Avery", "note": "Front row"}
    assert rows[1] == {"name": "Jordan", "note": ""}


def test_build_plan_trims_blank_lines():
    plan = build_plan(
        {
            "teacher_name": "Teacher",
            "class_name": "Class",
            "day_date": "",
            "welcome_note": "Hello",
            "periods_text": "8:00 | Math | Warmup\n",
            "students_text": "Avery | Front row\n",
            "must_do_text": "Take attendance\n\nCollect work\n",
            "routines_text": "Hands up for help\n",
            "emergency_text": "Front office\n",
        }
    )
    assert plan["must_do"] == ["Take attendance", "Collect work"]


def test_generate_route_renders_output():
    app = create_app()
    app.testing = True
    client = app.test_client()
    response = client.post(
        "/generate",
        data={
            "teacher_name": "Ms. Stone",
            "class_name": "Room 204",
            "day_date": "2026-03-03",
            "welcome_note": "Welcome!",
            "periods_text": "8:00 | Math | Page 5",
            "students_text": "Avery | Front row",
            "must_do_text": "Take attendance",
            "routines_text": "Call and response",
            "emergency_text": "Front office",
        },
    )
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Generated Plan" in html
    assert "Room 204" in html
    assert "Take attendance" in html


def test_feedback_submission_creates_file():
    app = create_app()
    app.testing = True
    client = app.test_client()
    response = client.post(
        "/feedback",
        json={"feedback_text": "Sub-day feedback", "design": "sub-day-generator"},
        content_type="application/json",
    )
    assert response.status_code == 200
    payload = response.get_json()
    feedback_id = payload["id"]
    path = FEEDBACK_DIR / f"feedback_{feedback_id}.json"
    assert path.exists()
    with open(path, encoding="utf-8") as file_handle:
        data = json.load(file_handle)
    assert data["feedback_text"] == "Sub-day feedback"
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
