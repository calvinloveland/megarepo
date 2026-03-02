"""Pytest configuration for parambulator tests."""

import os
import shutil
import sys
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def _configure_playwright_node_runtime() -> None:
    """Use system Node on NixOS to run Playwright driver."""
    if os.environ.get("PLAYWRIGHT_NODEJS_PATH"):
        node_path = os.environ["PLAYWRIGHT_NODEJS_PATH"]
    else:
        node_path = shutil.which("node")
        if node_path:
            os.environ["PLAYWRIGHT_NODEJS_PATH"] = node_path

    if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        project_root = Path(__file__).resolve().parents[1]
        local_browsers = project_root / ".playwright_browsers"
        if local_browsers.exists():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(local_browsers)


def _detect_browser_executable() -> str | None:
    env_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
    if env_path:
        return env_path
    for binary in ("google-chrome-stable", "google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(binary)
        if path:
            return path
    return None


@pytest.fixture(scope="function")
def page():
    """Provide a Playwright page for each test."""
    _configure_playwright_node_runtime()
    browser_executable = _detect_browser_executable()
    with sync_playwright() as p:
        launch_options = {"headless": True}
        if browser_executable:
            launch_options["executable_path"] = browser_executable
        browser = p.chromium.launch(**launch_options)
        context = browser.new_context()
        page = context.new_page()
        yield page
        context.close()
        browser.close()
