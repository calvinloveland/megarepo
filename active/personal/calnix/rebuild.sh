#!/usr/bin/env bash

# Smart multi-host rebuild script for Calvin's NixOS configuration
# Automatically detects the environment and builds the appropriate configuration

detect_host() {
    # Check if running in WSL
    if grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME}" ]; then
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
    #!/usr/bin/env bash

# Use the existing detect_host function from the main script
detect_host() {
    # Check if running in WSL
    if grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME}" ]; then
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
    
    # Default fallback
    echo "thinker"
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
    sudo nixos-rebuild switch --flake .#1337book "${EXTRA_ARGS[@]}"
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
