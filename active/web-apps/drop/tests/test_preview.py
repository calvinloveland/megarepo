"""Tests for the preview layer."""

from __future__ import annotations

import json

import pytest

from drop import preview


# ---------------------------------------------------------------------------
# Type classification
# ---------------------------------------------------------------------------


class TestTypeClassification:
    @pytest.mark.parametrize("name,expected", [
        ("foo.csv", True),
        ("FOO.CSV", True),
        ("data.tsv", True),
        ("foo.json", False),
        ("foo.txt", False),
        ("foo.png", False),
        ("foo", False),
    ])
    def test_is_csv(self, name, expected):
        assert preview.is_csv("application/octet-stream", name) is expected

    @pytest.mark.parametrize("name,expected", [
        ("foo.json", True),
        ("data.JSON", True),
        ("foo.txt", False),
    ])
    def test_is_json(self, name, expected):
        assert preview.is_json("application/octet-stream", name) is expected

    @pytest.mark.parametrize("name,expected", [
        ("foo.py", True),
        ("foo.js", True),
        ("foo.md", True),
        ("foo.log", True),
        ("foo.txt", True),
        ("foo.csv", True),
        ("foo.png", False),
        ("foo.pdf", False),
    ])
    def test_is_texty(self, name, expected):
        assert preview.is_texty("application/octet-stream", name) is expected

    def test_is_texty_by_mime(self):
        assert preview.is_texty("text/plain", "foo") is True
        assert preview.is_texty("text/html", "foo") is True
        assert preview.is_texty("application/json", "foo") is True
        assert preview.is_texty("application/xml", "foo") is True

    @pytest.mark.parametrize("name,expected", [
        ("foo.png", True),
        ("foo.JPG", True),
        ("foo.svg", True),
        ("foo.txt", False),
    ])
    def test_is_image(self, name, expected):
        assert preview.is_image("application/octet-stream", name) is expected

    def test_is_image_by_mime(self):
        assert preview.is_image("image/png", "foo") is True
        assert preview.is_image("image/jpeg", "foo") is True


# ---------------------------------------------------------------------------
# CSV preview
# ---------------------------------------------------------------------------


class TestCsvPreview:
    def test_simple_csv(self):
        data = b"a,b,c\n1,2,3\n4,5,6\n"
        out = preview.preview_csv(data)
        assert out["headers"] == ["a", "b", "c"]
        assert out["rows"] == [["1", "2", "3"], ["4", "5", "6"]]
        assert out["truncated"] is False
        assert out["total_rows"] == 2

    def test_quoted_fields_with_commas(self):
        data = b'name,desc\n"Smith, John","A person"\n"Doe, Jane","Another"\n'
        out = preview.preview_csv(data)
        assert out["headers"] == ["name", "desc"]
        assert out["rows"] == [["Smith, John", "A person"], ["Doe, Jane", "Another"]]

    def test_exportify_like_csv(self):
        """A realistic exportify-style CSV with many columns."""
        data = (
            b"Track URI,Track Name,Artist Name(s),Album Name,Album Artist Name(s),"
            b"Album Release Date,Album Image URL,Disc Number,Track Number,"
            b"Track Duration (ms),Track Preview URL,Explicit,Popularity,ISRC,Added By,Added At\n"
            b"spotify:track:abc,Mr. Blue Sky,Electric Light Orchestra,Out of the Blue,"
            b"Electric Light Orchestra,1977-10-03,https://i.scdn.co/x,1,2,297733,"
            b"https://p.scdn.co/abc,FALSE,79,USEE10000246,calvin,2020-08-15T18:23:11Z\n"
        )
        out = preview.preview_csv(data)
        assert out["headers"][0] == "Track URI"
        assert out["headers"][1] == "Track Name"
        assert len(out["rows"]) == 1
        assert out["rows"][0][1] == "Mr. Blue Sky"
        assert out["rows"][0][2] == "Electric Light Orchestra"

    def test_tsv_detection(self):
        data = b"a\tb\tc\n1\t2\t3\n"
        out = preview.preview_csv(data)
        assert out["headers"] == ["a", "b", "c"]
        assert out["rows"] == [["1", "2", "3"]]

    def test_truncation(self, monkeypatch):
        from drop import MAX_PREVIEW_ROWS
        # Build a CSV with MAX + 5 rows.
        header = "a,b\n"
        rows = "".join(f"{i},{i * 2}\n" for i in range(MAX_PREVIEW_ROWS + 5))
        out = preview.preview_csv((header + rows).encode())
        assert out["truncated"] is True
        assert len(out["rows"]) == MAX_PREVIEW_ROWS

    def test_empty_csv(self):
        out = preview.preview_csv(b"")
        assert out["headers"] == []
        assert out["rows"] == []


# ---------------------------------------------------------------------------
# JSON preview
# ---------------------------------------------------------------------------


class TestJsonPreview:
    def test_object(self):
        out = preview.preview_json(b'{"a": 1, "b": [1, 2, 3]}')
        assert out["ok"] is True
        assert '"a": 1' in out["preview"]
        assert out["parsed_type"] == "dict"

    def test_array(self):
        out = preview.preview_json(b'[1, 2, 3]')
        assert out["ok"] is True
        assert out["parsed_type"] == "list"

    def test_invalid(self):
        out = preview.preview_json(b"{ this is not json")
        assert out["ok"] is False
        assert "Invalid JSON" in out["error"]


# ---------------------------------------------------------------------------
# Top-level preview_for
# ---------------------------------------------------------------------------


class TestPreviewFor:
    def test_dispatches_to_csv(self):
        out = preview.preview_for("text/csv", "x.csv", b"a,b\n1,2\n")
        assert out["kind"] == "csv"
        assert out["headers"] == ["a", "b"]

    def test_dispatches_to_json(self):
        out = preview.preview_for("application/json", "x.json", b'{"a":1}')
        assert out["kind"] == "json"
        assert out["ok"] is True

    def test_dispatches_to_text(self):
        out = preview.preview_for("text/plain", "x.txt", b"hello world")
        assert out["kind"] == "text"
        assert out["preview"] == "hello world"

    def test_dispatches_to_image(self):
        out = preview.preview_for("image/png", "x.png", b"\x89PNG...")
        assert out["kind"] == "image"

    def test_dispatches_to_binary(self):
        out = preview.preview_for("application/octet-stream", "x.bin", b"\x00\x01\x02")
        assert out["kind"] == "binary"
        assert out["size_bytes"] == 3
