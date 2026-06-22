"""OCI transport for k33p — fetch artifacts from container registries.

Implements a subset of the `OCI Distribution Spec`_ for pulling manifests
and layers (blobs) from container registries.

Supported URL schemes:

- ``oci+https://registry.example.com/repo:tag``
- ``oci+https://registry.example.com/repo@sha256:digest``

Authentication is handled via the ``~/.docker/config.json`` credential store
(if available) or by reading ``K33P_OCI_USERNAME`` / ``K33P_OCI_PASSWORD``
environment variables.

.. _OCI Distribution Spec:
    https://github.com/opencontainers/distribution-spec/blob/main/spec.md
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from k33p.store import ContentStore
from k33p.transport import Transport, TransportError


# ── OCI transport ─────────────────────────────────────────────────────────


class OCITransport(Transport):
    """Transport that fetches objects from OCI-compatible container registries.

    Can pull image manifests and layers (blobs) and store them in the k33p
    content-addressed store.

    Uses the standard library for HTTP(S) so there are no extra dependencies.
    """

    # Supported media types for image manifests
    MANIFEST_MEDIA_TYPES = frozenset({
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
    })

    @classmethod
    def supports(cls, source: str) -> bool:
        return source.lower().startswith("oci+https://") or source.lower().startswith("oci+http://")

    def _strip_prefix(self) -> str:
        """Return the actual URL without the ``oci+`` prefix."""
        src = self.source
        if src.lower().startswith("oci+"):
            return src[4:]
        return src

    def _parse_ref(self) -> tuple[str, str, str | None]:
        """Parse source into ``(registry, repo, reference)``.

        Reference may be a tag (``v1.2.3``) or a digest (``sha256:...``).
        """
        url = self._strip_prefix()
        # Remove https:// or http:// prefix
        for prefix in ("https://", "http://"):
            if url.startswith(prefix):
                url = url[len(prefix):]
                break

        # Split on @ for digest or : for tag
        if "@" in url:
            repo_ref, digest = url.rsplit("@", 1)
            reg, r = self._resolve_registry(repo_ref)
            return (reg, r, digest)

        if ":" in url:
            repo_ref, tag = url.rsplit(":", 1)
            # Make sure tag doesn't contain a slash (otherwise it's port:path)
            if "/" not in tag:
                reg, r = self._resolve_registry(repo_ref)
                return (reg, r, tag)

        reg, r = self._resolve_registry(url)
        return (reg, r, "latest")

    @staticmethod
    def _resolve_registry(repo_ref: str) -> tuple[str, str]:
        """Split *repo_ref* into ``(registry, repo_path)``.

        If no registry host is present, default to ``registry-1.docker.io``
        (Docker Hub).
        """
        if "/" not in repo_ref:
            # Docker Hub official image (e.g. "alpine")
            return "registry-1.docker.io", f"library/{repo_ref}"
        parts = repo_ref.split("/", 1)
        host = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        # Docker Hub shorthand
        if "." not in host and ":" not in host:
            return "registry-1.docker.io", repo_ref
        return host, path

    # ── auth helpers ─────────────────────────────────────────────────

    def _get_auth(self, registry: str) -> tuple[str, str] | None:
        """Look up credentials for *registry*.

        Checks in order:
        1. ``K33P_OCI_USERNAME`` / ``K33P_OCI_PASSWORD`` env vars
        2. ``~/.docker/config.json`` credential store

        Returns ``(username, password)`` or ``None``.
        """
        env_user = os.environ.get("K33P_OCI_USERNAME")
        env_pass = os.environ.get("K33P_OCI_PASSWORD")
        if env_user and env_pass:
            return (env_user, env_pass)

        # Try docker config
        docker_cfg = Path.home() / ".docker" / "config.json"
        if docker_cfg.exists():
            try:
                data = json.loads(docker_cfg.read_text())
                auths = data.get("auths", {})
                # Try exact match
                for key in (registry, f"https://{registry}", f"https://{registry}/v1/",
                            f"https://{registry}/v2/"):
                    if key in auths:
                        auth = auths[key].get("auth", "")
                        if auth:
                            decoded = base64.b64decode(auth).decode()
                            if ":" in decoded:
                                user, pwd = decoded.split(":", 1)
                                return (user, pwd)
            except (OSError, json.JSONDecodeError):
                pass

        return None

    def _get_headers(self, registry: str) -> dict[str, str]:
        """Return headers for OCI API requests, including auth if available."""
        headers = {
            "Accept": ", ".join(sorted(self.MANIFEST_MEDIA_TYPES)),
            "User-Agent": "k33p-oci/0.0.1",
        }
        auth = self._get_auth(registry)
        if auth:
            encoded = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
            headers["Authorization"] = f"Basic {encoded}"
        return headers

    def _request(
        self, url: str, headers: dict[str, str], accept_redirects: bool = True
    ) -> tuple[int, dict[str, Any], bytes]:
        """Make an HTTP request and return ``(status, headers_dict, body)``."""
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                resp_headers = dict(resp.headers)
                return (resp.status, resp_headers, body)
        except urllib.error.HTTPError as e:
            if e.code == 401 and "Www-Authenticate" in e.headers:
                # Attempt token-based auth
                auth_header = e.headers["Www-Authenticate"]
                token = self._bearer_token(auth_header, headers)
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                    req = urllib.request.Request(url, headers=headers)
                    try:
                        with urllib.request.urlopen(req, timeout=30) as resp:
                            body = resp.read()
                            return (resp.status, dict(resp.headers), body)
                    except urllib.error.HTTPError as e2:
                        return (e2.code, dict(e2.headers), e2.read())
            return (e.code, dict(e.headers), e.read())
        except urllib.error.URLError as e:
            raise TransportError(f"OCI request failed: {e}") from e

    def _bearer_token(self, www_auth: str, headers: dict[str, str]) -> str | None:
        """Authenticate using Bearer token per the OCI distribution spec.

        The ``Www-Authenticate`` header looks like::

            Bearer realm="...",service="...",scope="..."
        """
        import re

        # Parse the auth challenge
        match = re.match(
            r'Bearer\s+realm="([^"]+)",\s*service="([^"]+)",\s*scope="([^"]+)"',
            www_auth,
        )
        if not match:
            return None
        realm, service, scope = match.group(1), match.group(2), match.group(3)

        auth_url = f"{realm}?service={urllib.parse.quote(service)}&scope={urllib.parse.quote(scope)}"
        auth = self._get_auth(self.source)
        if auth:
            encoded = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
            auth_headers = {"Authorization": f"Basic {encoded}"}
        else:
            auth_headers = {}

        try:
            req = urllib.request.Request(auth_url, headers=auth_headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                return data.get("token") or data.get("access_token")
        except (urllib.error.URLError, json.JSONDecodeError):
            return None

    # ── OCI API methods ──────────────────────────────────────────────

    def _api_base(self, registry: str) -> str:
        return f"https://{registry}/v2"

    def _get_manifest(
        self, registry: str, repo: str, reference: str
    ) -> tuple[dict[str, Any], bytes] | None:
        """Fetch the manifest for *reference* (tag or digest).

        Returns ``(parsed_dict, raw_bytes)`` or ``None``.
        """
        url = f"{self._api_base(registry)}/{repo}/manifests/{reference}"
        headers = self._get_headers(registry)
        status, resp_headers, body = self._request(url, headers)

        if status != 200:
            return None

        try:
            manifest = json.loads(body)
            return manifest, body
        except json.JSONDecodeError:
            return None

    def _get_blob(
        self, registry: str, repo: str, digest: str
    ) -> bytes | None:
        """Fetch a blob (layer) by digest."""
        url = f"{self._api_base(registry)}/{repo}/blobs/{digest}"
        headers = self._get_headers(registry)
        # Remove manifest Accept headers for blob requests
        headers = {k: v for k, v in headers.items() if k != "Accept"}
        status, resp_headers, body = self._request(url, headers)
        if status != 200:
            return None
        return body

    def _digest_from_headers(self, resp_headers: dict[str, Any]) -> str | None:
        """Extract the content digest from response headers."""
        return resp_headers.get("Docker-Content-Digest")

    # ── fetch implementation ─────────────────────────────────────────

    def fetch(self, store: ContentStore) -> int:
        """Pull the referenced image and store objects in *store*.

        Fetches:
        1. The image manifest(s)
        2. All referenced layers (blobs)
        3. Config blob

        Returns the number of objects stored.
        """
        count = 0
        store.ensure()

        registry, repo, reference = self._parse_ref()

        # Fetch the manifest
        result = self._get_manifest(registry, repo, reference)
        if result is None:
            # Try with "latest" if no reference was given
            if reference is None:
                result = self._get_manifest(registry, repo, "latest")
            if result is None:
                raise TransportError(
                    f"failed to fetch manifest for {registry}/{repo}:{reference}"
                )

        manifest, raw_manifest = result

        # Store the manifest
        manifest_hash = store.put(raw_manifest, kind="manifest")
        count += 1

        # Handle manifest lists (multi-arch)
        manifests_to_pull: list[dict[str, Any]] = []
        media_type = manifest.get("mediaType", "")

        if media_type in (
            "application/vnd.oci.image.index.v1+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
        ):
            # It's a manifest list — pull the first platform
            manifests_to_pull = manifest.get("manifests", [])
            if manifests_to_pull:
                # Pull the first one (default platform)
                first = manifests_to_pull[0]
                digest = first.get("digest", "")
                if digest:
                    result2 = self._get_manifest(registry, repo, digest)
                    if result2:
                        manifest, raw_manifest = result2
                        manifest_hash = store.put(raw_manifest, kind="manifest")
                        count += 1

        # Pull layers and config
        config = manifest.get("config", {})
        config_digest = config.get("digest", "")
        if config_digest:
            config_data = self._get_blob(registry, repo, config_digest)
            if config_data:
                store.put(config_data, kind="blob")
                count += 1

        layers = manifest.get("layers", [])
        for layer in layers:
            layer_digest = layer.get("digest", "")
            if not layer_digest:
                continue
            # Check if we already have it
            if store.has(layer_digest.replace("sha256:", "")):
                continue
            layer_data = self._get_blob(registry, repo, layer_digest)
            if layer_data:
                store.put(layer_data, kind="blob")
                count += 1

        return count


# ── end of OCITransport ───────────────────────────────────────────────────
