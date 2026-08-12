"""Tests for the LUC Link Explorer HTTP server + API."""

import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from luc_sim.serve import Handler, api_codes, api_curves, api_sim


@pytest.fixture(scope="module")
def server_url():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.loads(resp.read())


def test_api_codes_shape():
    data = api_codes({})
    assert data["codes"][0]["name"] == "rep5"
    assert len(data["codes"]) == 15
    assert data["header_len"] == 124
    assert data["frame_bits"] == 256


def test_api_sim_adaptive():
    data = api_sim({"frames": "120", "seed": "3", "scenario": "gentle",
                    "mission": "throughput", "profile_frames": "120"})
    assert len(data["records"]) == 120
    assert 0.0 <= data["stats"]["bler"] <= 1.0
    assert data["meta"]["adaptive"] is True
    assert len(data["switches"]) >= 1
    assert data["stats"]["usage"]


def test_api_sim_fixed():
    data = api_sim({"frames": "120", "seed": "3", "scenario": "gentle",
                    "adaptive": "0", "profile_frames": "120"})
    assert data["meta"]["adaptive"] is False
    assert data["switches"] == []
    usage = data["stats"]["usage"]
    assert len(usage) <= 2  # one fixed code (+ sync outages)


def test_api_curves():
    data = api_curves({"snr": "2,4,6", "frames": "100", "profile_frames": "100"})
    assert data["snr_points"] == [2.0, 4.0, 6.0]
    assert "hamming(15,11)" in data["curves"]
    entry = data["curves"]["hamming(15,11)"]
    assert entry["family"] == "hamming"
    assert len(entry["points"]) == 3


def test_http_serve_root(server_url):
    with urllib.request.urlopen(f"{server_url}/", timeout=30) as resp:
        body = resp.read().decode()
        assert resp.status == 200
        assert "LUC Link Explorer" in body


def test_http_serve_json(server_url):
    data = _get(f"{server_url}/api/codes")
    assert len(data["codes"]) == 15
    sim = _get(f"{server_url}/api/sim?frames=100&seed=3&profile_frames=100")
    assert sim["meta"]["frames"] == 100


def test_http_404(server_url):
    import urllib.error

    with pytest.raises(urllib.error.HTTPError):
        _get(f"{server_url}/api/nope")
