"""
Playwright tests for feedback-driven improvements.

Tests verify all fixes from FEEDBACK_ACTION_PLAN.md:
- Feedback element selector improvements
- Version tracking in feedback
- Grid layout button-based editor
- Column configuration UI
- Design-4 contrast
- Header row parsing
"""

import json
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import pytest
from playwright.sync_api import expect
from werkzeug.serving import make_server

from parambulator.app import FEEDBACK_DIR, create_app


@contextmanager
def run_server():
    """Start a test server on a random port."""
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


class TestFeedbackImprovements:
    """Test fixes from commits 8b0ff52a (feedback selector + version)."""

    def test_feedback_element_selector_updates_button_text(self, page):
        """Test that element selector button text updates after selection."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Open feedback panel
            page.locator("#feedback-toggle").click()
            expect(page.locator("#feedback-panel")).to_be_visible()

            # Initial button text
            selector_btn = page.locator("#element-selector-btn")
            expect(selector_btn).to_contain_text("Click to select element")

            # Start element selection
            selector_btn.click()
            expect(selector_btn).to_contain_text("Selecting... Click element")

            # Click an element (not the feedback panel)
            page.locator("h1").first.click()

            # Button text should now show "Selected:"
            expect(selector_btn).to_contain_text("Selected:")

    def test_feedback_selector_avoids_feedback_panel(self, page):
        """Test that clicking feedback panel during selection doesn't break it."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Open feedback panel
            page.locator("#feedback-toggle").click()
            expect(page.locator("#feedback-panel")).to_be_visible()

            # Start element selection
            page.locator("#element-selector-btn").click()

            # Try clicking on the feedback panel itself (should be ignored)
            page.locator("#feedback-panel").click()

            # Feedback form should still be functional
            feedback_textarea = page.locator("#feedback-text")
            expect(feedback_textarea).to_be_editable()

    def test_feedback_includes_version_and_commit(self, page):
        """Test that feedback includes version and git_commit fields."""
        FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
        before = set(p.name for p in FEEDBACK_DIR.glob("feedback_*.json"))

        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Submit feedback
            page.locator("#feedback-toggle").click()
            page.locator("#feedback-text").fill("Test version tracking")
            page.locator("#feedback-form button[type=submit]").click()
            expect(page.locator("#feedback-success")).to_be_visible()

        # Find new feedback file
        new_file = None
        deadline = time.time() + 5
        while time.time() < deadline and new_file is None:
            after = set(p.name for p in FEEDBACK_DIR.glob("feedback_*.json"))
            created = list(after - before)
            if created:
                new_file = FEEDBACK_DIR / created[0]
                break
            time.sleep(0.1)

        assert new_file is not None
        with open(new_file) as f:
            data = json.load(f)

        # Check for version fields
        assert "version" in data
        assert "git_commit" in data
        assert data["version"] != ""
        assert data["git_commit"] != ""

        new_file.unlink(missing_ok=True)

    def test_feedback_clear_button_works(self, page):
        """Test that the clear selection button works."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.locator("#feedback-toggle").click()

            # Select an element
            page.locator("#element-selector-btn").click()
            page.locator("h1").first.click()

            # Clear button should be visible
            clear_btn = page.locator("#clear-selection-btn")
            expect(clear_btn).to_be_visible()

            # Click clear
            clear_btn.click()

            # Button text should reset
            expect(page.locator("#selector-btn-text")).to_contain_text(
                "Click to select element"
            )
            # Clear button should be hidden
            expect(clear_btn).to_be_hidden()


class TestGridLayoutImprovements:
    """Test fixes from commit 46685601 (button-based grid)."""

    def test_grid_has_button_interface(self, page):
        """Test that grid uses buttons instead of checkboxes."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Switch to layout tab
            page.get_by_role("button", name="Seat Layout").click()
            expect(page.locator("#tab-layout")).to_be_visible()

            # Wait for grid to render
            page.wait_for_timeout(500)

            # Check that grid has buttons (not checkboxes)
            grid_buttons = page.locator("#layout-grid-visual button")
            expect(grid_buttons.first).to_be_visible()

            # Old checkbox interface should not exist
            old_checkboxes = page.locator('input[type="checkbox"][name^="layout_cell_"]')
            expect(old_checkboxes.first).not_to_be_attached()

    def test_grid_toggle_button_changes_state(self, page):
        """Test that clicking a grid button toggles seat state."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Get first grid button
            first_btn = page.locator("#layout-grid-visual button").first
            initial_classes = first_btn.get_attribute("class")

            # Click to toggle
            first_btn.click()

            # Classes should have changed
            new_classes = first_btn.get_attribute("class")
            assert initial_classes != new_classes

    def test_add_row_top_button_works(self, page):
        """Test adding a row at the top."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Count initial rows
            rows_before = page.locator("#layout-grid-visual > div > div").count()

            # Click "Add Row Top"
            page.get_by_role("button", name="↑ Add Row Top").click()

            # Should have one more row
            rows_after = page.locator("#layout-grid-visual > div > div").count()
            assert rows_after == rows_before + 1

    def test_add_column_right_button_works(self, page):
        """Test adding a column on the right."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Count buttons in first row
            first_row = page.locator("#layout-grid-visual > div > div").first
            cols_before = first_row.locator("button").count()

            # Click "Add Col Right"
            page.get_by_role("button", name="→ Add Col Right").click()

            # Should have one more column
            cols_after = first_row.locator("button").count()
            assert cols_after == cols_before + 1

    def test_clear_all_button_works(self, page):
        """Test that Clear All removes all seats."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Click Clear All
            page.get_by_role("button", name="Clear All").click()

            # All buttons should show empty state (gray background)
            buttons = page.locator("#layout-grid-visual button")
            for i in range(min(5, buttons.count())):
                btn = buttons.nth(i)
                classes = btn.get_attribute("class")
                # Empty seats have slate/gray colors
                assert "slate" in classes or "gray" in classes

    def test_fill_all_button_works(self, page):
        """Test that Fill All adds all seats."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Clear first
            page.get_by_role("button", name="Clear All").click()

            # Then fill
            page.get_by_role("button", name="Fill All").click()

            # All buttons should show filled state (green background)
            buttons = page.locator("#layout-grid-visual button")
            for i in range(min(5, buttons.count())):
                btn = buttons.nth(i)
                classes = btn.get_attribute("class")
                # Filled seats have emerald/green colors
                assert "emerald" in classes or "green" in classes

    def test_text_editor_in_advanced_section(self, page):
        """Test that text layout editor is in collapsible advanced section."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Text editor should be in a details element
            details = page.locator("#tab-layout details")
            expect(details).to_be_visible()

            # Should have "Advanced" in the summary
            summary = details.locator("summary")
            expect(summary).to_contain_text("Advanced")

    def test_grid_syncs_to_text_editor(self, page):
        """Test that visual grid changes sync to text editor."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)

            # Clear all
            page.get_by_role("button", name="Clear All").click()

            # Open advanced section
            page.locator("#tab-layout details summary").click()

            # Check textarea value
            textarea = page.locator("#layout_map_input")
            value = textarea.input_value()

            # Should be all dots (empty seats)
            assert "X" not in value or value.count(".") > value.count("X")


class TestColumnConfigurationUI:
    """Test fixes from commit 6194238e (column config clarifications)."""

    def test_column_configuration_section_exists(self, page):
        """Test that column configuration UI is visible."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Should be visible on default People tab
            heading = page.get_by_text("Column Behavior & Constraints")
            expect(heading).to_be_visible()

    def test_column_type_selectors_exist(self, page):
        """Test that each column has type selector."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Check for column type selectors
            assert page.locator("#col-type-reading_level").is_visible()
            assert page.locator("#col-type-talkative").is_visible()
            assert page.locator("#col-type-iep_front").is_visible()
            assert page.locator("#col-type-avoid").is_visible()

    def test_column_weight_inputs_exist(self, page):
        """Test that each column has weight input."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Check for weight inputs
            assert page.locator("#col-weight-reading_level").is_visible()
            assert page.locator("#col-weight-talkative").is_visible()
            assert page.locator("#col-weight-iep_front").is_visible()
            assert page.locator("#col-weight-avoid").is_visible()

    def test_column_type_has_ignore_option(self, page):
        """Test that column type selector has 'Ignore' option."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Check first selector has ignore option
            selector = page.locator("#col-type-reading_level")
            selector.select_option("ignore")
            assert selector.input_value() == "ignore"

    def test_add_column_button_is_disabled(self, page):
        """Test that Add Column button exists but is disabled (future feature)."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Button should exist
            add_col_btn = page.get_by_text("+ Add Column (future)")
            expect(add_col_btn).to_be_visible()

            # Should be disabled
            assert add_col_btn.is_disabled()


class TestDesign4Contrast:
    """Test fixes from commit 24fe3462 (design-4 contrast)."""

    def test_design4_has_light_text_colors(self, page):
        """Test that design-4 uses light text colors for contrast."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Switch to design 4
            page.get_by_role("button", name="4").click()
            page.wait_for_timeout(300)

            # Check that design-4 class is applied
            design_div = page.locator(".design-4")
            expect(design_div).to_be_visible()

            # Check that light text colors are defined in style tag
            style_content = page.locator(".design-4 style").inner_text()
            assert "--text-primary" in style_content
            assert "--text-secondary" in style_content

    def test_design4_text_has_shadow(self, page):
        """Test that design-4 text has shadows for readability."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Switch to design 4
            page.get_by_role("button", name="4").click()
            page.wait_for_timeout(300)

            # Check for text-shadow in styles
            style_content = page.locator(".design-4 style").inner_text()
            assert "text-shadow" in style_content


class TestHeaderRowParsing:
    """Test fixes from commit 34814ff8 (duplicate header row)."""

    def test_people_table_does_not_show_header_as_data(self, page):
        """Test that header row is not rendered as a data row."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # Check the people table body
            tbody = page.locator("#people-table-body")

            # Get all name input values
            name_inputs = tbody.locator('input[data-field="name"]')

            # Check first few rows don't have "name" or "student" as values
            for i in range(min(3, name_inputs.count())):
                value = name_inputs.nth(i).input_value().lower()
                assert value != "name"
                assert value != "student"
                assert value != "reading_level"

    def test_people_table_parses_csv_correctly(self, page):
        """Test that CSV parsing skips headers correctly."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # The table should have actual people data, not header text
            first_row = page.locator("#people-table-body tr").first
            name_input = first_row.locator('input[data-field="name"]')

            # Should have a real name, not "name" or column headers
            value = name_input.input_value()
            assert len(value) > 0
            assert value.lower() not in ["name", "student", "reading_level", "talkative"]


class TestIntegrationScenarios:
    """Integration tests combining multiple improvements."""

    def test_complete_workflow_with_new_features(self, page):
        """Test complete workflow using all new features."""
        with run_server() as base_url:
            page.goto(base_url, wait_until="domcontentloaded")

            # 1. Modify column configuration
            page.locator("#col-type-reading_level").select_option("mix")
            page.locator("#col-weight-reading_level").fill("0.4")

            # 2. Modify grid layout
            page.get_by_role("button", name="Seat Layout").click()
            page.wait_for_timeout(500)
            page.get_by_role("button", name="↓ Add Row Bottom").click()

            # 3. Switch to different design
            page.get_by_role("button", name="2").click()
            page.wait_for_timeout(300)

            # 4. Submit feedback with element selection
            page.locator("#feedback-toggle").click()
            page.locator("#element-selector-btn").click()
            page.locator("h1").first.click()
            page.locator("#feedback-text").fill("Integration test feedback")
            
            # Capture the submit moment
            FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
            before = set(p.name for p in FEEDBACK_DIR.glob("feedback_*.json"))
            
            page.locator("#feedback-form button[type=submit]").click()
            expect(page.locator("#feedback-success")).to_be_visible()

            # Verify feedback was created with all fields
            time.sleep(1)
            after = set(p.name for p in FEEDBACK_DIR.glob("feedback_*.json"))
            if after > before:
                new_file = FEEDBACK_DIR / list(after - before)[0]
                with open(new_file) as f:
                    data = json.load(f)
                assert "version" in data
                assert "git_commit" in data
                assert data["feedback_text"] == "Integration test feedback"
                new_file.unlink(missing_ok=True)
