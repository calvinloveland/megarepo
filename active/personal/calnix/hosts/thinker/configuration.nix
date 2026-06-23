{
  config,
  pkgs,
  lib,
  ...
}:
{
  # ThinkPad (Thinker) NixOS host configuration
  imports = [
    ./hardware-configuration.nix
    ../../modules/base.nix
    ../../modules/desktop.nix
    ../../modules/gaming.nix
    ../../homely-man.nix
    ../../python-dev.nix
  ];

  # Disable documentation to avoid Python 3.12 doc build issues
  documentation.enable = false;
  documentation.man.enable = lib.mkForce false;
  documentation.doc.enable = false;
  documentation.info.enable = false;

  hardware.enableAllFirmware = true;

  # Hostname
  networking.hostName = "thinker";

  # Ensure the hostname `thinker` resolves to the LAN IP 192.168.1.191
  networking.hosts = {
    thinker = [ "192.168.1.191" ];
  };

  # ThinkPad-specific options could go here (TLP, ACPI tweaks, etc.)

  # SSH — enable LAN access for remote management
  services.openssh = {
    enable = true;
    openFirewall = true;
    settings = {
      PermitRootLogin = "no";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PubkeyAuthentication = true;
    };
  };

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

    # HomeCluster — leaf node
    homecluster = {
      enable = true;
      clusterRole = "leaf";
      objectStore.enable = true;
    };
  };
}
