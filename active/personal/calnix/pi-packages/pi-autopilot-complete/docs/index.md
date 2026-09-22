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
| `["Refactor auth", "Add tests"]` | The tool result contains a `=== NEXT TASK ===` block and does **not** terminate. The model sees the result and keeps working in the same agent turn. |
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

## Debugging

The extension writes a detailed execution log to `/tmp/pi-ext/autopilot-complete.log`.
Each log line includes an ISO timestamp and the event name:

```
[00:48:10] refreshAutopilotState → autopilot: true tdd: false super: true
[00:48:11] complete execute: futureWork has 2 items: ["Add feature X", "Write tests"] super: true
[00:48:11] complete execute: queued follow-up message via sendMessage(deliverAs=followUp)
[00:48:11] complete execute: incremented super iteration to 1
[00:48:16] agent_end: futureWork empty — stopping super loop
```

### Why the old design failed

The earlier implementation tried to wait until `agent_end` and then call
`pi.sendMessage(..., { triggerTurn: true })`.

That sounds right, but Pi core keeps the run in its awaited lifecycle until
`agent_end` listeners settle. During that window the session is not yet truly
idle, so `triggerTurn` does not behave like an immediate fresh user turn.
That caused super autopilot to look like it was waiting for user input.

The reliable pattern is:

1. queue the next-cycle prompt **inside the `complete` tool execution**
2. use `sendMessage(..., { deliverAs: "followUp" })` while the agent is still streaming
3. return `terminate: true` so the current cycle ends cleanly
4. let Pi's built-in follow-up queue start the next cycle before the run goes idle

Watch the log live while testing:

```bash
tail -f /tmp/pi-ext/autopilot-complete.log
```

The log covers every decision point: state refreshes, system prompt modifications,
tool executions, agent_end branching, and command handlers.

## Slash commands

### `/autopilot [on|off|toggle|status]`

Control autopilot mode. Default state is ON.
Automatically suppresses when TDD mode is active.

### `/superautopilot [on|off|toggle|status]`

Super autopilot automates the "what's next? → implement → repeat" workflow:

1. **Agent completes a cycle** and calls `complete({ futureWork: ["next task", ...] })`
2. **Complete tool returns** a non-terminating `=== NEXT TASK ===` tool result
3. **The model sees that result** and continues working in the same agent turn
4. **Agent implements the next task** and calls `complete(...)` again
5. **Cycle repeats** until the agent calls `complete({ futureWork: [] })`

In super autopilot mode:
- Non-empty futureWork → the tool result drives the next cycle in the same turn
- Empty futureWork → loop stops, task is complete

Max 50 iterations between user messages to prevent runaway loops. Reaching the cap
resets the counter back to `0/50`, so the next message starts a fresh run.

### Runtime safety

- **50-iteration cap.** Super autopilot stops after `MAX_SUPER_AUTOPILOT_ITERATIONS`
  (50) cycles. Hitting the cap resets the iteration and item counters and returns the
  status bar to `🚀 super autopilot 0/50`, so a later `complete(...)` call is no longer
  instantly re-capped.
- **Esc aborts the loop.** Pressing Esc aborts the run; the extension detects the
  aborted assistant message and skips the autopilot nudge, so super autopilot does
  **not** queue another turn. One Esc press stops the loop — send a new message to
  resume.

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

## Studies and lessons

- [Lessons from `Michaelliv/pi-goal`](lessons-pi-goal.md) — comparative analysis of the closest peer extension; convergence on the same v0.4.0 architecture, and a list of concrete features worth porting (token budget, audit prompt, custom-message renderer, versioned state, reload safety, CI/release workflow).

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
