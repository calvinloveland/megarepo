from __future__ import annotations

import json
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


def _row_center_offsets(binary_image) -> list[float | None]:
    width, height = binary_image.size
    pixels = binary_image.load()
    centers: list[float | None] = []
    for y in range(height):
        left: int | None = None
        right: int | None = None
        for x in range(width):
            if pixels[x, y] == 0:
                left = x
                break
        if left is None:
            centers.append(None)
            continue
        for x in range(width - 1, -1, -1):
            if pixels[x, y] == 0:
                right = x
                break
        if right is None:
            centers.append(None)
            continue
        centers.append((left + right) / 2.0)
    return centers


def _linear_center_baseline(centers: list[float | None]) -> tuple[float, float]:
    points = [(float(y), center) for y, center in enumerate(centers) if center is not None]
    if len(points) < 2:
        return 0.0, 0.0
    n = float(len(points))
    sum_x = sum(x for x, _ in points)
    sum_y = sum(y for _, y in points)
    sum_xx = sum(x * x for x, _ in points)
    sum_xy = sum(x * y for x, y in points)
    denom = n * sum_xx - sum_x * sum_x
    if abs(denom) < 1e-9:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


def _dewarp_by_row_shift(denoised_image, binarize_threshold: int):
    from PIL import Image

    binary = denoised_image.point(lambda value: 255 if value >= binarize_threshold else 0)
    centers = _row_center_offsets(binary)
    slope, intercept = _linear_center_baseline(centers)
    width, height = denoised_image.size
    warped = Image.new("L", (width, height), color=255)
    for y in range(height):
        center = centers[y]
        if center is None:
            shift = 0
        else:
            baseline_center = slope * float(y) + intercept
            shift = int(round(center - baseline_center))
        row = denoised_image.crop((0, y, width, y + 1))
        warped.paste(row, (-shift, y))
    return warped


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
        if preprocess_mode == "dewarp":
            skew_angle = _estimate_skew_angle(
                denoised,
                max_angle=deskew_max_angle,
                angle_step=deskew_angle_step,
            )
            deskewed = denoised.rotate(skew_angle, expand=True, fillcolor=255)
            candidate = _dewarp_by_row_shift(deskewed, binarize_threshold)
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
    emit_page_artifacts: bool = True,
    page_artifacts_dir: Path | None = None,
    run_command: Callable[[list[str], bool], str] = _run_command,
    preprocess_image: Callable[[Path, Path, str, int, float, float], None] = _preprocess_image,
    which: Callable[[str], str | None] = shutil.which,
) -> dict[str, int | str]:
    if preprocess_mode not in {"none", "basic", "deskew", "dewarp"}:
        raise ValueError("preprocess_mode must be 'none', 'basic', 'deskew', or 'dewarp'")
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
    page_details: list[dict[str, object]] = []
    artifacts_dir = page_artifacts_dir or (work_dir / "page_ocr")
    if emit_page_artifacts:
        artifacts_dir.mkdir(parents=True, exist_ok=True)
    for image_path in page_images:
        ocr_input_path = image_path
        if preprocess_mode in {"basic", "deskew", "dewarp"}:
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
        page_word_count = len([word for word in text.split() if word])
        page_index = len(page_texts)
        page_entry: dict[str, object] = {
            "page_index": page_index,
            "image_path": str(image_path),
            "ocr_input_path": str(ocr_input_path),
            "word_count": page_word_count,
            "character_count": len(text),
        }
        if emit_page_artifacts:
            page_text_path = artifacts_dir / f"page-{page_index:04d}.txt"
            page_text_path.write_text(text, encoding="utf-8")
            page_entry["text_path"] = str(page_text_path)
        page_details.append(page_entry)

    combined_text = "\n\n".join(page_texts)
    final_text = cleanup_ocr_text(combined_text) if apply_cleanup else combined_text
    output_text_path.parent.mkdir(parents=True, exist_ok=True)
    output_text_path.write_text(final_text, encoding="utf-8")
    words = [word for word in final_text.split() if word]
    result = {
        "page_count": len(page_images),
        "word_count": len(words),
        "character_count": len(final_text),
    }
    if emit_page_artifacts:
        artifacts_manifest_path = artifacts_dir / "manifest.json"
        artifacts_manifest_path.write_text(
            json.dumps({"pages": page_details}, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        result["page_artifacts_dir"] = str(artifacts_dir)
        result["page_artifacts_manifest"] = str(artifacts_manifest_path)
    return result


def evaluate_ocr_preprocess_modes(
    pdf_path: Path,
    work_dir: Path,
    output_report_path: Path,
    language: str = "eng",
    dpi: int = 300,
    apply_cleanup: bool = True,
    binarize_threshold: int = 170,
    deskew_max_angle: float = 3.0,
    deskew_angle_step: float = 0.5,
    reference_text_path: Path | None = None,
    modes: tuple[str, ...] = ("none", "basic", "deskew", "dewarp"),
) -> dict[str, object]:
    from .benchmark import calculate_accuracy_metrics

    report: dict[str, object] = {
        "pdf_path": str(pdf_path),
        "modes": {},
    }

    reference_text: str | None = None
    if reference_text_path is not None:
        reference_text = reference_text_path.read_text(encoding="utf-8")
        report["reference_text_path"] = str(reference_text_path)
        report["mode_ranking"] = []
        report["best_mode"] = None

    for mode in modes:
        mode_output_path = work_dir / "mode_outputs" / f"{mode}.txt"
        mode_work_dir = work_dir / f"work_{mode}"
        mode_metrics = ocr_pdf_with_tesseract(
            pdf_path=pdf_path,
            output_text_path=mode_output_path,
            work_dir=mode_work_dir,
            language=language,
            dpi=dpi,
            apply_cleanup=apply_cleanup,
            preprocess_mode=mode,
            binarize_threshold=binarize_threshold,
            deskew_max_angle=deskew_max_angle,
            deskew_angle_step=deskew_angle_step,
        )
        mode_payload: dict[str, object] = dict(mode_metrics)
        if reference_text is not None:
            hypothesis_text = mode_output_path.read_text(encoding="utf-8")
            mode_payload["accuracy"] = calculate_accuracy_metrics(reference_text, hypothesis_text)
        report["modes"][mode] = mode_payload

    if reference_text is not None:
        ranked = sorted(
            (
                (
                    mode_name,
                    float(mode_payload["accuracy"]["wer"]),
                    float(mode_payload["accuracy"]["cer"]),
                )
                for mode_name, mode_payload in report["modes"].items()
            ),
            key=lambda item: (item[1], item[2]),
        )
        report["mode_ranking"] = [
            {
                "mode": mode_name,
                "wer": wer,
                "cer": cer,
            }
            for mode_name, wer, cer in ranked
        ]
        if ranked:
            report["best_mode"] = ranked[0][0]

    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return report


def benchmark_local_ocr_against_archive(
    pdf_path: Path,
    archive_identifier: str,
    output_report_path: Path,
    work_dir: Path,
    archive_source_mode: str = "djvu",
    language: str = "eng",
    dpi: int = 300,
    apply_cleanup: bool = True,
    binarize_threshold: int = 170,
    deskew_max_angle: float = 3.0,
    deskew_angle_step: float = 0.5,
) -> dict[str, object]:
    from .benchmark import fetch_archive_abbyy_text, fetch_archive_ocr_text

    if archive_source_mode not in {"djvu", "abbyy", "best"}:
        raise ValueError("archive_source_mode must be one of: djvu, abbyy, best")

    djvu_reference = fetch_archive_ocr_text(archive_identifier)
    abbyy_reference = fetch_archive_abbyy_text(archive_identifier)
    if archive_source_mode == "abbyy" and abbyy_reference is None:
        raise ValueError(
            f"archive_source_mode='abbyy' requested but no ABBYY OCR is available for {archive_identifier}"
        )

    references: list[tuple[str, str]] = [("djvu", djvu_reference)]
    if abbyy_reference is not None:
        references.append(("abbyy", abbyy_reference))
    if archive_source_mode in {"djvu", "abbyy"}:
        references = [item for item in references if item[0] == archive_source_mode]

    candidate_reports: list[dict[str, object]] = []
    for source_name, reference_text in references:
        reference_path = work_dir / "references" / f"{archive_identifier}_{source_name}.txt"
        reference_path.parent.mkdir(parents=True, exist_ok=True)
        reference_path.write_text(reference_text, encoding="utf-8")
        candidate_output_path = work_dir / "candidate_reports" / f"{source_name}.json"
        mode_report = evaluate_ocr_preprocess_modes(
            pdf_path=pdf_path,
            work_dir=work_dir / f"mode_eval_{source_name}",
            output_report_path=candidate_output_path,
            reference_text_path=reference_path,
            language=language,
            dpi=dpi,
            apply_cleanup=apply_cleanup,
            binarize_threshold=binarize_threshold,
            deskew_max_angle=deskew_max_angle,
            deskew_angle_step=deskew_angle_step,
        )
        ranking = mode_report.get("mode_ranking", [])
        best_wer = float(ranking[0]["wer"]) if ranking else 1.0
        best_cer = float(ranking[0]["cer"]) if ranking else 1.0
        candidate_reports.append(
            {
                "source": source_name,
                "report_path": str(candidate_output_path),
                "best_wer": best_wer,
                "best_cer": best_cer,
                "mode_report": mode_report,
            }
        )

    selected = min(candidate_reports, key=lambda item: (item["best_wer"], item["best_cer"]))
    selected_report = dict(selected["mode_report"])
    selected_report["archive_identifier"] = archive_identifier
    selected_report["archive_source_mode"] = archive_source_mode
    selected_report["selected_archive_source"] = selected["source"]
    selected_report["candidate_sources"] = [
        {
            "source": item["source"],
            "best_wer": item["best_wer"],
            "best_cer": item["best_cer"],
            "report_path": item["report_path"],
        }
        for item in candidate_reports
    ]

    output_report_path.parent.mkdir(parents=True, exist_ok=True)
    output_report_path.write_text(
        json.dumps(selected_report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return selected_report
