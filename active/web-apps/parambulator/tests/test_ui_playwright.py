import threading
from contextlib import contextmanager

import pytest
from playwright.sync_api import expect
from werkzeug.serving import make_server

from parambulator.app import create_app


@contextmanager
def run_server():
    app = create_app()
    app.config["TESTING"] = True
    server = make_server("127.0.0.1", 0, app)
    port = server.server_port

    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_home_page_loads(page):
    with run_server() as base_url:
        page.goto(base_url, wait_until="domcontentloaded")

        expect(page).to_have_title("Parambulator")
        expect(page.get_by_text("Parambulator")).to_be_visible()
        # Check for tab navigation which indicates tabs are present
        expect(page.get_by_role("button", name="People & Constraints")).to_be_visible()
        expect(page.get_by_role("button", name="Seating Chart")).to_be_visible()


def test_interactive_people_table(page):
    """Test that the interactive people table works correctly."""
    with run_server() as base_url:
        page.goto(base_url, wait_until="domcontentloaded")
        
        # Should start on the People & Constraints tab
        expect(page.locator("#people-table")).to_be_visible()
        
        # Check that table has rows (should have default people)
        rows = page.locator("#people-table-body tr")
        initial_count = rows.count()
        assert initial_count >= 20  # At least 20 default people
        
        # Click "Add Person" button
        add_button = page.get_by_role("button", name="+ Add Person")
        add_button.click()
        
        # Should now have one more row
        expect(rows).to_have_count(initial_count + 1)
        
        # Fill in the new row
        new_row = rows.nth(initial_count)
        new_row.locator('input[data-field="name"]').fill("Test Person")
        new_row.locator('select[data-field="reading_level"]').select_option("high")
        new_row.locator('select[data-field="talkative"]').select_option("yes")
        
        # Verify hidden textarea was updated
        hidden_textarea = page.locator("#people_table_hidden")
        textarea_value = hidden_textarea.input_value()
        assert "Test Person" in textarea_value
