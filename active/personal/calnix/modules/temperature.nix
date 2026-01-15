# Temperature test module for waybar
{
  config, 
  pkgs,
  lib,
  ...
}: {
  # Create a custom module for temperature monitoring in waybar
  home-manager.users.calvin = { config, ... }: {
    # Custom script for reliable temperature monitoring
    home.file.".config/waybar/temp-monitor.sh" = {
      executable = true;
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
    };
  };
}
