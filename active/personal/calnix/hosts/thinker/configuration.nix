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
}
