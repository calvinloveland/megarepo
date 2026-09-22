# pi-autopilot-complete

This directory now uses the web documentation site as its canonical documentation.

Canonical docs live at:
- https://calvinloveland.github.io/megarepo/projects/active/personal/calnix/pi-packages/pi-autopilot-complete/

Key implementation notes:
- super autopilot chains turns by returning a non-terminating `=== NEXT TASK ===` tool result from the `complete` tool; the model continues in the same agent turn (no `agent_end` re-entry, no follow-up-queue timing races)
- Esc (abort) is detected from the aborted assistant message in `agent_end` and suppresses the autopilot nudge, so one Esc press stops the loop
- hitting the 50-iteration safety limit resets the iteration counter to `0/50` so the loop is not stuck at the cap

Local source docs live in:
- `docs/`
