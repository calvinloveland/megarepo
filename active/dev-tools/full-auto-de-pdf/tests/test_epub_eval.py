import subprocess
import zipfile
import xml.etree.ElementTree as ET

import pytest

import full_auto_de_pdf.epub_eval as epub_eval_module
from full_auto_de_pdf.epub import build_epub_from_ocr_text
from full_auto_de_pdf.epub_eval import evaluate_epub_structure


def test_evaluate_epub_structure_reports_expected_fields(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    build_epub_from_ocr_text(
        "Chapter start.\n\nMore text.",
        output_path=epub_path,
        title="Eval Book",
    )
    report = evaluate_epub_structure(epub_path, run_epubcheck=False)
    assert report["checks"]["has_mimetype"] is True
    assert report["checks"]["has_opf"] is True
    assert report["checks"]["reading_order_valid"] is True
    assert report["metrics"]["toc_entry_count"] >= 1
    assert report["epubcheck"]["status"] == "skipped"


def test_evaluate_epub_structure_handles_missing_epubcheck(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    build_epub_from_ocr_text("Text", output_path=epub_path, title="Eval Book")
    report = evaluate_epub_structure(
        epub_path,
        run_epubcheck=True,
        epubcheck_cmd="nonexistent-epubcheck-cmd",
    )
    assert report["epubcheck"]["status"] == "unavailable"


def test_evaluate_epub_structure_with_reference_headings(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    reference_path = tmp_path / "headings.txt"
    build_epub_from_ocr_text(
        "Chapter start.\n\nMore text.",
        output_path=epub_path,
        title="Eval Book",
    )
    reference_path.write_text("Eval Book\nChapter One\n", encoding="utf-8")
    report = evaluate_epub_structure(
        epub_path,
        run_epubcheck=False,
        reference_headings_path=reference_path,
    )
    heading_eval = report["heading_sequence_eval"]
    assert heading_eval["reference_count"] == 2
    assert heading_eval["extracted_count"] >= 1
    assert "sequence_ratio" in heading_eval


def test_epub_eval_helper_edges(monkeypatch, tmp_path) -> None:
    assert epub_eval_module._local_name("nav") == "nav"
    assert epub_eval_module._resolve_zip_path("OEBPS/content.opf", "../nav.xhtml") == "nav.xhtml"
    assert epub_eval_module._count_toc_entries(
        "<html xmlns='http://www.w3.org/1999/xhtml'><nav /></html>"
    ) == 0

    monkeypatch.setattr(epub_eval_module.shutil, "which", lambda cmd: f"/usr/bin/{cmd}")

    def _fake_run(argv, capture_output, text, check):
        if argv[0] == "epubcheck-pass":
            return subprocess.CompletedProcess(argv, 0, stdout="ok", stderr="")
        return subprocess.CompletedProcess(argv, 1, stdout="", stderr="bad")

    monkeypatch.setattr(epub_eval_module.subprocess, "run", _fake_run)
    assert epub_eval_module._run_epubcheck(tmp_path / "book.epub", "epubcheck-pass") == {
        "status": "pass",
        "command": "epubcheck-pass",
        "return_code": 0,
        "output": "ok",
    }
    assert epub_eval_module._run_epubcheck(tmp_path / "book.epub", "epubcheck-fail") == {
        "status": "fail",
        "command": "epubcheck-fail",
        "return_code": 1,
        "output": "bad",
    }

    with zipfile.ZipFile(tmp_path / "broken.epub", "w") as epub_zip:
        epub_zip.writestr("META-INF/container.xml", "<container />")
    with zipfile.ZipFile(tmp_path / "broken.epub") as epub_zip:
        with pytest.raises(ValueError, match="OPF rootfile"):
            epub_eval_module._extract_opf_path(epub_zip)

    manifest_items: dict[str, dict[str, str]] = {}
    epub_eval_module._add_manifest_item(manifest_items, ET.fromstring("<item id='x' />"), "OEBPS/content.opf")
    assert manifest_items == {}


def test_epub_eval_collectors_skip_missing_members(tmp_path) -> None:
    epub_path = tmp_path / "book.epub"
    build_epub_from_ocr_text("Heading\n\nBody text.", output_path=epub_path, title="Eval")
    with zipfile.ZipFile(epub_path) as epub_zip:
        names = set(epub_zip.namelist())
        assert epub_eval_module._collect_nav_count(epub_zip, names, []) == 0
        assert epub_eval_module._collect_nav_count(
            epub_zip,
            names,
            [{"href": "OEBPS/missing.xhtml", "properties": "nav"}],
        ) == 0
        heading_count, headings = epub_eval_module._collect_headings(
            epub_zip,
            names,
            [{"href": "OEBPS/missing.xhtml", "media_type": "application/xhtml+xml"}],
        )
        assert heading_count == 0
        assert headings == []
