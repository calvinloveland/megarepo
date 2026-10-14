"""Data-access functions for Gamebase.

Every function takes an explicit ``sqlite3.Connection`` so the module stays
easy to test and free of hidden global state. Timestamps are stored as
UTC ISO-8601 strings, which sort correctly as text.
"""

from __future__ import annotations

import gzip
import json
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import registry
from .registry import Manifest

# Handle generation vocabulary. Kept small and pronounceable.
_ADJECTIVES = (
    "swift", "neon", "cosmic", "lucky", "turbo", "pixel", "mint", "wild",
    "quiet", "brave", "retro", "amber", "vivid", "noble", "brisk", "sunny",
)
_NOUNS = (
    "otter", "comet", "rover", "ninja", "pilot", "goblin", "panda", "falcon",
    "wizard", "mecha", "drifter", "ember", "lynx", "raven", "knight", "sprout",
)


class RateLimited(Exception):
    """Raised when a player submits scores faster than the platform allows."""

    def __init__(self, message: str, retry_after: float = 0.0):
        super().__init__(message)
        self.retry_after = max(0.0, retry_after)


class NotFound(Exception):
    """Raised when a referenced game, player, ticket, or match is missing."""


class Conflict(Exception):
    """Raised when an optimistic-concurrency revision does not match."""

    def __init__(self, current_revision: int):
        super().__init__("state revision conflict")
        self.current_revision = current_revision


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _loads(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


# ── Identity ────────────────────────────────────────────────────────────────


def _generate_handle(conn) -> str:
    for _ in range(64):
        candidate = f"{secrets.choice(_ADJECTIVES)}-{secrets.choice(_NOUNS)}-{secrets.randbelow(900) + 100}"
        exists = conn.execute("SELECT 1 FROM players WHERE handle = ?", (candidate,)).fetchone()
        if not exists:
            return candidate
    return f"player-{_new_id()[:8]}"  # pragma: no cover - astronomically unlikely


def format_recovery_code(secret: str) -> str:
    upper = secret.upper()
    return "-".join(upper[index : index + 4] for index in range(0, len(upper), 4))


def normalize_recovery_code(code: str) -> str:
    return "".join(character for character in str(code or "").lower() if character.isalnum())


def create_player(conn, handle: str | None = None, *, is_guest: bool = True) -> dict[str, Any]:
    """Create a player and an API session token.

    Returns ``{"player": ..., "token": ..., "recovery_code": ...}``. If
    ``handle`` is provided it must be unique; otherwise a readable handle is
    generated. The recovery code lets the same player sign in on another device.
    """
    timestamp = utcnow()
    if handle:
        clean = handle.strip()
        taken = conn.execute("SELECT 1 FROM players WHERE handle = ?", (clean,)).fetchone()
        if taken:
            raise ValueError(f"handle already taken: {clean}")
    else:
        clean = _generate_handle(conn)

    player_id = _new_id()
    recovery_secret = secrets.token_hex(6)
    conn.execute(
        "INSERT INTO players (id, handle, is_guest, recovery_secret, created_at, last_seen) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (player_id, clean, int(is_guest), recovery_secret, timestamp, timestamp),
    )
    token = create_session(conn, player_id)
    conn.commit()
    return {
        "player": get_player(conn, player_id),
        "token": token,
        "recovery_code": format_recovery_code(recovery_secret),
    }


def get_recovery_code(conn, player_id: str) -> str:
    row = conn.execute("SELECT recovery_secret FROM players WHERE id = ?", (player_id,)).fetchone()
    secret = row["recovery_secret"] if row else None
    if not secret:
        # Players created before recovery codes existed get one lazily.
        secret = secrets.token_hex(6)
        conn.execute("UPDATE players SET recovery_secret = ? WHERE id = ?", (secret, player_id))
        conn.commit()
    return format_recovery_code(secret)


def player_for_recovery(conn, code: str) -> dict[str, Any] | None:
    secret = normalize_recovery_code(code)
    if not secret:
        return None
    row = conn.execute("SELECT * FROM players WHERE recovery_secret = ?", (secret,)).fetchone()
    return dict(row) if row else None


def create_session(conn, player_id: str) -> str:
    token = secrets.token_urlsafe(24)
    timestamp = utcnow()
    conn.execute(
        "INSERT INTO sessions (token, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)",
        (token, player_id, timestamp, timestamp),
    )
    conn.commit()
    return token


def player_for_token(conn, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    row = conn.execute(
        "SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?",
        (token,),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE sessions SET last_seen = ? WHERE token = ?", (utcnow(), token))
    conn.execute("UPDATE players SET last_seen = ? WHERE id = ?", (utcnow(), row["id"]))
    conn.commit()
    return dict(row)


def get_player(conn, player_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
    return dict(row) if row else None


def get_player_by_handle(conn, handle: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM players WHERE handle = ?", (handle,)).fetchone()
    return dict(row) if row else None


# ── Catalog sync ────────────────────────────────────────────────────────────


def sync_registry(conn, registry_dir: Path) -> dict[str, Manifest]:
    """Mirror every manifest in ``registry_dir`` into the database.

    Returns the scanned manifests so callers can avoid a second disk read.
    Existing rows keep their ``created_at``; titles and capabilities refresh.
    """
    manifests = registry.scan_games(registry_dir)
    timestamp = utcnow()
    for manifest in manifests.values():
        conn.execute(
            """
            INSERT INTO games (slug, title, description, author, current_version, entry,
                               tags, thumbnail, remix_of, capabilities, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                author = excluded.author,
                current_version = excluded.current_version,
                entry = excluded.entry,
                tags = excluded.tags,
                thumbnail = excluded.thumbnail,
                remix_of = excluded.remix_of,
                capabilities = excluded.capabilities,
                updated_at = excluded.updated_at
            """,
            (
                manifest.slug,
                manifest.title,
                manifest.description,
                manifest.author,
                manifest.version,
                manifest.entry,
                _dumps(manifest.tags),
                manifest.thumbnail,
                manifest.remix_of,
                _dumps(manifest.capabilities),
                timestamp,
                timestamp,
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO game_versions (slug, version, changelog, manifest, published_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (manifest.slug, manifest.version, "Initial publish", _dumps(manifest.to_dict()), timestamp),
        )
        _sync_achievements(conn, manifest)
    conn.commit()
    return manifests


def _sync_achievements(conn, manifest: Manifest) -> None:
    for achievement in manifest.achievements:
        conn.execute(
            """
            INSERT INTO achievements (slug, achievement_id, title, description, icon, points, hidden, criteria)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug, achievement_id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                icon = excluded.icon,
                points = excluded.points,
                hidden = excluded.hidden,
                criteria = excluded.criteria
            """,
            (
                manifest.slug,
                achievement["id"],
                achievement["title"],
                achievement["description"],
                achievement["icon"],
                achievement["points"],
                int(achievement["hidden"]),
                _dumps(achievement["criteria"]),
            ),
        )


def _game_row_to_dict(row) -> dict[str, Any]:
    game = dict(row)
    game["tags"] = _loads(game.get("tags")) or []
    game["capabilities"] = _loads(game.get("capabilities")) or {}
    return game


def list_games(conn) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM games ORDER BY title COLLATE NOCASE").fetchall()
    return [_game_row_to_dict(row) for row in rows]


def get_game(conn, slug: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM games WHERE slug = ?", (slug,)).fetchone()
    return _game_row_to_dict(row) if row else None


def list_versions(conn, slug: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT version, changelog, published_at FROM game_versions WHERE slug = ? ORDER BY id DESC",
        (slug,),
    ).fetchall()
    return [dict(row) for row in rows]


def record_version(conn, manifest: Manifest, changelog: str) -> None:
    """Record (or refresh) a published version for a game."""
    conn.execute(
        """
        INSERT INTO game_versions (slug, version, changelog, manifest, published_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(slug, version) DO UPDATE SET
            changelog = excluded.changelog,
            manifest = excluded.manifest,
            published_at = excluded.published_at
        """,
        (manifest.slug, manifest.version, changelog, _dumps(manifest.to_dict()), utcnow()),
    )
    conn.commit()


def record_remix(conn, parent_slug: str, child_slug: str, player_id: str | None) -> None:
    conn.execute(
        "INSERT INTO remixes (parent_slug, child_slug, player_id, created_at) VALUES (?, ?, ?, ?)",
        (parent_slug, child_slug, player_id, utcnow()),
    )
    conn.commit()


def remix_lineage(conn, slug: str) -> list[str]:
    """Return the ancestor chain, oldest first (excludes ``slug`` itself)."""
    lineage: list[str] = []
    current = slug
    guard = 0
    while current and guard < 64:
        guard += 1
        row = conn.execute("SELECT remix_of FROM games WHERE slug = ?", (current,)).fetchone()
        parent = row["remix_of"] if row else None
        if not parent:
            break
        lineage.append(parent)
        current = parent
    lineage.reverse()
    return lineage


# ── Scores and leaderboards ─────────────────────────────────────────────────


def _leaderboard_order(config: dict[str, Any]) -> str:
    return "ASC" if config.get("order") == "asc" else "DESC"


def leaderboard(
    conn, slug: str, limit: int = 10, *, order: str = "desc", viewer_id: str | None = None
) -> list[dict[str, Any]]:
    """Best score per player, ranked. Ties break toward the earlier submission.

    When ``viewer_id`` is given, each row carries ``is_me`` so clients can find
    the current player without scanning the whole board.
    """
    direction = "ASC" if order == "asc" else "DESC"
    rows = conn.execute(
        f"""
        SELECT handle, player_id, score, meta, created_at FROM (
            SELECT s.player_id, p.handle, s.score, s.meta, s.created_at,
                   ROW_NUMBER() OVER (
                       PARTITION BY s.player_id
                       ORDER BY s.score {direction}, s.created_at ASC
                   ) AS rank_in_player
            FROM scores s JOIN players p ON p.id = s.player_id
            WHERE s.slug = ?
        )
        WHERE rank_in_player = 1
        ORDER BY score {direction}, created_at ASC
        LIMIT ?
        """,
        (slug, limit),
    ).fetchall()
    return [
        {
            "rank": index + 1,
            "handle": row["handle"],
            "player_id": row["player_id"],
            "score": row["score"],
            "meta": _loads(row["meta"]) or {},
            "created_at": row["created_at"],
            "is_me": viewer_id is not None and row["player_id"] == viewer_id,
        }
        for index, row in enumerate(rows)
    ]


def best_score(conn, slug: str, player_id: str, *, order: str = "desc") -> float | None:
    aggregate = "MIN" if order == "asc" else "MAX"
    row = conn.execute(
        f"SELECT {aggregate}(score) AS best FROM scores WHERE slug = ? AND player_id = ?",
        (slug, player_id),
    ).fetchone()
    return row["best"] if row and row["best"] is not None else None


def player_rank(conn, slug: str, player_id: str, *, order: str = "desc") -> int | None:
    entry = player_best_entry(conn, slug, player_id, order=order)
    return entry["rank"] if entry else None


def player_best_entry(
    conn, slug: str, player_id: str, *, order: str = "desc"
) -> dict[str, Any] | None:
    """Return a player's best leaderboard entry (including rank), or ``None``.

    Unlike :func:`best_score` this also resolves the player's rank, which is what
    an in-game HUD needs. It scans the full board, so it stays correct even when
    the player is outside the requested top-N.
    """
    board = leaderboard(conn, slug, limit=100_000, order=order, viewer_id=player_id)
    for entry in board:
        if entry["player_id"] == player_id:
            return entry
    return None


def _validate_score(score: Any, config: dict[str, Any]) -> float:
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        raise ValueError("score must be a number")
    value = float(score)
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError("score must be finite")
    minimum, maximum = config.get("min"), config.get("max")
    if minimum is not None and value < float(minimum):
        raise ValueError(f"score below minimum ({minimum})")
    if maximum is not None and value > float(maximum):
        raise ValueError(f"score above maximum ({maximum})")
    return value


def submit_score(
    conn,
    game: dict[str, Any],
    player_id: str,
    score: Any,
    meta: dict[str, Any] | None = None,
    *,
    rate_limit_seconds: float = 0.0,
) -> dict[str, Any]:
    """Record a score, evaluate score-based achievements, and rank it.

    Raises :class:`RateLimited` when submissions are too frequent and
    ``ValueError`` when the score fails manifest validation.
    """
    slug = game["slug"]
    config = (game.get("capabilities") or {}).get("leaderboard") or {}
    value = _validate_score(score, config)

    if rate_limit_seconds > 0:
        recent = conn.execute(
            "SELECT created_at FROM scores WHERE slug = ? AND player_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (slug, player_id),
        ).fetchone()
        if recent:
            elapsed = (datetime.now(timezone.utc) - _parse_timestamp(recent["created_at"])).total_seconds()
            if elapsed < rate_limit_seconds:
                raise RateLimited(
                    f"score submitted within the last {rate_limit_seconds:g}s",
                    retry_after=rate_limit_seconds - elapsed,
                )

    order = _leaderboard_order(config)
    previous_best = best_score(conn, slug, player_id, order=order)
    created_at = utcnow()
    conn.execute(
        "INSERT INTO scores (slug, player_id, score, meta, created_at) VALUES (?, ?, ?, ?, ?)",
        (slug, player_id, value, _dumps(meta or {}), created_at),
    )
    conn.commit()

    unlocked = _evaluate_score_achievements(conn, slug, player_id, value, meta or {})
    is_personal_best = previous_best is None or (
        value < previous_best if order == "asc" else value > previous_best
    )
    return {
        "score": value,
        "previous_best": previous_best,
        "is_personal_best": is_personal_best,
        "rank": player_rank(conn, slug, player_id, order=order),
        "unlocked": unlocked,
    }


# ── Achievements ────────────────────────────────────────────────────────────


def list_achievements(conn, slug: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT achievement_id, title, description, icon, points, hidden, criteria "
        "FROM achievements WHERE slug = ? ORDER BY id",
        (slug,),
    ).fetchall()
    return [
        {
            "id": row["achievement_id"],
            "title": row["title"],
            "description": row["description"],
            "icon": row["icon"],
            "points": row["points"],
            "hidden": bool(row["hidden"]),
            "criteria": _loads(row["criteria"]) or {},
        }
        for row in rows
    ]


def unlocked_achievement_ids(conn, player_id: str, slug: str) -> set[str]:
    rows = conn.execute(
        "SELECT achievement_id FROM player_achievements WHERE player_id = ? AND slug = ?",
        (player_id, slug),
    ).fetchall()
    return {row["achievement_id"] for row in rows}


def unlock_achievement(conn, slug: str, player_id: str, achievement_id: str) -> dict[str, Any] | None:
    """Idempotently unlock an achievement. Returns the definition if newly unlocked."""
    definition = conn.execute(
        "SELECT achievement_id, title, description, icon, points FROM achievements "
        "WHERE slug = ? AND achievement_id = ?",
        (slug, achievement_id),
    ).fetchone()
    if definition is None:
        raise NotFound(f"unknown achievement: {achievement_id}")
    cursor = conn.execute(
        "INSERT OR IGNORE INTO player_achievements (player_id, slug, achievement_id, unlocked_at) "
        "VALUES (?, ?, ?, ?)",
        (player_id, slug, achievement_id, utcnow()),
    )
    conn.commit()
    if cursor.rowcount == 0:
        return None
    return {
        "id": definition["achievement_id"],
        "title": definition["title"],
        "description": definition["description"],
        "icon": definition["icon"],
        "points": definition["points"],
    }


def _criteria_satisfied(
    criteria: dict[str, Any],
    score: float,
    submission_count: int,
    meta: dict[str, Any],
    distinct_counts: dict[str, int] | None = None,
) -> bool:
    """Evaluate one achievement's server-side criteria against a submission.

    Supported ``type`` values:
    - ``score``: ``gte``/``lte`` against the submitted score.
    - ``count``: ``gte`` against this player's submission count for the game.
    - ``meta``: ``gte``/``lte``/``eq`` against a key in the submitted ``meta``.
    - ``distinct``: ``gte`` distinct values of ``meta[key]`` across the player's
      submissions — not farmable by resubmitting the same progress.
    """
    kind = criteria.get("type")
    if kind == "score":
        if "gte" in criteria:
            return score >= float(criteria["gte"])
        if "lte" in criteria:
            return score <= float(criteria["lte"])
        return False
    if kind == "count":
        return submission_count >= int(criteria.get("gte", 1))
    if kind == "distinct":
        key = criteria.get("key")
        if not isinstance(key, str):
            return False
        counts = distinct_counts or {}
        return counts.get(key, 0) >= int(criteria.get("gte", 1))
    if kind == "meta":
        key = criteria.get("key")
        if not isinstance(key, str) or key not in meta:
            return False
        actual = meta[key]
        if "eq" in criteria:
            return actual == criteria["eq"]
        try:
            value = float(actual)
        except (TypeError, ValueError):
            return False
        if "gte" in criteria and value < float(criteria["gte"]):
            return False
        if "lte" in criteria and value > float(criteria["lte"]):
            return False
        return "gte" in criteria or "lte" in criteria
    return False


def _distinct_criteria_keys(definitions: list[dict[str, Any]]) -> set[str]:
    return {
        definition["criteria"]["key"]
        for definition in definitions
        if (definition.get("criteria") or {}).get("type") == "distinct"
        and isinstance((definition.get("criteria") or {}).get("key"), str)
    }


def _distinct_meta_counts(
    conn, slug: str, player_id: str, keys: set[str]
) -> dict[str, int]:
    if not keys:
        return {}
    seen = {key: set() for key in keys}
    rows = conn.execute(
        "SELECT meta FROM scores WHERE slug = ? AND player_id = ?", (slug, player_id)
    ).fetchall()
    for row in rows:
        record = _loads(row["meta"]) or {}
        for key in keys:
            if key in record:
                seen[key].add(str(record[key]))
    return {key: len(values) for key, values in seen.items()}


def _submission_count(conn, slug: str, player_id: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) AS n FROM scores WHERE slug = ? AND player_id = ?", (slug, player_id)
    ).fetchone()["n"]


def _evaluate_score_achievements(
    conn, slug: str, player_id: str, score: float, meta: dict[str, Any]
) -> list[dict[str, Any]]:
    """Unlock any score/count/meta/distinct achievements the submission satisfies."""
    already = unlocked_achievement_ids(conn, player_id, slug)
    definitions = list_achievements(conn, slug)
    distinct_counts = _distinct_meta_counts(
        conn, slug, player_id, _distinct_criteria_keys(definitions)
    )
    submission_count = _submission_count(conn, slug, player_id)
    newly: list[dict[str, Any]] = []
    for achievement in definitions:
        if achievement["id"] in already:
            continue
        criteria = achievement["criteria"] or {}
        if _criteria_satisfied(criteria, score, submission_count, meta, distinct_counts):
            unlocked = unlock_achievement(conn, slug, player_id, achievement["id"])
            if unlocked:
                newly.append(unlocked)
    return newly


def evaluate_progress_achievements(
    conn, slug: str, player_id: str, meta: dict[str, Any]
) -> list[dict[str, Any]]:
    """Unlock ``meta``/``distinct`` achievements from a scoreless checkpoint.

    This backs the ``progress`` hook so continuous games can announce a
    milestone without inventing a score.
    """
    already = unlocked_achievement_ids(conn, player_id, slug)
    definitions = list_achievements(conn, slug)
    distinct_counts = _distinct_meta_counts(
        conn, slug, player_id, _distinct_criteria_keys(definitions)
    )
    submission_count = _submission_count(conn, slug, player_id)
    newly: list[dict[str, Any]] = []
    for achievement in definitions:
        if achievement["id"] in already:
            continue
        criteria = achievement["criteria"] or {}
        if criteria.get("type") not in ("meta", "distinct"):
            continue
        if _criteria_satisfied(criteria, 0.0, submission_count, meta, distinct_counts):
            unlocked = unlock_achievement(conn, slug, player_id, achievement["id"])
            if unlocked:
                newly.append(unlocked)
    return newly


def unlock_achievements(
    conn, slug: str, player_id: str, achievement_ids: list[str]
) -> dict[str, list]:
    """Unlock several achievements at once, returning newly and already unlocked."""
    newly: list[dict[str, Any]] = []
    already: list[str] = []
    for achievement_id in achievement_ids:
        unlocked = unlock_achievement(conn, slug, player_id, achievement_id)
        if unlocked:
            newly.append(unlocked)
        else:
            already.append(achievement_id)
    return {"unlocked": newly, "already_unlocked": already}


def player_achievements(conn, player_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT pa.slug, pa.achievement_id, pa.unlocked_at,
               a.title, a.description, a.icon, a.points, g.title AS game_title
        FROM player_achievements pa
        LEFT JOIN achievements a ON a.slug = pa.slug AND a.achievement_id = pa.achievement_id
        LEFT JOIN games g ON g.slug = pa.slug
        WHERE pa.player_id = ?
        ORDER BY pa.unlocked_at DESC
        """,
        (player_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def achievement_points(conn, player_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(COALESCE(a.points, 0)), 0) AS points "
        "FROM player_achievements pa "
        "LEFT JOIN achievements a ON a.slug = pa.slug AND a.achievement_id = pa.achievement_id "
        "WHERE pa.player_id = ?",
        (player_id,),
    ).fetchone()
    return int(row["points"]) if row else 0


# ── Player state (save games) ────────────────────────────────────────────────


def get_state(conn, player_id: str, slug: str) -> dict[str, Any] | None:
    """Return a player's opaque save blob for a game, or ``None``."""
    row = conn.execute(
        "SELECT revision, schema_version, data, raw_bytes, updated_at FROM player_states "
        "WHERE player_id = ? AND slug = ?",
        (player_id, slug),
    ).fetchone()
    if row is None:
        return None
    raw = gzip.decompress(row["data"]).decode("utf-8")
    return {
        "state": json.loads(raw),
        "revision": row["revision"],
        "schema_version": row["schema_version"],
        "size": row["raw_bytes"],
        "updated_at": row["updated_at"],
    }


def save_state(
    conn,
    player_id: str,
    slug: str,
    state: Any,
    *,
    revision: int | None = None,
    schema_version: int = 1,
    max_bytes: int,
) -> dict[str, Any]:
    """Persist a save blob, compressing at rest and enforcing optimistic locking.

    ``revision`` is the revision the client last read. A mismatch raises
    :class:`Conflict` so two tabs cannot silently clobber each other.
    """
    payload = json.dumps(state, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > max_bytes:
        raise ValueError(f"state is {len(payload)} bytes, over the {max_bytes} byte limit")
    current = conn.execute(
        "SELECT revision FROM player_states WHERE player_id = ? AND slug = ?", (player_id, slug)
    ).fetchone()
    current_revision = current["revision"] if current else 0
    if revision is not None and int(revision) != current_revision:
        raise Conflict(current_revision)
    new_revision = current_revision + 1
    conn.execute(
        """
        INSERT INTO player_states (player_id, slug, revision, schema_version, data, raw_bytes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, slug) DO UPDATE SET
            revision = excluded.revision,
            schema_version = excluded.schema_version,
            data = excluded.data,
            raw_bytes = excluded.raw_bytes,
            updated_at = excluded.updated_at
        """,
        (player_id, slug, new_revision, schema_version, gzip.compress(payload), len(payload), utcnow()),
    )
    conn.commit()
    return {
        "revision": new_revision,
        "schema_version": schema_version,
        "size": len(payload),
        "max_bytes": max_bytes,
        "remaining": max(0, max_bytes - len(payload)),
    }


def delete_state(conn, player_id: str, slug: str) -> bool:
    cursor = conn.execute(
        "DELETE FROM player_states WHERE player_id = ? AND slug = ?", (player_id, slug)
    )
    conn.commit()
    return cursor.rowcount > 0


# ── Matchmaking ─────────────────────────────────────────────────────────────


def _ticket_to_dict(conn, row) -> dict[str, Any]:
    ticket = dict(row)
    if ticket.get("match_id"):
        ticket["match"] = get_match(conn, ticket["match_id"])
    return ticket


def open_ticket(conn, slug: str, player_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM tickets WHERE slug = ? AND player_id = ? AND status IN ('queued', 'matched') "
        "ORDER BY created_at DESC LIMIT 1",
        (slug, player_id),
    ).fetchone()
    return _ticket_to_dict(conn, row) if row else None


def queue_for_match(conn, slug: str, player_id: str, players_needed: int = 2) -> dict[str, Any]:
    """Join the matchmaking queue, forming a match when enough players wait."""
    existing = open_ticket(conn, slug, player_id)
    if existing:
        return existing

    ticket_id = _new_id()
    conn.execute(
        "INSERT INTO tickets (id, slug, player_id, status, created_at) VALUES (?, ?, ?, 'queued', ?)",
        (ticket_id, slug, player_id, utcnow()),
    )
    conn.commit()
    _try_form_match(conn, slug, players_needed)
    row = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    return _ticket_to_dict(conn, row)


def _try_form_match(conn, slug: str, players_needed: int) -> dict[str, Any] | None:
    waiting = conn.execute(
        "SELECT * FROM tickets WHERE slug = ? AND status = 'queued' ORDER BY created_at ASC",
        (slug,),
    ).fetchall()
    if len(waiting) < players_needed:
        return None

    chosen = waiting[:players_needed]
    match_id = _new_id()
    timestamp = utcnow()
    players = []
    for ticket in chosen:
        player = get_player(conn, ticket["player_id"])
        players.append({"player_id": ticket["player_id"], "handle": player["handle"] if player else "unknown"})
    conn.execute(
        "INSERT INTO matches (id, slug, state, players, result, created_at, updated_at) "
        "VALUES (?, ?, 'active', ?, '{}', ?, ?)",
        (match_id, slug, _dumps(players), timestamp, timestamp),
    )
    for ticket in chosen:
        conn.execute(
            "UPDATE tickets SET status = 'matched', match_id = ?, matched_at = ? WHERE id = ?",
            (match_id, timestamp, ticket["id"]),
        )
    conn.commit()
    return get_match(conn, match_id)


def cancel_ticket(conn, slug: str, player_id: str) -> bool:
    cursor = conn.execute(
        "UPDATE tickets SET status = 'cancelled' "
        "WHERE slug = ? AND player_id = ? AND status = 'queued'",
        (slug, player_id),
    )
    conn.commit()
    return cursor.rowcount > 0


def get_match(conn, match_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM matches WHERE id = ?", (match_id,)).fetchone()
    if row is None:
        return None
    match = dict(row)
    match["players"] = _loads(match.get("players")) or []
    match["result"] = _loads(match.get("result")) or {}
    return match


def report_match_result(conn, match_id: str, player_id: str, result: dict[str, Any]) -> dict[str, Any]:
    match = get_match(conn, match_id)
    if match is None:
        raise NotFound(f"unknown match: {match_id}")
    if player_id not in {player["player_id"] for player in match["players"]}:
        raise PermissionError("player is not part of this match")
    results = dict(match["result"])
    results[player_id] = result
    state = "completed" if len(results) >= len(match["players"]) else match["state"]
    conn.execute(
        "UPDATE matches SET result = ?, state = ?, updated_at = ? WHERE id = ?",
        (_dumps(results), state, utcnow(), match_id),
    )
    conn.execute(
        "UPDATE tickets SET status = 'completed' WHERE match_id = ?",
        (match_id,),
    )
    conn.commit()
    return get_match(conn, match_id) or {}
