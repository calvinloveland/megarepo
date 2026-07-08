{
  config,
  pkgs,
  lib,
  ...
}:
{
  imports = [
    ./hardware-configuration.nix
    ../../modules/base.nix
    ../../modules/desktop.nix
    ../../modules/gaming.nix
    ../../modules/openvino.nix
    ../../homely-man.nix
    ../../python-dev.nix
  ];

  # Disable documentation to work around Python 3.12 doc build issue
  documentation.enable = false;
  documentation.man.enable = lib.mkForce false;
  documentation.doc.enable = false;
  documentation.info.enable = false;

  hardware.enableAllFirmware = true;

  nixpkgs.config.permittedInsecurePackages = [
    "libsoup-2.74.3"
  ];
  # Hostname
  networking.hostName = "1337book";

  # KiCad EDA for PCB design
  environment.systemPackages = with pkgs; [ kicad ];

  # HP Elitebook-specific TLP power management settings
  services.tlp = {
    enable = true;
    settings = {
      CPU_SCALING_GOVERNOR_ON_AC = "performance";
      CPU_ENERGY_PERF_POLICY_ON_AC = "performance";
      CPU_ENERGY_PERF_POLICY_ON_BAT = "balance_performance";

      # Prevent USB autosuspend from interrupting phone charging
      USB_AUTOSUSPEND = 0;

      # Battery health optimization (HP Elitebook specific)
      START_CHARGE_THRESH_BAT0 = 75;
      STOP_CHARGE_THRESH_BAT0 = 85;
    };
  };

  # HP-specific optimizations
  # Enable fwupd for firmware updates (HP has good Linux support)
  services.fwupd.enable = true;

  # File manager support services
  services.gvfs.enable = true; # Trash, network shares, MTP
  security.polkit.enable = true; # Polkit backend; agent started via Home Manager

  calnix.openvino.enable = true;

  # Warden per-host monitoring agent
  calnix.warden = {
    enable = true;

    checks = {
      disk-usage = {
        enable = true;
        interval = "hourly";
        thresholds = { warn = 80; fail = 95; };
      };
      memory = {
        enable = true;
        interval = "hourly";
        thresholds = { warn = 80; fail = 95; };
      };
      temperature = {
        enable = true;
        interval = "*:0/10";
        thresholds = { warn = 75; fail = 90; };
      };
      systemd-health = {
        enable = true;
        interval = "hourly";
      };
      peer-health = {
        enable = true;
        interval = "*:0/5";
      };
      system-config = {
        enable = true;
        interval = "daily";
        thresholds = { warn_days = 1; fail_days = 7; };
      };
    };

    autoRemediate.enable = true;
    pi.enable = true;
    pi.autopilot.enable = true;
    peerApi.enable = true;

    peers = {
      haswell = { host = "haswell"; enabled = true; };
      thinker = { host = "thinker"; enabled = true; };
    };

    # Backups — back up to haswell server via restic/SFTP
    backups = {
      enable = true;
      repositories = {
        haswell = {
          enable = true;
          type = "sftp";
          host = "haswell";
          path = "/data/backups/warden/1337book";
          schedule = "daily";
          paths = [
            "/home/calvin"
            "/etc/nixos"
            "/var/lib/calnix"
            "/var/lib/warden"
          ];
          exclude = [ "*.cache" "node_modules" ".venv" "__pycache__" "Downloads" "go" ".rustup" ];
        };
      };
    };

    # HomeCluster — leaf node
    homecluster = {
      enable = true;
      clusterRole = "leaf";
      objectStore.enable = true;
    };
  };
}
