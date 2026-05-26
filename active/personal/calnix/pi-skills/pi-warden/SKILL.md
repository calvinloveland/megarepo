---
name: pi-warden
description: Query and control the Warden per-host monitoring agent from Pi. Check system health, run diagnostics, communicate with peer hosts, and manage backups — all inside Pi.
---

# Pi Warden Skill

Use this skill when you need to interact with the [Warden](ideas/warden-system.md) per-host agent running on the local machine.

## What it provides

This skill loads the `pi-warden` extension, which registers tools and commands for interacting with the local Warden.

### Commands

| Command | Description |
|---|---|
| `/warden status` | Show host health summary (checks, generation, backups, peers) |
| `/warden check <name>` | Run a specific health check |
| `/warden checks` | List all checks and their status |
| `/warden peers` | List known peer Wardens |
| `/warden tail [-f]` | Show recent events from the event log |

### Tools (LLM-callable)

| Tool | Description |
|---|---|
| `warden_status` | Get full host health summary as structured JSON or human-readable |
| `warden_check` | Run a named health check and get structured result |
| `warden_run_checks` | Run all configured checks and summarize |
| `warden_peers` | List peer Wardens and their cached status |
| `warden_peer_status` | Query a specific peer Warden's health |
| `warden_backup` | Run a backup job |
| `warden_tail` | Show recent events from the event log |

## Use cases

### "How is this machine doing?"
```
/warden status
```
or ask the LLM: "show me the host health"

### "Run a disk check"
```
/warden check disk-usage
```

### "Check all systems"
```
/warden check all
```

### "What happened recently?"
```
/warden tail
```

### "How are the other machines?"
```
/warden peers
```

## Requirements

- Warden must be installed on the host (`calnix.warden.enable = true`)
- `wardenctl` must be in `$PATH`
- The `pi-warden` package must be installed (`pi install pi-warden`)
