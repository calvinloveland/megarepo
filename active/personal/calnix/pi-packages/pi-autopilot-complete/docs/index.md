# pi-autopilot-complete

Pi extension that:

- overrides the built-in `complete` tool with a required `futureWork: string[]` field
- non-empty futureWork → items queued as follow-up tasks, agent continues working
- empty futureWork (`[]`) → task is complete, run terminates
- nudges the model to keep working when it stops without calling `complete`
- `/autopilot on|off|toggle|status` — control autopilot mode
- `/superautopilot on|off|toggle|status` — automated "what's next? → implement → repeat" loop
- `/max-nudges [N|reset]` — control nudge limit
- persists state in the session (survives reloads and compaction)
- automatically stays off while TDD mode is active

## `complete` tool — `futureWork` API

The `complete` tool now has a single required field: `futureWork: string[]`.

| `futureWork` | Behavior |
|---|---|
| `["Refactor auth", "Add tests"]` | Each item queued as a `followUp` user message. Agent continues working. |
| `[]` | Task marked complete. Run terminates (`terminate: true`). |

Optional `summary` field lets the agent log what was accomplished.

### Examples

```json
{ "futureWork": ["Fix the login redirect bug", "Update the API docs"] }
{ "futureWork": [], "summary": "All features implemented and tested" }
```

### Nudge safety

If the agent stops without calling `complete`, the extension nudges it to keep going.
After `maxNudges` (default 2) nudges within one user message, reminders stop.
Each new user message resets the counter.

## Slash commands

### `/autopilot [on|off|toggle|status]`

Control autopilot mode. Default state is ON.
Automatically suppresses when TDD mode is active.

### `/superautopilot [on|off|toggle|status]`

Super autopilot automates the "what's next? → implement → repeat" workflow:

1. **Agent completes a task** and calls `complete({ futureWork: ["next task", ...] })`
2. **Extension auto-triggers** the next cycle with a "What's next?" prompt
3. **Agent proposes and implements** the next highest-value task
4. **Cycle repeats** until the agent calls `complete({ futureWork: [] })`

In super autopilot mode:
- Non-empty futureWork → extension sends "what's next?" and continues
- Empty futureWork → loop stops, task is complete

Max 50 iterations per session to prevent runaway loops.

```
/superautopilot on       # Enable (also enables regular autopilot)
/superautopilot off      # Disable
/superautopilot toggle   # Toggle
/superautopilot status   # Show state and iteration count
```

The UI status shows `🚀 super autopilot N/50` during the loop.

### `/max-nudges [N|reset]`

Show or set the maximum autopilot nudges per user message.

- `/max-nudges` — show current value
- `/max-nudges 5` — set to 5 (range: 1–100)
- `/max-nudges reset` — reset to default (2)

The value persists in the session and survives reloads.

## Compaction resilience

Autopilot state (`autopilotNudges`, `maxNudges`, `autopilotEnabled`) is stored in module-level variables that survive `session_compact` events. The `input` event (user messages) resets the nudge counter — nudge-triggered auto-turns do not.

## Local test

```bash
pi -e ./pi-packages/pi-autopilot-complete
```

## Run tests

```bash
cd active/personal/calnix/pi-packages/pi-autopilot-complete
npm install --no-save typebox
npm test
```
