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

    monotonic_values = iter([10.0, 10.0, 22.0, 34.0])
    monkeypatch.setattr(ocr_pipeline.time, "monotonic", lambda: next(monotonic_values))

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

    assert progress_events[0] == {
        "stage": "rasterize",
        "status": "running",
        "message": "Rasterizing book.pdf at 300 DPI",
    }
    assert progress_events[1] == {
        "stage": "rasterize",
        "status": "complete",
        "message": "Rasterized 2 pages",
        "total_pages": 2,
    }
    assert progress_events[2]["stage"] == "ocr"
    assert progress_events[2]["completed_pages"] == 0
    assert progress_events[2]["estimated_remaining_seconds"] is None
    assert progress_events[3]["completed_pages"] == 1
    assert progress_events[3]["elapsed_seconds"] == 12.0
    assert progress_events[3]["estimated_remaining_seconds"] == 12.0
    assert progress_events[4]["status"] == "complete"
    assert progress_events[4]["completed_pages"] == 2
    assert progress_events[4]["estimated_remaining_seconds"] == 0.0


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
        lambda _observed, _bbox, raw_text, cleaned_text: (
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
        lambda _observed, _bbox, raw_text, cleaned_text: (
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
        lambda _obs, _bbox, raw_text, _cleaned: (
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
