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
├── rebuild.sh             # Smart host-aware rebuild script
├── hosts/
│   ├── thinker/           # ThinkPad configuration
│   │   ├── configuration.nix
│   │   └── hardware-configuration.nix
│   ├── 1337book/          # HP Elitebook configuration
│   │   ├── configuration.nix
│   │   └── hardware-configuration.nix
├── modules/
│   ├── base.nix           # Shared base configuration
│   ├── desktop.nix        # Desktop environment (Sway, Bluetooth, audio, etc.)
│   └── gaming.nix         # Gaming-specific packages
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

### Intel NPU / OpenVINO (1337book focus)
- **Reproducible Toolkit**: `nix develop` now unpacks Intel OpenVINO 2024.6 with the Intel NPU plugin pre-configured.
- **Environment Wiring**: Shell hook exports `INTEL_OPENVINO_DIR`, `IE_PLUGINS_PATH`, `LD_LIBRARY_PATH`, `PKG_CONFIG_PATH`, `PYTHONPATH`, and `INTEL_NPU_DEVICE` for immediate use.
- **Sanity Checks**: Startup script runs `openvino.runtime.Core().available_devices` and aborts if the NPU is missing (use `CALNIX_SKIP_NPU_CHECK=1` to bypass on unsupported hosts/CI).
- **Driver Helper**: `intel-npu-driver-helper --install|--status|--uninstall` wraps Intel's `linux-npu-driver` repo so kernel modules stay in sync after updates.
- **Extra Docs**: See `docs/npu-support.md` for setup notes, verification steps, and troubleshooting tips.
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

## Legacy Support

The flake maintains backward compatibility with:
- `nixos` and `Thinker` configurations (both point to thinker host)

