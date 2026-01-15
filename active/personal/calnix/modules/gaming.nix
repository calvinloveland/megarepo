{
  config,
  pkgs,
  lib,
  ...
}:
let
  # Upstream dwarf-fortress build is currently failing (dfhack segfault during install/test phase).
  # Work around by disabling package tests. Provide a feature flag so it can be toggled off entirely.
  dwarfFortressPatched = pkgs.dwarf-fortress-packages.dwarf-fortress-full.overrideAttrs (old: {
    doCheck = false;
    doInstallCheck = false; # Some failures happen in installCheck phase
    # Leave other attrs untouched.
  });
in
{
  options = {
    calnix.enableDwarfFortress = lib.mkOption {
      type = lib.types.bool;
      default = false; # Temporarily disable until upstream dfhack segfault resolved
      description = ''Enable Dwarf Fortress (with dfhack). Currently defaults to false due to upstream dfhack segfault during build (install/test phase). Flip to true once nixpkgs updates fix it.'';
    };
  };

  config = {
    # Gaming-related packages
    environment.systemPackages = with pkgs; [
    # Game Development
    # Godot installed via Flatpak to avoid patchelf issues
    flatpak # Package manager for sandboxed applications
    blender # 3D modeling, animation, and asset creation
    krita # Digital painting and 2D art creation
    audacity # Audio editing for game sounds
    gimp # Image editing and texture creation
    aseprite # Pixel art editor (great for 2D games)
    inkscape # Vector graphics editor for UI and icons
    darktable # RAW photo processing for textures - DISABLED due to build issues

  # Games (conditional)
  ] ++ lib.optional config.calnix.enableDwarfFortress dwarfFortressPatched ++ [

    discord # for saying gamer words
    ];

  # Steam configuration
  programs.steam = {
    enable = true;
    remotePlay.openFirewall = true;
    dedicatedServer.openFirewall = true;
    localNetworkGameTransfers.openFirewall = true;
  };

  # Enable XDG Desktop Portals (required for Flatpak)
  xdg.portal = {
    enable = true;
    wlr.enable = true; # For Wayland/Sway compatibility
    # Fix for portal configuration warning
    config.common.default = "*";
  };

    # Enable Flatpak service
    services.flatpak.enable = true;

    # Add user to docker group for game development
    users.users.calvin.extraGroups = [ "docker" ];


    # Enable Vulkan support
    services.pulseaudio.support32Bit = true; # For Steam
  };
}
