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


def test_cleanup_ocr_text_corrects_repeated_missing_character_errors() -> None:
    source = (
        "The world was quiet. The world moved. The world waited.\n"
        "A wold map was pinned beside another wold atlas.\n"
        "Notes from the village were copied from an old fom letter and another fom note.\n"
        "A brown fox crossed the path. Another brown dog followed a bown trail and bown sign.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "wold" not in cleaned.lower()
    assert "fom" not in cleaned.lower()
    assert "bown" not in cleaned.lower()
    assert "world atlas" in cleaned.lower()
    assert "from letter" in cleaned.lower()
    assert "brown sign" in cleaned.lower()


def test_cleanup_ocr_text_does_not_correct_single_word_pattern() -> None:
    source = (
        "The world was bright. The world was vast. The world was calm.\n"
        "One wold phrase appears here, but not enough other words share that missing letter pattern.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "wold phrase" in cleaned.lower()
