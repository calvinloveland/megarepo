# HomeCluster — Distributed Storage in Warden

HomeCluster integrates distributed storage concepts into the [Warden](../../ideas/warden-hierarchy-design.md) per-host monitoring system. Rather than building a standalone storage orchestrator, HomeCluster layers on top of Warden's peer-to-peer architecture.

## Quick Start

HomeCluster is enabled via the Warden Nix module:

```nix
# On the coordinator (NAS/desktop with most storage)
calnix.warden.homecluster = {
  enable = true;
  clusterRole = "both";  # Reports + aggregates
};

# On leaf nodes (laptops, other desktops)
calnix.warden.homecluster = {
  enable = true;
  clusterRole = "leaf";  # Reports only
};
```

## Commands

```bash
# Show storage report with class breakdown
wardenctl hc status

# Store a file in the object store
wardenctl hc store put ~/photo.jpg --logical-path /photos/vacation.jpg

# List objects
wardenctl hc store list

# List directory placements
wardenctl hc placements

# Manage placement policies
wardenctl hc policies add --path '/photos/*' --preferred-storage hdd --replicas 2
wardenctl hc policies list
```

## Architecture

```
Leaf Node                          Parent Node
─────────                          ───────────
storage_report check ──→ State ──→ Dashboard: Pooled Hero
  (SSD/HDD/ARCHIVE)       │           + Per-node bars
                          │
object_store_health ──────┤         ClusterMetadata (SQLite)
                          │           ├─ nodes + storage
                          │           ├─ directory placements
Peer HTTP API ────────────┼─→        ├─ access tracking
                          │           └─ placement policies
                                   PlacementScheduler
                                     └─ evaluate() → place/replicate
```

## Modules

| Module | Purpose |
|---|---|
| `storage_class.py` | Detects SSD/HDD/ARCHIVE per mount using sysfs rotational flags |
| `object_store.py` | Content-addressed SHA-256 object store with integrity verification |
| `metadata.py` | SQLite-backed cluster metadata (nodes, placements, policies, access tracking) |
| `scheduler.py` | Placement policy evaluation and candidate ranking |
| `access_tracker.py` | Directory-level read/write telemetry via stat() polling |
| `fuse_mount.py` | FUSE filesystem exposing /homecluster namespace |

## API Endpoints

| Endpoint | Description |
|---|---|
| `/warden/storage` | Storage report with class breakdown |
| `/warden/access` | Access tracking data from ClusterMetadata |
| `/api/storage/pool` | Aggregated cluster storage pool (dashboard) |

## Files

Source code: `active/personal/calnix/modules/warden/`

- `homecluster/` — Core modules
- `checks/storage_report.py` — Warden check
- `checks/object_store_health.py` — Warden check
- `dashboard/app.py` — Pooled storage view
- `warden.nix` — Module options + services
- `wardenctl.py` — `hc` subcommands
