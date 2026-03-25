"""Fixtures and helpers for Playwright UI tests."""

from __future__ import annotations

import os
import shutil
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict

import pytest
import yaml
try:
    from werkzeug.serving import make_server
except ImportError:
    make_server = None

from src.dashboard import create_app
from src.db import DataAccess


def _running_on_nixos() -> bool:
    """Return True when the current host is NixOS."""

    try:
        os_release = Path("/etc/os-release").read_text(encoding="utf-8")
    except OSError:
        return False
    return "ID=nixos" in os_release


def _default_playwright_browser_path() -> str | None:
    """Pick a system-managed Chromium executable when available."""

    explicit = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")
    if explicit:
        return explicit

    for candidate in ("google-chrome", "chromium", "chromium-browser"):
        browser_path = shutil.which(candidate)
        if browser_path:
            return browser_path
    return None


if _running_on_nixos():
    node_path = shutil.which("node")
    if node_path:
        os.environ.setdefault("PLAYWRIGHT_NODEJS_PATH", node_path)

pytest_plugins = ["pytest_playwright.pytest_playwright"]


@pytest.fixture(scope="session")
def browser_type_launch_args(pytestconfig: pytest.Config) -> Dict[str, object]:
    """Customize Playwright launch options for local runtime quirks."""

    launch_options: Dict[str, object] = {}
    if pytestconfig.getoption("--headed"):
        launch_options["headless"] = False

    browser_channel_option = pytestconfig.getoption("--browser-channel")
    if browser_channel_option:
        launch_options["channel"] = browser_channel_option

    slowmo_option = pytestconfig.getoption("--slowmo")
    if slowmo_option:
        launch_options["slow_mo"] = slowmo_option

    browser_path = _default_playwright_browser_path()
    if browser_path and _running_on_nixos():
        launch_options["executable_path"] = browser_path
        launch_options["args"] = ["--no-sandbox"]

    return launch_options


class _DashboardServer(threading.Thread):
    """Run the Flask dashboard inside a background thread."""

    def __init__(self, app, host: str, port: int) -> None:
        super().__init__(daemon=True)
        self._app = app
        self._host = host
        self._port = port
        self._server = make_server(host, port, app)
        self._context = app.app_context()

    def run(self) -> None:  # noqa: D401 - inherited docstring
        self._context.push()
        try:
            self._server.serve_forever()
        finally:
            self._context.pop()

    def stop(self) -> None:
        """Stop the running dashboard server."""
        self._server.shutdown()


def _write_dashboard_config(config_path: Path, host: str, port: int) -> None:
    config_data: Dict[str, Dict[str, object]] = {
        "dashboard": {
            "host": host,
            "port": port,
            "debug": False,
            "auto_open": False,
            "auto_start": False,
        },
        "dogfood": {
            "enabled": False,
        },
    }
    with config_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(config_data, handle, default_flow_style=False)


def _wait_for_server(url: str, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.1)
    raise RuntimeError(f"Dashboard did not become ready at {url}")


@pytest.fixture(name="dashboard_server", scope="session")
def _dashboard_server_fixture(tmp_path_factory: pytest.TempPathFactory):
    """Start a dashboard instance that Playwright tests can target."""
    if make_server is None:
        pytest.skip("werkzeug is required for dashboard UI tests")

    work_dir = tmp_path_factory.mktemp("full_auto_ci_ui")
    config_path = work_dir / "config.yml"
    db_path = work_dir / "database.sqlite"

    host = os.getenv("FULL_AUTO_CI_UI_TEST_HOST", "127.0.0.1")
    port = int(os.getenv("FULL_AUTO_CI_UI_TEST_PORT", "8123"))

    _write_dashboard_config(config_path, host, port)

    data_access = DataAccess(str(db_path))
    data_access.initialize_schema()

    app = create_app(config_path=str(config_path), db_path=str(db_path))

    os.environ.setdefault("FULL_AUTO_CI_OPEN_BROWSER", "0")
    os.environ.setdefault("FULL_AUTO_CI_START_DASHBOARD", "1")

    server = _DashboardServer(app, host, port)
    server.start()
    _wait_for_server(f"http://{host}:{port}/")

    try:
        yield {
            "base_url": f"http://{host}:{port}",
            "data_access": data_access,
            "config_path": str(config_path),
            "db_path": str(db_path),
        }
    finally:
        server.stop()
        server.join(timeout=5)


@pytest.fixture()
def dashboard_data_access(request):
    """Expose the dashboard's data access helper for test setup."""

    return request.getfixturevalue("dashboard_server")["data_access"]


@pytest.fixture(scope="session")
def base_url(dashboard_server):
    """Provide the dashboard base URL for pytest-playwright."""

    return dashboard_server["base_url"]
