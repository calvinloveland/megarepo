"""Smoke tests for the OCR Arena Flask app.

These tests are intentionally small: they don't exercise the full
Tesseract pipeline (that takes 1-6 minutes per page). Instead they:

1. Boot the Flask app in-process via ``create_app`` + ``app.test_client``.
2. Verify the index, book list, and health endpoints respond.
3. Start a run, poll until it terminates (with a generous timeout so
   the Tesseract step can complete on a single page), and assert the
   run reaches ``status="done"`` with char/word accuracy fields.

Tests skip gracefully if the bundled benchmark corpus or the
``full_auto_de_pdf`` library can't be imported (e.g. on a clean CI
runner that hasn't fetched the corpus yet). The point of this file is
to keep the contract between the demo and the pipeline honest.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import pytest

# Make the package importable when running pytest from the repo root.
APP_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = APP_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

# Detect whether we have everything we need to run end-to-end.
try:
    from full_auto_de_pdf.ocr_pipeline import ocr_pdf_with_tesseract  # noqa: F401

    HAS_PIPELINE = True
except Exception:
    HAS_PIPELINE = False

CORPUS_MANIFEST = (
    APP_DIR.parent.parent
    / "dev-tools"
    / "full-auto-de-pdf"
    / "data"
    / "benchmark-corpus-v3"
    / "manifest.json"
)
HAS_CORPUS = CORPUS_MANIFEST.exists()

pytestmark = pytest.mark.skipif(
    not (HAS_PIPELINE and HAS_CORPUS),
    reason=(
        "OCR Arena smoke test requires the full-auto-de-pdf library "
        "and the bundled benchmark corpus to be present locally."
    ),
)


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Boot a fresh OCR Arena app, isolated to a temp RUNS_DIR."""
    # Redirect the runs dir into tmp_path so tests don't litter the repo.
    from ocr_arena import app as app_module

    monkeypatch.setattr(app_module, "RUNS_DIR", tmp_path / "runs", raising=False)
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert isinstance(body["books_loaded"], int)
    assert body["books_loaded"] >= 1


def test_index_renders_template(client):
    resp = client.get("/")
    assert resp.status_code == 200
    # The template embeds a known header and a book card container.
    body = resp.get_data(as_text=True)
    assert "OCR Arena" in body
    assert "book-card" in body or "books" in body


def test_api_books_returns_list(client):
    resp = client.get("/api/books")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "books" in body
    assert len(body["books"]) >= 1
    sample = body["books"][0]
    for key in ("id", "title", "page_count", "pdf_path", "reference_text_path"):
        assert key in sample


def test_static_assets_serve(client):
    """The template references /static/app.{css,js} and favicon.svg."""
    for path in ("/static/app.css", "/static/app.js", "/static/favicon.svg"):
        resp = client.get(path)
        assert resp.status_code == 200, f"missing asset: {path}"


def test_unknown_book_rejected(client):
    resp = client.post(
        "/api/runs",
        data=json.dumps({"book_id": "this-id-does-not-exist"}),
        content_type="application/json",
    )
    assert resp.status_code == 404
    assert resp.get_json()["ok"] is False


def test_missing_book_id_rejected(client):
    resp = client.post("/api/runs", data=json.dumps({}), content_type="application/json")
    assert resp.status_code == 400


def test_full_pipeline_run_completes(client):
    """End-to-end: start a run on the smallest book and wait for done."""
    books = client.get("/api/books").get_json()["books"]
    # Pick the smallest book to keep CI time reasonable.
    smallest = min(books, key=lambda b: (b["page_count"], b["reference_word_count"]))

    resp = client.post(
        "/api/runs",
        data=json.dumps({"book_id": smallest["id"]}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    run = resp.get_json()["run"]
    run_id = run["id"]
    assert run["status"] in {"queued", "running"}

    # Poll for up to 10 minutes (one Tesseract page can take several minutes).
    deadline = time.time() + 600
    final = run
    while time.time() < deadline:
        final = client.get(f"/api/runs/{run_id}").get_json()["run"]
        if final["status"] in {"done", "error"}:
            break
        time.sleep(2)

    assert final["status"] == "done", f"run did not complete: {final}"
    assert final["error"] == ""
    metrics = final["metrics"]
    assert 0.0 <= metrics["char_accuracy"] <= 1.0
    assert 0.0 <= metrics["word_accuracy"] <= 1.0
    assert metrics["char_count"] > 0
    assert metrics["word_count"] > 0

    # Downloads should now work.
    epub_resp = client.get(f"/download/{run_id}/epub")
    assert epub_resp.status_code == 200
    assert epub_resp.headers["Content-Type"].startswith("application/epub")
    assert epub_resp.data[:2] == b"PK"  # zip magic

    ocr_resp = client.get(f"/download/{run_id}/ocr")
    assert ocr_resp.status_code == 200
    assert ocr_resp.headers["Content-Type"].startswith("text/plain")
    assert len(ocr_resp.data) > 0

    metrics_resp = client.get(f"/download/{run_id}/metrics")
    assert metrics_resp.status_code == 200
    payload = metrics_resp.get_json()
    assert payload["char_accuracy"] == metrics["char_accuracy"]
    assert payload["word_accuracy"] == metrics["word_accuracy"]


def test_state_persists_across_app_restart(tmp_path, monkeypatch):
    """Re-loading state.json from disk should reconstruct the same run."""
    from ocr_arena import app as app_module

    monkeypatch.setattr(app_module, "RUNS_DIR", tmp_path / "runs", raising=False)
    flask_app = app_module.create_app()
    client = flask_app.test_client()

    books = client.get("/api/books").get_json()["books"]
    book = books[0]
    resp = client.post(
        "/api/runs",
        data=json.dumps({"book_id": book["id"]}),
        content_type="application/json",
    )
    run = resp.get_json()["run"]
    run_id = run["id"]

    # A second app instance reading the same RUNS_DIR should see the run.
    flask_app2 = app_module.create_app()
    client2 = flask_app2.test_client()
    fetched = client2.get(f"/api/runs/{run_id}").get_json()["run"]
    assert fetched["id"] == run_id
    assert fetched["book_id"] == book["id"]
