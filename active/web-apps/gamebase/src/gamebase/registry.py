"""Game registry: manifests, scaffolding, publishing, and remixing.

A Gamebase game is just a directory containing a ``game.yaml`` manifest plus
its web assets. That keeps games trivial to generate (by a human or an agent),
diff, and copy. This module owns the on-disk contract; the database only stores
a queryable mirror of it.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")
MANIFEST_NAME = "game.yaml"
DEFAULT_VERSION = "0.1.0"

# Directories that should never be copied into a remix or scanned as assets.
IGNORED_DIRS = {"node_modules", ".git", "__pycache__", ".pytest_cache", "dist", ".venv"}

# Files the push API accepts. Games are HTML/JS/CSS artifacts, so text is the
# right boundary: it keeps validation simple and blocks binary abuse.
TEXT_EXTENSIONS = {
    ".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json", ".txt",
    ".md", ".yaml", ".yml", ".svg", ".csv",
}
MAX_FILE_BYTES = 512 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024


class ManifestError(ValueError):
    """Raised when a ``game.yaml`` is missing or invalid."""


@dataclass
class Manifest:
    """Validated representation of a game's ``game.yaml``."""

    slug: str
    title: str
    description: str = ""
    author: str = ""
    version: str = DEFAULT_VERSION
    entry: str = "index.html"
    tags: list[str] = field(default_factory=list)
    thumbnail: str | None = None
    remix_of: str | None = None
    capabilities: dict[str, Any] = field(default_factory=dict)
    path: Path | None = None

    @property
    def leaderboard(self) -> dict[str, Any]:
        config = self.capabilities.get("leaderboard") or {}
        return config if isinstance(config, dict) else {}

    @property
    def achievements(self) -> list[dict[str, Any]]:
        return list(self.capabilities.get("achievements") or [])

    @property
    def matchmaking(self) -> dict[str, Any] | None:
        config = self.capabilities.get("matchmaking")
        return config if isinstance(config, dict) else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
            "author": self.author,
            "version": self.version,
            "entry": self.entry,
            "tags": self.tags,
            "thumbnail": self.thumbnail,
            "remix_of": self.remix_of,
            "capabilities": self.capabilities,
        }


def _require_slug(value: Any, label: str = "slug") -> str:
    if not isinstance(value, str) or not SLUG_PATTERN.match(value):
        raise ManifestError(
            f"{label} must be lowercase letters, numbers, and dashes (got {value!r})"
        )
    return value


def _parse_achievements(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ManifestError("capabilities.achievements must be a list")
    parsed: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise ManifestError("each achievement must be a mapping")
        achievement_id = entry.get("id")
        if not isinstance(achievement_id, str) or not re.match(r"^[a-z0-9][a-z0-9_-]*$", achievement_id):
            raise ManifestError(f"invalid achievement id: {achievement_id!r}")
        if achievement_id in seen:
            raise ManifestError(f"duplicate achievement id: {achievement_id}")
        seen.add(achievement_id)
        criteria = entry.get("criteria") or {}
        if not isinstance(criteria, dict):
            raise ManifestError(f"achievement {achievement_id}: criteria must be a mapping")
        parsed.append(
            {
                "id": achievement_id,
                "title": str(entry.get("title") or achievement_id.replace("-", " ").title()),
                "description": str(entry.get("description") or ""),
                "icon": str(entry.get("icon") or "🏆"),
                "points": int(entry.get("points") or 0),
                "hidden": bool(entry.get("hidden") or False),
                "criteria": criteria,
            }
        )
    return parsed


def _parse_capabilities(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ManifestError("capabilities must be a mapping")
    capabilities: dict[str, Any] = {}

    leaderboard = raw.get("leaderboard")
    if leaderboard:
        if not isinstance(leaderboard, dict):
            raise ManifestError("capabilities.leaderboard must be a mapping")
        order = leaderboard.get("order", "desc")
        if order not in ("asc", "desc"):
            raise ManifestError("capabilities.leaderboard.order must be 'asc' or 'desc'")
        capabilities["leaderboard"] = {
            "order": order,
            "min": leaderboard.get("min"),
            "max": leaderboard.get("max"),
            "label": str(leaderboard.get("label") or "Score"),
        }

    achievements = _parse_achievements(raw.get("achievements"))
    if achievements:
        capabilities["achievements"] = achievements

    matchmaking = raw.get("matchmaking")
    if matchmaking:
        if not isinstance(matchmaking, dict):
            raise ManifestError("capabilities.matchmaking must be a mapping")
        players = int(matchmaking.get("players") or 2)
        if players < 2:
            raise ManifestError("capabilities.matchmaking.players must be at least 2")
        capabilities["matchmaking"] = {
            "players": players,
            "mode": str(matchmaking.get("mode") or "standard"),
        }

    return capabilities


def manifest_from_dict(data: dict[str, Any], *, path: Path | None = None) -> Manifest:
    """Validate a raw manifest mapping and return a :class:`Manifest`."""
    if not isinstance(data, dict):
        raise ManifestError("manifest must be a mapping")
    slug = _require_slug(data.get("slug"), "slug")
    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ManifestError("title is required")
    tags = data.get("tags") or []
    if not isinstance(tags, list):
        raise ManifestError("tags must be a list")
    entry = str(data.get("entry") or "index.html")

    return Manifest(
        slug=slug,
        title=title.strip(),
        description=str(data.get("description") or ""),
        author=str(data.get("author") or ""),
        version=str(data.get("version") or DEFAULT_VERSION),
        entry=entry,
        tags=[str(tag) for tag in tags],
        thumbnail=data.get("thumbnail"),
        remix_of=data.get("remix_of"),
        capabilities=_parse_capabilities(data.get("capabilities")),
        path=path,
    )


def read_manifest(game_dir: Path) -> Manifest:
    """Read and validate ``game.yaml`` from a game directory."""
    manifest_path = game_dir / MANIFEST_NAME
    if not manifest_path.exists():
        raise ManifestError(f"missing {MANIFEST_NAME} in {game_dir}")
    try:
        raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:  # pragma: no cover - defensive
        raise ManifestError(f"invalid YAML in {manifest_path}: {error}") from error
    manifest = manifest_from_dict(raw or {}, path=game_dir)
    if manifest.slug != game_dir.name:
        raise ManifestError(
            f"manifest slug {manifest.slug!r} does not match directory {game_dir.name!r}"
        )
    entry_path = game_dir / manifest.entry
    if not entry_path.exists():
        raise ManifestError(f"entry file not found: {manifest.entry}")
    return manifest


def write_manifest(game_dir: Path, manifest: Manifest) -> Path:
    """Serialize a manifest back to ``game.yaml`` (stable key order)."""
    game_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = game_dir / MANIFEST_NAME
    manifest_path.write_text(
        yaml.safe_dump(manifest.to_dict(), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return manifest_path


def scan_games(registry_dir: Path) -> dict[str, Manifest]:
    """Return every valid game in ``registry_dir`` keyed by slug.

    Invalid directories are skipped rather than aborting the scan so one broken
    game cannot take the whole catalog down.
    """
    games: dict[str, Manifest] = {}
    if not registry_dir.exists():
        return games
    for child in sorted(registry_dir.iterdir()):
        if not child.is_dir() or child.name in IGNORED_DIRS:
            continue
        if not (child / MANIFEST_NAME).exists():
            continue
        try:
            manifest = read_manifest(child)
        except ManifestError:
            continue
        games[manifest.slug] = manifest
    return games


def _copy_ignoring_sources(source: Path, destination: Path) -> None:
    shutil.copytree(
        source,
        destination,
        ignore=shutil.ignore_patterns(*IGNORED_DIRS, "*.pyc"),
    )


def remix_game(
    registry_dir: Path,
    parent_slug: str,
    new_slug: str,
    *,
    title: str | None = None,
    author: str = "",
) -> Manifest:
    """Copy a published game into a new editable remix.

    The remix resets to ``0.1.0`` and records ``remix_of`` so lineage stays
    visible. Raises :class:`ManifestError` when the source is missing or the
    destination already exists.
    """
    new_slug = _require_slug(new_slug, "new_slug")
    parent_dir = registry_dir / parent_slug
    if not parent_dir.is_dir():
        raise ManifestError(f"game not found: {parent_slug}")
    parent = read_manifest(parent_dir)

    destination = registry_dir / new_slug
    if destination.exists():
        raise ManifestError(f"a game named {new_slug!r} already exists")

    _copy_ignoring_sources(parent_dir, destination)
    remixed = Manifest(
        slug=new_slug,
        title=title or f"{parent.title} (Remix)",
        description=parent.description,
        author=author or parent.author,
        version=DEFAULT_VERSION,
        entry=parent.entry,
        tags=list(parent.tags),
        thumbnail=parent.thumbnail,
        remix_of=parent.slug,
        capabilities=dict(parent.capabilities),
        path=destination,
    )
    write_manifest(destination, remixed)
    return remixed


def scaffold_game(
    registry_dir: Path,
    slug: str,
    *,
    title: str,
    author: str = "",
    description: str = "",
    template_dir: Path,
) -> Manifest:
    """Create a new playable game from the blank template.

    The template lives in ``templates_scaffold/blank`` and uses ``__TOKEN__``
    placeholders so the starter game is a real, runnable Gamebase game rather
    than an empty directory.
    """
    slug = _require_slug(slug, "slug")
    destination = registry_dir / slug
    if destination.exists():
        raise ManifestError(f"a game named {slug!r} already exists")

    blank = template_dir / "blank"
    if not blank.is_dir():
        raise ManifestError(f"template directory not found: {blank}")

    destination.mkdir(parents=True)
    substitutions = {
        "__SLUG__": slug,
        "__TITLE__": title,
        "__AUTHOR__": author,
        "__DESCRIPTION__": description,
    }
    for source in blank.rglob("*"):
        if source.name in IGNORED_DIRS:
            continue
        relative = source.relative_to(blank)
        target = destination / relative
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        text = source.read_text(encoding="utf-8")
        for token, value in substitutions.items():
            text = text.replace(token, value)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    return read_manifest(destination)


def game_asset_path(registry_dir: Path, slug: str, relative: str) -> Path | None:
    """Resolve a request path inside a game, refusing traversal outside it."""
    base = (registry_dir / slug).resolve()
    if not base.is_dir():
        return None
    candidate = (base / relative).resolve()
    if candidate != base and base not in candidate.parents:
        return None
    return candidate


# ── Publishing by API/CLI ────────────────────────────────────────────────────


def _clean_relative_path(raw: str) -> PurePosixPath:
    if not isinstance(raw, str) or not raw.strip():
        raise ManifestError("file paths must be non-empty strings")
    candidate = PurePosixPath(raw.replace("\\", "/"))
    if candidate.is_absolute() or ".." in candidate.parts or candidate.parts[0] in ("", "."):
        raise ManifestError(f"unsafe file path: {raw!r}")
    if candidate.suffix.lower() not in TEXT_EXTENSIONS:
        raise ManifestError(f"unsupported file type: {raw!r}")
    return candidate


def validate_files(files: Any) -> dict[str, str]:
    """Validate a ``{path: text}`` mapping for writing into a game folder."""
    if not isinstance(files, dict) or not files:
        raise ManifestError("files must be a non-empty mapping")
    cleaned: dict[str, str] = {}
    total = 0
    for raw_path, content in files.items():
        if not isinstance(content, str):
            raise ManifestError(f"file {raw_path!r} must be text")
        path = _clean_relative_path(raw_path)
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise ManifestError(f"file {raw_path!r} exceeds {MAX_FILE_BYTES} bytes")
        total += size
        if total > MAX_TOTAL_BYTES:
            raise ManifestError(f"total upload exceeds {MAX_TOTAL_BYTES} bytes")
        cleaned[path.as_posix()] = content
    return cleaned


def save_game(registry_dir: Path, manifest: Manifest, files: dict[str, str]) -> Manifest:
    """Write a manifest and its text files to disk, then re-read to validate.

    Used by the push API and CLI. Overwrites files that already exist so a push
    is a complete publish, not an incremental patch.
    """
    cleaned = validate_files(files)
    game_dir = registry_dir / manifest.slug
    entry = cleaned.get(manifest.entry)
    if entry is None:
        raise ManifestError(f"entry file {manifest.entry!r} is required in the upload")

    game_dir.mkdir(parents=True, exist_ok=True)
    for relative, content in cleaned.items():
        target = game_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    write_manifest(game_dir, manifest)
    return read_manifest(game_dir)


def read_game_files(registry_dir: Path, slug: str) -> dict[str, str]:
    """Return every text file in a game (excluding ``game.yaml``) for pull API."""
    base = registry_dir / slug
    if not base.is_dir():
        raise ManifestError(f"game not found: {slug}")
    files: dict[str, str] = {}
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(base)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        if path.name == MANIFEST_NAME or path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        files[relative.as_posix()] = path.read_text(encoding="utf-8")
    return files
