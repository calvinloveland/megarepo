from full_auto_de_pdf.ocr_cleanup import cleanup_ocr_text


def test_cleanup_ocr_text_normalizes_ligatures_and_quotes() -> None:
    source = "The ﬁnal ﬂower — and “quoted” text…"
    cleaned = cleanup_ocr_text(source)
    assert cleaned == 'The final flower - and "quoted" text...'


def test_cleanup_ocr_text_removes_page_number_and_line_art() -> None:
    source = "12\n====\nReal content line\n\nX\n"
    cleaned = cleanup_ocr_text(source)
    assert cleaned == "Real content line"


def test_cleanup_ocr_text_dehyphenates_line_breaks() -> None:
    source = "This is a hyphen-\nated example."
    cleaned = cleanup_ocr_text(source)
    assert "hyphenated" in cleaned
