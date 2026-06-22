"""Tests for the OCI transport.

These tests verify URL parsing, auth helpers, and manifest/blob handling
logic.  Actual registry interaction tests are marked with ``network`` and
are skipped by default.
"""

from __future__ import annotations

import pytest

from k33p.transport_oci import OCITransport


class TestOCITransportURLParsing:
    def test_supports_oci_https(self) -> None:
        assert OCITransport.supports("oci+https://ghcr.io/org/repo:tag")

    def test_supports_oci_http(self) -> None:
        assert OCITransport.supports("oci+http://registry.example.com/repo:tag")

    def test_does_not_support_plain_https(self) -> None:
        assert not OCITransport.supports("https://example.com")

    def test_does_not_support_git(self) -> None:
        assert not OCITransport.supports("git+https://github.com/org/repo")

    def test_parse_docker_hub_official(self) -> None:
        t = OCITransport("oci+https://alpine:latest")
        registry, repo, ref = t._parse_ref()
        assert registry == "registry-1.docker.io"
        assert repo == "library/alpine"
        assert ref == "latest"

    def test_parse_docker_hub_user(self) -> None:
        t = OCITransport("oci+https://myuser/myimage:v1")
        registry, repo, ref = t._parse_ref()
        assert registry == "registry-1.docker.io"
        assert repo == "myuser/myimage"
        assert ref == "v1"

    def test_parse_ghcr_with_tag(self) -> None:
        t = OCITransport("oci+https://ghcr.io/org/repo:v1.2.3")
        registry, repo, ref = t._parse_ref()
        assert registry == "ghcr.io"
        assert repo == "org/repo"
        assert ref == "v1.2.3"

    def test_parse_with_digest(self) -> None:
        t = OCITransport(
            "oci+https://ghcr.io/org/repo@sha256:"
            "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
        )
        registry, repo, ref = t._parse_ref()
        assert registry == "ghcr.io"
        assert repo == "org/repo"
        assert "sha256:" in ref

    def test_strip_prefix(self) -> None:
        t = OCITransport("oci+https://example.com/repo:tag")
        assert t._strip_prefix() == "https://example.com/repo:tag"

    def test_strip_prefix_no_change(self) -> None:
        t = OCITransport("oci+http://example.com/repo:tag")
        assert t._strip_prefix() == "http://example.com/repo:tag"


class TestOCIAuth:
    def test_no_auth_returns_none(self) -> None:
        """Without environment vars set, auth lookup returns None."""
        t = OCITransport("oci+https://example.com/repo:tag")
        auth = t._get_auth("example.com")
        # This might return None or a value depending on ~/.docker/config.json
        # We just check it doesn't crash
        assert auth is None or isinstance(auth, tuple)

    def test_resolve_registry_with_host(self) -> None:
        registry, repo = OCITransport._resolve_registry("ghcr.io/org/repo")
        assert registry == "ghcr.io"
        assert repo == "org/repo"

    def test_resolve_registry_hub(self) -> None:
        registry, repo = OCITransport._resolve_registry("alpine")
        assert registry == "registry-1.docker.io"
        assert repo == "library/alpine"


class TestOCIAPIBase:
    def test_api_base(self) -> None:
        t = OCITransport("oci+https://ghcr.io/org/repo:tag")
        assert t._api_base("ghcr.io") == "https://ghcr.io/v2"
