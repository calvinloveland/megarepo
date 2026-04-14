# Calnix - Calvin's Multi-Host NixOS Configuration

A personal NixOS configuration supporting multiple hosts with modular architecture.

## Hosts

### 🖥️ Thinker (ThinkPad)
Personal laptop configuration featuring:
- **Window Manager**: Sway (Wayland compositor)
- **Gaming**: Steam, game development tools, creative software
- **Desktop Environment**: Full desktop experience with Bluetooth, audio, etc.
- **Power Management**: ThinkPad-optimized TLP settings

### 💻 1337book (HP Elitebook)
HP Elitebook X G1i 14 AI (896Y1UA ABA) configuration featuring:
- **Window Manager**: Sway (Wayland compositor)
- **Gaming**: Steam, Blender, Krita, Aseprite, Dwarf Fortress
- **Desktop Environment**: Full desktop experience with Bluetooth, audio, etc.
- **Power Management**: HP Elitebook-optimized TLP settings with thermal management
- **Hardware**: Latest kernel packages, HP-specific firmware updates via fwupd

## Quick Start

### For ThinkPad (Thinker)
```bash
git clone <this-repo> /etc/nixos
cd /etc/nixos
sudo nixos-generate-config --show-hardware-config > hosts/thinker/hardware-configuration.nix
./rebuild.sh thinker
```

### For HP Elitebook (1337book)
```bash
git clone <this-repo> /etc/nixos
cd /etc/nixos
sudo nixos-generate-config --show-hardware-config > hosts/1337book/hardware-configuration.nix
./rebuild.sh 1337book
```

## Testing

Before deploying changes, run the comprehensive test suite:

```bash
# Run all tests
./tests/run_tests.sh

# Quick validation only
./tests/run_tests.sh --quick

# Code quality checks only
./tests/run_tests.sh --lint-only
```

### Available Tests

- **Configuration Validation**: Checks file structure, imports, and gaming separation
- **Rebuild Script Tests**: Unit tests for host detection logic
- **Nix Flake Validation**: Syntax and build checks
- **Code Quality**: Linting and dead code detection
- **Security**: File permissions and basic security checks

### Individual Test Commands

```bash
# Test rebuild script logic
./tests/test_rebuild.sh

# Validate configuration structure
./tests/validate_config.py

# Nix-specific tests
nix flake check --no-build
```

## Architecture

```
├── flake.nix              # Multi-host flake configuration
├── rebuild.sh             # Shell wrapper for rebuild.py
├── rebuild.py             # Smart host-aware rebuild script + generation telemetry
├── calnix_cli.py          # Machine-local package health CLI
├── calnix_state.py        # Shared state helpers for CLI + rebuild telemetry
├── package-health-registry.json # Health-managed package registry
├── hosts/
│   ├── thinker/           # ThinkPad configuration
│   │   ├── configuration.nix
│   │   └── hardware-configuration.nix
│   ├── 1337book/          # HP Elitebook configuration
│   │   ├── configuration.nix
│   │   └── hardware-configuration.nix
├── modules/
│   ├── base.nix           # Shared base configuration
│   ├── calnix.nix         # Machine-local calnix state + CLI install
│   ├── desktop.nix        # Desktop environment (Sway, Bluetooth, audio, etc.)
│   ├── desktop-scripts.nix # System-managed sway/waybar helper scripts
│   ├── gaming.nix         # Gaming-specific packages
│   └── remote-access.nix  # Shared SSH/Tailscale/mosh remote access
├── tests/                 # Testing infrastructure
│   ├── run_tests.sh       # Master test runner
│   ├── test_rebuild.sh    # Rebuild script unit tests
│   ├── validate_config.py # Configuration validation
│   └── flake.nix          # Test environment
├── homely-man.nix         # Home Manager configuration
├── home/                  # Home Manager submodules
│   ├── base.nix            # Shells, git, xdg defaults
│   ├── notifications.nix   # Mako configuration
│   ├── kitty.nix           # Kitty settings
│   ├── sway.nix            # Sway WM config
│   ├── waybar.nix          # Waybar config + style
│   └── scripts.nix         # Sway/Waybar helper scripts
└── python-dev.nix         # Python development environment
```

## Building Specific Hosts

The rebuild script automatically detects your environment:

```bash
# Auto-detect and build appropriate configuration
./rebuild.sh

# Manual override
./rebuild.sh thinker      # Force ThinkPad build
./rebuild.sh 1337book     # Force HP Elitebook build

# Or use nixos-rebuild directly
sudo nixos-rebuild switch --flake .#thinker
sudo nixos-rebuild switch --flake .#1337book
```

### Auto-Detection Logic

The script detects your environment using:
1. **Hostname** - Recognizes "Thinker", "1337book", or "elitebook"
2. **Hardware** - Looks for ThinkPad-specific indicators (`/proc/acpi/ibm/version`)
3. **HP Hardware** - Detects HP/Hewlett-Packard via `lspci` or `dmidecode`
4. **Fallback** - Defaults to "thinker"

## Key Features

### Shared (All Desktop Hosts)
- **Development**: Git, GitHub CLI, Docker, Python environment
- **Tools**: Fish shell, Neovim, essential CLI utilities
- **Base System**: Common NixOS configuration
- **Remote Access**: Key-only OpenSSH over Tailscale, mosh-ready firewall rules, and tmux for persistent CLI sessions
- **Package Health**: `calnix` can track package failures, confirmations, and runtime observations in `/var/lib/calnix`
- **Generation Telemetry**: successful rebuilds record timing and robustness metadata under `/var/lib/calnix/generations/`

### Package health workflow

Calnix now includes a machine-local package health layer so broken packages can be rolled back without baking long-lived workaround comments into modules.

Common commands:

```bash
# See managed packages and their active policies
calnix package list
calnix package status

# Run the host-aware rebuild helper through the installed CLI
calnix rebuild

# Bless the package source currently selected by the flake as working
calnix package confirm darktable --repo /etc/nixos --notes "worked for a full editing session"

# Mark the current package version as failing so the next rebuild uses the
# last confirmed-good nixpkgs revision (or the package's legacy fallback policy)
calnix package mark-failing darktable --repo /etc/nixos --notes "crashes on startup"

# Stop forcing a rollback and try current nixpkgs again
calnix package use-current darktable --notes "retry after nixpkgs update"

# Record a healthy runtime observation without explicitly blessing the package
calnix package observe-healthy darktable --minutes 90 --notes "no crashes during export batch"
```

The package health state lives outside the repo in `/var/lib/calnix/state.json`, so rebuild decisions can be machine-local while the flake remains the place where package selection is implemented.

### Intel NPU / OpenVINO (1337book focus)
- **Reproducible Toolkit**: `nix develop` now unpacks Intel OpenVINO 2024.6 with the Intel NPU plugin pre-configured.
- **Environment Wiring**: Shell hook exports `INTEL_OPENVINO_DIR`, `IE_PLUGINS_PATH`, `LD_LIBRARY_PATH`, `PKG_CONFIG_PATH`, `PYTHONPATH`, and `INTEL_NPU_DEVICE` for immediate use.
- **Sanity Checks**: Startup script runs `openvino.runtime.Core().available_devices` and aborts if the NPU is missing (use `CALNIX_SKIP_NPU_CHECK=1` to bypass on unsupported hosts/CI).
- **Driver Helper**: `intel-npu-driver-helper --install|--status|--uninstall` wraps Intel's `linux-npu-driver` repo so kernel modules stay in sync after updates.
- **Extra Docs**: See `docs/npu-support.md` for setup notes, verification steps, and troubleshooting tips.
- **Scanner Runbook**: See `docs/scanners/epson-ds510-linux.md` for DS-510 scan/recovery steps.
- **System-Wide Runtime**: On 1337book the OpenVINO 2024.6 runtime is installed globally; login shells automatically export the same variables as the dev shell so `python3 -c 'from openvino.runtime import Core'` works anywhere.

### Desktop Hosts (Thinker & 1337book)
- **Gaming**: Steam, Blender, Krita, Aseprite, Dwarf Fortress
- **Desktop**: Sway, Bluetooth, audio (PipeWire), power management
- **Creative**: Image editing, 3D modeling, digital art tools
- **Media**: VLC, FFmpeg for video processing

### ThinkPad Specific (Thinker)
- **Power Management**: ThinkPad-optimized TLP settings
- **Hardware**: ThinkPad ACPI integration

### HP Elitebook Specific (1337book)
- **Power Management**: HP-optimized TLP settings with thermal management
- **Hardware**: Latest kernel packages, HP firmware updates (fwupd)
- **Battery**: HP-specific charging thresholds (75%-85%)

## Development Workflow

1. **Make Changes** to configuration files
2. **Run Tests** to validate changes:
   ```bash
   ./tests/run_tests.sh --quick
   ```
3. **Deploy** if tests pass:
   ```bash
   ./rebuild.sh
   ```

After a successful rebuild, inspect the recorded generation history with:

```bash
calnix generation list
```

## Phone CLI Access

Calnix now includes the pieces needed for a phone-friendly Copilot CLI workflow:

- **OpenSSH server** with key-only authentication
- **Tailscale** for private remote access without exposing SSH to the public internet
- **mosh**-ready firewall rules on `tailscale0` for roaming between Wi-Fi and cellular
- **tmux** so long-running CLI sessions survive disconnects

Recommended setup:

1. Rebuild the host:
   ```bash
   sudo nixos-rebuild switch --flake .#thinker
   # or
   sudo nixos-rebuild switch --flake .#1337book
   ```
2. Bring Tailscale up on the laptop:
   ```bash
   sudo tailscale up
   ```
3. Ensure your phone is signed into the same Tailnet.
4. Add your public key to `~/.ssh/authorized_keys` for the `calvin` user if it is not already present.
5. Start or attach a tmux session:
   ```bash
   tmux new -A -s phone
   ```
6. Connect from the phone:
   ```bash
   ssh calvin@<tailscale-hostname>
   ```
   or, for better network handoff:
   ```bash
   mosh calvin@<tailscale-hostname>
   ```

Inside the remote session you can run Copilot CLI normally, for example:

```bash
gh copilot suggest -t shell "find the failing test command in this repo"
```

## Customization

### Adding Packages
- **All hosts**: Edit `modules/base.nix`
- **Desktop hosts only**: Edit `modules/desktop.nix`
- **Gaming only**: Edit `modules/gaming.nix`
- **ThinkPad only**: Edit `hosts/thinker/configuration.nix`
- **HP Elitebook only**: Edit `hosts/1337book/configuration.nix`
- **Home Manager**: Edit `home/*.nix`

### Creating New Hosts
1. Create `hosts/new-host/configuration.nix`
2. Add to `flake.nix` nixosConfigurations
3. Update `rebuild.sh` with new host option
4. Add tests for new configuration

## Troubleshooting

### Desktop Hosts (Thinker & 1337book)
- Pywal colors: Ensure wallpaper at `~/Pictures/background.jpg`
- Brightness controls: User must be in `video` group
- Bluetooth: Use `Mod4+b` for GUI or `Mod4+Shift+b` for terminal

### ThinkPad-Specific (Thinker)
- ACPI features: Check `/proc/acpi/ibm/` for available functions

### HP Elitebook-Specific (1337book)
- Firmware updates: Use `fwupdmgr` for HP firmware management
- Thermal management: `thermald` service handles temperature control

### Testing Issues
- **Nix not found**: Install Nix or use `--quick` flag
- **Permission errors**: Ensure scripts are executable: `chmod +x tests/*.sh`
- **Python errors**: Ensure Python 3 is available
- **Package rollback not activating**: confirm a working package first with `calnix package confirm <package> --repo /etc/nixos`, then mark the broken version as failing

## Legacy Support

The flake maintains backward compatibility with:
- `nixos` and `Thinker` configurations (both point to thinker host)
