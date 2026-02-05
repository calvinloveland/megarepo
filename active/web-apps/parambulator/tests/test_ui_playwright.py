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
        expect(page.get_by_role("heading", name="Seating chart")).to_be_visible()
