# pi-autopilot-complete

This directory now uses the web documentation site as its canonical documentation.

Canonical docs live at:
- https://calvinloveland.github.io/megarepo/projects/active/personal/calnix/pi-packages/pi-autopilot-complete/

Key implementation note:
- super autopilot now chains turns by queuing `sendMessage(..., { deliverAs: "followUp" })` from inside the `complete` tool, not from `agent_end`
- this avoids Pi's awaited `agent_end` lifecycle window where `triggerTurn` can look like it is waiting on user input

Local source docs live in:
- `docs/`
