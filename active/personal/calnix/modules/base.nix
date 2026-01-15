{
  config,
  pkgs,
  lib,
  ...
}:
let
  intelNpuDriverHelper = pkgs.writeShellApplication {
    name = "intel-npu-driver-helper";
    runtimeInputs = [ pkgs.git pkgs.coreutils pkgs.gnugrep pkgs.gnused pkgs.findutils ];
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

  usrLocalLibPaths = [ "/usr/local/lib64" "/usr/local/lib" ];
  usrLocalLibPathString = lib.concatStringsSep ":" usrLocalLibPaths;
in
{
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

  # Common packages for all hosts
  environment.systemPackages = with pkgs; [
    # Fonts for proper terminal display
    dejavu_fonts # Includes DejaVu Sans Mono
    liberation_ttf # Liberation Mono - excellent terminal font
    font-awesome # For icons in status bars

    # Essential tools
    git # version control
    gh # github cli w/ copilot
    wl-clipboard # wl-copy and wl-paste for copy/paste from stdin / stdout

    # Archive tools
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

    # Development tools
    ollama # AI model serving
    nixfmt-tree
    treefmt # unified code formatter

    # Utilities
    cowsay
    glow # markdown viewer
    wget
    nixfmt-rfc-style # nix formatter
    home-manager # manage homes

    calibre # ebook management
    intelNpuDriverHelper
  ];

  # Common programs
  programs.fish.enable = true;
  programs.fish.shellInit = ''
    if test -n "$LD_LIBRARY_PATH"
      set -gx LD_LIBRARY_PATH ${usrLocalLibPathString}:$LD_LIBRARY_PATH
    else
      set -gx LD_LIBRARY_PATH ${usrLocalLibPathString}
    end
  '';
  programs.ssh.startAgent = true;
  programs.neovim.enable = true;

  environment.extraInit = ''
    export LD_LIBRARY_PATH=${usrLocalLibPathString}:''${LD_LIBRARY_PATH-}
  '';

  # User configuration
  users.users.calvin = {
    isNormalUser = true;
    initialPassword = "12345";
    extraGroups = [
      "wheel"
      "networkmanager"
      "video"
      "render"
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
