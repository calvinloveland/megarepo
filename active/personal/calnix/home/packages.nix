{ pkgs, ... }:
{
  home.packages = [
    pkgs.atool
    pkgs.httpie
    pkgs.brightnessctl
    pkgs.fuzzel # Wayland app launcher (used for panic recovery menu)
    # Browsers
    pkgs.google-chrome
    # Fonts
    pkgs.fira-code # Fira Code font with ligatures
    pkgs.font-awesome # Required for waybar icons
    pkgs.nerd-fonts.fira-code # Nerd Font version of Fira Code
    pkgs.nerd-fonts.dejavu-sans-mono # Nerd Font version of DejaVu Sans Mono
    # Waybar dependencies
    pkgs.playerctl # For media controls
    pkgs.ncdu # Disk usage analyzer
    pkgs.curl # For weather info
    # Bluetooth utilities
    pkgs.bluetuith # Terminal-based Bluetooth manager
    pkgs.bluez-alsa # ALSA plugin for Bluetooth audio
    # Development tools
    pkgs.vscode # Visual Studio Code editor
    pkgs.kitty # Kitty terminal emulator
    pkgs.nodejs # Node.js with npm
    # GUI file manager (Thunar) and helpers
    pkgs.xfce.thunar
    pkgs.xfce.thunar-volman
    pkgs.xfce.thunar-archive-plugin
    pkgs.xfce.tumbler
    pkgs.file-roller
    pkgs.lxqt.lxqt-policykit
  ];
}
