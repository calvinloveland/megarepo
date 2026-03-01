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
        "The world was quiet. The world moved. The world waited. The world turned. The world changed.\n"
        "A brown fox crossed the path. Another brown dog followed. Brown leaves and brown bark covered the brown road.\n"
        "The crown was polished. The crown jewels were packed. A silver crown sat beside the old crown stand. Another crown mark appeared.\n"
        "They strike the bell at dawn. They strike again at noon. Workers strike once more before they strike camp. They strike together.\n"
        "The group assembled early. The group returned late. Every group crossed with another group from town. One group waited.\n"
        "A wold map was pinned beside another wold atlas.\n"
        "The bown trail curved toward a bown gate.\n"
        "A cown emblem sat under another cown seal.\n"
        "They wrote stike once and then stike again.\n"
        "The goup waited and the goup listened.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "wold" not in cleaned.lower()
    assert "bown" not in cleaned.lower()
    assert "cown" not in cleaned.lower()
    assert "stike" not in cleaned.lower()
    assert "goup" not in cleaned.lower()
    assert "world atlas" in cleaned.lower()
    assert "brown gate" in cleaned.lower()
    assert "crown seal" in cleaned.lower()
    assert "strike again" in cleaned.lower()
    assert "group listened" in cleaned.lower()


def test_cleanup_ocr_text_does_not_correct_single_word_pattern() -> None:
    source = (
        "The world was bright. The world was vast. The world was calm.\n"
        "One wold phrase appears here, but not enough other words share that missing letter pattern.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "wold phrase" in cleaned.lower()
