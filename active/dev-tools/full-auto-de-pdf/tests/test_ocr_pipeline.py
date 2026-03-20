from pathlib import Path
import sys
import types

import pytest
from PIL import Image

import json

from full_auto_de_pdf import ocr_pipeline
from full_auto_de_pdf.ocr_pipeline import (
    benchmark_local_ocr_against_archive,
    _build_paddleocr_reader,
    evaluate_ocr_preprocess_modes,
    ocr_page_images,
    ocr_pdf_with_tesseract,
)


def test_ocr_pdf_with_tesseract_requires_dependencies(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return None

    with pytest.raises(RuntimeError):
        ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=tmp_path / "out.txt",
            work_dir=tmp_path / "work",
            which=_which,
        )


def test_ocr_pdf_with_tesseract_happy_path(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    def _run(command: list[str], capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            pages_dir = work_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)
            (pages_dir / "page-1.png").write_bytes(b"x")
            (pages_dir / "page-2.png").write_bytes(b"y")
            return ""
        if command[0] == "tesseract":
            image_name = Path(command[1]).name
            if image_name == "page-1.png":
                return "Hello ﬁrst page"
            return "Second page text"
        raise AssertionError("unexpected command")

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        assert mode in {"basic", "dewarp"}
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )
    assert metrics["page_count"] == 2
    assert metrics["word_count"] >= 5
    assert "first" in output_path.read_text(encoding="utf-8").lower()
    artifacts_manifest = Path(str(metrics["page_artifacts_manifest"]))
    assert artifacts_manifest.exists()
    manifest_payload = json.loads(artifacts_manifest.read_text(encoding="utf-8"))
    assert len(manifest_payload["pages"]) == 2
    assert manifest_payload["progress"]["status"] == "complete"
    assert manifest_payload["progress"]["total_pages"] == 2
    assert manifest_payload["progress"]["completed_pages"] == 2
    assert manifest_payload["progress"]["current_page_index"] is None
    assert manifest_payload["progress"]["elapsed_seconds"] >= 0
    assert manifest_payload["progress"]["seconds_per_page"] is not None
    assert manifest_payload["progress"]["estimated_remaining_seconds"] == 0.0
    assert manifest_payload["progress"]["estimated_total_seconds"] is not None

    metrics_dewarp = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="dewarp",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )
    assert metrics_dewarp["page_count"] == 2

    metrics_no_artifacts = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        preprocess_image=_preprocess_image,
        emit_page_artifacts=False,
        which=_which,
    )
    assert "page_artifacts_manifest" not in metrics_no_artifacts


def test_ocr_pdf_with_tesseract_updates_page_manifest_during_run(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    manifest_path = work_dir / "page_ocr" / "manifest.json"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    def _run(command: list[str], capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            pages_dir = work_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)
            Image.new("L", (20, 20), color=255).save(pages_dir / "page-1.png")
            Image.new("L", (20, 20), color=255).save(pages_dir / "page-2.png")
            return ""
        if command[0] == "tesseract":
            assert capture_output is True
            image_name = Path(command[1]).name
            manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            if image_name == "page-1.png":
                assert manifest_payload["progress"]["status"] == "running"
                assert manifest_payload["progress"]["total_pages"] == 2
                assert manifest_payload["progress"]["completed_pages"] == 0
                assert manifest_payload["progress"]["current_page_index"] == 1
                assert manifest_payload["progress"]["estimated_remaining_seconds"] is None
                return "First page text"
            assert image_name == "page-2.png"
            assert manifest_payload["progress"]["status"] == "running"
            assert manifest_payload["progress"]["total_pages"] == 2
            assert manifest_payload["progress"]["completed_pages"] == 1
            assert manifest_payload["progress"]["current_page_index"] == 2
            assert manifest_payload["progress"]["estimated_remaining_seconds"] is not None
            assert (work_dir / "page_ocr" / "page-0001.txt").read_text(encoding="utf-8") == "First page text"
            return "Second page text"
        raise AssertionError("unexpected command")

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        preprocess_mode="none",
        which=_which,
    )

    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    assert manifest_payload["progress"]["status"] == "complete"
    assert manifest_payload["progress"]["total_pages"] == 2
    assert manifest_payload["progress"]["completed_pages"] == 2
    assert manifest_payload["progress"]["current_page_index"] is None
    assert manifest_payload["progress"]["estimated_remaining_seconds"] == 0.0


def test_ocr_pdf_with_tesseract_emits_progress_with_eta(tmp_path, monkeypatch) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    pdf_path.write_bytes(b"pdf")
    progress_events: list[dict[str, object]] = []

    monotonic_state = {"value": 10.0}

    def _monotonic() -> float:
        value = monotonic_state["value"]
        monotonic_state["value"] += 6.0
        return value

    monkeypatch.setattr(ocr_pipeline.time, "monotonic", _monotonic)

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    def _run(command: list[str], capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            pages_dir = work_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)
            Image.new("L", (20, 20), color=255).save(pages_dir / "page-1.png")
            Image.new("L", (20, 20), color=255).save(pages_dir / "page-2.png")
            return ""
        if command[0] == "tesseract":
            assert capture_output is True
            image_name = Path(command[1]).name
            return "First page text" if image_name == "page-1.png" else "Second page text"
        raise AssertionError("unexpected command")

    ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        preprocess_mode="none",
        which=_which,
        emit_page_artifacts=False,
        progress_callback=progress_events.append,
    )

    raster_events = [event for event in progress_events if event["stage"] == "rasterize"]
    ocr_events = [event for event in progress_events if event["stage"] == "ocr"]
    candidate_events = [event for event in progress_events if event["stage"] == "ocr-candidate"]

    assert raster_events[0] == {
        "stage": "rasterize",
        "status": "running",
        "message": "Rasterizing book.pdf at 300 DPI",
    }
    assert raster_events[1] == {
        "stage": "rasterize",
        "status": "complete",
        "message": "Rasterized 2 pages",
        "total_pages": 2,
    }
    assert ocr_events[0]["completed_pages"] == 0
    assert ocr_events[0]["estimated_remaining_seconds"] is None
    assert candidate_events
    assert candidate_events[0]["current_page_index"] == 1
    assert candidate_events[0]["candidate_index"] == 1
    assert candidate_events[0]["candidate_total"] >= 1
    assert ocr_events[1]["completed_pages"] == 1
    assert ocr_events[1]["elapsed_seconds"] > 0
    assert ocr_events[1]["estimated_remaining_seconds"] is not None
    assert ocr_events[-1]["status"] == "complete"
    assert ocr_events[-1]["completed_pages"] == 2
    assert ocr_events[-1]["estimated_remaining_seconds"] == 0.0


def test_ocr_pdf_with_tesseract_rejects_invalid_preprocess_mode(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    with pytest.raises(ValueError):
        ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=tmp_path / "out.txt",
            work_dir=tmp_path / "work",
            preprocess_mode="invalid",
            which=_which,
        )


def test_ocr_pdf_with_tesseract_rejects_invalid_engine(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    with pytest.raises(ValueError):
        ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=tmp_path / "out.txt",
            work_dir=tmp_path / "work",
            ocr_engine="invalid",
            which=_which,
        )


def test_ocr_pdf_with_tesseract_rejects_invalid_deskew_step(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    with pytest.raises(ValueError):
        ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=tmp_path / "out.txt",
            work_dir=tmp_path / "work",
            deskew_angle_step=0.0,
            which=_which,
        )


def test_ocr_pdf_with_tesseract_rejects_invalid_tesseract_psm(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    with pytest.raises(ValueError):
        ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=tmp_path / "out.txt",
            work_dir=tmp_path / "work",
            tesseract_psm="99",
            which=_which,
        )


def test_ocr_pdf_with_tesseract_auto_selects_best_mode_and_psm(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    def _run(command: list[str], capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            pages_dir = work_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)
            Image.new("L", (20, 20), color=255).save(pages_dir / "page-1.png")
            return ""
        if command[0] == "tesseract":
            assert capture_output is True
            mode = Path(command[1]).parent.name
            psm = command[-1]
            if mode == "scan" and psm == "6":
                return "The printed text is clean and readable"
            if mode == "deskew":
                return "The prlnted text 1s noisy"
            return "###"
        raise AssertionError("unexpected command")

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="auto",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert "clean and readable" in output_path.read_text(encoding="utf-8")
    assert metrics["mode_usage"] == {"scan": 1}
    assert metrics["tesseract_psm_usage"] == {"6": 1}
    manifest_payload = json.loads(
        Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8")
    )
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan"
    assert page_entry["tesseract_psm"] == 6
    assert len(page_entry["candidate_runs"]) == 18


def test_ocr_pdf_with_tesseract_auto_can_select_scan_local_threshold_mode(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    pdf_path.write_bytes(b"pdf")

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    def _run(command: list[str], capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            pages_dir = work_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)
            Image.new("L", (20, 20), color=255).save(pages_dir / "page-1.png")
            return ""
        if command[0] == "tesseract":
            assert capture_output is True
            mode = Path(command[1]).parent.name
            psm = command[-1]
            if mode == "scan-local-threshold" and psm == "6":
                return "The printed text is crisp and readable"
            if mode == "scan" and psm == "6":
                return "The printed text 1s crisp and readable"
            return "###"
        raise AssertionError("unexpected command")

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="auto",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert "crisp and readable" in output_path.read_text(encoding="utf-8")
    assert metrics["mode_usage"] == {"scan-local-threshold": 1}
    assert metrics["tesseract_psm_usage"] == {"6": 1}


def test_ocr_page_images_auto_can_use_inverse_render_tiebreak(monkeypatch, tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        return {
            "none": "Baseline page text",
            "scan": "Scan candidate text",
            "scan-local-threshold": "Threshold candidate text",
            "basic": "Basic garbage",
            "deskew": "Deskew garbage",
            "dewarp": "Dewarp garbage",
        }[mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_text",
        lambda text, _language, _lexicon: {
            "Baseline page text": 1000.0,
            "Scan candidate text": 980.0,
            "Threshold candidate text": 955.0,
            "Basic garbage": 100.0,
            "Deskew garbage": 90.0,
            "Dewarp garbage": -100.0,
        }[text],
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_candidate",
        lambda _observed, _bbox, text: (
            {
                "Baseline page text": 0.70,
                "Scan candidate text": 0.72,
                "Threshold candidate text": 0.80,
            }.get(text, 0.05),
            {"inverse_render_score": 0.0},
        ),
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="6",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Threshold candidate text"
    assert metrics["mode_usage"] == {"scan-local-threshold": 1}
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan-local-threshold"
    assert page_entry["selection_strategy"] == "auto-inverse-render-tiebreak"


def test_ocr_page_images_auto_prefers_near_best_scan_local_threshold_candidate(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        return {
            "none": "Baseline page text",
            "scan": "Scan candidate text",
            "scan-local-threshold": "Threshold candidate text",
            "basic": "Basic garbage",
            "deskew": "Deskew garbage",
            "dewarp": "Dewarp garbage",
        }[mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_text",
        lambda text, _language, _lexicon: {
            "Baseline page text": 920.0,
            "Scan candidate text": 1000.0,
            "Threshold candidate text": 960.0,
            "Basic garbage": 120.0,
            "Deskew garbage": 80.0,
            "Dewarp garbage": 40.0,
        }[text],
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="6",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Threshold candidate text"
    assert metrics["mode_usage"] == {"scan-local-threshold": 1}
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan-local-threshold"
    assert page_entry["selection_strategy"] == "auto-scan-local-threshold-preference"


def test_ocr_page_images_auto_scan_local_threshold_preference_skips_low_score_pages(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        return {
            "none": "Baseline page text",
            "scan": "Scan candidate text",
            "scan-local-threshold": "Threshold candidate text",
            "basic": "Basic garbage",
            "deskew": "Deskew garbage",
            "dewarp": "Dewarp garbage",
        }[mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_text",
        lambda text, _language, _lexicon: {
            "Baseline page text": 170.0,
            "Scan candidate text": 180.0,
            "Threshold candidate text": 160.0,
            "Basic garbage": 40.0,
            "Deskew garbage": 30.0,
            "Dewarp garbage": -20.0,
        }[text],
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_candidate",
        lambda _observed, _bbox, text: (
            {
                "Baseline page text": 0.68,
                "Scan candidate text": 0.72,
                "Threshold candidate text": 0.20,
            }.get(text, 0.05),
            {"inverse_render_score": 0.0},
        ),
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="6",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Scan candidate text"
    assert metrics["mode_usage"] == {"scan": 1}
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan"
    assert page_entry["selection_strategy"] == "auto-inverse-render-tiebreak"


def test_ocr_page_images_auto_tiebreak_ignores_distant_low_score_candidate(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        return {
            "none": "Baseline page text",
            "scan": "Scan candidate text",
            "scan-local-threshold": "Threshold candidate text",
            "basic": "Basic garbage",
            "deskew": "Deskew garbage",
            "dewarp": "Dewarp garbage",
        }[mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_text",
        lambda text, _language, _lexicon: {
            "Baseline page text": 1000.0,
            "Scan candidate text": 975.0,
            "Threshold candidate text": 955.0,
            "Basic garbage": 150.0,
            "Deskew garbage": 700.0,
            "Dewarp garbage": -100.0,
        }[text],
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_candidate",
        lambda _observed, _bbox, text: (
            {
                "Baseline page text": 0.70,
                "Scan candidate text": 0.68,
                "Threshold candidate text": 0.69,
                "Deskew garbage": 0.99,
            }.get(text, 0.05),
            {"inverse_render_score": 0.0},
        ),
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="6",
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Baseline page text"
    assert metrics["mode_usage"] == {"none": 1}


def test_ocr_page_images_inverse_render_reranks_candidates(monkeypatch, tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        psm = command[-1]
        if mode == "none" and psm == "3":
            return "The printed text is clean and readable"
        if mode == "scan" and psm == "6":
            return "Visual match sample"
        return "###"

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )

    def _fake_inverse_render_score(_observed, _bbox, text):  # noqa: ANN001, ANN202
        score = 0.9 if text == "Visual match sample" else 0.1
        return score, {"inverse_render_score": score}

    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_candidate",
        _fake_inverse_render_score,
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="auto",
        cleanup_lexicon_texts=("Captain Norris answered plainly",),
        inverse_render_rerank=True,
        inverse_render_top_k=2,
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Visual match sample"
    assert metrics["mode_usage"] == {"scan": 1}
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "inverse-render-rerank"
    assert page_entry["selected_preprocess_mode"] == "scan"
    assert page_entry["inverse_render_score"] == 0.9


def test_ocr_page_images_inverse_render_can_select_cleaned_variant(monkeypatch, tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        psm = command[-1]
        if mode == "scan" and psm == "6":
            return "Captain Norr is answered plainly"
        return "Fallback baseline"

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(input_path.read_bytes())
        assert mode in {"scan", "scan-local-threshold", "basic", "deskew", "dewarp"}

    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )

    def _fake_inverse_render_score(_observed, _bbox, text):  # noqa: ANN001, ANN202
        lowered = text.lower()
        if "captain norris answered plainly" in lowered:
            return 0.95, {"inverse_render_score": 0.95}
        if "captain norr is answered plainly" in lowered:
            return 0.2, {"inverse_render_score": 0.2}
        return 0.1, {"inverse_render_score": 0.1}

    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_candidate",
        _fake_inverse_render_score,
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="auto",
        tesseract_psm="auto",
        cleanup_lexicon_texts=("Captain Norris answered plainly",),
        inverse_render_rerank=True,
        inverse_render_top_k=2,
        run_command=_run,
        preprocess_image=_preprocess_image,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Captain Norris answered plainly"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "inverse-render-rerank"
    assert page_entry["inverse_render_text_variant"] == "cleaned"
    assert page_entry["inverse_render_score"] == 0.95


def test_maybe_inverse_render_rerank_limits_scoring_to_top_k(monkeypatch, tmp_path) -> None:
    image_path = tmp_path / "page.png"
    image_path.write_bytes(b"image")
    candidates = [
        ocr_pipeline.OCRCandidate(
            score=300.0,
            ocr_input_path=image_path,
            text="top candidate",
            metadata={"preprocess_mode": "scan"},
        ),
        ocr_pipeline.OCRCandidate(
            score=250.0,
            ocr_input_path=image_path,
            text="second candidate",
            metadata={"preprocess_mode": "scan-local-threshold"},
        ),
        ocr_pipeline.OCRCandidate(
            score=200.0,
            ocr_input_path=image_path,
            text="ignored candidate",
            metadata={"preprocess_mode": "none"},
        ),
    ]
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(
            inverse_render_rerank=True,
            inverse_render_top_k=2,
            apply_cleanup=False,
        ),
        preprocess_mode="auto",
    )
    seen_texts: list[str] = []

    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )

    def _fake_inverse_render_score(_observed, _bbox, text):  # noqa: ANN001, ANN202
        seen_texts.append(text)
        scores = {
            "top candidate": 0.3,
            "second candidate": 0.4,
            "ignored candidate": 1.0,
        }
        score = scores[text]
        return score, {"inverse_render_score": score}

    monkeypatch.setattr(ocr_pipeline, "_inverse_render_score_candidate", _fake_inverse_render_score)

    selected = ocr_pipeline._maybe_inverse_render_rerank(image_path, candidates, options)

    assert selected is not None
    assert selected.text == "second candidate"
    assert seen_texts == ["top candidate", "second candidate"]


def test_inverse_render_score_many_uses_process_pool(monkeypatch) -> None:
    observed_binary = Image.new("L", (10, 10), color=255)
    seen: dict[str, object] = {}

    class _FakeExecutor:
        def __init__(self, max_workers: int) -> None:
            seen["max_workers"] = max_workers

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, ANN204
            return False

        def map(self, fn, requests):  # noqa: ANN001, ANN201
            request_list = list(requests)
            seen["texts"] = [request.text for request in request_list]
            return [fn(request) for request in request_list]

    monkeypatch.setattr(ocr_pipeline, "ProcessPoolExecutor", _FakeExecutor)
    monkeypatch.setattr(
        ocr_pipeline,
        "_score_inverse_render_request",
        lambda request: (float(len(request.text)), {"inverse_render_score": float(len(request.text))}),
    )

    scores = ocr_pipeline._inverse_render_score_many(
        observed_binary,
        (0, 0, 10, 10),
        ["a", "bbbb"],
        workers=4,
    )

    assert seen["max_workers"] == 2
    assert seen["texts"] == ["a", "bbbb"]
    assert scores == [
        (1.0, {"inverse_render_score": 1.0}),
        (4.0, {"inverse_render_score": 4.0}),
    ]


def test_maybe_auto_inverse_render_tiebreak_filters_candidates_before_reranking(tmp_path, monkeypatch) -> None:
    image_path = tmp_path / "page.png"
    image_path.write_bytes(b"image")
    candidates = [
        ocr_pipeline.OCRCandidate(
            score=600.0,
            ocr_input_path=image_path,
            text="scan best",
            metadata={"preprocess_mode": "scan"},
        ),
        ocr_pipeline.OCRCandidate(
            score=560.0,
            ocr_input_path=image_path,
            text="threshold close",
            metadata={"preprocess_mode": "scan-local-threshold"},
        ),
        ocr_pipeline.OCRCandidate(
            score=540.0,
            ocr_input_path=image_path,
            text="basic disallowed",
            metadata={"preprocess_mode": "basic"},
        ),
        ocr_pipeline.OCRCandidate(
            score=400.0,
            ocr_input_path=image_path,
            text="too far behind",
            metadata={"preprocess_mode": "scan"},
        ),
    ]
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(),
        preprocess_mode="auto",
    )
    captured: dict[str, object] = {}
    sentinel = ocr_pipeline.OCRCandidate(
        score=560.0,
        ocr_input_path=image_path,
        text="threshold close",
        metadata={},
    )

    def _fake_rerank(_image_path, rerank_candidates, rerank_options):  # noqa: ANN001, ANN202
        captured["texts"] = [candidate.text for candidate in rerank_candidates]
        captured["top_k"] = rerank_options.core.inverse_render_top_k
        captured["rerank_enabled"] = rerank_options.core.inverse_render_rerank
        return sentinel

    monkeypatch.setattr(ocr_pipeline, "_maybe_inverse_render_rerank", _fake_rerank)

    selected = ocr_pipeline._maybe_auto_inverse_render_tiebreak(image_path, candidates, options)

    assert selected is sentinel
    assert captured["texts"] == ["scan best", "threshold close"]
    assert captured["top_k"] == 2
    assert captured["rerank_enabled"] is True


def test_ocr_page_images_verify_cleanup_spans_keeps_image_backed_short_fix(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        return "Captain not is answered plainly"

    monkeypatch.setattr(
        ocr_pipeline,
        "cleanup_ocr_text",
        lambda text, lexicon_texts=(): (
            "Captain Norris answered plainly" if "not is" in text else text
        ),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_evaluate_cleanup_span_replacement",
        lambda _observed, _bbox, raw_text, cleaned_text, **_kwargs: (
            True,
            {
                "accepted": True,
                "raw_inverse_render_score": 0.22,
                "cleaned_inverse_render_score": 0.41,
                "raw_local_inverse_render_score": 0.18,
                "cleaned_local_inverse_render_score": 0.56,
                "reason": "accepted",
            },
        )
        if raw_text == "Captain not is answered plainly"
        and cleaned_text == "Captain Norris answered plainly"
        else (_ for _ in ()).throw(AssertionError("unexpected cleanup span comparison")),
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        verify_cleanup_spans=True,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Captain Norris answered plainly"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    verifier = manifest_payload["pages"][0]["cleanup_span_verifier"]
    assert verifier["changes_considered"] == 1
    assert verifier["changes_kept"] == 1
    assert verifier["changes_reverted"] == 0
    assert verifier["decisions"][0]["cleaned_text"] == "Norris"


def test_ocr_page_images_verify_cleanup_spans_reverts_unverified_rare_word_change(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        return "The rareword appears again"

    monkeypatch.setattr(
        ocr_pipeline,
        "cleanup_ocr_text",
        lambda text, lexicon_texts=(): (
            "The rareward appears again" if "rareword" in text else text
        ),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_evaluate_cleanup_span_replacement",
        lambda _observed, _bbox, raw_text, cleaned_text, **_kwargs: (
            False,
            {
                "accepted": False,
                "raw_inverse_render_score": 0.35,
                "cleaned_inverse_render_score": 0.34,
                "raw_local_inverse_render_score": 0.48,
                "cleaned_local_inverse_render_score": 0.40,
                "reason": "insufficient-image-margin",
            },
        )
        if raw_text == "The rareword appears again" and cleaned_text == "The rareward appears again"
        else (_ for _ in ()).throw(AssertionError("unexpected cleanup span comparison")),
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        verify_cleanup_spans=True,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "The rareword appears again"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    verifier = manifest_payload["pages"][0]["cleanup_span_verifier"]
    assert verifier["changes_considered"] == 1
    assert verifier["changes_kept"] == 0
    assert verifier["changes_reverted"] == 1
    assert verifier["decisions"][0]["raw_text"] == "rareword"
    assert verifier["decisions"][0]["accepted"] is False


def test_ocr_page_images_verify_cleanup_spans_keeps_known_word_correction_when_margin_is_insufficient(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        return "[INlustration: 1894]"

    monkeypatch.setattr(
        ocr_pipeline,
        "cleanup_ocr_text",
        lambda text, lexicon_texts=(): (
            "[Illustration: 1894]" if "INlustration" in text else text
        ),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_evaluate_cleanup_span_replacement",
        lambda _observed, _bbox, raw_text, cleaned_text, **_kwargs: (
            False,
            {
                "accepted": False,
                "raw_inverse_render_score": 0.35,
                "cleaned_inverse_render_score": 0.34,
                "raw_local_inverse_render_score": 0.48,
                "cleaned_local_inverse_render_score": 0.40,
                "reason": "insufficient-image-margin",
            },
        )
        if raw_text == "[INlustration: 1894]" and cleaned_text == "[Illustration: 1894]"
        else (_ for _ in ()).throw(AssertionError("unexpected cleanup span comparison")),
    )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        verify_cleanup_spans=True,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "[Illustration: 1894]"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    verifier = manifest_payload["pages"][0]["cleanup_span_verifier"]
    assert verifier["changes_kept"] == 1
    assert verifier["changes_reverted"] == 0
    assert verifier["decisions"][0]["accepted"] is True
    assert verifier["decisions"][0]["reason"] == "accepted-known-word-correction"
    assert verifier["decisions"][0]["accepted_without_image_margin"] is True


def test_ocr_page_images_scan_mode_auto_enables_verify_cleanup_spans(
    monkeypatch,
    tmp_path,
) -> None:
    """verify_cleanup_spans is automatically enabled for scan preprocess modes."""
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        return "The rareword appears again"

    monkeypatch.setattr(
        ocr_pipeline,
        "cleanup_ocr_text",
        lambda text, lexicon_texts=(): (
            "The rareward appears again" if "rareword" in text else text
        ),
    )
    # Simulate verifier rejecting the cleanup change (image doesn't support it).
    monkeypatch.setattr(
        ocr_pipeline,
        "_evaluate_cleanup_span_replacement",
        lambda _obs, _bbox, raw_text, _cleaned, **_kwargs: (
            False,
            {
                "accepted": False,
                "raw_inverse_render_score": 0.35,
                "cleaned_inverse_render_score": 0.34,
                "raw_local_inverse_render_score": 0.48,
                "cleaned_local_inverse_render_score": 0.40,
                "reason": "insufficient-image-margin",
            },
        ),
    )

    def _preprocess_image(src: Path, dst: Path, mode: str, *_args, **_kwargs) -> None:  # noqa: ANN001
        import shutil
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, dst)

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="scan",
        tesseract_psm="6",
        # verify_cleanup_spans NOT passed — should auto-enable for scan mode
        run_command=_run,
        which=_which,
        preprocess_image=_preprocess_image,
    )

    # Verifier should have run and reverted the unsupported change.
    assert output_path.read_text(encoding="utf-8") == "The rareword appears again"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    verifier = manifest_payload["pages"][0]["cleanup_span_verifier"]
    assert verifier["enabled"] is True
    assert verifier["changes_reverted"] == 1


def test_ocr_page_images_verify_cleanup_spans_uses_hocr_bbox_hint(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)
    seen_hint: dict[str, tuple[int, int, int, int] | None] = {}

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        assert command[-1] == "hocr"
        return (
            "<html><body><span class='ocr_line'>"
            "<span class='ocrx_word' title='bbox 10 10 30 20; x_wconf 60'>raw</span>"
            "<span class='ocrx_word' title='bbox 35 10 60 20; x_wconf 60'>text</span>"
            "</span></body></html>"
        )

    monkeypatch.setattr(
        ocr_pipeline,
        "cleanup_ocr_text",
        lambda text, lexicon_texts=(): "new text" if text == "raw text" else text,
    )

    def _fake_evaluate(_obs, _bbox, _raw, _cleaned, hint_bbox=None, **_kwargs):  # noqa: ANN001, ANN202
        seen_hint["bbox"] = hint_bbox
        return False, {"accepted": False, "reason": "insufficient-image-margin"}

    monkeypatch.setattr(ocr_pipeline, "_evaluate_cleanup_span_replacement", _fake_evaluate)
    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        tesseract_output_format="hocr",
        verify_cleanup_spans=True,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "raw text"
    assert seen_hint["bbox"] == (10, 10, 30, 20)
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    decision = manifest_payload["pages"][0]["cleanup_span_verifier"]["decisions"][0]
    assert decision["hocr_hint_bbox"] == [10, 10, 30, 20]


def test_ocr_page_images_orientation_fallback_can_select_rotated_candidate(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        image_name = Path(command[1]).name
        if "rot180" in image_name:
            return "upright readable text"
        return "###"

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_text",
        lambda text, _lang, _lexicon: 100.0 if "upright readable text" in text else 1.0,
    )
    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        orientation_fallback=True,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "upright readable text"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "orientation-fallback"
    assert page_entry["orientation_angle"] == 180


def test_ocr_page_images_tiered_fallback_can_select_tiled_candidate(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (60, 900), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        image_name = Path(command[1]).name
        if "-tile-" in image_name:
            return "good tile text"
        return "###"

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_text",
        lambda text, _lang, _lexicon: 12.0 if "good tile text" in text else 1.0,
    )
    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        tiered_ocr_fallback=True,
        tiered_ocr_min_score=5.0,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8").splitlines()[0] == "good tile text"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "tiered-ocr-fallback"
    assert page_entry["tiered_fallback_applied"] is True
    assert page_entry["tiered_fallback_tile_count"] >= 2


def test_parse_hocr_text_and_metadata_extracts_text_and_confidence() -> None:
    hocr = """
    <html><body>
      <span class='ocr_line' id='line_1'>
        <span class='ocrx_word' title='bbox 0 0 10 10; x_wconf 98'>Hello</span>
        <span class='ocrx_word' title='bbox 11 0 30 10; x_wconf 65'>world</span>
      </span>
      <span class='ocr_line' id='line_2'>
        <span class='ocrx_word' title='bbox 0 12 20 22; x_wconf 90'>Again</span>
      </span>
    </body></html>
    """
    text, metadata = ocr_pipeline._parse_hocr_text_and_metadata(hocr)
    assert text == "Hello world\nAgain"
    assert metadata["hocr_word_count"] == 3
    assert float(metadata["hocr_confidence_mean"]) == pytest.approx((98 + 65 + 90) / 3.0)
    assert metadata["hocr_low_confidence_word_count"] == 1


def test_page_analysis_metadata_marks_sparse_early_page_as_front_matter() -> None:
    metadata = ocr_pipeline._page_analysis_metadata(
        "DRACULA\n\nCONTENTS ..... 7",
        {
            "selection_score": 720.0,
            "hocr_confidence_mean": 97.0,
            "hocr_low_confidence_ratio": 0.0,
            "hocr_line_entries_runtime": [
                {"text": "DRACULA", "bbox": [20, 20, 200, 50]},
                {"text": "CONTENTS ..... 7", "bbox": [20, 90, 260, 120]},
            ],
        },
        page_index=1,
        total_pages=120,
    )
    assert metadata["page_type"] == "front-matter"
    assert metadata["page_route"] == "front-matter"
    assert metadata["page_layout_region_counts"] == {"header": 1, "toc": 1}


def test_page_analysis_metadata_marks_noisy_body_page_low_quality() -> None:
    metadata = ocr_pipeline._page_analysis_metadata(
        "Hc scld thc tcarh | [ ] cffort",
        {
            "selection_score": 120.0,
            "hocr_confidence_mean": 68.0,
            "hocr_low_confidence_ratio": 0.45,
            "hocr_line_entries_runtime": [
                {"text": "Hc scld thc tcarh | [ ] cffort", "bbox": [20, 20, 380, 60]},
            ],
        },
        page_index=18,
        total_pages=120,
    )
    assert metadata["page_type"] == "sparse"
    assert metadata["page_quality_tier"] == "low"
    assert metadata["page_route"] == "body-low-quality"


def test_ocr_page_images_hocr_output_records_confidence_metadata(tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        assert command[-1] == "hocr"
        return (
            "<html><body><span class='ocr_line'>"
            "<span class='ocrx_word' title='bbox 0 0 10 10; x_wconf 98'>Hello</span>"
            "<span class='ocrx_word' title='bbox 11 0 30 10; x_wconf 88'>world</span>"
            "</span></body></html>"
        )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        tesseract_output_format="hocr",
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "Hello world"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["tesseract_output_format"] == "hocr"
    assert page_entry["hocr_word_count"] == 2
    assert page_entry["hocr_confidence_min"] == 88
    assert page_entry["page_quality_tier"] in {"high", "medium", "low"}
    assert metrics["page_analysis"]["page_quality_tier_counts"]


def test_ocr_page_images_targeted_retry_reprocesses_low_quality_page(monkeypatch, tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)
    seen_calls: list[tuple[str, str, str]] = []

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _fake_run_ocr_on_page(
        image_path,
        options,
        dependencies,
        preprocessed_dir,
        paddle_reader,
        **_kwargs,  # noqa: ANN001
    ):
        assert image_path == page_image
        seen_calls.append(
            (
                options.preprocess_mode,
                options.core.tesseract_psm,
                options.core.tesseract_output_format,
            )
        )
        if len(seen_calls) == 1:
            assert options.preprocess_mode == "basic"
            assert options.core.tesseract_psm == "6"
            assert options.core.tesseract_output_format == "text"
            return (
                page_image,
                "Hc scld thc tcarh | [ ] cffort",
                {
                    "preprocess_mode": "basic",
                    "selected_preprocess_mode": "basic",
                    "selection_score": 20.0,
                    "selection_strategy": "text-score",
                    "tesseract_psm": 6,
                    "tesseract_output_format": "text",
                    "hocr_confidence_mean": 60.0,
                    "hocr_low_confidence_ratio": 0.8,
                },
            )
        assert options.preprocess_mode == "auto"
        assert options.core.tesseract_psm == "auto"
        assert options.core.tesseract_output_format == "hocr"
        return (
            page_image,
            "He said the truth with effort",
            {
                "preprocess_mode": "scan-local-threshold",
                "selected_preprocess_mode": "scan-local-threshold",
                "selection_score": 260.0,
                "selection_strategy": "auto-scan-local-threshold-preference",
                "tesseract_psm": 4,
                "tesseract_output_format": "hocr",
                "hocr_confidence_mean": 96.0,
                "hocr_low_confidence_ratio": 0.0,
            },
        )

    monkeypatch.setattr(ocr_pipeline, "_run_ocr_on_page", _fake_run_ocr_on_page)

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        apply_cleanup=False,
        preprocess_mode="basic",
        tesseract_psm="6",
        run_command=lambda _command, _capture_output: "",
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "He said the truth with effort"
    assert seen_calls == [("basic", "6", "text"), ("auto", "auto", "hocr")]
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "targeted-page-retry"
    assert page_entry["targeted_page_retry"] == "applied"
    assert page_entry["targeted_page_retry_reason"] == "low-quality"
    assert metrics["page_analysis"]["targeted_page_retry_count"] == 1
    assert metrics["page_analysis"]["targeted_page_retry_reason_counts"] == {"low-quality": 1}


def test_ocr_page_images_confidence_aware_cleanup_skips_high_confidence_page(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        assert command[-1] == "hocr"
        return (
            "<html><body><span class='ocr_line'>"
            "<span class='ocrx_word' title='bbox 0 0 10 10; x_wconf 99'>raw</span>"
            "<span class='ocrx_word' title='bbox 11 0 30 10; x_wconf 98'>text</span>"
            "</span></body></html>"
        )

    monkeypatch.setattr(ocr_pipeline, "cleanup_ocr_text", lambda text, lexicon_texts=(): "CLEANED")
    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        tesseract_output_format="hocr",
        confidence_aware_cleanup=True,
        cleanup_high_confidence_threshold=95.0,
        run_command=_run,
        which=_which,
    )

    assert output_path.read_text(encoding="utf-8") == "raw text"
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    gate = manifest_payload["pages"][0]["cleanup_confidence_gate"]
    assert gate["enabled"] is True
    assert gate["action"] == "skipped-cleanup"


def test_score_ocr_text_uses_supplied_lexicon() -> None:
    noisy = "It teontains realistcsynthetic notes for eaders."
    unguided = ocr_pipeline._score_ocr_text(noisy, "eng", ())
    guided = ocr_pipeline._score_ocr_text(
        noisy,
        "eng",
        ("contains realistic synthetic notes for readers",),
    )
    assert guided > unguided


def test_preprocess_image_upsamples_small_pages(tmp_path) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "processed.png"
    Image.new("L", (120, 180), color=255).save(input_path)

    ocr_pipeline._preprocess_image(input_path, output_path, "basic", 170, 2.0, 0.5)

    with Image.open(output_path) as processed:
        assert processed.size == (240, 360)


def test_preprocess_image_scan_uses_otsu_threshold_and_3x_upsample(tmp_path) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "processed.png"
    image = Image.new("L", (120, 180), color=220)
    pixels = image.load()
    for x in range(50):
        for y in range(180):
            pixels[x, y] = 25
    image.save(input_path)

    ocr_pipeline._preprocess_image(input_path, output_path, "scan", 190, 2.0, 0.5)

    with Image.open(output_path) as processed:
        assert processed.size == (360, 540)
        assert set(processed.getdata()) <= {0, 255}
        assert processed.getpixel((30, 30)) == 0
        assert processed.getpixel((320, 30)) == 255


def test_preprocess_image_scan_local_threshold_uses_adaptive_threshold_and_3x_upsample(
    monkeypatch,
    tmp_path,
) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "processed.png"
    Image.new("L", (120, 180), color=220).save(input_path)
    seen: dict[str, object] = {}

    def _fake_adaptive_threshold(image, *, block_size, subtract_constant):  # noqa: ANN001, ANN202
        seen["size"] = image.size
        seen["block_size"] = block_size
        seen["subtract_constant"] = subtract_constant
        return image.point(lambda value: 255 if value >= 128 else 0)

    monkeypatch.setattr(
        ocr_pipeline,
        "_adaptive_gaussian_threshold",
        _fake_adaptive_threshold,
    )

    ocr_pipeline._preprocess_image(
        input_path,
        output_path,
        "scan-local-threshold",
        190,
        2.0,
        0.5,
    )

    with Image.open(output_path) as processed:
        assert processed.size == (360, 540)
        assert set(processed.getdata()) <= {0, 255}
    assert seen == {"size": (360, 540), "block_size": 51, "subtract_constant": 15}


def test_preprocess_image_scan_sauvola_uses_sauvola_threshold_and_3x_upsample(
    monkeypatch,
    tmp_path,
) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "processed.png"
    Image.new("L", (120, 180), color=220).save(input_path)
    seen: dict[str, object] = {}

    def _fake_sauvola(image, *, block_size, k, dynamic_range=128.0):  # noqa: ANN001, ANN202
        seen["size"] = image.size
        seen["block_size"] = block_size
        seen["k"] = k
        seen["dynamic_range"] = dynamic_range
        return image.point(lambda value: 255 if value >= 128 else 0)

    monkeypatch.setattr(ocr_pipeline, "_sauvola_threshold", _fake_sauvola)
    ocr_pipeline._preprocess_image(
        input_path,
        output_path,
        "scan-sauvola",
        190,
        2.0,
        0.5,
    )

    with Image.open(output_path) as processed:
        assert processed.size == (360, 540)
        assert set(processed.getdata()) <= {0, 255}
    assert seen == {"size": (360, 540), "block_size": 41, "k": 0.25, "dynamic_range": 128.0}


def test_preprocess_image_scan_morphology_uses_morphological_cleanup(
    monkeypatch,
    tmp_path,
) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "processed.png"
    Image.new("L", (120, 180), color=220).save(input_path)
    seen: dict[str, object] = {}

    def _fake_cleanup(binary_image, *, min_component_pixels):  # noqa: ANN001, ANN202
        seen["size"] = binary_image.size
        seen["min_component_pixels"] = min_component_pixels
        return binary_image

    monkeypatch.setattr(ocr_pipeline, "_morphological_cleanup_binary", _fake_cleanup)
    ocr_pipeline._preprocess_image(
        input_path,
        output_path,
        "scan-morphology",
        190,
        2.0,
        0.5,
    )

    with Image.open(output_path) as processed:
        assert processed.size == (360, 540)
        assert set(processed.getdata()) <= {0, 255}
    assert seen == {"size": (360, 540), "min_component_pixels": 6}


def test_scan_local_threshold_large_page_uses_overlapping_tiled_threshold(monkeypatch) -> None:
    image = Image.new("L", (2000, 1500), color=220)
    seen: dict[str, object] = {}

    def _fake_tiled(image, *, tile_size, overlap, threshold_fn):  # noqa: ANN001, ANN202
        seen["size"] = image.size
        seen["tile_size"] = tile_size
        seen["overlap"] = overlap
        return threshold_fn(image)

    monkeypatch.setattr(
        ocr_pipeline,
        "_threshold_image_in_overlapping_tiles",
        _fake_tiled,
    )
    binary = ocr_pipeline._binarize_preprocessed_candidate(image, "scan-local-threshold", 190)
    assert seen == {"size": (2000, 1500), "tile_size": 1024, "overlap": 192}
    assert set(binary.getdata()) <= {0, 255}


def test_otsu_threshold_splits_bimodal_histogram() -> None:
    image = Image.new("L", (100, 10), color=235)
    pixels = image.load()
    for x in range(35):
        for y in range(10):
            pixels[x, y] = 20

    threshold = ocr_pipeline._otsu_threshold(image)

    assert 20 <= threshold < 235


def test_adaptive_gaussian_threshold_handles_uneven_background() -> None:
    image = Image.new("L", (15, 15), color=255)
    pixels = image.load()
    for x in range(15):
        for y in range(15):
            pixels[x, y] = min(255, 120 + (x * 7) + (y * 2))
    for y in range(3, 12):
        pixels[7, y] = 45

    binary = ocr_pipeline._adaptive_gaussian_threshold(
        image,
        block_size=5,
        subtract_constant=7,
    )

    assert binary.getpixel((7, 7)) == 0
    assert binary.getpixel((2, 2)) == 255
    assert binary.getpixel((12, 12)) == 255


def test_inverse_render_score_prefers_matching_text(monkeypatch, tmp_path) -> None:
    image_path = tmp_path / "page.png"
    monkeypatch.setattr(ocr_pipeline, "_inverse_render_font_paths", lambda: ())
    rendered = ocr_pipeline._render_inverse_text_image(
        "Alpha beta\nGamma delta",
        (320, 240),
        (24, 24, 296, 216),
        font_path=None,
        font_size=18,
        offset_x=0,
        offset_y=0,
        rotation=0.0,
    )
    rendered.save(image_path)

    observed_binary, bbox = ocr_pipeline._normalize_scan_for_inverse_render(image_path)
    matching_score, _ = ocr_pipeline._inverse_render_score_candidate(
        observed_binary,
        bbox,
        "Alpha beta\nGamma delta",
    )
    mismatched_score, _ = ocr_pipeline._inverse_render_score_candidate(
        observed_binary,
        bbox,
        "Wrong words entirely",
    )

    assert matching_score > mismatched_score


def test_inverse_render_score_candidate_keeps_best_render_metadata(monkeypatch) -> None:
    observed_binary = Image.new("L", (20, 20), color=255)
    bbox = (0, 0, 20, 20)
    render_calls: list[tuple[str | None, int, int, int, float]] = []
    rotation_calls: list[float] = []

    monkeypatch.setattr(ocr_pipeline, "_inverse_render_font_paths", lambda: ("font-a", "font-b"))
    monkeypatch.setattr(ocr_pipeline, "_estimate_inverse_render_font_size", lambda _bbox, _lines: 12)

    def _fake_render(
        _text,
        _canvas_size,
        _bbox,
        *,
        font_path,
        font_size,
        offset_x,
        offset_y,
        rotation,
    ):  # noqa: ANN001, ANN202
        payload = (font_path, font_size, offset_x, offset_y, rotation)
        render_calls.append(payload)
        return payload

    def _fake_rotate(rendered_payload, rotation):  # noqa: ANN001, ANN202
        rotation_calls.append(rotation)
        return (*rendered_payload[:-1], rotation)

    def _fake_best_batch(_observed_binary, rendered_candidates, **_kwargs):  # noqa: ANN001, ANN202
        best_index = 0
        best_score = -1.0
        for index, candidate in enumerate(rendered_candidates):
            score = 1.0 if candidate == ("font-b", 14, 4, 0, 0.5) else 0.2
            if score > best_score:
                best_index = index
                best_score = score
        return best_index, best_score

    monkeypatch.setattr(ocr_pipeline, "_render_inverse_text_image", _fake_render)
    monkeypatch.setattr(ocr_pipeline, "_rotate_inverse_render_image", _fake_rotate)
    monkeypatch.setattr(ocr_pipeline, "_best_inverse_render_rendered_batch", _fake_best_batch)

    score, metadata = ocr_pipeline._inverse_render_score_candidate(observed_binary, bbox, "Example text")

    assert score == 1.0
    assert metadata["inverse_render_font_path"] == "font-b"
    assert metadata["inverse_render_font_size"] == 14
    assert metadata["inverse_render_offset_x"] == 4
    assert metadata["inverse_render_offset_y"] == 0
    assert metadata["inverse_render_rotation"] == 0.5
    assert ("font-a", 10, -4, -4, 0.0) in render_calls
    assert ("font-b", 14, 4, 0, 0.0) in render_calls
    assert rotation_calls.count(-0.5) > 0
    assert rotation_calls.count(0.5) > 0


def test_inverse_render_score_candidate_uses_local_crop_region(monkeypatch) -> None:
    observed_binary = Image.new("L", (200, 120), color=255)
    bbox = (60, 20, 140, 80)
    render_args: list[tuple[tuple[int, int], tuple[int, int, int, int]]] = []

    monkeypatch.setattr(ocr_pipeline, "_inverse_render_font_paths", lambda: ())
    monkeypatch.setattr(ocr_pipeline, "_estimate_inverse_render_font_size", lambda _bbox, _lines: 12)
    monkeypatch.setattr(ocr_pipeline, "_INVERSE_RENDER_SIZE_ADJUSTMENTS", (0,))
    monkeypatch.setattr(ocr_pipeline, "_INVERSE_RENDER_OFFSETS", (0,))
    monkeypatch.setattr(ocr_pipeline, "_INVERSE_RENDER_ROTATIONS", (0.0,))

    def _fake_render(
        _text,
        canvas_size,
        local_bbox,
        *,
        font_path,
        font_size,
        offset_x,
        offset_y,
        rotation,
    ):  # noqa: ANN001, ANN202
        render_args.append((canvas_size, local_bbox))
        assert font_path is None
        assert font_size == 12
        assert offset_x == 0
        assert offset_y == 0
        assert rotation == 0.0
        return Image.new("L", canvas_size, color=255)

    monkeypatch.setattr(ocr_pipeline, "_render_inverse_text_image", _fake_render)
    monkeypatch.setattr(
        ocr_pipeline,
        "_best_inverse_render_rendered_batch",
        lambda _observed, _rendered_candidates, **_kwargs: (0, 0.5),
    )

    score, metadata = ocr_pipeline._inverse_render_score_candidate(observed_binary, bbox, "Example text")

    expected_crop = ocr_pipeline._expand_bbox(
        bbox,
        observed_binary.size,
        ocr_pipeline._INVERSE_RENDER_SCORE_PADDING,
    )
    expected_canvas = (expected_crop[2] - expected_crop[0], expected_crop[3] - expected_crop[1])
    expected_local_bbox = (
        bbox[0] - expected_crop[0],
        bbox[1] - expected_crop[1],
        bbox[2] - expected_crop[0],
        bbox[3] - expected_crop[1],
    )

    assert score == 0.5
    assert metadata["inverse_render_bbox"] == list(bbox)
    assert render_args == [(expected_canvas, expected_local_bbox)]


def test_best_inverse_render_rendered_batch_uses_rust_accel(monkeypatch) -> None:
    observed = Image.new("L", (2, 2), color=255)
    observed.putpixel((0, 0), 0)
    rendered_candidates = [
        Image.new("L", (2, 2), color=255),
        Image.new("L", (2, 2), color=255),
    ]
    rendered_candidates[1].putpixel((0, 0), 0)

    class _FakeRustAccel:
        def best_iou_score(self, observed_bytes, candidates_bytes):  # noqa: ANN001
            assert observed_bytes == observed.tobytes()
            assert candidates_bytes == [candidate.tobytes() for candidate in rendered_candidates]
            return 1, 0.75

    monkeypatch.setattr(ocr_pipeline, "get_rust_inverse_render_accel", lambda: _FakeRustAccel())

    best_index, best_score = ocr_pipeline._best_inverse_render_rendered_batch(observed, rendered_candidates)

    assert best_index == 1
    assert best_score == 0.75


def test_inverse_render_score_candidate_renders_base_once_per_rotation_group(monkeypatch) -> None:
    observed_binary = Image.new("L", (20, 20), color=255)
    bbox = (0, 0, 20, 20)
    render_calls: list[tuple[str | None, int, int, int, float]] = []
    rotate_calls: list[float] = []

    monkeypatch.setattr(ocr_pipeline, "_inverse_render_font_paths", lambda: ("font-a",))
    monkeypatch.setattr(ocr_pipeline, "_estimate_inverse_render_font_size", lambda _bbox, _lines: 12)
    monkeypatch.setattr(ocr_pipeline, "_INVERSE_RENDER_SIZE_ADJUSTMENTS", (0,))
    monkeypatch.setattr(ocr_pipeline, "_INVERSE_RENDER_OFFSETS", (0,))
    monkeypatch.setattr(ocr_pipeline, "_INVERSE_RENDER_ROTATIONS", (-0.5, 0.0, 0.5))

    def _fake_render(
        _text,
        _canvas_size,
        _bbox,
        *,
        font_path,
        font_size,
        offset_x,
        offset_y,
        rotation,
    ):  # noqa: ANN001, ANN202
        payload = (font_path, font_size, offset_x, offset_y, rotation)
        render_calls.append(payload)
        return payload

    def _fake_rotate(rendered_payload, rotation):  # noqa: ANN001, ANN202
        rotate_calls.append(rotation)
        return (*rendered_payload[:-1], rotation)

    monkeypatch.setattr(ocr_pipeline, "_render_inverse_text_image", _fake_render)
    monkeypatch.setattr(ocr_pipeline, "_rotate_inverse_render_image", _fake_rotate)
    monkeypatch.setattr(
        ocr_pipeline,
        "_best_inverse_render_rendered_batch",
        lambda _observed, rendered_candidates, **_kwargs: (2, 0.9)
        if rendered_candidates[2] == ("font-a", 12, 0, 0, 0.5)
        else (0, 0.1),
    )

    score, metadata = ocr_pipeline._inverse_render_score_candidate(observed_binary, bbox, "Example text")

    assert score == 0.9
    assert metadata["inverse_render_rotation"] == 0.5
    assert render_calls == [("font-a", 12, 0, 0, 0.0)]
    assert rotate_calls == [-0.5, 0.5]


def test_binary_ink_iou_treats_only_black_pixels_as_ink() -> None:
    observed = Image.new("L", (2, 2), color=255)
    rendered = Image.new("L", (2, 2), color=255)

    observed.putpixel((0, 0), 0)
    observed.putpixel((1, 0), 128)
    rendered.putpixel((0, 0), 0)
    rendered.putpixel((0, 1), 0)
    rendered.putpixel((1, 0), 32)

    assert ocr_pipeline._binary_ink_iou(observed, rendered) == 0.5


def test_ocr_page_images_runs_without_pdftoppm(tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("RGB", (20, 20), color="white").save(page_image)

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        return "Page image OCR text"

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        which=_which,
    )

    assert metrics["page_count"] == 1
    assert "page image ocr text" in output_path.read_text(encoding="utf-8").lower()


def test_ocr_page_images_rejects_corrupt_inputs(tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    page_image.write_bytes(b"fake-image")

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(_command: list[str], _capture_output: bool) -> str:
        raise AssertionError("ocr command should not run for corrupt page images")

    with pytest.raises(ValueError, match="unreadable or corrupt image"):
        ocr_page_images(
            page_images=[page_image],
            output_text_path=tmp_path / "out.txt",
            work_dir=tmp_path / "work",
            run_command=_run,
            which=_which,
        )


def test_ocr_pdf_with_paddleocr_engine_path(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    pdf_path.write_bytes(b"pdf")
    seen_images: list[str] = []

    def _which(name: str) -> str | None:
        if name == "pdftoppm":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], _capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            pages_dir = work_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)
            (pages_dir / "page-1.png").write_bytes(b"x")
            return ""
        raise AssertionError("tesseract should not be called for paddleocr engine")

    def _factory(_language: str):
        def _reader(image_path: Path) -> str:
            seen_images.append(image_path.name)
            return "Paddle OCR text"

        return _reader

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        ocr_engine="paddleocr",
        run_command=_run,
        paddle_reader_factory=_factory,
        which=_which,
    )
    assert metrics["page_count"] == 1
    assert seen_images == ["page-1.png"]
    assert "paddle" in output_path.read_text(encoding="utf-8").lower()


def test_build_paddleocr_reader_falls_back_without_show_log(monkeypatch, tmp_path) -> None:
    class _FakePaddleOCR:
        def __init__(self, **kwargs):  # noqa: ANN003
            if "show_log" in kwargs:
                raise ValueError("Unknown argument: show_log")
            if "use_gpu" in kwargs:
                raise ValueError("Unknown argument: use_gpu")

        def ocr(self, _image_path: str, cls: bool = True):  # noqa: FBT001, FBT002
            assert cls is True
            return [[[None, ("paddle line one", 0.99)], [None, ("line two", 0.98)]]]

    fake_module = types.SimpleNamespace(PaddleOCR=_FakePaddleOCR)
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)

    reader = _build_paddleocr_reader("eng")
    text = reader(tmp_path / "page.png")
    assert "paddle line one" in text
    assert "line two" in text


def test_build_paddleocr_reader_falls_back_without_show_log_typeerror(monkeypatch, tmp_path) -> None:
    class _FakePaddleOCR:
        def __init__(self, **kwargs):  # noqa: ANN003
            if "show_log" in kwargs:
                raise TypeError("__init__() got an unexpected keyword argument 'show_log'")

        def ocr(self, _image_path: str, cls: bool = True):  # noqa: FBT001, FBT002
            assert cls is True
            return [[[None, ("paddle line one", 0.99)], [None, ("line two", 0.98)]]]

    fake_module = types.SimpleNamespace(PaddleOCR=_FakePaddleOCR)
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)

    reader = _build_paddleocr_reader("eng")
    text = reader(tmp_path / "page.png")
    assert "paddle line one" in text
    assert "line two" in text


def test_build_paddleocr_reader_supports_predict_output(monkeypatch, tmp_path) -> None:
    class _FakePaddleOCR:
        def __init__(self, **kwargs):  # noqa: ANN003
            assert kwargs["lang"] == "en"

        def predict(self, _image_path: str):  # noqa: ANN001
            return [{"rec_texts": ["predict line one", "", "line two"]}]

    fake_module = types.SimpleNamespace(PaddleOCR=_FakePaddleOCR)
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)

    reader = _build_paddleocr_reader("eng")
    text = reader(tmp_path / "page.png")
    assert "predict line one" in text
    assert "line two" in text


def test_build_paddleocr_reader_falls_back_when_cls_not_supported(monkeypatch, tmp_path) -> None:
    class _FakePaddleOCR:
        def __init__(self, **kwargs):  # noqa: ANN003
            assert kwargs["lang"] == "en"

        def ocr(self, _image_path: str):  # noqa: ANN001
            return [[[None, ("ocr line one", 0.99)], [None, ("line two", 0.98)]]]

    fake_module = types.SimpleNamespace(PaddleOCR=_FakePaddleOCR)
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)

    reader = _build_paddleocr_reader("eng")
    text = reader(tmp_path / "page.png")
    assert "ocr line one" in text
    assert "line two" in text


def test_evaluate_ocr_preprocess_modes_runs_all_modes(monkeypatch, tmp_path) -> None:
    input_pdf = tmp_path / "book.pdf"
    input_pdf.write_bytes(b"pdf")
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"
    reference_text_path = tmp_path / "reference.txt"
    reference_text_path.write_text("alpha beta gamma", encoding="utf-8")
    seen_modes: list[str] = []
    mode_text = {
        "none": "alpha beta gamma",
        "scan": "alpha beta gamma",
        "scan-local-threshold": "alpha beta gamma",
        "basic": "alpha beta",
        "deskew": "alpha typo",
        "dewarp": "alpha beta gamma",
    }

    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        seen_modes.append(kwargs["preprocess_mode"])
        assert kwargs["ocr_engine"] == "paddleocr"
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(mode_text[kwargs["preprocess_mode"]], encoding="utf-8")
        return {"page_count": 1, "word_count": 2, "character_count": 8}

    monkeypatch.setattr(ocr_pipeline, "ocr_pdf_with_tesseract", _fake_ocr_pdf_with_tesseract)
    report = evaluate_ocr_preprocess_modes(
        pdf_path=input_pdf,
        work_dir=work_dir,
        output_report_path=output_report,
        reference_text_path=reference_text_path,
        ocr_engine="paddleocr",
    )
    assert seen_modes == ["none", "scan", "scan-local-threshold", "basic", "deskew", "dewarp"]
    assert output_report.exists()
    assert "modes" in report
    assert report["best_mode"] == "none"
    assert report["mode_ranking"][0]["mode"] == "none"
    assert report["modes"]["none"]["output_text_path"].endswith("/mode_outputs/none.txt")


def test_benchmark_local_ocr_against_archive_selects_best_source(monkeypatch, tmp_path) -> None:
    input_pdf = tmp_path / "book.pdf"
    input_pdf.write_bytes(b"pdf")
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"

    def _fake_fetch_archive_ocr_text(_identifier: str) -> str:
        return "djvu reference"

    def _fake_fetch_archive_abbyy_text(_identifier: str) -> str:
        return "abbyy reference"

    def _fake_evaluate_ocr_preprocess_modes(**kwargs):  # noqa: ANN003
        assert kwargs["ocr_engine"] == "paddleocr"
        source_name = Path(kwargs["reference_text_path"]).stem.split("_")[-1]
        if source_name == "abbyy":
            ranking = [{"mode": "deskew", "wer": 0.10, "cer": 0.08}]
        else:
            ranking = [{"mode": "deskew", "wer": 0.20, "cer": 0.15}]
        return {"modes": {"deskew": {}}, "mode_ranking": ranking, "best_mode": "deskew"}

    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_archive_ocr_text", _fake_fetch_archive_ocr_text)
    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_archive_abbyy_text", _fake_fetch_archive_abbyy_text)
    monkeypatch.setattr(ocr_pipeline, "evaluate_ocr_preprocess_modes", _fake_evaluate_ocr_preprocess_modes)

    report = benchmark_local_ocr_against_archive(
        pdf_path=input_pdf,
        archive_identifier="book-id",
        output_report_path=output_report,
        work_dir=work_dir,
        archive_source_mode="best",
        ocr_engine="paddleocr",
    )
    assert report["selected_archive_source"] == "abbyy"
    assert output_report.exists()
