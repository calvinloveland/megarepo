{ pkgs, ... }:
{
  # Create scripts for color management and utilities
  home.file = {
    ".config/sway/update-colors.sh" = {
      text = ''
        #!/bin/sh
        # Generate colors from current wallpaper
        if [ -f ~/Pictures/background.jpg ]; then
          wal -i ~/Pictures/background.jpg
          # Apply colors to Sway
          ~/.config/sway/apply-colors.sh
          # Reload Sway to pick up new colors
          swaymsg reload
        else
          notify-send "No wallpaper found" "Please place an image at ~/Pictures/background.jpg"
        fi
      '';
      executable = true;
    };

    ".config/sway/choose-wallpaper.sh" = {
      text = ''
        #!/bin/sh
        # Choose wallpaper with file picker
        WALLPAPER=$(find ~/Pictures -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) | rofi -dmenu -p "Choose wallpaper:")
        if [ -n "$WALLPAPER" ]; then
          wal -i "$WALLPAPER"
          ~/.config/sway/apply-colors.sh
          swaymsg reload
        fi
      '';
      executable = true;
    };

    ".config/sway/apply-colors.sh" = {
      text = ''
                    #!/bin/sh
                    # Apply pywal colors to Sway configuration
                    if [ -f ~/.cache/wal/colors.sh ]; then
                      . ~/.cache/wal/colors.sh

                      # Create Sway color configuration
                      cat > ~/.cache/wal/colors-sway << EOF
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

        # Window decoration colors
        # class                 border     backgr.    text       indicator  child_border
        client.focused          \$color4   \$color4   \$color0   \$color4   \$color4
        client.focused_inactive \$color8   \$color8   \$color7   \$color8   \$color8
        client.unfocused        \$color0   \$color0   \$color7   \$color0   \$color0
        client.urgent           \$color1   \$color1   \$color15  \$color1   \$color1
        client.placeholder      \$color8   \$color8   \$color7   \$color8   \$color8

        client.background       \$background
        EOF

                      # Create waybar colors configuration
                      cat > ~/.cache/wal/waybar-colors.css << EOF
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
                    fi
      '';
      executable = true;
    };

    ".config/waybar/weather.sh" = {
      text = ''
        #!${pkgs.bash}/bin/bash
        # Weather script for waybar (Nix-friendly)

        # Fetch weather information from wttr.in using Nix-provided curl
        WEATHER_INFO=$(${pkgs.curl}/bin/curl -s "https://wttr.in/?format=%c|%t|%C")

        # Parse the output (format: icon|temperature|condition)
        if [[ $? -eq 0 && -n "$WEATHER_INFO" ]]; then
          IFS='|' read -r ICON TEMP CONDITION <<< "$WEATHER_INFO"
          # Format as JSON for waybar's custom module
          echo "{\"text\": \"$TEMP\", \"alt\": \"$CONDITION\", \"tooltip\": \"Condition: $CONDITION\\nTemperature: $TEMP\"}"
        else
          # If curl fails, show error message
          echo "{\"text\": \"Weather Unavailable\", \"alt\": \"Error\", \"tooltip\": \"Weather service is currently unavailable\"}"
        fi
      '';
      executable = true;
    };

    # Provide a default pywal CSS so Waybar's @import never fails on first start
    ".cache/wal/waybar-colors.css" = {
      text = ''
        /* Default colors (will be overwritten by apply-colors.sh when wal runs) */
        @define-color background rgba(24, 25, 28, 0.75);
        @define-color foreground #e5e7eb;
        @define-color color1 #8aadf4;
        @define-color color2 #a6e3a1;
        @define-color color3 #f9e2af;
        @define-color color4 #94e2d5;
        @define-color color5 #f5c2e7;
        @define-color color6 #89dceb;
      '';
    };

    # Custom script for reliable temperature monitoring
    ".config/waybar/temp-monitor.sh" = {
      text = ''
        #!/bin/sh
        # Get CPU temperature directly from sensors
        CPU_TEMP=$(${pkgs.lm_sensors}/bin/sensors -j coretemp-isa-0000 |
                  ${pkgs.jq}/bin/jq -r '."coretemp-isa-0000"."Package id 0"."temp1_input"')

        # Format temperature and output as JSON for waybar
        if [ -n "$CPU_TEMP" ] && [ "$CPU_TEMP" != "null" ]; then
          TEMP=$(printf "%.1f" $CPU_TEMP)
          echo "{\"text\": \"$TEMP°C\", \"tooltip\": \"CPU Temperature: $TEMP°C\"}"
        else
          # Fallback to alternative sensor
          CPU_TEMP=$(${pkgs.lm_sensors}/bin/sensors -j |
                    ${pkgs.jq}/bin/jq -r 'to_entries[] | select(.key | startswith("coretemp")) |
                    .value | to_entries[] | select(.key | contains("Package")) |
                    .value | to_entries[] | select(.key | endswith("_input")) | .value' |
                    ${pkgs.coreutils}/bin/head -n1)

          if [ -n "$CPU_TEMP" ] && [ "$CPU_TEMP" != "null" ]; then
            TEMP=$(printf "%.1f" $CPU_TEMP)
            echo "{\"text\": \"$TEMP°C\", \"tooltip\": \"CPU Temperature: $TEMP°C\"}"
          else
            echo "{\"text\": \"N/A\", \"tooltip\": \"Temperature unavailable\"}"
          fi
        fi
      '';
      executable = true;
    };

    ".config/sway/volume.sh" = {
      text = ''
        #!${pkgs.bash}/bin/bash
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
      executable = true;
    };

    ".config/sway/brightness.sh" = {
      text = ''
        #!${pkgs.bash}/bin/bash
        set -euo pipefail
        dir="''${1:-up}"
        step="''${2:-10%}"
        case "$dir" in
          up)
            ${pkgs.brightnessctl}/bin/brightnessctl set "+''${step}" \
              || ${pkgs.brightnessctl}/bin/brightnessctl -d intel_backlight set "+''${step}" \
              || ${pkgs.brightnessctl}/bin/brightnessctl -d amdgpu_bl0 set "+''${step}" ;;
          down)
            ${pkgs.brightnessctl}/bin/brightnessctl set "''${step}-" \
              || ${pkgs.brightnessctl}/bin/brightnessctl -d intel_backlight set "''${step}-" \
              || ${pkgs.brightnessctl}/bin/brightnessctl -d amdgpu_bl0 set "''${step}-" ;;
        esac
      '';
      executable = true;
    };

    # PANIC! Recovery script - Mod+p to access when things go wrong
    ".config/sway/panic.sh" = {
      text = ''
        #!${pkgs.bash}/bin/bash
        # PANIC RECOVERY MENU
        # Use this when focus/input issues occur

        OPTIONS="🔄 Reload Sway Config\n🖱️ Reset Input Devices\n🪟 Kill Focused Window\n🔃 Restart Waybar\n🚪 Logout (restart Sway)\n❌ Cancel"

        CHOICE=$(echo -e "$OPTIONS" | ${pkgs.fuzzel}/bin/fuzzel --dmenu --prompt "PANIC RECOVERY: ")

        case "$CHOICE" in
          "🔄 Reload Sway Config")
            swaymsg reload
            notify-send "Sway" "Configuration reloaded"
            ;;
          "🖱️ Reset Input Devices")
            # Re-enable all input devices
            swaymsg 'input type:touchpad events enabled'
            swaymsg 'input type:pointer events enabled'
            swaymsg 'input type:keyboard events enabled'
            # Reset seat
            swaymsg 'seat - cursor move 0 0'
            notify-send "Sway" "Input devices reset"
            ;;
          "🪟 Kill Focused Window")
            swaymsg kill
            ;;
          "🔃 Restart Waybar")
            systemctl --user restart waybar
            notify-send "Sway" "Waybar restarted"
            ;;
          "🚪 Logout (restart Sway)")
            swaymsg exit
            ;;
          *)
            # Cancelled or unknown
            ;;
        esac
      '';
      executable = true;
    };
  };
}
