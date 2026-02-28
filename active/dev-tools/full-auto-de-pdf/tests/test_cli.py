import json

from full_auto_de_pdf import cli


def test_manifest_command_writes_output(monkeypatch, tmp_path) -> None:
    output = tmp_path / "manifest.json"

    def _fake_manifest(timeout_seconds: int) -> list[dict[str, object]]:
        assert timeout_seconds == 15
        return [{"identifier": "demo-book"}]

    monkeypatch.setattr(cli, "build_manifest", _fake_manifest)
    rc = cli.main(["manifest", "--output", str(output), "--timeout-seconds", "15"])

    assert rc == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["books"][0]["identifier"] == "demo-book"


def test_build_epub_command_builds_file(tmp_path) -> None:
    ocr_text = tmp_path / "ocr.txt"
    epub_path = tmp_path / "output.epub"
    metrics_path = tmp_path / "metrics.json"
    ocr_text.write_text("Test words here", encoding="utf-8")

    rc = cli.main(
        [
            "build-epub",
            "--ocr-text",
            str(ocr_text),
            "--output",
            str(epub_path),
            "--metrics-output",
            str(metrics_path),
            "--title",
            "CLI Example",
        ]
    )

    assert rc == 0
    assert epub_path.exists()
    assert metrics_path.exists()
