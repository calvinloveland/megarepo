"""Parser for k33p.lock files.

A k33p.lock pins every channel to a specific ref and records the full
toolchain used to build the project. For monorepos, the lock can be at
the monorepo root (pinning the whole monorepo) or at a subproject path
(pinning just that subproject).

The lock is signed in v1; this MVP parser does not yet verify signatures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from k33p.channels import ManifestError
from k33p.refs import Ref, parse_ref_string


@dataclass(frozen=True)
class Toolchain:
    """The toolchain used to build the project.

    Pinned in the lockfile so the build is reproducible. The fields here
    are intentionally loose — different ecosystems have different names
    for the same idea. The `extras` dict holds any extra toolchain data.
    """

    compiler: str | None = None
    build_system: str | None = None
    linker: str | None = None
    codegen_opts: str | None = None
    env_hash: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Toolchain:
        known = {"compiler", "build_system", "linker", "codegen_opts", "env_hash"}
        return cls(
            compiler=data.get("compiler"),
            build_system=data.get("build_system"),
            linker=data.get("linker"),
            codegen_opts=data.get("codegen_opts"),
            env_hash=data.get("env_hash"),
            extras={k: v for k, v in data.items() if k not in known},
        )


@dataclass(frozen=True)
class ChannelLock:
    """A single channel's pinned state in the lockfile."""

    name: str
    ref: Ref
    subproject: str | None = None

    @classmethod
    def from_dict(cls, name: str, data: Any, subproject: str | None = None) -> ChannelLock:
        if isinstance(data, str):
            ref = parse_ref_string(data)
            return cls(name=name, ref=ref, subproject=subproject)
        if isinstance(data, dict):
            ref_str = data.get("ref")
            if not ref_str:
                raise ManifestError(f"channel lock {name!r} is missing 'ref'")
            ref = parse_ref_string(ref_str)
            return cls(
                name=name,
                ref=ref,
                subproject=data.get("subproject") or subproject,
            )
        raise ManifestError(
            f"channel lock {name!r} must be a string or mapping"
        )


@dataclass(frozen=True)
class Signature:
    """A signature on a lock or manifest entry."""

    key: str
    sig: str
    algorithm: str = "ed25519"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Signature:
        return cls(
            key=data.get("key", ""),
            sig=data.get("sig", ""),
            algorithm=data.get("algorithm", "ed25519"),
        )


@dataclass(frozen=True)
class Lock:
    """A parsed k33p.lock file."""

    path: Path
    generated: str | None = None
    channels: dict[str, ChannelLock] = field(default_factory=dict)
    toolchain: Toolchain | None = None
    signature: Signature | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def parse_lock(path: str | Path) -> Lock | None:
    """Parse a k33p.lock file. Returns None if the file doesn't exist."""
    path = Path(path)
    if not path.exists():
        return None

    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if data is None:
        return None
    if not isinstance(data, dict):
        raise ManifestError(
            f"{path} must be a YAML mapping, got {type(data).__name__}"
        )

    channels: dict[str, ChannelLock] = {}
    for ch_name, ch_data in data.get("channels", {}).items():
        channels[ch_name] = ChannelLock.from_dict(ch_name, ch_data)

    toolchain_data = data.get("toolchain")
    toolchain = Toolchain.from_dict(toolchain_data) if toolchain_data else None

    sig_data = data.get("signature")
    signature = Signature.from_dict(sig_data) if sig_data else None

    known = {"generated", "channels", "toolchain", "signature"}
    extra = {k: v for k, v in data.items() if k not in known}

    return Lock(
        path=path,
        generated=data.get("generated"),
        channels=channels,
        toolchain=toolchain,
        signature=signature,
        extra=extra,
    )


def discover_lock(manifest_path: str | Path) -> Lock | None:
    """Find and parse the k33p.lock next to a manifest.

    Returns None if no lock file exists. In a monorepo, this returns the
    monorepo-wide lock at the root; subproject-specific locks are loaded
    by the project model when it builds its subproject views.
    """
    manifest_path = Path(manifest_path)
    return parse_lock(manifest_path.parent / "k33p.lock")
