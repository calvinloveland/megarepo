{
  config,
  pkgs,
  lib,
  ...
}:
let
  cfg = config.calnix.bootstrap.connectivity;
in
{
  options.calnix.bootstrap.connectivity = {
    enable = lib.mkEnableOption "bootstrap live-image connectivity";
  };

  config = lib.mkIf cfg.enable {
    # NetworkManager for both Ethernet (DHCP) and Wi-Fi onboarding
    networking.networkmanager.enable = true;

    # mDNS for same-LAN discovery ("bootstrap.local")
    services.avahi = {
      enable = true;
      nssmdns4 = true;
      publish = {
        enable = true;
        addresses = true;
        workstation = true;
        domain = true;
      };
    };

    # Tools useful for connectivity debugging
    environment.systemPackages = with pkgs; [
      networkmanagerapplet # nm-applet tray icon (if DE present)
      nmap # network scanning
      iw # wireless tools
      ethtool
      bind.dnsutils # dig, nslookup
      inetutils # ping, traceroute
      ldns # drill for DNS debugging
    ];

    # Console status: show boot-time connectivity info on tty1
    systemd.services.bootstrap-console-status = let
      showStatus = pkgs.writeShellScript "bootstrap-show-status" ''
        set -euo pipefail

        # Wait for NetworkManager to be ready
        for i in $(seq 1 30); do
          if ${pkgs.networkmanager}/bin/nm-online -q 2>/dev/null; then
            break
          fi
          sleep 1
        done

        ETHERNET_IFACES=$(${pkgs.networkmanager}/bin/nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | ${pkgs.gnugrep}/bin/grep ':ethernet:connected' | ${pkgs.coreutils}/bin/cut -d: -f1)
        WIFI_IFACES=$(${pkgs.networkmanager}/bin/nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null | ${pkgs.gnugrep}/bin/grep ':wifi:connected' | ${pkgs.coreutils}/bin/cut -d: -f1)

        ETHERNET_IP=""
        for iface in $ETHERNET_IFACES; do
          IP=$(${pkgs.networkmanager}/bin/nmcli -t -f IP4.ADDRESS device show "$iface" 2>/dev/null | ${pkgs.coreutils}/bin/head -1 | ${pkgs.gnused}/bin/sed 's/IP4.ADDRESS\[1\]://')
          if [ -n "$IP" ]; then
            ETHERNET_IP="$IP"
            break
          fi
        done

        WIFI_IP=""
        for iface in $WIFI_IFACES; do
          IP=$(${pkgs.networkmanager}/bin/nmcli -t -f IP4.ADDRESS device show "$iface" 2>/dev/null | ${pkgs.coreutils}/bin/head -1 | ${pkgs.gnused}/bin/sed 's/IP4.ADDRESS\[1\]://')
          if [ -n "$IP" ]; then
            WIFI_IP="$IP"
            break
          fi
        done

        TAILSCALE_IP=$(${pkgs.tailscale}/bin/tailscale status --json 2>/dev/null | ${pkgs.jq}/bin/jq -r '.Self.TailscaleIPs[0] // empty' 2>/dev/null || true)

        SSH_FP=$(${pkgs.openssh}/bin/ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | ${pkgs.coreutils}/bin/cut -d' ' -f2 || echo "N/A")

        cat <<STATUS

        ========================================
          Calnix Bootstrap Image
        ========================================

        Ethernet:  $([ -n "$ETHERNET_IP" ] && echo "connected ($ETHERNET_IP)" || echo "not connected")
        Wi-Fi:     $([ -n "$WIFI_IP" ] && echo "connected ($WIFI_IP)" || echo "not configured — run: nmtui")
        Tailnet:   $([ -n "$TAILSCALE_IP" ] && echo "connected ($TAILSCALE_IP)" || echo "waiting — provide auth key")
        SSH:       $([ -n "$ETHERNET_IP" ] && echo "bootstrap@$ETHERNET_IP" || echo "awaiting network")
        Fingerprint: $SSH_FP

        Local commands:
          nmtui        — configure Wi-Fi interactively
          bootstrapctl — show status and machine info
          tailscale up --auth-key KEY  — join tailnet

        ========================================
STATUS
      '';
    in {
      description = "Show bootstrap connectivity status on console";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" "NetworkManager.service" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "${pkgs.coreutils}/bin/cat ${showStatus} > /dev/tty1 2>/dev/null || true";
        StandardOutput = "null";
        StandardError = "journal+console";
      };
    };
  };
}
