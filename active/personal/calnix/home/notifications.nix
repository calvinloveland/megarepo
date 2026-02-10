{ ... }:
{
  # Mako notification daemon configuration
  services.mako = {
    enable = true;
    settings = {
      default-timeout = 5000; # Notifications auto-dismiss after 5 seconds
      ignore-timeout = false;
      font = "FiraCode Nerd Font Mono 11";
      background-color = "#1e1e2eee";
      text-color = "#cdd6f4";
      border-color = "#89b4fa";
      border-radius = 8;
      border-size = 2;
      padding = "12";
      margin = "12";
      width = 350;
      height = 150;
      icons = true;
      max-icon-size = 48;
      layer = "overlay";
      anchor = "top-right";
    };
    extraConfig = ''
      [urgency=low]
      background-color=#1e1e2ecc
      border-color=#6c7086
      default-timeout=3000

      [urgency=normal]
      background-color=#1e1e2eee
      border-color=#89b4fa
      default-timeout=5000

      [urgency=critical]
      background-color=#f38ba8ee
      border-color=#f38ba8
      text-color=#1e1e2e
      default-timeout=0
    '';
  };
}
