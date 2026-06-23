"""
HomeCluster — distributed storage integration for Warden.

Provides content-addressed object storage, storage class awareness,
cluster metadata management, placement policies, and a pooled storage view
across all nodes in the Warden fleet.
"""

from __future__ import annotations

from .storage_class import classify_storage, StorageClass, StorageMount
from .object_store import ObjectStore, ObjectStoreError, ObjectMetadata
from .metadata import ClusterMetadata, DirectoryPlacement, NodeStorage

__all__ = [
    "StorageClass",
    "StorageMount",
    "classify_storage",
    "ObjectStore",
    "ObjectStoreError",
    "ObjectMetadata",
    "ClusterMetadata",
    "DirectoryPlacement",
    "NodeStorage",
]
