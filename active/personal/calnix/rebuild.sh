#!/usr/bin/env bash
set -euo pipefail

# If this script is invoked with sudo, re-exec it as the original user to avoid
# flake evaluation running as root. Running flake evaluation as root can cause
# "repository path ... is not owned by current user" errors when Nix fetches
# local git inputs. The script will still call sudo internally when needed.
if [ "$(id -u)" -eq 0 ]; then
  if [ -n "${SUDO_USER:-}" ]; then
    echo "⚠️  Don't run this script with sudo; re-executing as ${SUDO_USER} to avoid flake ownership errors."
    exec sudo -u "${SUDO_USER}" -E bash "$0" "$@"
  else
    echo "❌ This script must not be run as root. Re-run as your normal user (it will use sudo internally)."
    exit 1
  fi
fi

# Smart multi-host rebuild script for Calvin's NixOS configuration
# Automatically detects the environment and builds the appropriate configuration

detect_host() {
    # Check if running in WSL
    if grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]; then
        echo "work-wsl"
        return
    fi
    
    # Check hostname
    hostname=$(hostname)
    case $hostname in
        Thinker|thinker)
            echo "thinker"
            return
            ;;
        1337book|elitebook)
            echo "1337book"
            return
            ;;
        work-wsl|work)
            echo "work-wsl"
            return
            ;;
    esac
    
    # Check for ThinkPad-specific hardware
    if [ -f /proc/acpi/ibm/version ] || lspci 2>/dev/null | grep -qi thinkpad; then
        echo "thinker"
        return
    fi
    
    # Check for HP hardware
    if lspci 2>/dev/null | grep -qi "hewlett-packard\|hp" || dmidecode -s system-manufacturer 2>/dev/null | grep -qi hp; then
        echo "1337book"
        return
    fi
    
    # Default fallback
    echo "thinker"
}

# Parse arguments
HOST=""
EXTRA_ARGS=()

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        thinker|1337book|work-wsl)
            if [ -z "$HOST" ]; then
                HOST="$1"
            else
                EXTRA_ARGS+=("$1")
            fi
            shift
            ;;
        -h|--help)
            HOST="help"
            shift
            ;;
        *)
            # Check if this looks like a host name but isn't valid
            if [[ "$1" =~ ^[a-zA-Z0-9-]+$ ]] && [[ ! "$1" =~ ^-- ]] && [[ "$1" != --* ]] && [ -z "$HOST" ]; then
                # This might be an invalid host name
                HOST="$1"
            else
                EXTRA_ARGS+=("$1")
            fi
            shift
            ;;
    esac
done

# Auto-detect host if not specified
if [ -z "$HOST" ]; then
    HOST=$(detect_host)
    echo "Auto-detected host: $HOST"
fi

case $HOST in
  thinker)
    echo "🖥️  Rebuilding ThinkPad configuration..."
    ;;
  1337book)
    echo "💻 Rebuilding HP Elitebook configuration..."
    ;;
  work-wsl)
    echo "🖱️  Rebuilding WSL work configuration..."
    ;;
  help)
    echo ""
    echo "Usage: $0 [host] [nixos-rebuild options]"
    echo "Available hosts:"
    echo "  thinker   - ThinkPad with gaming and desktop environment"
    echo "  1337book  - HP Elitebook with gaming and desktop environment"
    echo "  work-wsl  - WSL work environment without gaming"
    echo ""
    echo "Examples:"
    echo "  $0                    # Auto-detect host and rebuild"
    echo "  $0 1337book           # Build specific host"
    echo "  $0 1337book --dry-run # Dry run for specific host"
    echo "  $0 --dry-run          # Auto-detect host and dry run"
    echo ""
    echo "Auto-detection checks:"
    echo "  - WSL environment (/proc/version, WSL_DISTRO_NAME)"
    echo "  - Hostname (Thinker, 1337book, work-wsl)"
    echo "  - ThinkPad hardware (/proc/acpi/ibm/version, lspci)"
    echo "  - HP hardware (lspci, dmidecode)"
    echo "  - Default: thinker"
    exit 0
    ;;
  *)
    echo "❌ Unknown host: $HOST"
    echo ""
    echo "Usage: $0 [host] [nixos-rebuild options]"
    echo "Available hosts:"
    echo "  thinker   - ThinkPad with gaming and desktop environment"
    echo "  1337book  - HP Elitebook with gaming and desktop environment"
    echo "  work-wsl  - WSL work environment without gaming"
    echo ""
    echo "Examples:"
    echo "  $0                    # Auto-detect host and rebuild"
    echo "  $0 1337book           # Build specific host"
    echo "  $0 1337book --dry-run # Dry run for specific host"
    echo "  $0 --dry-run          # Auto-detect host and dry run"
    echo ""
    echo "Auto-detection checks:"
    echo "  - WSL environment (/proc/version, WSL_DISTRO_NAME)"
    echo "  - Hostname (Thinker, 1337book, work-wsl)"
    echo "  - ThinkPad hardware (/proc/acpi/ibm/version, lspci)"
    echo "  - HP hardware (lspci, dmidecode)"
    echo "  - Default: thinker"
    exit 1
    ;;
esac

# Helper: ensure repository ownership won't cause flake evaluation to fail
ensure_repo_owned_or_fix() {
  # Determine repo root (prefer git top-level)
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  if [ ! -d "$repo_root" ]; then
    return 0
  fi

  repo_owner_uid=$(stat -c %u "$repo_root" 2>/dev/null || true)
  my_uid=$(id -u)
  if [ -n "$repo_owner_uid" ] && [ "$repo_owner_uid" != "$my_uid" ]; then
    repo_owner_user=$(getent passwd "$repo_owner_uid" | cut -d: -f1 || true)
    repo_owner_user=${repo_owner_user:-$repo_owner_uid}

    echo "⚠️  Repository $repo_root is owned by $repo_owner_user (uid $repo_owner_uid), but you are $(id -un) (uid $my_uid)."
    echo "    Nix flake evaluation may fail when run as a different user (you've seen: 'repository path ... is not owned by current user')."

    # If non-interactive, bail out with instructions
    if [ ! -t 0 ]; then
      echo "    Non-interactive shell: cannot prompt. Please run on host: sudo chown -R $(id -un):$(id -gn) '$repo_root' or run the rebuild as the repo owner."
      return 1
    fi

    # Offer to chown the repository to the current user
    echo -n "    Fix ownership now by running 'sudo chown -R $(id -un):$(id -gn) "$repo_root"'? [Y/n] "
    read -r ans
    ans=${ans:-Y}
    if [[ "$ans" =~ ^[Yy] ]]; then
      if sudo chown -R "$(id -un):$(id -gn)" "$repo_root"; then
        echo "    ✅ Ownership fixed to $(id -un):$(id -gn)."
        return 0
      else
        echo "    ⚠️  Failed to chown $repo_root. You may need to run the chown on the host or adjust mount options."
        return 1
      fi
    fi

    # If user declined chown, offer to run build as repo owner
    echo -n "    Or run the build as $repo_owner_user using sudo - this requires your sudo password and will execute build steps as that user. Proceed? [y/N] "
    read -r ans2
    if [[ "$ans2" =~ ^[Yy] ]]; then
      sudo -u "$repo_owner_user" -H bash -lc "$(printf '%q' "$SHELL") -lc 'echo Running build as $repo_owner_user; "'" || true
      # Signal caller to run build-as-owner
      BUILD_AS_OWNER="$repo_owner_user"
      return 0
    fi

    echo "    Aborting rebuild due to ownership mismatch. Fix ownership or re-run as the repo owner."
    return 1
  fi
  return 0
}

# Get the target from command line or auto-detect
if [ $# -gt 0 ]; then
    TARGET="$1"
    echo "Using specified configuration target: $TARGET"
else
    TARGET=$(detect_host)
    echo "Auto-detected configuration target: $TARGET"
fi

echo "💻 Rebuilding NixOS configuration..."
echo "Starting rebuild with target: $TARGET"

# Rebuild with flake and proper target
sudo nixos-rebuild switch --flake ".#$TARGET"

# Restart waybar to apply changes
echo "Restarting waybar service..."
systemctl --user restart waybar

echo "Done! Temperature monitoring should now work correctly."
    ;;
  1337book)
    echo "💻 Rebuilding HP Elitebook configuration..."

    # Ensure repository ownership won't cause flake evaluation to fail
    if ! ensure_repo_owned_or_fix; then
      exit 1
    fi

    # If caller asked to run build as the repo owner, perform the nix build as that user
    if [ -n "${BUILD_AS_OWNER:-}" ]; then
      echo "Running flake build as $BUILD_AS_OWNER to avoid ownership checks..."
      sudo -u "$BUILD_AS_OWNER" -H bash -lc "nix --extra-experimental-features 'nix-command flakes' build --print-out-paths '.#nixosConfigurations."1337book".config.system.build.nixos-rebuild' --no-link" || exit 1
      # Get the build result and run the switch as root
      BUILD_OUT=$(sudo -u "$BUILD_AS_OWNER" -H bash -lc "nix --extra-experimental-features 'nix-command flakes' build --print-out-paths '.#nixosConfigurations."1337book".config.system.build.nixos-rebuild' --no-link" | tail -n1)
      echo "Build output: $BUILD_OUT"
      sudo "$BUILD_OUT/bin/switch-to-configuration" switch || exit 1
    else
      # Preferred path: run a user-owned build (so flake evaluation uses your user) then run the switch as root
      echo "Building flake as $(id -un) to avoid ownership errors..."
      BUILD_OUT=$(nix --extra-experimental-features 'nix-command flakes' build --print-out-paths '.#nixosConfigurations."1337book".config.system.build.nixos-rebuild' --no-link 2>/dev/null || true)
      if [ -z "$BUILD_OUT" ]; then
        echo "Flake build failed as $(id -un). This usually indicates an ownership or flake input issue. Consider re-running the script and allowing it to chown the repo, or run the build as the repo owner."
        echo "To manually fix: sudo chown -R $(id -un):$(id -gn) '$repo_root'"
        exit 1
      fi

      BUILD_OUT_PATH=$(echo "$BUILD_OUT" | tail -n1)
      echo "Build output: $BUILD_OUT_PATH"
      sudo "$BUILD_OUT_PATH/bin/switch-to-configuration" switch || exit 1
    fi
    ;;
  work-wsl)
    echo "🖱️  Rebuilding WSL work configuration..."
    sudo nixos-rebuild switch --flake .#work-wsl "${EXTRA_ARGS[@]}"
    ;;
  help)
    echo ""
    echo "Usage: $0 [host] [nixos-rebuild options]"
    echo "Available hosts:"
    echo "  thinker   - ThinkPad with gaming and desktop environment"
    echo "  1337book  - HP Elitebook with gaming and desktop environment"
    echo "  work-wsl  - WSL work environment without gaming"
    echo ""
    echo "Examples:"
    echo "  $0                    # Auto-detect host and rebuild"
    echo "  $0 1337book           # Build specific host"
    echo "  $0 1337book --dry-run # Dry run for specific host"
    echo "  $0 --dry-run          # Auto-detect host and dry run"
    echo ""
    echo "Auto-detection checks:"
    echo "  - WSL environment (/proc/version, WSL_DISTRO_NAME)"
    echo "  - Hostname (Thinker, 1337book, work-wsl)"
    echo "  - ThinkPad hardware (/proc/acpi/ibm/version, lspci)"
    echo "  - HP hardware (lspci, dmidecode)"
    echo "  - Default: thinker"
    exit 0
    ;;
  *)
    echo "❌ Unknown host: $HOST"
    echo ""
    echo "Usage: $0 [host] [nixos-rebuild options]"
    echo "Available hosts:"
    echo "  thinker   - ThinkPad with gaming and desktop environment"
    echo "  1337book  - HP Elitebook with gaming and desktop environment"
    echo "  work-wsl  - WSL work environment without gaming"
    echo ""
    echo "Examples:"
    echo "  $0                    # Auto-detect host and rebuild"
    echo "  $0 1337book           # Build specific host"
    echo "  $0 1337book --dry-run # Dry run for specific host"
    echo "  $0 --dry-run          # Auto-detect host and dry run"
    echo ""
    echo "Auto-detection checks:"
    echo "  - WSL environment (/proc/version, WSL_DISTRO_NAME)"
    echo "  - Hostname (Thinker, 1337book, work-wsl)"
    echo "  - ThinkPad hardware (/proc/acpi/ibm/version, lspci)"
    echo "  - HP hardware (lspci, dmidecode)"
    echo "  - Default: thinker"
    exit 1
    ;;
esac
