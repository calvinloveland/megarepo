"""
Placement policies and scheduler for HomeCluster.

Evaluates YAML/JSON policy rules against the current cluster state
to make placement decisions: where to put a directory, whether to
replicate, what to migrate.

Usage:
    scheduler = PlacementScheduler(cluster_metadata)
    decision = scheduler.evaluate("/photos", size_bytes=5000000000)
    # decision = {
    #     "action": "place",
    #     "target_node": "nas",
    #     "reason": "Preferred storage HDD, sufficient free space",
    # }
"""

from __future__ import annotations

import fnmatch
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .metadata import ClusterMetadata

log = logging.getLogger("homecluster.scheduler")


@dataclass
class PlacementDecision:
    """Result of evaluating placement for a directory."""

    logical_path: str
    action: str  # "place", "replicate", "migrate", "noop", "blocked"
    target_node: str | None = None
    target_mount: str | None = None
    reason: str = ""
    replicas_needed: int = 0
    replicas_online: int = 0
    current_nodes: list[str] = field(default_factory=list)
    candidates: list[dict[str, Any]] = field(default_factory=list)


class PlacementScheduler:
    """Makes placement decisions based on policy and cluster state."""

    def __init__(self, metadata: ClusterMetadata) -> None:
        self.metadata = metadata

    # ── Main evaluation ──────────────────────────────────────────

    def evaluate(
        self,
        logical_path: str,
        size_bytes: int = 0,
        temperature: str | None = None,
    ) -> PlacementDecision:
        """Evaluate where a directory should be placed.

        Args:
            logical_path: The logical path (e.g., "/photos/vacation")
            size_bytes: Size of the directory data in bytes
            temperature: Explicit temperature class (auto if None)

        Returns:
            PlacementDecision with action and reasoning.
        """
        # 1. Get matching policies
        policies = self.metadata.match_policies(logical_path)

        # 2. Determine requirements
        preferred_storage = "any"
        target_replicas = 1
        for p in policies:
            preferred_storage = p.get("preferred_storage", preferred_storage)
            target_replicas = max(
                target_replicas, p.get("replica_count", 1)
            )

        # 3. If temperature is known, adjust storage preference
        if temperature == "hot":
            if preferred_storage == "any":
                preferred_storage = "ssd"
        elif temperature == "archive":
            if preferred_storage == "any":
                preferred_storage = "hdd"

        # 4. Get current placement
        current = self.metadata.get_placement(logical_path)
        current_nodes = [
            r["node_id"] for r in (current.get("replicas", []) if current else [])
        ]
        online_replicas = sum(
            1 for r in (current.get("replicas", []) if current else []) if r.get("online")
        )

        # 5. Find candidate nodes
        nodes = self.metadata.list_nodes()
        online_nodes = [n for n in nodes if n.get("online")]

        candidates = self._rank_candidates(
            online_nodes,
            preferred_storage=preferred_storage,
            needed_bytes=size_bytes,
            exclude_nodes=current_nodes if current_nodes else None,
        )

        # 6. Evaluate current state vs desired state
        if not current or not current.get("replicas"):
            # No placement yet — need to place
            if candidates:
                best = candidates[0]
                return PlacementDecision(
                    logical_path=logical_path,
                    action="place",
                    target_node=best["node_id"],
                    target_mount=best.get("mount"),
                    reason=(
                        f"Policy requires {target_replicas} replica(s) on "
                        f"{preferred_storage}. Best candidate: "
                        f"{best['hostname']} ({best['free_bytes'] / 1e9:.1f} GB free)"
                    ),
                    replicas_needed=target_replicas,
                    replicas_online=online_replicas,
                    current_nodes=current_nodes,
                    candidates=candidates,
                )
            return PlacementDecision(
                logical_path=logical_path,
                action="blocked",
                reason=f"No online node matching {preferred_storage} with sufficient space",
                replicas_needed=target_replicas,
                current_nodes=current_nodes,
                candidates=[],
            )

        # Already placed — also consider the placement's own replica_count
        placement_replicas = current.get("replica_count", 1) if current else 1
        effective_replicas = max(target_replicas, placement_replicas)

        # Check if we need more replicas
        if online_replicas < effective_replicas:
            # Need more replicas
            if candidates:
                best = candidates[0]
                return PlacementDecision(
                    logical_path=logical_path,
                    action="replicate",
                    target_node=best["node_id"],
                    target_mount=best.get("mount"),
                    reason=(
                        f"Have {online_replicas}/{effective_replicas} replicas online. "
                        f"Adding replica on {best['hostname']} "
                        f"({best['free_bytes'] / 1e9:.1f} GB free)"
                    ),
                    replicas_needed=effective_replicas,
                    replicas_online=online_replicas,
                    current_nodes=current_nodes,
                    candidates=candidates,
                )
            return PlacementDecision(
                logical_path=logical_path,
                action="blocked",
                reason=f"Need {effective_replicas} replicas but no candidate nodes available",
                replicas_needed=effective_replicas,
                replicas_online=online_replicas,
                current_nodes=current_nodes,
            )

        # Check if migration would be beneficial
        if candidates:
            best = candidates[0]
            if best["node_id"] not in current_nodes and preferred_storage != "any":
                return PlacementDecision(
                    logical_path=logical_path,
                    action="migrate",
                    target_node=best["node_id"],
                    target_mount=best.get("mount"),
                    reason=(
                        f"Current nodes don't include preferred storage "
                        f"{preferred_storage}. Migrating to {best['hostname']} "
                        f"({best['free_bytes'] / 1e9:.1f} GB free)"
                    ),
                    replicas_needed=effective_replicas,
                    replicas_online=online_replicas,
                    current_nodes=current_nodes,
                    candidates=candidates,
                )

        # All is well
        return PlacementDecision(
            logical_path=logical_path,
            action="noop",
            reason=f"All {effective_replicas} replica(s) online and properly placed",
            replicas_needed=effective_replicas,
            replicas_online=online_replicas,
            current_nodes=current_nodes,
            candidates=candidates,
        )

    # ── Candidate ranking ────────────────────────────────────────

    def _rank_candidates(
        self,
        nodes: list[dict[str, Any]],
        preferred_storage: str = "any",
        needed_bytes: int = 0,
        exclude_nodes: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Rank nodes by suitability for placement.

        Scoring factors:
        1. Has mount with matching storage class
        2. Sufficient free space
        3. Most free space (for load balancing)
        """
        exclude = set(exclude_nodes or [])
        candidates: list[dict[str, Any]] = []

        for node in nodes:
            if node["node_id"] in exclude:
                continue

            for mount in node.get("mounts", []):
                storage_class = mount.get("storage_class", "unknown")

                # Filter by preferred storage class
                if preferred_storage != "any" and storage_class != preferred_storage:
                    continue

                free_bytes = mount.get("free_bytes", 0)

                # Check space
                if needed_bytes > 0 and free_bytes < needed_bytes:
                    continue

                # Score: prefer more free space, prefer matching class
                score = 0
                score += free_bytes / (1024 ** 4) * 10  # TB of free space
                if storage_class == preferred_storage:
                    score += 50  # Strong preference for matching class

                candidates.append({
                    "node_id": node["node_id"],
                    "hostname": node["hostname"],
                    "mount": mount.get("mount", ""),
                    "storage_class": storage_class,
                    "free_bytes": free_bytes,
                    "capacity_bytes": mount.get("capacity_bytes", 0),
                    "score": round(score, 1),
                })

        # Sort by score descending
        candidates.sort(key=lambda c: c["score"], reverse=True)
        return candidates

    # ── Policy loading ────────────────────────────────────────────

    def load_policies_from_yaml(self, path: str | os.PathLike[str]) -> int:
        """Load placement policies from a YAML file.

        YAML format:
            rules:
              - path: "/projects/*"
                preferred_storage: SSD
                replicas: 2
              - path: "/photos/*"
                preferred_storage: HDD
                replicas: 2
              - path: "/movies/*"
                preferred_storage: HDD
                replicas: 1

        Returns number of policies loaded.
        """
        try:
            import yaml
            with open(path) as f:
                data = yaml.safe_load(f)
        except ImportError:
            # Fall back to JSON if YAML not available
            log.warning("PyYAML not available, trying JSON format")
            try:
                with open(path) as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError) as e:
                log.error("Failed to load policies: %s", e)
                return 0
        except (OSError, yaml.YAMLError) as e:
            log.error("Failed to load policies: %s", e)
            return 0

        rules = data.get("rules", []) if isinstance(data, dict) else []
        count = 0
        for i, rule in enumerate(rules):
            path_pattern = rule.get("path", rule.get("pattern", ""))
            if not path_pattern:
                continue
            preferred = rule.get("preferred_storage", rule.get("preferred_storage", "any")).lower()
            replicas = int(rule.get("replicas", rule.get("replica_count", 1)))
            self.metadata.add_policy(
                path_pattern=path_pattern,
                preferred_storage=preferred,
                replica_count=replicas,
                priority=len(rules) - i,
            )
            count += 1

        log.info("Loaded %d placement policies from %s", count, path)
        return count

    # ── Batch evaluation ──────────────────────────────────────────

    def evaluate_all(self) -> list[PlacementDecision]:
        """Evaluate placement for all tracked directories."""
        placements = self.metadata.list_placements()
        decisions: list[PlacementDecision] = []

        for p in placements:
            decision = self.evaluate(
                p["logical_path"],
                temperature=p.get("temperature"),
            )
            decisions.append(decision)

        return decisions

    # ── Decision summary ──────────────────────────────────────────

    def summary(self, decisions: list[PlacementDecision]) -> dict[str, Any]:
        """Summarize a set of placement decisions."""
        by_action: dict[str, int] = {}
        for d in decisions:
            by_action[d.action] = by_action.get(d.action, 0) + 1

        return {
            "total_decisions": len(decisions),
            "by_action": by_action,
            "needs_attention": [d for d in decisions if d.action in ("blocked", "migrate", "replicate")],
        }
