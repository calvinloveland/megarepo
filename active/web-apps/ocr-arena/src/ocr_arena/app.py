"""OCR Arena — web demo for the full-auto-de-pdf pipeline.

A small Flask app that:
- Lists the books from the bundled benchmark corpus
- Runs the full pipeline (PDF -> OCR -> cleanup -> EPUB) on demand
  in a background thread per run
- Streams progress + per-stage logs to the browser via polling
- Serves the OCR text, EPUB, and accuracy report for download
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    render_template,
    request,
    send_file,
)

# Pipeline library is the full-auto-de-pdf toolkit.
from full_auto_de_pdf import benchmark_corpus as _benchmark_corpus_mod
from full_auto_de_pdf.benchmark import calculate_accuracy_metrics
from full_auto_de_pdf.epub import build_epub_from_ocr_file
from full_auto_de_pdf.ocr_pipeline import ocr_pdf_with_tesseract

# ── Paths ──────────────────────────────────────────────────────────
APP_DIR = Path(__file__).resolve().parent
# active/web-apps/ocr-arena/src/ocr_arena -> active/web-apps/ocr-arena
PROJECT_ROOT = APP_DIR.parent.parent
# active/web-apps/ocr-arena -> active
ACTIVE_DIR = PROJECT_ROOT.parent.parent
# The actual repo root is one above ``active``.
REPO_ROOT = ACTIVE_DIR.parent
# The actual repo root is one above ``active``.
REPO_ROOT = ACTIVE_DIR.parent
DEFAULT_CORPUS = (
    ACTIVE_DIR / "dev-tools" / "full-auto-de-pdf" / "data" / "benchmark-corpus-v3" / "manifest.json"
)
RUNS_DIR = APP_DIR / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)
BOOKS_CACHE = APP_DIR / "books_cache.json"

# ── Run state ──────────────────────────────────────────────────────
# Each run keeps its state in a JSON file under runs/<id>/state.json
# so it survives process restarts. A small in-process lock guards
# the state dicts that the API reads.


@dataclass
class RunStage:
    """Status of one pipeline stage (ocr, cleanup, metrics, epub)."""

    name: str
    status: str = "pending"  # pending | running | done | error
    started_at: float | None = None
    finished_at: float | None = None
    detail: str = ""


@dataclass
class RunState:  # pylint: disable=too-many-instance-attributes
    """Persisted state for a single OCR Arena run."""
    id: str
    book_id: str
    book_title: str
    status: str = "queued"  # queued | running | done | error
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    output_dir: str = ""
    ocr_text_path: str = ""
    epub_path: str = ""
    metrics_path: str = ""
    metrics: dict[str, float] = field(default_factory=dict)
    stages: list[RunStage] = field(default_factory=list)
    error: str = ""
    log_lines: list[str] = field(default_factory=list)

    def append_log(self, line: str) -> None:
        """Append a log line, keeping at most the last 200 entries."""
        self.log_lines.append(line)
        if len(self.log_lines) > 200:
            self.log_lines = self.log_lines[-200:]

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable snapshot of this state."""
        return asdict(self)


_RUN_LOCK = threading.Lock()
_RUN_THREADS: dict[str, threading.Thread] = {}


# ── Book discovery ─────────────────────────────────────────────────
def _load_books() -> list[dict[str, Any]]:
    """Load the benchmark corpus manifest, caching as JSON."""
    if BOOKS_CACHE.exists() and BOOKS_CACHE.stat().st_mtime > time.time() - 60:
        try:
            return json.loads(BOOKS_CACHE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    if not DEFAULT_CORPUS.exists():
        return []
    payload = json.loads(DEFAULT_CORPUS.read_text(encoding="utf-8"))
    books: list[dict[str, Any]] = []
    for entry in payload.get("books", []):
        page_paths = entry.get("page_image_paths", []) or []
        cover = page_paths[0] if page_paths else None
        books.append(
            {
                "id": str(entry["identifier"]),
                "title": str(entry["title"]),
                "gutenberg_id": int(entry.get("gutenberg_id", 0)),
                "page_count": int(entry.get("page_count", 0)),
                "reference_word_count": int(entry.get("reference_word_count", 0)),
                "pdf_path": str(entry["pdf_path"]),
                "cover_path": cover,
                "reference_text_path": str(entry["reference_text_path"]),
            }
        )
    BOOKS_CACHE.write_text(json.dumps(books, indent=2), encoding="utf-8")
    return books


def _corpus_root() -> Path:
    return DEFAULT_CORPUS.parent


def _resolve_path(rel_path: str) -> Path:
    """Resolve a manifest path to an absolute path.

    The ``benchmark-corpus-v3`` manifest stores paths like
    ``data/benchmark-corpus-v3/<book>/synthetic.pdf`` that are
    relative to ``active/dev-tools/full-auto-de-pdf`` (the
    project root where the corpus is built), not to the repo
    root or the corpus directory.
    """
    full_auto_de_pdf_root = REPO_ROOT / "active" / "dev-tools" / "full-auto-de-pdf"
    candidate = (full_auto_de_pdf_root / rel_path).resolve()
    return candidate


# ── Run lifecycle ─────────────────────────────────────────────────
def _new_run_state(book: dict[str, Any]) -> RunState:
    run_id = uuid.uuid4().hex[:12]
    state = RunState(
        id=run_id,
        book_id=book["id"],
        book_title=book["title"],
        output_dir=str(RUNS_DIR / run_id),
        ocr_text_path=str(RUNS_DIR / run_id / "ocr.txt"),
        epub_path=str(RUNS_DIR / run_id / "book.epub"),
        metrics_path=str(RUNS_DIR / run_id / "metrics.json"),
    )
    state.stages = [
        RunStage(name="ocr"),
        RunStage(name="cleanup"),
        RunStage(name="metrics"),
        RunStage(name="epub"),
    ]
    Path(state.output_dir).mkdir(parents=True, exist_ok=True)
    _save_state(state)
    return state


def _save_state(state: RunState) -> None:
    state_path = RUNS_DIR / state.id / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: write to a sibling temp file then rename. This
    # prevents the API from reading a half-written state.json while
    # the worker thread is still flushing.
    tmp_path = state_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(state.to_dict(), indent=2), encoding="utf-8")
    tmp_path.replace(state_path)


def _load_state(run_id: str) -> RunState:
    state_path = RUNS_DIR / run_id / "state.json"
    if not state_path.exists():
        raise FileNotFoundError(run_id)
    # Read the tmp + real path so we never see a half-written file even
    # if we lost the rename race by a few microseconds.
    for candidate in (state_path, state_path.with_suffix(".json.tmp")):
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
            break
        except (FileNotFoundError, json.JSONDecodeError):
            payload = None
            continue
    if payload is None:
        # The writer is still flushing: treat as missing rather than
        # crashing the API. The next poll will succeed.
        raise FileNotFoundError(run_id)
    state = RunState(
        id=payload["id"],
        book_id=payload["book_id"],
        book_title=payload["book_title"],
        status=payload.get("status", "queued"),
        created_at=payload.get("created_at", 0.0),
        finished_at=payload.get("finished_at"),
        output_dir=payload.get("output_dir", ""),
        ocr_text_path=payload.get("ocr_text_path", ""),
        epub_path=payload.get("epub_path", ""),
        metrics_path=payload.get("metrics_path", ""),
        metrics=payload.get("metrics", {}),
        stages=[RunStage(**s) for s in payload.get("stages", [])],
        error=payload.get("error", ""),
        log_lines=payload.get("log_lines", []),
    )
    return state


def _set_stage(state: RunState, name: str, status: str, detail: str = "") -> None:
    for stage in state.stages:
        if stage.name == name:
            stage.status = status
            stage.detail = detail
            if status == "running" and stage.started_at is None:
                stage.started_at = time.time()
            if status in ("done", "error"):
                stage.finished_at = time.time()
            break
    _save_state(state)


def _run_pipeline(state: RunState, book: dict[str, Any]) -> None:
    """Worker thread: OCR -> cleanup -> metrics -> EPUB."""
    try:
        with _RUN_LOCK:
            state.status = "running"
            _save_state(state)

        # ── Stage 1: OCR ─────────────────────────────────────────
        _set_stage(state, "ocr", "running", "Running Tesseract with scan-mode preprocessing")
        state.append_log(f"[ocr] starting Tesseract for {book['title']}")
        pdf_path = _resolve_path(book["pdf_path"])
        ocr_text_path = Path(state.ocr_text_path)
        work_dir = Path(state.output_dir) / "ocr_work"
        work_dir.mkdir(parents=True, exist_ok=True)
        ocr_started = time.monotonic()
        ocr_metrics = ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=ocr_text_path,
            work_dir=work_dir,
            language="eng",
            preprocess_mode="scan",
            tesseract_psm="6",
            predict_preprocess_mode=True,
            apply_cleanup=True,
            # Inverse-render verifier is slow; skip it on the public demo.
            verify_cleanup_spans=False,
            emit_page_artifacts=False,
        )
        ocr_elapsed = time.monotonic() - ocr_started
        state.append_log(
            f"[ocr] done in {ocr_elapsed:.1f}s — {ocr_metrics.get('word_count', 0)} words"
        )
        _set_stage(state, "ocr", "done", f"{ocr_elapsed:.1f}s")

        # ── Stage 2: cleanup (done inside ocr_pdf_with_tesseract) ─
        _set_stage(state, "cleanup", "running", "Cleanup runs as part of OCR")
        _set_stage(state, "cleanup", "done", "Cleanup applied with per-page text passes")

        # ── Stage 3: metrics ────────────────────────────────────
        _set_stage(state, "metrics", "running", "Computing CER / WER against reference text")
        ref_path = _resolve_path(book["reference_text_path"])
        ref_text = ref_path.read_text(encoding="utf-8")
        hyp_text = ocr_text_path.read_text(encoding="utf-8")
        metrics = calculate_accuracy_metrics(ref_text, hyp_text)
        state.metrics = {
            "char_accuracy": float(metrics.get("char_accuracy", 0.0)),
            "word_accuracy": float(metrics.get("word_accuracy", 0.0)),
            "char_count": int(metrics.get("hypothesis_char_count", 0)),
            "ref_char_count": int(metrics.get("reference_char_count", 0)),
            "word_count": int(metrics.get("hypothesis_word_count", 0)),
            "ref_word_count": int(metrics.get("reference_word_count", 0)),
        }
        Path(state.metrics_path).write_text(
            json.dumps(state.metrics, indent=2), encoding="utf-8"
        )
        state.append_log(
            f"[metrics] char_acc={state.metrics['char_accuracy']:.4f} "
            f"word_acc={state.metrics['word_accuracy']:.4f}"
        )
        _set_stage(state, "metrics", "done")

        # ── Stage 4: EPUB ────────────────────────────────────────
        _set_stage(state, "epub", "running", "Packaging EPUB3 with chapter nav")
        epub_path = Path(state.epub_path)
        build_epub_from_ocr_file(
            ocr_text_path=ocr_text_path,
            output_epub_path=epub_path,
            title=book["title"],
            language="en",
        )
        state.append_log(f"[epub] wrote {epub_path.name} ({epub_path.stat().st_size // 1024} KB)")
        _set_stage(state, "epub", "done")

        with _RUN_LOCK:
            state.status = "done"
            state.finished_at = time.time()
            _save_state(state)
    except Exception as exc:  # noqa: BLE001  pylint: disable=broad-exception-caught
        with _RUN_LOCK:
            state.status = "error"
            state.error = f"{type(exc).__name__}: {exc}"
            state.finished_at = time.time()
            _save_state(state)
        state.append_log(f"[error] {state.error}")
    finally:
        # The thread is done; drop our reference so it can be GC'd.
        _RUN_THREADS.pop(state.id, None)


# ── Flask app ─────────────────────────────────────────────────────
def create_app() -> Flask:
    """Build and return the OCR Arena Flask application.

    Routes are registered in-place; the function is idempotent so
    tests can construct a fresh app per case.
    """
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )

    @app.route("/")
    def index() -> str:
        books = _load_books()
        return render_template("index.html", books=books)

    @app.route("/api/books")
    def api_books() -> Response:
        return jsonify({"books": _load_books()})

    @app.route("/api/runs", methods=["POST"])
    def api_runs_create() -> Response:
        payload = request.get_json(silent=True) or {}
        book_id = payload.get("book_id")
        if not isinstance(book_id, str):
            return jsonify({"ok": False, "error": "book_id is required"}), 400
        book = next((b for b in _load_books() if b["id"] == book_id), None)
        if book is None:
            return jsonify({"ok": False, "error": f"Unknown book: {book_id}"}), 404
        state = _new_run_state(book)
        thread = threading.Thread(
            target=_run_pipeline, args=(state, book), daemon=True
        )
        with _RUN_LOCK:
            _RUN_THREADS[state.id] = thread
        thread.start()
        return jsonify({"ok": True, "run": state.to_dict()})

    @app.route("/api/runs/<run_id>")
    def api_runs_get(run_id: str) -> Response:
        try:
            state = _load_state(run_id)
        except FileNotFoundError:
            return jsonify({"ok": False, "error": "Run not found"}), 404
        return jsonify({"ok": True, "run": state.to_dict()})

    @app.route("/download/<run_id>/<kind>")
    def download(run_id: str, kind: str) -> Response:
        try:
            state = _load_state(run_id)
        except FileNotFoundError:
            abort(404)
        if state.status != "done":
            abort(409, description="Run not finished yet")
        if kind == "ocr":
            path = Path(state.ocr_text_path)
            if not path.exists():
                abort(404)
            return send_file(
                path,
                as_attachment=True,
                download_name=f"{state.book_id}.txt",
                mimetype="text/plain",
            )
        if kind == "epub":
            path = Path(state.epub_path)
            if not path.exists():
                abort(404)
            return send_file(
                path,
                as_attachment=True,
                download_name=f"{state.book_id}.epub",
                mimetype="application/epub+zip",
            )
        if kind == "metrics":
            path = Path(state.metrics_path)
            if not path.exists():
                abort(404)
            return send_file(
                path,
                as_attachment=True,
                download_name=f"{state.book_id}.metrics.json",
                mimetype="application/json",
            )
        abort(404)

    @app.route("/healthz")
    def healthz() -> Response:
        return jsonify({"ok": True, "books_loaded": len(_load_books())})

    return app


def main() -> None:
    """Run the dev server (called by ``python -m ocr_arena.app``)."""
    port = int(os.getenv("PORT", "5110"))
    host = os.getenv("HOST", "127.0.0.1")
    app = create_app()
    print(f"📚 OCR Arena at http://{host}:{port}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
