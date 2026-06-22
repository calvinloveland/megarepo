"""Tests for the k33p:// peer-to-peer transport."""
from __future__ import annotations
import json
import tempfile
from pathlib import Path
import pytest
from k33p.store import ContentStore
from k33p.transport_k33p import K33pTransport

class TestK33pTransportURL:
    def test_supports_k33p(self) -> None:
        assert K33pTransport.supports("k33p://host:8734")
        assert K33pTransport.supports("k33p://192.168.1.1:8734")
    def test_does_not_support_http(self) -> None:
        assert not K33pTransport.supports("http://example.com")
        assert not K33pTransport.supports("file:///tmp")
    def test_parse_default_port(self) -> None:
        t = K33pTransport("k33p://peer-host")
        host, port = t._parse_url()
        assert host == "peer-host"
        assert port == 8734
    def test_parse_custom_port(self) -> None:
        t = K33pTransport("k33p://peer-host:9999")
        host, port = t._parse_url()
        assert host == "peer-host"
        assert port == 9999
    def test_parse_strips_trailing_slash(self) -> None:
        t = K33pTransport("k33p://host:8734/")
        host, port = t._parse_url()
        assert host == "host"
        assert port == 8734

class TestK33pTransportFetch:
    def test_fetch_returns_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ContentStore(Path(tmp))
            store.ensure()
            t = K33pTransport("k33p://localhost:8734")
            count = t.fetch(store)
            assert count == 0  # no-op for listing
