{
  config,
  pkgs,
  lib,
  ...
}:
let
  intelNpuDriverHelper = pkgs.writeShellApplication {
    name = "intel-npu-driver-helper";
    runtimeInputs = [
      pkgs.git
      pkgs.coreutils
      pkgs.gnugrep
      pkgs.gnused
      pkgs.findutils
    ];
    text = ''
            set -euo pipefail

            CACHE_DIR="''${XDG_CACHE_HOME:-$HOME/.cache}"
            WORKTREE="$CACHE_DIR/intel-linux-npu-driver"
            REPO_URL="https://github.com/intel/linux-npu-driver.git"

            if [ ! -d "$WORKTREE/.git" ]; then
              echo "[intel-npu] Cloning $REPO_URL into $WORKTREE"
              mkdir -p "$CACHE_DIR"
              git clone --depth 1 "$REPO_URL" "$WORKTREE"
            else
              echo "[intel-npu] Updating driver sources in $WORKTREE"
              git -C "$WORKTREE" pull --ff-only
            fi

            action="''${1:---help}"
            case "$action" in
              --install)
                echo "[intel-npu] Running driver installer (sudo access required)"
                sudo "$WORKTREE"/drivers/setup.sh install
                ;;
              --uninstall)
                echo "[intel-npu] Removing Intel NPU driver"
                sudo "$WORKTREE"/drivers/setup.sh uninstall
                ;;
              --status)
                echo "[intel-npu] Kernel modules matching 'xe' or 'intel_npu'"
                (lsmod | grep -E '^(xe|intel_npu)' ) || echo "(none loaded)"
                echo
                echo "Working tree: $WORKTREE"
                echo "Tip: run 'intel-npu-driver-helper --install' to deploy"
                ;;
              --help|-h|--*)
                cat <<'EOF'
      intel-npu-driver-helper --status|--install|--uninstall

        --status     Show currently loaded Intel graphics/NPU modules and repo path
        --install    Run Intel's drivers/setup.sh install helper with sudo
        --uninstall  Remove previously installed Intel NPU kernel modules

      Driver sources are mirrored under ''${XDG_CACHE_HOME:-$HOME/.cache}/intel-linux-npu-driver.
      EOF
                ;;
              *)
                exec "$WORKTREE"/drivers/setup.sh "$@"
                ;;
            esac
    '';
  };

  searxSearch = pkgs.writeShellApplication {
    name = "searx-search";
    runtimeInputs = [
      pkgs.curl
      pkgs.python3
    ];
    text = ''
            set -euo pipefail

            format="pretty"
            if [ "''${1:-}" = "--json" ]; then
              format="json"
              shift
            fi

            if [ "$#" -eq 0 ]; then
              cat >&2 <<'EOF'
      Usage: searx-search [--json] QUERY...

      Searches the local SearXNG instance running on http://127.0.0.1:8888.
      Use --json to print the raw API response.
      EOF
              exit 1
            fi

            response=$(curl --fail --silent --show-error \
              --request POST \
              http://127.0.0.1:8888/search \
              --data-urlencode "q=$*" \
              --data-urlencode "format=json") || {
              echo "[searx-search] Could not reach local SearXNG on http://127.0.0.1:8888" >&2
              echo "[searx-search] Check: systemctl status searx.service" >&2
              exit 1
            }

            if [ "$format" = "json" ]; then
              printf '%s\n' "$response"
              exit 0
            fi

            RESPONSE="$response" python3 - <<'PY'
      import json
      import os
      import sys

      payload = json.loads(os.environ["RESPONSE"])
      results = payload.get("results", [])
      if not results:
          print("No results.")
          sys.exit(0)

      for index, result in enumerate(results[:10], start=1):
          title = (result.get("title") or "(untitled)").replace("\n", " ").strip()
          url = (result.get("url") or "").strip()
          content = (result.get("content") or "").replace("\n", " ").strip()
          print(f"{index}. {title}")
          if url:
              print(f"   {url}")
          if content:
              print(f"   {content}")
          print()
      PY
    '';
  };

  usrLocalLibPaths = [
    "/usr/local/lib64"
    "/usr/local/lib"
  ];
  usrLocalLibPathString = lib.concatStringsSep ":" usrLocalLibPaths;
in
{
  imports = [
    ./calnix.nix
    ./remote-access.nix
    ./warden/warden.nix
  ];

  # Enable parallel building for faster compilation
  nix.settings = {
    max-jobs = "auto"; # Use all available CPU cores
    cores = 0; # Use all available CPU cores for each job
    experimental-features = [
      "nix-command"
      "flakes"
    ];
  };

  nixpkgs.config.allowUnfree = true;

  services.searx = {
    enable = true;
    settings = {
      server = {
        bind_address = "127.0.0.1";
        port = 8888;
        base_url = "http://127.0.0.1:8888/";
        secret_key = "calnix-local-searxng-only";
      };
      search.formats = [
        "html"
        "json"
      ];
    };
  };

  # Let home-manager reuse the system's pkgs so that nixpkgs overlays
  # (e.g. githubCopilotCliOverlay) are applied to user packages as well.
  home-manager.useGlobalPkgs = true;

  # Common packages for all hosts
  environment.systemPackages = with pkgs; [
    # Fonts for proper terminal display
    dejavu_fonts # Includes DejaVu Sans Mono
    liberation_ttf # Liberation Mono - excellent terminal font
    font-awesome # For icons in status bars
    fira-code # Fira Code font with ligatures
    nerd-fonts.fira-code # Nerd Font version of Fira Code
    nerd-fonts.dejavu-sans-mono # Nerd Font version of DejaVu Sans Mono

    # Essential tools
    git # version control
    gh # github cli w/ copilot
    codex # OpenAI Codex CLI
    wl-clipboard # wl-copy and wl-paste for copy/paste from stdin / stdout
    xdg-utils # xdg-open for opening URLs/files with default applications

    # Archive tools
    atool
    zip
    xz
    unzip

    # Search and file tools
    ripgrep # fast grep search
    file
    which
    tree
    gnused
    gnutar
    gawk
    zstd
    zlib
    gnupg

    # System monitoring
    btop # hardware monitor
    fastfetch # system info

    # Network and storage tools
    cifs-utils # SMB/CIFS mounting for NAS access
    rsync # efficient file synchronization
    exfat # Support for exFAT filesystems (cameras, etc.)
    httpie
    searxng

    # Development tools
    ollama # AI model serving
    nixfmt-tree
    treefmt # unified code formatter

    # Utilities
    cowsay
    glow # markdown viewer
    wget
    curl
    nixfmt # nix formatter
    home-manager # manage homes

    intelNpuDriverHelper
    searxSearch
  ];

  # Common programs
  programs.fish.enable = true;
  programs.fish.shellInit = ''
    set -l __calnix_ld_library_path_warn_limit 65536

    # Add /usr/local/lib paths if not already present (prevents env bloat)
    for libpath in ${usrLocalLibPathString}
      if set -q LD_LIBRARY_PATH
        if not contains -- $libpath $LD_LIBRARY_PATH
          set -gx LD_LIBRARY_PATH $libpath $LD_LIBRARY_PATH
        end
      else
        set -gx LD_LIBRARY_PATH $libpath
      end
    end

    if set -q LD_LIBRARY_PATH
      if not set -q CALNIX_WARNED_LD_LIBRARY_PATH_BLOAT
        set -l __calnix_ld_library_path_joined (string join : -- $LD_LIBRARY_PATH)
        set -l __calnix_ld_library_path_len (string length -- $__calnix_ld_library_path_joined)
        if test $__calnix_ld_library_path_len -gt $__calnix_ld_library_path_warn_limit
          echo "[calnix] WARNING: LD_LIBRARY_PATH is very large ($__calnix_ld_library_path_len bytes)."
          echo "[calnix] This can break process launches (ARG_MAX). Run: set -e LD_LIBRARY_PATH"
          set -gx CALNIX_WARNED_LD_LIBRARY_PATH_BLOAT 1
        end
      end
    end

    set -e __calnix_ld_library_path_warn_limit
  '';
  programs.ssh.startAgent = true;
  programs.neovim.enable = true;

  environment.extraInit = ''
    # Add /usr/local/lib paths if not already present (prevents env bloat)
    for _libpath in ${usrLocalLibPathString}; do
      case ":''${LD_LIBRARY_PATH:-}:" in
        *":$_libpath:"*) ;;
        *) export LD_LIBRARY_PATH="$_libpath:''${LD_LIBRARY_PATH:-}" ;;
      esac
    done
    unset _libpath
  '';

  # User configuration
  users.users.calvin = {
    isNormalUser = true;
    initialPassword = "12345";
    extraGroups = [
      "wheel"
      "networkmanager"
      "audio"
      "video"
      "render"
      "input"
      "dialout" # Serial/USB programming (e.g. radios)
      "scanner" # Access to SANE scanner devices
    ];
    shell = pkgs.fish;
  };

  # Docker (common for development)
  virtualisation.docker = {
    enable = true;
    rootless = {
      enable = true;
      setSocketVariable = true;
    };
  };

  system.stateVersion = "25.05";
}
