{
  config,
  pkgs,
  lib,
  ...
}:
let
  cfg = config.calnix.bootstrap.agent;

  collectFacts = pkgs.writeShellScript "bootstrap-collect-facts" ''
    set -euo pipefail

    echo "{"
    echo "  \"hostname\": \"$(hostname)\","
    echo "  \"kernel\": \"$(uname -r)\","
    echo "  \"arch\": \"$(uname -m)\","
    echo "  \"uptime_seconds\": $(cat /proc/uptime 2>/dev/null | cut -d' ' -f1 || echo 0),"
    echo "  \"memory_mb\": {"
    echo "    \"total\": $(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0),"
    echo "    \"available\": $(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)"
    echo "  },"
    echo "  \"cpu\": {"
    echo "    \"model\": \"$(grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | sed 's/.*: //' || echo 'unknown')\","
    echo "    \"cores\": $(nproc 2>/dev/null || echo 1)"
    echo "  },"
    echo "  \"disks\": ["
    FIRST=true
    for dev in /sys/block/{sd*,nvme*,vd*}; do
      [ -e "$dev" ] || continue
      DEVNAME=$(basename "$dev")
      SIZE=$(${pkgs.coreutils}/bin/blockdev --getsize64 "/dev/$DEVNAME" 2>/dev/null || echo 0)
      MODEL=$(cat "$dev/device/model" 2>/dev/null | ${pkgs.coreutils}/bin/tr -d ' ' || echo "unknown")
      ROTA=$(cat "$dev/queue/rotational" 2>/dev/null || echo 0)
      $FIRST || echo ","
      FIRST=false
      echo "    { \"name\": \"$DEVNAME\", \"size_bytes\": $SIZE, \"model\": \"$MODEL\", \"rotational\": $ROTA }"
    done
    echo "  ],"
    echo "  \"interfaces\": ["
    FIRST=true
    ${pkgs.iproute2}/bin/ip -j link show 2>/dev/null | ${pkgs.jq}/bin/jq -r '.[] | select(.link_type != "loopback") | {name: .ifname, mac: .address, state: .operstate}' | while read line; do
      $FIRST || echo ","
      FIRST=false
      echo -n "    $line"
    done
    echo "  ],"
    echo "  \"gpu\": ["
    FIRST=true
    if command -v ${pkgs.pciutils}/bin/lspci &>/dev/null; then
      ${pkgs.pciutils}/bin/lspci -mm 2>/dev/null | ${pkgs.gnugrep}/bin/grep -i 'vga\|3d\|display' | while read line; do
        $FIRST || echo ","
        FIRST=false
        DESC=$(echo "$line" | ${pkgs.coreutils}/bin/cut -d'"' -f6)
        echo "    { \"description\": \"$DESC\" }"
      done
    fi
    echo "  ],"
    echo "  \"firmware\": \"$(cat /sys/firmware/efi/fw_platform_size 2>/dev/null || echo 'bios')\","
    echo "  \"secure_boot\": $(cat /sys/kernel/security/securelevel 2>/dev/null || echo 0)"
    echo "}"
  '';

in
{
  options.calnix.bootstrap.agent = {
    enable = lib.mkEnableOption "bootstrap live-image facts and enrollment agent";
  };

  config = lib.mkIf cfg.enable {
    # Write the facts collector script somewhere accessible
    environment.etc."calnix/bootstrap-facts.json".source = pkgs.runCommand "bootstrap-facts-default" { } ''
      ${collectFacts} > "$out" 2>/dev/null || echo '{"error": "facts not available at build time"}' > "$out"
    '';

    # A convenience CLI + diagnostic tools for the live image
    environment.systemPackages = with pkgs; [
      pciutils # lspci
      usbutils # lsusb
      dmidecode
      jq
      iproute2
      (pkgs.writeShellApplication {
        name = "bootstrapctl";
        runtimeInputs = with pkgs; [ coreutils gnugrep gnused jq openssh pciutils dmidecode iproute2 ];
        text = ''
          set -euo pipefail

          case "''${1:-status}" in
            status)
              echo "=== Calnix Bootstrap Agent ==="
              echo "Hostname: $(hostname)"
              echo "Uptime:   $(uptime -p)"
              echo "IP addrs:"
              ${pkgs.iproute2}/bin/ip -4 -br addr show 2>/dev/null | ${pkgs.gnugrep}/bin/grep -v '127.0.0.1' || true
              echo
              echo "RAM:      $(grep MemTotal /proc/meminfo | awk '{print $2" "$3}') total, $(grep MemAvailable /proc/meminfo | awk '{print $2" "$3}') available"
              echo "CPU:      $(grep 'model name' /proc/cpuinfo | head -1 | sed 's/.*: //')"
              echo "Disks:"
              for dev in /sys/block/{sd*,nvme*,vd*}; do
                [ -e "$dev" ] || continue
                DEVNAME=$(basename "$dev")
                SIZE=$(${pkgs.coreutils}/bin/blockdev --getsize64 "/dev/$DEVNAME" 2>/dev/null | numfmt --to=iec 2>/dev/null || echo "?")
                echo "  /dev/$DEVNAME ($SIZE)"
              done
              echo
              echo "SSH fingerprints:"
              for key in /etc/ssh/ssh_host_*_key.pub; do
                [ -f "$key" ] && ${pkgs.openssh}/bin/ssh-keygen -lf "$key" 2>/dev/null || true
              done
              ;;

            facts)
              exec ${collectFacts}
              ;;

            help|--help)
              echo "Usage: bootstrapctl [status|facts|help]"
              echo
              echo "  status  — show summary of machine state (default)"
              echo "  facts   — emit structured JSON hardware report"
              echo "  help    — show this message"
              ;;

            *)
              echo "Unknown command: $1" >&2
              echo "Usage: bootstrapctl [status|facts|help]" >&2
              exit 1
              ;;
          esac
        '';
      })
    ];

    # Systemd agent: runs facts collection and logs it
    systemd.services.bootstrap-agent = {
      description = "Calnix Bootstrap Agent — collect facts and enroll";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" "NetworkManager.service" "sshd.service" ];
      requires = [ "NetworkManager.service" ];

      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "${collectFacts} | ${pkgs.coreutils}/bin/tee /run/calnix-bootstrap-facts.json > /run/calnix-bootstrap-agent.log";
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };
  };
}
