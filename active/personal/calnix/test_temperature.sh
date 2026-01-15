#!/bin/bash
# Script to test temperature sensors

echo "Testing temperature sensors..."
echo "==============================="

echo "CPU sensors (coretemp):"
sensors coretemp-isa-0000

echo -e "\nACPI thermal zones:"
sensors acpitz-acpi-0

echo -e "\nNVMe temperature:"
sensors nvme-pci-5500

echo -e "\nTesting our temperature script directly:"
SCRIPT_PATH="$HOME/.config/waybar/temp-monitor.sh"

if [ -f "$SCRIPT_PATH" ]; then
  echo "Script exists, testing..."
  chmod +x "$SCRIPT_PATH"
  $SCRIPT_PATH
else
  echo "Script not found at $SCRIPT_PATH"
  echo "This is expected before the first rebuild"
fi

echo -e "\nChecking all hwmon paths:"
for i in /sys/class/hwmon/hwmon*/temp*_input; do
  if [ -f "$i" ]; then
    TEMP=$(cat "$i" 2>/dev/null)
    if [ -n "$TEMP" ]; then
      TEMP_C=$(echo "scale=1; $TEMP/1000" | bc)
      NAME=$(cat "$(dirname $i)/name" 2>/dev/null)
      echo "$i: $TEMP_C°C ($NAME)"
    fi
  fi
done

echo -e "\nWaybar status:"
systemctl --user status waybar | grep -A 3 "Active:"
