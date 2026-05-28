# NixOS Management Skill

You are an expert NixOS administrator. Apply the knowledge below when managing this
system. The canonical docs are in the nixpkgs channel at
`/nix/store/gf12ajfzx0kyfdaxwa3yaz917bfd0mj1-nixos/nixos/nixos/doc/manual/`.

## System Overview

- **System**: NixOS 26.05 (Yarara), x86_64-linux, nixpkgs `d233902339c02a9c334e7e593de68855ad26c4cb`
- **Nix version**: 2.34.7
- **Boot**: systemd-boot (UEFI)
- **Hostname**: haswell (192.168.1.168), repurposed desktop server with 8TB HDD at `/data`

## Rebuilding the System

### Flake-based (preferred)
```bash
sudo nixos-rebuild switch --flake /home/calvin/calnix#haswell
```

The flake provides overlays for:
- `pi-agent-harness` — Pi coding agent CLI
- `github-copilot-cli` — GitHub Copilot CLI (newer version than nixpkgs)
- `home-manager` — NixOS module import

### Channel-based (fallback)
```bash
sudo nixos-rebuild switch
```
Requires `/etc/nixos/configuration.nix` and proper `NIX_PATH`:
```
nixpkgs=/nix/var/nix/profiles/per-user/root/channels/nixos
nixos-config=/etc/nixos/configuration.nix
```

**Note**: Channel-based builds won't include `pi-agent-harness` (flake-only package).

### Useful flags
- `--no-reexec` — Don't re-build nixos-rebuild itself (faster, avoids drv issues)
- `--repair` — Check every path in closure, redownload corrupt ones
- `--rollback` — Switch to previous configuration
- `test` — Switch running system but don't make boot default
- `boot` — Make boot default but don't switch now
- `build` — Build only, don't activate
- `dry-build` — Evaluate only, show what would be built

## Configuration Architecture

```
/home/calvin/calnix/
├── flake.nix          # Flake: inputs, overlays, nixosConfigurations
├── flake.lock         # Pinned flake inputs
├── modules/
│   ├── base.nix       # Core packages and programs (imports calnix.nix, remote-access.nix, warden.nix)
│   ├── calnix.nix     # calnix CLI, state dir
│   ├── remote-access.nix  # SSH + Tailscale
│   └── warden/warden.nix   # Warden monitoring agent module
├── hosts/haswell/
│   ├── configuration.nix   # Haswell-specific config (imports base.nix)
│   └── hardware-configuration.nix
├── pi-packages/       # Pi extensions
├── pi-skills/         # Pi skills
└── scripts/
    └── rebuild-helper.sh   # Full rebuild script (sudoers, channels, deploy, rebuild)
```

### Key Module: warden.nix
- Defines `calnix.warden` options (checks, backups, pi, peerApi, dashboard, autoRemediate)
- Creates systemd services and timers for health checks
- Autopilot service uses `pkgs.pi-agent-harness` (conditional on availability)
- Warden user gets passwordless sudo for specific operations
- State dir: `/var/lib/warden/`

### Packages NOT in nixpkgs channel
- `pi-agent-harness` — only available via flake overlay
- `github-copilot-cli` — flake overlay provides newer version; nixpkgs channel has older version

## Nix Store Management

### Garbage Collection
```bash
nix-collect-garbage          # Remove unreferenced paths
nix-collect-garbage -d       # Also delete old system profiles
sudo nix-store --optimise    # Hard-link identical files (saves ~40% space)

# Automatic GC:
nix.gc.automatic = true;
nix.gc.dates = "03:15";
```

### Store Corruption Recovery
```bash
sudo nix-store --verify --check-contents --repair  # Full store scan + repair
sudo nixos-rebuild switch --repair                  # Repair system closure only
```

### Common Store Issues

**Missing .drv files (GC'd)**: If Nix complains "opening file ... No such file or directory"
for `.drv` files, the derivation files were garbage collected but outputs remain.
Fix by running `nix-instantiate` before the rebuild:
```bash
sudo nix-instantiate '<nixpkgs/nixos>' -A config.system.build.toplevel --add-root /tmp/prebuild.drv
sudo nixos-rebuild switch --no-reexec
```

**Database corruption**: Foreign key constraint failures in SQLite. Try:
```bash
sudo nix-store --verify --repair
```
If that fails, the database may need manual SQLite repair or a fresh rebuild from cache.

## Nix Configuration Reference

### Key nix.conf options (via `nix.settings`)
- `experimental-features` = `nix-command flakes`
- `max-jobs` = `auto`
- `cores` = `0`
- `trusted-users` = `root`
- `substituters` = `https://cache.nixos.org/`
- `sandbox` = `true`

### NIX_PATH (via `nix.nixPath`)
Default when channels enabled:
```
nixpkgs=/nix/var/nix/profiles/per-user/root/channels/nixos
nixos-config=/etc/nixos/configuration.nix
/nix/var/nix/profiles/per-user/root/channels
```

## Rolling Back
```bash
sudo nixos-rebuild switch --rollback    # Switch to previous generation
sudo /nix/var/nix/profiles/system-N-link/bin/switch-to-configuration switch  # Specific generation
```
List generations: `ls -l /nix/var/nix/profiles/system-*-link`
GRUB also shows all non-GC'd configurations under "NixOS - All configurations".

## Channel Management
```bash
sudo nix-channel --add https://nixos.org/channels/nixos-unstable nixos
sudo nix-channel --update
nix-channel --list
```

## Warden Operations
- `wardenctl check <name>` — Run a specific health check
- `wardenctl rebuild` — Trigger nixos-rebuild
- `wardenctl remediate <name>` — Auto-remediate a failing check
- `wardenctl peer <host>` — Query peer warden
- State: `/var/lib/warden/state.json`
- Config: `/etc/warden/config.json`

## Proven Rebuild Procedure

When `nixos-rebuild switch` fails with "opening file ... No such file or directory" for
`.drv` files, the derivation files were garbage collected but their outputs remain.
The fix (from NixOS docs `store-corruption.section.md`):

```bash
export NIX_PATH="nixpkgs=/nix/var/nix/profiles/per-user/root/channels/nixos:nixos-config=/etc/nixos/configuration.nix"
sudo nixos-rebuild switch --no-reexec --repair
```

`--repair` checks every path in the closure against its cryptographic hash;
corrupt or missing paths are redownloaded or rebuilt.
`--no-reexec` skips rebuilding nixos-rebuild itself (avoids chicken-and-egg with its own .drv files).

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `error: file 'nixpkgs/nixos' was not found` | Missing NIX_PATH | `export NIX_PATH="nixpkgs=/nix/var/nix/profiles/per-user/root/channels/nixos:..."` |
| `option 'home-manager' does not exist` | Module not imported | Import home-manager module or use flake |
| `path '...flake.nix' does not exist` | Stale flake lock or GC'd source | `nix flake update` |
| `opening file '...drv' No such file` | **GC'd derivations** | **`--repair` flag**: `nixos-rebuild switch --repair` |
| `FOREIGN KEY constraint failed` | Corrupt nix db | `nix-store --verify --repair` then `nixos-rebuild switch --repair` |
| Build hangs on fetching | Network/cache issue | `--option substitute false` to force local build |
