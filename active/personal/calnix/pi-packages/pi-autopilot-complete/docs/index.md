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
| `["Refactor auth", "Add tests"]` | Extension queues a `followUp` **custom message** during the `complete` tool call. Pi converts it to a user-role message for the next cycle before the run goes idle. |
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
2. **Complete tool queues** a `followUp` `=== NEXT TASK ===` message from inside tool execution
3. **Pi consumes that follow-up automatically** before the run goes idle or asks the user for input
4. **Agent implements the next task** and calls `complete(...)` again
5. **Cycle repeats** until the agent calls `complete({ futureWork: [] })`

In super autopilot mode:
- Non-empty futureWork → extension queues the next cycle mechanically via Pi's follow-up queue
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
