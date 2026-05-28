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
  ];

  # Hostname — old Haswell-era desktop repurposed as server
  networking.hostName = "haswell";

  # Resolve hostname to static LAN IP
  networking.hosts = {
    haswell = [ "192.168.1.168" ];
  };

  # Enable all firmware for broad hardware support
  hardware.enableAllFirmware = true;

  # Bootloader — systemd-boot for UEFI
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # Disable documentation to work around Python 3.12 doc build issue
  documentation.enable = false;
  documentation.man.enable = lib.mkForce false;
  documentation.doc.enable = false;
  documentation.info.enable = false;

  # Networking — wired NIC auto-configure
  networking.networkmanager.enable = true;
  networking.useDHCP = lib.mkDefault true;

  # Auto-mount the old HDD for file access
  services.udisks2.enable = true;
  services.devmon.enable = true;

  # Warden per-host monitoring agent
  calnix.warden = {
    enable = true;

    checks = {
      disk-usage = {
        enable = true;
        interval = "hourly";
        thresholds = { warn = 80; fail = 95; };
        exclude = [ "/boot" ];
      };
      memory = {
        enable = true;
        interval = "hourly";
        thresholds = { warn = 80; fail = 95; };
      };
      temperature = {
        enable = true;
        interval = "*:0/10";
        thresholds = { warn = 70; fail = 85; };
      };
      systemd-health = {
        enable = true;
        interval = "hourly";
      };
      peer-health = {
        enable = true;
        interval = "*:0/5";
      };
      cross-host-disks = {
        enable = true;
        interval = "*:0/15";
        thresholds = { warn = 80; fail = 90; };
        extraConfig = { migration_root = "/data/migrated"; };
      };
      system-config = {
        enable = true;
        interval = "daily";
        thresholds = { warn_days = 1; fail_days = 7; };
      };
    };

    # Auto-remediate failing checks
    autoRemediate.enable = true;

    # Pi integration — loads pi-warden extension automatically
    pi.enable = true;
    pi.autopilot.enable = true;  # Persistent headless Warden agent

    # Peer API — enables other wardens to query this host
    peerApi.enable = true;

    # Web dashboard — aggregated view of all hosts
    dashboard.enable = true;

    # Backups — haswell is the backup server (has 8TB HDD at /data)
    backups = {
      enable = true;
      repositories = {
        local-data = {
          enable = true;
          type = "local";
          path = "/data/backups/warden/haswell";
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

    # Known peers
    peers = {
      thinker = { host = "thinker"; enabled = true; };
      "1337book" = { host = "1337book"; enabled = true; };
    };
  };

  # Root password for emergency console access (local only — SSH blocks root)
  users.users.root.hashedPassword = "";

  # Allow emergency shell if boot fails
  boot.initrd.systemd.emergencyAccess = true;

  # Create backup root directory for local and peer backups
  systemd.tmpfiles.rules = [
    "d /data/backups/warden 0775 warden warden - -"
    "d /data/backups/warden/haswell 0775 warden warden - -"
    "d /data/backups/warden/thinker 0775 warden warden - -"
    "d /data/backups/warden/1337book 0775 warden warden - -"
    "Z /data/backups/warden 0775 warden warden - -"
    "Z /data/backups/warden/haswell 0775 warden warden - -"
    "Z /data/backups/warden/thinker 0775 warden warden - -"
    "Z /data/backups/warden/1337book 0775 warden warden - -"
  ];
}
