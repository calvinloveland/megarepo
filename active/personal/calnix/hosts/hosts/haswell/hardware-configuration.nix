# Hardware configuration for Haswell desktop
# Intel Core i5-4590 / Samsung 850 EVO SSD + WD 8TB HDD
{ config, lib, pkgs, modulesPath, ... }:

{
  imports = [
    (modulesPath + "/installer/scan/not-detected.nix")
  ];

  boot.initrd.availableKernelModules = [
    "xhci_pci"
    "ehci_pci"
    "ahci"
    "usbhid"
    "usb_storage"
    "sd_mod"
  ];
  boot.initrd.kernelModules = [ ];
  boot.kernelModules = [ ];
  boot.extraModulePackages = [ ];

  # SSD root filesystem
  fileSystems."/" = {
    device = "/dev/disk/by-uuid/312db49a-a238-4149-b157-16b20f39b2bb";
    fsType = "ext4";
  };

  # EFI boot partition
  fileSystems."/boot" = {
    device = "/dev/disk/by-uuid/B9CD-E7CA";
    fsType = "vfat";
    options = [ "fmask=0022" "dmask=0022" ];
  };

  # Mount the old HDD as /data — nofail so slow spin-up doesn't halt boot
  fileSystems."/data" = {
    device = "/dev/disk/by-uuid/d80dfe13-ed28-494e-9fe0-4624cddd6944";
    fsType = "ext4";
    options = [ "nofail" "defaults" ];
  };

  swapDevices = [
    {
      device = "/dev/disk/by-uuid/c8d48ecf-2730-4c2f-b847-86e9d1a535cf";
    }
  ];

  nixpkgs.hostPlatform = lib.mkDefault "x86_64-linux";
  hardware.cpu.intel.updateMicrocode = lib.mkDefault config.hardware.enableRedistributableFirmware;
}
