# ThinkPad (Thinker) NixOS hardware configuration
# Generated from remote sysfs probe on 2026-05-28
# Do not modify this file manually — it will be overwritten by nixos-generate-config.

{ config, lib, pkgs, modulesPath, ... }:

{
  imports =
    [ (modulesPath + "/installer/scan/not-detected.nix")
    ];

  boot.initrd.availableKernelModules = [ "nvme" "xhci_pci" "thunderbolt" "usbhid" "usb_storage" "sd_mod" ];
  boot.initrd.kernelModules = [ ];
  boot.kernelModules = [ "kvm-intel" ];
  boot.extraModulePackages = [ ];

  fileSystems."/" =
    { device = "/dev/disk/by-uuid/e9e693b0-425d-4e3d-9eb3-60a92bd76368";
      fsType = "ext4";
    };

  fileSystems."/boot" =
    { device = "/dev/disk/by-uuid/2622-D7B3";
      fsType = "vfat";
      options = [ "fmask=0177" "dmask=0077" ];
    };

  swapDevices =
    [ { device = "/dev/disk/by-uuid/693598bc-cdf0-4299-a163-133a3a51b5c2"; }
    ];

  # Enables DHCP on each ethernet and wireless interface. In case of scripted networking
  # (the default) this is the recommended approach. When using systemd-networkd it's
  # still possible to use this option, but it's recommended to use it in conjunction
  # with explicit per-interface declarations.
  networking.useDHCP = lib.mkDefault true;
  # networking.interfaces.<name>.useDHCP = lib.mkDefault true;

  nixpkgs.hostPlatform = lib.mkDefault "x86_64-linux";
  hardware.cpu.intel.updateMicrocode = lib.mkDefault config.hardware.enableRedistributableFirmware;
}
