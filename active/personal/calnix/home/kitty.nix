{ ... }:
{
  # Configure Kitty terminal with proper fonts and pywal colors
  programs.kitty = {
    enable = true;
    font = {
      name = "Fira Code";
      size = 12;
    };
    settings = {
      # Window settings
      window_padding_width = 10;
      background_opacity = "0.95";

      # Cursor settings
      cursor_blink_interval = 0;

      # Tab settings
      tab_bar_edge = "bottom";
      tab_bar_style = "powerline";

      # Performance
      repaint_delay = 10;
      input_delay = 3;
      sync_to_monitor = "yes";

      # Include pywal colors
      include = "~/.cache/wal/colors-kitty.conf";
    };
  };
}
