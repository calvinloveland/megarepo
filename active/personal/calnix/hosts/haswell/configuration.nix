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

  # Allow unfree firmware
  nixpkgs.config.allowUnfree = true;

  # Enable all firmware for broad hardware support
  hardware.enableAllFirmware = true;

  # Bootloader — systemd-boot for UEFI
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  system.stateVersion = "25.05";

  # Keep the install lean — server doesn't need docs
  documentation.doc.enable = false;
  documentation.info.enable = false;
  documentation.man.enable = false;

  # Networking — wired NIC auto-configure
  networking.networkmanager.enable = true;
  networking.useDHCP = lib.mkDefault true;

  # Auto-mount the old HDD for file access
  services.udisks2.enable = true;
  services.devmon.enable = true;

  # The calvin user is created by base.nix; ensure the SSH key works
  users.users.calvin.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDwix44A6TqqGOokU/gIpaf3shN0Pad+S08M36flhBZv calvin@loveland.dev"
  ];
}
