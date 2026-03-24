{
  config,
  pkgs,
  lib,
  packageHealth,
  ...
}:
let
  packageStates = packageHealth.calnixState.packages or { };
  registry = packageHealth.packageHealthRegistry.packages or { };
  currentRevision = packageHealth.currentNixpkgsRev;
  system = pkgs.stdenv.hostPlatform.system;

  resolveHealthManagedPackage =
    packageName: currentPackage:
    let
      registryEntry = registry.${packageName} or null;
      packageState = packageStates.${packageName} or { };
      activePolicy =
        if registryEntry == null then
          "current"
        else
          packageState.active_policy or registryEntry.defaultPolicy or "current";
      activeRevision = packageState.active_revision or null;
      revisionPackageSet =
        if activePolicy == "revision" && activeRevision != null && activeRevision != currentRevision then
          packageHealth.importPackageSetForRevision system activeRevision
        else
          null;
    in
    if registryEntry == null then
      currentPackage
    else if activePolicy == "revision" && revisionPackageSet != null then
      lib.attrByPath registryEntry.attrPath currentPackage revisionPackageSet
    else if activePolicy == "legacy-darktable-no-avif" && packageName == "darktable" then
      currentPackage.override {
        libavif = null;
      }
    else if activePolicy == "disable-checks" && packageName == "dwarf-fortress-full" then
      currentPackage.overrideAttrs (_: {
        doCheck = false;
        doInstallCheck = false;
      })
    else
      currentPackage;

  darktablePackage = resolveHealthManagedPackage "darktable" pkgs.darktable;
  dwarfFortressPackage =
    resolveHealthManagedPackage "dwarf-fortress-full" pkgs.dwarf-fortress-packages.dwarf-fortress-full;
in
{
  options = {
    calnix.enableDwarfFortress = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable Dwarf Fortress (with dfhack). If the current nixpkgs version regresses, use `calnix package mark-failing dwarf-fortress-full` to activate the health-managed fallback policy.";
    };
  };

  config = {
    # Gaming-related packages
    environment.systemPackages = with pkgs; [
    # Game Development
    # Godot installed via Flatpak to avoid patchelf issues
    flatpak # Package manager for sandboxed applications
    blender # 3D modeling, animation, and asset creation
    audacity # Audio editing for game sounds
    gimp # Image editing and texture creation
    aseprite # Pixel art editor (great for 2D games)
    inkscape # Vector graphics editor for UI and icons
    darktablePackage # RAW photo processing for textures; fallback policy is health-managed

  # Games (conditional)
  ] ++ lib.optional config.calnix.enableDwarfFortress dwarfFortressPackage ++ [

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
