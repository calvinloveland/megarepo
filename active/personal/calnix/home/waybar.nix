{ pkgs, ... }:
{
  # Waybar configuration with CPU and power monitoring
  programs.waybar = {
    enable = true;
    systemd = {
      enable = true;
      target = "sway-session.target"; # Ensure waybar starts with Sway
    };
    settings = {
      mainBar = {
        layer = "top";
        position = "top";
        height = 38; # increased from 30 to satisfy modules' minimum height

        modules-left = [
          "sway/workspaces"
          "sway/mode"
          "custom/media"
        ];
        modules-center = [ "sway/window" ];
        modules-right = [
          "cpu"
          "memory"
          "custom/temperature" # Use our custom temperature module only
          "disk"
          "battery"
          "network#wifi"
          "network#ethernet"
          "network#disconnected"
          "pulseaudio"
          "backlight"
          "custom/weather"
          "clock"
          "tray"
        ];

        # CPU usage with detailed monitoring
        "cpu" = {
          format = "CPU {usage}%";
          tooltip-format = "CPU Usage: {usage}%\nLoad: {load}";
          interval = 2;
          on-click = "kitty -e htop";
        };

        # Memory usage
        "memory" = {
          format = "RAM {percentage}%";
          tooltip-format = "Memory: {used:0.1f}G / {total:0.1f}G ({percentage}%)\nSwap: {swapUsed:0.1f}G / {swapTotal:0.1f}G";
          interval = 2;
          on-click = "kitty -e htop";
        };

        # Disk space
        "disk" = {
          format = "Disk {percentage_used}%";
          path = "/";
          interval = 30;
          tooltip-format = "Disk usage: {used} used out of {total} on {path} ({percentage_used}%)";
          on-click = "kitty -e ncdu /";
        };

        # CPU temperature using custom script for reliability
        "custom/temperature" = {
          format = "Temp {}";
          exec = "${pkgs.bash}/bin/bash ~/.config/waybar/temp-monitor.sh";
          return-type = "json";
          interval = 2;
          on-click = "${pkgs.kitty}/bin/kitty -e ${pkgs.lm_sensors}/bin/sensors";
        };

        # Keep original temperature module as fallback
        "temperature" = {
          critical-threshold = 80;
          format-critical = "Temp {temperatureC}°C!";
          format = "Temp {temperatureC}°C";
          tooltip-format = "CPU Temperature: {temperatureC}°C";
          # Explicitly set thermal zone to use the CPU package temperature
          thermal-zone = 0;
          # Try explicit hwmon path for Intel CPU
          hwmon-path = "/sys/class/hwmon/hwmon4/temp1_input";
          interval = 2;
        };

        # Battery with power consumption - optimized for HP Elitebook
        "battery" = {
          bat = "BAT0";
          adapter = "AC";
          interval = 10;
          states = {
            "warning" = 30;
            "critical" = 15;
          };
          format = "{capacity}%";
          format-charging = "⚡ {capacity}%";
          format-plugged = "🔌 {capacity}%";
          tooltip = true;
        };

        # Audio
        "pulseaudio" = {
          format = "Vol {volume}%";
          format-bluetooth = "BT {volume}%";
          format-muted = "Muted";
          format-source = "Mic {volume}%";
          format-source-muted = "Mic Off";
          scroll-step = 1;
          on-click = "pavucontrol";
        };

        # Backlight
        "backlight" = {
          format = "Light {percent}%";
          on-scroll-up = "brightnessctl set +5%";
          on-scroll-down = "brightnessctl set 5%-";
        };

        # Network - split into multiple modules for better control
        "network#wifi" = {
          interface = "wlp*"; # Updated to match your wlp0s20f3 interface
          format-wifi = "WiFi {essid} ({signalStrength}%)";
          format-ethernet = "";
          format-disconnected = "";
          tooltip-format-wifi = "WiFi: {essid} ({signalStrength}%)\nIP: {ipaddr}/{cidr}\nFrequency: {frequency}GHz\nUp: {bandwidthUpBits} Down: {bandwidthDownBits}";
          interval = 5;
          on-click = "kitty -e nmtui";
        };

        "network#ethernet" = {
          interface = "eth*";
          format-wifi = "";
          format-ethernet = "Net {ipaddr}/{cidr}";
          format-disconnected = "";
          tooltip-format-ethernet = "Ethernet: {ifname}\nIP: {ipaddr}/{cidr}\nUp: {bandwidthUpBits} Down: {bandwidthDownBits}";
          interval = 5;
          on-click = "kitty -e nmtui";
        };

        "network#disconnected" = {
          interface = "*";
          format-wifi = "";
          format-ethernet = "";
          format-disconnected = "Net Down";
          interval = 5;
          tooltip-format-disconnected = "No network connection";
          on-click = "kitty -e nmtui";
        };

        # Weather
        "custom/weather" = {
          exec = "${pkgs.bash}/bin/bash ~/.config/waybar/weather.sh";
          interval = 600; # Update every 10 minutes
          return-type = "json";
          format = "{icon} {}";
          format-icons = {
            "Clear" = "☀️";
            "Clouds" = "☁️";
            "Rain" = "🌧️";
            "Snow" = "❄️";
            "default" = "🌈";
          };
          on-click = "${pkgs.xdg-utils}/bin/xdg-open https://wttr.in";
        };

        # Media player
        "custom/media" = {
          format = "Media {}";
          return-type = "json";
          max-length = 40;
          format-icons = { };
          escape = true;
          exec = "${pkgs.playerctl}/bin/playerctl -a metadata --format '{\"text\": \"{{artist}} - {{markup_escape(title)}}\", \"tooltip\": \"{{playerName}} : {{artist}} - {{album}} - {{markup_escape(title)}}\", \"alt\": \"{{status}}\", \"class\": \"{{status}}\"}' -F";
          on-click = "${pkgs.playerctl}/bin/playerctl play-pause";
        };

        # Clock
        "clock" = {
          format = "{:%H:%M}";
          format-alt = "{:%Y-%m-%d}";
          tooltip-format = "<big>{:%Y %B}</big>\n<tt><small>{calendar}</small></tt>";
        };

        # System tray
        "tray" = {
          icon-size = 21;
          spacing = 10;
        };
      };
    };

    # Modern dark theme - GTK CSS compatible
    style = ''
      /* Catppuccin Mocha-inspired palette */
      @define-color background rgba(30, 30, 46, 0.85);
      @define-color foreground #cdd6f4;
      @define-color accent #89b4fa;
      @define-color accentAlt #b4befe;
      @define-color success #a6e3a1;
      @define-color warning #f9e2af;
      @define-color danger #f38ba8;
      @define-color muted #6c7086;
      @define-color surface rgba(49, 50, 68, 0.6);
      @define-color surfaceHover rgba(69, 71, 90, 0.8);
      @define-color borderColor rgba(137, 180, 250, 0.3);

      * {
        font-family: "FiraCode Nerd Font Mono", "Fira Code", "DejaVu Sans Mono", "Noto Color Emoji";
        font-size: 13px;
        border: none;
        border-radius: 0;
        min-height: 0;
      }

      label {
        color: @foreground;
        padding: 0;
        margin: 0;
        font-weight: 500;
      }

      window#waybar {
        background-color: @background;
        color: @foreground;
        border-bottom: 1px solid @borderColor;
      }

      /* Workspaces - pill-style buttons */
      #workspaces {
        margin: 4px 8px;
        padding: 0;
        background: @surface;
        border-radius: 12px;
      }
      #workspaces button {
        padding: 4px 12px;
        margin: 4px 2px;
        border-radius: 10px;
        color: @muted;
        background: transparent;
        font-weight: 600;
      }
      #workspaces button:hover {
        background: @surfaceHover;
        color: @foreground;
      }
      #workspaces button.focused {
        background: rgba(137, 180, 250, 0.3);
        color: @accent;
        border: 1px solid @accent;
      }
      #workspaces button.urgent {
        background: rgba(243, 139, 168, 0.6);
        color: #ffffff;
        border: 2px solid @danger;
        font-weight: 700;
      }

      /* Sway mode indicator */
      #mode {
        background: @danger;
        color: #1e1e2e;
        padding: 4px 12px;
        margin: 4px;
        border-radius: 8px;
        font-weight: 700;
      }

      /* Window title */
      #window {
        color: @foreground;
        font-weight: 500;
        padding: 0 16px;
      }

      /* Unified pill-style modules */
      #cpu, #memory, #disk,
      #custom-temperature, #temperature,
      #battery,
      #network, #network.wifi, #network.ethernet, #network.disconnected,
      #pulseaudio,
      #backlight,
      #custom-weather,
      #clock,
      #custom-media {
        background: @surface;
        color: @foreground;
        padding: 4px 12px;
        margin: 4px 3px;
        border-radius: 10px;
        font-weight: 500;
      }

      /* Hover effect for all modules */
      #cpu:hover, #memory:hover, #disk:hover,
      #custom-temperature:hover, #temperature:hover,
      #battery:hover,
      #network:hover,
      #pulseaudio:hover,
      #backlight:hover,
      #custom-weather:hover,
      #clock:hover,
      #custom-media:hover {
        background: @surfaceHover;
      }

      /* System tray */
      #tray {
        background: @surface;
        padding: 4px 8px;
        margin: 4px 8px 4px 3px;
        border-radius: 10px;
      }
      #tray > .passive { opacity: 0.6; }
      #tray > .active { background: transparent; }
      #tray > .needs-attention {
        background: @warning;
        border-radius: 8px;
      }

      /* Module-specific accent colors */
      #cpu { border-left: 3px solid @accent; }
      #memory { border-left: 3px solid @accentAlt; }
      #disk { border-left: 3px solid #cba6f7; }
      #custom-temperature, #temperature { border-left: 3px solid #fab387; }
      #pulseaudio { border-left: 3px solid #f5c2e7; }
      #backlight { border-left: 3px solid @warning; }
      #custom-weather { border-left: 3px solid #94e2d5; }
      #clock { border-left: 3px solid @success; }

      /* Battery states */
      #battery {
        border-left: 3px solid @success;
      }
      #battery.charging {
        background: rgba(166, 227, 161, 0.3);
        border-left-color: @success;
      }
      #battery.warning:not(.charging) {
        background: rgba(249, 226, 175, 0.3);
        border-left-color: @warning;
        color: @warning;
      }
      #battery.critical:not(.charging) {
        background: rgba(243, 139, 168, 0.5);
        border-left: 3px solid #ff6b8a;
        border-right: 3px solid #ff6b8a;
        color: #ffffff;
        font-weight: 700;
      }

      /* Network states */
      #network.wifi {
        border-left: 3px solid @success;
      }
      #network.ethernet {
        border-left: 3px solid @accent;
      }
      #network.disconnected {
        background: rgba(243, 139, 168, 0.3);
        border-left: 3px solid @danger;
        color: @danger;
        font-weight: 600;
      }

      /* Audio states */
      #pulseaudio.muted {
        background: @surface;
        color: @muted;
        opacity: 0.7;
      }

      /* Media player states */
      #custom-media {
        border-left: 3px solid #f5c2e7;
      }
      #custom-media.playing {
        background: rgba(245, 194, 231, 0.2);
      }
      #custom-media.paused {
        color: @muted;
        opacity: 0.8;
      }

      /* Temperature warning states */
      #custom-temperature.critical, #temperature.critical {
        background: rgba(243, 139, 168, 0.5);
        color: #ffffff;
        border-left: 3px solid #ff6b8a;
        font-weight: 700;
      }
    '';
  };
}
