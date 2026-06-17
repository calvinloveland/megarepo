"""Tests for the Flask app — endpoints, error handling, JSON contracts."""

from __future__ import annotations

import io

import pytest

from drop.app import create_app


@pytest.fixture
def client(tmp_data_dir):
    flask_app = create_app()
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# / and /api/status
# ---------------------------------------------------------------------------


class TestIndex:
    def test_index_renders(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert b"drop" in r.data
        assert b"Drop files here" in r.data


class TestStatus:
    def test_status_ok(self, client):
        r = client.get("/api/status")
        assert r.status_code == 200
        data = r.get_json()
        assert data["ok"] is True
        assert "version" in data
        assert data["storage"]["used_bytes"] == 0
        assert data["files_count"] == 0


# ---------------------------------------------------------------------------
# /api/files
# ---------------------------------------------------------------------------


class TestFiles:
    def test_list_empty(self, client):
        r = client.get("/api/files")
        assert r.status_code == 200
        assert r.get_json() == {"ok": True, "files": []}

    def test_upload_single(self, client):
        data = {"file": (io.BytesIO(b"hello world"), "hello.txt", "text/plain")}
        r = client.post(
            "/api/files", data=data, content_type="multipart/form-data",
        )
        assert r.status_code == 200
        body = r.get_json()
        assert body["ok"] is True
        assert len(body["uploaded"]) == 1
        uploaded = body["uploaded"][0]
        assert uploaded["name"] == "hello.txt"
        assert uploaded["size"] == 11
        assert uploaded["content_type"] == "text/plain"
        assert uploaded["size_human"]
        assert uploaded["download_url"].startswith("/files/")
        assert uploaded["raw_url"].startswith("/files/")
        assert uploaded["preview_url"].startswith("/api/files/")

    def test_upload_multiple(self, client):
        data = {
            "file": [
                (io.BytesIO(b"aaa"), "a.txt", "text/plain"),
                (io.BytesIO(b"bbbbb"), "b.txt", "text/plain"),
            ],
        }
        r = client.post(
            "/api/files", data=data, content_type="multipart/form-data",
        )
        body = r.get_json()
        assert body["ok"] is True
        assert len(body["uploaded"]) == 2
        names = sorted(f["name"] for f in body["uploaded"])
        assert names == ["a.txt", "b.txt"]

    def test_upload_no_file_field(self, client):
        r = client.post(
            "/api/files", data={}, content_type="multipart/form-data",
        )
        assert r.status_code == 400
        assert r.get_json()["ok"] is False

    def test_upload_empty_file(self, client):
        data = {"file": (io.BytesIO(b""), "empty.txt", "text/plain")}
        r = client.post(
            "/api/files", data=data, content_type="multipart/form-data",
        )
        body = r.get_json()
        assert body["ok"] is True
        assert body["uploaded"] == []
        assert len(body["errors"]) == 1
        assert "Empty" in body["errors"][0]["error"]

    def test_upload_exceeds_per_file_cap(self, tmp_data_dir):
        # Build a fresh app with a tiny per-file cap.
        flask_app = create_app()
        flask_app.config["MAX_CONTENT_LENGTH"] = 10  # 10 bytes
        flask_app.config["TESTING"] = True
        c = flask_app.test_client()
        data = {"file": (io.BytesIO(b"x" * 100), "big.txt", "text/plain")}
        r = c.post("/api/files", data=data, content_type="multipart/form-data")
        # Flask returns 413 before our handler runs by default — but our
        # custom 413 handler should kick in and return JSON.
        assert r.status_code == 413
        assert r.get_json()["ok"] is False

    def test_metadata(self, client):
        data = {"file": (io.BytesIO(b"hi"), "x.txt", "text/plain")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/api/files/{fid}")
        assert r2.status_code == 200
        body = r2.get_json()
        assert body["file"]["id"] == fid

    def test_metadata_404(self, client):
        r = client.get("/api/files/00000000000000000000000000000000")
        assert r.status_code == 404

    def test_delete(self, client):
        data = {"file": (io.BytesIO(b"delete me"), "doomed.txt", "text/plain")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.delete(f"/api/files/{fid}")
        assert r2.status_code == 200
        r3 = client.get(f"/api/files/{fid}")
        assert r3.status_code == 404

    def test_delete_404(self, client):
        r = client.delete("/api/files/00000000000000000000000000000000")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Preview endpoint
# ---------------------------------------------------------------------------


class TestPreview:
    def test_csv_preview(self, client):
        data = {"file": (io.BytesIO(b"a,b\n1,2\n3,4\n"), "x.csv", "text/csv")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/api/files/{fid}/preview")
        body = r2.get_json()
        assert body["kind"] == "csv"
        assert body["headers"] == ["a", "b"]
        assert body["rows"] == [["1", "2"], ["3", "4"]]

    def test_json_preview(self, client):
        data = {"file": (io.BytesIO(b'{"x": 1}'), "x.json", "application/json")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/api/files/{fid}/preview")
        body = r2.get_json()
        assert body["kind"] == "json"
        assert body["ok"] is True
        assert body["parsed_type"] == "dict"

    def test_text_preview(self, client):
        data = {"file": (io.BytesIO(b"hi\nworld"), "x.txt", "text/plain")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/api/files/{fid}/preview")
        body = r2.get_json()
        assert body["kind"] == "text"
        assert body["preview"] == "hi\nworld"

    def test_binary_preview(self, client):
        data = {"file": (io.BytesIO(b"\x00\x01\x02"), "x.bin", "application/octet-stream")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/api/files/{fid}/preview")
        body = r2.get_json()
        assert body["kind"] == "binary"

    def test_preview_404(self, client):
        r = client.get("/api/files/00000000000000000000000000000000/preview")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Raw file endpoints (/files/<id>, /files/<id>/download)
# ---------------------------------------------------------------------------


class TestFileAccess:
    def test_download_forced(self, client):
        data = {"file": (io.BytesIO(b"abcdef"), "x.txt", "text/plain")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/files/{fid}/download")
        assert r2.status_code == 200
        assert r2.data == b"abcdef"
        assert "attachment" in r2.headers.get("Content-Disposition", "")

    def test_raw_serves(self, client):
        data = {"file": (io.BytesIO(b"abcdef"), "x.txt", "text/plain")}
        r = client.post("/api/files", data=data, content_type="multipart/form-data")
        fid = r.get_json()["uploaded"][0]["id"]
        r2 = client.get(f"/files/{fid}")
        assert r2.status_code == 200
        assert r2.data == b"abcdef"

    def test_404_for_bad_id(self, client):
        r = client.get("/files/00000000000000000000000000000000")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# JSON 404 contract
# ---------------------------------------------------------------------------


class TestErrorHandlers:
    def test_api_404_returns_json(self, client):
        r = client.get("/api/does-not-exist")
        assert r.status_code == 404
        assert r.get_json() == {"ok": False, "error": "Not found"}

    def test_page_404_returns_text(self, client):
        r = client.get("/no-such-page")
        assert r.status_code == 404
