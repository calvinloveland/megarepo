# pi-find-session

Pi extension that adds fast session-finder and handoff commands for staying productive when Pi sessions get unwieldy.

## Behavior

- adds `/fs <search terms>` to find the best matching local session
- adds `/handoff <goal>` to continue in a fresh session with a compact summary of the current one
- scores recent sessions using informative token overlap from session names, first prompts, cached summaries, and conversation text
- switches directly to the best match
- warns in the status line using Pi's actual context-usage estimate when the current session looks large enough to risk provider-side 413 request failures
- auto-compacts critically large sessions after a turn so the next prompt is less likely to bounce with another 413
- if no session matches well enough, it stays put and tells you no match was found
- leaves fully manual new-session creation to pi's built-in `/new session`

## Commands

```text
/fs <search terms>
/find-session <search terms>
/handoff <goal for the new session>
```

## Notes

- this replaces the older automatic routing workflow with explicit commands so it does not build oversized routing prompts on every turn
- `/handoff` is intended for exactly the "my last session got huge and started throwing 413s" failure mode
- in interactive mode, `/handoff` opens the compact kickoff prompt as a draft in the new session instead of auto-sending it, so you can trim or edit it before the first model request
- it uses the supported `ctx.switchSession()` / `ctx.newSession()` command APIs instead of unsupported internal session hooks
- it keeps a lightweight cache at `~/.pi/agent/find-session-cache.json`

## Local test

```bash
pi -e ./pi-packages/pi-session-router
```

## Logic tests

```bash
cd pi-packages/pi-session-router
node --test tests/router-logic.test.mjs
```

## Install from local path

```bash
pi install ./pi-packages/pi-session-router
```
