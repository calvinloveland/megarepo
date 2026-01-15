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

  hardware.enableAllFirmware = true;

  nixpkgs.config.permittedInsecurePackages = [
    "libsoup-2.74.3"
  ];
  # Hostname
  networking.hostName = "1337book";

  # HP Elitebook-specific TLP power management settings
  services.tlp = {
    enable = true;
    settings = {
      CPU_SCALING_GOVERNOR_ON_AC = "performance";
      CPU_ENERGY_PERF_POLICY_ON_AC = "performance";
      CPU_ENERGY_PERF_POLICY_ON_BAT = "balance_performance";

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

}
