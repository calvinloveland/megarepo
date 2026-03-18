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


def test_cleanup_ocr_text_preserves_body_sentences_with_chapter_keyword() -> None:
    """Body sentences mentioning 'chapter' + a digit must not be deleted."""
    source = (
        "In chapter 5, the Count arrived at dawn.\n"
        "She had read chapter 3 twice.\n"
        "Chapter 7 was the climax of the story.\n"
        "Normal content here.\n"
    )
    cleaned = cleanup_ocr_text(source)
    lowered = cleaned.lower()
    assert "in chapter 5" in lowered
    assert "she had read chapter 3" in lowered
    assert "chapter 7 was the climax" in lowered
    assert "normal content here" in lowered


def test_cleanup_ocr_text_preserves_body_sentences_with_diary_keyword() -> None:
    """Body sentences mentioning 'diary' + a digit must not be deleted."""
    source = (
        "I wrote in my diary for 3 hours.\n"
        "The diary contained 17 entries.\n"
        "Normal content here.\n"
    )
    cleaned = cleanup_ocr_text(source)
    lowered = cleaned.lower()
    assert "diary for 3 hours" in lowered
    assert "diary contained 17" in lowered
    assert "normal content here" in lowered


def test_cleanup_ocr_text_removes_diary_toc_entry() -> None:
    """A line like 'Dr Seward's Diary 17' (ending with bare page number) IS a TOC entry."""
    source = (
        "Dr Seward's Diary 17\n"
        "Real story content.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "diary 17" not in cleaned.lower()
    assert "real story content" in cleaned.lower()


def test_cleanup_ocr_text_restores_apostrophe_suffixes() -> None:
    source = (
        "I don't agree. I don't agree. I don't agree. I don't agree. I don't agree.\n"
        "I don agree in this line.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "don agree" not in cleaned.lower()
    assert "don't agree in this line" in cleaned.lower()


def test_cleanup_ocr_text_restores_nt_contractions() -> None:
    """OCR that drops the apostrophe from n't contractions is restored."""
    # Build text where correct form appears often, error form appears a few times.
    lines = ["don't worry." for _ in range(5)] + ["dont worry." for _ in range(2)]
    cleaned = cleanup_ocr_text("\n".join(lines))
    assert "dont" not in cleaned
    assert "don't" in cleaned

    lines2 = ["didn't do it." for _ in range(5)] + ["didnt do it." for _ in range(2)]
    cleaned2 = cleanup_ocr_text("\n".join(lines2))
    assert "didnt" not in cleaned2
    assert "didn't" in cleaned2

    lines3 = ["wouldn't go." for _ in range(5)] + ["wouldnt go." for _ in range(2)]
    cleaned3 = cleanup_ocr_text("\n".join(lines3))
    assert "wouldnt" not in cleaned3
    assert "wouldn't" in cleaned3


def test_cleanup_ocr_text_contextually_corrects_can_to_cant() -> None:
    lines: list[str] = []
    for _ in range(8):
        lines.append("I can't agree with this plan.")
    for _ in range(4):
        lines.append("I can swim at dawn.")
    lines.append("I can agree with this plan.")

    cleaned = cleanup_ocr_text("\n".join(lines))
    lowered = cleaned.lower()
    assert "i can agree with this plan." not in lowered
    assert "i can't agree with this plan." in lowered
    assert "i can swim at dawn." in lowered


def test_cleanup_ocr_text_corrects_isolated_digit_one_to_i() -> None:
    source = (
        "I think therefore I am. I think therefore I learn. I think therefore I write. "
        "I think therefore I read. I think therefore I know. "
        "He said 1 think this should work.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert " 1 think" not in cleaned.lower()
    assert "i think this should work" in cleaned.lower()


def test_cleanup_ocr_text_restores_isolated_bracket_pronoun_i() -> None:
    source = (
        "[ am ready to begin.\n"
        "[ could not see the road.\n"
        "[All rights reserved.]\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "I am ready to begin." in cleaned
    assert "I could not see the road." in cleaned
    assert "[All rights reserved.]" in cleaned


def test_cleanup_ocr_text_contextually_corrects_sec_to_see() -> None:
    lines = ["I can see the road ahead." for _ in range(12)]
    lines.extend(["They did not see the harbor lights." for _ in range(12)])
    lines.append("I can sec the road ahead.")
    lines.append("They did not sec the harbor lights.")
    cleaned = cleanup_ocr_text("\n".join(lines))
    lowered = cleaned.lower()
    assert "can sec the road ahead" not in lowered
    assert "did not sec the harbor lights" not in lowered
    assert "can see the road ahead" in lowered
    assert "did not see the harbor lights" in lowered


def test_cleanup_ocr_text_corrects_dominant_confusable_words() -> None:
    lines: list[str] = []
    for _ in range(8):
        lines.append("I have seen enough to believe myself calm.")
        lines.append("We seem quiet even after we read each note once.")
        lines.append("I would ever search the earth before I gave up.")
    lines.extend(
        [
            "I have scen enough to belicve mysclf calm.",
            "We scem quict cven after we rcad cach note onc.",
            "I would cver scarch the carth before I gave up.",
        ]
    )
    cleaned = cleanup_ocr_text("\n".join(lines))
    lowered = cleaned.lower()
    assert "scen enough" not in lowered
    for unexpected in ("belicve", "mysclf", "cven", "rcad", "cach", "cver", "scarch", "carth"):
        assert f" {unexpected} " not in lowered
    assert " scem " not in lowered
    assert "seen enough to believe myself calm" in lowered
    assert "seem quiet even after we read each note once" in lowered
    assert "ever search the earth before i gave up" in lowered


def test_cleanup_ocr_text_corrects_book_length_patterns() -> None:
    chapters: list[str] = []
    for _ in range(120):
        chapters.append(
            "The world map and world atlas guided the group across the brown valley below the crown tower."
        )
        chapters.append("A brown valley touched another brown valley near the river.")
        chapters.append("A crown tower stood near the crown gate at sunset.")
        chapters.append("Workers strike once and strike again.")
        chapters.append("The group rested and the group listened.")
        chapters.append("I don't agree with panic; I think we can keep moving.")

    chapters.append("A wold atlas sat beside a wold map.")
    chapters.append("A bown valley touched another bown valley.")
    chapters.append("A cown tower stood near the cown gate.")
    chapters.append("Workers stike once and stike again.")
    chapters.append("The goup rested and the goup listened.")
    chapters.append("I don agree with this and don agree with that.")
    chapters.append("1 think this note should stay readable.")

    cleaned = cleanup_ocr_text("\n".join(chapters))
    lowered = cleaned.lower()
    assert "wold" not in lowered
    assert "bown" not in lowered
    assert "cown" not in lowered
    assert "stike" not in lowered
    assert "goup" not in lowered
    assert " don agree" not in lowered
    assert " 1 think" not in lowered
    assert "world atlas" in lowered
    assert "brown valley" in lowered
    assert "crown tower" in lowered
    assert "strike again" in lowered
    assert "group rested" in lowered
    assert "don't agree with this" in lowered
    assert "i think this note should stay readable" in lowered


def test_cleanup_ocr_text_book_length_avoids_ambiguous_missing_char_fix() -> None:
    lines: list[str] = []
    for _ in range(12):
        lines.append("The brown path wound through the trees.")
    for _ in range(10):
        lines.append("The brawn guard stood near the gate.")
    lines.append("The brwn path looked narrow at dusk.")
    lines.append("Another brwn path looked narrow at dawn.")

    cleaned = cleanup_ocr_text("\n".join(lines))
    assert "brwn path" in cleaned.lower()


def test_cleanup_ocr_text_splits_compound_words_with_builtin_lexicon() -> None:
    source = (
        "The foxjumps over the dog.\n"
        "Another paragraphsof plain prose appeared.\n"
        "Readers keepsthe story moving.\n"
    )
    cleaned = cleanup_ocr_text(source)
    lowered = cleaned.lower()
    assert "fox jumps over" in lowered
    assert "paragraphs of plain prose" in lowered
    assert "keeps the story" in lowered


def test_cleanup_ocr_text_uses_supplied_lexicon_for_one_off_errors() -> None:
    source = "It teontains realistcsynthetic notes for eaders.\n"
    cleaned = cleanup_ocr_text(
        source,
        lexicon_texts=("contains realistic synthetic readers notes",),
    )
    lowered = cleaned.lower()
    assert "contains realistic synthetic notes for readers" in lowered


def test_cleanup_ocr_text_prefers_split_corrections_and_three_word_splits() -> None:
    source = "Thisisa sample for full autode pdf and toexercise the OCR.\n"
    cleaned = cleanup_ocr_text(
        source,
        lexicon_texts=("This is a sample for full auto de pdf and to exercise the OCR",),
    )
    lowered = cleaned.lower()
    assert "this is a sample" in lowered
    assert "full auto de pdf" in lowered
    assert "to exercise the ocr" in lowered


def test_cleanup_ocr_text_merges_verified_split_words() -> None:
    lines = ["Captain Norris answered plainly." for _ in range(6)]
    lines.extend("We waited before sunrise." for _ in range(6))
    lines.append("Captain not is answered plainly.")
    lines.append("We waited be fox sunrise.")
    cleaned = cleanup_ocr_text("\n".join(lines))
    lowered = cleaned.lower()
    assert "captain not is answered plainly" not in lowered
    assert "we waited be fox sunrise" not in lowered
    assert "captain norris answered plainly" in lowered
    assert "we waited before sunrise" in lowered


def test_cleanup_ocr_text_keeps_unverified_split_words() -> None:
    source = "The margin note says not is and be fox.\n"
    cleaned = cleanup_ocr_text(source)
    lowered = cleaned.lower()
    assert "not is" in lowered
    assert "be fox" in lowered


def test_cleanup_ocr_text_corrects_confusable_builtin_word() -> None:
    source = "The worid turned quietly at dusk.\n"
    cleaned = cleanup_ocr_text(source)
    assert "world turned quietly" in cleaned.lower()


def test_cleanup_ocr_text_joins_known_split_pairs() -> None:
    """Systematic OCR splits of compound words are corrected regardless of frequency."""
    lines = ["She said she can not stay." for _ in range(10)]
    cleaned = cleanup_ocr_text("\n".join(lines))
    assert "can not" not in cleaned.lower()
    assert "cannot" in cleaned.lower()


def test_cleanup_ocr_text_joins_known_split_within() -> None:
    lines = ["He remained with in the walls." for _ in range(10)]
    cleaned = cleanup_ocr_text("\n".join(lines))
    assert "with in" not in cleaned.lower()
    assert "within" in cleaned.lower()


def test_cleanup_ocr_text_joins_multiple_known_pairs_in_same_text() -> None:
    """Multiple _KNOWN_JOIN_PAIRS corrections can fire in the same document."""
    lines = ["She can not do it with in the walls." for _ in range(10)]
    cleaned = cleanup_ocr_text("\n".join(lines))
    lowered = cleaned.lower()
    assert "can not" not in lowered
    assert "with in" not in lowered
    assert "cannot" in lowered
    assert "within" in lowered


def test_cleanup_ocr_text_statistical_join_does_not_break_on_unknown_pair() -> None:
    """Unknown split pairs that appear rarely and have a clear lexicon target are joined."""
    lines = ["Captain Norris answered plainly." for _ in range(6)]
    lines.append("Captain not is answered plainly.")
    cleaned = cleanup_ocr_text("\n".join(lines))
    lowered = cleaned.lower()
    assert "not is" not in lowered
    assert "norris" in lowered


def test_cleanup_ocr_text_removes_dot_leader_toc_lines() -> None:
    """OCR'd TOC entries with dot-leader patterns are removed even when keywords are garbled."""
    source = (
        "Jonatan Harker's Journal ......... 1\n"
        "Dr Seward's Diary ........... 17\n"
        "Real story opening line.\n"
    )
    cleaned = cleanup_ocr_text(source)
    assert "........." not in cleaned
    assert "real story opening line" in cleaned.lower()


def test_cleanup_ocr_text_corrects_ew_ow_confusable() -> None:
    """The ew↔ow confusable fixes tewer→tower when tower dominates the text."""
    lines = ["The stone tower stood tall." for _ in range(10)]
    lines.append("The stone tewer stood tall.")
    cleaned = cleanup_ocr_text("\n".join(lines))
    assert "tewer" not in cleaned.lower()
    assert "tower" in cleaned.lower()


def test_cleanup_ocr_text_known_word_corrections() -> None:
    """Curated _KNOWN_WORD_CORRECTIONS are applied unconditionally to non-word OCR tokens."""
    cases = [
        ("She was slecping soundly.", "sleeping"),
        ("Her tecth were white.", "teeth"),
        ("With great cffort he rose.", "effort"),
        ("He was alrcady there.", "already"),
        ("She did not nced to ask.", "need"),
        ("He would seck her out.", "seek"),
        ("The wound on his forchead bled.", "forehead"),
    ]
    for source, expected_word in cases:
        cleaned = cleanup_ocr_text(source)
        assert expected_word in cleaned.lower(), f"Expected {expected_word!r} in cleanup of {source!r}; got {cleaned!r}"
