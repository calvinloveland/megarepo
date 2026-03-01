from full_auto_de_pdf.ocr_cleanup import _apply_word_corrections, cleanup_ocr_text


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
        "The world map was quiet. The world map moved. The world atlas waited. The world map turned. The world atlas changed.\n"
        "A brown trail crossed the path. Another brown trail followed. Brown leaves and brown bark covered the brown gate.\n"
        "The crown emblem was polished. The crown seal was packed. A silver crown emblem sat beside the old crown seal. Another crown emblem appeared.\n"
        "They strike once at dawn. They strike again at noon. Workers strike once more before they strike again. They strike once together.\n"
        "The group waited early. The group listened late. Every group listened with another group from town. One group waited.\n"
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


def test_apply_word_corrections_uses_neighbor_context() -> None:
    source = (
        "The world map is old. Another world map appears.\n"
        "Wold map remains in the margin.\n"
        "Red rose blooms near the gate. Red rose fades by dusk.\n"
    )
    corrected = _apply_word_corrections(source, {"wold": "world", "red": "read"})
    assert "world map remains" in corrected.lower()
    assert "red rose blooms" in corrected.lower()
    assert "read rose" not in corrected.lower()


def test_cleanup_ocr_text_removes_toc_like_lines() -> None:
    source = (
        "CONTENTS\n"
        "Chapter I Jonathan Harker's Journal 1\n"
        "Chapter II Dr Seward's Diary 17\n"
        "Real story opening line.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "chapter i" not in cleaned.lower()
    assert "diary 17" not in cleaned.lower()
    assert "real story opening line" in cleaned.lower()


def test_cleanup_ocr_text_restores_apostrophe_suffixes() -> None:
    source = (
        "I don't agree. I don't agree. I don't agree. I don't agree. I don't agree.\n"
        "I don agree in this line.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "don agree" not in cleaned.lower()
    assert "don't agree in this line" in cleaned.lower()


def test_cleanup_ocr_text_corrects_isolated_digit_one_to_i() -> None:
    source = (
        "I think therefore I am. I think therefore I learn. I think therefore I write. "
        "I think therefore I read. I think therefore I know. "
        "He said 1 think this should work.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert " 1 think" not in cleaned.lower()
    assert "i think this should work" in cleaned.lower()
