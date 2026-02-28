from pathlib import Path

import pytest

from full_auto_de_pdf.ocr_pipeline import ocr_pdf_with_tesseract


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

    metrics = ocr_pdf_with_tesseract(
        pdf_path=pdf_path,
        output_text_path=output_path,
        work_dir=work_dir,
        run_command=_run,
        which=_which,
    )
    assert metrics["page_count"] == 2
    assert metrics["word_count"] >= 5
    assert "first" in output_path.read_text(encoding="utf-8").lower()
