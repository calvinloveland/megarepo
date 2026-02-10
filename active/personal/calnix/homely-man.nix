{ config, pkgs, lib, ... }:
{
  # Home Manager user configuration
  home-manager.users.calvin =
    { pkgs, ... }:
    {
      imports = [
        ./home/base.nix
        ./home/notifications.nix
        ./home/kitty.nix
        ./home/sway.nix
        ./home/waybar.nix
        ./home/scripts.nix
      ];
    };
}
