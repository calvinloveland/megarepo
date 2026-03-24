{ pkgs, ... }:
{
  home.file = {
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
  };
}
