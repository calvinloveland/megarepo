#!/bin/bash
# Weather script for waybar with better error handling and diagnostics

# Use curl from PATH - NixOS will handle making it available
CURL="curl"

# Log function for debugging
log_debug() {
  echo "[$(date)] $1" >> /tmp/waybar-weather.log
}

log_debug "Starting weather script"

# Fetch weather information from wttr.in with a timeout to prevent hanging
WEATHER_INFO=$($CURL -s --max-time 5 "https://wttr.in/?format=%c|%t|%C")
CURL_STATUS=$?

log_debug "Curl status: $CURL_STATUS, Response: $WEATHER_INFO"

# Parse the output (format: icon|temperature|condition)
if [[ $? -eq 0 && -n "$WEATHER_INFO" ]]; then
  IFS='|' read -r ICON TEMP CONDITION <<< "$WEATHER_INFO"
  # Format as JSON for waybar's custom module
  echo "{\"text\": \"$TEMP\", \"alt\": \"$CONDITION\", \"tooltip\": \"Condition: $CONDITION\\nTemperature: $TEMP\"}"
else
  # If curl fails or returns empty, show error message
  echo "{\"text\": \"Weather Unavailable\", \"alt\": \"Error\", \"tooltip\": \"Weather service is currently unavailable\"}"
fi
