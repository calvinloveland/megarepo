{
  config,
  pkgs,
  lib,
  ...
}:
{
  # Desktop environment configuration shared by all desktop hosts
  # (thinker and 1337book) - excludes work-wsl

  # Import audio configuration module
  imports = [
    ./audio.nix
  ];

  # Home Manager configuration
  home-manager.backupFileExtension = "backup";

  # Standard boot configuration for desktop hosts
  boot.kernelPackages = pkgs.linuxPackages_latest;
  boot.loader.systemd-boot.enable = true;
  boot.loader.systemd-boot.consoleMode = "auto";
  boot.loader.efi.canTouchEfiVariables = true;

  # Network configuration
  networking.networkmanager.enable = true;

  # Desktop packages common to all desktop hosts
  environment.systemPackages = with pkgs; [
    # Color scheme generation from wallpapers
    pywal
    imagemagick # Required for pywal color generation

    # Bluetooth packages
    bluez
    bluez-tools
    blueberry # Bluetooth manager GUI

    # Wayland/Sway specific
    grim # screenshot functionality
    slurp # screenshot functionality
    rofi # launcher
    mako # notification system developed by swaywm maintainer
    swaybg # set background
    wluma # backlight control
    waybar # status bar with CPU and power monitoring

    # Power monitoring tools for waybar
    powertop # Advanced power usage statistics
    acpi # Battery information
    lm_sensors # Hardware monitoring (CPU temp, fan speeds)

    # Desktop applications
    alacritty # terminal emulator
    firefox # browser
    google-chrome # Google has their hooks in me
    fortune-kind # good fortunes
    libreoffice # Office suite for documents, spreadsheets, presentations
    naps2 # Document scanning workflow
    chirp # Radio programming tool
    (handbrake.override { useGtk = true; }) # HandBrake GUI build
    (writeShellScriptBin "handbrake" ''exec ${handbrake}/bin/ghb "$@"'') # Friendly GUI launcher
    kdePackages.k3b # KDE disc burning suite
    sane-backends # CLI tools for verifying scanner access

    # Video editing and media
    vlc # Video player and basic editing
    ffmpeg # CLI video processing and stitching tool

    # System management
    bashmount # Interactive mount manager for USB drives

    orca-slicer # Slicer for 3d printing
  ];

  # Enable Bluetooth
  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
    settings = {
      General = {
        Enable = "Source,Sink,Media,Socket";
        Experimental = true;
      };
    };
  };
  # Scanner support for USB/Wi-Fi devices such as the Epson ET-2850
  hardware.sane = {
    enable = true;
    extraBackends = with pkgs; [
      epkowa # Legacy Epson backend covering ET-2850 USB
      epsonscan2 # Epson Scan 2 for newer multifunction devices
      sane-airscan # AirScan/eSCL for network discovery
    ];
  };
  services.udev.packages = with pkgs; [ epkowa epsonscan2 ];
  environment.etc."sane.d/dll.conf".text =
    let
      baseDllConf = builtins.readFile "${pkgs.sane-backends}/etc/sane.d/dll.conf";
    in
    baseDllConf + ''
epkowa
epsonscan2
airscan
'';
  environment.sessionVariables.SANE_CONFIG_DIR =
    lib.mkForce "/etc/sane.d:${pkgs.sane-backends}/etc/sane.d";


  # Common desktop services
  services.blueman.enable = true;
  services.udisks2.enable = true;

  # Timezone management
  # services.tzupdate = {
  #   enable = true;
  # };

  # Enable location services for timezone
  location.provider = "geoclue2";
  services.geoclue2.enable = true;

  # Enable Sway
  programs.sway = {
    enable = true;
    wrapperFeatures.gtk = true;
    extraPackages = with pkgs; [
      swaylock
      swayidle
      wl-clipboard
      mako
      brightnessctl
      grim
      slurp
      rofi
      waybar # Add waybar to Sway extras
    ];
  };

  # Enable XDG desktop portal for screen sharing
  xdg.portal = {
    enable = true;
    wlr.enable = true;
    extraPortals = [ pkgs.xdg-desktop-portal-gtk ];
  };
  
  # GTK configuration
  programs.dconf.enable = true;
  environment.pathsToLink = [ "/libexec" ]; # for GTK apps

  # Touchpad configuration
  services.libinput = {
    enable = true;
    touchpad = {
      tapping = true; # Enable tap to click
      clickMethod = "clickfinger"; # Use 1/2/3 finger clicks for left/right/middle button
      tappingDragLock = true; # Enable double tap to drag
      naturalScrolling = true; # Use natural scrolling direction
      disableWhileTyping = true; # Disable touchpad while typing
      accelSpeed = 0.2; # Adjust pointer acceleration
    };
  };
}
