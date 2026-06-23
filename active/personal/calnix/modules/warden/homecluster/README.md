# HomeCluster — Distributed Storage in Warden

## Overview

HomeCluster integrates distributed storage concepts into the Warden per-host monitoring system. Rather than building a standalone storage orchestrator, HomeCluster layers on top of Warden's peer-to-peer architecture, using the existing parent/leaf hierarchy, health checks, event log, and dashboard.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Warden Parent Node                       │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ Cluster     │  │ Placement    │  │ Pooled        │   │
│  │ Metadata    │  │ Scheduler    │  │ Dashboard     │   │
│  │ (SQLite)    │  │ (Policy)     │  │ (Storage View)│   │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘   │
│         │                │                   │           │
└─────────┼────────────────┼───────────────────┼───────────┘
          │                │                   │
    ┌─────┼────────────────┼───────────────────┼─────┐
    │     │                │                   │     │
    │  ┌──▼────────────────▼───────────────────▼──┐  │
    │  │         Tailscale / gRPC / HTTP           │  │
    │  └──▲────────────────▲───────────────────▲──┘  │
    │     │                │                   │     │
    │  ┌──┴─────────┐ ┌───┴──────────┐ ┌──────┴───┐ │
    │  │ Leaf: NAS  │ │ Leaf: Desktop│ │ Leaf:    │ │
    │  │            │ │              │ │ Laptop   │ │
    │  │ • Storage  │ │ • Storage    │ │ • Storage│ │
    │  │   Report   │ │   Report     │ │   Report │ │
    │  │ • Object   │ │ • Object     │ │ • Object │ │
    │  │   Store    │ │   Store      │ │   Store  │ │
    └──┴────────────┘ └──────────────┘ └──────────┘ │
                                                      │
                  Warden Leaf Nodes                    │
└──────────────────────────────────────────────────────────┘
```

## Modules

### `homecluster/storage_class.py`
Detects and classifies each mount point by performance tier:
- **SSD** — NVMe, SATA SSD (sysfs `rotational=0`)
- **HDD** — Spinning disks (sysfs `rotational=1`)
- **ARCHIVE** — Cold/archive storage (user-configured)

Uses sysfs block device properties, device name heuristics, and user overrides.

### `homecluster/object_store.py`
Content-addressed local object store:
- Objects stored by SHA-256 hash (built-in deduplication)
- Integrity verification on every read
- Atomic writes via staging directory + rename
- Per-object metadata (content type, logical path, labels)
- Two-level directory structure for scale (`objects/ab/abcdef...`)

### `homecluster/metadata.py`
Cluster metadata management (Parent role):
- SQLite database with WAL mode
- Node registration and storage tracking
- Directory placement and replica tracking
- Access counting and temperature classification (hot/warm/cold/archive)
- Placement policy rules (glob pattern → storage class + replica count)

### `homecluster/scheduler.py`
Placement decision engine:
- Evaluates policies against current cluster state
- Ranks candidate nodes by free space, storage class match, load
- Returns decisions: place, replicate, migrate, noop, blocked
- Can load policies from YAML files or JSON

## Warden Integration Points

### Leaf Node
| Warden Component | HomeCluster Integration |
|---|---|
| `warden_state.py` | `get_storage_report()` enriches state with storage class data |
| `runner.py` | Auto-discovers `storage-report` and `object-store-health` checks |
| `wardend.py` | Exposes `/warden/storage` endpoint for peer queries |
| `wardenctl.py` | `hc status`, `hc store put/get`, `hc placements` subcommands |
| Dashboard | Storage pool hero + per-node storage bars |

### Parent Node
| Warden Component | HomeCluster Integration |
|---|---|
| `warden_state.py` | `get_storage_report()` with cluster summary |
| Nix module | `homecluster.enable`, `clusterRole`, `objectStore`, `metadataDb` |
| Dashboard | Pooled storage: total capacity/free per class, per-node breakdown |
| Config | Storage overrides, placement policy file path |

### Dashboard
| Feature | Description |
|---|---|
| Storage Pool Hero | Gradient bar showing total cluster capacity, free space, usage % |
| Per-Class Breakdown | SSD/HDD/ARCHIVE cards with free/total per class |
| Per-Node Storage Bar | Each host card shows its storage bar, free space, class chips |
| API Endpoints | `/api/storage/pool` returns aggregated pool, `/api/hosts` includes pool |

## Configuration

### Nix (warden.nix)
```nix
calnix.warden.homecluster = {
  enable = true;
  clusterRole = "both";  # leaf | parent | both

  objectStore = {
    enable = true;
    root = "/var/lib/homecluster/objects";
  };

  metadataDb = "/var/lib/homecluster/metadata.db";
  placementPolicyFile = "/etc/warden/placement-policy.yaml";

  storageOverrides = {
    "/mnt/archive" = "archive";
    "/mnt/fast" = "ssd";
  };
};
```

### Placement Policy YAML
```yaml
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

  - path: "/archive/*"
    preferred_storage: HDD
    replicas: 1
```

## Data Flow

### Storage Reporting (Leaf → Parent)
1. Leaf Warden runs `storage-report` check periodically
2. `homecluster.storage_class.classify_storage()` detects mounts and classes
3. Result saved to Warden state and exposed via `/warden/status`
4. Parent Warden dashboard queries all peers and aggregates via `compute_storage_pool()`

### Placement Decision (Parent)
1. User defines placement policies in YAML
2. Parent loads policies into `ClusterMetadata` SQLite database
3. `PlacementScheduler.evaluate()` matches path patterns against active policies
4. Scheduler queries node storage from metadata, ranks candidates by class + free space
5. Decision output: action (place/replicate/migrate/noop), target node, reasoning

### Object Storage
1. Application writes file to local Warden object store
2. Content is hashed (SHA-256), stored atomically, metadata recorded
3. Parent tracks which directories/objects are on which nodes
4. Scheduler may decide to replicate or migrate objects between nodes

## Files Added/Modified

### New Files
| File | Purpose |
|---|---|
| `homecluster/__init__.py` | Package entry point |
| `homecluster/storage_class.py` | Storage class detection (SSD/HDD/ARCHIVE) |
| `homecluster/object_store.py` | Content-addressed object store |
| `homecluster/metadata.py` | Cluster metadata (SQLite) |
| `homecluster/scheduler.py` | Placement scheduler with policies |
| `checks/storage_report.py` | Warden check: storage class + disk reporting |
| `checks/object_store_health.py` | Warden check: object store integrity |

### Modified Files
| File | Change |
|---|---|
| `warden_state.py` | Added `get_storage_report()`, `enrich_state_with_storage()`, `HOMECLUSTER_STATE_FILE` |
| `dashboard/app.py` | Added storage pool hero, per-node storage bars, `compute_storage_pool()`, `format_bytes()`, `/api/storage/pool` endpoint |
| `warden.nix` | Added `homecluster` option submodule, state dirs, source tree inclusion, config generation |

## Testing

```bash
# Storage class detection
cd active/personal/calnix/modules/warden
python3 -c "from homecluster.storage_class import classify_storage; mounts = classify_storage(); print(sum(m.capacity_bytes for m in mounts) / 1e12, 'TB')"

# Object store
python3 -c "from homecluster.object_store import ObjectStore; s=ObjectStore('/tmp/test-hc'); oid=s.put(b'test'); print(s.verify(oid))"

# Cluster metadata
python3 -c "from homecluster.metadata import ClusterMetadata; m=ClusterMemory('/tmp/test-hc.db'); print(m.cluster_summary())"

# Scheduler
python3 -c "from homecluster.metadata import ClusterMetadata; from homecluster.scheduler import PlacementScheduler; m=ClusterMetadata('/tmp/test-hc.db'); s=PlacementScheduler(m); print(s.evaluate('/test', 1e9))"

# Warden check
python3 checks/storage_report.py
```

## Next Steps

1. **FUSE mount** — Expose `/homecluster` namespace via FUSE (separate service that talks to Warden APIs)
2. **Migration engine** — Async directory migration between nodes with checksum verification
3. **Replication engine** — Automatically replicate directories per policy
4. **Access tracking daemon** — Filesystem watcher for fine-grained read/write telemetry
5. **Tiering automation** — Auto-migrate directories between classes based on temperature
6. **Object replication** — gRPC-based object transfer between leaf wardens
