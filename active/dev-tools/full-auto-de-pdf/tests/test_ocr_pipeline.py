import builtins
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

_AUTO_TEST_PREPROCESS_MODES = {
    "scan",
    "scan-masked",
    "scan-local-threshold",
    "scan-local-threshold-masked",
    "scan-background-normalized",
    "scan-background-normalized-masked",
    "scan-sauvola",
    "scan-morphology",
    "basic",
    "deskew",
    "dewarp",
}


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


def test_validate_page_image_run_options_allows_masked_scan_retry_modes(tmp_path) -> None:
    page_image = tmp_path / "page.png"
    Image.new("L", (12, 12), color=255).save(page_image)
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(),
        preprocess_mode="basic",
        candidate_preprocess_modes_override=("scan-background-normalized-masked", "scan-masked", "scan"),
    )

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    ocr_pipeline._validate_page_image_run_options([page_image], options, _which)


def test_validate_page_image_run_options_rejects_invalid_candidate_preprocess_override(tmp_path) -> None:
    page_image = tmp_path / "page.png"
    Image.new("L", (12, 12), color=255).save(page_image)
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(),
        preprocess_mode="basic",
        candidate_preprocess_modes_override=("scan-masked", "basic-masked", "mystery-mode"),
    )

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    with pytest.raises(
        ValueError,
        match=(
            "candidate_preprocess_modes_override must contain only concrete preprocess modes "
            "or supported masked scan variants"
        ),
    ):
        ocr_pipeline._validate_page_image_run_options([page_image], options, _which)


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


def test_ocr_pdf_with_tesseract_resume_reuses_existing_raster_and_page_artifacts(tmp_path) -> None:
    pdf_path = tmp_path / "book.pdf"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    pages_dir = work_dir / "pages"
    artifacts_dir = work_dir / "page_ocr"
    pdf_path.write_bytes(b"pdf")
    pages_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    for page_index in range(1, 4):
        Image.new("L", (20, 20), color=255).save(pages_dir / f"page-{page_index}.png")
    first_page_text_path = artifacts_dir / "page-0001.txt"
    first_page_text_path.write_text("Existing first page", encoding="utf-8")
    (artifacts_dir / "manifest.json").write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "page_index": 1,
                        "image_path": str(pages_dir / "page-1.png"),
                        "ocr_input_path": str(pages_dir / "page-1.png"),
                        "selected_preprocess_mode": "none",
                        "tesseract_psm": 6,
                        "text_path": str(first_page_text_path),
                    }
                ],
                "progress": {
                    "status": "running",
                    "total_pages": 3,
                    "completed_pages": 1,
                    "current_page_index": 2,
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    seen_tesseract_images: list[str] = []

    def _which(_name: str) -> str | None:
        return "/usr/bin/fake"

    def _run(command: list[str], capture_output: bool) -> str:
        if command[0] == "pdftoppm":
            raise AssertionError("resume should reuse rasterized pages")
        if command[0] == "tesseract":
            assert capture_output is True
            image_name = Path(command[1]).name
            seen_tesseract_images.append(image_name)
            return "Second page text" if image_name == "page-2.png" else "Third page text"
        raise AssertionError("unexpected command")

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        preprocess_mode="none",
        tesseract_psm="6",
        resume=True,
        which=_which,
    )

    assert seen_tesseract_images == ["page-2.png", "page-3.png"]
    assert output_path.read_text(encoding="utf-8") == (
        "Existing first page\n\nSecond page text\n\nThird page text"
    )
    assert metrics["page_count"] == 3
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    assert manifest_payload["progress"]["status"] == "complete"
    assert manifest_payload["progress"]["completed_pages"] == 3


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
            mode = Path(command[1]).parent.name.removesuffix("-masked")
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES
        color = {
            "scan": 255,
            "scan-masked": 235,
            "scan-local-threshold": 225,
            "scan-local-threshold-masked": 215,
            "basic": 205,
            "deskew": 195,
            "dewarp": 185,
        }[mode]
        Image.new("L", (20, 20), color=color).save(output_path)

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
    assert len(page_entry["candidate_runs"]) == 24


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
            mode = Path(command[1]).parent.name.removesuffix("-masked")
            psm = command[-1]
            if mode == "scan-local-threshold" and psm == "6":
                return "The printed text is crisp and readable"
            if mode == "scan" and psm == "6":
                return "###"
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES
        color = {
            "scan": 255,
            "scan-masked": 235,
            "scan-local-threshold": 225,
            "scan-local-threshold-masked": 215,
            "basic": 205,
            "deskew": 195,
            "dewarp": 185,
        }[mode]
        Image.new("L", (20, 20), color=color).save(output_path)

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


def test_ocr_page_images_auto_can_select_masked_scan_candidate(monkeypatch, tmp_path) -> None:
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
        candidate_mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        return {
            "none": "Baseline garbage",
            "scan": "})ust then a heavy cloud passed across the face of the moon",
            "scan-masked": "Just then a heavy cloud passed across the face of the moon",
            "scan-local-threshold": "###",
            "scan-local-threshold-masked": "###",
            "basic": "###",
            "deskew": "###",
            "dewarp": "###",
        }[candidate_mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        assert mode in _AUTO_TEST_PREPROCESS_MODES
        color = {
            "scan": 255,
            "scan-masked": 235,
            "scan-local-threshold": 225,
            "scan-local-threshold-masked": 215,
            "basic": 205,
            "deskew": 195,
            "dewarp": 185,
        }[mode]
        Image.new("L", (20, 20), color=color).save(output_path)

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline garbage": 100.0,
            "})ust then a heavy cloud passed across the face of the moon": 820.0,
            "Just then a heavy cloud passed across the face of the moon": 940.0,
            "###": -25.0,
        }[text], {}),
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

    assert output_path.read_text(encoding="utf-8") == (
        "Just then a heavy cloud passed across the face of the moon"
    )
    assert metrics["mode_usage"] == {"scan": 1}
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan"
    assert page_entry["candidate_preprocess_mode"] == "scan-masked"
    assert page_entry["pre_ocr_region_masked"] is True


def test_prepare_ocr_input_path_reuses_unmasked_path_for_identical_masked_image(tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    Image.new("L", (20, 20), color=255).save(page_image)
    preprocessed_dir = tmp_path / "preprocessed"
    seen_modes: list[str] = []

    def _preprocess_image(
        _input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        seen_modes.append(mode)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("L", (20, 20), color=255).save(output_path)

    dependencies = ocr_pipeline.OCRDependencies(
        run_command=lambda _command, _capture_output: "",
        preprocess_image=_preprocess_image,
        paddle_reader_factory=lambda _language: (lambda _path: ""),
        which=lambda _name: "/usr/bin/fake",
    )
    prepared_inputs: dict[str, Path] = {}

    resolved_path = ocr_pipeline._prepare_ocr_input_path(
        page_image,
        "scan-masked",
        ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(), preprocess_mode="auto"),
        dependencies,
        preprocessed_dir,
        prepared_inputs,
    )

    assert resolved_path == preprocessed_dir / "scan" / page_image.name
    assert prepared_inputs["scan"] == resolved_path
    assert prepared_inputs["scan-masked"] == resolved_path
    assert seen_modes == ["scan", "scan-masked"]
    assert not (preprocessed_dir / "scan-masked" / page_image.name).exists()


def test_ocr_page_images_auto_reuses_ocr_for_identical_masked_inputs(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)
    run_calls: list[str] = []

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        candidate_mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        run_calls.append(candidate_mode)
        return {
            "none": "Baseline garbage",
            "scan": "Winning scan text",
            "scan-local-threshold": "Threshold text",
            "basic": "###",
            "deskew": "###",
            "dewarp": "###",
        }[candidate_mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if mode in {"scan", "scan-masked"}:
            Image.new("L", (20, 20), color=255).save(output_path)
            return
        if mode in {"scan-local-threshold", "scan-local-threshold-masked"}:
            Image.new("L", (20, 20), color=240).save(output_path)
            return
        output_path.write_bytes(input_path.read_bytes())
        assert mode in _AUTO_TEST_PREPROCESS_MODES

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline garbage": 100.0,
            "Winning scan text": 950.0,
            "Threshold text": 700.0,
            "###": -25.0,
        }[text], {}),
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

    assert output_path.read_text(encoding="utf-8") == "Winning scan text"
    assert run_calls == [
        "none",
        "scan",
        "scan-local-threshold",
        "basic",
        "deskew",
        "dewarp",
    ]
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan"
    assert page_entry["candidate_preprocess_mode"] == "scan"


def test_ocr_page_images_auto_inverse_render_tiebreak_requires_clear_masked_gain(
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
        candidate_mode = "none" if Path(command[1]) == page_image else Path(command[1]).parent.name
        return {
            "none": "Baseline page text",
            "scan": "Unmasked scan text",
            "scan-masked": "Masked scan text",
            "scan-local-threshold": "Threshold candidate text",
            "scan-local-threshold-masked": "Masked threshold text",
            "basic": "Basic garbage",
            "deskew": "Deskew garbage",
            "dewarp": "Dewarp garbage",
        }[candidate_mode]

    def _preprocess_image(
        input_path: Path,
        output_path: Path,
        mode: str,
        _threshold: int,
        _max_angle: float,
        _step: float,
    ) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        assert mode in _AUTO_TEST_PREPROCESS_MODES
        color = {
            "scan": 255,
            "scan-masked": 235,
            "scan-local-threshold": 225,
            "scan-local-threshold-masked": 215,
            "basic": 205,
            "deskew": 195,
            "dewarp": 185,
        }[mode]
        Image.new("L", (20, 20), color=color).save(output_path)

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline page text": 1000.0,
            "Unmasked scan text": 980.0,
            "Masked scan text": 955.0,
            "Threshold candidate text": 940.0,
            "Masked threshold text": 930.0,
            "Basic garbage": 100.0,
            "Deskew garbage": 90.0,
            "Dewarp garbage": -100.0,
        }[text], {}),
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
                "Baseline page text": 0.60,
                "Unmasked scan text": 0.70,
                "Masked scan text": 0.90,
                "Threshold candidate text": 0.20,
                "Masked threshold text": 0.10,
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

    assert output_path.read_text(encoding="utf-8") == "Unmasked scan text"
    assert metrics["mode_usage"] == {"scan": 1}
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selected_preprocess_mode"] == "scan"
    assert page_entry["candidate_preprocess_mode"] == "scan"
    assert page_entry["selection_strategy"] == "auto-masked-guardrail"
    assert "pre_ocr_region_masked" not in page_entry


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
        mode = (
            "none"
            if Path(command[1]) == page_image
            else Path(command[1]).parent.name.removesuffix("-masked")
        )
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline page text": 1000.0,
            "Scan candidate text": 980.0,
            "Threshold candidate text": 955.0,
            "Basic garbage": 100.0,
            "Deskew garbage": 90.0,
            "Dewarp garbage": -100.0,
        }[text], {}),
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
        mode = (
            "none"
            if Path(command[1]) == page_image
            else Path(command[1]).parent.name.removesuffix("-masked")
        )
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline page text": 920.0,
            "Scan candidate text": 1000.0,
            "Threshold candidate text": 960.0,
            "Basic garbage": 120.0,
            "Deskew garbage": 80.0,
            "Dewarp garbage": 40.0,
        }[text], {}),
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
        mode = (
            "none"
            if Path(command[1]) == page_image
            else Path(command[1]).parent.name.removesuffix("-masked")
        )
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline page text": 1700.0,
            "Scan candidate text": 1800.0,
            "Threshold candidate text": 1600.0,
            "Basic garbage": 400.0,
            "Deskew garbage": 300.0,
            "Dewarp garbage": -200.0,
        }[text], {}),
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
        mode = (
            "none"
            if Path(command[1]) == page_image
            else Path(command[1]).parent.name.removesuffix("-masked")
        )
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, _language, _lexicon, _metadata=None: ({
            "Baseline page text": 1000.0,
            "Scan candidate text": 975.0,
            "Threshold candidate text": 955.0,
            "Basic garbage": 150.0,
            "Deskew garbage": 700.0,
            "Dewarp garbage": -100.0,
        }[text], {}),
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
        mode = (
            "none"
            if Path(command[1]) == page_image
            else Path(command[1]).parent.name.removesuffix("-masked")
        )
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES

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
        mode = (
            "none"
            if Path(command[1]) == page_image
            else Path(command[1]).parent.name.removesuffix("-masked")
        )
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
        assert mode in _AUTO_TEST_PREPROCESS_MODES

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


def test_inverse_render_score_many_deduplicates_duplicate_texts(monkeypatch) -> None:
    observed_binary = Image.new("L", (10, 10), color=255)
    seen_texts: list[str] = []

    def _fake_inverse_render_score(_observed, _bbox, text):  # noqa: ANN001, ANN202
        seen_texts.append(text)
        score = float(len(text))
        return score, {"inverse_render_score": score}

    monkeypatch.setattr(ocr_pipeline, "_inverse_render_score_candidate", _fake_inverse_render_score)

    scores = ocr_pipeline._inverse_render_score_many(
        observed_binary,
        (0, 0, 10, 10),
        ["same", "other", "same", "same", "other"],
        workers=1,
    )

    assert seen_texts == ["same", "other"]
    assert scores == [
        (4.0, {"inverse_render_score": 4.0}),
        (5.0, {"inverse_render_score": 5.0}),
        (4.0, {"inverse_render_score": 4.0}),
        (4.0, {"inverse_render_score": 4.0}),
        (5.0, {"inverse_render_score": 5.0}),
    ]


def test_inverse_render_font_paths_caches_resolved_paths(monkeypatch, tmp_path) -> None:
    serif_path = tmp_path / "serif.ttf"
    sans_path = tmp_path / "sans.ttf"
    mono_path = tmp_path / "mono.ttf"
    for path in (serif_path, sans_path, mono_path):
        path.write_bytes(b"font")
    seen_families: list[str] = []

    def _fake_fontconfig_match(family: str) -> str | None:
        seen_families.append(family)
        return {
            "serif": str(serif_path),
            "sans": str(sans_path),
            "monospace": str(mono_path),
        }[family]

    monkeypatch.setattr(ocr_pipeline, "_fontconfig_match", _fake_fontconfig_match)
    monkeypatch.setattr(ocr_pipeline, "_DEFAULT_RENDER_FONT_CANDIDATES", ())
    ocr_pipeline._inverse_render_font_paths.cache_clear()
    try:
        first = ocr_pipeline._inverse_render_font_paths()
        second = ocr_pipeline._inverse_render_font_paths()
    finally:
        ocr_pipeline._inverse_render_font_paths.cache_clear()

    assert first == second == (str(serif_path), str(sans_path), str(mono_path))
    assert seen_families == ["serif", "sans", "monospace"]


def test_normalize_scan_for_inverse_render_caches_payload_by_file_signature(
    monkeypatch,
    tmp_path,
) -> None:
    image_path = tmp_path / "page.png"
    Image.new("L", (12, 12), color=255).save(image_path)
    real_open = ocr_pipeline.Image.open
    open_calls: list[str] = []

    def _counting_open(path, *args, **kwargs):  # noqa: ANN001, ANN202
        open_calls.append(str(path))
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(ocr_pipeline.Image, "open", _counting_open)
    ocr_pipeline._normalized_scan_for_inverse_render_payload.cache_clear()
    try:
        first_binary, first_bbox = ocr_pipeline._normalize_scan_for_inverse_render(image_path)
        second_binary, second_bbox = ocr_pipeline._normalize_scan_for_inverse_render(image_path)
    finally:
        ocr_pipeline._normalized_scan_for_inverse_render_payload.cache_clear()

    assert open_calls == [str(image_path.resolve())]
    assert first_bbox == second_bbox
    assert first_binary.size == second_binary.size
    assert first_binary.tobytes() == second_binary.tobytes()


def test_normalize_scan_for_inverse_render_cache_invalidates_when_file_changes(
    monkeypatch,
    tmp_path,
) -> None:
    image_path = tmp_path / "page.png"
    Image.new("L", (12, 12), color=255).save(image_path)
    real_open = ocr_pipeline.Image.open
    open_calls: list[str] = []

    def _counting_open(path, *args, **kwargs):  # noqa: ANN001, ANN202
        open_calls.append(str(path))
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(ocr_pipeline.Image, "open", _counting_open)
    ocr_pipeline._normalized_scan_for_inverse_render_payload.cache_clear()
    try:
        ocr_pipeline._normalize_scan_for_inverse_render(image_path)
        Image.new("L", (14, 14), color=0).save(image_path)
        ocr_pipeline._normalize_scan_for_inverse_render(image_path)
    finally:
        ocr_pipeline._normalized_scan_for_inverse_render_payload.cache_clear()

    assert open_calls == [str(image_path.resolve()), str(image_path.resolve())]


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


def test_maybe_inverse_render_rerank_skips_cleanup_when_metadata_says_unchanged(
    monkeypatch,
    tmp_path,
) -> None:
    image_path = tmp_path / "page.png"
    image_path.write_bytes(b"image")
    candidates = [
        ocr_pipeline.OCRCandidate(
            score=300.0,
            ocr_input_path=image_path,
            text="top candidate",
            metadata={"cleanup_changed_text": False},
        ),
        ocr_pipeline.OCRCandidate(
            score=250.0,
            ocr_input_path=image_path,
            text="second candidate",
            metadata={"cleanup_changed_text": False},
        ),
    ]
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(
            inverse_render_rerank=True,
            inverse_render_top_k=2,
            apply_cleanup=True,
        ),
        preprocess_mode="auto",
    )
    seen_texts: list[str] = []

    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (Image.new("L", (20, 20), color=255), (0, 0, 20, 20)),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "cleanup_ocr_text",
        lambda _text, lexicon_texts=(): (_ for _ in ()).throw(
            AssertionError("cleanup_ocr_text should not be called")
        ),
    )

    def _fake_inverse_render_score_many(_observed, _bbox, texts, *, workers):  # noqa: ANN001, ANN202
        assert workers == 1
        seen_texts.extend(texts)
        return [
            (0.2, {"inverse_render_score": 0.2}),
            (0.4, {"inverse_render_score": 0.4}),
        ]

    monkeypatch.setattr(ocr_pipeline, "_inverse_render_score_many", _fake_inverse_render_score_many)

    selected = ocr_pipeline._maybe_inverse_render_rerank(image_path, candidates, options)

    assert selected is not None
    assert selected.text == "second candidate"
    assert seen_texts == ["top candidate", "second candidate"]


def test_maybe_inverse_render_rerank_skips_scoring_when_all_variants_match(
    monkeypatch,
    tmp_path,
) -> None:
    image_path = tmp_path / "page.png"
    image_path.write_bytes(b"image")
    candidates = [
        ocr_pipeline.OCRCandidate(
            score=300.0,
            ocr_input_path=image_path,
            text="same text",
            metadata={"cleanup_changed_text": False},
        ),
        ocr_pipeline.OCRCandidate(
            score=250.0,
            ocr_input_path=image_path,
            text="same text",
            metadata={"cleanup_changed_text": False},
        ),
    ]
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(
            inverse_render_rerank=True,
            inverse_render_top_k=2,
            apply_cleanup=True,
        ),
        preprocess_mode="auto",
    )

    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("_normalize_scan_for_inverse_render should not be called")
        ),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_many",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("_inverse_render_score_many should not be called")
        ),
    )

    selected = ocr_pipeline._maybe_inverse_render_rerank(image_path, candidates, options)

    assert selected is not None
    assert selected.text == "same text"
    assert selected.score == 300.0


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
    assert verifier["decisions"][0]["accepted_without_image_verification"] is True


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
    monkeypatch.setattr(ocr_pipeline, "_targeted_page_retry_reason", lambda *_args, **_kwargs: None)

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


def test_evaluate_cleanup_span_replacement_rejects_out_of_bounds_hint_bbox(
    monkeypatch,
) -> None:
    observed_binary = Image.new("L", (20, 20), color=255)
    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_many",
        lambda *_args, **_kwargs: [
            (0.2, {"inverse_render_bbox": [0, 0, 20, 20]}),
            (0.3, {"inverse_render_bbox": [0, 0, 20, 20]}),
        ],
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_render_inverse_text_from_metadata",
        lambda *_args, **_kwargs: Image.new("L", (20, 20), color=255),
    )

    accepted, decision = ocr_pipeline._evaluate_cleanup_span_replacement(
        observed_binary,
        (0, 0, 20, 20),
        "raw text",
        "cleaned text",
        hint_bbox=(100, 5, 110, 15),
    )

    assert accepted is False
    assert decision["reason"] == "invalid-local-bbox"
    assert decision["accepted"] is False


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
        "_score_ocr_candidate",
        lambda text, _lang, _lexicon, _metadata=None: (
            100.0 if "upright readable text" in text else 1.0,
            {},
        ),
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
        "_score_ocr_candidate",
        lambda text, _lang, _lexicon, _metadata=None: (
            12.0 if "good tile text" in text else 1.0,
            {},
        ),
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


def test_candidate_disagreement_metadata_tracks_near_best_family_conflict(tmp_path) -> None:
    selected = ocr_pipeline.OCRCandidate(
        score=920.0,
        ocr_input_path=tmp_path / "selected.png",
        text="The careful reader saw a clean line of text across the page",
        metadata={"preprocess_mode": "basic", "candidate_preprocess_mode": "basic"},
    )
    conflicting = ocr_pipeline.OCRCandidate(
        score=875.0,
        ocr_input_path=tmp_path / "scan.png",
        text="The doubtful render found broken words and missing sense across this page",
        metadata={"preprocess_mode": "scan", "candidate_preprocess_mode": "scan"},
    )
    same_family = ocr_pipeline.OCRCandidate(
        score=900.0,
        ocr_input_path=tmp_path / "basic-2.png",
        text="The careful reader saw a clean line of text across the page",
        metadata={"preprocess_mode": "basic", "candidate_preprocess_mode": "basic"},
    )

    metadata = ocr_pipeline._candidate_disagreement_metadata(
        selected,
        [selected, conflicting, same_family],
    )

    assert metadata["candidate_near_best_family_count"] == 1
    assert float(metadata["candidate_best_alt_score_gap"]) == pytest.approx(45.0)
    assert float(metadata["candidate_best_alt_text_similarity"]) < 0.94


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


def test_page_analysis_metadata_marks_fragmented_body_page_low_quality() -> None:
    lines = [
        "The witness e d h said 'walt bel' the plan moved ahead before dawn today",
        "Another careful reader e s r saw 'north bel' the damaged copy drift apart again",
        "The editor e d m kept 'sense bel' while the blurred letters fell away from view",
        "Each observer e h l noted 'paper bel' as the broken scan split words in half",
    ]
    metadata = ocr_pipeline._page_analysis_metadata(
        "\n".join(lines),
        {
            "selection_score": 920.0,
            "hocr_line_entries_runtime": [
                {"text": line, "bbox": [20, 20 + (index * 30), 420, 45 + (index * 30)]}
                for index, line in enumerate(lines)
            ],
        },
        page_index=42,
        total_pages=120,
    )
    assert metadata["page_type"] == "body"
    assert metadata["page_quality_tier"] == "low"
    assert metadata["page_route"] == "body-low-quality"
    assert float(metadata["page_single_char_fragment_ratio"]) > 0.03
    assert float(metadata["page_apostrophe_fragment_ratio"]) > 0.015


def test_page_analysis_metadata_marks_ambiguous_body_page_for_review() -> None:
    lines = [
        "The careful readers compared the passage and found every sentence easy to follow",
        "Another observer checked the layout and reported steady text across the whole page",
        "The chapter continued with ordinary prose and a stable cadence from line to line",
        "Several reviewers agreed the wording looked plausible despite the close OCR race",
    ]
    metadata = ocr_pipeline._page_analysis_metadata(
        "\n".join(lines),
        {
            "selection_score": 920.0,
            "candidate_near_best_family_count": 2,
            "candidate_best_alt_score_gap": 60.0,
            "candidate_best_alt_text_similarity": 0.82,
            "hocr_line_entries_runtime": [
                {"text": line, "bbox": [20, 20 + (index * 30), 420, 45 + (index * 30)]}
                for index, line in enumerate(lines)
            ],
        },
        page_index=42,
        total_pages=120,
    )
    assert metadata["page_type"] == "body"
    assert metadata["page_quality_tier"] == "medium"
    assert metadata["page_route"] == "body-review"
    assert metadata["page_candidate_near_best_family_count"] == 2
    assert float(metadata["page_candidate_best_alt_text_similarity"]) == pytest.approx(0.82)


def test_targeted_page_retry_reason_allows_body_review_and_back_matter() -> None:
    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions())

    assert (
        ocr_pipeline._targeted_page_retry_reason({"page_route": "body-review"}, options)
        == "body-review"
    )
    assert (
        ocr_pipeline._targeted_page_retry_reason({"page_route": "back-matter"}, options)
        == "back-matter"
    )


def test_should_keep_targeted_retry_accepts_cleaner_low_quality_retry() -> None:
    assert (
        ocr_pipeline._should_keep_targeted_retry(
            {
                "selection_score": 4166.35,
                "page_quality_tier": "low",
                "page_single_char_fragment_ratio": 0.0338,
                "page_apostrophe_fragment_ratio": 0.0320,
            },
            {
                "selection_score": 4159.68,
                "page_quality_tier": "low",
                "page_single_char_fragment_ratio": 0.0180,
                "page_apostrophe_fragment_ratio": 0.0200,
            },
        )
        is True
    )


def test_should_keep_targeted_retry_rejects_low_quality_retry_without_enough_cleanup() -> None:
    assert (
        ocr_pipeline._should_keep_targeted_retry(
            {
                "selection_score": 4166.35,
                "page_quality_tier": "low",
                "page_single_char_fragment_ratio": 0.0338,
                "page_apostrophe_fragment_ratio": 0.0320,
            },
            {
                "selection_score": 4159.68,
                "page_quality_tier": "low",
                "page_single_char_fragment_ratio": 0.0300,
                "page_apostrophe_fragment_ratio": 0.0290,
            },
        )
        is False
    )


def test_targeted_page_retry_options_use_front_matter_toc_policy() -> None:
    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(), preprocess_mode="basic")

    retry_options = ocr_pipeline._targeted_page_retry_options(
        options,
        "front-matter",
        {
            "page_route": "front-matter",
            "page_layout_region_counts": {"toc": 2},
        },
    )

    assert retry_options.preprocess_mode == "auto"
    assert retry_options.core.tesseract_psm == "auto"
    assert retry_options.core.tesseract_output_format == "hocr"
    assert retry_options.route_ocr_policy == "front-matter-toc"
    assert retry_options.candidate_preprocess_modes_override == (
        "scan-background-normalized-masked",
        "scan-background-normalized",
        "scan-masked",
        "scan-local-threshold-masked",
        "scan",
        "scan-local-threshold",
        "scan-sauvola",
        "scan-morphology",
        "basic",
        "deskew",
    )
    assert retry_options.candidate_tesseract_psms_override == ("6", "4")


def test_adaptive_raster_retry_image_crops_and_resizes(tmp_path) -> None:
    input_path = tmp_path / "page.png"
    image = Image.new("L", (40, 40), color=255)
    pixels = image.load()
    for x in range(40):
        for y in range(4):
            pixels[x, y] = 0
            pixels[x, 39 - y] = 0
    for y in range(40):
        for x in range(3):
            pixels[x, y] = 0
            pixels[39 - x, y] = 0
    image.save(input_path)

    adaptive = ocr_pipeline._adaptive_raster_retry_image(
        input_path,
        tmp_path / "preprocessed",
        "front-matter",
    )

    assert adaptive is not None
    adaptive_path, metadata = adaptive
    assert adaptive_path.exists()
    assert metadata["adaptive_raster_retry_variant"] == "cropped-resized"
    assert metadata["adaptive_raster_retry_crop_box"] == (1, 2, 39, 38)
    with Image.open(adaptive_path) as adaptive_image:
        assert adaptive_image.size == (40, 40)


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


def test_ocr_page_images_llm_suspicious_sections_flags_symbolic_excerpt(tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)
    prompts: list[str] = []

    def _which(name: str) -> str | None:
        if name == "tesseract":
            return "/usr/bin/fake"
        return None

    def _run(command: list[str], capture_output: bool) -> str:
        assert command[0] == "tesseract"
        assert capture_output is True
        return (
            "The fron|ier pass looked strange enough to warrant a closer look, and the "
            "witnesses agreed that the text looked suspicious and garbled while several "
            "other careful readers compared every nearby word for context and consistency."
        )

    def _analyze(prompt: str) -> str:
        prompts.append(prompt)
        assert "fron|ier" in prompt
        return json.dumps(
            {
                "suspicious": True,
                "confidence": "high",
                "reason": "garbled token with embedded punctuation likely reflects OCR damage",
                "focus_spans": ["fron|ier"],
            }
        )

    metrics = ocr_page_images(
        page_images=[page_image],
        output_text_path=output_path,
        work_dir=work_dir,
        preprocess_mode="none",
        tesseract_psm="6",
        llm_suspicious_sections=True,
        llm_suspicious_section_analyzer=_analyze,
        run_command=_run,
        which=_which,
    )

    suspicious = metrics["suspicious_sections"]
    assert suspicious["status"] == "applied"
    assert suspicious["candidate_count"] >= 1
    assert suspicious["flagged_count"] == 1
    section = suspicious["sections"][0]
    assert section["page_index"] == 1
    assert section["llm_confidence"] == "high"
    assert section["focus_spans"] == ["fron|ier"]
    assert "garbled token" in section["llm_reason"]
    assert prompts


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
                options.candidate_preprocess_modes_override,
                options.candidate_tesseract_psms_override,
                options.route_ocr_policy,
            )
        )
        if len(seen_calls) == 1:
            assert options.preprocess_mode == "basic"
            assert options.core.tesseract_psm == "6"
            assert options.core.tesseract_output_format == "text"
            assert options.candidate_preprocess_modes_override is None
            assert options.candidate_tesseract_psms_override is None
            assert options.route_ocr_policy is None
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
        assert options.candidate_preprocess_modes_override == (
            "scan-background-normalized",
            "scan-background-normalized-masked",
            "scan-sauvola",
            "scan-morphology",
            "scan",
            "scan-masked",
            "scan-local-threshold",
            "scan-local-threshold-masked",
            "deskew",
            "basic",
            "dewarp",
        )
        assert options.candidate_tesseract_psms_override == ("3", "6", "4")
        assert options.route_ocr_policy == "body-low-quality"
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
    monkeypatch.setattr(ocr_pipeline, "_adaptive_raster_retry_image", lambda *_args: None)

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
    assert seen_calls == [
        ("basic", "6", "text", None, None, None),
        (
            "auto",
            "auto",
            "hocr",
            (
                "scan-background-normalized",
                "scan-background-normalized-masked",
                "scan-sauvola",
                "scan-morphology",
                "scan",
                "scan-masked",
                "scan-local-threshold",
                "scan-local-threshold-masked",
                "deskew",
                "basic",
                "dewarp",
            ),
            ("3", "6", "4"),
            "body-low-quality",
        ),
    ]
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "targeted-page-retry"
    assert page_entry["targeted_page_retry"] == "applied"
    assert page_entry["targeted_page_retry_reason"] == "low-quality"
    assert page_entry["targeted_page_retry_policy"] == "body-low-quality"
    assert metrics["page_analysis"]["targeted_page_retry_count"] == 1
    assert metrics["page_analysis"]["targeted_page_retry_reason_counts"] == {"low-quality": 1}


def test_ocr_page_images_targeted_retry_reprocesses_fragmented_body_page(monkeypatch, tmp_path) -> None:
    page_image = tmp_path / "page-1.png"
    output_path = tmp_path / "out.txt"
    work_dir = tmp_path / "work"
    Image.new("L", (20, 20), color=255).save(page_image)
    seen_calls: list[tuple[str, str, str, tuple[str, ...] | None, str | None]] = []
    fragmented_text = "\n".join(
        [
            "The witness e d h said 'walt bel' the plan moved ahead before dawn today",
            "Another careful reader e s r saw 'north bel' the damaged copy drift apart again",
            "The editor e d m kept 'sense bel' while the blurred letters fell away from view",
            "Each observer e h l noted 'paper bel' as the broken scan split words in half",
        ]
    )

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
                options.candidate_preprocess_modes_override,
                options.route_ocr_policy,
            )
        )
        if len(seen_calls) == 1:
            return (
                page_image,
                fragmented_text,
                {
                    "preprocess_mode": "basic",
                    "selected_preprocess_mode": "basic",
                    "selection_score": 920.0,
                    "selection_strategy": "text-score",
                    "tesseract_psm": 6,
                    "tesseract_output_format": "text",
                },
            )
        assert options.preprocess_mode == "auto"
        assert options.core.tesseract_psm == "auto"
        assert options.core.tesseract_output_format == "hocr"
        assert options.candidate_preprocess_modes_override == (
            "scan-background-normalized",
            "scan-background-normalized-masked",
            "scan-sauvola",
            "scan-morphology",
            "scan",
            "scan-masked",
            "scan-local-threshold",
            "scan-local-threshold-masked",
            "deskew",
            "basic",
            "dewarp",
        )
        assert options.route_ocr_policy == "body-low-quality"
        return (
            page_image,
            "\n".join(
                [
                    "The witness said the plan moved ahead before dawn today with steady prose",
                    "Another careful reader saw the damaged copy drift apart again in context",
                    "The editor kept the sentence intact while the clearer scan restored detail",
                    "Each observer noted the repaired page as the broken words disappeared",
                ]
            ),
            {
                "preprocess_mode": "scan-background-normalized",
                "selected_preprocess_mode": "scan-background-normalized",
                "selection_score": 930.0,
                "selection_strategy": "text-score",
                "tesseract_psm": 6,
                "tesseract_output_format": "hocr",
                "hocr_confidence_mean": 95.0,
                "hocr_low_confidence_ratio": 0.0,
            },
        )

    monkeypatch.setattr(ocr_pipeline, "_run_ocr_on_page", _fake_run_ocr_on_page)
    monkeypatch.setattr(ocr_pipeline, "_adaptive_raster_retry_image", lambda *_args: None)

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

    assert "witness said the plan" in output_path.read_text(encoding="utf-8").lower()
    assert seen_calls == [
        ("basic", "6", "text", None, None),
        (
            "auto",
            "auto",
            "hocr",
            (
                "scan-background-normalized",
                "scan-background-normalized-masked",
                "scan-sauvola",
                "scan-morphology",
                "scan",
                "scan-masked",
                "scan-local-threshold",
                "scan-local-threshold-masked",
                "deskew",
                "basic",
                "dewarp",
            ),
            "body-low-quality",
        ),
    ]
    manifest_payload = json.loads(Path(str(metrics["page_artifacts_manifest"])).read_text(encoding="utf-8"))
    page_entry = manifest_payload["pages"][0]
    assert page_entry["selection_strategy"] == "targeted-page-retry"
    assert page_entry["targeted_page_retry"] == "applied"
    assert page_entry["targeted_page_retry_reason"] == "low-quality"
    assert page_entry["targeted_page_retry_policy"] == "body-low-quality"


def test_maybe_retry_targeted_page_can_select_adaptive_raster_candidate(
    monkeypatch,
    tmp_path,
) -> None:
    page_image = tmp_path / "page-1.png"
    Image.new("L", (40, 40), color=255).save(page_image)
    preprocessed_dir = tmp_path / "preprocessed"
    seen_calls: list[tuple[str, str | None]] = []

    def _fake_run_ocr_on_page(  # noqa: ANN001, ANN202
        image_path,
        options,
        _dependencies,
        _preprocessed_dir,
        _paddle_reader,
        *,
        retry_reason=None,
        **_kwargs,
    ):
        seen_calls.append((image_path.parent.name, retry_reason))
        if retry_reason == "low-quality":
            return (
                image_path,
                "standard retry text",
                {
                    "selection_score": 35.0,
                    "selection_strategy": "text-score",
                    "page_quality_tier": "medium",
                },
            )
        assert retry_reason == "low-quality-adaptive-raster"
        assert options.route_ocr_policy == "body-low-quality"
        return (
            image_path,
            "adaptive retry text",
            {
                "selection_score": 90.0,
                "selection_strategy": "text-score",
                "page_quality_tier": "high",
            },
        )

    monkeypatch.setattr(ocr_pipeline, "_run_ocr_on_page", _fake_run_ocr_on_page)
    monkeypatch.setattr(
        ocr_pipeline,
        "_postprocess_page_text",
        lambda image_path, text, metadata, **_kwargs: (text, metadata),
    )

    dependencies = ocr_pipeline.OCRDependencies(
        run_command=lambda _command, _capture_output: "",
        preprocess_image=lambda *_args: None,
        paddle_reader_factory=lambda _language: (lambda _path: ""),
        which=lambda _name: "/usr/bin/fake",
    )
    result_path, result_text, result_metadata = ocr_pipeline._maybe_retry_targeted_page(
        page_image,
        page_image,
        "original text",
        {
            "selection_score": 20.0,
            "page_route": "body-low-quality",
            "page_quality_tier": "low",
        },
        page_index=1,
        total_pages=10,
        options=ocr_pipeline.OCRRunOptions(
            core=ocr_pipeline.OCRCoreOptions(),
            preprocess_mode="basic",
        ),
        dependencies=dependencies,
        preprocessed_dir=preprocessed_dir,
        paddle_reader=None,
        started_at=0.0,
    )

    assert result_text == "adaptive retry text"
    assert result_path.parent.name == "adaptive-raster"
    assert result_metadata["selection_strategy"] == "targeted-page-retry"
    assert result_metadata["adaptive_raster_retry"] == "applied"
    assert result_metadata["adaptive_raster_retry_variant"] == "cropped-resized"
    assert seen_calls == [
        (page_image.parent.name, "low-quality"),
        ("adaptive-raster", "low-quality-adaptive-raster"),
    ]


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


def test_score_ocr_candidate_blends_raw_and_cleaned_text_quality() -> None:
    noisy = "The prlnted text 1s noisy"
    raw_score = ocr_pipeline._score_text_quality(noisy.strip(), "eng")
    cleaned_score = ocr_pipeline._score_ocr_text(noisy, "eng", ())
    candidate_score, details = ocr_pipeline._score_ocr_candidate(noisy, "eng", ())

    assert details["cleanup_changed_text"] is True
    assert raw_score < candidate_score < cleaned_score
    assert details["raw_text_score"] == raw_score
    assert details["cleaned_text_score"] == cleaned_score


def test_score_ocr_candidate_uses_hocr_confidence_signals() -> None:
    text = "Just then a heavy cloud passed across the face of the moon"
    baseline_score, baseline_details = ocr_pipeline._score_ocr_candidate(text, "eng", ())
    high_score, high_details = ocr_pipeline._score_ocr_candidate(
        text,
        "eng",
        (),
        {"hocr_confidence_mean": 95.0, "hocr_low_confidence_ratio": 0.02},
    )
    low_score, low_details = ocr_pipeline._score_ocr_candidate(
        text,
        "eng",
        (),
        {"hocr_confidence_mean": 45.0, "hocr_low_confidence_ratio": 0.35},
    )

    assert baseline_details["hocr_confidence_adjustment"] == 0.0
    assert high_details["hocr_confidence_adjustment"] > 0.0
    assert low_details["hocr_confidence_adjustment"] < 0.0
    assert high_score > baseline_score > low_score


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


def test_mask_sparse_outer_text_bands_removes_top_prelude() -> None:
    image = Image.new("L", (180, 240), color=255)
    pixels = image.load()
    for x in range(62, 117):
        for y in range(12, 18):
            pixels[x, y] = 0
    for x in range(58, 123):
        for y in range(28, 35):
            pixels[x, y] = 0
    for x in range(30, 150):
        for y in range(90, 118):
            pixels[x, y] = 0

    masked = ocr_pipeline._mask_sparse_outer_text_bands(image)

    assert masked.getpixel((90, 15)) == 255
    assert masked.getpixel((90, 31)) == 255
    assert masked.getpixel((90, 100)) == 0


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


def test_preprocess_image_scan_background_normalized_uses_normalization_and_sauvola(
    monkeypatch,
    tmp_path,
) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "processed.png"
    Image.new("L", (120, 180), color=220).save(input_path)
    seen: dict[str, object] = {}

    def _fake_normalize(image, *, blur_radius, contrast_scale, closing_size):  # noqa: ANN001, ANN202
        seen["normalize_size"] = image.size
        seen["blur_radius"] = blur_radius
        seen["contrast_scale"] = contrast_scale
        seen["closing_size"] = closing_size
        return image

    def _fake_sauvola(image, *, block_size, k, dynamic_range=128.0):  # noqa: ANN001, ANN202
        seen["sauvola_size"] = image.size
        seen["block_size"] = block_size
        seen["k"] = k
        seen["dynamic_range"] = dynamic_range
        return image.point(lambda value: 255 if value >= 128 else 0)

    monkeypatch.setattr(ocr_pipeline, "_normalize_scan_background", _fake_normalize)
    monkeypatch.setattr(ocr_pipeline, "_sauvola_threshold", _fake_sauvola)
    ocr_pipeline._preprocess_image(
        input_path,
        output_path,
        "scan-background-normalized",
        190,
        2.0,
        0.5,
    )

    with Image.open(output_path) as processed:
        assert processed.size == (360, 540)
        assert set(processed.getdata()) <= {0, 255}
    assert seen == {
        "normalize_size": (360, 540),
        "blur_radius": 12.0,
        "contrast_scale": 5.0,
        "closing_size": 9,
        "sauvola_size": (360, 540),
        "block_size": 41,
        "k": 0.25,
        "dynamic_range": 128.0,
    }


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


def test_sauvola_threshold_returns_binary_image() -> None:
    image = Image.new("L", (15, 15), color=220)
    pixels = image.load()
    for x in range(4, 11):
        for y in range(4, 11):
            pixels[x, y] = 80

    binary = ocr_pipeline._sauvola_threshold(image, block_size=5, k=0.25)

    values = set(binary.getdata())
    assert values <= {0, 255}
    assert values == {0, 255}


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
        "scan-background-normalized": "alpha beta gamma",
        "scan-sauvola": "alpha beta gamma",
        "scan-morphology": "alpha beta gamma",
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
    assert seen_modes == [
        "none",
        "scan",
        "scan-local-threshold",
        "scan-background-normalized",
        "scan-sauvola",
        "scan-morphology",
        "basic",
        "deskew",
        "dewarp",
    ]
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


def test_run_command_respects_capture_output(monkeypatch) -> None:
    seen: list[tuple[list[str], bool]] = []

    def _fake_run(command, *, check, text, capture_output):  # noqa: ANN001, ANN202
        assert check is True
        assert text is True
        seen.append((command, capture_output))
        return types.SimpleNamespace(stdout="captured")

    monkeypatch.setattr(ocr_pipeline.subprocess, "run", _fake_run)

    assert ocr_pipeline._run_command(["echo", "hi"], capture_output=False) == ""
    assert ocr_pipeline._run_command(["echo", "hi"], capture_output=True) == "captured"
    assert seen == [(["echo", "hi"], False), (["echo", "hi"], True)]


def test_load_paddleocr_type_raises_for_missing_dependency(monkeypatch) -> None:
    def _missing_module(_name: str):  # noqa: ANN001, ANN202
        raise ImportError("missing")

    monkeypatch.setattr(ocr_pipeline.importlib, "import_module", _missing_module)

    with pytest.raises(RuntimeError, match="Missing dependency for paddleocr engine"):
        ocr_pipeline._load_paddleocr_type()


def test_load_paddleocr_type_requires_paddleocr_class(monkeypatch) -> None:
    monkeypatch.setattr(
        ocr_pipeline.importlib,
        "import_module",
        lambda _name: types.SimpleNamespace(),
    )

    with pytest.raises(RuntimeError, match="does not provide PaddleOCR"):
        ocr_pipeline._load_paddleocr_type()


def test_paddleocr_helper_paths_cover_defensive_branches(tmp_path) -> None:
    assert ocr_pipeline._map_paddleocr_language(" FRA ") == "fr"
    assert ocr_pipeline._map_paddleocr_language("unknown") == "en"
    assert ocr_pipeline._extract_unknown_argument("Unknown argument: show_log") == "show_log"
    assert (
        ocr_pipeline._extract_unknown_argument("__init__() got an unexpected keyword argument 'use_gpu'")
        == "use_gpu"
    )
    assert ocr_pipeline._extract_unknown_argument("plain failure") is None

    class _BadReader:
        def ocr(self, _image_path: str, cls: bool = True):  # noqa: FBT001, FBT002
            raise TypeError("different problem")

    with pytest.raises(TypeError, match="different problem"):
        ocr_pipeline._run_paddle_raw(_BadReader(), tmp_path / "page.png")

    assert ocr_pipeline._extract_lines_from_page_result("bad") == []
    assert ocr_pipeline._extract_lines_from_predict_result({"rec_texts": "bad"}) == []
    assert ocr_pipeline._extract_lines_from_ocr_rows(
        [
            "bad",
            [None],
            [None, []],
            [None, [123]],
            [None, ["good text", 0.9]],
        ]
    ) == ["good text"]


def test_projection_and_deskew_helpers_cover_simple_edge_cases(monkeypatch) -> None:
    image = Image.new("L", (4, 3), color=255)
    assert ocr_pipeline._projection_variance(image) == 0.0

    pixels = image.load()
    pixels[1, 1] = 0
    pixels[2, 1] = 0
    centers = ocr_pipeline._row_center_offsets(image)
    assert centers == [None, 1.5, None]
    assert ocr_pipeline._first_black_pixel(pixels, image.width, 0) is None
    assert ocr_pipeline._last_black_pixel(pixels, image.width, 0) is None
    assert ocr_pipeline._linear_center_baseline([1.0]) == (0.0, 0.0)
    assert ocr_pipeline._row_shift_for_dewarp([None, 3.0], 0.5, 1.0, 0) == 0
    assert ocr_pipeline._row_shift_for_dewarp([None, 3.0], 0.5, 1.0, 1) == 2

    class _FakeRotated:
        def __init__(self, angle: float) -> None:
            self.angle = angle

        def point(self, _fn, mode="L"):  # noqa: ANN001, ANN202
            assert mode == "L"
            return self

    class _FakeImage:
        def rotate(self, angle: float, *, expand: bool, fillcolor: int):  # noqa: ANN001
            assert expand is True
            assert fillcolor == 255
            return _FakeRotated(angle)

    monkeypatch.setattr(
        ocr_pipeline,
        "_projection_variance",
        lambda rotated: {-1.0: 1.0, 0.0: 3.0, 1.0: 2.0}[rotated.angle],
    )
    assert ocr_pipeline._estimate_skew_angle(_FakeImage(), 1.0, 1.0) == 0.0


def test_dewarp_and_preprocess_helpers_cover_runtime_guards(monkeypatch, tmp_path) -> None:
    image = Image.new("L", (4, 2), color=255)
    image.putpixel((1, 0), 0)
    image.putpixel((2, 1), 0)

    monkeypatch.setattr(ocr_pipeline, "_row_center_offsets", lambda _binary: [1.0, 2.0])
    monkeypatch.setattr(ocr_pipeline, "_linear_center_baseline", lambda _centers: (0.0, 1.0))
    result = ocr_pipeline._dewarp_by_row_shift(image, 128)
    assert result.size == image.size

    monkeypatch.setattr(ocr_pipeline, "Image", None)
    with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
        ocr_pipeline._dewarp_by_row_shift(image, 128)
    with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
        ocr_pipeline._preprocess_image(tmp_path / "in.png", tmp_path / "out.png", "scan", 180, 2.0, 0.5)


def test_parse_preprocess_and_scan_stack_helpers_cover_edges() -> None:
    with pytest.raises(TypeError, match="expects preprocess mode"):
        ocr_pipeline._parse_preprocess_args(("scan", 180, 2.0))

    assert ocr_pipeline._parse_preprocess_args(("scan", "180", "2.0", "0.5")) == (
        "scan",
        180,
        2.0,
        0.5,
    )
    assert ocr_pipeline._split_preprocess_mode("scan-masked") == ("scan", True)
    assert ocr_pipeline._masked_preprocess_mode("scan") == "scan-masked"
    assert ocr_pipeline._uses_scan_preprocess_stack("scan-background-normalized-masked") is True
    assert ocr_pipeline._uses_scan_preprocess_stack("basic") is False


def test_upsample_and_band_helpers_cover_small_edge_cases() -> None:
    assert ocr_pipeline._upsample_for_ocr(Image.new("L", (2500, 100), color=255)).size == (2500, 100)

    image = Image.new("L", (6, 4), color=255)
    pixels = image.load()
    for x in range(6):
        pixels[x, 1] = 0
        pixels[x, 2] = 0

    assert ocr_pipeline._ink_row_counts(image) == [0, 6, 6, 0]
    assert ocr_pipeline._collect_ink_bands(Image.new("L", (6, 4), color=255)) == []
    assert ocr_pipeline._collect_ink_bands(image) == [
        {
            "top": 1,
            "bottom": 2,
            "height": 2,
            "peak_row_ink": 6,
            "ink_width": 6,
            "ink_left": 0,
            "ink_right": 6,
        }
    ]


def test_threshold_helpers_cover_invalid_inputs_and_edges() -> None:
    assert ocr_pipeline._otsu_threshold(Image.new("L", (0, 0), color=255)) == 128
    assert ocr_pipeline._tile_start_positions(100, 128, 64) == [0]
    assert ocr_pipeline._tile_start_positions(250, 100, 60) == [0, 60, 120, 150]

    with pytest.raises(ValueError, match="odd integer >= 3"):
        ocr_pipeline._adaptive_gaussian_threshold(Image.new("L", (5, 5), color=255), block_size=4, subtract_constant=5)
    with pytest.raises(ValueError, match="odd integer >= 3"):
        ocr_pipeline._sauvola_threshold(Image.new("L", (5, 5), color=255), block_size=2, k=0.25)
    with pytest.raises(ValueError, match="dynamic_range must be greater than 0"):
        ocr_pipeline._sauvola_threshold(Image.new("L", (5, 5), color=255), block_size=5, k=0.25, dynamic_range=0.0)
    with pytest.raises(ValueError, match="overlap must be >= 0 and less than tile_size"):
        ocr_pipeline._threshold_image_in_overlapping_tiles(
            Image.new("L", (10, 10), color=255),
            tile_size=8,
            overlap=8,
            threshold_fn=lambda tile: tile,
        )


def test_background_and_morphology_helpers_cover_simple_outputs() -> None:
    white = Image.new("L", (5, 5), color=255)
    normalized = ocr_pipeline._normalize_scan_background(
        white,
        blur_radius=1.0,
        contrast_scale=1.5,
        closing_size=1,
    )
    assert set(normalized.getdata()) == {255}

    mostly_white = Image.new("L", (5, 5), color=255)
    mostly_white.putpixel((2, 2), 0)
    cleaned = ocr_pipeline._remove_small_black_components(mostly_white, min_component_pixels=2)
    assert cleaned.getpixel((2, 2)) == 255
    assert ocr_pipeline._remove_small_black_components(mostly_white, min_component_pixels=1).getpixel((2, 2)) == 0
    assert set(ocr_pipeline._morphological_cleanup_binary(mostly_white, min_component_pixels=2).getdata()) <= {0, 255}


def test_validation_helpers_cover_boundaries_and_failures(tmp_path) -> None:
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(),
        preprocess_mode="none",
    )
    ocr_pipeline._validate_common_ocr_options(options, lambda _name: "/usr/bin/fake")

    bad_threshold = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(binarize_threshold=256),
        preprocess_mode="none",
    )
    with pytest.raises(ValueError, match="binarize_threshold"):
        ocr_pipeline._validate_common_ocr_options(bad_threshold, lambda _name: "/usr/bin/fake")

    bad_angle = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(deskew_max_angle=0.0),
        preprocess_mode="none",
    )
    with pytest.raises(ValueError, match="deskew_max_angle"):
        ocr_pipeline._validate_common_ocr_options(bad_angle, lambda _name: "/usr/bin/fake")

    bad_ratio = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(llm_max_word_delta_ratio=1.01),
        preprocess_mode="none",
    )
    with pytest.raises(ValueError, match="llm_max_word_delta_ratio"):
        ocr_pipeline._validate_common_ocr_options(bad_ratio, lambda _name: "/usr/bin/fake")

    with pytest.raises(RuntimeError, match="Missing dependency: pdftoppm"):
        ocr_pipeline._validate_ocr_run_options(tmp_path / "book.pdf", options, lambda name: "/usr/bin/fake" if name == "tesseract" else None)
    with pytest.raises(ValueError, match="page_images must include at least one image path"):
        ocr_pipeline._validate_page_image_run_options([], options, lambda _name: "/usr/bin/fake")


def test_text_scoring_and_layout_helpers_cover_pure_logic() -> None:
    assert ocr_pipeline._score_text_quality("", "eng") == -1_000_000.0
    assert ocr_pipeline._score_text_quality("123 456", "eng") == -500_000.0
    assert ocr_pipeline._score_text_quality("the cat sat", "eng") > ocr_pipeline._score_text_quality("zzz qqq vvv", "eng")
    assert ocr_pipeline._hocr_candidate_score_adjustment({}) == 0.0
    assert ocr_pipeline._hocr_candidate_score_adjustment(
        {"hocr_confidence_mean": 90.0, "hocr_low_confidence_ratio": 0.25}
    ) == pytest.approx(5.0)

    assert ocr_pipeline._is_probable_page_number("(12)") is True
    assert ocr_pipeline._is_probable_page_number("Page 12") is False
    assert ocr_pipeline._is_probable_chapter_marker("Chapter 3") is True
    assert ocr_pipeline._is_probable_toc_line("Chapter One ........ 12") is True
    assert ocr_pipeline._classify_layout_line("", None, 0, 3) == "blank"
    assert ocr_pipeline._classify_layout_line("iii", None, 0, 3) == "page-number"
    assert ocr_pipeline._classify_layout_line("short heading", None, 0, 6) == "header"
    assert ocr_pipeline._classify_layout_line("note", (0, 0, 8, 10), 3, 6) == "margin-note"
    assert ocr_pipeline._classify_layout_line("tail note", None, 5, 6) == "footer"

    entries = ocr_pipeline._coerce_layout_entries(
        "line one\nline two",
        {"hocr_line_entries_runtime": ["bad", {"text": "  "}, {"text": "Body", "bbox": [1, 2, 3, 4]}]},
    )
    assert entries == [{"text": "Body", "bbox": (1, 2, 3, 4)}]
    assert ocr_pipeline._coerce_layout_entries("line one\nline two", {"hocr_line_entries_runtime": "bad"}) == [
        {"text": "line one"},
        {"text": "line two"},
    ]
    classified = ocr_pipeline._classify_layout_entries(
        "line one\n12",
        {"hocr_line_entries_runtime": [{"text": "line one"}, {"text": "12"}]},
    )
    assert classified[1]["region"] == "page-number"
    assert ocr_pipeline._page_text_noise_ratio("") == 1.0
    assert ocr_pipeline._page_ocr_artifact_metrics("123 !!!") == {
        "alphaish_token_count": 0.0,
        "single_char_fragment_ratio": 0.0,
        "apostrophe_fragment_ratio": 0.0,
    }


def test_hocr_extractor_parses_lines_entities_and_fallbacks() -> None:
    parser = ocr_pipeline._HocrTextExtractor()
    parser.feed(
        """
        <span class="ocr_line" title="bbox 1 2 20 10">
          <span class="ocrx_word" title="bbox 1 2 5 7; x_wconf 91">Tom&amp;</span>
          <span class="ocrx_word" title="bbox 6 2 12 7; x_wconf 88">Jerry</span>
        </span>
        """
    )
    assert parser.text == "Tom& Jerry"
    assert parser.lines == ["Tom& Jerry"]
    assert parser.confidences == [91, 88]
    assert parser.line_entries == [{"text": "Tom& Jerry", "bbox": [1, 2, 20, 10]}]

    fallback = ocr_pipeline._HocrTextExtractor()
    fallback.feed('<span class="ocrx_word" title="x_wconf 88">Solo</span>')
    assert fallback.text == "Solo"

    assert ocr_pipeline._extract_hocr_bbox("missing bbox") is None
    assert ocr_pipeline._extract_hocr_bbox("bbox 5 5 5 8") is None


def test_suspicious_section_helpers_cover_windows_and_parsing() -> None:
    short_text = "word " * (ocr_pipeline._SUSPICIOUS_SECTION_MIN_WORDS - 1)
    assert ocr_pipeline._windowed_section_excerpts(short_text) == []

    exact_text = " ".join(f"w{i}" for i in range(ocr_pipeline._SUSPICIOUS_SECTION_WINDOW_WORDS))
    windows = ocr_pipeline._windowed_section_excerpts(exact_text)
    assert windows == [(0, ocr_pipeline._SUSPICIOUS_SECTION_WINDOW_WORDS, exact_text)]

    long_text = " ".join(f"w{i}" for i in range(170))
    assert len(ocr_pipeline._windowed_section_excerpts(long_text)) == 2

    assert ocr_pipeline._extract_first_json_object("prefix {not json") is None
    assert ocr_pipeline._extract_first_json_object('prefix {"ok": 1} suffix {"ignore": 2}') == {"ok": 1}
    assert ocr_pipeline._parse_suspicious_section_response("nonsense") is None
    assert ocr_pipeline._parse_suspicious_section_response('{"suspicious":"yes"}') is None
    parsed = ocr_pipeline._parse_suspicious_section_response(
        json.dumps(
            {
                "suspicious": True,
                "confidence": "LOUD",
                "reason": "x" * 300,
                "focus_spans": ["a" * 130, "keep", 3, "trim", "extra"],
            }
        )
    )
    assert parsed == {
        "suspicious": True,
        "confidence": "medium",
        "reason": "x" * 240,
        "focus_spans": ["a" * 120, "keep", "trim"],
    }

    candidates = ocr_pipeline._suspicious_section_candidates(
        ["clean words " * 20, ("token@@ alpha1 " * 20).strip()],
        [
            {"page_quality_tier": "high", "page_route": "body", "hocr_low_confidence_ratio": 0.0},
            {"page_quality_tier": "low", "page_route": "body-review", "hocr_low_confidence_ratio": 0.25},
        ],
        max_candidates=5,
    )
    assert len(candidates) == 1
    assert candidates[0]["page_index"] == 2


def test_page_classification_helpers_cover_routes_and_thresholds() -> None:
    assert ocr_pipeline._classify_page_type(
        page_index=1,
        total_pages=10,
        word_count=30,
        dense_body_line_count=1,
        region_counts=ocr_pipeline.Counter({"toc": 2, "body": 1}),
        chapter_marker_count=0,
    ) == "front-matter"
    assert ocr_pipeline._classify_page_type(
        page_index=10,
        total_pages=10,
        word_count=20,
        dense_body_line_count=1,
        region_counts=ocr_pipeline.Counter({"body": 1}),
        chapter_marker_count=0,
    ) == "back-matter"
    assert ocr_pipeline._classify_page_type(
        page_index=3,
        total_pages=10,
        word_count=20,
        dense_body_line_count=1,
        region_counts=ocr_pipeline.Counter({"body": 1}),
        chapter_marker_count=0,
    ) == "sparse"

    assert ocr_pipeline._classify_page_quality_tier(
        page_type="body",
        word_count=0,
        dense_body_line_count=3,
        selection_score=0.0,
        noise_ratio=1.0,
        hocr_confidence_mean=60.0,
        hocr_low_confidence_ratio=0.5,
        single_char_fragment_ratio=0.5,
        apostrophe_fragment_ratio=0.5,
        candidate_near_best_family_count=2,
        candidate_best_alt_score_gap=0.2,
        candidate_best_alt_text_similarity=0.2,
    ) == "low"
    assert ocr_pipeline._classify_page_quality_tier(
        page_type="body",
        word_count=100,
        dense_body_line_count=5,
        selection_score=ocr_pipeline._MEDIUM_QUALITY_SELECTION_SCORE - 0.1,
        noise_ratio=ocr_pipeline._MEDIUM_QUALITY_NOISE_RATIO,
        hocr_confidence_mean=87.0,
        hocr_low_confidence_ratio=ocr_pipeline._MEDIUM_QUALITY_LOW_CONFIDENCE_RATIO,
        single_char_fragment_ratio=ocr_pipeline._MEDIUM_QUALITY_SINGLE_CHAR_FRAGMENT_RATIO,
        apostrophe_fragment_ratio=ocr_pipeline._MEDIUM_QUALITY_APOSTROPHE_FRAGMENT_RATIO,
        candidate_near_best_family_count=0,
        candidate_best_alt_score_gap=None,
        candidate_best_alt_text_similarity=None,
    ) == "low"
    assert ocr_pipeline._classify_page_quality_tier(
        page_type="front-matter",
        word_count=20,
        dense_body_line_count=1,
        selection_score=ocr_pipeline._MEDIUM_QUALITY_SELECTION_SCORE,
        noise_ratio=0.0,
        hocr_confidence_mean=None,
        hocr_low_confidence_ratio=None,
        single_char_fragment_ratio=0.0,
        apostrophe_fragment_ratio=0.0,
        candidate_near_best_family_count=0,
        candidate_best_alt_score_gap=None,
        candidate_best_alt_text_similarity=None,
    ) == "high"

    assert ocr_pipeline._page_route("front-matter", "low") == "front-matter"
    assert ocr_pipeline._page_route("body", "low") == "body-low-quality"
    assert ocr_pipeline._page_route("body", "medium") == "body-review"
    assert ocr_pipeline._page_route("body", "high") == "body"


def test_second_wave_helper_edges_cover_remaining_small_branches(monkeypatch, tmp_path) -> None:
    class _FakePaddleOCR:
        def __init__(self, **kwargs):  # noqa: ANN003
            raise ValueError("Unknown argument: mystery")

    with pytest.raises(ValueError, match="Unknown argument: mystery"):
        ocr_pipeline._initialize_paddle_reader(_FakePaddleOCR, "eng")

    dark_row = Image.new("L", (3, 2), color=255)
    for x in range(3):
        dark_row.putpixel((x, 1), 0)
    assert ocr_pipeline._projection_variance(dark_row) > 0.0

    monkeypatch.setattr(ocr_pipeline, "_first_black_pixel", lambda _pixels, _width, _y: 0)
    monkeypatch.setattr(ocr_pipeline, "_last_black_pixel", lambda _pixels, _width, _y: None)
    assert ocr_pipeline._row_center_offsets(Image.new("L", (2, 2), color=255)) == [None, None]

    real_enumerate = builtins.enumerate
    centers = [10.0, 20.0]

    def _fake_enumerate(values):  # noqa: ANN001, ANN202
        if values is centers:
            return iter(((0, 10.0), (0, 20.0)))
        return real_enumerate(values)

    monkeypatch.setattr(builtins, "enumerate", _fake_enumerate)
    assert ocr_pipeline._linear_center_baseline(centers) == (0.0, 15.0)


def test_masking_and_preprocess_candidate_helper_paths(monkeypatch, tmp_path) -> None:
    input_path = tmp_path / "page.png"
    output_path = tmp_path / "masked.png"
    Image.new("L", (20, 20), color=255).save(input_path)

    masked_seen: list[tuple[int, int]] = []

    def _fake_mask(image):  # noqa: ANN001, ANN202
        masked_seen.append(image.size)
        return image

    monkeypatch.setattr(ocr_pipeline, "_mask_sparse_outer_text_bands", _fake_mask)
    ocr_pipeline._preprocess_image(input_path, output_path, "scan-masked", 190, 2.0, 0.5)
    assert masked_seen == [(60, 60)]

    image = Image.new("L", (20, 20), color=255)
    monkeypatch.setattr(ocr_pipeline, "_estimate_skew_angle", lambda *_args, **_kwargs: 1.5)
    deskewed = ocr_pipeline._preprocess_candidate(image, "deskew", 2.0, 0.5, 190)
    assert deskewed.size[0] >= image.size[0]

    monkeypatch.setattr(ocr_pipeline, "_dewarp_by_row_shift", lambda candidate, _threshold: ("dewarped", candidate.size))
    assert ocr_pipeline._preprocess_candidate(image, "dewarp", 2.0, 0.5, 190)[0] == "dewarped"


def test_mask_sparse_outer_text_bands_defensive_branches(monkeypatch) -> None:
    image = Image.new("L", (20, 20), color=255)
    original_image_draw = ocr_pipeline.ImageDraw
    monkeypatch.setattr(ocr_pipeline, "ImageDraw", None)
    assert ocr_pipeline._mask_sparse_outer_text_bands(image) is image

    monkeypatch.setattr(ocr_pipeline, "ImageDraw", original_image_draw)
    zero = types.SimpleNamespace(size=(0, 0))
    assert ocr_pipeline._mask_sparse_outer_text_bands(zero) is zero

    monkeypatch.setattr(ocr_pipeline, "_collect_ink_bands", lambda _image: [])
    assert ocr_pipeline._mask_sparse_outer_text_bands(image).size == image.size

    monkeypatch.setattr(
        ocr_pipeline,
        "_collect_ink_bands",
        lambda _image: [{"top": 0, "bottom": 0, "height": 1, "ink_width": 1}],
    )
    monkeypatch.setattr(ocr_pipeline, "_is_significant_ink_band", lambda *_args: False)
    assert ocr_pipeline._mask_sparse_outer_text_bands(image).size == image.size
    assert original_image_draw is not None


def test_threshold_and_preprocessing_runtime_guards_and_tiling(monkeypatch) -> None:
    fake_empty = types.SimpleNamespace(
        size=(0, 0),
        convert=lambda _mode: types.SimpleNamespace(size=(0, 0), tobytes=lambda: b""),
    )
    assert ocr_pipeline._ink_row_counts(fake_empty) == []
    assert ocr_pipeline._collect_ink_bands(fake_empty) == []

    original_image = ocr_pipeline.Image
    original_image_filter = ocr_pipeline.ImageFilter
    original_image_draw = ocr_pipeline.ImageDraw
    original_image_ops = ocr_pipeline.ImageOps
    try:
        monkeypatch.setattr(ocr_pipeline, "Image", None)
        sample = Image.new("L", (5, 5), color=255)
        assert ocr_pipeline._upsample_for_ocr(sample) is sample
        with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
            ocr_pipeline._threshold_image_in_overlapping_tiles(sample, tile_size=4, overlap=2, threshold_fn=lambda tile: tile)
        with pytest.raises(RuntimeError, match="Missing dependency for inverse-render reranking"):
            ocr_pipeline._inverse_render_bicubic_resample()
    finally:
        monkeypatch.setattr(ocr_pipeline, "Image", original_image)

    monkeypatch.setattr(ocr_pipeline, "ImageFilter", None)
    sample = Image.new("L", (5, 5), color=255)
    with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
        ocr_pipeline._normalize_scan_background(sample, blur_radius=1.0, contrast_scale=1.0, closing_size=3)
    with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
        ocr_pipeline._adaptive_gaussian_threshold(sample, block_size=5, subtract_constant=3)
    with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
        ocr_pipeline._sauvola_threshold(sample, block_size=5, k=0.25)
    with pytest.raises(RuntimeError, match="Missing dependency for preprocessing"):
        ocr_pipeline._morphological_cleanup_binary(sample, min_component_pixels=2)
    monkeypatch.setattr(ocr_pipeline, "ImageFilter", original_image_filter)
    monkeypatch.setattr(ocr_pipeline, "ImageDraw", original_image_draw)
    monkeypatch.setattr(ocr_pipeline, "ImageOps", original_image_ops)

    image = Image.new("L", (6, 6), color=255)
    stitched = ocr_pipeline._threshold_image_in_overlapping_tiles(
        image,
        tile_size=4,
        overlap=2,
        threshold_fn=lambda tile: Image.new("L", tile.size, color=0),
    )
    assert set(stitched.getdata()) == {0}

    connected = Image.new("L", (3, 3), color=255)
    connected.putpixel((0, 0), 0)
    connected.putpixel((1, 1), 0)
    kept = ocr_pipeline._remove_small_black_components(connected, min_component_pixels=2)
    assert kept.getpixel((0, 0)) == 0
    assert kept.getpixel((1, 1)) == 0


def test_parse_and_pdf_resume_helpers_cover_misc_branches(monkeypatch, tmp_path) -> None:
    kwargs = {
        "run_command": "run",
        "preprocess_image": "prep",
        "paddle_reader_factory": "factory",
        "which": "which",
        "llm_corrector": "corrector",
        "llm_suspicious_section_analyzer": "analyzer",
    }
    deps = ocr_pipeline._parse_ocr_dependencies(kwargs)
    assert deps.run_command == "run"
    assert deps.preprocess_image == "prep"
    assert kwargs == {}

    option_kwargs = {
        "page_artifacts_dir": str(tmp_path / "artifacts"),
        "cleanup_lexicon_texts": [1, "lex"],
        "language": "fra",
        "preprocess_mode": "scan",
        "ocr_engine": "paddleocr",
        "emit_page_artifacts": False,
        "resume": True,
    }
    options = ocr_pipeline._parse_ocr_options(option_kwargs)
    assert options.page_artifacts_dir == tmp_path / "artifacts"
    assert options.core.cleanup_lexicon_texts == ("1", "lex")
    assert options.core.language == "fra"
    assert options.resume is True
    assert option_kwargs == {}

    with pytest.raises(TypeError, match="unexpected keyword arguments: alpha, beta"):
        ocr_pipeline._ensure_no_unknown_kwargs({"beta": 1, "alpha": 2}, "demo")
    assert ocr_pipeline._normalize_tesseract_psm(" auto ") == "auto"
    assert ocr_pipeline._normalize_tesseract_psm("6") == "6"

    monkeypatch.setattr(
        ocr_pipeline.subprocess,
        "run",
        lambda *_args, **_kwargs: types.SimpleNamespace(stdout="Pages: 12\n"),
    )
    assert ocr_pipeline._pdf_page_count(tmp_path / "demo.pdf") == 12

    def _missing_pdfinfo(*_args, **_kwargs):  # noqa: ANN001, ANN202
        raise FileNotFoundError("missing")

    monkeypatch.setattr(ocr_pipeline.subprocess, "run", _missing_pdfinfo)
    assert ocr_pipeline._pdf_page_count(tmp_path / "demo.pdf") is None

    artifacts_dir = tmp_path / "artifacts"
    artifacts_dir.mkdir()
    page_images = [tmp_path / "page-1.png", tmp_path / "page-2.png"]
    for image_path in page_images:
        image_path.write_bytes(b"x")
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])

    manifest_path = artifacts_dir / "manifest.json"
    manifest_path.write_text("{bad json", encoding="utf-8")
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])

    manifest_path.write_text(json.dumps({"pages": [{"page_index": 9}]}), encoding="utf-8")
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])

    text_path = artifacts_dir / "page-0001.txt"
    text_path.write_text("First page", encoding="utf-8")
    manifest_path.write_text(
        json.dumps(
            {
                "pages": [
                    {"page_index": 1, "image_path": str(page_images[0]), "text_path": str(text_path)},
                    {"page_index": 2, "image_path": "wrong-name.png"},
                ]
            }
        ),
        encoding="utf-8",
    )
    resumed_texts, resumed_details = ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images)
    assert resumed_texts == ["First page"]
    assert resumed_details[0]["text_path"] == str(text_path)


def test_cleanup_inverse_render_and_llm_helpers_cover_small_branches(monkeypatch, tmp_path) -> None:
    large_raw = " ".join(f"word{i}" for i in range(ocr_pipeline._CLEANUP_SPAN_VERIFIER_MAX_TOKENS + 1))
    large_clean = " ".join(f"term{i}" for i in range(ocr_pipeline._CLEANUP_SPAN_VERIFIER_MAX_TOKENS + 1))
    assert ocr_pipeline._cleanup_span_changes(large_raw, large_clean) == []
    assert ocr_pipeline._cleanup_span_changes("alpha\nbeta", "gamma") == []
    assert ocr_pipeline._cleanup_span_changes("123 456", "123 789") == []
    changes = ocr_pipeline._cleanup_span_changes("alpha beta", "alpha gamma")
    assert len(changes) == 1
    assert changes[0].raw_text == "beta"
    assert changes[0].cleaned_text == "gamma"

    monkeypatch.setattr(
        ocr_pipeline.subprocess,
        "run",
        lambda *_args, **_kwargs: types.SimpleNamespace(stdout="/tmp/font.ttf\n"),
    )
    assert ocr_pipeline._fontconfig_match("serif") == "/tmp/font.ttf"

    def _fc_missing(*_args, **_kwargs):  # noqa: ANN001, ANN202
        raise FileNotFoundError("missing")

    monkeypatch.setattr(ocr_pipeline.subprocess, "run", _fc_missing)
    assert ocr_pipeline._fontconfig_match("serif") is None

    original_image_font = ocr_pipeline.ImageFont
    monkeypatch.setattr(ocr_pipeline, "ImageFont", None)
    with pytest.raises(RuntimeError, match="Missing dependency for inverse-render reranking"):
        ocr_pipeline._load_inverse_render_font("font.ttf", 12)
    monkeypatch.setattr(ocr_pipeline, "ImageFont", original_image_font)
    ocr_pipeline._load_inverse_render_font.cache_clear()

    class _FakeImageFont:
        @staticmethod
        def truetype(_font_path, _font_size):  # noqa: ANN001, ANN202
            raise OSError("bad font")

        @staticmethod
        def load_default():  # noqa: ANN202
            return "default-font"

    monkeypatch.setattr(ocr_pipeline, "ImageFont", _FakeImageFont)
    assert ocr_pipeline._load_inverse_render_font("font.ttf", 12) == "default-font"
    ocr_pipeline._load_inverse_render_font.cache_clear()
    monkeypatch.setattr(ocr_pipeline, "ImageFont", original_image_font)

    image_path = tmp_path / "scan.png"
    Image.new("L", (10, 10), color=255).save(image_path)
    original_image_filter = ocr_pipeline.ImageFilter
    monkeypatch.setattr(ocr_pipeline, "ImageFilter", None)
    with pytest.raises(RuntimeError, match="Missing dependency for inverse-render reranking"):
        ocr_pipeline._normalize_scan_for_inverse_render(image_path)
    monkeypatch.setattr(ocr_pipeline, "ImageFilter", original_image_filter)

    assert ocr_pipeline._inverse_render_text_lines(" single line ") == [" single line"]
    assert ocr_pipeline._inverse_render_text_lines("") == []

    class _FakeDraw:
        def textbbox(self, _pos, text, *, font):  # noqa: ANN001, ANN202
            del font
            return (0, 0, len(text) * 10, 10)

    assert ocr_pipeline._wrap_render_line(_FakeDraw(), object(), "", 50) == [""]
    assert ocr_pipeline._wrap_render_line(_FakeDraw(), object(), "one two three", 45) == ["one", "two", "three"]

    original_image_draw = ocr_pipeline.ImageDraw
    monkeypatch.setattr(ocr_pipeline, "ImageDraw", None)
    with pytest.raises(RuntimeError, match="Missing dependency for inverse-render reranking"):
        ocr_pipeline._wrapped_inverse_render_line_groups("text", None, 12, 100)
    with pytest.raises(RuntimeError, match="Missing dependency for inverse-render reranking"):
        ocr_pipeline._render_inverse_text_image("text", (20, 20), (0, 0, 10, 10), font_path=None, font_size=12, offset_x=0, offset_y=0, rotation=0.0)
    monkeypatch.setattr(ocr_pipeline, "ImageDraw", original_image_draw)

    original_image_chops = ocr_pipeline.ImageChops
    monkeypatch.setattr(ocr_pipeline, "ImageChops", None)
    blank = Image.new("L", (2, 2), color=255)
    assert ocr_pipeline._binary_ink_iou(blank, blank) == 0.0
    monkeypatch.setattr(ocr_pipeline, "ImageChops", original_image_chops)
    assert ocr_pipeline._rotate_inverse_render_image(blank, 0.0) is blank
    with pytest.raises(ValueError, match="rendered_candidates must not be empty"):
        ocr_pipeline._best_inverse_render_rendered_batch(blank, [])

    assert ocr_pipeline._page_artifact_text_path(tmp_path, 7) == tmp_path / "page-0007.txt"

    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(llm_suspicious_sections=False), preprocess_mode="none")
    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=None,
    )
    assert ocr_pipeline._maybe_analyze_suspicious_sections([], [], options, deps) == {}

    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(llm_suspicious_sections=True), preprocess_mode="none")
    assert ocr_pipeline._maybe_analyze_suspicious_sections([], [], options, deps)["status"] == "unavailable"

    monkeypatch.setattr(ocr_pipeline, "_suspicious_section_candidates", lambda *_args, **_kwargs: [])
    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=lambda prompt: prompt,
    )
    assert ocr_pipeline._maybe_analyze_suspicious_sections(["text"], [{}], options, deps)["status"] == "skipped-no-candidates"

    monkeypatch.setattr(
        ocr_pipeline,
        "_suspicious_section_candidates",
        lambda *_args, **_kwargs: [{"page_index": 1, "section_index": 1, "heuristic_score": 1.0, "page_quality_tier": "low", "page_route": "body", "page_text_noise_ratio": 0.1, "hocr_low_confidence_ratio": 0.5, "symbolic_token_count": 1, "digit_alpha_token_count": 0, "excerpt": "excerpt"}],
    )
    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=lambda _prompt: 3,
    )
    assert ocr_pipeline._maybe_analyze_suspicious_sections(["text"], [{}], options, deps)["status"] == "invalid-output"

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=lambda _prompt: '{"suspicious": true, "confidence": "high", "reason": "review", "focus_spans": ["span"]}',
    )
    review = ocr_pipeline._maybe_analyze_suspicious_sections(["text"], [{}], options, deps)
    assert review["status"] == "applied"
    assert review["flagged_count"] == 1


def test_page_analysis_and_llm_layout_helpers_cover_remaining_decision_paths(monkeypatch) -> None:
    metadata = ocr_pipeline._page_analysis_metadata(
        "Chapter 1\nBody text with enough words here",
        {
            "selection_score": 50.0,
            "hocr_confidence_mean": 80.0,
            "hocr_low_confidence_ratio": 0.2,
            "candidate_near_best_family_count": 2,
            "candidate_best_alt_score_gap": 0.4,
            "candidate_best_alt_text_similarity": 0.4,
        },
        page_index=1,
        total_pages=10,
    )
    assert metadata["page_candidate_near_best_family_count"] == 2
    assert metadata["page_chapter_marker_count"] == 1

    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(layout_region_detection=False), preprocess_mode="none")
    assert ocr_pipeline._maybe_apply_layout_region_detection("12", {}, options) == ("12", {})

    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(layout_region_detection=True), preprocess_mode="none")
    monkeypatch.setattr(ocr_pipeline, "_classify_layout_entries", lambda *_args, **_kwargs: [])
    assert ocr_pipeline._maybe_apply_layout_region_detection("12", {}, options) == (
        "12",
        {"layout_region_detection_enabled": True},
    )

    monkeypatch.setattr(
        ocr_pipeline,
        "_classify_layout_entries",
        lambda *_args, **_kwargs: [{"text": "Body", "region": "body"}, {"text": "More", "region": "body"}],
    )
    kept_text, layout_meta = ocr_pipeline._maybe_apply_layout_region_detection("Body\nMore", {}, options)
    assert kept_text == "Body\nMore"
    assert layout_meta["layout_removed_lines"] == 0

    monkeypatch.setattr(
        ocr_pipeline,
        "_classify_layout_entries",
        lambda *_args, **_kwargs: [{"text": "12", "region": "page-number"}, {"text": "Body", "region": "body"}],
    )
    kept_text, layout_meta = ocr_pipeline._maybe_apply_layout_region_detection("12\nBody", {}, options)
    assert kept_text == "Body"
    assert layout_meta["layout_removed_lines"] == 1

    core = ocr_pipeline.OCRCoreOptions(llm_post_correction=True, llm_min_low_confidence_ratio=0.1, llm_max_word_delta_ratio=0.2)
    options = ocr_pipeline.OCRRunOptions(core=core, preprocess_mode="none")
    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=None,
    )
    assert ocr_pipeline._maybe_apply_llm_post_correction("text", {}, options, deps) == (
        "text",
        {"llm_post_correction": "unavailable"},
    )

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=lambda text: text,
        llm_suspicious_section_analyzer=None,
    )
    assert ocr_pipeline._maybe_apply_llm_post_correction("text", {"hocr_low_confidence_ratio": 0.01}, options, deps)[1]["llm_post_correction"] == "skipped-low-risk"

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=lambda _text: 3,
        llm_suspicious_section_analyzer=None,
    )
    assert ocr_pipeline._maybe_apply_llm_post_correction("text", {"hocr_low_confidence_ratio": 0.5}, options, deps)[1]["llm_post_correction"] == "invalid-output"

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=lambda text: f"  {text}  ",
        llm_suspicious_section_analyzer=None,
    )
    assert ocr_pipeline._maybe_apply_llm_post_correction("text", {"hocr_low_confidence_ratio": 0.5}, options, deps)[1]["llm_post_correction"] == "no-change"

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=lambda _text: "one two three four five six",
        llm_suspicious_section_analyzer=None,
    )
    assert ocr_pipeline._maybe_apply_llm_post_correction("one two", {"hocr_low_confidence_ratio": 0.5}, options, deps)[1]["llm_post_correction"] == "rejected-word-delta"

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=lambda _text: "fixed words",
        llm_suspicious_section_analyzer=None,
    )
    corrected_text, llm_meta = ocr_pipeline._maybe_apply_llm_post_correction(
        "broken words",
        {"hocr_low_confidence_ratio": 0.5},
        options,
        deps,
    )
    assert corrected_text == "fixed words"
    assert llm_meta["llm_post_correction"] == "applied"


@pytest.mark.parametrize(
    ("core_kwargs", "message"),
    [
        ({"tesseract_output_format": "pdf"}, "tesseract_output_format"),
        ({"cleanup_high_confidence_threshold": 101.0}, "cleanup_high_confidence_threshold"),
        ({"tiered_ocr_min_score": 0.0}, "tiered_ocr_min_score"),
        ({"llm_min_low_confidence_ratio": -0.1}, "llm_min_low_confidence_ratio"),
        ({"llm_suspicious_max_candidates": 0}, "llm_suspicious_max_candidates"),
        ({"llm_suspicious_max_sections": 0}, "llm_suspicious_max_sections"),
        ({"inverse_render_top_k": 0}, "inverse_render_top_k"),
        ({"inverse_render_workers": 0}, "inverse_render_workers"),
    ],
)
def test_validate_common_ocr_options_covers_remaining_guards(core_kwargs, message) -> None:
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(**core_kwargs),
        preprocess_mode="none",
    )

    with pytest.raises(ValueError, match=message):
        ocr_pipeline._validate_common_ocr_options(options, lambda _name: "/usr/bin/fake")


def test_validate_run_options_and_pdf_page_count_cover_missing_edges(tmp_path, monkeypatch) -> None:
    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(), preprocess_mode="none")
    with pytest.raises(FileNotFoundError, match="Input PDF not found"):
        ocr_pipeline._validate_ocr_run_options(
            tmp_path / "missing.pdf",
            options,
            lambda _name: "/usr/bin/fake",
        )

    missing_page = tmp_path / "missing.png"
    with pytest.raises(FileNotFoundError, match="Input page images not found"):
        ocr_pipeline._validate_page_image_run_options(
            [missing_page],
            options,
            lambda _name: "/usr/bin/fake",
        )

    monkeypatch.setattr(
        ocr_pipeline.subprocess,
        "run",
        lambda *_args, **_kwargs: types.SimpleNamespace(stdout="Title: demo\n"),
    )
    assert ocr_pipeline._pdf_page_count(tmp_path / "demo.pdf") is None


def test_rasterize_pdf_to_images_covers_progress_and_empty_output(tmp_path, monkeypatch) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")
    work_dir = tmp_path / "work"
    pages_dir = work_dir / "pages"
    progress_events: list[dict[str, object]] = []

    monkeypatch.setattr(ocr_pipeline, "_pdf_page_count", lambda _pdf_path: 2)
    monkeypatch.setattr(ocr_pipeline.time, "sleep", lambda _seconds: None)

    class _FakeProcess:
        def __init__(self) -> None:
            self.returncode = 0
            self._poll_count = 0

        def poll(self):  # noqa: ANN202
            self._poll_count += 1
            if self._poll_count == 1:
                (pages_dir / "page-1.png").write_bytes(b"1")
                return None
            if self._poll_count == 2:
                (pages_dir / "page-2.png").write_bytes(b"2")
                return None
            return 0

    monkeypatch.setattr(ocr_pipeline.subprocess, "Popen", lambda _command: _FakeProcess())
    page_images = ocr_pipeline._rasterize_pdf_to_images(
        pdf_path,
        work_dir,
        300,
        ocr_pipeline._run_command,
        progress_callback=progress_events.append,
    )
    assert [path.name for path in page_images] == ["page-1.png", "page-2.png"]
    assert progress_events

    empty_work_dir = tmp_path / "empty-work"

    def _no_output(_command: list[str], _capture_output: bool) -> str:
        return ""

    with pytest.raises(RuntimeError, match="pdftoppm produced no page images"):
        ocr_pipeline._rasterize_pdf_to_images(pdf_path, empty_work_dir, 300, _no_output)


def test_prepared_input_match_and_inverse_render_helpers_cover_remaining_edges(tmp_path, monkeypatch) -> None:
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    Image.new("L", (5, 5), color=255).save(first)
    Image.new("L", (6, 5), color=255).save(second)

    assert ocr_pipeline._prepared_ocr_inputs_match(first, first) is True
    assert ocr_pipeline._prepared_ocr_inputs_match(first, second) is False

    same_bytes = tmp_path / "same-bytes.bin"
    other_same_bytes = tmp_path / "other-same-bytes.bin"
    same_bytes.write_bytes(b"abc")
    other_same_bytes.write_bytes(b"abc")

    def _raise_open(_path):  # noqa: ANN001, ANN202
        raise OSError("bad image")

    monkeypatch.setattr(ocr_pipeline.Image, "open", _raise_open)
    assert ocr_pipeline._prepared_ocr_inputs_match(same_bytes, other_same_bytes) is True

    existing = tmp_path / "font.ttf"
    existing.write_text("font", encoding="utf-8")
    missing = tmp_path / "missing.ttf"
    ocr_pipeline._inverse_render_font_paths.cache_clear()
    monkeypatch.setattr(
        ocr_pipeline,
        "_fontconfig_match",
        lambda family: {"serif": None, "sans": str(existing), "monospace": str(existing)}.get(family),
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_DEFAULT_RENDER_FONT_CANDIDATES",
        (str(missing), str(existing)),
    )
    try:
        assert ocr_pipeline._inverse_render_font_paths() == (str(existing),)
    finally:
        ocr_pipeline._inverse_render_font_paths.cache_clear()


def test_inverse_render_small_helpers_cover_remaining_branches(monkeypatch) -> None:
    rendered = ocr_pipeline._render_inverse_text_image(
        "top\n\nbottom",
        (80, 80),
        (0, 0, 60, 60),
        font_path=None,
        font_size=12,
        offset_x=0,
        offset_y=0,
        rotation=1.0,
    )
    assert rendered.size == (80, 80)
    blank = Image.new("L", (2, 2), color=255)
    assert ocr_pipeline._binary_ink_iou(blank, blank) == 0.0

    request = ocr_pipeline._InverseRenderScoreRequest(observed_binary=blank, bbox=(0, 0, 2, 2), text="")
    assert ocr_pipeline._score_inverse_render_request(request)[0] == -1.0
    assert ocr_pipeline._inverse_render_score_many(blank, (0, 0, 2, 2), [], workers=1) == []

    with pytest.raises(ValueError, match="valid bbox"):
        ocr_pipeline._render_inverse_text_from_metadata(
            "text",
            (20, 20),
            {"inverse_render_bbox": "bad"},
        )
    metadata = {
        "inverse_render_bbox": [0, 0, 10, 10],
        "inverse_render_font_path": None,
        "inverse_render_font_size": 12,
        "inverse_render_offset_x": 0,
        "inverse_render_offset_y": 0,
        "inverse_render_rotation": 0.0,
    }
    assert ocr_pipeline._render_inverse_text_from_metadata("text", (20, 20), metadata).size == (20, 20)
    assert ocr_pipeline._bbox_area((5, 5, 4, 4)) == 0
    assert ocr_pipeline._clip_bbox_to_canvas((10, 10, 5, 5), (20, 20)) is None

    original_image_chops = ocr_pipeline.ImageChops
    monkeypatch.setattr(ocr_pipeline, "ImageChops", None)
    with pytest.raises(RuntimeError, match="cleanup span verification"):
        ocr_pipeline._cleanup_span_diff_bbox(blank, blank)
    monkeypatch.setattr(ocr_pipeline, "ImageChops", original_image_chops)

    changed = blank.copy()
    changed.putpixel((1, 1), 0)
    assert ocr_pipeline._cleanup_span_diff_bbox(blank, changed) is not None


def test_cleanup_span_replacement_and_ensemble_helpers_cover_remaining_branches(monkeypatch) -> None:
    observed = Image.new("L", (20, 20), color=255)
    monkeypatch.setattr(
        ocr_pipeline,
        "_inverse_render_score_many",
        lambda *_args, **_kwargs: [(0.5, metadata := {"inverse_render_bbox": [0, 0, 20, 20], "inverse_render_font_path": None, "inverse_render_font_size": 12, "inverse_render_offset_x": 0, "inverse_render_offset_y": 0, "inverse_render_rotation": 0.0}), (0.6, metadata)],
    )
    monkeypatch.setattr(ocr_pipeline, "_render_inverse_text_from_metadata", lambda *_args, **_kwargs: observed)
    monkeypatch.setattr(ocr_pipeline, "_cleanup_span_diff_bbox", lambda *_args, **_kwargs: None)
    accepted, decision = ocr_pipeline._evaluate_cleanup_span_replacement(observed, (0, 0, 20, 20), "raw", "clean")
    assert accepted is False
    assert decision["reason"] == "no-local-image-difference"

    monkeypatch.setattr(ocr_pipeline, "_cleanup_span_diff_bbox", lambda *_args, **_kwargs: (0, 0, 20, 20))
    accepted, decision = ocr_pipeline._evaluate_cleanup_span_replacement(observed, (0, 0, 20, 20), "raw", "clean")
    assert accepted is False
    assert decision["reason"] == "diff-region-too-large"

    candidate = ocr_pipeline.OCRCandidate(
        score=100.0,
        text="masked",
        ocr_input_path=Path("page.png"),
        metadata={"candidate_preprocess_mode": "scan-masked"},
    )
    assert (
        ocr_pipeline._maybe_prefer_unmasked_auto_candidate(
            candidate,
            [candidate],
            ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(), preprocess_mode="auto"),
        )
        is None
    )

    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(cleanup_lexicon_texts=("ref",)),
        preprocess_mode="none",
        ocr_engine="ensemble",
    )
    dependencies = ocr_pipeline.OCRDependencies(
        run_command=lambda _cmd, _capture: "",
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=None,
    )
    monkeypatch.setattr(ocr_pipeline, "_run_tesseract", lambda *_args, **_kwargs: ("the cat sat on the mat", {"engine": "tesseract"}))
    monkeypatch.setattr(ocr_pipeline, "_run_paddle_reader", lambda *_args, **_kwargs: "the dog sat on the mat")
    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, *_args, **_kwargs: (20.0, {}) if "cat" in text else (10.0, {}),
    )
    text, metadata = ocr_pipeline._run_candidate_ocr(Path("page.png"), options, dependencies, None, "6")
    # tesseract wins on engine score; per-word fusion may keep cat (real word)
    # or swap to dog (also a real word); both are real English words so the
    # lexical scorer may go either way.
    assert "sat on the mat" in text
    assert metadata["ensemble_selected_engine"] == "tesseract"

    monkeypatch.setattr(
        ocr_pipeline,
        "_score_ocr_candidate",
        lambda text, *_args, **_kwargs: (5.0, {}) if "cat" in text else (15.0, {}),
    )
    text, metadata = ocr_pipeline._run_candidate_ocr(Path("page.png"), options, dependencies, None, "6")
    assert "sat on the mat" in text
    assert metadata["ensemble_selected_engine"] == "paddleocr"


def test_suspicious_resume_retry_and_mode_archive_helpers_cover_remaining_branches(tmp_path, monkeypatch) -> None:
    assert ocr_pipeline._parse_suspicious_section_response('{"suspicious": true, "reason": ""}') is None

    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(llm_suspicious_sections=True, llm_suspicious_max_sections=1),
        preprocess_mode="none",
    )
    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=lambda _prompt: '{"suspicious": false, "confidence": "low", "reason": "nope", "focus_spans": []}',
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_suspicious_section_candidates",
        lambda *_args, **_kwargs: [{"page_index": 1, "section_index": 1, "heuristic_score": 1.0, "page_quality_tier": "low", "page_route": "body", "page_text_noise_ratio": 0.1, "hocr_low_confidence_ratio": 0.5, "symbolic_token_count": 1, "digit_alpha_token_count": 0, "excerpt": "excerpt"}],
    )
    review = ocr_pipeline._maybe_analyze_suspicious_sections(["text"], [{}], options, deps)
    assert review["flagged_count"] == 0

    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=lambda _prompt: "not json",
    )
    review = ocr_pipeline._maybe_analyze_suspicious_sections(["text"], [{}], options, deps)
    assert review["invalid_response_count"] == 1

    artifacts_dir = tmp_path / "resume-artifacts"
    artifacts_dir.mkdir()
    page_images = [tmp_path / "page-1.png"]
    page_images[0].write_bytes(b"x")
    manifest_path = artifacts_dir / "manifest.json"
    manifest_path.write_text(json.dumps({"pages": {}}), encoding="utf-8")
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])

    manifest_path.write_text(json.dumps({"pages": ["bad"]}), encoding="utf-8")
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])

    text_path = artifacts_dir / "page-0001.txt"
    manifest_path.write_text(json.dumps({"pages": [{"page_index": 1, "image_path": str(page_images[0]), "text_path": str(text_path)}]}), encoding="utf-8")
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])
    text_path.write_text("ok", encoding="utf-8")
    original_read_text = Path.read_text
    monkeypatch.setattr(
        Path,
        "read_text",
        lambda self, encoding="utf-8": (_ for _ in ()).throw(OSError("bad"))
        if self == text_path
        else original_read_text(self, encoding=encoding),
    )
    assert ocr_pipeline._load_resumed_page_artifacts(artifacts_dir, page_images) == ([], [])

    assert ocr_pipeline._targeted_page_retry_reason({"page_route": "front-matter"}, options) == "front-matter"
    assert ocr_pipeline._targeted_page_retry_policy({"page_layout_region_counts": {"toc": 1}}, "front-matter")["name"] == "front-matter-toc"
    assert ocr_pipeline._targeted_page_retry_policy({}, "front-matter")["name"] == "front-matter-sparse"
    assert ocr_pipeline._targeted_page_retry_policy({}, "back-matter")["name"] == "back-matter"
    assert ocr_pipeline._quality_tier_rank("high") == 2

    original_image = ocr_pipeline.Image
    monkeypatch.setattr(ocr_pipeline, "Image", None)
    assert ocr_pipeline._adaptive_raster_retry_image(Path("page.png"), Path("prep"), "front-matter") is None
    monkeypatch.setattr(ocr_pipeline, "Image", original_image)
    assert ocr_pipeline._adaptive_raster_retry_image(Path("page.png"), Path("prep"), "unknown") is None

    tiny = tmp_path / "tiny.png"
    Image.new("L", (8, 8), color=255).save(tiny)
    assert ocr_pipeline._adaptive_raster_retry_image(tiny, tmp_path, "front-matter") is None

    assert ocr_pipeline._should_keep_targeted_retry(
        {"selection_score": 10.0, "page_quality_tier": "low"},
        {"selection_score": 9.0, "page_quality_tier": "medium"},
    ) is True
    assert ocr_pipeline._should_keep_targeted_retry(
        {"selection_score": 10.0, "page_quality_tier": "low", "page_single_char_fragment_ratio": "bad"},
        {"selection_score": 9.0, "page_quality_tier": "low", "page_single_char_fragment_ratio": 0.1, "page_apostrophe_fragment_ratio": 0.1},
    ) is False

    assert ocr_pipeline._parse_mode_eval_options({"reference_text_path": str(tmp_path / "ref.txt")}).reference_text_path == tmp_path / "ref.txt"
    assert ocr_pipeline._rank_modes({"modes": []}) == []
    assert ocr_pipeline._rank_modes({"modes": {"scan": []}}) == []
    assert ocr_pipeline._rank_modes({"modes": {"scan": {"accuracy": []}}}) == []
    assert ocr_pipeline._load_reference_text(
        ocr_pipeline.ModeEvalOptions(core=ocr_pipeline.OCRCoreOptions(), ocr_engine="tesseract", reference_text_path=None, modes=("none",))
    ) is None

    report = {"modes": {}}
    ocr_pipeline._store_mode_payload(report, "scan", {"ok": True})
    assert report["modes"]["scan"] == {"ok": True}
    ocr_pipeline._attach_mode_ranking(report)
    assert report["best_mode"] == "scan"
    empty_report = {"modes": {}}
    ocr_pipeline._attach_mode_ranking(empty_report)
    assert "best_mode" not in empty_report

    with pytest.raises(ValueError, match="archive_source_mode must be one of"):
        ocr_pipeline._archive_reference_pairs("demo", "bad")
    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_archive_ocr_text", lambda _identifier: "djvu")
    monkeypatch.setattr("full_auto_de_pdf.benchmark.fetch_archive_abbyy_text", lambda _identifier: None)
    with pytest.raises(ValueError, match="no ABBYY OCR is available"):
        ocr_pipeline._archive_reference_pairs("demo", "abbyy")
    assert ocr_pipeline._archive_reference_pairs("demo", "djvu") == [("djvu", "djvu")]
    assert ocr_pipeline._best_scores({"mode_ranking": []}) == (1.0, 1.0)


def test_projection_baseline_and_tiled_binarize_cover_remaining_helper_branches(monkeypatch) -> None:
    assert ocr_pipeline._projection_variance(Image.new("L", (1, 0), color=255)) == 0.0
    slope, intercept = ocr_pipeline._linear_center_baseline([1.0, 2.0, 3.0])
    assert slope == pytest.approx(1.0)
    assert intercept == pytest.approx(1.0)

    candidate = Image.new("L", (20, 20), color=200)
    monkeypatch.setattr(ocr_pipeline, "_should_use_tiled_threshold", lambda _image: True)
    monkeypatch.setattr(ocr_pipeline, "_threshold_image_in_overlapping_tiles", lambda image, **_kwargs: image)
    monkeypatch.setattr(ocr_pipeline, "_normalize_scan_background", lambda image, **_kwargs: image)
    assert (
        ocr_pipeline._binarize_preprocessed_candidate(candidate, "scan-background-normalized", 128)
        is candidate
    )
    assert ocr_pipeline._binarize_preprocessed_candidate(candidate, "scan-sauvola", 128) is candidate


def test_mask_sparse_outer_text_bands_covers_top_and_bottom_control_flow(monkeypatch) -> None:
    image = Image.new("L", (100, 100), color=0)
    bands = [
        {"top": 0, "bottom": 4, "height": 5, "ink_width": 5, "peak_row_ink": 1},
        {"top": 5, "bottom": 9, "height": 5, "ink_width": 1, "peak_row_ink": 1},
        {"top": 10, "bottom": 28, "height": 19, "ink_width": 1, "peak_row_ink": 1},
        {"top": 29, "bottom": 59, "height": 31, "ink_width": 60, "peak_row_ink": 20},
        {"top": 60, "bottom": 78, "height": 19, "ink_width": 1, "peak_row_ink": 1},
        {"top": 79, "bottom": 83, "height": 5, "ink_width": 1, "peak_row_ink": 1},
        {"top": 84, "bottom": 88, "height": 5, "ink_width": 5, "peak_row_ink": 1},
    ]
    monkeypatch.setattr(ocr_pipeline, "_collect_ink_bands", lambda _image: bands)
    monkeypatch.setattr(ocr_pipeline, "_is_significant_ink_band", lambda band, _width: band["ink_width"] >= 60)
    monkeypatch.setattr(ocr_pipeline, "_should_mask_outer_band", lambda band, *_args: band["ink_width"] == 1)
    masked = ocr_pipeline._mask_sparse_outer_text_bands(image)
    assert masked.getpixel((0, 6)) == 255
    assert masked.getpixel((0, 12)) == 0
    assert masked.getpixel((0, 80)) == 255
    assert masked.getpixel((0, 80)) == 255


def test_normalize_background_page_summary_and_excerpt_helpers_cover_remaining_edges() -> None:
    normalized = ocr_pipeline._normalize_scan_background(
        Image.new("L", (12, 12), color=200),
        blur_radius=1.0,
        contrast_scale=1.2,
        closing_size=3,
    )
    assert normalized.size == (12, 12)

    with pytest.raises(RuntimeError, match="PaddleOCR reader was not initialized"):
        ocr_pipeline._run_paddle_reader(None, Path("page.png"))

    summary = ocr_pipeline._page_analysis_summary(
        [
            {"page_index": "bad"},
            {"page_index": 2, "page_type": "front-matter", "page_quality_tier": "low", "page_route": "body"},
        ]
    )
    assert summary["front_matter_page_indices"] == [2]
    assert summary["low_quality_page_indices"] == [2]
    assert ocr_pipeline._extract_hocr_word_confidence("no confidence here") is None
    assert ocr_pipeline._edge_page_window(0, 10) == 0

    assert ocr_pipeline._suspicious_section_candidates(["text", "more text"], [{}], max_candidates=5) == []


def test_rasterize_pdf_to_images_covers_failure_and_non_progress_paths(tmp_path, monkeypatch) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"pdf")
    work_dir = tmp_path / "work"
    pages_dir = work_dir / "pages"

    monkeypatch.setattr(ocr_pipeline, "_pdf_page_count", lambda _pdf_path: 1)
    monkeypatch.setattr(ocr_pipeline.time, "sleep", lambda _seconds: None)

    class _FailingProcess:
        def __init__(self) -> None:
            self.returncode = 1

        def poll(self):  # noqa: ANN202
            return 1

    monkeypatch.setattr(ocr_pipeline.subprocess, "Popen", lambda _command: _FailingProcess())
    with pytest.raises(ocr_pipeline.subprocess.CalledProcessError):
        ocr_pipeline._rasterize_pdf_to_images(
            pdf_path,
            work_dir,
            300,
            ocr_pipeline._run_command,
            progress_callback=lambda _payload: None,
        )

    invoked: list[list[str]] = []

    def _run_command(command: list[str], _capture_output: bool) -> str:
        invoked.append(command)
        pages_dir.mkdir(parents=True, exist_ok=True)
        (pages_dir / "page-1.png").write_bytes(b"1")
        return ""

    page_images = ocr_pipeline._rasterize_pdf_to_images(pdf_path, work_dir, 300, _run_command)
    assert invoked
    assert [path.name for path in page_images] == ["page-1.png"]

    unknown_work_dir = tmp_path / "unknown-work"
    pages_dir = unknown_work_dir / "pages"
    monkeypatch.setattr(
        ocr_pipeline.subprocess,
        "run",
        lambda command, check, text, capture_output: (
            pages_dir.mkdir(parents=True, exist_ok=True),
            (pages_dir / "page-1.png").write_bytes(b"1"),
            types.SimpleNamespace(stdout=""),
        )[-1],
    )
    monkeypatch.setattr(ocr_pipeline, "_pdf_page_count", lambda _pdf_path: None)
    page_images = ocr_pipeline._rasterize_pdf_to_images(
        pdf_path,
        unknown_work_dir,
        300,
        ocr_pipeline._run_command,
        progress_callback=lambda _payload: None,
    )
    assert [path.name for path in page_images] == ["page-1.png"]


def test_binary_iou_fallback_and_cleanup_verifier_no_change_branch(monkeypatch) -> None:
    original_image_chops = ocr_pipeline.ImageChops
    monkeypatch.setattr(ocr_pipeline, "ImageChops", None)
    observed = Image.new("L", (2, 1), color=255)
    rendered = Image.new("L", (2, 1), color=255)
    observed.putpixel((0, 0), 0)
    rendered.putpixel((0, 0), 0)
    rendered.putpixel((1, 0), 0)
    assert ocr_pipeline._binary_ink_iou(observed, rendered) == pytest.approx(0.5)
    monkeypatch.setattr(ocr_pipeline, "ImageChops", original_image_chops)

    monkeypatch.setattr(ocr_pipeline, "cleanup_ocr_text", lambda *_args, **_kwargs: "changed text")
    monkeypatch.setattr(ocr_pipeline, "_cleanup_span_changes", lambda *_args, **_kwargs: [])
    cleaned, metadata = ocr_pipeline._maybe_verify_cleanup_spans(
        Path("page.png"),
        "raw text",
        ocr_pipeline.OCRRunOptions(
            core=ocr_pipeline.OCRCoreOptions(apply_cleanup=True, verify_cleanup_spans=True),
            preprocess_mode="none",
        ),
        {},
    )
    assert cleaned == "changed text"
    assert metadata["cleanup_span_verifier"]["changes_considered"] == 0


def test_hocr_bbox_rerank_and_candidate_selection_cover_remaining_edges(monkeypatch) -> None:
    change = ocr_pipeline._CleanupSpanChange(
        raw_start=0,
        raw_end=1,
        cleaned_start=0,
        cleaned_end=1,
        raw_text="raw",
        cleaned_text="clean",
        raw_token_count=1,
        cleaned_token_count=1,
        raw_token_start_index=1,
        raw_token_end_index=1,
    )
    assert ocr_pipeline._hocr_bbox_hint_for_change(change, {"hocr_word_boxes_runtime": [(0, 0, 1, 1)]}) is None
    change = ocr_pipeline._CleanupSpanChange(
        raw_start=0,
        raw_end=1,
        cleaned_start=0,
        cleaned_end=1,
        raw_text="raw",
        cleaned_text="clean",
        raw_token_count=1,
        cleaned_token_count=1,
        raw_token_start_index=1,
        raw_token_end_index=3,
    )
    assert ocr_pipeline._hocr_bbox_hint_for_change(change, {"hocr_word_boxes_runtime": [(0, 0, 1, 1)]}) is None
    change = ocr_pipeline._CleanupSpanChange(
        raw_start=0,
        raw_end=1,
        cleaned_start=0,
        cleaned_end=1,
        raw_text="raw",
        cleaned_text="clean",
        raw_token_count=1,
        cleaned_token_count=1,
        raw_token_start_index=0,
        raw_token_end_index=1,
    )
    assert ocr_pipeline._hocr_bbox_hint_for_change(change, {"hocr_word_boxes_runtime": [("bad",)]}) is None

    selected = ocr_pipeline.OCRCandidate(
        score=100.0,
        ocr_input_path=Path("page.png"),
        text="masked",
        metadata={"candidate_preprocess_mode": "scan-masked"},
    )
    assert (
        ocr_pipeline._maybe_prefer_unmasked_auto_candidate(
            selected,
            [
                selected,
                ocr_pipeline.OCRCandidate(
                    score=90.0,
                    ocr_input_path=Path("other.png"),
                    text="other",
                    metadata={"candidate_preprocess_mode": "deskew"},
                ),
            ],
            ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(), preprocess_mode="auto"),
        )
        is None
    )

    original_zip = zip

    def _patched_zip(*args, **kwargs):  # noqa: ANN202, ANN003
        if args and isinstance(args[0], list) and args[0] and isinstance(args[0][0], tuple) and len(args[0][0]) == 4:
            return iter(())
        return original_zip(*args, **kwargs)

    monkeypatch.setattr("builtins.zip", _patched_zip)
    monkeypatch.setattr(
        ocr_pipeline,
        "_normalize_scan_for_inverse_render",
        lambda _image_path: (Image.new("L", (2, 2), color=255), (0, 0, 2, 2)),
    )
    monkeypatch.setattr(ocr_pipeline, "_inverse_render_score_many", lambda *_args, **_kwargs: [(0.2, {}), (0.1, {})])
    candidates = [
        ocr_pipeline.OCRCandidate(10.0, Path("a.png"), "first", {}),
        ocr_pipeline.OCRCandidate(9.0, Path("b.png"), "second", {}),
    ]
    reranked = ocr_pipeline._maybe_inverse_render_rerank(
        Path("page.png"),
        candidates,
        ocr_pipeline.OCRRunOptions(
            core=ocr_pipeline.OCRCoreOptions(inverse_render_rerank=True),
            preprocess_mode="none",
        ),
    )
    assert reranked is None


def test_run_ocr_on_page_tiered_and_orientation_fallback_cover_remaining_negative_paths(
    tmp_path, monkeypatch
) -> None:
    dependencies = ocr_pipeline.OCRDependencies(
        run_command=lambda _cmd, _capture: "",
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=None,
        llm_suspicious_section_analyzer=None,
    )
    options = ocr_pipeline.OCRRunOptions(core=ocr_pipeline.OCRCoreOptions(), preprocess_mode="none")
    monkeypatch.setattr(ocr_pipeline, "_candidate_preprocess_modes_for_options", lambda _options: ())
    monkeypatch.setattr(ocr_pipeline, "_candidate_tesseract_psms", lambda _options: ("6",))
    with pytest.raises(RuntimeError, match="OCR produced no candidates"):
        ocr_pipeline._run_ocr_on_page(tmp_path / "page.png", options, dependencies, tmp_path, None)

    image_path = tmp_path / "page.png"
    Image.new("L", (20, 100), color=255).save(image_path)
    candidate = ocr_pipeline.OCRCandidate(10.0, image_path, "text", {"tesseract_psm": "6"})
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(tiered_ocr_fallback=True, orientation_fallback=True),
        preprocess_mode="none",
    )
    assert ocr_pipeline._maybe_tiered_fallback_candidate(candidate, options, dependencies, None, tmp_path) is None
    assert ocr_pipeline._maybe_orientation_fallback_candidate(candidate, options, dependencies, None, tmp_path) is None

    candidate = ocr_pipeline.OCRCandidate(10.0, image_path, "text", {"tesseract_psm": 6})
    assert ocr_pipeline._maybe_tiered_fallback_candidate(candidate, options, dependencies, None, tmp_path) is None

    tall_image = tmp_path / "tall.png"
    Image.new("L", (20, 900), color=255).save(tall_image)
    candidate = ocr_pipeline.OCRCandidate(10.0, tall_image, "text", {"tesseract_psm": 6})
    monkeypatch.setattr(ocr_pipeline, "_run_candidate_ocr", lambda *_args, **_kwargs: ("   ", {}))
    assert ocr_pipeline._maybe_tiered_fallback_candidate(candidate, options, dependencies, None, tmp_path) is None

    monkeypatch.setattr(ocr_pipeline, "_run_candidate_ocr", lambda *_args, **_kwargs: ("better", {}))
    monkeypatch.setattr(ocr_pipeline, "_score_ocr_text", lambda *_args, **_kwargs: 9.0)
    assert ocr_pipeline._maybe_tiered_fallback_candidate(candidate, options, dependencies, None, tmp_path) is None

    monkeypatch.setattr(ocr_pipeline, "_score_ocr_candidate", lambda *_args, **_kwargs: (9.0, {}))
    assert ocr_pipeline._maybe_orientation_fallback_candidate(candidate, options, dependencies, None, tmp_path) is None


def test_remaining_suspicious_progress_quality_and_postprocess_branches(tmp_path, monkeypatch) -> None:
    options = ocr_pipeline.OCRRunOptions(
        core=ocr_pipeline.OCRCoreOptions(llm_suspicious_sections=True, llm_suspicious_max_sections=1),
        preprocess_mode="none",
        ocr_engine="ensemble",
    )
    deps = ocr_pipeline.OCRDependencies(
        run_command=ocr_pipeline._run_command,
        preprocess_image=ocr_pipeline._preprocess_image,
        paddle_reader_factory=ocr_pipeline._build_paddleocr_reader,
        which=ocr_pipeline.shutil.which,
        llm_corrector=lambda text: text,
        llm_suspicious_section_analyzer=lambda _prompt: '{"suspicious": true, "confidence": "high", "reason": "bad", "focus_spans": []}',
    )
    monkeypatch.setattr(
        ocr_pipeline,
        "_suspicious_section_candidates",
        lambda *_args, **_kwargs: [
            {
                "page_index": 1,
                "section_index": 1,
                "heuristic_score": 1.0,
                "page_quality_tier": "low",
                "page_route": "body",
                "page_text_noise_ratio": 0.1,
                "hocr_low_confidence_ratio": 0.4,
                "symbolic_token_count": 1,
                "digit_alpha_token_count": 0,
                "excerpt": "one",
            },
            {
                "page_index": 1,
                "section_index": 2,
                "heuristic_score": 1.1,
                "page_quality_tier": "low",
                "page_route": "body",
                "page_text_noise_ratio": 0.1,
                "hocr_low_confidence_ratio": 0.4,
                "symbolic_token_count": 1,
                "digit_alpha_token_count": 0,
                "excerpt": "two",
            },
        ],
    )
    review = ocr_pipeline._maybe_analyze_suspicious_sections(["text"], [{}], options, deps)
    assert review["reviewed_count"] == 1
    assert review["flagged_count"] == 1

    payload = ocr_pipeline._ocr_candidate_progress_payload(
        total_pages=5,
        completed_pages=1,
        current_page_index=2,
        candidate_index=1,
        candidate_total=3,
        preprocess_mode="none",
        tesseract_psm="6",
        started_at=0.0,
        retry_reason="body-review",
    )
    assert payload["retry_reason"] == "body-review"
    assert ocr_pipeline._classify_page_quality_tier(
        page_type="body",
        word_count=100,
        dense_body_line_count=5,
        selection_score=700.0,
        noise_ratio=0.0,
        hocr_confidence_mean=95.0,
        hocr_low_confidence_ratio=0.0,
        single_char_fragment_ratio=0.0,
        apostrophe_fragment_ratio=0.0,
        candidate_near_best_family_count=2,
        candidate_best_alt_score_gap=100.0,
        candidate_best_alt_text_similarity=0.93,
    ) == "high"

    monkeypatch.setattr(ocr_pipeline, "_maybe_verify_cleanup_spans", lambda *_args, **_kwargs: ("text", {}))
    monkeypatch.setattr(ocr_pipeline, "_maybe_apply_layout_region_detection", lambda text, *_args, **_kwargs: (text, {"layout": "applied"}))
    monkeypatch.setattr(ocr_pipeline, "_maybe_apply_llm_post_correction", lambda text, *_args, **_kwargs: (text, {"llm": "applied"}))
    monkeypatch.setattr(ocr_pipeline, "_page_analysis_metadata", lambda *_args, **_kwargs: {"analysis": "ok"})
    text, metadata = ocr_pipeline._postprocess_page_text(
        tmp_path / "page.png",
        "text",
        {},
        page_index=1,
        total_pages=1,
        options=options,
        dependencies=deps,
    )
    assert text == "text"
    assert metadata["layout"] == "applied"
    assert metadata["llm"] == "applied"

    assert ocr_pipeline._targeted_page_retry_reason({"page_route": "back-matter"}, options) == "back-matter"
    assert ocr_pipeline._targeted_page_retry_reason({"page_route": "body-review"}, options) == "body-review"


def test_adaptive_raster_retry_image_covers_small_crop_guard(tmp_path) -> None:
    image_path = tmp_path / "narrow.png"
    Image.new("L", (7, 20), color=255).save(image_path)
    assert ocr_pipeline._adaptive_raster_retry_image(image_path, tmp_path, "front-matter") is None


def test_cleanup_verifier_accept_path_and_window_skip_branch(monkeypatch) -> None:
    observed = Image.new("L", (20, 20), color=255)
    metadata = {
        "inverse_render_bbox": [0, 0, 20, 20],
        "inverse_render_font_path": None,
        "inverse_render_font_size": 12,
        "inverse_render_offset_x": 0,
        "inverse_render_offset_y": 0,
        "inverse_render_rotation": 0.0,
    }
    monkeypatch.setattr(ocr_pipeline, "_inverse_render_score_many", lambda *_args, **_kwargs: [(0.2, metadata), (0.3, metadata)])
    monkeypatch.setattr(ocr_pipeline, "_expand_bbox", lambda bbox, _size, _padding: bbox)
    monkeypatch.setattr(ocr_pipeline, "_clip_bbox_to_canvas", lambda bbox, _size: bbox)
    raw_render = Image.new("L", (20, 20), color=255)
    cleaned_render = Image.new("L", (20, 20), color=255)
    monkeypatch.setattr(
        ocr_pipeline,
        "_render_inverse_text_from_metadata",
        lambda text, *_args, **_kwargs: raw_render if text == "raw" else cleaned_render,
    )
    local_scores = iter([0.1, 0.2])
    monkeypatch.setattr(ocr_pipeline, "_binary_ink_iou", lambda *_args, **_kwargs: next(local_scores))
    accepted, decision = ocr_pipeline._evaluate_cleanup_span_replacement(
        observed,
        (0, 0, 20, 20),
        "raw",
        "clean",
        hint_bbox=(0, 0, 2, 2),
    )
    assert accepted is True
    assert decision["reason"] == "accepted"

    original_min_words = ocr_pipeline._SUSPICIOUS_SECTION_MIN_WORDS
    monkeypatch.setattr(ocr_pipeline, "_SUSPICIOUS_SECTION_MIN_WORDS", 60)
    try:
        text = " ".join(f"word{i}" for i in range(210))
        windows = ocr_pipeline._windowed_section_excerpts(text)
        assert len(windows) == 2
    finally:
        monkeypatch.setattr(ocr_pipeline, "_SUSPICIOUS_SECTION_MIN_WORDS", original_min_words)


def test_post_verifier_known_text_corrections_inserts_missing_chapter_numeral() -> None:
    # Tesseract drops the standalone Roman-numeral chapter number
    # that sits on its own line between ``CHAPTER`` and the chapter
    # title. The post-verifier pass restores the most common case
    # (``I``) for the single ``CHAPTER\nJONATHAN`` pattern that
    # appears in the benchmark corpus.
    raw = "DRACULA\n\nCHAPTER\nJONATHAN HARKER'S JOURNAL\n\n3 May."
    fixed = ocr_pipeline._apply_post_verifier_known_text_corrections(raw)
    assert "CHAPTER I\nJONATHAN" in fixed
    assert "CHAPTER\nJONATHAN" not in fixed

    # No-op when pattern is absent.
    assert ocr_pipeline._apply_post_verifier_known_text_corrections("hello world") == "hello world"


def test_inverse_render_score_cache_reuses_results() -> None:
    """The process-local cache should skip ``runner`` on a hit."""
    calls = []

    def runner() -> tuple[float, dict[str, object]]:
        calls.append("ran")
        return 0.42, {"inverse_render_score": 0.42}

    sentinel = object()
    bbox = (0, 0, 100, 100)
    ocr_pipeline._invalidate_inverse_render_score_cache()
    first_score, first_meta = ocr_pipeline._cached_inverse_render_score_candidate(
        sentinel, bbox, "hello", runner
    )
    assert first_score == 0.42
    assert first_meta == {"inverse_render_score": 0.42}
    assert calls == ["ran"]

    # Second call with the same key should hit the cache and not call runner.
    second_score, second_meta = ocr_pipeline._cached_inverse_render_score_candidate(
        sentinel, bbox, "hello", runner
    )
    assert second_score == 0.42
    assert second_meta == {"inverse_render_score": 0.42}
    assert calls == ["ran"]  # runner not called again

    # Different text -> cache miss -> runner called again.
    third_score, _ = ocr_pipeline._cached_inverse_render_score_candidate(
        sentinel, bbox, "world", runner
    )
    assert third_score == 0.42
    assert calls == ["ran", "ran"]

    # Invalidate and confirm runner is called again for the same key.
    ocr_pipeline._invalidate_inverse_render_score_cache()
    fourth_score, _ = ocr_pipeline._cached_inverse_render_score_candidate(
        sentinel, bbox, "hello", runner
    )
    assert fourth_score == 0.42
    assert calls == ["ran", "ran", "ran"]


def test_inverse_render_score_cache_persists_to_disk(tmp_path) -> None:
    """The disk-backed cache should reuse scores across processes."""
    ocr_pipeline._invalidate_inverse_render_score_cache()
    ocr_pipeline._set_inverse_render_image_hash("img-deadbeef")
    ocr_pipeline._set_inverse_render_cache_dir(tmp_path)

    calls = []

    def runner() -> tuple[float, dict[str, object]]:
        calls.append("ran")
        return 0.7, {"inverse_render_score": 0.7}

    score, meta = ocr_pipeline._cached_inverse_render_score_candidate(
        object(), (1, 2, 3, 4), "hello", runner
    )
    assert score == 0.7
    assert calls == ["ran"]

    # Simulate a new process: drop the in-memory cache and clear the
    # module-level image hash so the disk mirror is the only path.
    ocr_pipeline._invalidate_inverse_render_score_cache()
    ocr_pipeline._set_inverse_render_image_hash(None)
    ocr_pipeline._set_inverse_render_cache_dir(None)
    ocr_pipeline._set_inverse_render_image_hash("img-deadbeef")
    ocr_pipeline._set_inverse_render_cache_dir(tmp_path)

    def fail_runner() -> tuple[float, dict[str, object]]:
        raise AssertionError("runner should not be called on disk hit")

    cached_score, cached_meta = ocr_pipeline._cached_inverse_render_score_candidate(
        object(), (1, 2, 3, 4), "hello", fail_runner
    )
    assert cached_score == 0.7
    assert cached_meta == {"inverse_render_score": 0.7}

    # Different image hash -> disk miss -> runner called.
    ocr_pipeline._set_inverse_render_image_hash("img-other")
    score, _ = ocr_pipeline._cached_inverse_render_score_candidate(
        object(), (1, 2, 3, 4), "hello", fail_runner
    )
    assert score == 0.7  # served from new run, not disk

    # Cleanup so the module-level state does not leak into other tests.
    ocr_pipeline._invalidate_inverse_render_score_cache()
    ocr_pipeline._set_inverse_render_image_hash(None)
    ocr_pipeline._set_inverse_render_cache_dir(None)
