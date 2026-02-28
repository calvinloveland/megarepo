from __future__ import annotations

import math
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


def _projection_variance(binary_image) -> float:
    width, height = binary_image.size
    pixels = binary_image.load()
    row_counts: list[int] = []
    for y in range(height):
        black_count = 0
        for x in range(width):
            if pixels[x, y] == 0:
                black_count += 1
        row_counts.append(black_count)
    if not row_counts:
        return 0.0
    mean = sum(row_counts) / len(row_counts)
    return sum((value - mean) ** 2 for value in row_counts) / len(row_counts)


def _estimate_skew_angle(denoised_image, max_angle: float, angle_step: float) -> float:
    best_angle = 0.0
    best_score = -math.inf
    angle = -max_angle
    while angle <= max_angle + 1e-9:
        rotated = denoised_image.rotate(angle, expand=True, fillcolor=255)
        binary = rotated.point(lambda value: 255 if value >= 128 else 0, mode="L")
        score = _projection_variance(binary)
        if score > best_score:
            best_score = score
            best_angle = angle
        angle += angle_step
    return best_angle


def _preprocess_image(
    input_path: Path,
    output_path: Path,
    preprocess_mode: str,
    binarize_threshold: int,
    deskew_max_angle: float,
    deskew_angle_step: float,
) -> None:
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
        candidate = denoised
        if preprocess_mode == "deskew":
            skew_angle = _estimate_skew_angle(
                denoised,
                max_angle=deskew_max_angle,
                angle_step=deskew_angle_step,
            )
            candidate = denoised.rotate(skew_angle, expand=True, fillcolor=255)
        binarized = candidate.point(lambda value: 255 if value >= binarize_threshold else 0)
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
    deskew_max_angle: float = 3.0,
    deskew_angle_step: float = 0.5,
    run_command: Callable[[list[str], bool], str] = _run_command,
    preprocess_image: Callable[[Path, Path, str, int, float, float], None] = _preprocess_image,
    which: Callable[[str], str | None] = shutil.which,
) -> dict[str, int]:
    if preprocess_mode not in {"none", "basic", "deskew"}:
        raise ValueError("preprocess_mode must be 'none', 'basic', or 'deskew'")
    if not (0 <= binarize_threshold <= 255):
        raise ValueError("binarize_threshold must be between 0 and 255")
    if deskew_max_angle <= 0:
        raise ValueError("deskew_max_angle must be greater than 0")
    if deskew_angle_step <= 0:
        raise ValueError("deskew_angle_step must be greater than 0")
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
        if preprocess_mode in {"basic", "deskew"}:
            preprocessed_path = preprocessed_dir / image_path.name
            preprocess_image(
                image_path,
                preprocessed_path,
                preprocess_mode,
                binarize_threshold,
                deskew_max_angle,
                deskew_angle_step,
            )
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
