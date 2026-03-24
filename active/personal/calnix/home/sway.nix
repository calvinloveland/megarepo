{ lib, ... }:
{
  wayland.windowManager.sway = {
    enable = true;
    config = rec {
      modifier = "Mod4";
      terminal = "kitty";

      # Touchpad configuration
      input = {
        "type:touchpad" = {
          tap = "enabled";
          dwt = "enabled"; # Disable while typing
          natural_scroll = "enabled";
          middle_emulation = "enabled";
          tap_button_map = "lrm"; # Left, right, middle button
          drag = "enabled";
          drag_lock = "enabled"; # Enable drag lock (double tap to drag)
          accel_profile = "adaptive";
          pointer_accel = "0.2"; # Pointer acceleration
        };
      };

      # Use actual color values instead of pywal variables during build
      colors = {
        focused = {
          border = "#7c3aed";
          background = "#7c3aed";
          text = "#ffffff";
          indicator = "#7c3aed";
          childBorder = "#7c3aed";
        };
        focusedInactive = {
          border = "#374151";
          background = "#374151";
          text = "#ffffff";
          indicator = "#374151";
          childBorder = "#374151";
        };
        unfocused = {
          border = "#1f2937";
          background = "#1f2937";
          text = "#9ca3af";
          indicator = "#1f2937";
          childBorder = "#1f2937";
        };
        urgent = {
          border = "#ef4444";
          background = "#ef4444";
          text = "#ffffff";
          indicator = "#ef4444";
          childBorder = "#ef4444";
        };
      };

      # Window and border settings
      window = {
        border = 2;
        titlebar = false;
      };

      # Gaps configuration
      gaps = {
        inner = 2;
        outer = 1;
      };

      # Assign applications to specific workspaces
      assigns = {
        "1" = [ { class = "Code"; } ]; # VS Code uses class "Code"
        "2" = [
          { app_id = "google-chrome"; }
          { class = "Google-chrome"; }
          { class = "Chromium"; }
          { class = "chrome"; }
        ];
        "3" = [ { app_id = "kitty"; } ]; # Kitty uses app_id, not class
        "4" = [
          { class = "Steam"; }
          { class = "steam"; }
        ];
      };

      # Let waybar be managed by systemd/Home Manager
      bars = [ ];

      # Key bindings
      keybindings = lib.mkOptionDefault {
        # File manager
        "${modifier}+e" = "exec thunar";
        # Audio volume keys (robust wrapper script tries both PipeWire aliases)
        "XF86AudioRaiseVolume" = "exec calnix-sway-volume up 5%";
        "XF86AudioLowerVolume" = "exec calnix-sway-volume down 5%";
        "XF86AudioMute" = "exec calnix-sway-volume mute";
        # Mic mute toggle
        "XF86AudioMicMute" = "exec calnix-sway-volume mic-mute";

        # Media transport keys
        "XF86AudioPlay" = "exec playerctl play-pause";
        "XF86AudioNext" = "exec playerctl next";
        "XF86AudioPrev" = "exec playerctl previous";
        "XF86AudioStop" = "exec playerctl stop";

        # Brightness controls (wrapper handles common device names)
        "XF86MonBrightnessUp" = "exec calnix-sway-brightness up 10%";
        "XF86MonBrightnessDown" = "exec calnix-sway-brightness down 10%";

        # Bluetooth controls
        "${modifier}+b" = "exec blueman-manager"; # Open Bluetooth manager GUI
        "${modifier}+Shift+b" = "exec ${terminal} -e bluetuith"; # Open terminal Bluetooth manager

        # Pywal controls - generate colors from wallpaper and update Sway
        "${modifier}+w" = "exec calnix-sway-update-colors";

        # Alternative: choose wallpaper with file picker
        "${modifier}+Shift+w" = "exec calnix-sway-choose-wallpaper";

        # PANIC! Recovery menu for when things go wrong (focus issues, etc.)
        "${modifier}+p" = "exec calnix-sway-panic";
      };

      startup = [
        { command = "wal -R"; } # Restore last pywal color scheme
        { command = "calnix-sway-apply-colors"; } # Apply colors to Sway
        { command = "swaybg -o '*' -i ~/Pictures/background.jpg"; }

        # Auto-start applications - they will be assigned to workspaces automatically
        { command = "sleep 2 && code"; }
        { command = "sleep 3 && google-chrome-stable"; }
        { command = "sleep 4 && kitty"; }
        { command = "sleep 5 && steam"; }
        # Polkit agent for auth dialogs (mounting, etc.)
        { command = "lxqt-policykit"; }
      ];
    };

    # Include pywal colors dynamically
    extraConfig = ''
      # Include pywal color scheme if available
      include ~/.cache/wal/colors-sway
    '';
  };
}
