from pathlib import Path

import pytest

from full_auto_de_pdf import ocr_pipeline
from full_auto_de_pdf.ocr_pipeline import evaluate_ocr_preprocess_modes, ocr_pdf_with_tesseract


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


def test_evaluate_ocr_preprocess_modes_runs_all_modes(monkeypatch, tmp_path) -> None:
    input_pdf = tmp_path / "book.pdf"
    input_pdf.write_bytes(b"pdf")
    output_report = tmp_path / "report.json"
    work_dir = tmp_path / "work"
    seen_modes: list[str] = []

    def _fake_ocr_pdf_with_tesseract(**kwargs):  # noqa: ANN003
        seen_modes.append(kwargs["preprocess_mode"])
        output_path = kwargs["output_text_path"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"text-{kwargs['preprocess_mode']}", encoding="utf-8")
        return {"page_count": 1, "word_count": 2, "character_count": 8}

    monkeypatch.setattr(ocr_pipeline, "ocr_pdf_with_tesseract", _fake_ocr_pdf_with_tesseract)
    report = evaluate_ocr_preprocess_modes(
        pdf_path=input_pdf,
        work_dir=work_dir,
        output_report_path=output_report,
    )
    assert seen_modes == ["none", "basic", "deskew", "dewarp"]
    assert output_report.exists()
    assert "modes" in report
