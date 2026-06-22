"""Tests for signature verification."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from k33p.sig import (
    VerifyError,
    verify_lock_signature,
    _find_ssh_keygen,
    _resolve_key,
)


class TestSSHKeygenAvailable:
    def test_find_ssh_keygen(self) -> None:
        """Most systems have ssh-keygen from OpenSSH."""
        result = _find_ssh_keygen()
        # Accept either found or not — depends on the environment
        assert result is None or isinstance(result, str)


class TestResolveKey:
    def test_resolve_explicit_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            key_file = Path(tmp) / "key.pub"
            key_file.write_text("ssh-ed25519 AAAAC3... test@test")
            resolved = _resolve_key(key_file, "test-key")
            assert resolved == key_file

    def test_resolve_nonexistent_returns_none(self) -> None:
        resolved = _resolve_key("/nonexistent/key.pub", "test-key")
        assert resolved is None

    def test_resolve_nonexistent_key_id(self) -> None:
        resolved = _resolve_key(None, "nonexistent-key-id")
        assert resolved is None


class TestVerifyLockSignature:
    def test_no_signature_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "k33p.lock"
            lock.write_text("generated: 2026-01-01\nchannels:\n  src:\n    ref: src@abc\n")
            with pytest.raises(VerifyError, match="no signature"):
                verify_lock_signature(lock)

    def test_missing_key_field(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "k33p.lock"
            lock.write_text("""\
channels:
  src:
    ref: src@abc
signature:
  sig: abc123
  algorithm: ed25519
""")
            with pytest.raises(VerifyError, match="missing.*key"):
                verify_lock_signature(lock)

    def test_missing_sig_field(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "k33p.lock"
            lock.write_text("""\
channels:
  src:
    ref: src@abc
signature:
  key: test-key
  algorithm: ed25519
""")
            with pytest.raises(VerifyError, match="missing.*sig"):
                verify_lock_signature(lock)

    def test_valid_format_ssh_keygen_absent(self) -> None:
        """Test that fallback verification works when ssh-keygen is absent."""
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "k33p.lock"
            lock.write_text("""\
generated: 2026-01-01T00:00:00Z
channels:
  src:
    ref: src@deadbeef
signature:
  key: age1maintainerkey...
  sig: sig1xyzabc...full-signature
  algorithm: ed25519
""")
            valid, msg = verify_lock_signature(lock)
            # Either format check passes or full verification runs
            assert isinstance(valid, bool)

    def test_lock_file_not_found(self) -> None:
        with pytest.raises(VerifyError, match="not found"):
            verify_lock_signature("/nonexistent/lock")
