"""
Storage class detection for HomeCluster.

Classifies mounted filesystems by performance tier:
- SSD: Solid-state drives (NVMe, SATA SSD)
- HDD: Spinning hard drives
- ARCHIVE: Slow archival storage (optical, tape, cold HDD)

Detection uses:
1. sysfs rotational flag (/sys/block/<device>/queue/rotational)
2. Device name patterns (nvme*, mmcblk* → SSD; sd* → check rotational)
3. Explicit user overrides in config

Usage:
    from homecluster.storage_class import classify_storage, StorageClass

    mounts = classify_storage()
    for m in mounts:
        print(f"{m.mount}: {m.storage_class.value} ({m.capacity_bytes} bytes)")
"""

from __future__ import annotations

import enum
import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class StorageClass(str, enum.Enum):
    """Performance tier for a storage mount."""

    SSD = "ssd"
    HDD = "hdd"
    ARCHIVE = "archive"
    UNKNOWN = "unknown"


# Device name heuristics: certain patterns are always SSD
SSD_DEVICE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"nvme\d+n\d+$"),       # NVMe
    re.compile(r"mmcblk\d+$"),         # eMMC / SD
    re.compile(r"r?zram\d*$"),         # (z)RAM
    re.compile(r"loop\d+$"),           # Loop devices (usually backed by SSD)
    re.compile(r"dm-\d+$"),            # Device-mapper (check rotational of underlying)
]

# Filesystem types that are always archive-class
ARCHIVE_FS_TYPES: set[str] = {
    "iso9660", "udf",     # Optical media
    "zfs",                 # ZFS can be anything, but we check rotational
}

# Mounts to skip (pseudo-filesystems or non-physical)
SKIP_MOUNTS: set[str] = {
    "/proc", "/sys", "/dev", "/run", "/tmp",
    "/etc", "/nix/store", "/nix/var",
}

# Filesystem types to skip
SKIP_FS_TYPES: set[str] = {
    "proc", "sysfs", "tmpfs", "devtmpfs", "devpts",
    "cgroup", "cgroup2", "pstore", "securityfs",
    "hugetlbfs", "mqueue", "debugfs", "tracefs",
    "configfs", "fusectl", "efivarfs", "bpf",
    "autofs", "overlay",
}


@dataclass
class StorageMount:
    """A single mount point with storage class classification."""

    mount: str
    filesystem: str
    device: str
    capacity_bytes: int = 0
    used_bytes: int = 0
    free_bytes: int = 0
    storage_class: StorageClass = StorageClass.UNKNOWN
    rotational: bool | None = None  # True=HDD, False=SSD, None=unknown
    label: str | None = None  # Optional filesystem label or user-defined tag


def _get_block_devices() -> dict[str, dict[str, Any]]:
    """Query sysfs for block device properties.

    Returns dict mapping device name (e.g., 'sda', 'nvme0n1') to
    properties like rotational, size, etc.
    """
    devices: dict[str, dict[str, Any]] = {}
    sys_block = Path("/sys/block")

    if not sys_block.exists():
        return devices

    for dev_dir in sys_block.iterdir():
        if not dev_dir.is_dir():
            continue
        dev_name = dev_dir.name

        props: dict[str, Any] = {"name": dev_name}

        # Rotational flag
        rotational_file = dev_dir / "queue" / "rotational"
        if rotational_file.exists():
            try:
                props["rotational"] = rotational_file.read_text().strip() == "1"
            except OSError:
                props["rotational"] = None
        else:
            props["rotational"] = None

        # Device size (in sectors, 512 bytes each)
        size_file = dev_dir / "size"
        if size_file.exists():
            try:
                sectors = int(size_file.read_text().strip())
                props["size_bytes"] = sectors * 512
            except (OSError, ValueError):
                props["size_bytes"] = 0
        else:
            props["size_bytes"] = 0

        # Removable
        removable_file = dev_dir / "removable"
        if removable_file.exists():
            try:
                props["removable"] = removable_file.read_text().strip() == "1"
            except OSError:
                props["removable"] = None
        else:
            props["removable"] = None

        # Device model name (if available)
        model_file = dev_dir / "device" / "model"
        if model_file.exists():
            try:
                props["model"] = model_file.read_text().strip()
            except OSError:
                props["model"] = None

        # Look for partitions
        partitions: list[str] = []
        for part in dev_dir.iterdir():
            if part.name.startswith(dev_name):
                partitions.append(part.name)
        props["partitions"] = partitions

        devices[dev_name] = props

    return devices


def _find_device_for_mount(
    mount: str,
    devices: dict[str, dict[str, Any]],
) -> str | None:
    """Find the block device that corresponds to a mount point.

    Uses /proc/mounts and /sys/block to resolve the mapping.
    """
    try:
        with open("/proc/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 2:
                    continue
                dev_path, mnt = parts[0], parts[1]
                if mnt == mount:
                    # Extract device name from /dev/sda1 → sda1, /dev/nvme0n1p1 → nvme0n1p1
                    if dev_path.startswith("/dev/"):
                        dev_name = dev_path[len("/dev/"):]
                        # Strip partition number to get base device
                        for d in devices:
                            if dev_name == d or dev_name.startswith(d):
                                return d
                    # Handle special cases like /dev/mapper/*
                    if dev_path.startswith("/dev/mapper/"):
                        # Try to resolve through device mapper
                        mapper_name = dev_path[len("/dev/mapper/"):]
                        # Check if there's a symlink we can follow
                        real_path = os.path.realpath(dev_path)
                        if real_path.startswith("/dev/"):
                            real_dev = real_path[len("/dev/"):]
                            for d in devices:
                                if real_dev == d or real_dev.startswith(d):
                                    return d
                    # Handle ZFS datasets
                    if dev_path == "zfs" or "zfs" in dev_path:
                        return None  # ZFS handled separately
    except OSError:
        pass
    return None


def _classify_by_device(
    device_name: str | None,
    devices: dict[str, dict[str, Any]],
) -> tuple[bool | None, StorageClass]:
    """Classify storage class based on device properties.

    Returns (rotational, storage_class).
    """
    if device_name is None:
        return None, StorageClass.UNKNOWN

    dev = devices.get(device_name)
    if dev is None:
        return None, StorageClass.UNKNOWN

    rotational = dev.get("rotational")

    if rotational is False:
        return False, StorageClass.SSD
    elif rotational is True:
        return True, StorageClass.HDD
    else:
        # Unknown rotational — fall back to naming heuristics
        for pattern in SSD_DEVICE_PATTERNS:
            if pattern.match(device_name):
                return False, StorageClass.SSD
        # If it starts with 'sd', likely HDD or SSD-on-SATA (already checked)
        return None, StorageClass.UNKNOWN


def _get_mount_info() -> list[dict[str, str]]:
    """Get list of real filesystem mounts from df or /proc/mounts."""
    mounts: list[dict[str, str]] = []

    try:
        # Use df -P for human-readable with filesystem types via -T
        result = subprocess.run(
            ["df", "-PT"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")[1:]
            for line in lines:
                parts = line.split()
                if len(parts) < 7:
                    continue
                fs_type = parts[1]
                if fs_type in SKIP_FS_TYPES:
                    continue
                device = parts[0]
                mount = parts[6]

                if mount in SKIP_MOUNTS:
                    continue
                if mount.startswith(("/sys", "/proc", "/dev", "/run", "/var/lib/containerd")):
                    continue

                mounts.append({
                    "device": device,
                    "fs_type": fs_type,
                    "mount": mount,
                })
    except (FileNotFoundError, subprocess.TimeoutExpired):
        # Fall back to /proc/mounts
        try:
            with open("/proc/mounts") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) < 3:
                        continue
                    device, mount, fs_type = parts[0], parts[1], parts[2]
                    if fs_type in SKIP_FS_TYPES:
                        continue
                    if mount in SKIP_MOUNTS:
                        continue
                    if mount.startswith(("/sys", "/proc", "/dev", "/run")):
                        continue
                    mounts.append({
                        "device": device,
                        "fs_type": fs_type,
                        "mount": mount,
                    })
        except OSError:
            pass

    return mounts


def classify_storage(
    overrides: dict[str, str] | None = None,
) -> list[StorageMount]:
    """Classify all mounted filesystems by storage class.

    Args:
        overrides: Optional dict of mount → storage_class overrides
                   (e.g., {"/mnt/hdd": "hdd", "/mnt/cold": "archive"})

    Returns: List of StorageMount dataclass instances.
    """
    overrides = overrides or {}
    devices = _get_block_devices()
    mount_infos = _get_mount_info()
    results: list[StorageMount] = []

    for info in mount_infos:
        mount = info["mount"]
        fs_type = info["fs_type"]
        device = info["device"]

        # Check for explicit override first
        if mount in overrides:
            forced_class = StorageClass(overrides[mount])
            storage_class = forced_class
            rotational = None
        else:
            # Find the block device and classify
            dev_name = _find_device_for_mount(mount, devices)
            rotational, storage_class = _classify_by_device(dev_name, devices)

            # If still UNKNOWN, check device name patterns
            if storage_class == StorageClass.UNKNOWN:
                dev_path = device
                if "zfs" in fs_type:
                    storage_class = StorageClass.HDD  # Conservative default for ZFS
                elif any(p.match(dev_path) for p in SSD_DEVICE_PATTERNS):
                    storage_class = StorageClass.SSD
                elif "archive" in mount.lower() or "cold" in mount.lower():
                    storage_class = StorageClass.ARCHIVE

        # Get usage stats
        try:
            usage = _get_disk_usage(mount)
        except OSError:
            usage = {"capacity": 0, "used": 0, "free": 0}

        results.append(StorageMount(
            mount=mount,
            filesystem=fs_type,
            device=device,
            capacity_bytes=usage["capacity"],
            used_bytes=usage["used"],
            free_bytes=usage["free"],
            storage_class=storage_class,
            rotational=rotational,
        ))

    # Sort by storage class (SSD first, then HDD, then ARCHIVE)
    sort_order = {StorageClass.SSD: 0, StorageClass.HDD: 1, StorageClass.ARCHIVE: 2, StorageClass.UNKNOWN: 3}
    results.sort(key=lambda m: (sort_order.get(m.storage_class, 99), m.mount))

    return results


def _get_disk_usage(mount: str) -> dict[str, int]:
    """Get capacity, used, and free bytes for a mount point."""
    st = os.statvfs(mount)
    capacity = st.f_frsize * st.f_blocks
    free = st.f_frsize * st.f_bavail
    used = capacity - free
    return {"capacity": capacity, "used": used, "free": free}


def format_storage_summary(mounts: list[StorageMount]) -> dict[str, Any]:
    """Summarize storage across all mounts in a node-friendly format.

    Returns dict with totals per storage class and a flat list of mounts.
    """
    by_class: dict[str, dict[str, int]] = {}
    total_capacity = 0
    total_free = 0

    for m in mounts:
        cls = m.storage_class.value
        if cls not in by_class:
            by_class[cls] = {"capacity_bytes": 0, "free_bytes": 0, "count": 0}
        by_class[cls]["capacity_bytes"] += m.capacity_bytes
        by_class[cls]["free_bytes"] += m.free_bytes
        by_class[cls]["count"] += 1
        total_capacity += m.capacity_bytes
        total_free += m.free_bytes

    return {
        "total_capacity_bytes": total_capacity,
        "total_free_bytes": total_free,
        "total_used_bytes": total_capacity - total_free,
        "total_used_pct": round((1 - total_free / total_capacity) * 100, 1) if total_capacity else 0,
        "by_class": by_class,
        "mounts": [
            {
                "mount": m.mount,
                "device": m.device,
                "filesystem": m.filesystem,
                "capacity_bytes": m.capacity_bytes,
                "free_bytes": m.free_bytes,
                "used_bytes": m.used_bytes,
                "used_pct": round((m.used_bytes / m.capacity_bytes) * 100, 1) if m.capacity_bytes else 0,
                "storage_class": m.storage_class.value,
            }
            for m in mounts
        ],
    }
