{
  config,
  pkgs,
  lib,
  ...
}:
{
  # ThinkPad (Thinker) NixOS host configuration
  imports = [
    ../../modules/base.nix
    ../../modules/desktop.nix
    ../../modules/gaming.nix
    ../../homely-man.nix
    ../../python-dev.nix
  ];

  hardware.enableAllFirmware = true;

  # Disable documentation to avoid Python 3.12 doc build issues
  documentation.enable = false;
  documentation.man.enable = lib.mkForce false;
  documentation.doc.enable = false;
  documentation.info.enable = false;

  # Hostname
  networking.hostName = "thinker";

  # Ensure the hostname `thinker` resolves to the LAN IP 192.168.1.191
  networking.hosts = {
    thinker = [ "192.168.1.191" ];
  };

  # Provide a default root filesystem to satisfy flake evaluation.
  # This will be overridden by hardware-configuration.nix if present.
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  # ThinkPad-specific options could go here (TLP, ACPI tweaks, etc.)

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
      };
      temperature = {
        enable = true;
        interval = "10min";
        thresholds = { warn = 75; fail = 90; };
      };
      systemd-health = {
        enable = true;
        interval = "hourly";
      };
    };

    autoRemediate.enable = true;
    pi.enable = true;
    peerApi.enable = true;

    peers = {
      haswell = { host = "haswell"; enabled = true; };
      "1337book" = { host = "1337book"; enabled = true; };
    };

    # Backups — back up to haswell server via restic/SFTP
    backups = {
      enable = true;
      repositories = {
        haswell = {
          enable = true;
          type = "sftp";
          host = "haswell";
          path = "/data/backups/warden/thinker";
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
  };
}
