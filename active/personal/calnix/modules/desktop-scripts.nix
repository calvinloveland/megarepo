{ pkgs, ... }:
let
  calnixSwayApplyColors = pkgs.writeShellApplication {
    name = "calnix-sway-apply-colors";
    text = ''
      if [ -z "''${HOME:-}" ] || [ ! -f "$HOME/.cache/wal/colors.sh" ]; then
        exit 0
      fi

      wallpaper=""
      cursor=""
      color0=""
      color1=""
      color2=""
      color3=""
      color4=""
      color5=""
      color6=""
      color7=""
      color8=""
      color9=""
      color10=""
      color11=""
      color12=""
      color13=""
      color14=""
      color15=""
      # shellcheck source=/dev/null
      . "$HOME/.cache/wal/colors.sh"
      mkdir -p "$HOME/.cache/wal"

      cat > "$HOME/.cache/wal/colors-sway" <<EOF
      # Pywal color scheme for Sway
      # Colors (colorscheme: $wallpaper)
      set \$background $color0
      set \$foreground $color15
      set \$cursor $cursor

      set \$color0 $color0
      set \$color1 $color1
      set \$color2 $color2
      set \$color3 $color3
      set \$color4 $color4
      set \$color5 $color5
      set \$color6 $color6
      set \$color7 $color7
      set \$color8 $color8
      set \$color9 $color9
      set \$color10 $color10
      set \$color11 $color11
      set \$color12 $color12
      set \$color13 $color13
      set \$color14 $color14
      set \$color15 $color15

      client.focused          \$color4   \$color4   \$color0   \$color4   \$color4
      client.focused_inactive \$color8   \$color8   \$color7   \$color8   \$color8
      client.unfocused        \$color0   \$color0   \$color7   \$color0   \$color0
      client.urgent           \$color1   \$color1   \$color15  \$color1   \$color1
      client.placeholder      \$color8   \$color8   \$color7   \$color8   \$color8

      client.background       \$background
      EOF

      cat > "$HOME/.cache/wal/waybar-colors.css" <<EOF
      /* Pywal colors for waybar */
      @define-color background $color0;
      @define-color foreground $color15;
      @define-color color1 $color1;
      @define-color color2 $color2;
      @define-color color3 $color3;
      @define-color color4 $color4;
      @define-color color5 $color5;
      @define-color color6 $color6;
      EOF
    '';
  };

  calnixSwayUpdateColors = pkgs.writeShellApplication {
    name = "calnix-sway-update-colors";
    runtimeInputs = [
      calnixSwayApplyColors
      pkgs.libnotify
      pkgs.pywal
      pkgs.sway
    ];
    text = ''
      if [ -f "$HOME/Pictures/background.jpg" ]; then
        wal -i "$HOME/Pictures/background.jpg"
        calnix-sway-apply-colors
        swaymsg reload
      else
        notify-send "No wallpaper found" "Please place an image at ~/Pictures/background.jpg"
      fi
    '';
  };

  calnixSwayChooseWallpaper = pkgs.writeShellApplication {
    name = "calnix-sway-choose-wallpaper";
    runtimeInputs = [
      calnixSwayApplyColors
      pkgs.findutils
      pkgs.pywal
      pkgs.rofi
      pkgs.sway
    ];
    text = ''
      wall=$(find "$HOME/Pictures" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) | rofi -dmenu -p "Choose wallpaper:")
      if [ -n "$wall" ]; then
        wal -i "$wall"
        calnix-sway-apply-colors
        swaymsg reload
      fi
    '';
  };

  calnixWaybarWeather = pkgs.writeShellApplication {
    name = "calnix-waybar-weather";
    runtimeInputs = [ pkgs.curl ];
    text = builtins.readFile ./waybar-weather.sh;
  };

  calnixWaybarTemperature = pkgs.writeShellApplication {
    name = "calnix-waybar-temperature";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.jq
      pkgs.lm_sensors
    ];
    text = ''
      cpu_temp=$(sensors -j coretemp-isa-0000 | jq -r '."coretemp-isa-0000"."Package id 0"."temp1_input"')
      if [ -n "$cpu_temp" ] && [ "$cpu_temp" != "null" ]; then
        temp=$(printf "%.1f" "$cpu_temp")
        printf '{"text": "%s°C", "tooltip": "CPU Temperature: %s°C"}\n' "$temp" "$temp"
        exit 0
      fi

      cpu_temp=$(sensors -j | jq -r 'to_entries[] | select(.key | startswith("coretemp")) | .value | to_entries[] | select(.key | contains("Package")) | .value | to_entries[] | select(.key | endswith("_input")) | .value' | head -n1)
      if [ -n "$cpu_temp" ] && [ "$cpu_temp" != "null" ]; then
        temp=$(printf "%.1f" "$cpu_temp")
        printf '{"text": "%s°C", "tooltip": "CPU Temperature: %s°C"}\n' "$temp" "$temp"
      else
        printf '{"text": "N/A", "tooltip": "Temperature unavailable"}\n'
      fi
    '';
  };

  calnixSwayVolume = pkgs.writeShellApplication {
    name = "calnix-sway-volume";
    runtimeInputs = [ pkgs.wireplumber ];
    text = ''
      set -euo pipefail
      action="''${1:-up}"
      step="''${2:-5%}"
      sink1="@DEFAULT_SINK@"
      sink2="@DEFAULT_AUDIO_SINK@"
      source1="@DEFAULT_SOURCE@"
      source2="@DEFAULT_AUDIO_SOURCE@"
      case "$action" in
        up)
          wpctl set-volume "$sink1" "''${step}+" || wpctl set-volume "$sink2" "''${step}+" ;;
        down)
          wpctl set-volume "$sink1" "''${step}-" || wpctl set-volume "$sink2" "''${step}-" ;;
        mute)
          wpctl set-mute "$sink1" toggle || wpctl set-mute "$sink2" toggle ;;
        mic-mute)
          wpctl set-mute "$source1" toggle || wpctl set-mute "$source2" toggle ;;
      esac
    '';
  };

  calnixSwayBrightness = pkgs.writeShellApplication {
    name = "calnix-sway-brightness";
    runtimeInputs = [ pkgs.brightnessctl ];
    text = ''
      set -euo pipefail
      direction="''${1:-up}"
      step="''${2:-10%}"
      case "$direction" in
        up)
          brightnessctl set "+''${step}" \
            || brightnessctl -d intel_backlight set "+''${step}" \
            || brightnessctl -d amdgpu_bl0 set "+''${step}" ;;
        down)
          brightnessctl set "''${step}-" \
            || brightnessctl -d intel_backlight set "''${step}-" \
            || brightnessctl -d amdgpu_bl0 set "''${step}-" ;;
      esac
    '';
  };

  calnixSwayPanic = pkgs.writeShellApplication {
    name = "calnix-sway-panic";
    runtimeInputs = [
      pkgs.fuzzel
      pkgs.libnotify
      pkgs.sway
      pkgs.systemd
    ];
    text = ''
      set -euo pipefail
      options="🔄 Reload Sway Config\n🖱️ Reset Input Devices\n🪟 Kill Focused Window\n🔃 Restart Waybar\n🚪 Logout (restart Sway)\n❌ Cancel"
      choice=$(printf '%b\n' "$options" | fuzzel --dmenu --prompt "PANIC RECOVERY: ")
      case "$choice" in
        "🔄 Reload Sway Config")
          swaymsg reload
          notify-send "Sway" "Configuration reloaded" ;;
        "🖱️ Reset Input Devices")
          swaymsg 'input type:touchpad events enabled'
          swaymsg 'input type:pointer events enabled'
          swaymsg 'input type:keyboard events enabled'
          swaymsg 'seat - cursor move 0 0'
          notify-send "Sway" "Input devices reset" ;;
        "🪟 Kill Focused Window")
          swaymsg kill ;;
        "🔃 Restart Waybar")
          systemctl --user restart waybar
          notify-send "Sway" "Waybar restarted" ;;
        "🚪 Logout (restart Sway)")
          swaymsg exit ;;
      esac
    '';
  };
in
{
  environment.systemPackages = [
    calnixSwayApplyColors
    calnixSwayUpdateColors
    calnixSwayChooseWallpaper
    calnixWaybarWeather
    calnixWaybarTemperature
    calnixSwayVolume
    calnixSwayBrightness
    calnixSwayPanic
  ];
}
