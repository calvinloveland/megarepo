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


def _preprocess_image(input_path: Path, output_path: Path, binarize_threshold: int) -> None:
    try:
        from PIL import Image, ImageFilter, ImageOps
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency for preprocessing: pillow. "
            "Install with `pip install pillow` or disable preprocessing."
        ) from exc

    with Image.open(input_path) as image:
        gray = image.convert("L")
        contrasted = ImageOps.autocontrast(gray)
        denoised = contrasted.filter(ImageFilter.MedianFilter(size=3))
        binarized = denoised.point(lambda value: 255 if value >= binarize_threshold else 0)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        binarized.save(output_path)


def ocr_pdf_with_tesseract(
    pdf_path: Path,
    output_text_path: Path,
    work_dir: Path,
    language: str = "eng",
    dpi: int = 300,
    apply_cleanup: bool = True,
    preprocess_mode: str = "basic",
    binarize_threshold: int = 170,
    run_command: Callable[[list[str], bool], str] = _run_command,
    preprocess_image: Callable[[Path, Path, int], None] = _preprocess_image,
    which: Callable[[str], str | None] = shutil.which,
) -> dict[str, int]:
    if preprocess_mode not in {"none", "basic"}:
        raise ValueError("preprocess_mode must be 'none' or 'basic'")
    if not (0 <= binarize_threshold <= 255):
        raise ValueError("binarize_threshold must be between 0 and 255")
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
    preprocessed_dir = work_dir / "preprocessed"
    for image_path in page_images:
        ocr_input_path = image_path
        if preprocess_mode == "basic":
            preprocessed_path = preprocessed_dir / image_path.name
            preprocess_image(image_path, preprocessed_path, binarize_threshold)
            ocr_input_path = preprocessed_path

        text = run_command(
            [
                "tesseract",
                str(ocr_input_path),
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
