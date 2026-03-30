import json

from full_auto_de_pdf import cleanup_mining


def test_mine_cleanup_corpus_writes_report_and_candidates(monkeypatch, tmp_path) -> None:
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "pg1342_gutenberg.txt").write_text(
        "plot loves cannot. plot loves cannot. plot loves cannot.",
        encoding="utf-8",
    )
    output = tmp_path / "report.json"

    def _fake_cleanup(text: str, lexicon_texts: tuple[str, ...] = ()) -> str:
        assert lexicon_texts == ()
        return text.replace("piot", "plot").replace("can not", "cannot")

    monkeypatch.setattr(cleanup_mining, "cleanup_ocr_text", _fake_cleanup)
    report = cleanup_mining.mine_cleanup_corpus(
        cache_dir=cache_dir,
        output_report_path=output,
        max_books=1,
        max_sentences_per_book=5,
        sentence_min_chars=10,
        sentence_max_chars=120,
        max_words_per_sentence=2,
        max_examples=5,
        candidate_min_failures=1,
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload == report
    assert payload["summary"]["case_count"] == 9
    assert payload["summary"]["failure_count"] == 3
    assert payload["summary"]["confusable_failure_count"] == 3
    assert payload["summary"]["join_failure_count"] == 0
    assert payload["summary"]["candidate_builtin_lexicon_additions"] == ["loves"]
    assert payload["summary"]["top_failure_targets"][0] == {"target": "loves", "count": 3}
    assert payload["summary"]["top_failure_rules"][0] == {"rule": "l->i", "count": 3}
    assert payload["sample_failures"][0]["target"] == "loves"


def test_mine_cleanup_corpus_rejects_invalid_limits(tmp_path) -> None:
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "pg1342_gutenberg.txt").write_text("plot loves cannot.", encoding="utf-8")

    try:
        cleanup_mining.mine_cleanup_corpus(
            cache_dir=cache_dir,
            output_report_path=tmp_path / "report.json",
            max_sentences_per_book=0,
        )
    except ValueError as exc:
        assert "max_sentences_per_book" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid max_sentences_per_book")
