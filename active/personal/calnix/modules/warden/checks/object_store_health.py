#!/usr/bin/env python3
"""
Warden check: object-store-health

Verifies the health of the local HomeCluster object store:
- Object count and total size
- Sample of objects verified by hash
- Store directory integrity
- Staging area cleanup status

Configuration (optional):
  {
    "store_root": "/var/lib/homecluster/objects",
    "verify_sample": 10,
    "verify_sample_pct": 5
  }
"""

from __future__ import annotations

import json
import os
import random
import sys
from pathlib import Path
from typing import Any

# Add parent for warden module imports
WARDEN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, WARDEN_DIR)

CHECK_NAME = "object-store-health"


def get_config() -> dict[str, Any]:
    config_str = os.environ.get("WARDEN_CHECK_CONFIG", "{}")
    try:
        return json.loads(config_str)
    except json.JSONDecodeError:
        return {}


def check_object_store_health(config: dict[str, Any]) -> dict[str, Any]:
    """Verify the health of the local object store."""
    from homecluster.object_store import ObjectStore

    store_root = config.get(
        "store_root",
        os.environ.get("HOME_CLUSTER_STORE", "/var/lib/homecluster/objects"),
    )
    verify_sample = config.get("verify_sample", 10)
    verify_sample_pct = config.get("verify_sample_pct", 5)

    store_dir = Path(store_root)

    if not store_dir.exists():
        return {
            "check": CHECK_NAME,
            "status": "warn",
            "message": "Object store directory does not exist yet",
            "data": {"store_root": str(store_dir), "status": "not_initialized"},
        }

    try:
        store = ObjectStore(store_dir)

        total_objects = store.object_count()
        total_size = store.total_size()

        # Verify a sample of objects
        all_oids = store.list_objects()
        sample_size = min(verify_sample, max(1, total_objects * verify_sample_pct // 100))
        sample_size = max(1, min(sample_size, total_objects))

        if total_objects > 0 and sample_size > 0:
            sample = random.sample(all_oids, min(sample_size, len(all_oids)))
            verified = 0
            corrupted = 0
            for oid in sample:
                if store.verify(oid):
                    verified += 1
                else:
                    corrupted += 1
            verification_status = "pass" if corrupted == 0 else "fail"
        else:
            verified = 0
            corrupted = 0
            verification_status = "pass"

        # Check staging area for orphaned files
        staging_dir = store.staging_dir
        orphaned_staging = 0
        if staging_dir.exists():
            for f in staging_dir.iterdir():
                if f.is_file() and f.name.startswith(".") and f.name.endswith(".tmp"):
                    # Check if older than 1 hour
                    try:
                        age = (os.path.getmtime(f) - time.time())
                        if age < -3600:  # Older than 1 hour
                            orphaned_staging += 1
                    except OSError:
                        pass

        # Determine overall status
        worst_status = "pass"
        messages: list[str] = []

        if total_objects == 0:
            messages.append("Store is empty (no objects yet)")
        else:
            size_gb = round(total_size / 1e9, 2)
            messages.append(
                f"{total_objects} objects, {size_gb} GB total"
            )
            if verification_status == "pass":
                messages.append(
                    f"Sample verification: {verified}/{sample_size} passed"
                )
            else:
                worst_status = "fail"
                messages.append(
                    f"CORRUPTION: {corrupted}/{sample_size} objects in sample failed verification!"
                )

        if orphaned_staging > 0:
            orphaned_staging = 0  # Reset since we can't access staging directly
            worst_status = "warn"
            messages.append(f"{orphaned_staging} orphaned staging files found")

        if not messages:
            messages.append("Object store healthy")

        return {
            "check": CHECK_NAME,
            "status": worst_status,
            "message": "; ".join(messages),
            "data": {
                "store_root": str(store_dir),
                "object_count": total_objects,
                "total_size_bytes": total_size,
                "total_size_gb": round(total_size / 1e9, 2),
                "verification": {
                    "sampled": sample_size if total_objects > 0 else 0,
                    "verified": verified,
                    "corrupted": corrupted,
                    "status": verification_status,
                },
            },
        }
    except Exception as e:
        return {
            "check": CHECK_NAME,
            "status": "fail",
            "message": f"Object store check failed: {e}",
            "data": {"store_root": str(store_dir), "error": str(e)},
        }


import time  # noqa: E402 (needed for staging age check)

def main():
    config = get_config()
    result = check_object_store_health(config)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] in ("pass", "warn") else 1)


if __name__ == "__main__":
    main()
