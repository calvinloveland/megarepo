from full_auto_de_pdf.archive_org import StarterBook, build_manifest_entry, write_manifest


def test_build_manifest_entry_detects_assets() -> None:
    book = StarterBook("example-id", "Example Book")
    metadata = {
        "metadata": {
            "title": "Scanned Example",
            "language": ["eng", "en"],
            "date": "1912",
        },
        "files": [
            {"name": "example-id.pdf"},
            {"name": "example-id_djvu.txt"},
            {"name": "example-id_abbyy.gz"},
            {"name": "example-id_scandata.xml"},
            {"name": "example-id_jp2.zip"},
        ],
    }

    entry = build_manifest_entry(book, metadata)

    assert entry["identifier"] == "example-id"
    assert entry["archive_title"] == "Scanned Example"
    assert entry["language"] == ["eng", "en"]
    assert entry["year"] == "1912"
    assert entry["ocr_assets"]["djvu_txt"] is True
    assert entry["ocr_assets"]["abbyy_gz"] is True
    assert entry["scan_assets"]["pdf"] is True
    assert entry["scan_assets"]["jp2_zip"] is True


def test_write_manifest_writes_json(tmp_path) -> None:
    output = tmp_path / "manifest.json"
    write_manifest(output, [{"identifier": "book-1"}])
    payload = output.read_text(encoding="utf-8")
    assert '"identifier": "book-1"' in payload
