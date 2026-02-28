from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
from typing import Callable

from .ocr_cleanup import cleanup_ocr_text


def _run_command(command: list[str], capture_output: bool = False) -> str:
    completed = subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture_output,
    )
    return completed.stdout if capture_output else ""


def ocr_pdf_with_tesseract(
    pdf_path: Path,
    output_text_path: Path,
    work_dir: Path,
    language: str = "eng",
    dpi: int = 300,
    apply_cleanup: bool = True,
    run_command: Callable[[list[str], bool], str] = _run_command,
    which: Callable[[str], str | None] = shutil.which,
) -> dict[str, int]:
    if which("pdftoppm") is None:
        raise RuntimeError("Missing dependency: pdftoppm")
    if which("tesseract") is None:
        raise RuntimeError("Missing dependency: tesseract")
    if not pdf_path.exists():
        raise FileNotFoundError(f"Input PDF not found: {pdf_path}")

    pages_dir = work_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    page_prefix = pages_dir / "page"
    run_command(
        [
            "pdftoppm",
            "-r",
            str(dpi),
            "-gray",
            "-png",
            str(pdf_path),
            str(page_prefix),
        ],
        False,
    )

    page_images = sorted(pages_dir.glob("page-*.png"))
    if not page_images:
        raise RuntimeError("pdftoppm produced no page images")

    page_texts: list[str] = []
    for image_path in page_images:
        text = run_command(
            [
                "tesseract",
                str(image_path),
                "stdout",
                "-l",
                language,
                "--psm",
                "3",
            ],
            True,
        )
        page_texts.append(text)

    combined_text = "\n\n".join(page_texts)
    final_text = cleanup_ocr_text(combined_text) if apply_cleanup else combined_text
    output_text_path.parent.mkdir(parents=True, exist_ok=True)
    output_text_path.write_text(final_text, encoding="utf-8")
    words = [word for word in final_text.split() if word]
    return {
        "page_count": len(page_images),
        "word_count": len(words),
        "character_count": len(final_text),
    }
