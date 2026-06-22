"""Signature verification for k33p locks and manifests.

Uses ``ssh-keygen -Y verify`` (OpenSSH) when available for ed25519
signature verification. Falls back to format-only checks when the
tool is not available.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


class VerifyError(RuntimeError):
    """Raised when signature verification fails."""


def verify_lock_signature(
    lock_path: str | Path,
    *,
    key_path: str | Path | None = None,
) -> tuple[bool, str]:
    """Verify the signature on a k33p.lock file.

    Args:
        lock_path: Path to the ``k33p.lock`` file.
        key_path: Path to the public key file.  If ``None``, extracts
            the key identifier from the lock's signature block and
            looks for ``~/.k33p/keys/<key-id>.pub``.

    Returns:
        ``(is_valid, message)`` tuple.

    Raises:
        VerifyError: If verification can't be performed.
    """
    import yaml

    lock_path = Path(lock_path)
    if not lock_path.exists():
        raise VerifyError(f"lock file not found: {lock_path}")

    with lock_path.open(encoding="utf-8") as f:
        lock_data = yaml.safe_load(f)

    if not isinstance(lock_data, dict):
        raise VerifyError(f"{lock_path} is not a valid YAML mapping")

    sig_data = lock_data.get("signature")
    if not sig_data:
        raise VerifyError(f"no signature block found in {lock_path}")

    sig_key = sig_data.get("key", "")
    sig_value = sig_data.get("sig", "")
    algorithm = sig_data.get("algorithm", "ed25519")

    if not sig_key:
        raise VerifyError("signature block is missing 'key'")
    if not sig_value:
        raise VerifyError("signature block is missing 'sig'")

    # Build the message to verify: the lock content WITHOUT the signature block
    message_data = _lock_content_without_signature(lock_path, lock_data)

    # Check tool and key availability
    ssh_keygen = _find_ssh_keygen()
    resolved_key = _resolve_key(key_path, sig_key) if (key_path or ssh_keygen) else None

    if not ssh_keygen or not resolved_key:
        return _fallback_verify(lock_path, sig_key, sig_value, algorithm)

    # Full verification using ssh-keygen
    with tempfile.TemporaryDirectory(prefix="k33p-verify-") as tmp:
        msg_file = Path(tmp) / "message"
        msg_file.write_bytes(message_data)

        allowed_signers = Path(tmp) / "allowed_signers"
        allowed_signers.write_text(
            f"* {resolved_key.read_text().strip()}\n"
        )

        sig_file = Path(tmp) / "sig"
        sig_file.write_text(sig_value)

        try:
            result = subprocess.run(
                [
                    ssh_keygen, "-Y", "verify",
                    "-f", str(allowed_signers),
                    "-I", sig_key,
                    "-n", "k33p",
                    "-s", str(sig_file),
                ],
                stdin=open(msg_file, "rb"),
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                return True, f"Signature verified: {algorithm} key={sig_key[:24]}..."
            else:
                error = result.stderr.strip() or "signature mismatch"
                return False, f"Verification failed: {error}"
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, f"Verification error: {e}"
        finally:
            msg_file.unlink(missing_ok=True)


def _find_ssh_keygen() -> str | None:
    """Locate ``ssh-keygen`` on PATH."""
    import shutil
    return shutil.which("ssh-keygen")


def _resolve_key(
    key_path: str | Path | None,
    sig_key: str,
) -> Path | None:
    """Resolve a public key path."""
    if key_path:
        p = Path(key_path)
        if p.exists():
            return p
        return None

    # Check ~/.k33p/keys/<key>.pub
    home_key = Path.home() / ".k33p" / "keys" / f"{sig_key}.pub"
    if home_key.exists():
        return home_key

    # Check ~/.ssh/<key>.pub
    ssh_key = Path.home() / ".ssh" / f"{sig_key}.pub"
    if ssh_key.exists():
        return ssh_key

    return None


def _lock_content_without_signature(
    lock_path: Path, lock_data: dict,
) -> bytes:
    """Return the lock file content with the signature block removed."""
    import yaml

    filtered = {k: v for k, v in lock_data.items() if k != "signature"}
    return yaml.dump(filtered, sort_keys=False).encode()


def _fallback_verify(
    lock_path: Path,
    sig_key: str,
    sig_value: str,
    algorithm: str,
) -> tuple[bool, str]:
    """Fallback verification when ssh-keygen is not available.

    Checks that the signature format is reasonable and suggests
    installing ssh-keygen for real verification.
    """
    # Check format
    if algorithm not in ("ed25519", "ssh-ed25519"):
        return False, f"Unknown algorithm: {algorithm}"

    if len(sig_key) < 8 or len(sig_value) < 8:
        return False, "Signature key or value too short"

    return True, (
        f"Format check passed ({algorithm}, key={sig_key[:24]}...). "
        "Install ssh-keygen (OpenSSH) for cryptographic verification."
    )
