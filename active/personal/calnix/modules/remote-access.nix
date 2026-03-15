{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [ mosh ];

  services.openssh = {
    enable = true;
    openFirewall = false;
    settings = {
      PermitRootLogin = "no";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PubkeyAuthentication = true;
      X11Forwarding = false;
    };
  };

  services.tailscale.enable = true;

  networking.firewall = {
    checkReversePath = "loose";
    interfaces.tailscale0 = {
      allowedTCPPorts = [ 22 ];
      allowedUDPPortRanges = [
        {
          from = 60000;
          to = 61000;
        }
      ];
    };
  };
}
