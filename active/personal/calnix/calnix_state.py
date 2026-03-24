from __future__ import annotations

import json
import os
import platform
import re
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

STATE_VERSION = 1
DEFAULT_STATE_DIR = Path(os.environ.get("CALNIX_STATE_DIR", "/var/lib/calnix"))
DEFAULT_STATE_FILE = "state.json"
GENERATIONS_DIR = "generations"
_REGISTRY_ENV = "CALNIX_REGISTRY_FILE"


class CalnixStateError(RuntimeError):
    """Raised when calnix state operations fail."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def registry_path() -> Path:
    env_path = os.environ.get(_REGISTRY_ENV)
    if env_path:
        return Path(env_path)
    return Path(__file__).resolve().with_name("package-health-registry.json")


def load_registry() -> dict[str, Any]:
    path = registry_path()
    if not path.exists():
        raise CalnixStateError(f"Package registry not found: {path}")
    return json.loads(path.read_text())


def resolve_state_dir(state_dir: str | os.PathLike[str] | None = None) -> Path:
    if state_dir is None:
        return DEFAULT_STATE_DIR
    return Path(state_dir)


def state_file_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / DEFAULT_STATE_FILE


def generations_dir_path(state_dir: str | os.PathLike[str] | None = None) -> Path:
    return resolve_state_dir(state_dir) / GENERATIONS_DIR


def ensure_state_layout(state_dir: str | os.PathLike[str] | None = None) -> Path:
    root = resolve_state_dir(state_dir)
    root.mkdir(parents=True, exist_ok=True)
    generations_dir_path(root).mkdir(parents=True, exist_ok=True)
    return root


def default_state() -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "updated_at": utc_now(),
        "packages": {},
    }


def load_state(state_dir: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    path = state_file_path(state_dir)
    if not path.exists():
        return default_state()
    data = json.loads(path.read_text())
    data.setdefault("version", STATE_VERSION)
    data.setdefault("updated_at", utc_now())
    data.setdefault("packages", {})
    return data


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temp_name = handle.name
    os.replace(temp_name, path)


def save_state(payload: dict[str, Any], state_dir: str | os.PathLike[str] | None = None) -> Path:
    ensure_state_layout(state_dir)
    payload["updated_at"] = utc_now()
    path = state_file_path(state_dir)
    atomic_write_json(path, payload)
    return path


def ensure_package_state(payload: dict[str, Any], package_name: str) -> dict[str, Any]:
    packages = payload.setdefault("packages", {})
    entry = packages.setdefault(package_name, {})
    entry.setdefault("confirmations", [])
    entry.setdefault("failures", [])
    entry.setdefault("observations", [])
    entry.setdefault("active_policy", None)
    entry.setdefault("active_revision", None)
    entry.setdefault("updated_at", utc_now())
    return entry


def update_package_state(payload: dict[str, Any], package_name: str, entry: dict[str, Any]) -> None:
    entry["updated_at"] = utc_now()
    payload.setdefault("packages", {})[package_name] = entry


def short_revision(revision: str | None) -> str:
    if not revision:
        return "current"
    return revision[:12]


def current_system() -> str:
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x86_64-linux"
    if machine in {"aarch64", "arm64"}:
        return "aarch64-linux"
    return f"{machine}-linux"


def find_repo_root(explicit_repo: str | os.PathLike[str] | None = None) -> Path:
    candidates = []
    if explicit_repo is not None:
        candidates.append(Path(explicit_repo))
    env_root = os.environ.get("CALNIX_REPO_ROOT")
    if env_root:
        candidates.append(Path(env_root))
    candidates.append(Path.cwd())
    candidates.append(Path("/etc/nixos"))

    seen: set[Path] = set()
    for candidate in candidates:
        for probe in [candidate, *candidate.parents]:
            probe = probe.resolve()
            if probe in seen:
                continue
            seen.add(probe)
            if (probe / "flake.lock").exists() and (probe / "flake.nix").exists() and (probe / "rebuild.py").exists():
                return probe

    raise CalnixStateError(
        "Unable to locate the calnix repo. Run from the repo root or pass --repo /path/to/calnix."
    )


def load_flake_lock(repo_root: str | os.PathLike[str]) -> dict[str, Any]:
    path = Path(repo_root) / "flake.lock"
    if not path.exists():
        raise CalnixStateError(f"flake.lock not found under {repo_root}")
    return json.loads(path.read_text())


def nixpkgs_locked_revision(lock_data: dict[str, Any]) -> str:
    try:
        return lock_data["nodes"]["nixpkgs"]["locked"]["rev"]
    except KeyError as exc:
        raise CalnixStateError("flake.lock does not contain nodes.nixpkgs.locked.rev") from exc


def nixpkgs_locked_reference(lock_data: dict[str, Any]) -> str:
    locked = lock_data["nodes"]["nixpkgs"]["locked"]
    owner = locked.get("owner", "NixOS")
    repo = locked.get("repo", "nixpkgs")
    rev = locked.get("rev")
    if not rev:
        raise CalnixStateError("flake.lock does not contain a pinned nixpkgs revision")
    return f"github:{owner}/{repo}/{rev}"


def nix_attr_expression(attr_path: list[str]) -> str:
    rendered = []
    for segment in attr_path:
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_'-]*", segment):
            rendered.append(f'."{segment}"')
        else:
            rendered.append(f'."{segment}"')
    return "".join(rendered)


def evaluate_package_version(attr_path: list[str], nixpkgs_ref: str, system: str | None = None) -> str:
    system_name = system or current_system()
    expr = f'''
let
  flake = builtins.getFlake "{nixpkgs_ref}";
  pkgs = import flake.outPath {{
    system = "{system_name}";
    config.allowUnfree = true;
  }};
in pkgs{nix_attr_expression(attr_path)}.version or "unknown"
'''
    result = subprocess.run(
        ["nix", "eval", "--impure", "--raw", "--expr", expr],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown nix error"
        raise CalnixStateError(f"Unable to evaluate package version for {'.'.join(attr_path)}: {detail}")
    return result.stdout.strip() or "unknown"


def effective_policy(package_state: dict[str, Any], registry_entry: dict[str, Any]) -> str:
    active = package_state.get("active_policy")
    if active:
        return active
    return registry_entry.get("defaultPolicy", "current")


def effective_revision(package_state: dict[str, Any]) -> str | None:
    return package_state.get("active_revision") or None


def latest_confirmed_revision(package_state: dict[str, Any], current_revision: str) -> str | None:
    confirmations = package_state.get("confirmations", [])
    for confirmation in reversed(confirmations):
        revision = confirmation.get("nixpkgs_rev")
        if revision and revision != current_revision:
            return revision
    return None


def state_digest(state_dir: str | os.PathLike[str] | None = None) -> str | None:
    path = state_file_path(state_dir)
    if not path.exists():
        return None
    return sha256(path.read_bytes()).hexdigest()


def current_generation_number() -> int | None:
    profile = Path("/nix/var/nix/profiles/system")
    if not profile.exists():
        return None
    resolved = profile.resolve()
    match = re.search(r"system-(\d+)-link$", str(resolved))
    if not match:
        return None
    return int(match.group(1))


def active_package_policies(
    payload: dict[str, Any], registry: dict[str, Any], current_revision: str | None = None
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for package_name, registry_entry in registry.get("packages", {}).items():
        package_state = payload.get("packages", {}).get(package_name, {})
        policy = effective_policy(package_state, registry_entry)
        revision = effective_revision(package_state)
        is_degraded = policy != "current"
        if revision and current_revision and revision != current_revision:
            is_degraded = True
        entries.append(
            {
                "package": package_name,
                "policy": policy,
                "revision": revision,
                "default_policy": registry_entry.get("defaultPolicy", "current"),
                "degraded": is_degraded,
            }
        )
    return entries


def record_generation_metadata(
    state_dir: str | os.PathLike[str] | None,
    generation_number: int,
    payload: dict[str, Any],
) -> Path:
    ensure_state_layout(state_dir)
    path = generations_dir_path(state_dir) / f"{generation_number}.json"
    atomic_write_json(path, payload)
    return path


def list_generation_metadata(
    state_dir: str | os.PathLike[str] | None = None, limit: int | None = None
) -> list[dict[str, Any]]:
    directory = generations_dir_path(state_dir)
    if not directory.exists():
        return []
    records = []
    for path in sorted(directory.glob("*.json"), key=lambda item: item.stem, reverse=True):
        records.append(json.loads(path.read_text()))
        if limit is not None and len(records) >= limit:
            break
    return records
