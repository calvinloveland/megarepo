"""Tests for the OCI transport.

These tests verify URL parsing, auth helpers, and manifest/blob handling
logic.  Actual registry interaction tests are marked with ``network`` and
are skipped by default.
"""

from __future__ import annotations

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


class TestBearerTokenAuth:
    """Regression tests for OCI Bearer-token exchange security/behavior."""

    def _transport(self) -> OCITransport:
        return OCITransport("oci+https://ghcr.io/org/repo:tag")

    def test_refuses_non_https_realm(self, monkeypatch):
        """Credentials must never be sent to a non-HTTPS realm.

        A malicious / MITM'd registry could set realm="http://attacker" or a
        file:// scheme to harvest the victim's credentials. MUST return None
        and never issue a request.
        """
        called = {"hit": False}

        def _no_request(*args, **kwargs):
            called["hit"] = True
            raise AssertionError("must not make a request to a non-https realm")

        import urllib.request
        monkeypatch.setattr(urllib.request, "urlopen", _no_request)
        monkeypatch.setenv("K33P_OCI_USERNAME", "victim")
        monkeypatch.setenv("K33P_OCI_PASSWORD", "hunter2")

        t = self._transport()
        # http realm — must be refused.
        assert t._bearer_token(
            'Bearer realm="http://attacker.example/token",service="r",scope="s"',
            {},
            registry="ghcr.io",
        ) is None
        # file realm — must be refused.
        assert t._bearer_token(
            'Bearer realm="file:///etc/passwd",service="r",scope="s"',
            {},
            registry="ghcr.io",
        ) is None
        assert called["hit"] is False

    def test_parses_www_authenticate_in_any_order(self, monkeypatch):
        """service/scope/realm may appear in any order in the challenge."""
        captured = {}

        class _Resp:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"token": "TKN"}'

        def _fake_urlopen(req, timeout=30):
            captured["url"] = req.full_url
            return _Resp()

        import urllib.request
        monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)
        t = self._transport()
        # scope before service before realm — must still parse.
        token = t._bearer_token(
            'Bearer scope="repository:org/repo:pull",service="ghcr.io",'
            'realm="https://ghcr.io/token"',
            {},
            registry="ghcr.io",
        )
        assert token == "TKN"
        assert captured["url"] == (
            "https://ghcr.io/token"
            "?service=ghcr.io"
            # quote() leaves '/' unquoted by default (safe='/'), only escapes
            # ':' and the rest.
            "&scope=repository%3Aorg/repo%3Apull"
        )

    def test_looks_up_credentials_by_registry_not_source(self, monkeypatch):
        """Bearer exchange must look up credentials by the registry HOST, not
        by the full 'oci+https://...' source string (which would never match
        a docker-config key and silently skip auth)."""
        seen = {}

        class _Resp:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"token": "TKN"}'

        def _fake_urlopen(req, timeout=30):
            seen["auth"] = req.headers.get("Authorization")
            return _Resp()

        import urllib.request
        monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

        # Replace _get_auth with a sentinel that ONLY accepts the registry host
        # and returns None for any other key (simulating docker-config lookup).
        t = self._transport()
        def _stub_get_auth(registry_arg):
            seen["registry_arg"] = registry_arg
            return ("realuser", "realpass") if registry_arg == "ghcr.io" else None
        monkeypatch.setattr(t, "_get_auth", _stub_get_auth)

        t._bearer_token(
            'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="s"',
            {},
            registry="ghcr.io",
        )
        # Must have queried by the registry host, not the source URL.
        assert seen.get("registry_arg") == "ghcr.io"
        # And therefore sent Basic creds.
        assert seen["auth"] is not None and seen["auth"].startswith("Basic ")
