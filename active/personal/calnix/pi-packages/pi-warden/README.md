# pi-warden

Pi extension for the [Warden](https://github.com/calvinloveland/megarepo/tree/main/ideas/warden-system.md) per-host monitoring agent.

Provides tools and commands inside Pi for querying host health, running checks, communicating with peer wardens, and managing backups.

## Installation

```bash
pi install pi-warden
```

## Usage

Once installed, Pi loads the extension automatically. Use the tools inside any session:

### Commands

| Command | Description |
|---|---|
| `/warden status` | Show host health summary |
| `/warden check <name>` | Run a specific health check |
| `/warden checks` | List all checks and their status |
| `/warden peers` | List known peer wardens |
| `/warden tail [-f]` | Show recent events |

### Tools (LLM-callable)

| Tool | Description |
|---|---|
| `warden_status` | Get full host health summary |
| `warden_check` | Run a specific health check by name |
| `warden_run_checks` | Run all configured checks |
| `warden_peers` | List known peer wardens and their status |
| `warden_peer_status` | Query a specific peer Warden's health |
| `warden_backup` | Run backup and report status |
| `warden_tail` | Show recent events from the event log |

## How it works

The extension shells out to `wardenctl` (the Warden CLI) which reads state files directly from `/var/lib/warden/`. No daemon required — the Warden state is always accessible.

## Requirements

- Warden must be installed on the host (NixOS module: `calnix.warden.enable = true`)
- `wardenctl` must be in `$PATH`
- Works with or without the `wardend` daemon
